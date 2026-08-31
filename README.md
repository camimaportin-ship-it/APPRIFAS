# Rifas SYC 🎲

Sistema de rifas colombiano autónomo (offline-first): gestión de rifas, venta de
boletas, generador de posters con QR, balotera virtual animada y envío masivo de
WhatsApp **sin pagar la API de Meta** (usa `whatsapp-web.js` con sesión local).

Todo corre en un solo proceso Node + Express que sirve la API REST y el frontend
estático. La base de datos es SQLite local (`sql.js` / WebAssembly), sin compilación
 nativa ni dependencias del sistema.

---

## ✨ Características principales

- **6 modalidades de rifa**: boletas normales, 4 oportunidades, chance con símbolo, chance 3 ganadores, chance individual, oportunidades 4D.
- **Venta de boletas** al azar o a elección del cliente (grilla 10×10 con colores).
- **Generador de posters** (1080×1080, historia vertical y poster oficial 2160×2160) con código QR.
- **Balotera virtual** animada (canvas) + sorteo de chance con 4 baloteras (B1–B4).
- **Ruleta animada** con grabación de video como evidencia de transparencia.
- **Revancha** disponible para **todas las modalidades**.
- **WhatsApp masivo** personalizado (nombre del cliente en cada mensaje).
- **Notificaciones push** (Web Push) y **PWA** instalable.
- **Importación/exportación** de participantes por Excel (XLSX) y CSV.
- **Exportar PDF** con reporte completo de resultados.
- **Autenticación** con roles (`super_admin`, `admin`, `vendedor`).
- **Administración de usuarios**: CRUD completo, gestión de sesiones, RBAC.
- **Auditoría de sorteos**: trazabilidad completa (quién, cuándo, semilla, hash SHA-256).
- **Modalidad 50/50**: el organizador se queda con un porcentaje de la recaudación.
- **CAPTCHA matemático** en login para prevenir bots.
- **100% responsive**: funciona en desktop, tablet y móvil.

---

## 🎲 Modalidades de boleta

| Modalidad | Valor en BD | Descripción |
|-----------|-------------|-------------|
| Boletas normales | `BOLETAS_NORMAL` | Números 00–99 (o el rango definido). 1 ganador. |
| 4 oportunidades | `CUATRO_OPORTUNIDADES` | Cada boleta compra `n` números del 00–99, sin repetir. |
| 3 Ganadores (4 cifras) | `CHANCE_3_GANADORES` | Sorteo de 4 cifras → 3 premios: 2 primeros, 2 del medio, 2 últimos. |
| Chance con símbolo | `CHANCE_CON_SIMBOLO` | Boleta = número 00–99 + símbolo. El sorteo elige 1 símbolo ganador. |
| Chance individual | `CHANCE_INDIVIDUAL` | El comprador elige su número (00–99 o 0000–9999). 1 ganador. |
| Oportunidades 4D | `OPORTUNIDADES_4D` | Números de 4 cifras al azar, sin repetir. 10.000 boletas. |

---

## 🚀 Puesta en marcha

### Requisitos
- **Node.js 18+** (probado hasta v24).
- Sistema operativo Windows / Linux / macOS.
- Sin dependencias de compilación nativa (usa `sql.js` WebAssembly).

### Instalación
```bash
git clone https://github.com/camimaportin-ship-it/APPRIFAS.git
cd APPRIFAS
npm install
```

### Ejecutar
```bash
# Servidor + frontend
npm start
```

La app queda disponible en **http://localhost:3000**.

### Usuarios por defecto

| Usuario | Contraseña | Rol |
|---------|------------|-----|
| `hans4269` | `Rifas01234` | super_admin |
| `sairaosorio78` | `Rifas01234` | super_admin |

> ⚠️ Cámbialas en producción.

---

## 📁 Estructura del proyecto

```
APPRIFAS/
├── server.js                 # Backend: API REST + frontend estático + sorteos
├── backend/
│   ├── db.js                 # Esquema SQLite (sql.js), migraciones y semilla
│   └── whatsapp.js           # Cliente WhatsApp (LocalAuth + QR)
├── frontend/
│   ├── index.html            # SPA (offline-first, sin build step)
│   ├── app.js                # Toda la lógica de la interfaz
│   ├── style.css             # Sistema de diseño responsive
│   ├── components/
│   │   ├── BaloteraCanvas.js # Balotera animada (canvas)
│   │   ├── Balotera4D.js     # 4 baloteras para chance
│   │   ├── LogicaSorteo.js   # Detección de ganadores (primeros/medio/últimos)
│   │   ├── GeneradorImagen.js# Posters con QR
│   │   └── RuletaCanvas.js   # Ruleta animada con video
│   ├── public/verificar.html # Página pública de verificación
│   └── vendor/               # chart.js, canvas-confetti
├── uploads/                  # Imágenes de producto y posters generados
├── data/                     # rifas.db (SQLite)
├── CHANGELOG.md              # Historial de versiones
├── package.json
└── README.md
```

---

## 🔌 API REST (resumen)

Todas las rutas requieren `Authorization: Bearer <token>` salvo login, QR y verificación.

### Autenticación
- `POST /api/auth/login` → `{ token, usuario, rol }`
- `POST /api/auth/logout`

### Rifas
- `GET  /api/rifas` — lista
- `POST /api/rifas` — crear
- `PUT  /api/rifas/:id` — editar
- `DELETE /api/rifas/:id` — borrado lógico
- `POST /api/rifas/:id/clonar` — duplicar configuración

### Boletas / participantes
- `GET  /api/rifas/:id/boletas`
- `POST /api/rifas/:id/boletas` — vender
- `POST /api/rifas/:id/importar` — importar Excel
- `GET  /api/rifas/:id/qr` — QR público (sin auth)

### Sorteos
- `POST /api/rifas/:id/sorteos` — sorteo normal
- `POST /api/rifas/:id/balotera` — balotera virtual
- `POST /api/rifas/:id/chance-sorteo` — chance con símbolo
- `POST /api/rifas/:id/chance-finalizar` — cerrar sorteo de chance
- `GET  /api/rifas/:id/ganadores`
- `GET  /api/rifas/:id/auditoria-sorteos` — auditoría (admin+)
- `GET  /api/auditoria-sorteos` — auditoría global (admin+)

### Usuarios (admin+)
- `GET  /api/usuarios`
- `POST /api/usuarios`
- `PUT  /api/usuarios/:id`
- `PUT  /api/usuarios/:id/rol` — super_admin only
- `DELETE /api/usuarios/:id` — super_admin only

### Sesiones
- `GET  /api/sesiones`
- `DELETE /api/sesiones/:tokenPrefix`

### WhatsApp
- `GET  /api/whatsapp/status`
- `POST /api/whatsapp/conectar`
- `POST /api/whatsapp/enviar`
- `POST /api/whatsapp/desconectar`

### Otros
- `GET  /api/empresa` / `PUT /api/empresa`
- `GET  /api/estadisticas`
- `GET  /api/changelog`
- `GET  /api/logs`
- `POST /api/push/subscribe`

---

## 🔄 Changelog

Ver [CHANGELOG.md](./CHANGELOG.md) para el historial completo de versiones.

También disponible dentro de la app en `#/changelog`.

---

## 🗄️ Base de datos

- Motor: **SQLite** via `sql.js` (WebAssembly, sin compilación nativa).
- Archivo: `data/rifas.db` (se crea automáticamente).
- Migraciones automáticas en `backend/db.js`.
- Para respaldar: copia `data/rifas.db` o usa el botón de backup en la app.

---

## 🛠️ Scripts

| Comando | Descripción |
|---------|-------------|
| `npm start` | Inicia servidor + frontend en :3000 |

---

## ❓ Solución de problemas

- **No se ven imágenes / QR**: usa siempre `npm start` (Express sirve todo).
- **WhatsApp no conecta**: necesita un navegador Chromium. En servidores sin GUI puede requerir `--no-sandbox`.
- **Puerto ocupado**: el servidor prueba 3000 → 3001 → 3002 automáticamente.
- **Reiniciar WhatsApp**: borra `.wwebjs_auth/` y vuelve a conectar.

---

## 📄 Licencia

Uso interno / demostración. Ajusta según tus necesidades.
