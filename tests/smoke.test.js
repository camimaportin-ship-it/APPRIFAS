// tests/smoke.test.js — Fase 1.4 — 5 tests humo (sin tocar BD prod, usa lógica pura)
import { describe, it, expect } from 'vitest';
import { nOportunidades, generarGruposMultiples } from '../src/services/grupos.js';

describe('nOportunidades', () => {
  it('devuelve 0 si no es CUATRO_OPORTUNIDADES', () => {
    expect(nOportunidades({ modalidad_boleta: 'BOLETAS_NORMAL' })).toBe(0);
  });
  it('respeta 2,4,5 y defaultea a 4', () => {
    expect(nOportunidades({ modalidad_boleta: 'CUATRO_OPORTUNIDADES', n_oportunidades: 2 })).toBe(2);
    expect(nOportunidades({ modalidad_boleta: 'CUATRO_OPORTUNIDADES', n_oportunidades: 5 })).toBe(5);
    expect(nOportunidades({ modalidad_boleta: 'CUATRO_OPORTUNIDADES', n_oportunidades: 99 })).toBe(4);
    expect(nOportunidades({ modalidad_boleta: 'CUATRO_OPORTUNIDADES', n_oportunidades: null })).toBe(4);
  });
});

describe('generarGruposMultiples', () => {
  it('genera 50 grupos de 2 (n=2)', () => {
    const g = generarGruposMultiples(2);
    expect(g.length).toBe(50);
    expect(g[0].length).toBe(2);
    const flat = g.flat();
    expect(new Set(flat).size).toBe(100);
  });
  it('genera 25 grupos de 4 (n=4)', () => {
    const g = generarGruposMultiples(4);
    expect(g.length).toBe(25);
    expect(g[0].length).toBe(4);
  });
  it('genera 20 grupos de 5 (n=5)', () => {
    const g = generarGruposMultiples(5);
    expect(g.length).toBe(20);
    expect(g[0].length).toBe(5);
  });
});
