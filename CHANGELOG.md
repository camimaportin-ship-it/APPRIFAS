# Changelog — Rifas SYC

Historial de versiones del aplicativo.

---

## v2.1.0 — 23 de agosto de 2026

### UI/UX — Responsive completo
- CSS responsive con 4 breakpoints (860px, 600px, 520px, 400px).
- Sidebar hamburger siempre visible: colapsa en desktop, off-canvas en móvil.
- Tablas con scroll horizontal (`table-wrap`) en admin y sesiones.
- Formularios apilados en móvil (`grid-2/grid-3` → 1fr).
- Botones con `flex-wrap` para evitar desbordamiento.
- Login screen responsive con `box-sizing:border-box`.
- Modales siempre dentro de pantalla (`max-height:85vh`).
- Touch targets mínimos de 44px en móvil.
- Topbar con `text-overflow:ellipsis` en el título.
- KPI grid, quick actions y rifas grid responsivos.
- Balotera y chance animations responsive.
- Sidebar texto con `text-overflow:ellipsis` y tooltips.
- Texto legal del sidebar limitado a 3 líneas.

### Backend — Auditoría de sorteos
- Tabla `sorteos_auditoria` con trazabilidad completa (quién, cuándo, semilla, hash SHA-256, ganadores JSON).
- Función `registrarSorteoAuditoria()` integrada en los 3 endpoints de sorteo (normal, chance, balotera).
- `GET /api/rifas/:id/auditoria-sorteos` — auditoría por rifa (admin+).
- `GET /api/auditoria-sorteos` — auditoría global con paginación (admin+).

### Backend — Modalidad 50/50
- Columnas `modalidad_premio` y `porcentaje_organizador` en tabla `rifas`.
- Toggle en formulario de creación/edición de rifa.
- Display de info 50/50 en resumen de rifa y reporte PDF.
- Clonar rifa preserva la modalidad 50/50.

### Frontend — Exportar PDF
- Función `exportarReportePDF()` con reporte completo: datos, ganadores, pagados, pendientes.
- Botón PDF en la vista de detalle de rifa.
- Incluye info de modalidad 50/50 en el reporte.

### Frontend — CAPTCHA matemático
- CAPTCHA matemático simple en login (+, -, ×).
- Se regenera tras cada intento fallido.
- Animación shake en respuesta incorrecta.

### Backend — Video balotera
- `BaloteraCanvas`: métodos `iniciarGrabacion()` y `detenerGrabacion()` con `MediaRecorder`.

### Administración de usuarios
- RBAC middleware `requireRole()` con jerarquía `super_admin` > `admin` > `vendedor`.
- CRUD completo de usuarios: crear, editar, eliminar, cambiar contraseña, cambiar rol.
- Panel de sesiones activas con botón cerrar sesión remota.
- Limpieza automática de sesiones expiradas (cada 10 min).
- Log de login en auditoría.

---

## v2.2.0 — 31 de agosto de 2026 — Profesionalización + Escalabilidad + Ventaja competitiva

### Fase 0 — Higiene
- `README.md` unificado a "Rifas SYC" + `package.json` postinstall corregido
- `.gitignore` añade `.env` y `AUDIT.md` · `.env.example` + `CONTRIBUTING.md`
- `AUDIT.md` auditoría completa con roadmap por fases

### Fase 1 — Profesionalización (P0)
- **Seguridad:** `helmet`, `CORS` restringido por `ALLOWED_ORIGINS`, `rate-limit` global 300/15m + `loginLimiter` 20/15m, `express.json` 10mb→1mb, `dotenv` + `src/config/env.js` (zod fail-fast)
- **Sesiones persistentes:** tablas `sesiones` + `captcha_tokens` (`backend/db.js`), helpers `guardarSesion/obtenerSesion/borrarSesion` (dual-write Map+SQLite), `GET /api/auth/captcha` TTL 2m, todos los endpoints de sesión leen tabla
- **Modularización mínima:** `src/middleware/auth.js`, `src/middleware/validate.js`, `src/utils/sanitize.js`, `src/services/grupos.js`, `src/validators/rifas.js`
- **Tests:** `vitest` + `supertest` + `tests/smoke.test.js` (5 tests), `vitest.config.js`, scripts `test/build/lint/format`
- **Accesibilidad:** skip-link, `label for`, `aria-*`, `aria-current`, `h2.nav-sec`, contraste 0.55, persistencia sidebar `localStorage`

### Fase 2 — Escalabilidad (P1)
- **BD:** `PRAGMA foreign_keys/WAL`, `migrations/001_baseline.sql`, `estadosGruposBulk()` 1 query (fix N+1), `liberarVencidos` cada 5m en background
- **Frontend modular:** `vite.config.js` + `frontend/src/api.js` + `.eslintrc` + `.prettierrc`, `server.js` sirve `dist/` si existe
- **PWA/Performance:** `sharp` lazy, `GET /robots.txt` + `/sitemap.xml` + `/api/rifas/:id/og-image`, SW `v8` + `app.js?v=4` + banner `controllerchange`

### Fase 3 — Ventaja competitiva (P2)
- **Cobro:** tabla `pagos` + `POST /api/rifas/:id/checkout` (Wompi stub o URL real) + `POST /api/webhooks/wompi` + `GET /pagos`
- **WhatsApp Cloud:** `src/services/whatsappCloud.js` cola en `envios_whatsapp` (cada 30s) + `POST /api/whatsapp/cloud/enviar` + `GET /estado/:id` + `POST /api/webhooks/whatsapp`
- **Adquisición:** `POST /api/referidos/generar` + `GET /api/referidos/:codigo` + `GET /r/:id` landing con OG tags + footer global + links robots/sitemap/Coljuegos

---

## v2.1.1 — 30 de agosto de 2026

### Backend
- `PUT /api/rifas/:id` ahora guarda `n_oportunidades` y regenera grupos (`asegurarGrupos`) cuando cambia el tamaño; añade `asegurarNumeros()` para sincronizar `numeros` con el rango; regenera `boletas_chance` al cambiar `simbolos`/`cifras`/modalidad y limpia datos huérfanos al cambiar modalidad (`grupos_numeros`, `boletas_chance`).
- `POST /api/rifas/:id/participantes` acepta `estado_pago`, `metodo_pago`, `observacion` (pago en el registro).
- `PUT /api/participantes/:id` — teléfono opcional, duplicados solo por cédula, guarda `metodo_pago`/`observacion`.
- `POST /api/rifas/:id/participantes/masivo` acepta líneas con solo nombre.
- `auto_liberar_horas` por defecto `0` (antes `24`) en `backend/db.js` y `server.js`.

### Frontend
- 3 vistas de números: cuadrícula / tabla / lista (`localStorage rifas-numeros-vista`).
- Boletas disponibles clickeables en resumen (abren registro).
- Formularios: teléfono opcional en todos los flujos, mapa CUATRO sin grilla 00-99 individual.
- Service Worker `v7` (`/app.js` fuera de `APP_SHELL`) + `index.html` cache-bust `app.js?v=3`.
- DB: migración `metodo_pago` y `observacion` en `participantes`.

---

## v2.0.0 — Versión inicial

- 6 modalidades de rifa: `BOLETAS_NORMAL`, `CUATRO_OPORTUNIDADES`, `CHANCE_CON_SIMBOLO`, `CHANCE_3_GANADORES`, `CHANCE_INDIVIDUAL`, `OPORTUNIDADES_4D`.
- Venta de boletas al azar o a elección del cliente.
- Generador de posters con QR (1080×1080, historia vertical y poster 2160×2160).
- Balotera virtual animada (canvas) para sorteos transparentes.
- Ruleta animada con grabación de video como evidencia.
- Revancha disponible para todas las modalidades.
- WhatsApp masivo personalizado (nombre del cliente en cada mensaje).
- Notificaciones push (Web Push) y PWA instalable.
- Importación/exportación de participantes por Excel (XLSX).
- Autenticación con roles (`super_admin`, `admin`, `vendedor`).
- Base de datos SQLite con migraciones automáticas.
- Dashboard con estadísticas y gráficas.
- Plantillas de WhatsApp editables.
- Página pública de verificación de boleta con QR.
