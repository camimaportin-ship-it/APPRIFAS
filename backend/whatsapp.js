// whatsapp.js
// -----------------------------------------------------------------------------
// Módulo de WhatsApp Marketing (PROMPT V8.0 - Tarea 5).
// Usa whatsapp-web.js + LocalAuth: el dueño de la rifa escanea un QR con su
// propio WhatsApp y la app envía mensajes personalizados 1 a 1 SIN pagar la
// API de Meta.
//
// Políticas anti-spam:
//   - Máximo 1 mensaje cada 5 segundos (rate limit).
//   - Si falla el envío, se reintenta hasta 2 veces más con backoff.
//   - Cada envío se registra en la tabla `envios_whatsapp` (quién recibió,
//     quién falló y la hora).
// -----------------------------------------------------------------------------
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');

const INTERVALO_MS = 5000;      // 5 segundos entre mensajes
const REINTENTOS = 2;           // reintentos extra por mensaje
const MAX_TEL_LEN = 14;

// Estado en memoria de la conexión (un solo WhatsApp a la vez)
const conexion = {
  status: 'disconnected', // disconnected | connecting | waiting_scan | authenticated | connected | error
  qr: null,               // data URL para mostrarlo en la UI
  phone: null,            // número conectado
  client: null,
  iniciando: false
};

// Jobs de envío activos, key = rifaId
const jobs = {};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function estadoActual() {
  return { status: conexion.status, phone: conexion.phone, qr: conexion.qr };
}

// ---------------------------------------------------------------------------
// CONEXIÓN
// ---------------------------------------------------------------------------
async function conectar() {
  if (conexion.iniciando) return estadoActual();
  if (conexion.client && conexion.status === 'connected') return estadoActual();

  conexion.iniciando = true;
  conexion.status = 'connecting';
  conexion.qr = null;

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'rifassyc' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    }
  });
  conexion.client = client;

  client.on('qr', async (qr) => {
    try { conexion.qr = await QRCode.toDataURL(qr); } catch (e) { conexion.qr = null; }
    try { qrcodeTerminal.generate(qr, { small: true }); } catch (e) { /* ignorar */ }
    conexion.status = 'waiting_scan';
  });

  client.on('authenticated', () => { conexion.status = 'authenticated'; });

  client.on('ready', () => {
    const info = client.info;
    conexion.phone = (info && (info.wid?.user || info.me?.user)) || null;
    conexion.status = 'connected';
    conexion.iniciando = false;
    console.log(`[WHATSAPP] Conectado como ${conexion.phone}`);
  });

  client.on('auth_failure', () => {
    conexion.status = 'disconnected';
    conexion.qr = null;
    conexion.iniciando = false;
    console.log('[WHATSAPP] Falló la autenticación');
  });

  client.on('disconnected', (reason) => {
    conexion.status = 'disconnected';
    conexion.qr = null;
    conexion.phone = null;
    conexion.iniciando = false;
    console.log(`[WHATSAPP] Desconectado: ${reason}`);
  });

  try {
    await client.initialize();
  } catch (err) {
    console.error('[WHATSAPP] Error al inicializar:', err);
    conexion.status = 'error';
    conexion.iniciando = false;
  }
  return estadoActual();
}

async function desconectar() {
  try { if (conexion.client) await conexion.client.destroy(); } catch (e) { /* ignorar */ }
  conexion.status = 'disconnected';
  conexion.qr = null;
  conexion.phone = null;
  conexion.client = null;
  conexion.iniciando = false;
  return estadoActual();
}

// ---------------------------------------------------------------------------
// ENVÍO DE UN MENSAJE (con reintentos)
// ---------------------------------------------------------------------------
async function enviarMensaje(telefono, texto) {
  if (conexion.status !== 'connected' || !conexion.client) {
    return { ok: false, error: 'WhatsApp no está conectado' };
  }
  let numero = String(telefono || '').replace(/\D/g, '');
  if (!numero) return { ok: false, error: 'El comprador no tiene teléfono' };
  if (numero.length > MAX_TEL_LEN) numero = numero.slice(-MAX_TEL_LEN);
  // Números colombianos de 10 dígitos que empiezan en 3 -> prefijo 57
  if (numero.length === 10 && numero.startsWith('3')) numero = '57' + numero;
  const chatId = `${numero}@c.us`;

  let ultimoError = null;
  for (let intento = 1; intento <= REINTENTOS + 1; intento++) {
    try {
      await conexion.client.sendMessage(chatId, texto);
      return { ok: true, intentos: intento };
    } catch (err) {
      ultimoError = err.message || String(err);
      if (intento <= REINTENTOS) await sleep(INTERVALO_MS * intento);
    }
  }
  return { ok: false, error: ultimoError, intentos: REINTENTOS + 1 };
}

// ---------------------------------------------------------------------------
// PLANTILLAS: renderiza {{variables}} con los datos del participante/rifa
// ---------------------------------------------------------------------------
function renderPlantilla(plantilla, datos) {
  return String(plantilla || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = datos[k];
    return v == null ? '' : String(v);
  });
}

function estadoJob(rifaId) {
  return jobs[rifaId] || null;
}

// ---------------------------------------------------------------------------
// JOB DE ENVÍO 1 a 1 (con delay de 5s y reintentos). Corre en segundo plano.
// ---------------------------------------------------------------------------
async function lanzarEnvio(db, rifaId, plantillaId, participanteIds) {
  if (jobs[rifaId] && jobs[rifaId].enCurso) {
    return { error: 'Ya hay un envío en curso para esta rifa' };
  }

  const rifa = db.prepare('SELECT * FROM rifas WHERE id = ? AND borrada_en IS NULL').get(rifaId);
  if (!rifa) return { error: 'Rifa no encontrada' };
  const plantilla = db.prepare('SELECT * FROM plantillas_whatsapp WHERE id = ?').get(plantillaId);
  if (!plantilla) return { error: 'Plantilla no encontrada' };

  const origen = `http://localhost:${process.env.PORT || 3000}`;
  const linkRifa = `${origen}/public/rifa/${rifaId}`;

  let seleccion;
  if (participanteIds && participanteIds !== 'todos') {
    // Soporte para filtros predefinidos
    const filtros = {
      'pagados': "SELECT * FROM participantes WHERE rifa_id = ? AND estado_pago = 'pagado' AND telefono IS NOT NULL AND telefono != ''",
      'pendientes': "SELECT * FROM participantes WHERE rifa_id = ? AND estado_pago = 'pendiente'",
      'todos-pagados': "SELECT * FROM participantes WHERE rifa_id = ? AND estado_pago = 'pagado'",
      'sin-telefono': "SELECT * FROM participantes WHERE rifa_id = ? AND estado_pago = 'pagado' AND (telefono IS NULL OR telefono = '')",
    };
    if (filtros[participanteIds]) {
      seleccion = db.prepare(filtros[participanteIds]).all(rifaId);
    } else {
      const ids = Array.isArray(participanteIds) ? participanteIds.map(Number) : [];
      const placeholders = ids.map(() => '?').join(',');
      seleccion = db.prepare(`SELECT * FROM participantes WHERE rifa_id = ? AND id IN (${placeholders})`)
        .all(rifaId, ...ids);
    }
  } else {
    seleccion = db.prepare("SELECT * FROM participantes WHERE rifa_id = ? AND estado_pago = 'pagado'").all(rifaId);
  }
  if (!seleccion.length) return { error: 'No hay compradores seleccionados' };

  const numerosLibres = db.prepare("SELECT numero FROM numeros WHERE rifa_id = ? AND estado = 'libre' ORDER BY numero ASC").all(rifaId);
  const disponibles = numerosLibres.length;

  const job = {
    enCurso: true, rifaId, plantillaId, total: seleccion.length,
    enviados: 0, fallidos: 0, error: null, inicio: new Date().toISOString()
  };
  jobs[rifaId] = job;

  const insertEnvio = db.prepare(`
    INSERT INTO envios_whatsapp (rifa_id, participante_id, telefono, plantilla_id, mensaje, estado, intentos, error)
    VALUES (?,?,?,?,?,?,?,?)
  `);

  (async () => {
    for (let i = 0; i < seleccion.length; i++) {
      const p = seleccion[i];
      const numeros = numsBoleta(p, rifa);
      const datos = {
        nombre: p.nombre,
        numeros: numeros.join(', '),
        rifa_nombre: rifa.nombre,
        link_pago: linkRifa,
        link_rifa: linkRifa,
        fecha_sorteo: rifa.fecha_sorteo + (rifa.hora_sorteo ? ' a las ' + rifa.hora_sorteo : ''),
        valor_boleta: Number(rifa.valor_boleta).toLocaleString('es-CO'),
        numeros_disponibles: disponibles,
        numeros_disponibles_lista: numerosLibres.slice(0, 10).map(n => n.numero).join(', ')
      };
      const mensaje = renderPlantilla(plantilla.contenido, datos);

      const r = await enviarMensaje(p.telefono, mensaje);
      const estadoReg = r.ok ? 'enviado' : 'error';
      insertEnvio.run(rifaId, p.id, p.telefono || '', plantillaId, mensaje, estadoReg,
        r.intentos || 0, r.ok ? null : r.error);
      if (r.ok) job.enviados++; else job.fallidos++;

      // esperar 5s entre mensajes (excepto tras el último)
      if (i < seleccion.length - 1) await sleep(INTERVALO_MS);
    }
    job.enCurso = false;
    job.fin = new Date().toISOString();
  })();

  return { ok: true, job };
}

// ---------------------------------------------------------------------------
// Texto listo para pegar en un grupo / difusión de WhatsApp
// ---------------------------------------------------------------------------
function textoEnlaceGrupo(db, rifaId, plantillaId) {
  const rifa = db.prepare('SELECT * FROM rifas WHERE id = ? AND borrada_en IS NULL').get(rifaId);
  if (!rifa) return { error: 'Rifa no encontrada' };
  const plantilla = db.prepare('SELECT * FROM plantillas_whatsapp WHERE id = ?').get(plantillaId);
  if (!plantilla) return { error: 'Plantilla no encontrada' };

  const pagados = db.prepare("SELECT * FROM participantes WHERE rifa_id = ? AND estado_pago = 'pagado' ORDER BY numero ASC").all(rifaId);
  if (!pagados.length) return { error: 'No hay boletas pagadas' };

  const linkRifa = `http://localhost:${process.env.PORT || 3000}/public/rifa/${rifaId}`;
  const lineas = pagados.map(p => {
    const numeros = numsBoleta(p, rifa);
    return `• ${p.nombre}: 👉 ${numeros.join(' - ')} 👈`;
  });
  const texto = `🎟️ PARTICIPANTES DE "${rifa.nombre}" 🎟️\n\n${lineas.join('\n')}\n\n📅 Sorteo: ${rifa.fecha_sorteo}${rifa.hora_sorteo ? ' a las ' + rifa.hora_sorteo : ''}\n🔎 Verifica aquí: ${linkRifa}`;
  return { ok: true, texto };
}

// Números de una boleta (participante). Para BOLETAS_NORMAL es [numero];
// para CUATRO_OPORTUNIDADES son los 4 números de la boleta.
// Aplica zero-padding según la modalidad de la rifa.
function numsBoleta(p, rifa) {
  try {
    const arr = JSON.parse(p.numeros);
    if (Array.isArray(arr) && arr.length) {
      return arr.map(n => {
        const num = Number(n);
        if (rifa) {
          const m = rifa.modalidad_boleta;
          if (m === 'OPORTUNIDADES_4D' || (m === 'CHANCE_INDIVIDUAL' && Number(rifa.cifras || 4) >= 4)) return String(num).padStart(4, '0');
          if (m === 'CUATRO_OPORTUNIDADES' || m === 'CHANCE_CON_SIMBOLO' || m === 'CHANCE_3_GANADORES' || m === 'BOLETAS_NORMAL') return String(num).padStart(2, '0');
        }
        return String(num).padStart(2, '0');
      });
    }
  } catch (e) { /* falla -> usa p.numero */ }
  const num = Number(p.numero);
  if (rifa) {
    const m = rifa.modalidad_boleta;
    if (m === 'OPORTUNIDADES_4D' || (m === 'CHANCE_INDIVIDUAL' && Number(rifa.cifras || 4) >= 4)) return [String(num).padStart(4, '0')];
  }
  return [String(num).padStart(2, '0')];
}

module.exports = {
  conectar, desconectar, estadoActual, estadoJob,
  enviarMensaje, lanzarEnvio, textoEnlaceGrupo, renderPlantilla, numsBoleta
};
