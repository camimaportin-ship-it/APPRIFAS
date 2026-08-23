# Changelog — Rifas Colombia PRO

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
