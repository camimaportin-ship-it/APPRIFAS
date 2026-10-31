// tests/seguridad.test.js — Utilidades de ciberseguridad: lista blanca de
// imágenes (evita XSS almacenado con SVG), saneamiento de nombres y firma de
// eventos de Wompi (evita webhooks falsos que aprueban pagos).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const { esImagenPermitida, nombreArchivoSeguro, firmaWompiValida } = require('../backend/seguridad.js');

describe('esImagenPermitida', () => {
  it('acepta imágenes raster reales', () => {
    expect(esImagenPermitida({ mimetype: 'image/jpeg', originalname: 'foto.jpg' })).toBe(true);
    expect(esImagenPermitida({ mimetype: 'image/png', originalname: 'logo.PNG' })).toBe(true);
    expect(esImagenPermitida({ mimetype: 'image/webp', originalname: 'a.webp' })).toBe(true);
    expect(esImagenPermitida({ mimetype: 'image/gif', originalname: 'a.gif' })).toBe(true);
  });

  it('bloquea SVG y HTML disfrazado', () => {
    expect(esImagenPermitida({ mimetype: 'image/svg+xml', originalname: 'x.svg' })).toBe(false);
    expect(esImagenPermitida({ mimetype: 'image/png', originalname: 'x.svg' })).toBe(false);
    expect(esImagenPermitida({ mimetype: 'text/html', originalname: 'x.png' })).toBe(false);
    expect(esImagenPermitida({ mimetype: 'image/png', originalname: 'x.html' })).toBe(false);
  });

  it('rechaza archivos ausentes o incompletos', () => {
    expect(esImagenPermitida(null)).toBe(false);
    expect(esImagenPermitida({})).toBe(false);
  });
});

describe('nombreArchivoSeguro', () => {
  it('elimina rutas y caracteres peligrosos', () => {
    expect(nombreArchivoSeguro('../../etc/passwd')).not.toContain('/');
    expect(nombreArchivoSeguro('../../etc/passwd')).not.toContain('..');
    expect(nombreArchivoSeguro('a<b>c.png')).toBe('a_b_c.png');
  });

  it('devuelve un nombre por defecto si queda vacío', () => {
    expect(nombreArchivoSeguro('')).toBe('archivo');
    expect(nombreArchivoSeguro(null)).toBe('archivo');
  });
});

describe('firmaWompiValida', () => {
  const SECRETO = 'eventos_test_123';

  function firmar(cuerpo, secreto = SECRETO) {
    const valores = cuerpo.signature.properties.map((ruta) => {
      let valor = cuerpo;
      for (const parte of String(ruta).split('.')) {
        valor = valor == null ? undefined : valor[parte];
      }
      return valor == null ? '' : String(valor);
    });
    return crypto.createHash('sha256').update(valores.join('') + String(cuerpo.timestamp) + secreto).digest('hex');
  }

  function evento() {
    return {
      data: { transaction: { id: 'tx-123', reference: 'RIFA-1', status: 'APPROVED' } },
      timestamp: 1700000000,
      signature: { properties: ['data.transaction.id', 'data.transaction.status'], checksum: '' }
    };
  }

  it('acepta un evento con checksum correcto', () => {
    const cuerpo = evento();
    cuerpo.signature.checksum = firmar(cuerpo);
    expect(firmaWompiValida(cuerpo, SECRETO)).toBe(true);
  });

  it('rechaza un checksum manipulado', () => {
    const cuerpo = evento();
    cuerpo.signature.checksum = firmar(cuerpo);
    cuerpo.data.transaction.status = 'DECLINED';
    expect(firmaWompiValida(cuerpo, SECRETO)).toBe(false);
  });

  it('rechaza si el secreto no coincide o falta', () => {
    const cuerpo = evento();
    cuerpo.signature.checksum = firmar(cuerpo);
    expect(firmaWompiValida(cuerpo, 'otro-secreto')).toBe(false);
    expect(firmaWompiValida(cuerpo, '')).toBe(false);
  });

  it('rechaza eventos sin bloque de firma', () => {
    expect(firmaWompiValida({ data: {} }, SECRETO)).toBe(false);
    expect(firmaWompiValida(null, SECRETO)).toBe(false);
  });
});
