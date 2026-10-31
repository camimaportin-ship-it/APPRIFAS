import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { crearRespaldo, listarRespaldos, verificarRespaldo, rotarRespaldo, sha256 } from '../backend/respaldo';
import { initDB } from '../backend/db';

describe('sistema de respaldo verificable', () => {
  let tmpDir;
  let dbPath;
  let backupDir;
  let validDbBuffer;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respaldo-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    backupDir = path.join(tmpDir, 'backups');

    const db = await initDB(dbPath);
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, valor TEXT); INSERT INTO test (valor) VALUES (\'ok\');');
    validDbBuffer = db.exportar();
    db.close();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  });

  it('crea un respaldo válido con archivo .sha256 coincidente', async () => {
    const res = await crearRespaldo({
      buffer: validDbBuffer,
      dir: backupDir,
      retencion: 5
    });

    expect(fs.existsSync(res.archivo)).toBe(true);
    expect(fs.existsSync(`${res.archivo}.sha256`)).toBe(true);
    expect(res.bytes).toBeGreaterThan(0);
    expect(res.sha256).toBe(sha256(validDbBuffer));

    const shaFileContent = fs.readFileSync(`${res.archivo}.sha256`, 'utf8');
    expect(shaFileContent).toContain(res.sha256);
  });

  it('rechaza crear respaldo de un buffer corrupto', async () => {
    const corruptBuffer = Buffer.from('archivo no sqlite');
    await expect(crearRespaldo({
      buffer: corruptBuffer,
      dir: backupDir
    })).rejects.toThrow(/integridad/i);
  });

  it('lista respaldos existentes ordenados y con metadatos', async () => {
    await crearRespaldo({ buffer: validDbBuffer, dir: backupDir, retencion: 5 });
    const lista = listarRespaldos(backupDir);
    expect(lista.length).toBe(1);
    expect(lista[0].bytes).toBeGreaterThan(0);
    expect(lista[0].sha256).toBeTruthy();
    expect(lista[0].nombre).toMatch(/\.db$/);
  });

  it('verifica correctamente un respaldo válido y detecta alteraciones', async () => {
    const res = await crearRespaldo({ buffer: validDbBuffer, dir: backupDir, retencion: 5 });
    
    // Verificación válida
    const v1 = await verificarRespaldo(res.archivo);
    expect(v1.ok).toBe(true);
    expect(v1.sha256).toBe(res.sha256);

    // Alteración de bytes del archivo
    fs.appendFileSync(res.archivo, 'bytes basura');
    const v2 = await verificarRespaldo(res.archivo);
    expect(v2.ok).toBe(false);
    expect(v2.motivo).toMatch(/hash|alterado|sqlite/i);
  });

  it('rota respaldos antiguos cuando se supera la cuota de retención', async () => {
    fs.mkdirSync(backupDir, { recursive: true });
    for (let i = 1; i <= 5; i++) {
      const p = path.join(backupDir, `rifas-2026-10-31T10-00-0${i}-000Z.db`);
      fs.writeFileSync(p, validDbBuffer);
      fs.writeFileSync(`${p}.sha256`, `${sha256(validDbBuffer)} rifas-2026-10-31T10-00-0${i}-000Z.db\n`);
    }

    const borrados = rotarRespaldo(backupDir, 'rifas', 3);
    expect(borrados.length).toBe(2);

    const restantes = listarRespaldos(backupDir);
    expect(restantes.length).toBe(3);
  });
});
