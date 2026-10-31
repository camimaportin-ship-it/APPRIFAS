// tests/db-integridad.test.js — Blindaje de la base (incidente "database disk
// image is malformed"): escritura atómica, respaldos rotativos, cuarentena de
// archivos dañados y recuperación automática.
import { describe, it, expect, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { initDB, ensureSchema, alEscribir, validarBufferDb, estadoRecuperacion } = require('../backend/db.js');

const temporales = [];
function dirTemporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rifas-test-db-'));
  temporales.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of temporales) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignorar */ }
  }
});

describe('escritura atómica', () => {
  it('guarda la base sin dejar archivos temporales y con integridad válida', async () => {
    const dir = dirTemporal();
    const ruta = path.join(dir, 'rifas.db');
    const db = await initDB(ruta, ruta);
    ensureSchema(db);
    db.prepare("INSERT INTO config (clave, valor) VALUES ('prueba', 'ok')").run();
    db.close();

    expect(fs.existsSync(ruta)).toBe(true);
    expect(fs.readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([]);
    expect(await validarBufferDb(fs.readFileSync(ruta))).toBe(true);
  });

  it('no reescribe el archivo cuando la sentencia no cambia nada', async () => {
    const dir = dirTemporal();
    const ruta = path.join(dir, 'rifas.db');
    const db = await initDB(ruta, ruta);
    ensureSchema(db);

    let escrituras = 0;
    alEscribir(() => { escrituras += 1; });

    const antes = escrituras;
    db.exec('PRAGMA foreign_keys = ON');
    db.prepare('DELETE FROM config WHERE clave = ?').run('no-existe');
    expect(escrituras).toBe(antes);

    // Un cambio real sí debe persistir
    db.prepare("INSERT INTO config (clave, valor) VALUES ('real', '1')").run();
    expect(escrituras).toBe(antes + 1);
    db.close();
  });
});

describe('recuperación ante base dañada', () => {
  it('aísla la base corrupta y recupera desde .bak-1', async () => {
    const dir = dirTemporal();
    const ruta = path.join(dir, 'rifas.db');

    let db = await initDB(ruta, ruta);
    ensureSchema(db);
    db.prepare("INSERT INTO config (clave, valor) VALUES ('marca', 'buena')").run();
    // Respaldo del estado sano (la rotación real ocurre cada 60 s)
    fs.copyFileSync(ruta, `${ruta}.bak-1`);
    db.close();

    // Simula exactamente el incidente: archivo truncado/sobrescrito
    fs.writeFileSync(ruta, Buffer.concat([Buffer.from('SQLite format 3\u0000', 'latin1'), Buffer.from('basura'.repeat(200))]));

    db = await initDB(ruta, ruta);
    const recuperacion = estadoRecuperacion();
    expect(recuperacion).toBeTruthy();
    expect(recuperacion.origen).toBe(`${ruta}.bak-1`);
    expect(fs.existsSync(recuperacion.archivoCorrupto)).toBe(true); // no se borra

    ensureSchema(db);
    expect(db.prepare("SELECT valor FROM config WHERE clave = 'marca'").get().valor).toBe('buena');
    db.close();
    expect(await validarBufferDb(fs.readFileSync(ruta))).toBe(true);
  });

  it('sin respaldos válidos arranca con una base nueva operativa', async () => {
    const dir = dirTemporal();
    const ruta = path.join(dir, 'rifas.db');
    fs.writeFileSync(ruta, Buffer.from('esto no es una base sqlite'));

    const db = await initDB(ruta, ruta);
    expect(estadoRecuperacion()?.origen).toBe('nueva');
    expect(fs.readdirSync(dir).some((n) => n.includes('.corrupt-'))).toBe(true);

    ensureSchema(db);
    expect(db.prepare('SELECT COUNT(*) c FROM config').get().c).toBeGreaterThanOrEqual(0);
    db.close();
  });

  it('ignora respaldos dañados y usa el siguiente válido', async () => {
    const dir = dirTemporal();
    const ruta = path.join(dir, 'rifas.db');

    let db = await initDB(ruta, ruta);
    ensureSchema(db);
    db.prepare("INSERT INTO config (clave, valor) VALUES ('marca', 'del-bak-2')").run();
    fs.copyFileSync(ruta, `${ruta}.bak-2`);
    db.close();

    fs.writeFileSync(`${ruta}.bak-1`, Buffer.from('respaldo roto'));
    fs.writeFileSync(ruta, Buffer.from('base actual rota'));

    db = await initDB(ruta, ruta);
    expect(estadoRecuperacion()?.origen).toBe(`${ruta}.bak-2`);
    ensureSchema(db);
    expect(db.prepare("SELECT valor FROM config WHERE clave = 'marca'").get().valor).toBe('del-bak-2');
    db.close();
  });
});

describe('validarBufferDb', () => {
  it('rechaza archivos que no son SQLite', async () => {
    expect(await validarBufferDb(Buffer.from('basura'))).toBe(false);
    expect(await validarBufferDb(Buffer.alloc(0))).toBe(false);
  });

  it('rechaza una cabecera SQLite con contenido corrupto', async () => {
    const buffer = Buffer.concat([Buffer.from('SQLite format 3\u0000', 'latin1'), Buffer.from('x'.repeat(4096))]);
    expect(await validarBufferDb(buffer)).toBe(false);
  });

  it('acepta una base exportada válida', async () => {
    const dir = dirTemporal();
    const ruta = path.join(dir, 'rifas.db');
    const db = await initDB(ruta, ruta);
    ensureSchema(db);
    expect(await validarBufferDb(db.exportar())).toBe(true);
    db.close();
  });
});
