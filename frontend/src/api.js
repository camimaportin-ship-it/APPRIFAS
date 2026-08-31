// frontend/src/api.js — Fase 2.2 — Cliente API modular (extraído de app.js:248)
export function createApi(getToken) {
  return async function api(path, opts = {}) {
    const headers = { ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}), ...(opts.headers || {}) };
    const res = await fetch('/api' + path, { ...opts, headers });
    if (res.status === 401) throw new Error('Sesión expirada');
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || 'Error de red');
    return data;
  };
}
