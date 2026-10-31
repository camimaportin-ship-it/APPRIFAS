#!/usr/bin/env node
// scripts/backup-db.js — Respaldo manual verificable de la base local.
//
//   node scripts/backup-db.js                     → respaldo en ./backups
//   node scripts/backup-db.js --externo D:\Rifas → además copia a otro disco
//   node scripts/backup-db.js --keep 30           → conserva 30 respaldos
//   node scripts/backup-db.js --list              → lista los respaldos
//   node scripts/backup-db.js --verify <archivo>  → verifica uno concreto
//
// Pensado para programarse con el Programador de tareas de Windows o cron.
const path = require('path');
const fs = require('fs');
const { dbPath } = require('../backend/db');
const { crearRespaldo, listarRespaldos, verificarRespaldo, RETENCION_DEFECTO } = require('../backend/respaldo');

function valor(nombre, defecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : defecto;
}
function tiene(nombre) {
  return process.argv.includes(`--${nombre}`);
}
function kb(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

(async () => {
  const dir = path.resolve(valor('dir', path.join(__dirname, '..', 'backups')));
  const externo = valor('externo', process.env.BACKUP_DIR_EXTERNO || null);

  if (tiene('list')) {
    const items = listarRespaldos(dir);
    if (!items.length) return console.log(`[RESPALDO] No hay respaldos en ${dir}`);
    console.log(`[RESPALDO] ${items.length} respaldo(s) en ${dir}:`);
    for (const r of items) {
      console.log(`  ${r.nombre}  ${kb(r.bytes)}  ${r.fecha.toISOString()}  ${(r.sha256 || 'sin hash').slice(0, 16)}…`);
    }
    return;
  }

  if (tiene('verify')) {
    const archivo = path.resolve(valor('verify', ''));
    const r = await verificarRespaldo(archivo);
    console.log(r.ok ? `  OK  ${archivo} — ${kb(r.bytes)}` : `  FALLO  ${archivo} — ${r.motivo}`);
    process.exit(r.ok ? 0 : 1);
  }

  const origen = path.resolve(valor('db', dbPath));
  if (!fs.existsSync(origen)) {
    console.error(`[RESPALDO] No existe la base: ${origen}`);
    process.exit(1);
  }

  const retencion = Number(valor('keep', RETENCION_DEFECTO));
  const resultado = await crearRespaldo({ buffer: origen, dir, externo, retencion });

  console.log('[RESPALDO] ✅ Respaldo creado');
  console.log(`  archivo : ${resultado.archivo}`);
  console.log(`  tamaño  : ${kb(resultado.bytes)}`);
  console.log(`  sha256  : ${resultado.sha256}`);
  if (resultado.copiaExterna) console.log(`  externo : ${resultado.copiaExterna}`);
  if (resultado.borrados.length) console.log(`  rotados : ${resultado.borrados.length} antiguo(s)`);
})().catch((e) => {
  console.error('[RESPALDO] ❌', e.message);
  process.exit(1);
});
