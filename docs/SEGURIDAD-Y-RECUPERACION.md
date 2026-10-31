# Seguridad y recuperación de la base de datos

Documento operativo del incidente `database disk image is malformed` (octubre 2026)
y de las protecciones añadidas. Nada de esto cambia el uso normal de la app.

---

## 1. Qué pasó (causa raíz)

`backend/db.js` guardaba con `fs.writeFileSync(ruta, buffer)`, que **sobrescribe el
archivo en el sitio**. Si el proceso moría durante esa escritura (deploy, reinicio,
límite de memoria), el `rifas.db` quedaba truncado. Como `railway.json` reinicia con
`ON_FAILURE`, el arranque volvía a leer el archivo dañado, fallaba en `ensureSchema`
y reiniciaba otra vez: bucle infinito de `[FATAL]`.

## 2. Protecciones activas

| Área | Comportamiento |
| --- | --- |
| Guardado | Escritura en `rifas.db.tmp-<pid>-<ts>` + `fsync` + `rename` (atómico). |
| Respaldos | `rifas.db.bak-1` … `.bak-3`, rotados como máximo una vez por minuto. |
| Arranque | Valida cabecera SQLite + `PRAGMA integrity_check` en memoria antes de abrir. |
| Base dañada | Se mueve a `rifas.db.corrupt-<fecha>` (**nunca se borra**) y se recupera del `.bak` válido más reciente. Sin respaldos válidos: arranca con base nueva vacía. |
| Restauración | El backup se valida **antes** de reemplazar; el reemplazo es atómico y deja `rifas.db.bak-antes-restore`. Un archivo dañado se rechaza con HTTP 400. |
| Health | `/health` y `/api/health` incluyen `dbRecuperada: true/false`. |
| Acceso | Backup/restore solo para `super_admin` y `admin`, con rate-limit propio. |

Los respaldos `.bak-*` están en `.gitignore`: viven en el volumen del servidor.

## 3. Variables de entorno

```bash
# Firma de sesiones (32+ caracteres). Sin esto se genera uno temporal por
# proceso y todos los usuarios deben volver a iniciar sesión al reiniciar.
AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Firma de eventos de Wompi. En producción, sin esta clave se rechazan los
# webhooks (evita que cualquiera marque pagos como aprobados).
WOMPI_EVENTS_KEY=

# Token opcional del webhook de estados de WhatsApp (cabecera X-Webhook-Token).
WHATSAPP_WEBHOOK_TOKEN=

# Solo Vercel: sin BLOB_READ_WRITE_TOKEN los datos no persisten entre reinicios.
BLOB_READ_WRITE_TOKEN=
```

## 4. Si vuelve a aparecer el error

1. Consultar `GET /health`. Si responde `ok: true` con `dbRecuperada: true`, la app
   ya se curó sola: se perdió como máximo lo escrito en el último minuto.
2. En el volumen aparecerá `rifas.db.corrupt-<fecha>`. **No lo borres**: es la única
   copia de los datos previos.
3. Intentar rescatar datos del archivo dañado (requiere `sqlite3` instalado):

   ```bash
   sqlite3 rifas.db.corrupt-2026-10-31T16-00-00-000Z ".recover" | sqlite3 rescatada.db
   ```

4. Restaurar desde la app: *Admin → Restaurar backup* con `rescatada.db` (o el
   `.zip` de un backup anterior). La app valida la integridad antes de aceptarlo.
5. Si no hay respaldos ni forma de recuperar: la app ya está operativa con base
   vacía; hay que volver a crear usuarios/rifas o cargar el último backup externo.

En Vercel el sistema de archivos es efímero: el `rifas.db` de `/tmp` desaparece en
cada arranque. Allí la fuente de verdad es Vercel Blob (`BLOB_READ_WRITE_TOKEN`).

## 5. Verificación

```bash
npm test                                                   # suite completa
node -e "fetch('http://localhost:3000/health').then(r=>r.json()).then(console.log)"
```

La suite (`tests/db-integridad.test.js`, `tests/seguridad.test.js`) cubre:
escritura atómica sin temporales huérfanos, no reescritura cuando la sentencia no
cambia nada, recuperación desde `.bak-1` y `.bak-2`, base corrupta sin respaldos,
validación de buffers, lista blanca de imágenes, saneamiento de nombres y firma de
Wompi.

## 6. Checklist antes de desplegar

- [ ] `AUTH_SECRET` definido (32+ caracteres) en el panel del proveedor.
- [ ] Contraseñas semilla cambiadas (`ADMIN_SEED_PASS`, `ADMIN_SEED_PASS_2`).
- [ ] `WOMPI_EVENTS_KEY` definida si se usan pagos en línea.
- [ ] En Vercel: `BLOB_READ_WRITE_TOKEN` creado (Storage → Blob).
- [ ] Descargar un backup `.zip` antes del despliegue si el volumen aún tiene la
      base dañada del incidente.
- [ ] Revisar `npm audit --omit=dev` (29 hallazgos: 1 crítica, 20 altas).
