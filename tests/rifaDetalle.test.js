// tests/rifaDetalle.test.js — Tests para src/views/rifaDetalle.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('rifaDetalle.js (importación)', () => {
  it('se puede importar sin errores', async () => {
    const mod = await import('../frontend/src/views/rifaDetalle.js');
    expect(mod).toBeDefined();
    expect(typeof mod.vistaDetalleRifaModular).toBe('function');
    expect(typeof mod.renderResumenModular).toBe('function');
  });
});

describe('renderResumenModular', () => {
  it('es una función exportada', async () => {
    const { renderResumenModular } = await import('../frontend/src/views/rifaDetalle.js');
    expect(typeof renderResumenModular).toBe('function');
  });
});

describe('vistaDetalleRifaModular', () => {
  it('es una función async exportada', async () => {
    const { vistaDetalleRifaModular } = await import('../frontend/src/views/rifaDetalle.js');
    expect(typeof vistaDetalleRifaModular).toBe('function');
  });
});
