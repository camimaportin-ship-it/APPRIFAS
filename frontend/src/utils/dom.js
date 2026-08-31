// frontend/src/utils/dom.js — Fase pulido app.js — helpers DOM puros
export function toast(msg, tipo = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  const c = document.getElementById('toast-container');
  if (c) c.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
