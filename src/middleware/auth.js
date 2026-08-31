// src/middleware/auth.js — Fase 1.2/1.3 — Auth persistente en SQLite + RBAC
// Extraído de server.js:162-192 sin cambiar lógica, solo añade persistencia.

function createAuthMiddleware(db, sesionesActivasFallback) {
  // sesionesActivasFallback: Map en memoria usado solo si la tabla sesiones aún no existe (migración)
  function getSesion(token) {
    if (!token) return null;
    try {
      const row = db.prepare('SELECT * FROM sesiones WHERE token = ?').get(token);
      if (row && Date.now() <= row.exp) return row;
      if (row) db.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
    } catch (e) {
      // Tabla aún no creada (primer arranque sin migración) -> fallback a Map
      const s = sesionesActivasFallback.get(token);
      if (s && Date.now() <= s.exp) return s;
      if (s) sesionesActivasFallback.delete(token);
      return s || null;
    }
    return null;
  }

  function requireAuth(req, res, next) {
    const rutasPublicas = ['/api/auth/login', '/api/auth/me', '/api/auth/captcha', '/api/public/', '/public/'];
    if (rutasPublicas.some(r => req.path.startsWith(r))) return next();
    if (/^\/api\/rifas\/\d+\/qr$/.test(req.path)) return next();
    if (!req.path.startsWith('/api/')) return next();
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const sesion = getSesion(token);
    if (!sesion) return res.status(401).json({ error: 'No autenticado' });
    req.usuario = sesion;
    req.authToken = token;
    next();
  }

  function requireRole(...rolesPermitidos) {
    return (req, res, next) => {
      if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
      if (!rolesPermitidos.includes(req.usuario.rol)) {
        return res.status(403).json({ error: 'No tienes permisos para esta acción' });
      }
      next();
    };
  }

  return { requireAuth, requireRole, getSesion };
}

module.exports = { createAuthMiddleware };
