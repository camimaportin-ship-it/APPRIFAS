// server.js
// -----------------------------------------------------------------------------
// Backend único de la app de rifas. Sirve la API REST y también el frontend
// estático (offline-first: todo corre en un solo proceso Node, sin depender
// de internet una vez instaladas las dependencias).
// -----------------------------------------------------------------------------
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const QRCode = require('qrcode');
const XLSX = require('xlsx');
const webPush = require('web-push');

const { initDB, ensureSchema, dbPath } = require('./backend/db');
const whatsapp = require('./backend/whatsapp');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const bcrypt = require('bcryptjs');
const cryptoToken = require('crypto');
const archiver = require('archiver');
const unzipper = require('unzipper');

let db;

async function startApp() {
db = await initDB();
ensureSchema(db);

// ----------------------- PUSH NOTIFICATIONS -----------------------------------
// Generar VAPID keys una vez y persistirlas en tabla config
if (!db.prepare("SELECT 1 FROM config WHERE clave = 'vapid_keys'").get()) {
  const keys = webPush.generateVAPIDKeys();
  db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('vapid_keys', ?)")
    .run(JSON.stringify(keys));
}
const storedVapid = JSON.parse(db.prepare("SELECT valor FROM config WHERE clave = 'vapid_keys'").get().valor);
  webPush.setVapidDetails('mailto:admin@rifassyc.local', storedVapid.publicKey, storedVapid.privateKey);

function enviarPush(titulo, cuerpo, data = {}) {
  const subs = db.prepare("SELECT * FROM push_subscriptions WHERE activa = 1").all();
  for (const sub of subs) {
    const pushSubscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    webPush.sendNotification(pushSubscription, JSON.stringify({ title: titulo, body: cuerpo, data, icon: '/icons/icon-192.png' }))
      .catch(() => { db.prepare("UPDATE push_subscriptions SET activa = 0 WHERE endpoint = ?").run(sub.endpoint); });
  }
}

const app = express();
const PORT_BASE = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Carpeta de imágenes subidas (producto y banner de empresa)
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Frontend estático
app.use(express.static(path.join(__dirname, 'frontend')));

// ------------------------------ AUTENTICACIÓN --------------------------------
// Tokens de sesión almacenados en memoria (simple, efectivo para app local)
const sesionesActivas = new Map(); // token → { usuario, nombre, rol, exp }

function crearToken() {
  return cryptoToken.randomBytes(32).toString('hex');
}

// ----------------------- INTENTOS FALLIDOS (anti fuerza bruta) -----------------
const intentosFallidos = new Map(); // usuario -> { count, lockUntil }
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000; // 15 minutos

// Login: POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  try {
    const { usuario, password, remember } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }
    // ¿Cuenta bloqueada temporalmente?
    const lock = intentosFallidos.get(usuario);
    if (lock && lock.lockUntil && Date.now() < lock.lockUntil) {
      const restante = Math.max(0, Math.ceil((lock.lockUntil - Date.now()) / 1000));
      return res.status(429).json({ error: `Demasiados intentos. Intenta de nuevo en ${restante}s`, bloqueo: true, retryAfter: restante });
    }
    const user = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(usuario);
    if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
      const actual = intentosFallidos.get(usuario) || { count: 0 };
      actual.count += 1;
      if (actual.count >= MAX_INTENTOS) {
        actual.count = 0;
        actual.lockUntil = Date.now() + BLOQUEO_MS;
        intentosFallidos.set(usuario, actual);
        return res.status(429).json({ error: 'Demasiados intentos fallidos. Cuenta bloqueada 15 min.', bloqueo: true, retryAfter: BLOQUEO_MS / 1000 });
      }
      intentosFallidos.set(usuario, actual);
      return res.status(401).json({ error: 'Credenciales inválidas', intentos: actual.count, max: MAX_INTENTOS });
    }
    // Éxito: limpiar intentos y crear sesión
    intentosFallidos.delete(usuario);
    const token = crearToken();
    const duracion = remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // 30 días o 24 h
    sesionesActivas.set(token, {
      usuario: user.usuario,
      nombre: user.nombre,
      rol: user.rol,
      exp: Date.now() + duracion
    });
    registrarLog('login', 'usuario', user.id, user.usuario, `Login exitoso desde sesión ${token.slice(0, 8)}...`);
    res.json({ ok: true, token, usuario: user.usuario, nombre: user.nombre, rol: user.rol, expiraEn: duracion });
  } catch (err) {
    console.error('[AUTH LOGIN]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Logout: POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token) sesionesActivas.delete(token);
  res.json({ ok: true });
});

// Cambiar contraseña (requiere sesión): cierra TODAS las sesiones del usuario
app.post('/api/auth/cambiar-password', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const sesion = sesionesActivas.get(token);
  if (!sesion) return res.status(401).json({ error: 'No autenticado' });
  const { actual, nueva } = req.body;
  if (!actual || !nueva || String(nueva).length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  const user = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(sesion.usuario);
  if (!user || !bcrypt.compareSync(actual, user.password_hash)) {
    return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
  }
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE usuario = ?').run(bcrypt.hashSync(nueva, 10), sesion.usuario);
  // Invalida todas las sesiones activas de este usuario (incluida la actual)
  for (const [t, s] of sesionesActivas) {
    if (s.usuario === sesion.usuario) sesionesActivas.delete(t);
  }
  res.json({ ok: true });
});

// Verificar sesión: GET /api/auth/me
app.get('/api/auth/me', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const sesion = sesionesActivas.get(token);
  if (!sesion || Date.now() > sesion.exp) {
    if (token) sesionesActivas.delete(token);
    return res.status(401).json({ error: 'Sesión expirada' });
  }
  res.json({ ok: true, usuario: sesion.usuario, nombre: sesion.nombre, rol: sesion.rol });
});

// Middleware de autenticación — protege todas las rutas /api/* excepto auth y públicas
function requireAuth(req, res, next) {
  // Rutas públicas que no requieren auth
  const rutasPublicas = ['/api/auth/login', '/api/auth/me', '/api/public/', '/public/'];
  if (rutasPublicas.some(r => req.path.startsWith(r))) return next();
  // El QR del link público de verificación es público (sin exponer datos de la rifa)
  if (/^\/api\/rifas\/\d+\/qr$/.test(req.path)) return next();
  // Archivos estáticos sin auth
  if (!req.path.startsWith('/api/')) return next();

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const sesion = sesionesActivas.get(token);
  if (!sesion || Date.now() > sesion.exp) {
    if (token) sesionesActivas.delete(token);
    return res.status(401).json({ error: 'No autenticado' });
  }
  req.usuario = sesion;
  next();
}
app.use(requireAuth);

// ----------------------- RBAC (control de acceso por rol) --------------------
// Jerarquía: super_admin > admin > vendedor
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción' });
    }
    next();
  };
}

// ----------------------- LIMPIEZA AUTOMÁTICA DE SESIONES ---------------------
setInterval(() => {
  const ahora = Date.now();
  for (const [token, sesion] of sesionesActivas) {
    if (ahora > sesion.exp) sesionesActivas.delete(token);
  }
}, 10 * 60 * 1000); // cada 10 minutos

// ========================= ADMINISTRACIÓN DE USUARIOS ========================

// Listar usuarios (admin+)
app.get('/api/usuarios', requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const usuarios = db.prepare('SELECT id, nombre, usuario, email, rol, created_at FROM usuarios ORDER BY id ASC').all();
    // Agregar info de sesiones activas
    const activos = new Set();
    for (const [, s] of sesionesActivas) { if (Date.now() <= s.exp) activos.add(s.usuario); }
    const resultado = usuarios.map(u => ({ ...u, sesionActiva: activos.has(u.usuario) }));
    res.json(resultado);
  } catch (err) {
    console.error('[USUARIOS LISTAR]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Crear usuario (admin+)
app.post('/api/usuarios', requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const { nombre, usuario, password, email, rol } = req.body;
    if (!nombre || !usuario || !password) {
      return res.status(400).json({ error: 'Nombre, usuario y contraseña son requeridos' });
    }
    // Solo super_admin puede crear otros super_admins
    const rolFinal = (rol === 'super_admin' && req.usuario.rol !== 'super_admin') ? 'admin' : (rol || 'vendedor');
    if (!['super_admin', 'admin', 'vendedor'].includes(rolFinal)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    const existente = db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get(usuario);
    if (existente) return res.status(409).json({ error: 'El usuario ya existe' });
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare('INSERT INTO usuarios (nombre, usuario, email, password_hash, rol) VALUES (?,?,?,?,?)')
      .run(nombre, usuario, email || null, hash, rolFinal);
    registrarLog('crear-usuario', 'usuario', info.lastInsertRowid, usuario, `Usuario "${usuario}" creado con rol ${rolFinal}`);
    res.status(201).json({ ok: true, id: info.lastInsertRowid, usuario, rol: rolFinal });
  } catch (err) {
    console.error('[USUARIOS CREAR]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Editar usuario (admin+; solo super_admin puede editar super_admins)
app.put('/api/usuarios/:id', requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const target = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    // Solo super_admin puede editar a otro super_admin
    if (target.rol === 'super_admin' && req.usuario.rol !== 'super_admin') {
      return res.status(403).json({ error: 'No puedes editar un super_admin' });
    }
    const { nombre, email, password } = req.body;
    if (nombre) db.prepare('UPDATE usuarios SET nombre = ? WHERE id = ?').run(nombre, target.id);
    if (email !== undefined) db.prepare('UPDATE usuarios SET email = ? WHERE id = ?').run(email || null, target.id);
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), target.id);
    }
    registrarLog('editar-usuario', 'usuario', target.id, target.usuario, `Usuario "${target.usuario}" actualizado`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[USUARIOS EDITAR]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Cambiar rol de usuario (solo super_admin)
app.put('/api/usuarios/:id/rol', requireRole('super_admin'), (req, res) => {
  try {
    const target = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.id === req.usuario.id) return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
    const { rol } = req.body;
    if (!['super_admin', 'admin', 'vendedor'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    db.prepare('UPDATE usuarios SET rol = ? WHERE id = ?').run(rol, target.id);
    registrarLog('cambiar-rol', 'usuario', target.id, target.usuario, `Rol cambiado de "${target.rol}" a "${rol}"`);
    // Cerrar sesiones del usuario si su rol bajó de permisos
    if (rol === 'vendedor') {
      for (const [token, s] of sesionesActivas) {
        if (s.usuario === target.usuario) sesionesActivas.delete(token);
      }
    }
    res.json({ ok: true, rol });
  } catch (err) {
    console.error('[USUARIOS ROL]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Eliminar usuario (solo super_admin; no puede eliminarse a sí mismo)
app.delete('/api/usuarios/:id', requireRole('super_admin'), (req, res) => {
  try {
    const target = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.id === req.usuario.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    if (target.rol === 'super_admin') return res.status(403).json({ error: 'No puedes eliminar un super_admin' });
    db.prepare('DELETE FROM usuarios WHERE id = ?').run(target.id);
    // Cerrar todas sus sesiones
    for (const [token, s] of sesionesActivas) {
      if (s.usuario === target.usuario) sesionesActivas.delete(token);
    }
    registrarLog('eliminar-usuario', 'usuario', target.id, target.usuario, `Usuario "${target.usuario}" eliminado`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[USUARIOS ELIMINAR]', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ========================= GESTIÓN DE SESIONES ================================

// Listar sesiones activas (admin+)
app.get('/api/sesiones', requireRole('super_admin', 'admin'), (req, res) => {
  const ahora = Date.now();
  const sesiones = [];
  for (const [token, s] of sesionesActivas) {
    if (ahora <= s.exp) {
      sesiones.push({
        token: token.slice(0, 8) + '...',
        usuario: s.usuario,
        nombre: s.nombre,
        rol: s.rol,
        expiraEn: new Date(s.exp).toISOString(),
        esActual: token === (req.headers.authorization || '').replace('Bearer ', '')
      });
    }
  }
  res.json(sesiones);
});

// Cerrar sesión remota (admin+; no puede cerrar su propia sesión)
app.delete('/api/sesiones/:tokenPrefix', requireRole('super_admin', 'admin'), (req, res) => {
  const prefix = req.params.tokenPrefix;
  const currentToken = (req.headers.authorization || '').replace('Bearer ', '');
  let cerrada = false;
  for (const [token, s] of sesionesActivas) {
    if (token.startsWith(prefix) && token !== currentToken) {
      registrarLog('cerrar-sesion-remota', 'sistema', null, s.usuario, `Sesión de "${s.usuario}" cerrada remotamente por ${req.usuario.usuario}`);
      sesionesActivas.delete(token);
      cerrada = true;
      break;
    }
  }
  if (!cerrada) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json({ ok: true });
});

// ------------------------------ MULTER (uploads) -----------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const nombre = `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, nombre);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB máx por imagen
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  }
});

// Multer para subida de backup .db (en memoria, 50MB máx)
const uploadDb = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(db|zip)$/i.test(file.originalname || '')) cb(null, true);
    else cb(new Error('Solo se permiten archivos .db o .zip'));
  }
});

// -------------------------------- HELPERS ------------------------------------

// Lectura de una rifa NO borrada (la papelera queda oculta del flujo normal).
function getRifa(id) {
  return db.prepare('SELECT * FROM rifas WHERE id = ? AND borrada_en IS NULL').get(id);
}

// Sanitización de entradas de participantes: recorta, limita y limpia caracteres.
// Todas las consultas usan parámetros (nunca se concatenan datos del usuario),
// por lo que la inyección SQL no es posible; estos límites protegen además de
// abusos (campos gigantes) y de datos malformados.
function limpiarTexto(v, max = 120) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}
function limpiarCedula(v) {
  return limpiarTexto(v, 20).replace(/\D/g, '');
}
function limpiarTelefono(v) {
  return limpiarTexto(v, 20).replace(/[^\d+]/g, '');
}

// Números de la boleta de un participante: para BOLETAS_NORMAL es [numero];
// para CUATRO_OPORTUNIDADES son los 4 números que le tocaron (almacenados en
// `participantes.numeros` como JSON). Para CHANCE_CON_SIMBOLO los elementos son
// etiquetas "38 😁" y se devuelven tal cual (no se convierten a número).
function numsBoleta(p) {
  if (p && p.numeros) {
    try {
      const arr = JSON.parse(p.numeros);
      if (Array.isArray(arr) && arr.length) {
        if (arr.every(v => Number.isFinite(Number(v)) && String(v).trim() !== '')) return arr.map(Number);
        return arr;
      }
    } catch (e) { /* seguir con p.numero */ }
  }
  return [Number(p && p.numero)];
}

// Formatea un número para mostrarlo con ceros a la izquierda según la modalidad:
//  - OPORTUNIDADES_4D: 4 dígitos (0000-9999)
//  - CHANCE_INDIVIDUAL con 4+ cifras: 4 dígitos
//  - Todas las demás: 2 dígitos (00-99)
function fmtNumero(rifa, n) {
  if (!rifa) return String(n);
  const m = rifa.modalidad_boleta;
  if (m === 'OPORTUNIDADES_4D') return String(n).padStart(4, '0');
  if (m === 'CHANCE_INDIVIDUAL' && Number(rifa.cifras || 4) >= 4) return String(n).padStart(4, '0');
  return String(n).padStart(2, '0');
}

// --------------------------- CHANCE CON SÍMBOLO --------------------------------
// La boleta es la combinación (número 00-99, símbolo). Un chance = 100 x símbolos.
function esChance(rifa) {
  return !!rifa && ['CHANCE_CON_SIMBOLO', 'CHANCE_3_GANADORES', 'CHANCE_INDIVIDUAL'].includes(rifa.modalidad_boleta);
}
function esChanceSimbolo(rifa) {
  return !!rifa && rifa.modalidad_boleta === 'CHANCE_CON_SIMBOLO';
}
function esChanceIndividual(rifa) {
  return !!rifa && rifa.modalidad_boleta === 'CHANCE_INDIVIDUAL';
}
// Chance de 4 cifras SIN símbolo (números 0000-9999) — solo CHANCE_INDIVIDUAL
function esChance4D(rifa) {
  return !!rifa && rifa.modalidad_boleta === 'CHANCE_INDIVIDUAL'
    && Number(rifa.cifras || 4) >= 4;
}
// Pad de un número de boleta chance según la modalidad (2 o 4 cifras)
function padChance(rifa, numero) {
  if (rifa.modalidad_boleta === 'CHANCE_3_GANADORES') return String(numero).padStart(2, '0');
  const d = esChance4D(rifa) ? 4 : 2;
  return String(numero).padStart(d, '0');
}

// Busca la boleta PAGADA ganadora de un premio, según la modalidad:
//  - CHANCE_3_GANADORES: boletas 00-99, se compara directo contra el grupo de 2 cifras del sorteo
//  - CHANCE_INDIVIDUAL: número exacto (2 o 4 dígitos), sin símbolo
//  - CHANCE_CON_SIMBOLO: (número 2 dígitos, símbolo) exacto
function buscarGanadorChance(rifa, p, simboloGanador) {
  const base = `SELECT bc.numero, bc.simbolo, p.nombre, p.telefono, p.cedula, p.id AS participante_id
    FROM boletas_chance bc JOIN participantes p ON p.id = bc.participante_id
    WHERE bc.rifa_id = ? AND p.estado_pago = 'pagado'`;
  if (rifa.modalidad_boleta === 'CHANCE_3_GANADORES') {
    const sub = String(p.numero).padStart(2, '0');
    return db.prepare(base + ` AND bc.simbolo = '' AND printf('%02d', bc.numero) = ?`).get(rifa.id, sub);
  }
  if (rifa.modalidad_boleta === 'CHANCE_INDIVIDUAL') {
    return db.prepare(base + ` AND bc.simbolo = '' AND bc.numero = ?`).get(rifa.id, p.numero);
  }
  return db.prepare(base + ` AND bc.numero = ? AND bc.simbolo = ?`).get(rifa.id, p.numero, simboloGanador);
}

// Cantidad de números que compra cada boleta en rifas de múltiples oportunidades
// (modalidad CUATRO_OPORTUNIDADES): 2, 4 o 5. Devuelve 0 si la rifa no es de
// este tipo. Las rifas creadas antes de esta opción usan 4 (valor por defecto).
function nOportunidades(rifa) {
  if (!rifa || rifa.modalidad_boleta !== 'CUATRO_OPORTUNIDADES') return 0;
  const n = Number(rifa.n_oportunidades) || 4;
  return [2, 4, 5].includes(n) ? n : 4;
}

const SIMBOLOS_DEFECTO = ['😁', '🥰', '😎', '🔥', '🍀', '⭐', '❤️', '💰', '🎯', '🏆'];

// Acepta un JSON array o un texto con separadores (espacio, coma, punto y coma)
function parsearSimbolos(raw) {
  let arr = null;
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try { arr = JSON.parse(raw); } catch (e) { arr = raw.split(/[\s,;]+/); }
  }
  if (Array.isArray(arr)) {
    const limpios = arr.map(s => String(s).trim().slice(0, 4)).filter(Boolean);
    if (limpios.length) return limpios.slice(0, 50);
  }
  return SIMBOLOS_DEFECTO.slice();
}

function simbolosRifa(rifa) {
  if (esChanceSimbolo(rifa)) {
    if (!rifa || !rifa.simbolos) return SIMBOLOS_DEFECTO.slice();
    try {
      const s = JSON.parse(rifa.simbolos);
      if (Array.isArray(s) && s.length) return s;
    } catch (e) { /* seguir con defecto */ }
    return SIMBOLOS_DEFECTO.slice();
  }
  // Modalidades sin símbolo: un solo "símbolo" vacío para reusar la misma tabla
  return [''];
}

function totalTicketsChance(rifa) {
  if (rifa.modalidad_boleta === 'CHANCE_3_GANADORES') return 100;
  if (rifa.modalidad_boleta === 'CHANCE_INDIVIDUAL') return Math.pow(10, Number(rifa.cifras || 4) >= 4 ? 4 : 2);
  return 100 * simbolosRifa(rifa).length;
}

// Etiqueta de boleta CHANCE: "47 😁" o "0047 😁" (según cifras)
function ticketLabel(numero, simbolo, rifa) {
  const padded = rifa ? fmtNumero(rifa, numero) : String(numero).padStart(2, '0');
  return padded + (simbolo ? ' ' + simbolo : '');
}

// Cifras que se sortean en un chance: 2 | 4 | 5. (2 es lo mínimo para un premio)
function normalizarCifras(v) {
  const n = Number(v);
  return [2, 4, 5].includes(n) ? n : 4;
}

// Premios del chance según las cifras: cada premio es un grupo de 2 cifras seguidas.
//   2 cifras -> 1 premio  (A: 1ª-2ª)
//   4 cifras -> 3 premios (A: 1ª-2ª, B: 2ª-3ª, C: 3ª-4ª)
//   5 cifras -> 4 premios (A: 1ª-2ª, B: 2ª-3ª, C: 3ª-4ª, D: 4ª-5ª)
// CHANCE_INDIVIDUAL: 1 premio que cubre TODAS las cifras (00-99 o 0000-9999).
// CHANCE_3_GANADORES: forzado a 4 cifras -> 3 premios.
function configPremiosChance(rifa, cifrasN) {
  const nombres = {
    A: rifa.premio1_nombre || 'Premio 1',
    B: rifa.premio2_nombre || 'Premio 2',
    C: rifa.premio3_nombre || 'Premio 3',
    D: rifa.premio4_nombre || 'Premio 4'
  };
  let posiciones;
  if (rifa.modalidad_boleta === 'CHANCE_INDIVIDUAL') {
    posiciones = { A: [0, cifrasN] };
  } else if (cifrasN === 2) {
    posiciones = { A: [0, 2] };
  } else if (cifrasN === 5) {
    posiciones = { A: [0, 2], B: [1, 3], C: [2, 4], D: [3, 5] };
  } else {
    posiciones = { A: [0, 2], B: [1, 3], C: [2, 4] };
  }
  return { nombres, posiciones };
}

// Pre-genera las boletas de un chance según la modalidad:
//  - CHANCE_CON_SIMBOLO: 100 números (00-99) x N símbolos
//  - CHANCE_3_GANADORES: 100 números 00-99 (sin símbolo) — se sortean 4 cifras y se dividen en 3 grupos de 2
//  - CHANCE_INDIVIDUAL: 100 (00-99) o 10.000 (0000-9999) sin símbolo
function generarBoletasChance(rifa) {
  const insert = db.prepare('INSERT OR IGNORE INTO boletas_chance (rifa_id, numero, simbolo) VALUES (?,?,?)');
  const tx = db.transaction((r) => {
    if (r.modalidad_boleta === 'CHANCE_3_GANADORES') {
      for (let n = 0; n <= 99; n++) insert.run(r.id, n, '');
    } else if (r.modalidad_boleta === 'CHANCE_INDIVIDUAL') {
      const max = Number(r.cifras || 4) >= 4 ? 9999 : 99;
      for (let n = 0; n <= max; n++) insert.run(r.id, n, '');
    } else {
      const sims = simbolosRifa(r);
      for (const s of sims) for (let n = 0; n <= 99; n++) insert.run(r.id, n, s);
    }
  });
  tx(rifa);
}

// Baraja un arreglo (Fisher-Yates) para asignación AL_AZAR
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Genera los grupos de números 00-99 para rifas de múltiples oportunidades:
// boletas de n números (2, 4 o 5), totalmente aleatorios, sin repetir números
// entre grupos y SIN números muy seguidos dentro de un mismo grupo. El espacio
// 00-99 se divide en n bloques y cada grupo toma un número de cada bloque,
// garantizando que los números de una boleta queden repartidos.
function generarGruposMultiples(n) {
  const k = 100 / n; // cantidad de grupos (boletas)
  const bloques = [];
  for (let b = 0; b < n; b++) {
    const ini = b * k;
    bloques.push(shuffle(Array.from({ length: k }, (_, i) => ini + i)));
  }
  const grupos = [];
  for (let i = 0; i < k; i++) {
    let ok = false, cand = [];
    for (let intento = 0; intento < 300 && !ok; intento++) {
      const idx = bloques.map(q => Math.floor(Math.random() * q.length));
      cand = idx.map((ix, qi) => bloques[qi][ix]);
      const s = [...cand].sort((a, b) => a - b);
      ok = s.every((v, j) => j === 0 || v - s[j - 1] >= 2);
      if (ok) idx.forEach((ix, qi) => bloques[qi].splice(ix, 1));
    }
    if (!ok) { // respaldo: tomar los primeros disponibles
      cand = bloques.map(q => q.shift());
    }
    grupos.push(cand.sort((a, b) => a - b));
  }
  return grupos;
}

// Genera grupos aleatorios de 4 números para OPORTUNIDADES_4D (0000-9999).
// Cada boleta compra 4 números al azar sin repetir. Total: 2500 boletas.
function generarGrupos4D() {
  const total = 10000;
  const n = 4;
  const k = total / n;
  const todos = Array.from({ length: total }, (_, i) => i);
  for (let i = todos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [todos[i], todos[j]] = [todos[j], todos[i]];
  }
  const grupos = [];
  for (let i = 0; i < k; i++) {
    grupos.push(todos.slice(i * n, (i + 1) * n).sort((a, b) => a - b));
  }
  return grupos;
}

// Devuelve los grupos de la rifa; si no existen (rifa de múltiples oportunidades
// creada antes de esta versión) los genera con la cantidad de números indicada
// en n_oportunidades y los guarda en la base de datos.
// Para OPORTUNIDADES_4D genera grupos de 4 números desde 0000-9999.
function asegurarGrupos(rifa) {
  if (rifa.modalidad_boleta === 'OPORTUNIDADES_4D') {
    let grupos = [];
    if (rifa.grupos_numeros) {
      try { grupos = JSON.parse(rifa.grupos_numeros); } catch (e) { grupos = []; }
    }
    if (!Array.isArray(grupos) || grupos.length === 0) {
      grupos = generarGrupos4D();
      db.prepare('UPDATE rifas SET grupos_numeros = ? WHERE id = ?').run(JSON.stringify(grupos), rifa.id);
      rifa.grupos_numeros = JSON.stringify(grupos);
    }
    return grupos;
  }
  const n = nOportunidades(rifa);
  if (!n) return [];
  let grupos = [];
  if (rifa.grupos_numeros) {
    try { grupos = JSON.parse(rifa.grupos_numeros); } catch (e) { grupos = []; }
  }
  if (!Array.isArray(grupos) || grupos.length === 0) {
    grupos = generarGruposMultiples(n);
    db.prepare('UPDATE rifas SET grupos_numeros = ? WHERE id = ?').run(JSON.stringify(grupos), rifa.id);
    rifa.grupos_numeros = JSON.stringify(grupos);
  }
  return grupos;
}

// Estado de un grupo de 4 Oportunidades. Un grupo cuenta como vendido
// SOLO cuando sus 4 números están ocupados por el MISMO participante:
//   libre     -> los 4 números están libres
//   pagado/pendiente -> los 4 números pertenecen a una misma boleta
//   ocupado   -> números ocupados de forma parcial o por varias boletas
//                (datos antiguos / registros previos a los grupos)
function estadoGrupo(rifa, grupo) {
  const filas = db.prepare(`SELECT n.numero, n.estado, n.participante_id, p.nombre, p.estado_pago
    FROM numeros n LEFT JOIN participantes p ON p.id = n.participante_id
    WHERE n.rifa_id = ? AND n.numero IN (` + grupo.map(() => '?').join(',') + `)`).all(rifa.id, ...grupo);
  const ocupados = filas.filter(f => f.participante_id != null);
  if (ocupados.length === 0) return { estado: 'libre', nombre: '' };
  if (ocupados.length === filas.length && new Set(ocupados.map(f => f.participante_id)).size === 1) {
    const f = ocupados[0];
    return { estado: f.estado_pago === 'pagado' ? 'pagado' : 'pendiente', nombre: f.nombre || '' };
  }
  return { estado: 'ocupado', nombre: ocupados[0].nombre || '' };
}

// Registra una fila en el historial de la rifa (auditoría / transparencia)
function registrarHistorial(rifaId, accion, detalle = '') {
  db.prepare('INSERT INTO historial (rifa_id, accion, detalle) VALUES (?,?,?)')
    .run(rifaId, accion, detalle);
  // Espejo en el log global de auditoría (conserva el nombre de la rifa aunque se purgue)
  const rifa = db.prepare('SELECT nombre FROM rifas WHERE id = ?').get(rifaId);
  db.prepare('INSERT INTO logs (accion, entidad, rifa_id, rifa_nombre, detalle) VALUES (?,?,?,?,?)')
    .run(accion, 'rifa', rifaId, rifa ? rifa.nombre : null, detalle);
}

// Registro directo en el log global (sin rifa, o antes de purgar una rifa)
function registrarLog(accion, entidad, rifaId, rifaNombre, detalle = '') {
  db.prepare('INSERT INTO logs (accion, entidad, rifa_id, rifa_nombre, detalle) VALUES (?,?,?,?,?)')
    .run(accion, entidad, rifaId || null, rifaNombre || null, detalle);
}

// Registro de auditoría de sorteos — trazabilidad completa de cada sorteo ejecutado
function registrarSorteoAuditoria(rifaId, rifaNombre, modalidad, ejecutadoPor, semilla, ganadores, datosCompletos) {
  const crypto = require('crypto');
  const hashInput = `${rifaId}-${semilla}-${JSON.stringify(ganadores)}-${Date.now()}`;
  const hashResultado = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
  db.prepare(`INSERT INTO sorteos_auditoria (rifa_id, rifa_nombre, modalidad, ejecutado_por, semilla, hash_resultado, ganadores, datos_completos)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(rifaId, rifaNombre, modalidad, ejecutadoPor, semilla, hashResultado, JSON.stringify(ganadores), JSON.stringify(datosCompletos));
}

// Libera automáticamente los números en estado "pendiente" que llevan más
// horas de las configuradas en auto_liberar_horas sin haberse marcado como
// pagados. Se llama antes de cada operación relevante para mantener todo
// consistente sin necesidad de un cron externo.
function liberarVencidos(rifaId) {
  const rifa = db.prepare('SELECT * FROM rifas WHERE id = ?').get(rifaId);
  if (!rifa || !rifa.auto_liberar_horas) return 0;

  const limite = db.prepare("SELECT datetime('now', '-' || ? || ' hours', 'localtime') AS fecha").get(rifa.auto_liberar_horas).fecha;

  const vencidos = db.prepare(`
    SELECT p.id as participante_id, p.numero
    FROM participantes p
    WHERE p.rifa_id = ? AND p.estado_pago = 'pendiente' AND p.fecha_registro < ?
  `).all(rifaId, limite);

  const liberar = db.transaction((filas) => {
    for (const f of filas) {
      db.prepare('UPDATE numeros SET estado = ?, participante_id = NULL, fecha_reservado = NULL WHERE participante_id = ?')
        .run('libre', f.participante_id);
      db.prepare("UPDATE boletas_chance SET estado = 'libre', participante_id = NULL, fecha_reservado = NULL WHERE participante_id = ?")
        .run(f.participante_id);
      db.prepare('DELETE FROM participantes WHERE id = ?').run(f.participante_id);
      registrarHistorial(rifaId, 'auto-liberacion', `Boleta de ${fmtNumero(rifa, f.numero) || f.participante_id} liberada por vencimiento de pago`);
    }
  });
  if (vencidos.length) liberar(vencidos);
  return vencidos.length;
}

// Calcula los KPI principales de una rifa
function calcularDashboard(rifaId, rifaCache) {
  const rifa = rifaCache || db.prepare('SELECT * FROM rifas WHERE id = ?').get(rifaId);
  if (!rifa) return null;
  const totalNumeros = esChance(rifa)
    ? totalTicketsChance(rifa)
    : (rifa.rango_max - rifa.rango_min + 1);
  const stats = db.prepare("SELECT SUM(CASE WHEN estado_pago='pagado' THEN 1 ELSE 0 END) as pagados, SUM(CASE WHEN estado_pago='pendiente' THEN 1 ELSE 0 END) as pendientes FROM participantes WHERE rifa_id = ?").get(rifaId);
  const pagados = stats.pagados || 0;
  const pendientes = stats.pendientes || 0;
  const vendidos = pagados + pendientes;
  const recaudado = pagados * rifa.valor_boleta;
  const potencial = rifa.cantidad_max_participantes * rifa.valor_boleta;
  const porcentaje = rifa.cantidad_max_participantes > 0
    ? Math.min(100, Math.round((vendidos / rifa.cantidad_max_participantes) * 100))
    : 0;
  let quedan;
  if (rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES') {
    const grupos = asegurarGrupos(rifa);
    quedan = grupos.filter(g => estadoGrupo(rifa, g).estado === 'libre').length;
  } else {
    quedan = Math.max(0, rifa.cantidad_max_participantes - vendidos);
  }
  return { rifa, totalNumeros, pagados, pendientes, vendidos, recaudado, potencial, porcentaje, quedan };
}

// -------------------------------- EMPRESA -------------------------------------

app.get('/api/empresa', (req, res) => {
  try { res.json(db.prepare('SELECT * FROM empresa WHERE id = 1').get()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Changelog / historial de versiones
app.get('/api/changelog', (req, res) => {
  const changelog = [
    {
      version: '2.1.0', fecha: '23 de agosto de 2026',
      categorias: [
        { nombre: 'UI/UX — Responsive completo', icono: '📱', items: [
          'CSS responsive con 4 breakpoints (860px, 600px, 520px, 400px)',
          'Sidebar hamburger siempre visible: colapsa en desktop, off-canvas en móvil',
          'Tablas con scroll horizontal en admin y sesiones',
          'Formularios apilados en móvil',
          'Botones con flex-wrap para evitar desbordamiento',
          'Login screen responsive',
          'Modales siempre dentro de pantalla',
          'Touch targets mínimos de 44px en móvil',
          'KPI grid, quick actions y rifas grid responsivos',
          'Sidebar texto con ellipsis y tooltips'
        ]},
        { nombre: 'Backend — Auditoría de sorteos', icono: '🔍', items: [
          'Tabla sorteos_auditoria con trazabilidad completa',
          'Función registrarSorteoAuditoria() en los 3 endpoints de sorteo',
          'API de auditoría por rifa y global (admin+)'
        ]},
        { nombre: 'Backend — Modalidad 50/50', icono: '💰', items: [
          'Columnas modalidad_premio y porcentaje_organizador',
          'Toggle en formulario de creación/edición',
          'Display en resumen y reporte PDF'
        ]},
        { nombre: 'Frontend — Exportar PDF', icono: '📋', items: [
          'Reporte completo: datos, ganadores, pagados, pendientes',
          'Botón PDF en vista de detalle de rifa',
          'Incluye info de modalidad 50/50'
        ]},
        { nombre: 'Frontend — CAPTCHA matemático', icono: '🧮', items: [
          'CAPTCHA en login (+, -, ×)',
          'Se regenera tras cada intento fallido',
          'Animación shake en respuesta incorrecta'
        ]},
        { nombre: 'Backend — Video balotera', icono: '🎥', items: [
          'BaloteraCanvas: métodos iniciarGrabacion() y detenerGrabacion()'
        ]},
        { nombre: 'Administración de usuarios', icono: '👥', items: [
          'RBAC con jerarquía super_admin > admin > vendedor',
          'CRUD completo de usuarios',
          'Panel de sesiones activas',
          'Limpieza automática de sesiones expiradas'
        ]}
      ]
    },
    {
      version: '2.0.0', fecha: 'Versión inicial',
      categorias: [
        { nombre: 'Funcionalidades base', icono: '🎯', items: [
          '6 modalidades de rifa (BOLETAS_NORMAL, CUATRO_OPORTUNIDADES, CHANCE_CON_SIMBOLO, CHANCE_3_GANADORES, CHANCE_INDIVIDUAL, OPORTUNIDADES_4D)',
          'Venta de boletas al azar o a elección del cliente',
          'Generador de posters con QR (1080×1080, historia y poster 2160×2160)',
          'Balotera virtual animada (canvas)',
          'Ruleta animada con grabación de video',
          'Revancha para todas las modalidades',
          'WhatsApp masivo personalizado',
          'Notificaciones push y PWA instalable',
          'Importación/exportación por Excel',
          'Autenticación con roles',
          'Base de datos SQLite con migraciones automáticas',
          'Dashboard con estadísticas y gráficas',
          'Plantillas de WhatsApp editables',
          'Página pública de verificación con QR'
        ]}
      ]
    }
  ];
  res.json({ versionActual: '2.1.0', changelog });
});

app.put('/api/empresa', upload.single('logo'), (req, res) => {
  try {
    const { nombre_empresa, telefono, color_marca } = req.body;
    const actual = db.prepare('SELECT * FROM empresa WHERE id = 1').get();
    const logo_path = req.file ? `/uploads/${req.file.filename}` : actual.logo_path;
    db.prepare('UPDATE empresa SET nombre_empresa=?, telefono=?, color_marca=?, logo_path=? WHERE id=1')
      .run(nombre_empresa || actual.nombre_empresa, telefono || actual.telefono,
           color_marca || actual.color_marca, logo_path);
    res.json(db.prepare('SELECT * FROM empresa WHERE id = 1').get());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ----------------------- PUSH SUBSCRIPTIONS -----------------------------------
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: storedVapid.publicKey });
});

app.post('/api/push/subscribe', (req, res) => {
  try {
    const { endpoint, p256dh, auth } = req.body;
    if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: 'Datos incompletos' });
    db.prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, activa) VALUES (?, ?, ?, 1)")
      .run(endpoint, p256dh, auth);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/push/unsubscribe', (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) db.prepare("UPDATE push_subscriptions SET activa = 0 WHERE endpoint = ?").run(endpoint);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/push/test', (req, res) => {
  try {
    enviarPush('Rifas SYC', 'Notificaciones funcionando correctamente');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ----------------------- DASHBOARD STATS --------------------------------------
app.get('/api/stats', (req, res) => {
  try {
    const totalRifas = db.prepare("SELECT COUNT(*) c FROM rifas WHERE borrada_en IS NULL").get().c;
    const rifasActivas = db.prepare("SELECT COUNT(*) c FROM rifas WHERE borrada_en IS NULL AND estado = 'activa'").get().c;
    const rifasSorteadas = db.prepare("SELECT COUNT(*) c FROM rifas WHERE borrada_en IS NULL AND estado = 'sorteada'").get().c;
    const totalParticipantes = db.prepare("SELECT COUNT(*) c FROM participantes").get().c;
    const pagados = db.prepare("SELECT COUNT(*) c FROM participantes WHERE estado_pago = 'pagado'").get().c;
    const pendientes = db.prepare("SELECT COUNT(*) c FROM participantes WHERE estado_pago = 'pendiente'").get().c;
    const recaudado = db.prepare("SELECT COALESCE(SUM(p.valor_boleta), 0) total FROM participantes part JOIN rifas p ON part.rifa_id = p.id WHERE part.estado_pago = 'pagado'").get().total;

    // Recaudado por día (últimos 30 días)
    const porDia = db.prepare(`
      SELECT date(part.fecha_registro) as fecha, COUNT(*) as ventas,
             SUM(r.valor_boleta) as recaudado
      FROM participantes part
      JOIN rifas r ON part.rifa_id = r.id
      WHERE part.estado_pago = 'pagado'
        AND part.fecha_registro >= date('now', '-30 days')
      GROUP BY date(part.fecha_registro)
      ORDER BY fecha ASC
    `).all();

    // Top rifas por recaudado
    const topRifas = db.prepare(`
      SELECT r.nombre, COUNT(part.id) as vendidos,
             SUM(CASE WHEN part.estado_pago='pagado' THEN r.valor_boleta ELSE 0 END) as recaudado
      FROM rifas r
      LEFT JOIN participantes part ON r.id = part.rifa_id
      WHERE r.borrada_en IS NULL
      GROUP BY r.id
      ORDER BY recaudado DESC
      LIMIT 5
    `).all();

    res.json({ totalRifas, rifasActivas, rifasSorteadas, totalParticipantes, pagados, pendientes, recaudado, porDia, topRifas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ----------------------------- ADMIN DASHBOARD ---------------------------------

app.get('/api/admin/dashboard', requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const empresa = db.prepare('SELECT * FROM empresa WHERE id = 1').get();

    const totalRifas = db.prepare("SELECT COUNT(*) c FROM rifas WHERE borrada_en IS NULL").get().c;
    const rifasActivas = db.prepare("SELECT COUNT(*) c FROM rifas WHERE borrada_en IS NULL AND estado = 'activa'").get().c;
    const rifasSorteadas = db.prepare("SELECT COUNT(*) c FROM rifas WHERE borrada_en IS NULL AND estado = 'sorteada'").get().c;
    const totalParticipantes = db.prepare("SELECT COUNT(*) c FROM participantes").get().c;
    const pagados = db.prepare("SELECT COUNT(*) c FROM participantes WHERE estado_pago = 'pagado'").get().c;
    const pendientes = db.prepare("SELECT COUNT(*) c FROM participantes WHERE estado_pago = 'pendiente'").get().c;
    const recaudado = db.prepare("SELECT COALESCE(SUM(p.valor_boleta), 0) total FROM participantes part JOIN rifas p ON part.rifa_id = p.id WHERE part.estado_pago = 'pagado'").get().total;

    const rifas = db.prepare(`
      SELECT r.id, r.nombre, r.producto, r.estado, r.valor_boleta, r.modalidad_boleta,
             r.fecha_sorteo, r.cantidad_max_participantes,
             COUNT(part.id) as vendidos,
             SUM(CASE WHEN part.estado_pago='pagado' THEN 1 ELSE 0 END) as pagados,
             SUM(CASE WHEN part.estado_pago='pendiente' THEN 1 ELSE 0 END) as pendientes
      FROM rifas r
      LEFT JOIN participantes part ON r.id = part.rifa_id
      WHERE r.borrada_en IS NULL
      GROUP BY r.id
      ORDER BY r.estado = 'activa' DESC, r.fecha_sorteo ASC
    `).all();

    const participantesRecientes = db.prepare(`
      SELECT part.id, part.nombre, part.cedula, part.telefono, part.estado_pago,
             part.fecha_registro, r.nombre as rifa_nombre
      FROM participantes part
      JOIN rifas r ON part.rifa_id = r.id
      ORDER BY part.fecha_registro DESC
      LIMIT 15
    `).all();

    const usuarios = db.prepare("SELECT id, usuario, nombre, email, rol FROM usuarios ORDER BY nombre").all();
    const sesionesActivasCount = db.prepare("SELECT COUNT(*) c FROM push_subscriptions WHERE activa = 1").get().c;
    const logsRecientes = db.prepare(`
      SELECT id, fecha, accion, entidad, rifa_nombre, detalle
      FROM logs ORDER BY fecha DESC LIMIT 8
    `).all();

    res.json({ empresa, totalRifas, rifasActivas, rifasSorteadas, totalParticipantes, pagados, pendientes, recaudado, rifas, participantesRecientes, usuarios, sesionesActivasCount, logsRecientes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// -------------------------------- RIFAS ----------------------------------------

// Crear rifa (con imágenes)
app.post('/api/rifas', upload.fields([{ name: 'imagen_producto' }, { name: 'banner_empresa' }]), (req, res) => {
  try {
    const b = req.body;
    let rango_min = parseInt(b.rango_min || 0, 10);
    let rango_max = parseInt(b.rango_max, 10);
    let cantidad_max_participantes = parseInt(b.cantidad_max_participantes, 10);
    const chance = esChance(b);
    const simbolos = chance ? parsearSimbolos(b.simbolos) : null;
    const esMultiples = b.modalidad_boleta === 'CUATRO_OPORTUNIDADES';
    const nOport = esMultiples ? (Number(b.n_oportunidades) || 4) : 0;
    if (esMultiples && ![2, 4, 5].includes(nOport)) return res.status(400).json({ error: 'La cantidad de oportunidades debe ser 2, 4 o 5' });

    // Cada modalidad fija su propio espacio de números:
    // - CHANCE_CON_SIMBOLO: 100 números × N símbolos
    // - CHANCE_3_GANADORES: 100 boletas 00-99 (sorteo 4 cifras → 3 premios de 2)
    // - CHANCE_INDIVIDUAL: 100 (2 cifras) o 10.000 (4 cifras) sin símbolo
    // - OPORTUNIDADES_4D: 10.000 números 0000-9999, cada boleta compra 4 al azar
    // - CUATRO_OPORTUNIDADES: 100 números, cada boleta compra 2/4/5
    if (chance) {
      rango_min = 0;
      if (b.modalidad_boleta === 'CHANCE_3_GANADORES') {
        cantidad_max_participantes = 100;
        rango_max = 99;
      } else if (b.modalidad_boleta === 'CHANCE_INDIVIDUAL') {
        const cifrasI = Number(b.cifras || 4);
        cantidad_max_participantes = Math.pow(10, cifrasI);
        rango_max = Math.pow(10, cifrasI) - 1;
      } else {
        cantidad_max_participantes = 100 * simbolos.length;
        rango_max = 99;
      }
    } else if (b.modalidad_boleta === 'OPORTUNIDADES_4D') {
      cantidad_max_participantes = 10000;
      rango_min = 0;
      rango_max = 9999;
    } else if (esMultiples) {
      cantidad_max_participantes = 100 / nOport;
      rango_min = 0;
      rango_max = 99;
    }

    if (!b.nombre || !b.valor_boleta || !b.producto || !b.fecha_sorteo || isNaN(rango_max)) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: nombre, valor_boleta, producto, fecha_sorteo, rango_numeros' });
    }
    if (!chance && !esMultiples && (rango_max - rango_min + 1) < cantidad_max_participantes) {
      return res.status(400).json({ error: 'El rango de números es menor a la cantidad máxima de participantes' });
    }

    const imagen_producto = req.files?.imagen_producto?.[0] ? `/uploads/${req.files.imagen_producto[0].filename}` : null;
    const banner_empresa = req.files?.banner_empresa?.[0] ? `/uploads/${req.files.banner_empresa[0].filename}` : null;

    const info = db.prepare(`
      INSERT INTO rifas (nombre, valor_boleta, producto, descripcion, fecha_sorteo, hora_sorteo, imagen_producto,
        banner_empresa, cantidad_max_participantes, rango_min, rango_max, tipo_rifa, mensaje_whatsapp,
        estado, auto_liberar_horas, modalidad_boleta, modo_asignacion, simbolos, premio1_nombre,
        premio2_nombre, premio3_nombre, premio4_nombre, cifras, revancha_permitida, n_oportunidades,
        modalidad_premio, porcentaje_organizador)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      b.nombre, parseInt(b.valor_boleta, 10), b.producto, b.descripcion || '', b.fecha_sorteo,
      b.hora_sorteo || null, imagen_producto, banner_empresa, cantidad_max_participantes, rango_min, rango_max,
      b.tipo_rifa || 'aleatoria', b.mensaje_whatsapp || '', b.estado || 'borrador',
      parseInt(b.auto_liberar_horas || 24, 10),
      b.modalidad_boleta || 'BOLETAS_NORMAL', b.modo_asignacion || 'AL_AZAR',
      chance ? JSON.stringify(simbolos) : null,
      b.premio1_nombre || 'Premio 1',       b.premio2_nombre || 'Premio 2', b.premio3_nombre || 'Premio 3',
      b.premio4_nombre || 'Premio 4', normalizarCifras(b.cifras),
      b.revancha_permitida ? 1 : 0,
      esMultiples ? nOport : null,
      b.modalidad_premio || 'completo', parseInt(b.porcentaje_organizador || 0, 10)
    );

    const rifaId = info.lastInsertRowid;

    if (chance) {
      // Pre-generar las boletas del chance según la modalidad
      generarBoletasChance(getRifa(rifaId));
    } else if (b.modalidad_boleta === 'OPORTUNIDADES_4D') {
      // Generar 10.000 números 0000-9999
      const insertNumero = db.prepare('INSERT INTO numeros (rifa_id, numero, estado) VALUES (?,?,\'libre\')');
      const insertMany = db.transaction(() => {
        for (let n = 0; n <= 9999; n++) insertNumero.run(rifaId, n);
      });
      insertMany();
      // Generar grupos de 4 números al azar
      const rifaNueva = getRifa(rifaId);
      asegurarGrupos(rifaNueva);
    } else {
      // Pre-generar todos los números del rango como "libre"
      const insertNumero = db.prepare('INSERT INTO numeros (rifa_id, numero, estado) VALUES (?,?,\'libre\')');
      const insertMany = db.transaction((min, max) => {
        for (let n = min; n <= max; n++) insertNumero.run(rifaId, n);
      });
      insertMany(rango_min, rango_max);
    }

    // Múltiples oportunidades: generar los grupos aleatorios de 00-99 (2, 4 o 5
    // números por boleta, según n_oportunidades)
    const rifaNueva = getRifa(rifaId);
    if (nOportunidades(rifaNueva)) {
      asegurarGrupos(rifaNueva);
    }

    registrarHistorial(rifaId, 'creacion', `Rifa "${b.nombre}" creada en estado ${b.estado || 'borrador'}`);
    res.status(201).json(getRifa(rifaId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Listar rifas con KPI resumidos
app.get('/api/rifas', (req, res) => {
  const rifas = db.prepare('SELECT * FROM rifas WHERE borrada_en IS NULL ORDER BY created_at DESC').all();
  const conKpi = rifas.map(r => {
    const d = calcularDashboard(r.id, r);
    return { ...r, vendidos: d.vendidos, pagados: d.pagados, pendientes: d.pendientes,
      recaudado: d.recaudado, porcentaje: d.porcentaje, quedan: d.quedan };
  });
  res.json(conKpi);
});

// Categorías únicas de todas las rifas
app.get('/api/categorias', (req, res) => {
  try {
    const cats = db.prepare("SELECT DISTINCT categoria FROM rifas WHERE borrada_en IS NULL AND categoria != '' ORDER BY categoria ASC").all();
    res.json(cats.map(c => c.categoria));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Asignar/mover una rifa a una categoría
app.put('/api/rifas/:id/categoria', (req, res) => {
  const rifa = getRifa(req.params.id);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
  const categoria = limpiarTexto(req.body.categoria || '', 60);
  db.prepare('UPDATE rifas SET categoria = ? WHERE id = ?').run(categoria, req.params.id);
  res.json({ ok: true, categoria });
});

// Detalle de una rifa
app.get('/api/rifas/:id', (req, res) => {
  liberarVencidos(req.params.id);
  const rifa = getRifa(req.params.id);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
  res.json(rifa);
});

// Dashboard / KPIs
app.get('/api/rifas/:id/dashboard', (req, res) => {
  liberarVencidos(req.params.id);
  const d = calcularDashboard(req.params.id);
  if (!d) return res.status(404).json({ error: 'Rifa no encontrada' });
  res.json(d);
});

// Editar rifa / cambiar estado
app.put('/api/rifas/:id', upload.fields([{ name: 'imagen_producto' }, { name: 'banner_empresa' }]), (req, res) => {
  const rifa = getRifa(req.params.id);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
  const b = req.body;
  const imagen_producto = req.files?.imagen_producto?.[0] ? `/uploads/${req.files.imagen_producto[0].filename}` : rifa.imagen_producto;
  const banner_empresa = req.files?.banner_empresa?.[0] ? `/uploads/${req.files.banner_empresa[0].filename}` : rifa.banner_empresa;

  db.prepare(`UPDATE rifas SET nombre=?, valor_boleta=?, producto=?, descripcion=?, fecha_sorteo=?, hora_sorteo=?,
      imagen_producto=?, banner_empresa=?, tipo_rifa=?, mensaje_whatsapp=?, estado=?, auto_liberar_horas=?,
      modalidad_boleta=?, modo_asignacion=?, simbolos=?, premio1_nombre=?, premio2_nombre=?, premio3_nombre=?, premio4_nombre=?, cifras=?, revancha_permitida=?,
      rango_min=?, rango_max=?, cantidad_max_participantes=?, modalidad_premio=?, porcentaje_organizador=?
      WHERE id=?`).run(
    b.nombre ?? rifa.nombre, b.valor_boleta ?? rifa.valor_boleta, b.producto ?? rifa.producto,
    b.descripcion ?? rifa.descripcion, b.fecha_sorteo ?? rifa.fecha_sorteo, b.hora_sorteo ?? rifa.hora_sorteo,
    imagen_producto, banner_empresa,
    b.tipo_rifa ?? rifa.tipo_rifa, b.mensaje_whatsapp ?? rifa.mensaje_whatsapp, b.estado ?? rifa.estado,
    b.auto_liberar_horas ?? rifa.auto_liberar_horas,
    b.modalidad_boleta ?? rifa.modalidad_boleta, b.modo_asignacion ?? rifa.modo_asignacion,
    (b.simbolos !== undefined ? JSON.stringify(parsearSimbolos(b.simbolos)) : rifa.simbolos),
    b.premio1_nombre ?? rifa.premio1_nombre ?? 'Premio 1',
    b.premio2_nombre ?? rifa.premio2_nombre ?? 'Premio 2',
    b.premio3_nombre ?? rifa.premio3_nombre ?? 'Premio 3',
    b.premio4_nombre ?? rifa.premio4_nombre ?? 'Premio 4',
    (b.cifras !== undefined ? normalizarCifras(b.cifras) : normalizarCifras(rifa.cifras)),
    (b.revancha_permitida !== undefined ? (b.revancha_permitida ? 1 : 0) : rifa.revancha_permitida),
    b.rango_min ?? rifa.rango_min,
    b.rango_max ?? rifa.rango_max,
    b.cantidad_max_participantes ?? rifa.cantidad_max_participantes,
    b.modalidad_premio ?? rifa.modalidad_premio ?? 'completo',
    b.porcentaje_organizador ?? rifa.porcentaje_organizador ?? 0,
    req.params.id
  );
  if (b.estado && b.estado !== rifa.estado) registrarHistorial(req.params.id, 'cambio-estado', `${rifa.estado} -> ${b.estado}`);
  const camposConfig = ['nombre', 'valor_boleta', 'producto', 'descripcion', 'fecha_sorteo', 'hora_sorteo', 'tipo_rifa', 'mensaje_whatsapp', 'auto_liberar_horas', 'simbolos', 'premio1_nombre', 'premio2_nombre', 'premio3_nombre', 'premio4_nombre', 'cifras', 'revancha_permitida', 'modo_asignacion'];
  const cambiados = camposConfig.filter(c => b[c] !== undefined && String(b[c]) !== String(rifa[c]));
  if (cambiados.length) registrarHistorial(req.params.id, 'config', `Configuración actualizada: ${cambiados.join(', ')}`);
  const rifaEditada = getRifa(req.params.id);
  // Si se convierte a CHANCE sin boletas pre-generadas, generarlas
  if (esChance(rifaEditada)) {
    const cuantas = db.prepare('SELECT COUNT(*) c FROM boletas_chance WHERE rifa_id = ?').get(req.params.id).c;
    if (cuantas === 0) generarBoletasChance(rifaEditada);
  }
  if (nOportunidades(rifaEditada)) {
    const grupos = asegurarGrupos(rifaEditada);
    // Si se cambió la modalidad, la anterior (A_ELECCION/AL_AZAR) pierde validez
    if (nOportunidades(rifa) === 0 && grupos.length) {
      registrarHistorial(req.params.id, 'config', 'Grupos de múltiples oportunidades generados');
    }
  }
  res.json(rifaEditada);
});

// Clonar rifa (duplicar configuración, sin participantes)
app.post('/api/rifas/:id/clonar', (req, res) => {
  const rifa = getRifa(req.params.id);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
  const chance = esChance(rifa);

  const info = db.prepare(`
    INSERT INTO rifas (nombre, valor_boleta, producto, descripcion, fecha_sorteo, hora_sorteo, imagen_producto,
      banner_empresa, cantidad_max_participantes, rango_min, rango_max, tipo_rifa, mensaje_whatsapp,
      estado, auto_liberar_horas, modalidad_boleta, modo_asignacion, grupos_numeros, simbolos,
      premio1_nombre, premio2_nombre, premio3_nombre, premio4_nombre, cifras, revancha_permitida, n_oportunidades,
      modalidad_premio, porcentaje_organizador)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'borrador',?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    `${rifa.nombre} (copia)`, rifa.valor_boleta, rifa.producto, rifa.descripcion, rifa.fecha_sorteo,
    rifa.hora_sorteo, rifa.imagen_producto, rifa.banner_empresa, rifa.cantidad_max_participantes, rifa.rango_min,
    rifa.rango_max, rifa.tipo_rifa, rifa.mensaje_whatsapp, rifa.auto_liberar_horas,
    rifa.modalidad_boleta, rifa.modo_asignacion, rifa.grupos_numeros || null,
    rifa.simbolos, rifa.premio1_nombre || 'Premio 1', rifa.premio2_nombre || 'Premio 2',
    rifa.premio3_nombre || 'Premio 3', rifa.premio4_nombre || 'Premio 4', normalizarCifras(rifa.cifras),
    rifa.revancha_permitida || 0,
    rifa.n_oportunidades || null,
    rifa.modalidad_premio || 'completo', rifa.porcentaje_organizador || 0
  );
  const nuevaId = info.lastInsertRowid;

  if (chance) {
    generarBoletasChance(getRifa(nuevaId));
  } else {
    const insertNumero = db.prepare('INSERT INTO numeros (rifa_id, numero, estado) VALUES (?,?,\'libre\')');
    const insertMany = db.transaction((min, max) => { for (let n = min; n <= max; n++) insertNumero.run(nuevaId, n); });
    insertMany(rifa.rango_min, rifa.rango_max);
  }
  const rifaNueva = getRifa(nuevaId);
  if (rifaNueva.modalidad_boleta === 'CUATRO_OPORTUNIDADES') asegurarGrupos(rifaNueva);

  registrarHistorial(nuevaId, 'clonacion', `Clonada desde la rifa #${rifa.id}`);
  res.status(201).json(rifaNueva);
});

// --------------------------------- PAPELERA ----------------------------------
// "Eliminar" una rifa la mueve a la papelera (soft delete) por si hay imprevistos.
app.delete('/api/rifas/:id', (req, res) => {
  const rifa = getRifa(req.params.id);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
  db.prepare('UPDATE rifas SET borrada_en = datetime(\'now\',\'localtime\') WHERE id = ?').run(req.params.id);
  registrarHistorial(req.params.id, 'eliminacion', `Rifa movida a la papelera`);
  res.json({ ok: true, papelera: true });
});

// Listar papelera de reciclaje (temporal hasta restaurar o purgar)
app.get('/api/papelera', (req, res) => {
  const rifas = db.prepare('SELECT * FROM rifas WHERE borrada_en IS NOT NULL ORDER BY borrada_en DESC').all();
  res.json(rifas.map(r => {
    const d = calcularDashboard(r.id);
    return { ...r, vendidos: d.vendidos, pagados: d.pagados, pendientes: d.pendientes,
      recaudado: d.recaudado, porcentaje: d.porcentaje };
  }));
});

// Restaurar una rifa desde la papelera
app.post('/api/papelera/:id/restaurar', (req, res) => {
  const rifa = db.prepare('SELECT * FROM rifas WHERE id = ? AND borrada_en IS NOT NULL').get(req.params.id);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada en la papelera' });
  db.prepare('UPDATE rifas SET borrada_en = NULL WHERE id = ?').run(req.params.id);
  registrarHistorial(req.params.id, 'restauracion', 'Rifa restaurada desde la papelera');
  res.json({ ok: true });
});

// Purgar definitivamente (borrado permanente, no se puede recuperar)
app.delete('/api/papelera/:id', (req, res) => {
  const rifa = db.prepare('SELECT * FROM rifas WHERE id = ? AND borrada_en IS NOT NULL').get(req.params.id);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada en la papelera' });
  registrarLog('purga', 'rifa', rifa.id, rifa.nombre, 'Rifa purgada definitivamente de la papelera');
  const tx = db.transaction((id) => {
    db.prepare('DELETE FROM participantes WHERE rifa_id = ?').run(id);
    db.prepare('DELETE FROM numeros WHERE rifa_id = ?').run(id);
    db.prepare('DELETE FROM boletas_chance WHERE rifa_id = ?').run(id);
    db.prepare('DELETE FROM ganadores WHERE rifa_id = ?').run(id);
    db.prepare('DELETE FROM rifas WHERE id = ?').run(id);
  });
  tx(req.params.id);
  res.json({ ok: true, purgada: true });
});

// Vaciar la papelera completa (borrado permanente de todas las rifas en papelera)
app.delete('/api/papelera', (req, res) => {
  const aPurgar = db.prepare('SELECT id, nombre FROM rifas WHERE borrada_en IS NOT NULL').all();
  const tx = db.transaction(() => {
    for (const r of aPurgar) {
      db.prepare('INSERT INTO logs (accion, entidad, rifa_id, rifa_nombre, detalle) VALUES (?,?,?,?,?)')
        .run('purga', 'rifa', r.id, r.nombre, 'Rifa purgada definitivamente (papelera vaciada)');
    }
    db.prepare('DELETE FROM participantes WHERE rifa_id IN (SELECT id FROM rifas WHERE borrada_en IS NOT NULL)').run();
    db.prepare('DELETE FROM numeros WHERE rifa_id IN (SELECT id FROM rifas WHERE borrada_en IS NOT NULL)').run();
    db.prepare('DELETE FROM boletas_chance WHERE rifa_id IN (SELECT id FROM rifas WHERE borrada_en IS NOT NULL)').run();
    db.prepare('DELETE FROM ganadores WHERE rifa_id IN (SELECT id FROM rifas WHERE borrada_en IS NOT NULL)').run();
    const info = db.prepare('DELETE FROM rifas WHERE borrada_en IS NOT NULL').run();
    return info.changes;
  });
  const purgadas = tx();
  res.json({ ok: true, purgadas });
});

// -------------------------------- LOGS GLOBALES -------------------------------
// Auditoría de todos los cambios registrados en el sistema.
app.get('/api/logs', (req, res) => {
  const { rifa_id, accion, q } = req.query;
  let sql = 'SELECT id, accion, entidad, rifa_id, rifa_nombre, detalle, fecha FROM logs WHERE 1=1';
  const params = [];
  if (rifa_id) { sql += ' AND rifa_id = ?'; params.push(rifa_id); }
  if (accion) { sql += ' AND accion = ?'; params.push(accion); }
  if (q) { sql += ' AND (detalle LIKE ? OR rifa_nombre LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY id DESC LIMIT 1000';
  res.json(db.prepare(sql).all(...params));
});

// Grilla de números con su estado (para selector visual)
app.get('/api/rifas/:id/numeros', (req, res) => {
  liberarVencidos(req.params.id);
  const rifa = getRifa(req.params.id);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
  if (esChance(rifa)) {
    const boletas = db.prepare(`
      SELECT bc.numero, bc.simbolo, bc.estado, p.nombre, p.estado_pago
      FROM boletas_chance bc LEFT JOIN participantes p ON p.id = bc.participante_id
      WHERE bc.rifa_id = ? ORDER BY bc.numero ASC, bc.simbolo ASC
    `).all(req.params.id);
    return res.json({
      modalidadBoleta: rifa.modalidad_boleta,
      simbolos: simbolosRifa(rifa),
      boletas: boletas.map(b => ({ ...b, numero: padChance(rifa, b.numero), label: ticketLabel(padChance(rifa, b.numero), b.simbolo) })),
      numeros: []
    });
  }
  const numeros = db.prepare(`
    SELECT n.numero, n.estado, p.nombre
    FROM numeros n LEFT JOIN participantes p ON p.id = n.participante_id
    WHERE n.rifa_id = ? ORDER BY n.numero ASC
  `).all(req.params.id);
  const grupos = asegurarGrupos(rifa).map(g => {
    const e = estadoGrupo(rifa, g);
    return { numeros: g.map(n => fmtNumero(rifa, n)), estado: e.estado, nombre: e.nombre };
  });
  res.json({
    numeros: numeros.map(n => ({ ...n, numero: fmtNumero(rifa, n.numero) })),
    grupos
  });
});

// Alias solicitado por el PROMPT V8.0 (Tarea 2): números disponibles con estado
app.get(['/api/rifas/:id/available-numbers', '/api/raffles/:id/available-numbers'], (req, res) => {
  liberarVencidos(req.params.id);
  const rifa = getRifa(req.params.id);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
  if (esChance(rifa)) {
    const boletas = db.prepare(`
      SELECT bc.numero, bc.simbolo, bc.estado, p.nombre
      FROM boletas_chance bc LEFT JOIN participantes p ON p.id = bc.participante_id
      WHERE bc.rifa_id = ? ORDER BY bc.numero ASC, bc.simbolo ASC
    `).all(req.params.id);
    return res.json({
      rifaId: Number(req.params.id),
      modalidadBoleta: rifa.modalidad_boleta,
      modoAsignacion: rifa.modo_asignacion,
      simbolos: simbolosRifa(rifa),
      boletas: boletas.map(b => ({ ...b, numero: padChance(rifa, b.numero), label: ticketLabel(padChance(rifa, b.numero), b.simbolo) })),
      numeros: []
    });
  }
  const numeros = db.prepare(`
    SELECT n.numero, n.estado, p.nombre
    FROM numeros n LEFT JOIN participantes p ON p.id = n.participante_id
    WHERE n.rifa_id = ? ORDER BY n.numero ASC
  `).all(req.params.id);
  res.json({
    rifaId: Number(req.params.id),
    modalidadBoleta: rifa.modalidad_boleta,
    modoAsignacion: rifa.modo_asignacion,
    rangoMin: rifa.rango_min,
    rangoMax: rifa.rango_max,
    numeros: numeros.map(n => ({ ...n, numero: fmtNumero(rifa, n.numero) })),
    grupos: asegurarGrupos(rifa).map(g => {
      const e = estadoGrupo(rifa, g);
      return { numeros: g.map(n => fmtNumero(rifa, n)), estado: e.estado, nombre: e.nombre };
    })
  });
});

// ----------------------------- PARTICIPANTES ------------------------------------

// Registro individual (BOLETAS_NORMAL: 1 número · CUATRO_OPORTUNIDADES: 4 números)
// Modo AL_AZAR: asigna el/los número(s) libres automáticamente.
// Modo A_ELECCION: el cliente envía el/los número(s) que escogió en la grilla.
app.post('/api/rifas/:id/participantes', (req, res) => {
  const rifaId = req.params.id;
  liberarVencidos(rifaId);
  const rifa = getRifa(rifaId);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });

  const { nombre, cedula, telefono, numero, numeros, simbolo, boleta_id } = req.body;
  const nombreLimpio = limpiarTexto(nombre);
  const cedulaLimpia = limpiarCedula(cedula);
  const telefonoLimpio = limpiarTelefono(telefono);

  if (!nombreLimpio) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!telefonoLimpio) return res.status(400).json({ error: 'El número de teléfono es obligatorio' });

  const esCuatro = rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES';
  const chance = esChance(rifa);
  const nOport = nOportunidades(rifa);
  const maxBoletas = esCuatro ? (100 / nOport) : rifa.cantidad_max_participantes;

  // Al iniciar el sorteo (cerrada) o tras sortear se bloquean las ventas
  if (rifa.estado === 'cerrada' || rifa.estado === 'sorteada') {
    return res.status(409).json({ error: rifa.estado === 'sorteada' ? 'Esta rifa ya fue sorteada' : 'Las ventas están bloqueadas: el sorteo ya inició' });
  }

  const dashboard = calcularDashboard(rifaId);
  if (dashboard.vendidos >= maxBoletas) {
    return res.status(409).json({ error: `Se alcanzó el máximo de ${maxBoletas} boletas permitido para esta rifa` });
  }

  // Detección de duplicados: la cédula es opcional, así que si se da se valida
  // contra la cédula; si no, se valida contra el teléfono (obligatorio).
  if (cedulaLimpia) {
    const dupC = db.prepare('SELECT id FROM participantes WHERE rifa_id = ? AND cedula = ?').get(rifaId, cedulaLimpia);
    if (dupC) return res.status(409).json({ error: `La cédula ${cedulaLimpia} ya está registrada en esta rifa` });
  } else {
    const dupT = db.prepare('SELECT id FROM participantes WHERE rifa_id = ? AND telefono = ?').get(rifaId, telefonoLimpio);
    if (dupT) return res.status(409).json({ error: 'Ese número de teléfono ya está registrado en esta rifa' });
  }

  // --- Determinar el/los número(s) de la boleta ----------------------------
  const numerosReq = Array.isArray(numeros) ? numeros.map(Number).filter(n => Number.isInteger(n)) : [];
  const numeroReq = (numero !== undefined && numero !== null && numero !== '') ? Number(numero) : null;
  if (numeroReq !== null && !Number.isInteger(numeroReq)) return res.status(400).json({ error: 'Número inválido' });
  let elegidos = [];
  let simboloElegido = null;
  let boletaChance = null;

  if (chance) {
    // La boleta es la combinación (número 00-99, símbolo). Se puede enviar el
    // id de la boleta (grilla), o el par numero+simbolo; si no, AL_AZAR.
    const sims = simbolosRifa(rifa);
    const topeChance = esChance4D(rifa) ? 9999 : 99;
    const numeroChance = (numeroReq !== null && numeroReq >= 0 && numeroReq <= topeChance) ? numeroReq : null;
    const simboloLimpio = limpiarTexto(simbolo, 4);

    if (boleta_id !== undefined && boleta_id !== null && boleta_id !== '') {
      boletaChance = db.prepare('SELECT * FROM boletas_chance WHERE rifa_id=? AND id=?').get(rifaId, Number(boleta_id));
    } else if (numeroChance !== null && simboloLimpio && sims.includes(simboloLimpio)) {
      boletaChance = db.prepare('SELECT * FROM boletas_chance WHERE rifa_id=? AND numero=? AND simbolo=?').get(rifaId, numeroChance, simboloLimpio);
      if (!boletaChance) return res.status(400).json({ error: 'Esa combinación de número y símbolo no existe en esta rifa' });
    } else {
      const libres = db.prepare("SELECT numero FROM numeros WHERE rifa_id=? AND estado='libre'").all(rifaId);
      if (!libres.length) return res.status(409).json({ error: 'No quedan números disponibles' });
      elegidos = [shuffle(libres)[0].numero];
    }

    if (boletaChance.estado !== 'libre') {
      return res.status(409).json({ error: `La boleta ${ticketLabel(boletaChance.numero, boletaChance.simbolo, rifa)} ya no está disponible` });
    }
    elegidos = [boletaChance.numero];
    simboloElegido = boletaChance.simbolo;
  } else if (esCuatro) {
    // Los grupos de 00-99 (uno por boleta) son la unidad de venta en múltiples
    // oportunidades: cada boleta compra n números (2, 4 o 5) de un grupo.
    const grupos = asegurarGrupos(rifa).map((g, idx) => ({ idx, numeros: g }));
    const grupoSel = (req.body.grupo_idx !== undefined && req.body.grupo_idx !== null && req.body.grupo_idx !== '')
      ? Number(req.body.grupo_idx) : null;

    if (grupoSel !== null && Number.isInteger(grupoSel)) {
      const g = grupos[grupoSel];
      if (!g) return res.status(400).json({ error: 'Grupo inválido' });
      elegidos = g.numeros;
    } else if (numerosReq.length > 0) { // A_ELECCION: cliente mandó las casillas
      if (numerosReq.length !== nOport) return res.status(400).json({ error: `En múltiples oportunidades cada boleta lleva exactamente ${nOport} números` });
      if (new Set(numerosReq).size !== nOport) return res.status(400).json({ error: `Los ${nOport} números deben ser diferentes` });
      const g = grupos.find(gr => gr.numeros.every(n => numerosReq.includes(n)));
      if (!g) return res.status(400).json({ error: `Los ${nOport} números deben pertenecer a un mismo grupo` });
      elegidos = g.numeros;
    } else { // AL_AZAR: grupo libre aleatorio
      const libres = grupos.filter(gr => estadoGrupo(rifa, gr.numeros).estado === 'libre');
      if (libres.length === 0) return res.status(409).json({ error: `No quedan grupos de ${nOport} números disponibles` });
      elegidos = shuffle(libres)[0].numeros;
    }
  } else {
    if (numeroReq !== null) elegidos = [numeroReq];
    else if (numerosReq.length === 1) elegidos = [numerosReq[0]];
    else if (numerosReq.length > 1) return res.status(400).json({ error: 'En boleta normal solo se puede elegir 1 número' });
    else {
      const libre = db.prepare("SELECT numero FROM numeros WHERE rifa_id=? AND estado='libre' ORDER BY numero ASC LIMIT 1").get(rifaId);
      if (!libre) return res.status(409).json({ error: 'No quedan números disponibles' });
      elegidos = [libre.numero];
    }
  }

  // --- Validar que los elegidos existen y están libres (dentro de la transacción) ---
  const insertar = db.transaction(() => {
    if (!chance) {
      for (const n of elegidos) {
        const fila = db.prepare('SELECT * FROM numeros WHERE rifa_id=? AND numero=?').get(rifaId, n);
        if (!fila) throw new Error(`El número ${fmtNumero(rifa, n)} no existe en el rango de la rifa`);
        if (fila.estado !== 'libre') throw new Error(
          esCuatro
            ? `Ese grupo de ${nOport} oportunidades ya no está disponible (el número ${fmtNumero(rifa, n)} está ocupado)`
            : `El número ${fmtNumero(rifa, n)} ya está ocupado`
        );
      }
    }
    elegidos.sort((a, b) => a - b);
    const info = chance
      ? db.prepare('INSERT INTO participantes (rifa_id, nombre, cedula, telefono, numero, simbolo, numeros) VALUES (?,?,?,?,?,?,?)')
          .run(rifaId, nombreLimpio, cedulaLimpia, telefonoLimpio, elegidos[0], simboloElegido,
            JSON.stringify([ticketLabel(elegidos[0], simboloElegido, rifa)]))
      : db.prepare('INSERT INTO participantes (rifa_id, nombre, cedula, telefono, numero, numeros) VALUES (?,?,?,?,?,?)')
          .run(rifaId, nombreLimpio, cedulaLimpia, telefonoLimpio, elegidos[0], JSON.stringify(elegidos));
    if (chance) {
      db.prepare("UPDATE boletas_chance SET estado='pendiente', participante_id=?, fecha_reservado=datetime('now','localtime') WHERE id=?")
        .run(info.lastInsertRowid, boletaChance.id);
    } else {
      const marcar = db.prepare('UPDATE numeros SET estado=\'pendiente\', participante_id=?, fecha_reservado=datetime(\'now\',\'localtime\') WHERE rifa_id=? AND numero=?');
      for (const n of elegidos) marcar.run(info.lastInsertRowid, rifaId, n);
    }
    return info.lastInsertRowid;
  });
  let id;
  try {
    id = insertar();
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('ya está ocupado') || msg.includes('no existe')) {
      return res.status(409).json({ error: msg });
    }
    return res.status(400).json({ error: msg });
  }
  registrarHistorial(rifaId, 'registro',
    chance
      ? `${nombreLimpio} registrado con la boleta ${ticketLabel(elegidos[0], simboloElegido, rifa)}`
      : `${nombreLimpio} registrado con ${elegidos.length === 1 ? 'el número ' + fmtNumero(rifa, elegidos[0]) : 'los números ' + elegidos.map(n => fmtNumero(rifa, n)).join(', ')}`);
  const creado = db.prepare('SELECT * FROM participantes WHERE id = ?').get(id);
  const rifaInfo = db.prepare('SELECT nombre FROM rifas WHERE id = ?').get(rifaId);
  enviarPush('Nuevo participante', `${nombreLimpio} se registró en ${rifaInfo?.nombre || 'una rifa'}`, { rifaId, tipo: 'nueva_venta' });
  res.status(201).json({ ...creado, numeros: numsBoleta(creado) });
});

// Registro masivo: pega texto "Nombre, Teléfono" (y opcionalmente "Nombre, Cédula, Teléfono"),
// una línea por participante. Acepta separadores: coma, tabulación o guion.
app.post('/api/rifas/:id/participantes/masivo', (req, res) => {
  const rifaId = req.params.id;
  liberarVencidos(rifaId);
  const rifa = getRifa(rifaId);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });

  const { texto } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Pega el listado de Nombre y Teléfono' });

  const esCuatro = rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES';
  const chance = esChance(rifa);
  const nOport = nOportunidades(rifa);
  const numsPorBoleta = esCuatro ? nOport : 1;
  const maxBoletas = esCuatro ? (100 / nOport) : rifa.cantidad_max_participantes;

  if (rifa.estado === 'cerrada' || rifa.estado === 'sorteada') {
    return res.status(409).json({ error: rifa.estado === 'sorteada' ? 'Esta rifa ya fue sorteada' : 'Las ventas están bloqueadas: el sorteo ya inició' });
  }

  const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  if (lineas.length > 500) return res.status(400).json({ error: 'Máximo 500 participantes por lote' });
  const resultado = { insertados: [], duplicados: [], errores: [], sinCupo: [] };

  const clavesExistentes = new Set(
    db.prepare('SELECT cedula, telefono FROM participantes WHERE rifa_id = ?').all(rifaId)
      .map(r => (r.cedula ? 'C:' + r.cedula : 'T:' + r.telefono))
  );

  const dashboardInicial = calcularDashboard(rifaId);
  let cuposDisponibles = maxBoletas - dashboardInicial.vendidos;

  const insertarUno = db.prepare('INSERT INTO participantes (rifa_id, nombre, cedula, telefono, numero, simbolo, numeros) VALUES (?,?,?,?,?,?,?)');
  const marcarNumero = db.prepare('UPDATE numeros SET estado=\'pendiente\', participante_id=?, fecha_reservado=datetime(\'now\',\'localtime\') WHERE rifa_id=? AND numero=?');
  const marcarBoleta = db.prepare("UPDATE boletas_chance SET estado='pendiente', participante_id=?, fecha_reservado=datetime('now','localtime') WHERE id=?");

  const procesar = db.transaction(() => {
    for (const linea of lineas) {
      const partes = linea.split(/[,;\t]|(?:\s-\s)/).map(p => p.trim()).filter(Boolean);
      // Formatos válidos:
      //   "Nombre, Teléfono"            -> partes.length === 2
      //   "Nombre, Cédula, Teléfono"    -> partes.length >= 3 (el teléfono es el último)
      if (partes.length < 2) { resultado.errores.push(linea); continue; }

      const telefono = limpiarTelefono(partes[partes.length - 1]);
      let cedula = '', nombre;
      if (partes.length >= 3) {
        cedula = limpiarCedula(partes[partes.length - 2]);
        nombre = limpiarTexto(partes.slice(0, partes.length - 2).join(' '));
      } else {
        nombre = limpiarTexto(partes[0]);
      }

      if (!nombre || !telefono) { resultado.errores.push(linea); continue; }
      const clave = cedula ? 'C:' + cedula : 'T:' + telefono;
      if (clavesExistentes.has(clave)) { resultado.duplicados.push({ nombre, cedula, telefono }); continue; }
      if (cuposDisponibles <= 0) { resultado.sinCupo.push({ nombre, cedula, telefono }); continue; }

      // Buscar boleta libre: 1 número normal / 4 en CUATRO_OPORTUNIDADES / combinación (número,símbolo) en CHANCE
      let asignados;
      let simboloAsignado = null;
      let boletaChance = null;
      if (chance) {
        boletaChance = db.prepare("SELECT * FROM boletas_chance WHERE rifa_id=? AND estado='libre' ORDER BY RANDOM() LIMIT 1").get(rifaId);
        if (!boletaChance) { resultado.sinCupo.push({ nombre, cedula, telefono }); continue; }
        asignados = [boletaChance.numero];
        simboloAsignado = boletaChance.simbolo;
      } else if (esCuatro) {
        const grupos = asegurarGrupos(rifa).map(g => ({ numeros: g }));
        const libresGrupo = grupos.filter(gr => estadoGrupo(rifa, gr.numeros).estado === 'libre');
        if (libresGrupo.length === 0) { resultado.sinCupo.push({ nombre, cedula, telefono }); continue; }
        asignados = shuffle(libresGrupo)[0].numeros;
      } else {
        const libre = db.prepare("SELECT numero FROM numeros WHERE rifa_id=? AND estado='libre' ORDER BY numero ASC LIMIT 1").get(rifaId);
        if (!libre) { resultado.sinCupo.push({ nombre, cedula, telefono }); continue; }
        asignados = [libre.numero];
      }

      const info = chance
        ? insertarUno.run(rifaId, nombre, cedula, telefono, asignados[0], simboloAsignado, JSON.stringify([ticketLabel(asignados[0], simboloAsignado, rifa)]))
        : insertarUno.run(rifaId, nombre, cedula, telefono, asignados[0], null, JSON.stringify(asignados));
      if (chance) marcarBoleta.run(info.lastInsertRowid, boletaChance.id);
      else for (const n of asignados) marcarNumero.run(info.lastInsertRowid, rifaId, n);
      clavesExistentes.add(clave);
      cuposDisponibles--;
      resultado.insertados.push({ nombre, cedula, telefono, numeros: chance ? [ticketLabel(asignados[0], simboloAsignado)] : asignados.map(n => fmtNumero(rifa, n)) });
    }
  });
  procesar();

  registrarHistorial(rifaId, 'registro-masivo', `${resultado.insertados.length} participantes agregados, ${resultado.duplicados.length} duplicados omitidos`);
  res.status(201).json(resultado);
});

// Listar participantes de una rifa
app.get('/api/rifas/:id/participantes', (req, res) => {
  liberarVencidos(req.params.id);
  const rifa = getRifa(req.params.id);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
  const filas = db.prepare('SELECT * FROM participantes WHERE rifa_id = ? ORDER BY numero ASC').all(req.params.id);
  res.json(filas.map(p => ({ ...p, numeros: numsBoleta(p) })));
});

// Marcar Pagado / Pendiente y/o editar datos del participante
// (solo datos de contacto: nombre, cédula, teléfono — el número no se puede
//  reasignar por aquí; se libera/elimina y se registra de nuevo si hace falta)
app.put('/api/participantes/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM participantes WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Participante no encontrado' });
    const b = req.body;
    const rifaPart = db.prepare('SELECT * FROM rifas WHERE id = ?').get(p.rifa_id);

  const nombre = limpiarTexto(b.nombre, 120);
  const cedula = limpiarCedula(b.cedula);
  const telefono = limpiarTelefono(b.telefono);

  // Si llega algún dato de contacto, debe venir completo (nombre y teléfono obligatorios)
  if (b.nombre !== undefined || b.cedula !== undefined || b.telefono !== undefined) {
    if (!nombre || !telefono) return res.status(400).json({ error: 'Nombre y teléfono son obligatorios' });
    // Evitar duplicados en la misma rifa: por cédula (si se da) o por teléfono
    const clave = cedula ? 'C:' + cedula : 'T:' + telefono;
    const otros = db.prepare('SELECT cedula, telefono FROM participantes WHERE rifa_id = ? AND id != ?').all(p.rifa_id, req.params.id)
      .map(r => (r.cedula ? 'C:' + r.cedula : 'T:' + r.telefono));
    if (otros.includes(clave)) {
      return res.status(409).json({ error: cedula ? 'Ya existe un participante con esa cédula en esta rifa' : 'Ya existe un participante con ese teléfono en esta rifa' });
    }
    db.prepare('UPDATE participantes SET nombre=?, cedula=?, telefono=? WHERE id=?')
      .run(nombre, cedula, telefono, req.params.id);
    registrarHistorial(p.rifa_id, 'edicion-participante', `Datos de ${nombre} (boleta ${numsBoleta(p).map(n => fmtNumero(rifaPart, n)).join(', ')}) actualizados`);
  }

  if (b.estado_pago !== undefined) {
    const { estado_pago } = b;
    if (!['pagado', 'pendiente'].includes(estado_pago)) return res.status(400).json({ error: 'estado_pago inválido' });
    db.prepare('UPDATE participantes SET estado_pago=?, fecha_pago=? WHERE id=?')
      .run(estado_pago, estado_pago === 'pagado' ? new Date().toISOString() : null, req.params.id);
    // Actualiza TODOS los números de la boleta (1 normal / 4 en CUATRO_OPORTUNIDADES)
    db.prepare('UPDATE numeros SET estado=? WHERE participante_id=?')
      .run(estado_pago, req.params.id);
    // Y las boletas del chance (número x símbolo)
    db.prepare('UPDATE boletas_chance SET estado=? WHERE participante_id=?')
      .run(estado_pago, req.params.id);
    registrarHistorial(p.rifa_id, 'pago', `Boleta ${numsBoleta(p).map(n => fmtNumero(rifaPart, n)).join(', ')} (${nombre || p.nombre}) marcada como ${estado_pago}`);
    if (estado_pago === 'pagado') {
      const rifaInfo = db.prepare('SELECT nombre FROM rifas WHERE id = ?').get(p.rifa_id);
      enviarPush('Pago confirmado', `${nombre || p.nombre} pagó su boleta en ${rifaInfo?.nombre || 'una rifa'}`, { rifaId: p.rifa_id, tipo: 'pago' });
    }
  }

  res.json(db.prepare('SELECT * FROM participantes WHERE id = ?').get(req.params.id));
});

// Eliminar participante (liberar número manualmente)
app.delete('/api/participantes/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM participantes WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Participante no encontrado' });
  db.prepare('UPDATE numeros SET estado=\'libre\', participante_id=NULL, fecha_reservado=NULL WHERE participante_id=?')
    .run(req.params.id);
  db.prepare("UPDATE boletas_chance SET estado='libre', participante_id=NULL, fecha_reservado=NULL WHERE participante_id=?")
    .run(req.params.id);
  db.prepare('DELETE FROM participantes WHERE id = ?').run(req.params.id);
  registrarHistorial(p.rifa_id, 'liberacion-manual', `Boleta ${numsBoleta(p).map(n => fmtNumero(rifaPart, n)).join(', ')} (${p.nombre}) liberada manualmente`);
  res.json({ ok: true });
});

// Forzar liberación de vencidos manualmente
app.post('/api/rifas/:id/liberar-vencidos', (req, res) => {
  const n = liberarVencidos(req.params.id);
  res.json({ liberados: n });
});

// -------------------------------- SORTEOS ----------------------------------------

// Genera una semilla aleatoria criptográficamente segura y un generador
// determinista a partir de ella (para poder mostrar y auditar la semilla).
function generarSemilla() {
  return crypto.randomBytes(16).toString('hex');
}
function rngDesdeSemilla(semilla) {
  let seed = 0;
  for (let i = 0; i < semilla.length; i++) seed = (seed * 31 + semilla.charCodeAt(i)) >>> 0;
  if (!seed) seed = 1;
  return function () {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

app.post('/api/rifas/:id/sortear', (req, res) => {
  const rifaId = req.params.id;
  const rifa = getRifa(rifaId);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
  if (esChance(rifa)) return res.status(400).json({ error: 'Esta rifa usa sorteo de Chance con símbolo (/chance-sorteo)' });

  const { modalidad, cantidad_ganadores, loteria, tapazo, semilla_manual } = req.body;
  const pagados = db.prepare("SELECT * FROM participantes WHERE rifa_id=? AND estado_pago='pagado' ORDER BY numero ASC").all(rifaId);
  if (pagados.length === 0) return res.status(400).json({ error: 'No hay participantes pagados para sortear' });

  const semilla = semilla_manual || generarSemilla();
  const rng = rngDesdeSemilla(semilla);
  let ganadores = [];

  if (modalidad === 'ruleta' || modalidad === 'aleatorio') {
    const cantidad = Math.max(1, Math.min(parseInt(cantidad_ganadores || 1, 10), pagados.length));
    const pool = [...pagados];
    for (let i = 0; i < cantidad; i++) {
      const idx = Math.floor(rng() * pool.length);
      ganadores.push(pool.splice(idx, 1)[0]);
    }
  } else if (modalidad === 'loteria') {
    if (!loteria || !loteria.resultado) return res.status(400).json({ error: 'Debes indicar el resultado de la lotería' });
    const cifras = parseInt(loteria.cifras || 2, 10); // últimas 2 o 3 cifras
    const resultadoStr = String(loteria.resultado).replace(/\D/g, '');
    const clave = resultadoStr.slice(-cifras);
    const ganador = pagados.find(p => numsBoleta(p).some(n => String(n).padStart(cifras, '0').slice(-cifras) === clave));
    if (!ganador) return res.status(404).json({ error: `Ningún número pagado coincide con las últimas ${cifras} cifras (${clave})` });
    ganadores = [ganador];
  } else if (modalidad === 'tapazo') {
    if (!tapazo || tapazo.min == null || tapazo.max == null) return res.status(400).json({ error: 'Configura el rango del tapazo' });
    const enRango = pagados.filter(p => numsBoleta(p).some(n => n >= tapazo.min && n <= tapazo.max));
    if (enRango.length === 0) return res.status(404).json({ error: 'No hay números pagados dentro de ese rango' });
    const idx = Math.floor(rng() * enRango.length);
    ganadores = [enRango[idx]];
  } else {
    return res.status(400).json({ error: 'Modalidad de sorteo inválida' });
  }

  const insertar = db.prepare(`INSERT INTO ganadores (rifa_id, numero, participante_id, nombre, modalidad, semilla, detalle_loteria)
    VALUES (?,?,?,?,?,?,?)`);
  const guardar = db.transaction(() => {
    for (const g of ganadores) {
      insertar.run(rifaId, g.numero, g.id, g.nombre, modalidad, semilla,
        modalidad === 'loteria' ? JSON.stringify(loteria) : null);
    }
    db.prepare("UPDATE rifas SET estado='sorteada' WHERE id=?").run(rifaId);
  });
  guardar();

  registrarHistorial(rifaId, 'sorteo', `Modalidad ${modalidad}, semilla ${semilla}, ganadores: ${ganadores.map(g => fmtNumero(rifa, g.numero)).join(', ')}`);
  const rifaInfo = db.prepare('SELECT nombre FROM rifas WHERE id = ?').get(rifaId);
  const nombresGanadores = ganadores.map(g => g.nombre).join(', ');
  registrarSorteoAuditoria(rifaId, rifaInfo?.nombre || '', modalidad, req.session?.usuario || 'sistema', semilla, ganadores, { modalidad, semilla, ganadores: ganadores.map(g => ({ numero: g.numero, nombre: g.nombre })) });
  enviarPush('Sorteo realizado', `${rifaInfo?.nombre}: ganador(es) ${nombresGanadores}`, { rifaId, tipo: 'sorteo' });
  res.json({ semilla, modalidad, ganadores });
});

app.get('/api/rifas/:id/ganadores', (req, res) => {
  const rifaG = getRifa(req.params.id);
  res.json(db.prepare('SELECT * FROM ganadores WHERE rifa_id = ? ORDER BY fecha DESC').all(req.params.id).map(g => ({ ...g, numero: rifaG ? fmtNumero(rifaG, g.numero) : g.numero })));
});

app.get('/api/rifas/:id/historial', (req, res) => {
  res.json(db.prepare('SELECT * FROM historial WHERE rifa_id = ? ORDER BY fecha DESC').all(req.params.id));
});

// Auditoría de sorteos de una rifa (admin+)
app.get('/api/rifas/:id/auditoria-sorteos', requireRole('admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM sorteos_auditoria WHERE rifa_id = ? ORDER BY fecha DESC').all(req.params.id));
});

// Auditoría global de sorteos (admin+)
app.get('/api/auditoria-sorteos', requireRole('admin'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const rows = db.prepare('SELECT * FROM sorteos_auditoria ORDER BY fecha DESC LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) c FROM sorteos_auditoria').get().c;
  res.json({ rows, total, limit, offset });
});

// ------------------- CHANCE CON SÍMBOLO: SORTEO + REVANCHA -------------------
// Se sortean 2, 4 o 5 cifras (configurable por rifa) + 1 símbolo. Los premios son
// grupos de 2 cifras seguidas:
//   2 cifras -> Premio A (las 2 cifras)
//   4 cifras -> Premio A (1ª-2ª) · Premio B (2ª-3ª) · Premio C (3ª-4ª)
//   5 cifras -> Premio A (1ª-2ª) · Premio B (2ª-3ª) · Premio C (3ª-4ª) · Premio D (4ª-5ª)
// Un premio es ganador si hay una boleta PAGADA con ese (número, símbolo).
// Para revancha se envía la lista de premios a re-sortear, ej: ["B","C"].
app.post('/api/rifas/:id/chance-sorteo', (req, res) => {
  const rifaId = req.params.id;
  const rifa = getRifa(rifaId);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
  if (!esChance(rifa)) return res.status(400).json({ error: 'Esta rifa no es de Chance con símbolo' });
  if (rifa.estado === 'sorteada') return res.status(409).json({ error: 'Esta rifa ya fue sorteada' });

  const cifrasN = rifa.modalidad_boleta === 'CHANCE_3_GANADORES' ? 4 : normalizarCifras(rifa.cifras);
  const { nombres, posiciones } = configPremiosChance(rifa, cifrasN);
  const tiposTotal = Object.keys(posiciones);
  const premiosSol = Array.isArray(req.body.premios) && req.body.premios.length ? req.body.premios : tiposTotal;
  const esRevancha = Array.isArray(req.body.premios) && req.body.premios.length > 0 && req.body.premios.length < tiposTotal.length;

  const semilla = req.body.semilla_manual || generarSemilla();
  const rng = rngDesdeSemilla(semilla);
  const cifras = Array.from({ length: cifrasN }, () => Math.floor(rng() * 10));
  const simboloGanador = esChanceSimbolo(rifa)
    ? simbolosRifa(rifa)[Math.floor(rng() * simbolosRifa(rifa).length)]
    : '';
  const numeroStr = cifras.join('');

  const premios = tiposTotal.map(t => ({
    tipo: t, nombre: nombres[t], numero: fmtNumero(rifa, Number(numeroStr.slice(posiciones[t][0], posiciones[t][1])))
  }));

  const guardarGanador = db.prepare(`INSERT INTO ganadores
    (rifa_id, numero, simbolo, participante_id, nombre, modalidad, semilla, premio, premio_tipo, revancha)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const resultados = [];

  const tx = db.transaction(() => {
    for (const p of premios) {
      if (!premiosSol.includes(p.tipo)) {
        resultados.push({ ...p, ganador: null, sorteado: false });
        continue;
      }
      const boleta = buscarGanadorChance(rifa, p, simboloGanador);
      let ganador = null;
      if (boleta) {
        ganador = {
          id: boleta.participante_id, nombre: boleta.nombre, telefono: boleta.telefono || '',
          cedula: boleta.cedula || '', numero: fmtNumero(rifa, boleta.numero), simbolo: boleta.simbolo,
          ticket: ticketLabel(boleta.numero, boleta.simbolo, rifa)
        };
        guardarGanador.run(rifaId, boleta.numero, boleta.simbolo, boleta.participante_id, boleta.nombre,
          'chance', semilla, p.nombre, p.tipo, esRevancha ? 1 : 0);
      }
      resultados.push({ ...p, ganador, sorteado: true });
    }
    // Persistir el resultado en el historial de sorteos de la rifa
    const previo = rifa.draw_result ? JSON.parse(rifa.draw_result) : [];
    previo.push({ fecha: new Date().toISOString(), semilla, cifras, numero: numeroStr, simbolo: simboloGanador, premios: resultados });
    db.prepare('UPDATE rifas SET draw_result = ? WHERE id = ?').run(JSON.stringify(previo), rifaId);
  });
  tx();

  const pagados = db.prepare("SELECT COUNT(*) c FROM participantes WHERE rifa_id=? AND estado_pago='pagado'").get(rifaId).c;
  registrarHistorial(rifaId, esRevancha ? 'sorteo-chance-revancha' : 'sorteo-chance',
    `Chance ${numeroStr} ${simboloGanador}${esRevancha ? ' (revancha de ' + premiosSol.join(',') + ')' : ''}, semilla ${semilla}`);
  const rifaInfo = db.prepare('SELECT nombre FROM rifas WHERE id = ?').get(rifaId);
  registrarSorteoAuditoria(rifaId, rifaInfo?.nombre || '', esRevancha ? 'chance-revancha' : 'chance', req.session?.usuario || 'sistema', semilla, resultados, { cifras: numeroStr, simbolo: simboloGanador, premios: resultados, revancha: esRevancha });

  res.json({
    semilla, cifras, nCifras: cifrasN, numero: numeroStr, simbolo: simboloGanador,
    ticketGanador: ticketLabel(padChance(rifa, numeroStr), simboloGanador),
    premios: resultados,
    revancha: esRevancha,
    vendidas: pagados,
    totalBoletas: totalTicketsChance(rifa),
    modalidadBoleta: rifa.modalidad_boleta
  });
});

// Finaliza el sorteo de chance (estado -> 'sorteada'); se usa tras el popup de
// resultados, cuando ya no quedan revanchas pendientes por decidir.
app.post('/api/rifas/:id/chance-finalizar', (req, res) => {
  const rifa = getRifa(req.params.id);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
  if (!esChance(rifa)) return res.status(400).json({ error: 'Esta rifa no es de Chance con símbolo' });
  db.prepare("UPDATE rifas SET estado='sorteada' WHERE id=?").run(req.params.id);
  registrarHistorial(req.params.id, 'sorteo-finalizado', 'Sorteo de chance finalizado');
  res.json(getRifa(req.params.id));
});

// -------------------------- BALOTERA VIRTUAL (TAREA 4) ---------------------------
// La balotera elige un NÚMERO ganador dentro del espacio real de la rifa y busca
// a qué boleta le cayó. Opciones:
//   - participantes: 'pagados' (default) → solo boletas pagadas participan
//   - participantes: 'todos' → todos los números del rango participan; si el ganador
//     no tiene boleta vendida, se devuelve sinGanador:true para revancha
app.post('/api/rifas/:id/balotera', (req, res) => {
  const rifaId = req.params.id;
  const rifa = getRifa(rifaId);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
  if (rifa.estado === 'sorteada') return res.status(409).json({ error: 'Esta rifa ya fue sorteada' });
  if (esChance(rifa)) return res.status(400).json({ error: 'Esta rifa usa sorteo de Chance con símbolo (/chance-sorteo)' });

  const cifras = [2, 4, 5].includes(Number(req.body.cifras)) ? Number(req.body.cifras) : 2;
  const modoParticipantes = req.body.participantes === 'todos' ? 'todos' : 'pagados';
  const pagados = db.prepare("SELECT * FROM participantes WHERE rifa_id=? AND estado_pago='pagado' ORDER BY numero ASC").all(rifaId);
  if (pagados.length === 0) return res.status(400).json({ error: 'No hay boletas pagadas para sortear' });

  const totalBoletas = rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES'
    ? (100 / nOportunidades(rifa))
    : rifa.modalidad_boleta === 'OPORTUNIDADES_4D'
    ? 2500
    : rifa.cantidad_max_participantes;

  // Elegir un número ganador al azar (con semilla para transparencia)
  let numeroGanador = null;
  let ganador = null;
  const semilla = generarSemilla();
  const rng = rngDesdeSemilla(semilla);

  if (modoParticipantes === 'pagados') {
    // Solo participan boletas pagadas (como una balotera real)
    let intentos = 0;
    while (!ganador && intentos < 200) {
      numeroGanador = rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES'
        ? Math.floor(rng() * 100)
        : rifa.rango_min + Math.floor(rng() * (rifa.rango_max - rifa.rango_min + 1));
      ganador = pagados.find(p => numsBoleta(p).includes(numeroGanador));
      intentos++;
    }
    if (!ganador) return res.status(400).json({ error: 'No se pudo determinar un ganador' });
  } else {
    // Todos los números del rango participan (incluso los no vendidos)
    numeroGanador = rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES'
      ? Math.floor(rng() * 100)
      : rifa.rango_min + Math.floor(rng() * (rifa.rango_max - rifa.rango_min + 1));
    ganador = pagados.find(p => numsBoleta(p).includes(numeroGanador));

    // Si el ganador no tiene boleta vendida, devolver sinGanador para revancha
    if (!ganador) {
      // No persistir — el sorteo no es válido hasta que haya ganador real
      return res.json({
        semilla,
        numero: fmtNumero(rifa, numeroGanador),
        cifras,
        vendidas: pagados.length,
        totalBoletas,
        sinGanador: true,
        mensaje: `El número ${fmtNumero(rifa, numeroGanador)} no tiene boleta vendida. Puedes hacer revancha.`,
        modalidadBoleta: rifa.modalidad_boleta
      });
    }
  }

  db.prepare(`INSERT INTO ganadores (rifa_id, numero, participante_id, nombre, modalidad, semilla) VALUES (?,?,?,?,?,?)`)
    .run(rifaId, numeroGanador, ganador.id, ganador.nombre, 'balotera', semilla);
  db.prepare("UPDATE rifas SET estado='sorteada' WHERE id=?").run(rifaId);
  registrarHistorial(rifaId, 'sorteo-balotera', `Ganador ${fmtNumero(rifa, numeroGanador)} (${ganador.nombre}), semilla ${semilla}, modo: ${modoParticipantes}`);
  const rifaInfo = db.prepare('SELECT nombre FROM rifas WHERE id = ?').get(rifaId);
  registrarSorteoAuditoria(rifaId, rifaInfo?.nombre || '', 'balotera', req.session?.usuario || 'sistema', semilla, [{ numero: numeroGanador, nombre: ganador.nombre }], { numero: numeroGanador, cifras, modo: modoParticipantes });

  res.json({
    semilla,
    numero: fmtNumero(rifa, numeroGanador),
    cifras,
    vendidas: pagados.length,
    totalBoletas,
    ganador: {
      id: ganador.id, nombre: ganador.nombre, telefono: ganador.telefono || '',
      numeros: numsBoleta(ganador).map(n => fmtNumero(rifa, n))
    },
    modalidadBoleta: rifa.modalidad_boleta
  });
});

// -------------------- POSTER PROMOCIONAL 1080x1080 (TAREA 3) ----------------------
// Genera la imagen en el servidor con @napi-rs/canvas (sin depender del navegador),
// la guarda en /uploads/poster-<id>.png y actualiza `rifas.poster_image_url`.

let _fuentesRegistradas = false;
function registrarFuentes() {
  if (_fuentesRegistradas) return;
  _fuentesRegistradas = true;
  const fuentes = [
    ['C:\\Windows\\Fonts\\segoeuib.ttf', 'Segoe UI Bold'],
    ['C:\\Windows\\Fonts\\segoeui.ttf', 'Segoe UI'],
    ['C:\\Windows\\Fonts\\arialbd.ttf', 'Arial Bold'],
    ['C:\\Windows\\Fonts\\arial.ttf', 'Arial']
  ];
  for (const [p, nombre] of fuentes) {
    try { if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, nombre); } catch (e) { /* ignorar */ }
  }
}

// Convierte una URL tipo "/uploads/xxx.jpg" a la ruta física en disco
function urlAArchivo(url) {
  if (!url) return null;
  const limpia = url.replace(/^\/+/, '');
  return path.join(__dirname, limpia);
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function envolverTexto(ctx, texto, x, y, maxWidth, lineHeight, align = 'left') {
  ctx.textAlign = align;
  const palabras = String(texto || '').split(' ');
  let linea = '', yy = y;
  for (const palabra of palabras) {
    const prueba = linea + palabra + ' ';
    if (ctx.measureText(prueba).width > maxWidth && linea !== '') {
      ctx.fillText(linea.trim(), x, yy);
      yy += lineHeight;
      linea = palabra + ' ';
    } else linea = prueba;
  }
  ctx.fillText(linea.trim(), x, yy);
}

function medirLineas(ctx, texto, maxWidth) {
  const palabras = String(texto || '').trim().split(/\s+/);
  let linea = '', lineas = [];
  for (const palabra of palabras) {
    const prueba = linea ? linea + ' ' + palabra : palabra;
    if (ctx.measureText(prueba).width > maxWidth && linea) {
      lineas.push(linea); linea = palabra;
    } else linea = prueba;
  }
  if (linea) lineas.push(linea);
  return lineas;
}

app.post('/api/rifas/:id/generar-poster', async (req, res) => {
  try {
    const rifa = getRifa(req.params.id);
    if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
    const empresa = db.prepare('SELECT * FROM empresa WHERE id = 1').get() || {};
    registrarFuentes();

    const F = 'Segoe UI', FB = 'Segoe UI Bold', FD = 'Arial';
    // Resolución alta (2x): se dibuja en coordenadas lógicas 1080x1080 y se
    // renderiza a 2160x2160 con ctx.scale() para nitidez en impresión / zoom.
    const W = 1080, H = 1080, ESCALA = 2;
    const canvas = createCanvas(W * ESCALA, H * ESCALA);
    const ctx = canvas.getContext('2d');
    if (ESCALA !== 1) ctx.scale(ESCALA, ESCALA);
    const dash = calcularDashboard(rifa.id);
    const pct = dash ? dash.porcentaje : 0;
    const quedan = dash ? dash.quedan : 0;

    const fmtFechaPoster = (iso, hora) => {
      let txt = iso || '';
      try { txt = new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (e) {}
      return hora ? txt + ' · ' + hora : txt;
    };

    // Fondo: degradado azul profundo elegante + halo dorado suave (sin rayos ni destellos)
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0F1B33'); grad.addColorStop(0.55, '#15243F'); grad.addColorStop(1, '#0B1322');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W / 2, -120, 20, W / 2, -120, H * 0.7);
    glow.addColorStop(0, 'rgba(212,160,23,0.18)'); glow.addColorStop(1, 'rgba(212,160,23,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // Marco dorado interior + franja superior
    ctx.save();
    rr(ctx, 18, 18, W - 36, H - 36, 30);
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(212,160,23,0.55)'; ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#D4A017'; ctx.fillRect(0, 0, W, 8);

    const S = W / 1080;
    const M = 60 * S, contentW = W - M * 2;
    const fechaSorteo = fmtFechaPoster(rifa.fecha_sorteo, rifa.hora_sorteo);
    const valorTxt = '$' + Number(rifa.valor_boleta).toLocaleString('es-CO');
    const pillTxt = 'BOLETA  ' + valorTxt;

    // Pre-generar QR para usarlo como callback de sección
    let imgQr = null;
    try {
      const urlQr = `${req.protocol}://${req.get('host')}/public/rifa/${rifa.id}`;
      const pngQr = await QRCode.toBuffer(urlQr, { width: 400, margin: 1 });
      imgQr = await loadImage(pngQr);
    } catch (e) {}

    // --- Medición de bloques (escalados a S) ---
    ctx.font = `${56 * S}px ${FB}`;
    const titLines = medirLineas(ctx, rifa.nombre || rifa.producto, contentW).slice(0, 3);
    const hTit = titLines.length * 64 * S;
    ctx.font = `${20 * S}px ${F}`;
    const descLines = rifa.descripcion ? medirLineas(ctx, rifa.descripcion, contentW).slice(0, 4) : [];
    const hDesc = descLines.length * 30 * S;

    const cardH = 400 * S;
    const pillH = 72 * S, barBlockH = 54 * S, qrBlockH = imgQr ? (130 + 22 + 26) * S : 0;
    const hFecha = fechaSorteo ? 44 * S : 0;
    const hEmp = empresa.nombre_empresa ? 32 * S : 0;

    const secciones = [];
    secciones.push({ h: cardH, draw: async (y) => {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 36 * S; ctx.shadowOffsetY = 10 * S;
      rr(ctx, M, y, contentW, cardH, 22 * S);
      ctx.fillStyle = '#FFFFFF'; ctx.fill();
      ctx.restore();
      ctx.save();
      rr(ctx, M, y, contentW, cardH, 22 * S);
      ctx.lineWidth = 4 * S; ctx.strokeStyle = '#D4A017'; ctx.stroke();
      ctx.clip();
      const archivoProducto = urlAArchivo(rifa.imagen_producto);
      let tieneImg = false;
      if (archivoProducto && fs.existsSync(archivoProducto)) {
        try {
          const img = await loadImage(archivoProducto);
          const ratio = Math.min(contentW / img.width, cardH / img.height);
          const iw = img.width * ratio, ih = img.height * ratio;
          ctx.drawImage(img, M + (contentW - iw) / 2, y + (cardH - ih) / 2, iw, ih);
          tieneImg = true;
        } catch (e) {}
      }
      if (!tieneImg) {
        const pg = ctx.createLinearGradient(M, y, M, y + cardH);
        pg.addColorStop(0, '#FDF4E0'); pg.addColorStop(1, '#EFE6C8');
        ctx.fillStyle = pg; ctx.fillRect(M, y, contentW, cardH);
        ctx.fillStyle = '#B7950B'; ctx.textAlign = 'center';
        ctx.font = `${60 * S}px ${FB}`;
        ctx.fillText('\u{1F381}', W / 2, y + cardH / 2 - 10 * S);
        ctx.font = `${26 * S}px ${FB}`;
        ctx.fillText(rifa.producto || 'GRAN PREMIO', W / 2, y + cardH / 2 + 50 * S);
      }
      ctx.restore();
      const badgeW = 200 * S, badgeH = 40 * S, bx = M + 14 * S, by = y + 14 * S;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10 * S; ctx.shadowOffsetY = 3 * S;
      const bgB = ctx.createLinearGradient(bx, 0, bx + badgeW, 0);
      bgB.addColorStop(0, '#D4A017'); bgB.addColorStop(1, '#F2C14E');
      rr(ctx, bx, by, badgeW, badgeH, badgeH / 2);
      ctx.fillStyle = bgB; ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#0B1229'; ctx.font = `${18 * S}px ${FB}`; ctx.textAlign = 'center';
      ctx.fillText('GRAN PREMIO', bx + badgeW / 2, by + 27 * S);
    }});
    secciones.push({ h: hTit, draw: (y) => {
      ctx.textAlign = 'center'; ctx.fillStyle = '#FFFFFF'; ctx.font = `${56 * S}px ${FB}`;
      titLines.forEach((l, i) => ctx.fillText(l, W / 2, y + 64 * S * (i + 0.78)));
    }});
    secciones.push({ h: pillH, draw: (y) => {
      ctx.font = `${42 * S}px ${FB}`;
      const tw = ctx.measureText(pillTxt).width;
      let pw = tw + 104 * S; if (pw > contentW) pw = contentW;
      const px = (W - pw) / 2;
      ctx.save(); ctx.shadowColor = 'rgba(212,160,23,0.5)'; ctx.shadowBlur = 18 * S; ctx.shadowOffsetY = 5 * S;
      rr(ctx, px, y, pw, pillH, pillH / 2);
      const g = ctx.createLinearGradient(px, 0, px + pw, 0);
      g.addColorStop(0, '#D4A017'); g.addColorStop(0.55, '#F2C14E'); g.addColorStop(1, '#D4A017');
      ctx.fillStyle = g; ctx.fill(); ctx.restore();
      ctx.fillStyle = '#0B1229'; ctx.textAlign = 'center';
      ctx.fillText(pillTxt, px + pw / 2, y + pillH / 2 + 15 * S);
    }});
    if (fechaSorteo) secciones.push({ h: hFecha, draw: (y) => {
      const tw = ctx.measureText('\u{1F4C5}  ' + fechaSorteo).width;
      const bw = Math.min(tw + 70 * S, contentW), bx = (W - bw) / 2, bh = 46 * S;
      rr(ctx, bx, y, bw, bh, bh / 2);
      ctx.lineWidth = 2 * S; ctx.strokeStyle = '#F2C14E'; ctx.stroke();
      ctx.fillStyle = '#F2C14E'; ctx.font = `${26 * S}px ${FB}`; ctx.textAlign = 'center';
      ctx.fillText('\u{1F4C5}  ' + fechaSorteo, W / 2, y + 32 * S);
    }});
    if (empresa.nombre_empresa) secciones.push({ h: hEmp, draw: (y) => {
      ctx.fillStyle = '#F2C14E'; ctx.font = `${26 * S}px ${FB}`; ctx.textAlign = 'center';
      ctx.fillText(empresa.nombre_empresa, W / 2, y + 24 * S);
    }});
    if (rifa.descripcion) secciones.push({ h: hDesc, draw: (y) => {
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `${20 * S}px ${F}`; ctx.textAlign = 'center';
      descLines.forEach((l, i) => ctx.fillText(l, W / 2, y + 30 * S * (i + 0.8)));
    }});
    secciones.push({ h: barBlockH, draw: (y) => {
      const barH = 20 * S;
      rr(ctx, M, y, contentW, barH, barH / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fill();
      const wf = Math.max(barH, (contentW * Math.min(100, pct)) / 100);
      rr(ctx, M, y, wf, barH, barH / 2);
      const gb = ctx.createLinearGradient(M, 0, M + contentW, 0);
      gb.addColorStop(0, '#D4A017'); gb.addColorStop(1, '#F2C14E');
      ctx.fillStyle = gb; ctx.fill();
      ctx.font = `${22 * S}px ${FB}`; ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center';
      ctx.fillText(Math.round(pct) + '% vendido  \u00b7  Quedan ' + quedan, W / 2, y + barH + 32 * S);
    }});
    if (imgQr) secciones.push({ h: qrBlockH, draw: (y) => {
      const qs = 130 * S, pad = 16 * S, boxS = qs + pad * 2;
      const boxX = (W - boxS) / 2;
      rr(ctx, boxX, y, boxS, boxS, 16 * S);
      ctx.fillStyle = '#FFFFFF'; ctx.fill();
      ctx.drawImage(imgQr, boxX + pad, y + pad, qs, qs);
      ctx.font = `${16 * S}px ${F}`; ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.textAlign = 'center';
      ctx.fillText('Verifica tu numero', W / 2, y + boxS + 20 * S);
    }});

    // Distribuir para llenar todo el alto (justify) hasta antes del pie
    const footerY = H - 64 * S;
    const totalH = secciones.reduce((s, x) => s + x.h, 0);
    const disponible = (footerY - M) - totalH;
    const gap = secciones.length > 1 ? Math.max(8 * S, disponible / (secciones.length - 1)) : 0;
    let y = M;
    for (const sec of secciones) { await sec.draw(y); y += sec.h + gap; }

    // ---- Pie: contacto + logo ----
    if (empresa.telefono) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#F2C14E'; ctx.font = `${26 * S}px ${FB}`;
      ctx.fillText(empresa.telefono, W / 2, footerY + 20 * S);
    }
    const archivoLogo = urlAArchivo(empresa.logo_path);
    if (archivoLogo && fs.existsSync(archivoLogo)) {
      try {
        const logo = await loadImage(archivoLogo);
        const lh = 38 * S, lw = (logo.width / logo.height) * lh;
        ctx.drawImage(logo, M, footerY - lh, Math.min(lw, 150 * S), lh);
      } catch (e) {}
    }

    // Guardar PNG
    const nombreArchivo = `poster-rifa-${rifa.id}.png`;
    const rutaFinal = path.join(__dirname, 'uploads', nombreArchivo);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(rutaFinal, buffer);

    db.prepare('UPDATE rifas SET poster_image_url = ? WHERE id = ?').run(`/uploads/${nombreArchivo}`, rifa.id);
    registrarHistorial(rifa.id, 'poster', `Poster promocional ${W * ESCALA}x${H * ESCALA} generado`);

    res.json({ ok: true, url: `/uploads/${nombreArchivo}`, rifaId: rifa.id });
  } catch (err) {
    console.error('[POSTER]', err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------- PLANTILLAS DE WHATSAPP (TAREA 5.2) ------------------------

app.get('/api/plantillas', (req, res) => {
  res.json(db.prepare('SELECT * FROM plantillas_whatsapp ORDER BY nombre ASC').all());
});

app.get('/api/plantillas/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM plantillas_whatsapp WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Plantilla no encontrada' });
  res.json(t);
});

app.post('/api/plantillas', (req, res) => {
  const { nombre, contenido } = req.body;
  if (!nombre || !contenido) return res.status(400).json({ error: 'Nombre y contenido son obligatorios' });
  try {
    const info = db.prepare('INSERT INTO plantillas_whatsapp (nombre, contenido) VALUES (?,?)').run(nombre.trim(), contenido);
    res.status(201).json(db.prepare('SELECT * FROM plantillas_whatsapp WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(409).json({ error: e.message.includes('UNIQUE') ? 'Ya existe una plantilla con ese nombre' : e.message });
  }
});

app.put('/api/plantillas/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM plantillas_whatsapp WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Plantilla no encontrada' });
  const { nombre, contenido } = req.body;
  db.prepare('UPDATE plantillas_whatsapp SET nombre=?, contenido=? WHERE id=?')
    .run(nombre ?? t.nombre, contenido ?? t.contenido, req.params.id);
  res.json(db.prepare('SELECT * FROM plantillas_whatsapp WHERE id = ?').get(req.params.id));
});

app.delete('/api/plantillas/:id', (req, res) => {
  db.prepare('DELETE FROM plantillas_whatsapp WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------------- WHATSAPP MARKETING (TAREA 5) -----------------------------

// Conexión y estado del WhatsApp conectado
app.get('/api/whatsapp/status', (req, res) => {
  res.json(whatsapp.estadoActual());
});

app.get('/api/whatsapp/qr', (req, res) => {
  const est = whatsapp.estadoActual();
  if (est.status !== 'waiting_scan' || !est.qr) return res.status(400).json({ error: 'No hay QR disponible aún' });
  res.json({ qr: est.qr });
});

app.post('/api/whatsapp/conectar', async (req, res) => {
  try {
    const est = await whatsapp.conectar();
    res.json(est);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/whatsapp/desconectar', async (req, res) => {
  res.json(await whatsapp.desconectar());
});

// Envío masivo personalizado 1 a 1 (job en segundo plano con 5s de delay)
app.post('/api/rifas/:id/whatsapp/enviar', async (req, res) => {
  const { participante_ids, plantilla_id } = req.body;
  if (!plantilla_id) return res.status(400).json({ error: 'Selecciona una plantilla' });
  const r = await whatsapp.lanzarEnvio(db, Number(req.params.id), Number(plantilla_id), participante_ids);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

// Estado del job + historial de envíos
app.get('/api/rifas/:id/whatsapp/envios', (req, res) => {
  const job = whatsapp.estadoJob(Number(req.params.id));
  const logs = db.prepare(`
    SELECT e.*, p.nombre
    FROM envios_whatsapp e LEFT JOIN participantes p ON p.id = e.participante_id
    WHERE e.rifa_id = ? ORDER BY e.fecha DESC LIMIT 200
  `).all(req.params.id);
  res.json({ job, logs });
});

// Texto listo para copiar y pegar en un grupo / difusión
app.post('/api/rifas/:id/whatsapp/enlace-grupo', (req, res) => {
  const r = whatsapp.textoEnlaceGrupo(db, Number(req.params.id), Number(req.body.plantilla_id));
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

// -------------------------------- EXPORTAR / QR / PÚBLICO ----------------------

// Exportar Excel
app.get('/api/rifas/:id/exportar-excel', (req, res) => {
  try {
    const rifa = getRifa(req.params.id);
    if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
    const filas = db.prepare('SELECT * FROM participantes WHERE rifa_id=? ORDER BY numero ASC').all(req.params.id);
    const pagados = filas.filter(f => f.estado_pago === 'pagado').length;
    const pendientes = filas.filter(f => f.estado_pago === 'pendiente').length;

    const datos = filas.map(f => {
      const nums = numsBoleta(f);
      return {
        'Nombre': f.nombre,
        'Cédula': f.cedula,
        'Teléfono': f.telefono || '',
        'Números': nums.map(n => fmtNumero(rifa, n)).join(', '),
        'Estado Pago': f.estado_pago === 'pagado' ? 'Pagado' : 'Pendiente',
        'Valor Boleta': rifa.valor_boleta,
        'Valor Total': nums.length * rifa.valor_boleta,
        'Fecha Registro': f.fecha_registro || '',
        'Fecha Pago': f.fecha_pago || '',
        'Modalidad': rifa.modalidad_boleta
      };
    });

    // Hoja de resumen
    const resumen = [
      { Concepto: 'Rifa', Valor: rifa.nombre },
      { Concepto: 'Total Participantes', Valor: filas.length },
      { Concepto: 'Pagados', Valor: pagados },
      { Concepto: 'Pendientes', Valor: pendientes },
      { Concepto: 'Recaudado', Valor: `$${(pagados * rifa.valor_boleta).toLocaleString('es-CO')}` },
      { Concepto: 'Por Cobrar', Valor: `$${(pendientes * rifa.valor_boleta).toLocaleString('es-CO')}` },
      { Concepto: 'Modalidad', Valor: rifa.modalidad_boleta },
      { Concepto: 'Fecha Sorteo', Valor: rifa.fecha_sorteo || 'Sin definir' },
      { Concepto: 'Exportado', Valor: new Date().toLocaleString('es-CO') }
    ];

    const wsParticipantes = XLSX.utils.json_to_sheet(datos);
    const wsResumen = XLSX.utils.json_to_sheet(resumen);

    // Auto-ancho de columnas
    const colWidths = Object.keys(datos[0] || {}).map(key => ({
      wch: Math.max(key.length, ...datos.map(d => String(d[key] || '').length)) + 2
    }));
    wsParticipantes['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');
    XLSX.utils.book_append_sheet(wb, wsParticipantes, 'Participantes');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename="rifa-${rifa.id}-participantes.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Exportar como CSV
app.get('/api/rifas/:id/exportar-csv', (req, res) => {
  try {
    const rifa = getRifa(req.params.id);
    if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
    const filas = db.prepare('SELECT * FROM participantes WHERE rifa_id=? ORDER BY numero ASC').all(req.params.id);

    const header = 'Nombre,Cédula,Teléfono,Números,Estado Pago,Valor Boleta,Fecha Registro\n';
    const rows = filas.map(f => {
      const nums = numsBoleta(f);
      return `"${f.nombre}","${f.cedula}","${f.telefono || ''}","${nums.map(n => fmtNumero(rifa, n)).join('; ')}",${f.estado_pago},${rifa.valor_boleta},"${f.fecha_registro || ''}"`;
    }).join('\n');

    res.setHeader('Content-Disposition', `attachment; filename="rifa-${rifa.id}-participantes.csv"`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send('\uFEFF' + header + rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Página pública de verificación de sorteo
app.get('/public/rifa/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'public', 'verificar.html'));
});

// QR del link público
app.get('/api/rifas/:id/qr', async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}/public/rifa/${req.params.id}`;
  try {
    const png = await QRCode.toBuffer(url, { width: 400, margin: 1 });
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo generar el QR' });
  }
});

// Datos públicos de la rifa (SIN cédula, para transparencia)
app.get('/api/public/rifa/:id', (req, res) => {
  const rifa = db.prepare('SELECT id, nombre, producto, descripcion, valor_boleta, imagen_producto, banner_empresa, fecha_sorteo, hora_sorteo, estado, rango_min, rango_max, cantidad_max_participantes, modalidad_boleta, simbolos, premio1_nombre, premio2_nombre, premio3_nombre, premio4_nombre, cifras, draw_result FROM rifas WHERE id = ? AND borrada_en IS NULL').get(req.params.id);
  if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });
  const esChancePub = esChance(rifa);
  let numeros = [];
  let boletas = [];
  let simbolos = [];
  if (esChancePub) {
    boletas = db.prepare(`
      SELECT bc.numero, bc.simbolo, bc.estado,
        CASE WHEN bc.estado != 'libre' THEN p.nombre ELSE NULL END as nombre
      FROM boletas_chance bc LEFT JOIN participantes p ON p.id = bc.participante_id
      WHERE bc.rifa_id = ? ORDER BY bc.numero ASC, bc.simbolo ASC
    `).all(req.params.id).map(b => ({ ...b, numero: padChance(rifa, b.numero), label: ticketLabel(padChance(rifa, b.numero), b.simbolo) }));
    simbolos = simbolosRifa(rifa);
  } else {
    numeros = db.prepare(`
      SELECT n.numero, n.estado,
        CASE WHEN n.estado != 'libre' THEN p.nombre ELSE NULL END as nombre
      FROM numeros n LEFT JOIN participantes p ON p.id = n.participante_id
      WHERE n.rifa_id = ? ORDER BY n.numero ASC
    `).all(req.params.id).map(n => ({ ...n, numero: fmtNumero(rifa, n.numero) }));
  }
  const ganadores = rifa.estado === 'sorteada'
    ? db.prepare('SELECT numero, simbolo, nombre, modalidad, semilla, fecha, premio, premio_tipo FROM ganadores WHERE rifa_id = ? ORDER BY fecha DESC').all(req.params.id).map(g => ({ ...g, numero: fmtNumero(rifa, g.numero) }))
    : [];
  const empresa = db.prepare('SELECT nombre_empresa, logo_path, color_marca FROM empresa WHERE id = 1').get();
  res.json({ rifa, numeros, boletas, simbolos, ganadores, empresa });
});

// -------------------------------- BACKUP ------------------------------------

app.get('/api/backup', async (req, res) => {
  try {
    // Volcar lo último a disco antes de empaquetar
    if (typeof db._save === 'function') db._save();
    const fecha = new Date().toISOString().slice(0, 10);
    const archive = archiver('zip', { zlib: { level: 9 } });
    res.attachment(`backup-rifas-${fecha}.zip`);
    archive.on('warning', (err) => { if (err.code !== 'ENOENT') console.warn('[BACKUP]', err); });
    archive.on('error', (err) => console.error('[BACKUP]', err));
    archive.pipe(res);
    archive.append(fs.createReadStream(dbPath), { name: 'rifas.db' });
    if (fs.existsSync(uploadsDir)) archive.directory(uploadsDir, 'uploads');
    await archive.finalize();
  } catch (err) {
    console.error('[BACKUP]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar el backup: ' + err.message });
  }
});

// -------------------------------- RESTORE -----------------------------------

app.post('/api/restore', requireRole('super_admin'), uploadDb.single('backup'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se envió archivo' });

  const esZip = /\.zip$/i.test(req.file.originalname || '') || (req.file.mimetype || '').includes('zip');
  const tmpDir = path.join(__dirname, '.restore-tmp-' + Date.now());

  try {
    // Volcar y cerrar conexión actual
    if (typeof db._save === 'function') db._save();
    db.close();

    if (esZip) {
      // Extraer el .zip (rifas.db + uploads/) en un directorio temporal
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpZip = path.join(tmpDir, 'backup.zip');
      fs.writeFileSync(tmpZip, req.file.buffer);
      await new Promise((resolve, reject) => {
        fs.createReadStream(tmpZip)
          .pipe(unzipper.Extract({ path: tmpDir }))
          .on('close', resolve)
          .on('error', reject);
      });
      const dbExtraido = path.join(tmpDir, 'rifas.db');
      if (!fs.existsSync(dbExtraido)) throw new Error('El archivo .zip no contiene rifas.db');
      // Reemplazar la base de datos
      fs.copyFileSync(dbExtraido, dbPath);
      // Volcar las imágenes/pósters sobre uploads/
      const uploadsExtraido = path.join(tmpDir, 'uploads');
      if (fs.existsSync(uploadsExtraido)) {
        for (const f of fs.readdirSync(uploadsExtraido)) {
          fs.copyFileSync(path.join(uploadsExtraido, f), path.join(uploadsDir, f));
        }
      }
    } else {
      // Respaldo clásico: solo el .db
      fs.writeFileSync(dbPath, req.file.buffer);
    }

    // Reiniciar conexión
    db = await initDB();
    ensureSchema(db);

    console.log('[RESTORE] Base de datos restaurada correctamente');
    res.json({ ok: true, mensaje: 'Base de datos restaurada correctamente' });
  } catch (err) {
    console.error('[RESTORE] Error:', err.message);
    // Intentar recuperar la conexión
    try {
      db = await initDB();
      ensureSchema(db);
    } catch (_) {}
    res.status(500).json({ error: 'Error al restaurar: ' + err.message });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// -------------------------------- FALLBACK SPA -------------------------------

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// -------------------------------- ARRANQUE ------------------------------------

function intentarPuerto(puerto) {
  const server = app.listen(puerto, () => {
    console.log(`\n[SERVER] Rifas SYC corriendo en http://localhost:${puerto}`);
    console.log(`[SERVER] Base de datos SQLite en: ${dbPath}\n`);
    purgarPapeleraVencida();
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[SERVER] Puerto ${puerto} ocupado, intentando ${puerto + 1}...`);
      intentarPuerto(puerto + 1);
    } else {
      console.error('[SERVER] Error fatal:', err);
      process.exit(1);
    }
  });
}
intentarPuerto(PORT_BASE);

// Revisión periódica de números vencidos (cada 10 minutos) para todas las rifas activas
setInterval(() => {
  const activas = db.prepare("SELECT id FROM rifas WHERE estado='activa'").all();
  activas.forEach(r => liberarVencidos(r.id));
}, 10 * 60 * 1000);

// Purge automático de papelera: rifas eliminadas hace >30 días se borran permanentemente (cada 24h)
function purgarPapeleraVencida() {
  try {
    const vencidas = db.prepare("SELECT id, nombre FROM rifas WHERE borrada_en IS NOT NULL AND borrada_en < datetime('now', '-30 days', 'localtime')").all();
    if (vencidas.length === 0) return;
    console.log(`[Papelera] Purgando ${vencidas.length} rifa(s) vencida(s)...`);
    const purgar = db.transaction(() => {
      for (const r of vencidas) {
        registrarLog('purga-automatica', 'rifa', r.id, r.nombre, `Purgada automáticamente (más de 30 días en papelera)`);
      }
      db.prepare("DELETE FROM participantes WHERE rifa_id IN (SELECT id FROM rifas WHERE borrada_en IS NOT NULL AND borrada_en < datetime('now', '-30 days', 'localtime'))").run();
      db.prepare("DELETE FROM numeros WHERE rifa_id IN (SELECT id FROM rifas WHERE borrada_en IS NOT NULL AND borrada_en < datetime('now', '-30 days', 'localtime'))").run();
      db.prepare("DELETE FROM boletas_chance WHERE rifa_id IN (SELECT id FROM rifas WHERE borrada_en IS NOT NULL AND borrada_en < datetime('now', '-30 days', 'localtime'))").run();
      db.prepare("DELETE FROM ganadores WHERE rifa_id IN (SELECT id FROM rifas WHERE borrada_en IS NOT NULL AND borrada_en < datetime('now', '-30 days', 'localtime'))").run();
      const info = db.prepare("DELETE FROM rifas WHERE borrada_en IS NOT NULL AND borrada_en < datetime('now', '-30 days', 'localtime')").run();
      console.log(`[Papelera] ${info.changes} rifa(s) purgada(s) definitivamente.`);
    });
    purgar();
  } catch (e) { console.error('[Papelera] Error en purge automático:', e.message); }
}
setInterval(purgarPapeleraVencida, 24 * 60 * 60 * 1000);

} // fin startApp()

startApp().catch(err => { console.error('[FATAL]', err); process.exit(1); });

