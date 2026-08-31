// src/utils/sanitize.js — Extraído de server.js:390 sin cambiar lógica (Fase 1.3)
function limpiarTexto(v, max = 120) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}
function limpiarCedula(v) {
  return limpiarTexto(v, 20).replace(/\D/g, '');
}
function limpiarTelefono(v) {
  return limpiarTexto(v, 20).replace(/[^\d+]/g, '');
}

module.exports = { limpiarTexto, limpiarCedula, limpiarTelefono };
