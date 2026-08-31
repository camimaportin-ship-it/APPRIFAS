// frontend/src/utils/format.js — Fase pulido app.js — extraído de app.js:14-296 sin cambiar lógica
export function modoEsChance(rifa) {
  return ['CHANCE_CON_SIMBOLO', 'CHANCE_INDIVIDUAL', 'CHANCE_3_GANADORES'].includes(rifa?.modalidad_boleta);
}
export function fmtNum(rifa, n) {
  if (!rifa) return String(n);
  const m = rifa.modalidad_boleta;
  if (m === 'OPORTUNIDADES_4D' || (m === 'CHANCE_INDIVIDUAL' && Number(rifa.cifras || 4) >= 4)) return String(n).padStart(4, '0');
  return String(n).padStart(2, '0');
}
export function fmtCOP(v) { return '$' + Number(v || 0).toLocaleString('es-CO'); }
export function fmtFecha(iso) {
  if (!iso) return '-';
  const f = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso.replace(' ', 'T'));
  return f.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function mostrarNumerosBoleta(rifa, p) {
  const arr = (p && p.numeros && p.numeros.length ? p.numeros : [p && p.numero]).filter(n => n != null);
  const m = rifa && rifa.modalidad_boleta;
  const es4D = m === 'OPORTUNIDADES_4D' || (m === 'CHANCE_INDIVIDUAL' && Number(rifa.cifras || 4) >= 4);
  const pad = es4D ? 4 : 2;
  return arr.map(n => String(n).padStart(pad, '0')).join(', ');
}
export function nOport(rifa) {
  if (!rifa || rifa.modalidad_boleta !== 'CUATRO_OPORTUNIDADES') return 0;
  const n = Number(rifa.n_oportunidades) || 4;
  return [2, 4, 5].includes(n) ? n : 4;
}
