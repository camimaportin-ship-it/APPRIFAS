// tests/constants.test.js — Tests unitarios para src/utils/constants.js
import { describe, it, expect } from 'vitest';
import { BADGE_ESTADO, DISCLAIMER } from '../frontend/src/utils/constants.js';

describe('BADGE_ESTADO', () => {
  it('contiene los 4 estados de rifa', () => {
    expect(BADGE_ESTADO.borrador).toBe('Borrador');
    expect(BADGE_ESTADO.activa).toBe('Activa');
    expect(BADGE_ESTADO.cerrada).toBe('Cerrada');
    expect(BADGE_ESTADO.sorteada).toBe('Sorteada');
  });
  it('tiene 4 claves', () => {
    expect(Object.keys(BADGE_ESTADO).length).toBe(4);
  });
});

describe('DISCLAIMER', () => {
  it('contiene texto del Decreto 2480', () => {
    expect(DISCLAIMER).toContain('2480');
  });
  it('contiene Coljuegos', () => {
    expect(DISCLAIMER).toContain('Coljuegos');
  });
  it('no está vacío', () => {
    expect(DISCLAIMER.length).toBeGreaterThan(10);
  });
});
