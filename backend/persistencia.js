// persistencia.js
// -----------------------------------------------------------------------------
// Persistencia del estado en Vercel Blob para entornos serverless.
//
// Problema que resuelve: en Vercel el filesystem del bundle es de solo lectura
// y /tmp es efímero y por instancia. Sin esta capa, cada instancia/cold start
// vuelve a la base empaquetada y los cambios "no se guardan" (rifas nuevas que
// desaparecen, restores que no se ven, backups vacíos).
//
// Estrategia:
//  - Al arrancar: si /tmp no tiene la base, se descarga desde Blob (o se toma
//    la más reciente si ambas existen).
//  - Tras cada escritura: se sube la base a Blob (con ifMatch para no pisar
//    cambios concurrentes de otra instancia).
//  - Antes de atender: se compara el ETag remoto y se recarga si otra
//    instancia escribió algo más reciente.
//  - Imágenes (uploads): se espejan a Blob y se bajan bajo demanda.
// -----------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const os = require('os');
const blob = require('@vercel/blob');

const EN_VERCEL = !!process.env.VERCEL;
const RUTA_DB = 'rifas/rifas.db';
const PREFIJO_UPLOADS = 'rifas/uploads/';
const MAX_BYTES_DB = 200 * 1024 * 1024;
const MAX_BYTES_UPLOAD = 30 * 1024 * 1024;

let etagConocido = null;

function tokenDisponible() {
  return !!(
    process.env.BLOB_READ_WRITE_TOKEN ||
    process.env.VERCEL_OIDC_TOKEN ||
    process.env.BLOB_STORE_ID
  );
}
function habilitado() { return EN_VERCEL && tokenDisponible(); }
function faltaToken() { return EN_VERCEL && !tokenDisponible(); }
function modo() {
  if (!EN_VERCEL) return 'local';
  return habilitado() ? 'blob' : 'efimero';
}

function dirDatos() {
  return EN_VERCEL ? path.join(os.tmpdir(), 'rifas-data') : path.join(__dirname, '..', 'data');
}

function esNoEncontrado(e) {
  return e instanceof blob.BlobNotFoundError ||
    e?.name === 'BlobNotFoundError' ||
    /not[_ ]found/i.test(String(e?.message || ''));
}
function esConflicto(e) {
  return e instanceof blob.BlobPreconditionFailedError ||
    e?.name === 'BlobPreconditionFailedError' ||
    /precondition/i.test(String(e?.message || ''));
}

function marcarEtag(etag) { if (etag) etagConocido = etag; }
function obtenerEtagConocido() { return etagConocido; }

// ---------------------------------- BASE -------------------------------------

async function obtenerMetadatosDb() {
  try {
    return await blob.head(RUTA_DB);
  } catch (e) {
    if (esNoEncontrado(e)) return null;
    throw e;
  }
}

async function descargarDb() {
  const r = await blob.get(RUTA_DB, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  const partes = [];
  let total = 0;
  for await (const parte of r.stream) {
    const buf = Buffer.from(parte);
    total += buf.length;
    if (total > MAX_BYTES_DB) throw new Error('La base remota supera los 200 MB permitidos');
    partes.push(buf);
  }
  if (r.blob?.etag) etagConocido = r.blob.etag;
  return Buffer.concat(partes, total);
}

async function subirDb(buffer, { ifMatch = true } = {}) {
  const opciones = {
    access: 'private',
    allowOverwrite: true,
    contentType: 'application/octet-stream',
    cacheControlMaxAge: 60
  };
  if (ifMatch && etagConocido) opciones.ifMatch = etagConocido;
  try {
    const r = await blob.put(RUTA_DB, buffer, opciones);
    if (r?.etag) etagConocido = r.etag;
    return { ok: true };
  } catch (e) {
    if (esConflicto(e)) return { ok: false, conflicto: true };
    throw e;
  }
}

// --------------------------------- UPLOADS -----------------------------------

function rutaSegura(nombreRel) {
  const limpio = String(nombreRel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!limpio || limpio.includes('..') || path.isAbsolute(limpio) || limpio.startsWith('/')) return null;
  return limpio;
}

function mimePorNombre(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.pdf') return 'application/pdf';
  return 'image/jpeg';
}

async function subirUpload(rutaAbs, nombreRel) {
  const rel = rutaSegura(nombreRel);
  if (!rel) return false;
  const buf = fs.readFileSync(rutaAbs);
  if (buf.length > MAX_BYTES_UPLOAD) {
    console.warn('[PERSIST] Upload demasiado grande para espejar:', rel, buf.length);
    return false;
  }
  await blob.put(PREFIJO_UPLOADS + rel, buf, {
    access: 'private',
    allowOverwrite: true,
    contentType: mimePorNombre(rel),
    cacheControlMaxAge: 24 * 60 * 60
  });
  return true;
}

async function bajarUpload(nombreRel) {
  const rel = rutaSegura(nombreRel);
  if (!rel) return null;
  try {
    const r = await blob.get(PREFIJO_UPLOADS + rel, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    const partes = [];
    let total = 0;
    for await (const parte of r.stream) {
      const buf = Buffer.from(parte);
      total += buf.length;
      if (total > MAX_BYTES_UPLOAD) return null;
      partes.push(buf);
    }
    return Buffer.concat(partes, total);
  } catch (e) {
    if (esNoEncontrado(e)) return null;
    throw e;
  }
}

async function listarUploads(limite = 500) {
  const resultados = [];
  let cursor;
  do {
    const r = await blob.list({ prefix: PREFIJO_UPLOADS, limit: Math.min(1000, Math.max(1, limite - resultados.length)), cursor });
    for (const b of r.blobs) {
      resultados.push({ rel: b.pathname.slice(PREFIJO_UPLOADS.length), size: b.size });
    }
    cursor = r.hasMore ? r.cursor : undefined;
    if (resultados.length >= limite) break;
  } while (cursor);
  return resultados;
}

module.exports = {
  EN_VERCEL,
  habilitado,
  faltaToken,
  modo,
  dirDatos,
  marcarEtag,
  obtenerEtagConocido,
  obtenerMetadatosDb,
  descargarDb,
  subirDb,
  subirUpload,
  bajarUpload,
  listarUploads
};
