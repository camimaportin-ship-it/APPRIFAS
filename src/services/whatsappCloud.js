// src/services/whatsappCloud.js — Fase 3.2 — Cola simple para WhatsApp Cloud API (stub)
// Si WHATSAPP_CLOUD_TOKEN no está seteado, opera en modo stub (encola en DB y marca enviado localmente).
// En prod: reemplazar sendViaCloud con fetch a https://graph.facebook.com/v19.0/<PHONE_ID>/messages

function createWhatsappCloud(db) {
  async function encolar({ rifa_id, telefono, mensaje, plantilla_id }) {
    const info = db.prepare('INSERT INTO envios_whatsapp (rifa_id, telefono, plantilla_id, mensaje, estado) VALUES (?,?,?,?,?)')
      .run(rifa_id || null, telefono, plantilla_id || null, mensaje, 'pendiente');
    return info.lastInsertRowid;
  }

  async function procesarPendientes(limit = 10) {
    const pendientes = db.prepare("SELECT * FROM envios_whatsapp WHERE estado='pendiente' ORDER BY id ASC LIMIT ?").all(limit);
    for (const e of pendientes) {
      try {
        // Stub: marca enviado. En prod, aquí va fetch a Cloud API
        db.prepare("UPDATE envios_whatsapp SET estado='enviado', intentos=intentos+1 WHERE id=?").run(e.id);
      } catch (err) {
        db.prepare("UPDATE envios_whatsapp SET estado='error', error=?, intentos=intentos+1 WHERE id=?").run(err.message, e.id);
      }
    }
    return pendientes.length;
  }

  return { encolar, procesarPendientes };
}

module.exports = { createWhatsappCloud };
