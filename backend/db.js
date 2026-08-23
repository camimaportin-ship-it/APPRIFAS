// db.js
// -----------------------------------------------------------------------------
// Conexión a SQLite (better-sqlite3, síncrono y muy rápido, ideal para apps
// locales/offline-first) + creación de todo el esquema si no existe.
// -----------------------------------------------------------------------------
const path = require('path');
const Database = require('better-sqlite3');

// La base de datos vive en /data/rifas.db para poder respaldarla fácilmente
// con el botón "Descargar Base de Datos .db"
const dbPath = path.join(__dirname, '..', 'data', 'rifas.db');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL'); // mejor rendimiento con escrituras concurrentes
db.pragma('foreign_keys = ON');

// ------------------------------- ESQUEMA ------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS empresa (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nombre_empresa TEXT DEFAULT 'Mi Empresa',
  logo_path TEXT,
  telefono TEXT,
  color_marca TEXT DEFAULT '#D4A017'
);
INSERT OR IGNORE INTO empresa (id, nombre_empresa) VALUES (1, 'Mi Empresa');

-- Config general (key-value) para VAPID keys, etc.
CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  email TEXT UNIQUE,
  rol TEXT DEFAULT 'admin',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS rifas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  valor_boleta INTEGER NOT NULL,
  producto TEXT NOT NULL,
  descripcion TEXT,
  fecha_sorteo TEXT NOT NULL,
  hora_sorteo TEXT,
  imagen_producto TEXT,
  banner_empresa TEXT,
  cantidad_max_participantes INTEGER NOT NULL,
  rango_min INTEGER NOT NULL DEFAULT 0,
  rango_max INTEGER NOT NULL,
  tipo_rifa TEXT NOT NULL DEFAULT 'aleatoria', -- aleatoria | loteria | tapazo | ruleta
  mensaje_whatsapp TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador', -- borrador | activa | cerrada | sorteada
  auto_liberar_horas INTEGER DEFAULT 24,
  grupos_numeros TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS numeros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rifa_id INTEGER NOT NULL REFERENCES rifas(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'libre', -- libre | pendiente | pagado
  participante_id INTEGER,
  fecha_reservado TEXT,
  UNIQUE(rifa_id, numero)
);

CREATE TABLE IF NOT EXISTS participantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rifa_id INTEGER NOT NULL REFERENCES rifas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  cedula TEXT NOT NULL,
  telefono TEXT,
  numero INTEGER NOT NULL,
  estado_pago TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | pagado
  fecha_registro TEXT DEFAULT (datetime('now','localtime')),
  fecha_pago TEXT
);

CREATE TABLE IF NOT EXISTS ganadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rifa_id INTEGER NOT NULL REFERENCES rifas(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  participante_id INTEGER,
  nombre TEXT,
  modalidad TEXT NOT NULL, -- ruleta | aleatorio | loteria | tapazo
  semilla TEXT NOT NULL,
  detalle_loteria TEXT,
  fecha TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS historial (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rifa_id INTEGER NOT NULL REFERENCES rifas(id) ON DELETE CASCADE,
  accion TEXT NOT NULL,
  detalle TEXT,
  fecha TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_numeros_rifa ON numeros(rifa_id);
CREATE INDEX IF NOT EXISTS idx_numeros_participante ON numeros(participante_id);
CREATE INDEX IF NOT EXISTS idx_participantes_rifa ON participantes(rifa_id);
CREATE INDEX IF NOT EXISTS idx_participantes_cedula ON participantes(rifa_id, cedula);

-- ------------------------- ESQUEMA V2 (PROMPT V8.0) --------------------------
CREATE TABLE IF NOT EXISTS plantillas_whatsapp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  contenido TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS envios_whatsapp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rifa_id INTEGER NOT NULL REFERENCES rifas(id) ON DELETE CASCADE,
  participante_id INTEGER REFERENCES participantes(id) ON DELETE SET NULL,
  telefono TEXT,
  plantilla_id INTEGER REFERENCES plantillas_whatsapp(id) ON DELETE SET NULL,
  mensaje TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | enviado | reintento | error
  intentos INTEGER DEFAULT 0,
  error TEXT,
  fecha TEXT DEFAULT (datetime('now','localtime'))
);

INSERT OR IGNORE INTO plantillas_whatsapp (nombre, contenido) VALUES
('Confirmación de Compra', '🎉 ¡FELICIDADES {{nombre}}! 🎉\nYa tienes tu(s) número(s) para la rifa de _{{rifa_nombre}}_ 🔥\nTu(s) número(s) son:\n👉 {{numeros}} 👈\nFecha del sorteo: 📅 {{fecha_sorteo}}\n¿Quieres ver tu boleta? Toca aquí: {{link_pago}}\n¡Mucha suerte! 🍀'),
('Difusión Masiva', '🚨 ULTIMAS BOLETAS 🚨\nQuedan solo {{numeros_disponibles}} boletas para la rifa de _{{rifa_nombre}}_ 🔥\nBoleta: {{valor_boleta}} COP\nNúmeros disponibles: {{numeros_disponibles_lista}}\nCompra ya 👇\n{{link_rifa}}'),
('Recordatorio de Pago', '⏰ Hola {{nombre}}, te recordamos que tu boleta de la rifa de _{{rifa_nombre}}_ sigue pendiente de pago.\nNúmero(s): 👉 {{numeros}} 👈\nValor: {{valor_boleta}} COP\nFecha del sorteo: 📅 {{fecha_sorteo}}\nPaga aquí: {{link_pago}} 💳\n¡No pierdas tu número! 🍀');
`);

// ----------------------- MIGRACIONES INCREMENTALES (V1 -> V2) -----------------------
// La base puede existir de la versión anterior: agregamos columnas nuevas si faltan.
function tieneColumna(tabla, columna) {
  return db.pragma(`table_info(${tabla})`).some(c => c.name === columna);
}
if (!tieneColumna('rifas', 'modalidad_boleta')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN modalidad_boleta TEXT DEFAULT 'BOLETAS_NORMAL'`); // BOLETAS_NORMAL | CUATRO_OPORTUNIDADES
}
if (!tieneColumna('rifas', 'modo_asignacion')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN modo_asignacion TEXT DEFAULT 'AL_AZAR'`); // AL_AZAR | A_ELECCION
}
if (!tieneColumna('rifas', 'poster_image_url')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN poster_image_url TEXT`);
}
if (!tieneColumna('participantes', 'numeros')) {
  db.exec(`ALTER TABLE participantes ADD COLUMN numeros TEXT`); // JSON array de números de la boleta (4 en CUATRO_OPORTUNIDADES)
}

// ----------------------- MIGRACIÓN PAPELERA DE RECICLAJE -----------------------
// "Eliminar" una rifa la mueve a la papelera (soft delete). Restaurar la devuelve.
// Solo se borra de verdad (purga) de forma manual desde la papelera.
if (!tieneColumna('rifas', 'borrada_en')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN borrada_en TEXT`); // NULL = activa, con fecha = en papelera
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_rifas_borrada ON rifas(borrada_en)`);

// ----------------------- MIGRACIÓN HORA DEL SORTEO -----------------------
// Las rifas virtuales (ruleta en vivo / balotera) pueden indicar la hora exacta.
if (!tieneColumna('rifas', 'hora_sorteo')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN hora_sorteo TEXT`); // HH:MM opcional
}

// -------------------- MIGRACIÓN GRUPOS DE 4 OPORTUNIDADES --------------------
// Almacena los grupos pre-generados (JSON) de números 00-99 para rifas de
// 4 Oportunidades: 25 grupos de 4 números aleatorios, sin repetir y sin que
// queden números muy seguidos entre sí.
if (!tieneColumna('rifas', 'grupos_numeros')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN grupos_numeros TEXT`);
}

// ------------------ MIGRACIÓN MÚLTIPLES OPORTUNIDADES (2/4/5) -----------------
// Cantidad de números que compra cada boleta en modalidad CUATRO_OPORTUNIDADES
// (ahora "múltiples oportunidades"): 2, 4 o 5. Se mantiene 4 como valor por
// defecto para no romper las rifas existentes.
if (!tieneColumna('rifas', 'n_oportunidades')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN n_oportunidades INTEGER DEFAULT 4`); // 2 | 4 | 5
}

// -------------------- MIGRACIÓN CHANCE CON SÍMBOLO ---------------------------
// Modalidad de boleta "CHANCE_CON_SIMBOLO": 100 números (00-99) x N símbolos.
// La boleta es la combinación (número, símbolo). Cada símbolo tiene su propio
// sorteo de 4 cifras y el premio se define con las últimas 2 cifras.
if (!tieneColumna('rifas', 'simbolos')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN simbolos TEXT`); // JSON array de emojis, ej: ["😁","🔥",...]
}
if (!tieneColumna('rifas', 'premio1_nombre')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN premio1_nombre TEXT DEFAULT 'Premio 1'`);
}
if (!tieneColumna('rifas', 'premio2_nombre')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN premio2_nombre TEXT DEFAULT 'Premio 2'`);
}
if (!tieneColumna('rifas', 'premio3_nombre')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN premio3_nombre TEXT DEFAULT 'Premio 3'`);
}
// Cifras que se sortean en el chance: 2 | 4 | 5. Con 5 cifras hay un 4º premio
// (Premio D = 4ª y 5ª cifra). Los premios siempre son grupos de 2 cifras seguidas.
if (!tieneColumna('rifas', 'cifras')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN cifras INTEGER DEFAULT 4`);
}
if (!tieneColumna('rifas', 'premio4_nombre')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN premio4_nombre TEXT DEFAULT 'Premio 4'`);
}
if (!tieneColumna('rifas', 'revancha_permitida')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN revancha_permitida INTEGER DEFAULT 0`); // 0 | 1
}
if (!tieneColumna('rifas', 'draw_result')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN draw_result TEXT`); // JSON con el resultado del chance (cifras, símbolo, premios)
}
if (!tieneColumna('participantes', 'simbolo')) {
  db.exec(`ALTER TABLE participantes ADD COLUMN simbolo TEXT`); // Símbolo de la boleta CHANCE
}
if (!tieneColumna('ganadores', 'simbolo')) {
  db.exec(`ALTER TABLE ganadores ADD COLUMN simbolo TEXT`);
}
if (!tieneColumna('ganadores', 'premio')) {
  db.exec(`ALTER TABLE ganadores ADD COLUMN premio TEXT`);
}
if (!tieneColumna('ganadores', 'premio_tipo')) {
  db.exec(`ALTER TABLE ganadores ADD COLUMN premio_tipo TEXT`); // A | B | C (chance)
}
if (!tieneColumna('ganadores', 'revancha')) {
  db.exec(`ALTER TABLE ganadores ADD COLUMN revancha INTEGER DEFAULT 0`);
}
if (!tieneColumna('rifas', 'categoria')) {
  db.exec(`ALTER TABLE rifas ADD COLUMN categoria TEXT DEFAULT ''`);
}

// Boletas del chance: una fila por (número 00-99, símbolo). La disponibilidad
// es por combinación, no por número suelto. 100 x N símbolos = N*100 boletas.
db.exec(`
CREATE TABLE IF NOT EXISTS boletas_chance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rifa_id INTEGER NOT NULL REFERENCES rifas(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  simbolo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'libre', -- libre | pendiente | pagado
  participante_id INTEGER,
  fecha_reservado TEXT,
  UNIQUE(rifa_id, numero, simbolo)
);
CREATE INDEX IF NOT EXISTS idx_boletas_chance_rifa ON boletas_chance(rifa_id);
CREATE INDEX IF NOT EXISTS idx_boletas_chance_participante ON boletas_chance(participante_id);
`);

// ----------------------- LOGS GLOBALES (AUDITORÍA) ---------------------------
// Registro global de todos los cambios (creación, edición, ventas, pagos,
// sorteos, papelera, etc.), independiente del historial por rifa: las filas se
// conservan aunque la rifa se purgue de la papelera (sin FK a rifas a propósito).
db.exec(`
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT DEFAULT (datetime('now','localtime')),
  accion TEXT NOT NULL,
  entidad TEXT DEFAULT 'rifa',
  rifa_id INTEGER,
  rifa_nombre TEXT,
  detalle TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_fecha ON logs(fecha);
CREATE INDEX IF NOT EXISTS idx_logs_rifa ON logs(rifa_id);
`);

// ----------------------- MIGRACIÓN AUTENTICACIÓN -----------------------------
// Agregar columnas de usuario y contraseña hasheada a la tabla usuarios.
if (!tieneColumna('usuarios', 'usuario')) {
  db.exec(`ALTER TABLE usuarios ADD COLUMN usuario TEXT`);
}
if (!tieneColumna('usuarios', 'password_hash')) {
  db.exec(`ALTER TABLE usuarios ADD COLUMN password_hash TEXT`);
}

// Insertar super-admins si no existen
const bcrypt = require('bcryptjs');
const admins = [
  { usuario: 'hans4269', nombre: 'Hans Admin', password: 'Rifas01234' },
  { usuario: 'sairaosorio78', nombre: 'Saira Admin', password: 'Rifas01234' }
];
const insertUser = db.prepare(
  `INSERT OR IGNORE INTO usuarios (usuario, nombre, password_hash, rol)
   VALUES (?, ?, ?, 'super_admin')`
);
for (const a of admins) {
  const hash = bcrypt.hashSync(a.password, 10);
  insertUser.run(a.usuario, a.nombre, hash);
}

// ----------------------- PUSH NOTIFICATIONS -----------------------------------
// Suscripciones Push de los dispositivos que aceptaron notificaciones.
db.exec(`
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  fecha TEXT DEFAULT (datetime('now','localtime')),
  activa INTEGER DEFAULT 1
);
`);

// ----------------------- NOTIFICACIONES --------------------------------------
// Registro de notificaciones enviadas (historial + evitar duplicados).
db.exec(`
CREATE TABLE IF NOT EXISTS notificaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,          -- nueva_venta, pago_pendiente, sorteo, sistema
  titulo TEXT NOT NULL,
  cuerpo TEXT,
  rifa_id INTEGER,
  enviada_en TEXT DEFAULT (datetime('now','localtime')),
  exitosa INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_notif_tipo ON notificaciones(tipo);
CREATE INDEX IF NOT EXISTS idx_notif_rifa ON notificaciones(rifa_id);
`);

module.exports = { db, dbPath };
