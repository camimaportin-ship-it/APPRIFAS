// src/services/grupos.js — Fase 1.3 — Lógica de grupos extraída (sin side-effects de escritura)
// Esta versión es pura (recibe db) y se usará en Fase 2 para desacoplar server.js.
// Por ahora server.js mantiene su implementación original para no romper; este módulo
// es la referencia canónica para la futura modularización.

function nOportunidades(rifa) {
  if (!rifa || rifa.modalidad_boleta !== 'CUATRO_OPORTUNIDADES') return 0;
  const n = Number(rifa.n_oportunidades) || 4;
  return [2, 4, 5].includes(n) ? n : 4;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generarGruposMultiples(n) {
  const k = 100 / n;
  const bloques = [];
  for (let b = 0; b < n; b++) {
    const ini = b * k;
    bloques.push(shuffle(Array.from({ length: k }, (_, i) => ini + i)));
  }
  const grupos = [];
  for (let i = 0; i < k; i++) {
    let ok = false, cand = [];
    for (let intento = 0; intento < 300 && !ok; intento++) {
      const idx = bloques.map(q => Math.floor(Math.random() * q.length));
      cand = idx.map((ix, qi) => bloques[qi][ix]);
      const s = [...cand].sort((a, b) => a - b);
      ok = s.every((v, j) => j === 0 || v - s[j - 1] >= 2);
      if (ok) idx.forEach((ix, qi) => bloques[qi].splice(ix, 1));
    }
    if (!ok) cand = bloques.map(q => q.shift());
    grupos.push(cand.sort((a, b) => a - b));
  }
  return grupos;
}

module.exports = { nOportunidades, shuffle, generarGruposMultiples };
