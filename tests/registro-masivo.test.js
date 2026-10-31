import { describe, it, expect } from 'vitest';

export function parsearLineaMasivo(linea) {
  if (!linea || !linea.trim()) return null;
  const sep = linea.includes('\t') ? '\t' : /[,;]|(?:\s-\s)/;
  const partes = linea.split(sep).map(p => p.trim()).filter(Boolean);
  if (partes.length === 0) return null;

  const nombre = partes[0];
  const resto = partes.slice(1);
  let telefono = '';
  let cedula = '';
  let numeros = [];
  let cantidad = 1;
  let modo = 'azar';

  const noAsignados = [];
  for (let i = 0; i < resto.length; i++) {
    const p = resto[i];
    const soloDigitos = p.replace(/\D/g, '');
    if (!telefono && (/^(?:\+?57)?3\d{9}$/.test(soloDigitos) || (soloDigitos.length === 10 && soloDigitos.startsWith('3')))) {
      telefono = soloDigitos;
    } else {
      noAsignados.push(p);
    }
  }

  if (noAsignados.length >= 2) {
    const primerPosibleCedula = noAsignados[0].replace(/\D/g, '');
    if (primerPosibleCedula.length >= 6 && primerPosibleCedula.length <= 11) {
      cedula = primerPosibleCedula;
      noAsignados.shift();
    }
  }

  const textoAsig = noAsignados.join(' ').trim();
  if (textoAsig) {
    const matchCant = textoAsig.match(/^(?:x\s*|cant\s*:?\s*)?(\d+)(?:\s*(?:boletas?|nums?|números?))?$/i);
    if (matchCant && Number(matchCant[1]) <= 100 && !textoAsig.startsWith('0') && !textoAsig.includes('#') && !textoAsig.includes(',')) {
      cantidad = Math.max(1, Number(matchCant[1]));
      modo = 'azar';
    } else {
      const matchNums = textoAsig.match(/\b\d+\b/g);
      if (matchNums && matchNums.length > 0) {
        modo = 'especifico';
        cantidad = matchNums.length;
        numeros = matchNums.map(Number);
      }
    }
  }

  return { nombre, telefono, cedula, cantidad, numeros, modo };
}

describe('parseador inteligente de registro masivo', () => {
  it('parsea formato simple: Nombre y Teléfono', () => {
    const res = parsearLineaMasivo('Juan Pérez, 3001234567');
    expect(res).toEqual({
      nombre: 'Juan Pérez',
      telefono: '3001234567',
      cedula: '',
      cantidad: 1,
      numeros: [],
      modo: 'azar'
    });
  });

  it('parsea persona con cantidad de boletas al azar (ej: 3)', () => {
    const res = parsearLineaMasivo('María Gómez, 3007654321, 3');
    expect(res.nombre).toBe('María Gómez');
    expect(res.telefono).toBe('3007654321');
    expect(res.cantidad).toBe(3);
    expect(res.modo).toBe('azar');
  });

  it('parsea persona con números específicos elegidos (ej: 05, 12, 89)', () => {
    const res = parsearLineaMasivo('Carlos Ruiz, 3109876543, 05, 12, 89');
    expect(res.nombre).toBe('Carlos Ruiz');
    expect(res.telefono).toBe('3109876543');
    expect(res.modo).toBe('especifico');
    expect(res.cantidad).toBe(3);
    expect(res.numeros).toEqual([5, 12, 89]);
  });

  it('parsea columnas copiadas directamente desde Excel (separadas por tabulación)', () => {
    const res = parsearLineaMasivo('Laura Silva\t3201112233\t10203040\t4');
    expect(res).toEqual({
      nombre: 'Laura Silva',
      telefono: '3201112233',
      cedula: '10203040',
      cantidad: 4,
      numeros: [],
      modo: 'azar'
    });
  });

  it('parsea persona con cédula, teléfono y números específicos', () => {
    const res = parsearLineaMasivo('Pedro Gómez, 79123456, 3112223344, 07 45');
    expect(res.nombre).toBe('Pedro Gómez');
    expect(res.cedula).toBe('79123456');
    expect(res.telefono).toBe('3112223344');
    expect(res.modo).toBe('especifico');
    expect(res.numeros).toEqual([7, 45]);
  });
});
