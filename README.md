# RifasPRO 🎟️

Sistema de rifas colombiano autónomo (offline-first): gestión de rifas, venta de
boletas, generador de posters con QR, balotera virtual animada y envío masivo de
WhatsApp **sin pagar la API de Meta** (usa `whatsapp-web.js` con sesión local).

Todo corre en un solo proceso Node + Express que sirve la API REST y el frontend
estático. La base de datos es SQLite local (`better-sqlite3`), no requiere servidor
externo.

---

## ✨ Características principales

- **6 modalidades de rifa** (ver abajo), incluyendo chance con 3 ganadores y chance
  con símbolo.
- **Venta de boletas** al azar o a elección del cliente (grilla 10×10 con colores
  disponible / vendido).
- **Generador de posters** (1080×1080, historia vertical y poster oficial 2160×2160)
  con código QR, fecha de sorteo y banner de empresa, renderizados con `@napi-rs/canvas`.
- **Balotera virtual** animada (canvas) para sorteos transparentes, más sorteo de
  chance con 4 baloteras (B1–B4) y tarjetas de ganadores clicables.
- **Revancha** disponible para **todas las modalidades** cuando un premio no tiene
  boleta vendida.
- **WhatsApp masivo** personalizado (nombre del cliente en cada mensaje) escaneando
  un QR con tu cuenta de WhatsApp.
- **Notificaciones push** (Web Push) y **PWA** instalable (service worker + manifest).
- **Importación/exportación** de participantes por Excel (XLSX).
- **Autenticación** con roles (`super_admin`, `admin`, `vendedor`).

---

## 🎲 Modalidades de boleta

| Modalidad | Valor en BD | Descripción |
|-----------|-------------|-------------|
| Boletas normales | `BOLETAS_NORMAL` | Números 00–99 (o el rango definido). 1 ganador. |
| 4 oportunidades | `CUATRO_OPORTUNIDADES` | Cada boleta compra `n` números del 00–99, sin repetir. |
| 3 Ganadores (4 cifras, sin símbolo) | `CHANCE_3_GANADORES` | Sorteo de 4 cifras → 3 premios: 2 primeros, 2 del medio, 2 últimos. 10.000 boletas. |
| 1 o 3 Ganadores (4 cifras + símbolo) | `CHANCE_CON_SIMBOLO` | Boleta = número 00–99 + símbolo. Cada símbolo = 100 boletas. El sorteo elige 1 símbolo ganador. |
| Chance individual | `CHANCE_INDIVIDUAL` | El comprador elige su número (00–99 o 0000–9999). 1 ganador. |
| Múltiples oportunidades 0000–9999 (al azar) | `OPORTUNIDADES_4D` | Números de 4 cifras al azar, sin repetir. 10.000 boletas. |

---

## 🚀 Puesta en marcha

### Requisitos
- **Node.js 18+** (probado hasta v24).
- Sistema operativo Windows / Linux / macOS.
- ~500 MB libres (por la sesión de WhatsApp y `node_modules`).

### Instalación
```bash
cd rifas-colombia-pro/rifas-app
npm install
```

> ⚠️ `better-sqlite3` y `@napi-rs/canvas` compilan binarios nativos. Si `npm install`
> falla, asegúrate de tener las herramientas de compilación (Python + build tools de
> tu SO) o usa la versión precompilada de mejor-sqlite3 para tu plataforma.

### Ejecutar
```bash
# Solo backend + frontend (un solo proceso)
npm start

# O en modo desarrollo (servidor + watch del cliente)
npm run dev
```

La app queda disponible en **http://localhost:3000** (si el puerto está ocupado, el
servidor lo autoincrementa: 3001, 3002, …).

### Usuario administrador por defecto
Se crean automáticamente al iniciar la DB:

| Usuario | Contraseña |
|---------|------------|
| `hans4269` | `Rifas01234` |
| `sairaosorio78` | `Rifas01234` |

Cámbialas en producción.

---

## 📁 Estructura del proyecto

```
rifas-app/
├── server.js                 # Backend: API REST + frontend estático + sorteos
├── backend/
│   ├── db.js                 # Esquema SQLite, migraciones y datos semilla
│   ├── whatsapp.js           # Cliente WhatsApp (LocalAuth + QR)
│   └── watch-noop.js         # Placeholder para npm run client
├── frontend/
│   ├── index.html            # SPA (offline-first, sin build step)
│   ├── app.js                # Toda la lógica de la interfaz
│   ├── style.css             # Estilos
│   ├── components/
│   │   ├── BaloteraCanvas.js # Balotera animada (canvas)
│   │   ├── Balotera4D.js     # 4 baloteras para chance
│   │   ├── LogicaSorteo.js   # Primeros / medio / últimos
│   │   ├── GeneradorImagen.js# Posters con QR
│   │   └── RuletaCanvas.js   # Ruleta (modalidad lotería)
│   ├── public/verificar.html # Página pública de verificación de boleta
│   └── vendor/               # chart.js, canvas-confetti
├── uploads/                  # Imágenes de producto y posters generados
├── data/                     # rifas.db (SQLite) + respaldos .bak
└── package.json
```

---

## 🔌 API REST (resumen)

Todas las rutas (excepto login, QR público y verificación) requieren el header
`Authorization: Bearer <token>` obtenido en `/api/auth/login`.

### Autenticación
- `POST /api/auth/login` → `{ token, usuario, rol }`
- `POST /api/auth/logout`

### Rifas
- `GET  /api/rifas` — lista (filtra por estado/rol)
- `POST /api/rifas` — crear rifa (incluye `modalidad_boleta`, `cifras`, `simbolos`,
  `revancha_permitida`, `n_oportunidades`, …)
- `PUT  /api/rifas/:id` — editar configuración
- `DELETE /api/rifas/:id` — borrado lógico

### Boletas / participantes
- `GET  /api/rifas/:id/boletas`
- `POST /api/rifas/:id/boletas` — vender (al azar o a elección)
- `POST /api/rifas/:id/importar` — importar Excel
- `GET  /api/rifas/:id/qr` — **QR público** (sin auth) para compartir la verificación

### Sorteos
- `POST /api/rifas/:id/sorteos` — sorteo normal / lotería / tapazo
- `POST /api/rifas/:id/balotera` — balotera virtual (`sinGanador` para revancha)
- `POST /api/rifas/:id/chance-sorteo` — sorteo de chance (4 baloteras + símbolo)
- `POST /api/rifas/:id/chance-finalizar` — cierra el sorteo de chance
- `GET  /api/rifas/:id/ganadores`

### WhatsApp
- `GET  /api/whatsapp/status` — estado de la conexión
- `POST /api/whatsapp/conectar` — inicia sesión y genera QR
- `POST /api/whatsapp/enviar` — envío masivo personalizado
- `POST /api/whatsapp/desconectar`

### Estadísticas / push
- `GET  /api/estadisticas`
- `POST /api/push/subscribe` — suscripción a notificaciones

---

## 🔁 Revancha

Si al sortear cae un número sin boleta vendida (modalidad "todos los números"), la
interfaz ofrece **Repetir el sorteo (revancha)** siempre que la rifa tenga marcada la
opción *Permitir revancha*. Aplica a las 6 modalidades.

---

## 💬 WhatsApp masivo

1. En la sección **WhatsApp** de la app, pulsa *Conectar*.
2. Escanea el QR con tu WhatsApp (menú → Dispositivos vinculados).
3. Redacta el mensaje usando `{{nombre}}` para personalizar por cliente.
4. Envía a todos los participantes pagados de la rifa seleccionada.

La sesión se guarda localmente (`.wwebjs_auth/`), no necesitas volver a escanear
salvo que cierres sesión.

---

## 🗄️ Base de datos

- Motor: **SQLite** (`data/rifas.db`).
- Migraciones automáticas en `backend/db.js` (ALTER TABLE con `IF NOT EXISTS`).
- Antes de cada migración importante se crea un respaldo `rifas.db.bak-*`.
- Para respaldar manualmente: copia la carpeta `data/`.

---

## 🛠️ Scripts

| Comando | Descripción |
|---------|-------------|
| `npm start` | Inicia servidor + frontend en :3000 |
| `npm run dev` | Servidor + watch del cliente (concurrently) |
| `npm run server` | Solo el backend |
| `npm run client` | Solo mensaje del cliente (el frontend lo sirve Express) |

---

## ❓ Notas y solución de problemas

- **No se ven imágenes / QR**: el frontend usa rutas `/uploads/...` y `/api/rifas/:id/qr`
  servidas por el mismo Express. Si sirves el `frontend/` por otro medio (FTP, etc.)
  el QR no funcionará; usa siempre `npm start`.
- **WhatsApp no conecta**: necesita un navegador Chromium (lo descarga
  `whatsapp-web.js`). En servidores sin entorno gráfico puede requerir
  `--no-sandbox` o dependencias de Chromium.
- **Puerto ocupado**: el servidor prueba 3000 → 3001 → 3002 automáticamente.
- **Reiniciar sesión de WhatsApp**: borra `.wwebjs_auth/` y vuelve a conectar.

---

## 📄 Licencia

Uso interno / demostración. Ajusta según tus necesidades.
