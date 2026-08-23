// LogicaSorteo: funciones puras para derivar los 3 ganadores de un mismo número
// ganador de 4 cifras [D1][D2][D3][D4]. Reutiliza el resultado del backend
// (chance-sorteo) que ya entrega premios A (1ª-2ª), B (2ª-3ª), C (3ª-4ª).

const LogicaSorteo = {
  // Devuelve los 2 primeros dígitos: D1 D2
  getPrimeros(numeroStr) {
    const s = String(numeroStr);
    return s.slice(0, 2);
  },
  // Devuelve los 2 dígitos del medio: D2 D3
  getMedio(numeroStr) {
    const s = String(numeroStr);
    return s.length >= 4 ? s.slice(1, 3) : '';
  },
  // Devuelve los 2 últimos dígitos: D3 D4
  getUltimos(numeroStr) {
    const s = String(numeroStr);
    return s.slice(-2);
  },

  // Etiqueta legible del grupo para una tarjeta de ganador
  grupoDe(tipo) {
    if (tipo === 'A') return 'primeros';
    if (tipo === 'B') return 'medio';
    if (tipo === 'C') return 'ultimos';
    if (tipo === 'D') return 'ultimos2';
    return (tipo || '').toLowerCase();
  },

  // Construye las 3 tarjetas de ganadores a partir del resultado del backend.
  // `resultado` = respuesta de /api/rifas/:id/chance-sorteo
  // Devuelve [{ tipo, grupo, nombre, numero, simbolo, ganador }]
  tarjetasDesdePremios(resultado) {
    const simbolo = resultado.simbolo;
    const cifras = resultado.nCifras || 4;
    const premios = (resultado.premios || []).filter(p => p.sorteado);
    return premios.map(p => ({
      tipo: p.tipo,
      grupo: LogicaSorteo.grupoDe(p.tipo),
      nombre: p.nombre || 'Premio',
      numero: String(p.numero).padStart(cifras >= 4 && String(p.numero).length > 2 ? 4 : 2, '0'),
      simbolo,
      ganador: p.ganador || null
    }));
  },

  // Filtra las boletas de la rifa que coinciden con un premio dado.
  // boletas = [{ numero, simbolo, estado, nombre }] (desde /boletas-chance)
  boletasGanadoras(boletas, tarjeta) {
    const num = Number(tarjeta.numero);
    return (boletas || []).filter(b => Number(b.numero) === num && b.simbolo === tarjeta.simbolo && b.estado === 'pagado');
  }
};

window.LogicaSorteo = LogicaSorteo;
