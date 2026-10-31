// respaldo.js
// -----------------------------------------------------------------------------
// Respaldos verificables de la base. Un respaldo solo se considera válido si
// pasa PRAGMA integrity_check antes de escribirse; cada archivo se guarda de
// forma atómica junto a su hash SHA-256, y se rota por cantidad.
//
// Se usa desde:
//   - server.js  → respaldo automático periódico (BACKUP_CADA_HORAS)
//   - scripts/backup-db.js → respaldo manual por consola
// -----------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validarBufferDb } = require('./db');

const RETENCION_DEFECTO = 14;

function marcaTiempo() {
  // 2026-10-31T16-20-00-123Z  (sin ':' ni '.', válido en Windows)
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function archivosDe(dir, prefijo) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.startsWith(`${prefijo}-`) && n.endsWith('.db'))
    .sort()
    .reverse(); // más recientes primero
}

function rotarRespaldo(dir, prefijo, retencion) {
  const sobrantes = archivosDe(dir, prefijo).slice(Math.max(0, retencion));
  for (const nombre of sobrantes) {
    for (const sufijo of ['', '.sha256']) {
      try { fs.rmSync(path.join(dir, nombre + sufijo), { force: true }); } catch (e) { /* ignorar */ }
    }
  }
  return sobrantes;
}

function escribirAtomico(destino, datos) {
  const tmp = `${destino}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, datos);
    try { fs.fsyncSync(fd); } catch (e) { /* fsync no soportado */ }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, destino);
}

/**
 * Crea un respaldo verificado.
 * @param {object} opciones
 * @param {Buffer|string} opciones.buffer  Contenido de la base o ruta al .db
 * @param {string} opciones.dir            Carpeta destino
 * @param {string} [opciones.externo]      Copia adicional (unidad externa, OneDrive…)
 * @param {number} [opciones.retencion]    Cuántos respaldos conservar
 * @param {string} [opciones.prefijo]      Prefijo del nombre
 */
async function crearRespaldo({ buffer, dir, externo = null, retencion = RETENCION_DEFECTO, prefijo = 'rifas' } = {}) {
  if (!dir) throw new Error('Falta la carpeta destino del respaldo');
  const datos = Buffer.isBuffer(buffer) ? buffer : fs.readFileSync(String(buffer));

  if (!(await validarBufferDb(datos))) {
    throw new Error('La base no pasó la verificación de integridad: respaldo cancelado');
  }

  fs.mkdirSync(dir, { recursive: true });
  const sello = marcaTiempo();
  let nombre = `${prefijo}-${sello}.db`;
  for (let n = 2; fs.existsSync(path.join(dir, nombre)); n++) {
    nombre = `${prefijo}-${sello}-${n}.db`;
  }

  const destino = path.join(dir, nombre);
  escribirAtomico(destino, datos);
  const hash = sha256(datos);
  fs.writeFileSync(`${destino}.sha256`, `${hash}  ${nombre}\n`);

  let copiaExterna = null;
  if (externo && path.resolve(externo) !== path.resolve(dir)) {
    try {
      fs.mkdirSync(externo, { recursive: true });
      copiaExterna = path.join(externo, nombre);
      escribirAtomico(copiaExterna, datos);
      fs.writeFileSync(`${copiaExterna}.sha256`, `${hash}  ${nombre}\n`);
    } catch (e) {
      console.warn('[RESPALDO] No se pudo copiar al destino externo:', e.message);
      copiaExterna = null;
    }
  }

  const borrados = rotarRespaldo(dir, prefijo, retencion);
  if (copiaExterna) rotarRespaldo(externo, prefijo, retencion);

  return { nombre, archivo: destino, copiaExterna, bytes: datos.length, sha256: hash, borrados };
}

/** Lista los respaldos con su tamaño, fecha y hash registrado. */
function listarRespaldos(dir, prefijo = 'rifas') {
  if (!fs.existsSync(dir)) return [];
  return archivosDe(dir, prefijo).map((nombre) => {
    const ruta = path.join(dir, nombre);
    const stat = fs.statSync(ruta);
    let hash = null;
    try { hash = fs.readFileSync(`${ruta}.sha256`, 'utf8').trim().split(/\s+/)[0]; } catch (e) { /* sin hash */ }
    return { nombre, ruta, bytes: stat.size, fecha: stat.mtime, sha256: hash };
  });
}

/** Comprueba un respaldo: hash (si existe) + integridad SQLite real. */
async function verificarRespaldo(archivo) {
  if (!fs.existsSync(archivo)) return { ok: false, motivo: 'El archivo no existe' };
  const datos = fs.readFileSync(archivo);
  const hash = sha256(datos);
  let hashRegistrado = null;
  try {
    hashRegistrado = fs.readFileSync(`${archivo}.sha256`, 'utf8').trim().split(/\s+/)[0];
  } catch (e) { /* sin archivo de hash */ }

  if (hashRegistrado && hashRegistrado !== hash) {
    return { ok: false, motivo: 'El hash no coincide: el archivo fue alterado o está incompleto', sha256: hash };
  }
  if (!(await validarBufferDb(datos))) {
    return { ok: false, motivo: 'No es una base SQLite íntegra', sha256: hash };
  }
  return { ok: true, motivo: 'Respaldo válido', sha256: hash, bytes: datos.length };
}

module.exports = {
  RETENCION_DEFECTO,
  crearRespaldo,
  listarRespaldos,
  verificarRespaldo,
  rotarRespaldo,
  sha256
};
