// frontend/src/auth.js — Fase pulido app.js — extraído de app.js:38-120 (sin cambiar lógica)
// Este módulo será la fuente canónica en Fase 2. Por ahora app.js sigue siendo el runtime.
export function getToken() { return localStorage.getItem('rifassyc_token'); }
export function setToken(token) { localStorage.setItem('rifassyc_token', token); }
export function clearToken() { localStorage.removeItem('rifassyc_token'); }
export function authHeaders() { const t = getToken(); return t ? { Authorization: 'Bearer ' + t } : {}; }
