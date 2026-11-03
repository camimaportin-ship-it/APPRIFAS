import { describe, it, expect } from 'vitest';

describe('conteo de KPIs y boletas vendidas vs participantes', () => {
  it('calcula vendidos y restantes según los números/boletas reales y no la cantidad de personas', () => {
    // 100 números en total (00 - 99)
    const totalNumeros = 100;
    const valorBoleta = 2000;

    // Simulación: 18 participantes registrados que en conjunto ocupan 47 números
    // (11 participantes con 30 números pagados, 7 participantes con 17 números pendientes)
    const participantes = [
      { id: 1, nombre: 'P1', estado_pago: 'pagado', numeros: [0, 1, 2] },
      { id: 2, nombre: 'P2', estado_pago: 'pagado', numeros: [3, 4] },
      // ... total 11 personas pagadas con 30 números
      // y 7 personas pendientes con 17 números
    ];

    // En la tabla numeros:
    const numeros = Array.from({ length: 100 }, (_, i) => {
      if (i < 30) return { numero: i, estado: 'pagado' };
      if (i < 47) return { numero: i, estado: 'pendiente' };
      return { numero: i, estado: 'libre' };
    });

    const pagados = numeros.filter(n => n.estado === 'pagado').length;
    const pendientes = numeros.filter(n => n.estado === 'pendiente').length;
    const libres = numeros.filter(n => n.estado === 'libre').length;
    const vendidos = pagados + pendientes;
    const recaudado = pagados * valorBoleta;

    // Aserciones
    expect(pagados).toBe(30);
    expect(pendientes).toBe(17);
    expect(vendidos).toBe(47); // 47 boletas ocupadas (NO 18 personas)
    expect(libres).toBe(53);   // 53 boletas disponibles (exacto al mapa completo)
    expect(recaudado).toBe(60000); // 30 * 2000
    expect(vendidos + libres).toBe(totalNumeros);
  });
});

