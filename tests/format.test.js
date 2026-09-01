// tests/format.test.js — Tests unitarios para src/utils/format.js
import { describe, it, expect } from 'vitest';
import { modoEsChance, fmtNum, fmtCOP, fmtFecha, escapeHtml, mostrarNumerosBoleta, nOport } from '../frontend/src/utils/format.js';

describe('modoEsChance', () => {
  it('devuelve true para modalidades CHANCE', () => {
    expect(modoEsChance({ modalidad_boleta: 'CHANCE_CON_SIMBOLO' })).toBe(true);
    expect(modoEsChance({ modalidad_boleta: 'CHANCE_INDIVIDUAL' })).toBe(true);
    expect(modoEsChance({ modalidad_boleta: 'CHANCE_3_GANADORES' })).toBe(true);
  });
  it('devuelve false para otras modalidades', () => {
    expect(modoEsChance({ modalidad_boleta: 'BOLETAS_NORMAL' })).toBe(false);
    expect(modoEsChance({ modalidad_boleta: 'CUATRO_OPORTUNIDADES' })).toBe(false);
    expect(modoEsChance({ modalidad_boleta: 'OPORTUNIDADES_4D' })).toBe(false);
  });
  it('devuelve false si rifa es null/undefined', () => {
    expect(modoEsChance(null)).toBe(false);
    expect(modoEsChance(undefined)).toBe(false);
  });
});

describe('fmtNum', () => {
  it('zero-pad 2 dígitos para BOLETAS_NORMAL', () => {
    expect(fmtNum({ modalidad_boleta: 'BOLETAS_NORMAL' }, 5)).toBe('05');
    expect(fmtNum({ modalidad_boleta: 'BOLETAS_NORMAL' }, 99)).toBe('99');
  });
  it('zero-pad 4 dígitos para OPORTUNIDADES_4D', () => {
    expect(fmtNum({ modalidad_boleta: 'OPORTUNIDADES_4D' }, 5)).toBe('0005');
    expect(fmtNum({ modalidad_boleta: 'OPORTUNIDADES_4D' }, 123)).toBe('0123');
  });
  it('zero-pad 4 dígitos para CHANCE_INDIVIDUAL con cifras>=4', () => {
    expect(fmtNum({ modalidad_boleta: 'CHANCE_INDIVIDUAL', cifras: 4 }, 7)).toBe('0007');
    expect(fmtNum({ modalidad_boleta: 'CHANCE_INDIVIDUAL', cifras: 5 }, 42)).toBe('0042');
  });
  it('zero-pad 2 dígitos para CHANCE_INDIVIDUAL con cifras<4', () => {
    expect(fmtNum({ modalidad_boleta: 'CHANCE_INDIVIDUAL', cifras: 3 }, 7)).toBe('07');
  });
  it('maneja rifa null', () => {
    expect(fmtNum(null, 5)).toBe('5');
  });
});

describe('fmtCOP', () => {
  it('formatea pesos colombianos', () => {
    const result = fmtCOP(150000);
    expect(result).toContain('150');
    expect(result).toContain('000');
  });
  it('maneja 0 y null', () => {
    expect(fmtCOP(0)).toContain('0');
    expect(fmtCOP(null)).toContain('0');
  });
});

describe('fmtFecha', () => {
  it('formatea fecha ISO corta', () => {
    const result = fmtFecha('2026-03-15');
    expect(result).toContain('15');
    expect(result).toContain('2026');
  });
  it('maneja null', () => {
    expect(fmtFecha(null)).toBe('-');
  });
});

describe('escapeHtml', () => {
  it('escapa caracteres peligrosos', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).not.toContain('<');
    expect(escapeHtml('a & b')).toContain('&amp;');
    expect(escapeHtml('test"quote')).toContain('&quot;');
  });
  it('maneja null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('mostrarNumerosBoleta', () => {
  it('muestra número normal con zero-pad 2', () => {
    const rifa = { modalidad_boleta: 'BOLETAS_NORMAL' };
    expect(mostrarNumerosBoleta(rifa, { numero: 5 })).toBe('05');
  });
  it('muestra múltiples oportunidades', () => {
    const rifa = { modalidad_boleta: 'CUATRO_OPORTUNIDADES' };
    expect(mostrarNumerosBoleta(rifa, { numeros: [1, 2, 3, 4] })).toContain('01');
  });
  it('muestra 4 dígitos para OPORTUNIDADES_4D', () => {
    const rifa = { modalidad_boleta: 'OPORTUNIDADES_4D' };
    expect(mostrarNumerosBoleta(rifa, { numero: 42 })).toBe('0042');
  });
});

describe('nOport', () => {
  it('devuelve 0 si no es CUATRO_OPORTUNIDADES', () => {
    expect(nOport({ modalidad_boleta: 'BOLETAS_NORMAL' })).toBe(0);
  });
  it('devuelve n_oportunidades válido (2,4,5)', () => {
    expect(nOport({ modalidad_boleta: 'CUATRO_OPORTUNIDADES', n_oportunidades: 2 })).toBe(2);
    expect(nOport({ modalidad_boleta: 'CUATRO_OPORTUNIDADES', n_oportunidades: 5 })).toBe(5);
  });
  it('defaultea a 4 si valor inválido', () => {
    expect(nOport({ modalidad_boleta: 'CUATRO_OPORTUNIDADES', n_oportunidades: 99 })).toBe(4);
    expect(nOport({ modalidad_boleta: 'CUATRO_OPORTUNIDADES', n_oportunidades: null })).toBe(4);
  });
});
