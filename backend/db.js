// db.js
// -----------------------------------------------------------------------------
// Capa de acceso a SQLite usando sql.js (WebAssembly puro, sin compilación
// nativa). Explica la misma API que better-sqlite3 para que server.js y
// whatsapp.js no necesiten cambios.
// -----------------------------------------------------------------------------
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const dbPath = path.join(__dirname, '..', 'data', 'rifas.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// ---- Wrapper que emula la API de better-sqlite3 sobre sql.js ---------------

class SqlJsWrapper {
  constructor(sqlJsDb) {
    this._db = sqlJsDb;
    this._path = dbPath;
    this._inTransaction = false;
  }

  // Ejecuta SQL sin retorno de resultados (DDL, DML multi-statement)
  exec(sql) {
    this._db.run(sql);
    if (!this._inTransaction) this._save();
  }

  // PRAGMA: retorna array de objetos (para table_info, etc.)
  pragma(sql) {
    const result = this._db.exec(`PRAGMA ${sql}`);
    if (result.length > 0) {
      const cols = result[0].columns;
      return result[0].values.map(row => {
        const obj = {};
        cols.forEach((c, i) => { obj[c] = row[i]; });
        return obj;
      });
    }
    return [];
  }

  // Retorna un objeto Statement compatible con better-sqlite3
  prepare(sql) {
    return new StatementWrapper(this, sql);
  }

  // Transacciones: db.transaction(fn) retorna una función que ejecuta fn
  // dentro de BEGIN…COMMIT y hace rollback si hay error.
  transaction(fn) {
    const self = this;
    return function (...args) {
      self._inTransaction = true;
      self._db.run('BEGIN IMMEDIATE');
      try {
        const result = fn(...args);
        self._db.run('COMMIT');
        self._inTransaction = false;
        self._save();
        return result;
      } catch (err) {
        self._db.run('ROLLBACK');
        self._inTransaction = false;
        throw err;
      }
    };
  }

  // Persistir a disco
  _save() {
    try {
      const data = this._db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this._path, buffer);
    } catch (e) {
      console.error('[DB] Error guardando:', e.message);
    }
  }

  close() {
    this._save();
    this._db.close();
  }
}

class StatementWrapper {
  constructor(wrapper, sql) {
    this._wrapper = wrapper;
    this._sql = sql;
  }

  // Un solo registro
  get(...params) {
    const stmt = this._wrapper._db.prepare(this._sql);
    if (params.length > 0) stmt.bind(params);
    let result;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result || undefined;
  }

  // Todos los registros
  all(...params) {
    const results = [];
    const stmt = this._wrapper._db.prepare(this._sql);
    if (params.length > 0) stmt.bind(params);
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  // Ejecutar (INSERT/UPDATE/DELETE), retorna { changes, lastInsertRowid }
  run(...params) {
    this._wrapper._db.run(this._sql, params.length > 0 ? params : undefined);
    const changes = this._wrapper._db.getRowsModified();
    let lastInsertRowid = 0;
    try {
      const r = this._wrapper._db.exec('SELECT last_insert_rowid() AS id');
      if (r.length > 0 && r[0].values.length > 0) lastInsertRowid = r[0].values[0][0];
    } catch (e) { /* ignorar */ }
    if (!this._wrapper._inTransaction) this._wrapper._save();
    return { changes, lastInsertRowid };
  }
}

// ---- Inicialización asincrónica (carga WASM) --------------------------------

async function initDB() {
  const SQL = await initSqlJs();
  let rawDb;
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    rawDb = new SQL.Database(buffer);
  } else {
    rawDb = new SQL.Database();
  }
  const db = new SqlJsWrapper(rawDb);
  return db;
}

// ---- Esquema + migraciones -------------------------------------------------

function tieneColumna(db, tabla, columna) {
  return db.pragma(`table_info(${tabla})`).some(c => c.name === columna);
}

function ensureSchema(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS empresa (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nombre_empresa TEXT DEFAULT 'Mi Empresa',
  logo_path TEXT,
  telefono TEXT,
  color_marca TEXT DEFAULT '#D4A017'
);
INSERT OR IGNORE INTO empresa (id, nombre_empresa) VALUES (1, 'Mi Empresa');

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
  tipo_rifa TEXT NOT NULL DEFAULT 'aleatoria',
  mensaje_whatsapp TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador',
  auto_liberar_horas INTEGER DEFAULT 24,
  grupos_numeros TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS numeros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rifa_id INTEGER NOT NULL,
  numero INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'libre',
  participante_id INTEGER,
  fecha_reservado TEXT,
  UNIQUE(rifa_id, numero)
);

CREATE TABLE IF NOT EXISTS participantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rifa_id INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  cedula TEXT NOT NULL,
  telefono TEXT,
  numero INTEGER NOT NULL,
  estado_pago TEXT NOT NULL DEFAULT 'pendiente',
  fecha_registro TEXT DEFAULT (datetime('now','localtime')),
  fecha_pago TEXT
);

CREATE TABLE IF NOT EXISTS ganadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rifa_id INTEGER NOT NULL,
  numero INTEGER NOT NULL,
  participante_id INTEGER,
  nombre TEXT,
  modalidad TEXT NOT NULL,
  semilla TEXT NOT NULL,
  detalle_loteria TEXT,
  fecha TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS historial (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rifa_id INTEGER NOT NULL,
  accion TEXT NOT NULL,
  detalle TEXT,
  fecha TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_numeros_rifa ON numeros(rifa_id);
CREATE INDEX IF NOT EXISTS idx_numeros_participante ON numeros(participante_id);
CREATE INDEX IF NOT EXISTS idx_participantes_rifa ON participantes(rifa_id);
CREATE INDEX IF NOT EXISTS idx_participantes_cedula ON participantes(rifa_id, cedula);

CREATE TABLE IF NOT EXISTS plantillas_whatsapp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  contenido TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS envios_whatsapp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rifa_id INTEGER NOT NULL,
  participante_id INTEGER,
  telefono TEXT,
  plantilla_id INTEGER,
  mensaje TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  intentos INTEGER DEFAULT 0,
  error TEXT,
  fecha TEXT DEFAULT (datetime('now','localtime'))
);
`);

  const plantillas = db.prepare("SELECT COUNT(*) c FROM plantillas_whatsapp").get().c;
  if (plantillas === 0) {
    db.exec(`INSERT INTO plantillas_whatsapp (nombre, contenido) VALUES
('Confirmación de Compra', '🎉 ¡FELICIDADES {{nombre}}! 🎉\nYa tienes tu(s) número(s) para la rifa de _{{rifa_nombre}}_ 🔥\nTu(s) número(s) son:\n👉 {{numeros}} 👈\nFecha del sorteo: 📅 {{fecha_sorteo}}\n¿Quieres ver tu boleta? Toca aquí: {{link_pago}}\n¡Mucha suerte! 🍀'),
('Difusión Masiva', '🚨 ULTIMAS BOLETAS 🚨\nQuedan solo {{numeros_disponibles}} boletas para la rifa de _{{rifa_nombre}}_ 🔥\nBoleta: {{valor_boleta}} COP\nNúmeros disponibles: {{numeros_disponibles_lista}}\nCompra ya 👇\n{{link_rifa}}'),
('Recordatorio de Pago', '⏰ Hola {{nombre}}, te recordamos que tu boleta de la rifa de _{{rifa_nombre}}_ sigue pendiente de pago.\nNúmero(s): 👉 {{numeros}} 👈\nValor: {{valor_boleta}} COP\nFecha del sorteo: 📅 {{fecha_sorteo}}\nPaga aquí: {{link_pago}} 💳\n¡No pierdas tu número! 🍀');`);
  }

  // Migraciones incrementales
  if (!tieneColumna(db, 'rifas', 'modalidad_boleta'))
    db.exec(`ALTER TABLE rifas ADD COLUMN modalidad_boleta TEXT DEFAULT 'BOLETAS_NORMAL'`);
  if (!tieneColumna(db, 'rifas', 'modo_asignacion'))
    db.exec(`ALTER TABLE rifas ADD COLUMN modo_asignacion TEXT DEFAULT 'AL_AZAR'`);
  if (!tieneColumna(db, 'rifas', 'poster_image_url'))
    db.exec(`ALTER TABLE rifas ADD COLUMN poster_image_url TEXT`);
  if (!tieneColumna(db, 'participantes', 'numeros'))
    db.exec(`ALTER TABLE participantes ADD COLUMN numeros TEXT`);
  if (!tieneColumna(db, 'rifas', 'borrada_en'))
    db.exec(`ALTER TABLE rifas ADD COLUMN borrada_en TEXT`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rifas_borrada ON rifas(borrada_en)`);
  if (!tieneColumna(db, 'rifas', 'hora_sorteo'))
    db.exec(`ALTER TABLE rifas ADD COLUMN hora_sorteo TEXT`);
  if (!tieneColumna(db, 'rifas', 'grupos_numeros'))
    db.exec(`ALTER TABLE rifas ADD COLUMN grupos_numeros TEXT`);
  if (!tieneColumna(db, 'rifas', 'n_oportunidades'))
    db.exec(`ALTER TABLE rifas ADD COLUMN n_oportunidades INTEGER DEFAULT 4`);
  if (!tieneColumna(db, 'rifas', 'simbolos'))
    db.exec(`ALTER TABLE rifas ADD COLUMN simbolos TEXT`);
  if (!tieneColumna(db, 'rifas', 'premio1_nombre'))
    db.exec(`ALTER TABLE rifas ADD COLUMN premio1_nombre TEXT DEFAULT 'Premio 1'`);
  if (!tieneColumna(db, 'rifas', 'premio2_nombre'))
    db.exec(`ALTER TABLE rifas ADD COLUMN premio2_nombre TEXT DEFAULT 'Premio 2'`);
  if (!tieneColumna(db, 'rifas', 'premio3_nombre'))
    db.exec(`ALTER TABLE rifas ADD COLUMN premio3_nombre TEXT DEFAULT 'Premio 3'`);
  if (!tieneColumna(db, 'rifas', 'cifras'))
    db.exec(`ALTER TABLE rifas ADD COLUMN cifras INTEGER DEFAULT 4`);
  if (!tieneColumna(db, 'rifas', 'premio4_nombre'))
    db.exec(`ALTER TABLE rifas ADD COLUMN premio4_nombre TEXT DEFAULT 'Premio 4'`);
  if (!tieneColumna(db, 'rifas', 'revancha_permitida'))
    db.exec(`ALTER TABLE rifas ADD COLUMN revancha_permitida INTEGER DEFAULT 0`);
  if (!tieneColumna(db, 'rifas', 'draw_result'))
    db.exec(`ALTER TABLE rifas ADD COLUMN draw_result TEXT`);
  if (!tieneColumna(db, 'participantes', 'simbolo'))
    db.exec(`ALTER TABLE participantes ADD COLUMN simbolo TEXT`);
  if (!tieneColumna(db, 'ganadores', 'simbolo'))
    db.exec(`ALTER TABLE ganadores ADD COLUMN simbolo TEXT`);
  if (!tieneColumna(db, 'ganadores', 'premio'))
    db.exec(`ALTER TABLE ganadores ADD COLUMN premio TEXT`);
  if (!tieneColumna(db, 'ganadores', 'premio_tipo'))
    db.exec(`ALTER TABLE ganadores ADD COLUMN premio_tipo TEXT`);
  if (!tieneColumna(db, 'ganadores', 'revancha'))
    db.exec(`ALTER TABLE ganadores ADD COLUMN revancha INTEGER DEFAULT 0`);
  if (!tieneColumna(db, 'rifas', 'categoria'))
    db.exec(`ALTER TABLE rifas ADD COLUMN categoria TEXT DEFAULT ''`);

  db.exec(`
CREATE TABLE IF NOT EXISTS boletas_chance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rifa_id INTEGER NOT NULL,
  numero INTEGER NOT NULL,
  simbolo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'libre',
  participante_id INTEGER,
  fecha_reservado TEXT,
  UNIQUE(rifa_id, numero, simbolo)
);
CREATE INDEX IF NOT EXISTS idx_boletas_chance_rifa ON boletas_chance(rifa_id);
CREATE INDEX IF NOT EXISTS idx_boletas_chance_participante ON boletas_chance(participante_id);
`);

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

  db.exec(`
CREATE TABLE IF NOT EXISTS sorteos_auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rifa_id INTEGER NOT NULL,
  rifa_nombre TEXT,
  modalidad TEXT NOT NULL,
  ejecutado_por TEXT NOT NULL,
  fecha TEXT DEFAULT (datetime('now','localtime')),
  semilla TEXT,
  hash_resultado TEXT,
  ganadores TEXT,
  datos_completos TEXT
);
CREATE INDEX IF NOT EXISTS idx_sorteos_aud_rifa ON sorteos_auditoria(rifa_id);
CREATE INDEX IF NOT EXISTS idx_sorteos_aud_fecha ON sorteos_auditoria(fecha);
`);

  if (!tieneColumna(db, 'usuarios', 'usuario'))
    db.exec(`ALTER TABLE usuarios ADD COLUMN usuario TEXT`);
  if (!tieneColumna(db, 'usuarios', 'password_hash'))
    db.exec(`ALTER TABLE usuarios ADD COLUMN password_hash TEXT`);
  if (!tieneColumna(db, 'rifas', 'modalidad_premio'))
    db.exec(`ALTER TABLE rifas ADD COLUMN modalidad_premio TEXT DEFAULT 'completo'`);
  if (!tieneColumna(db, 'rifas', 'porcentaje_organizador'))
    db.exec(`ALTER TABLE rifas ADD COLUMN porcentaje_organizador INTEGER DEFAULT 0`);

  const admins = [
    { usuario: 'hans4269', nombre: 'Hans Admin', password: 'Rifas01234' },
    { usuario: 'sairaosorio78', nombre: 'Saira Admin', password: 'Rifas01234' }
  ];
  const bcrypt = require('bcryptjs');
  // Evitar duplicados de usuario: el restore/arranque puede reinsertar las semillas.
  // Se conserva el registro con menor id por cada usuario.
  db.exec(`DELETE FROM usuarios WHERE id NOT IN (SELECT MIN(id) FROM usuarios GROUP BY usuario)`);
  const insertUser = db.prepare(
    `INSERT INTO usuarios (usuario, nombre, password_hash, rol) VALUES (?, ?, ?, 'super_admin')`
  );
  for (const a of admins) {
    const existe = db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(a.usuario);
    if (!existe) {
      const hash = bcrypt.hashSync(a.password, 10);
      insertUser.run(a.usuario, a.nombre, hash);
    }
  }

  db.exec(`
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  fecha TEXT DEFAULT (datetime('now','localtime')),
  activa INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notificaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  cuerpo TEXT,
  rifa_id INTEGER,
  enviada_en TEXT DEFAULT (datetime('now','localtime')),
  exitosa INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_notif_tipo ON notificaciones(tipo);
CREATE INDEX IF NOT EXISTS idx_notif_rifa ON notificaciones(rifa_id);
`);
}

module.exports = { initDB, ensureSchema, dbPath };
