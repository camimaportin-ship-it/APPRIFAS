/**
 * app.js — Lógica completa del frontend (Vanilla JS, sin frameworks).
 * -----------------------------------------------------------------------------
 * Router simple por hash para el panel de administración (#/rifas, #/rifas/:id...)
 * y un router por ruta real para la página pública (/public/rifa/:id), que es
 * la que va en el QR y debe funcionar como URL compartible normal.
 * NOTA FASE 3: Wompi/Meta son stubs ocultos (FEATURE_WOMPI=false) — quedan para futuro.
 */
const FEATURE_WOMPI = false; // Fase 3 stub — no usable ahora, solo backend
const FEATURE_WA_CLOUD = false;

// Modalidades de chance (las 3 primeras comparten la lógica de boletas_chance)
function modoEsChance(rifa) {
  return ['CHANCE_CON_SIMBOLO', 'CHANCE_INDIVIDUAL', 'CHANCE_3_GANADORES'].includes(rifa.modalidad_boleta);
}

// Formatea un número con ceros a la izquierda según la modalidad de la rifa
function fmtNum(rifa, n) {
  if (!rifa) return String(n);
  const m = rifa.modalidad_boleta;
  if (m === 'OPORTUNIDADES_4D' || (m === 'CHANCE_INDIVIDUAL' && Number(rifa.cifras || 4) >= 4)) return String(n).padStart(4, '0');
  return String(n).padStart(2, '0');
}

// CAPTCHA matemático simple (sin dependencias, offline-first)
function generarCaptcha() {
  const ops = ['+', '-', '×'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a, b, respuesta;
  if (op === '+') { a = Math.floor(Math.random() * 20) + 1; b = Math.floor(Math.random() * 20) + 1; respuesta = a + b; }
  else if (op === '-') { a = Math.floor(Math.random() * 20) + 10; b = Math.floor(Math.random() * 15) + 1; respuesta = a - b; }
  else { a = Math.floor(Math.random() * 10) + 1; b = Math.floor(Math.random() * 10) + 1; respuesta = a * b; }
  return { pregunta: `¿Cuánto es ${a} ${op} ${b}?`, respuesta };
}
window._captchaActual = null;
function esChance4D(rifa) {
  return !!rifa && rifa.modalidad_boleta === 'CHANCE_INDIVIDUAL' && Number(rifa.cifras || 4) >= 4;
}

// ------------------------------- ESTADO GLOBAL --------------------------------
const state = {
  empresa: null,
  rifaActual: null,
  participantesActual: [],
  ruletaInstancia: null,
  waPoll: null,
  waJobPoll: null,
  authToken: localStorage.getItem('rifassyc_token') || null,
  usuario: null
};

// Detiene cualquier polling activo (se llama al cambiar de vista)
function detenerPolling() {
  if (state.waPoll) { clearInterval(state.waPoll); state.waPoll = null; }
  if (state.waJobPoll) { clearInterval(state.waJobPoll); state.waJobPoll = null; }
}

// ------------------------------- AUTENTICACIÓN --------------------------------
function authHeaders() {
  return state.authToken ? { 'Authorization': 'Bearer ' + state.authToken } : {};
}

// Descarga autenticada (envía el token) para evitar el 401 en backup/exports
function descargarAutenticada(url, nombre) {
  return fetch(url, { headers: authHeaders() })
    .then(r => { if (!r.ok) throw new Error('Error ' + r.status); return r.blob(); })
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    });
}

async function verificarSesion() {
  if (!state.authToken) return false;
  try {
    const res = await fetch('/api/auth/me', { headers: authHeaders() });
    if (!res.ok) { cerrarSesion(); return false; }
    const data = await res.json();
    state.usuario = data;
    return true;
  } catch (e) { cerrarSesion(); return false; }
}

function cerrarSesion() {
  state.authToken = null;
  state.usuario = null;
    localStorage.removeItem('rifassyc_token');
}

function mostrarLogin() {
  const el = document.getElementById('login-screen');
  el.style.display = 'flex';
  document.getElementById('app-shell').style.display = 'none';
  // Generar CAPTCHA al mostrar login
  window._captchaActual = generarCaptcha();
  const preguntaEl = document.getElementById('login-captcha-pregunta');
  const respuestaEl = document.getElementById('login-captcha-respuesta');
  if (preguntaEl) preguntaEl.textContent = window._captchaActual.pregunta;
  if (respuestaEl) { respuestaEl.value = ''; respuestaEl.removeAttribute('aria-invalid'); }
}

function mostrarApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = '';
  if (state.usuario) {
    const el = document.getElementById('sidebar-username');
    if (el) el.textContent = state.usuario.nombre + ' (' + state.usuario.rol + ')';
    // Mostrar sección admin solo para super_admin y admin
    const navAdmin = document.getElementById('nav-admin-section');
    if (navAdmin) navAdmin.style.display = ['super_admin', 'admin'].includes(state.usuario.rol) ? '' : 'none';
  }
}

function logout() {
  fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }).catch(() => {});
  cerrarSesion();
  mostrarLogin();
}

// Login form handler
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const usuario = document.getElementById('login-usuario').value.trim();
  const password = document.getElementById('login-password').value;
  const rememberEl = document.getElementById('login-remember');
  const remember = rememberEl ? rememberEl.checked : false;
  const btn = document.getElementById('login-btn');
  const errDiv = document.getElementById('login-error');
  errDiv.style.display = 'none';

  // Validar CAPTCHA
  const captchaInput = document.getElementById('login-captcha-respuesta');
  if (captchaInput && window._captchaActual) {
    const respuesta = parseInt(captchaInput.value, 10);
    if (respuesta !== window._captchaActual.respuesta) {
      errDiv.textContent = '❌ Respuesta incorrecta. Intenta de nuevo.';
      errDiv.style.display = 'block';
      captchaInput.setAttribute('aria-invalid', 'true');
      captchaInput.classList.add('shake');
      setTimeout(() => captchaInput.classList.remove('shake'), 400);
      window._captchaActual = generarCaptcha();
      document.getElementById('login-captcha-pregunta').textContent = window._captchaActual.pregunta;
      captchaInput.value = '';
      captchaInput.focus();
      return;
    }
  }

  btn.disabled = true;
  btn.textContent = 'Ingresando...';
  let res, data;
  try {
    res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password, remember })
    });
    data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Credenciales inválidas');
    state.authToken = data.token;
    localStorage.setItem('rifassyc_token', data.token);
    state.usuario = { usuario: data.usuario, nombre: data.nombre, rol: data.rol };
    mostrarApp();
    initApp();
  } catch (err) {
    errDiv.textContent = err.message;
    errDiv.style.display = 'block';
    errDiv.classList.remove('shake'); void errDiv.offsetWidth; errDiv.classList.add('shake');
    // Si la cuenta quedó bloqueada, deshabilitar el formulario por el tiempo indicado
    if (data && data.bloqueo) {
      const segundos = Number(data.retryAfter) || 0;
      btn.disabled = true;
      btn.textContent = 'Bloqueado';
      const fin = Date.now() + segundos * 1000;
      const tick = setInterval(() => {
        const rest = Math.max(0, Math.ceil((fin - Date.now()) / 1000));
        if (rest <= 0) { clearInterval(tick); btn.disabled = false; btn.textContent = 'Iniciar Sesión'; }
        else btn.textContent = `Bloqueado (${rest}s)`;
      }, 1000);
    }
  } finally {
    if (!(data && data.bloqueo)) { btn.disabled = false; btn.textContent = 'Iniciar Sesión'; }
  }
});

// Mostrar / ocultar contraseña
const togglePass = document.getElementById('login-toggle-pass');
if (togglePass) {
  togglePass.addEventListener('click', () => {
    const inp = document.getElementById('login-password');
    if (!inp) return;
    const mostrar = inp.type === 'password';
    inp.type = mostrar ? 'text' : 'password';
    togglePass.textContent = mostrar ? '🙈' : '👁️';
  });
}

// --------------------------- CAMBIAR CONTRASEÑA -------------------------------
function abrirCambiarPassword() {
  const modal = document.getElementById('modal-cambiar-pass');
  if (!modal) return;
  document.getElementById('cp-actual').value = '';
  document.getElementById('cp-nueva').value = '';
  document.getElementById('cp-repete').value = '';
  document.getElementById('cp-error').style.display = 'none';
  modal.style.display = 'flex';
}
function cerrarCambiarPassword() {
  const modal = document.getElementById('modal-cambiar-pass');
  if (modal) modal.style.display = 'none';
}
async function guardarCambiarPassword() {
  const actual = document.getElementById('cp-actual').value;
  const nueva = document.getElementById('cp-nueva').value;
  const repete = document.getElementById('cp-repete').value;
  const err = document.getElementById('cp-error');
  err.style.display = 'none';
  if (nueva.length < 6) return mostrarErrorCp('La nueva contraseña debe tener al menos 6 caracteres.');
  if (nueva !== repete) return mostrarErrorCp('Las contraseñas nuevas no coinciden.');
  const btn = document.getElementById('cp-guardar');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    const res = await fetch('/api/auth/cambiar-password', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ actual, nueva })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cambiar');
    cerrarCambiarPassword();
    toast('Contraseña actualizada. Se cerraron las demás sesiones.');
    // Esta sesión quedó invalidada por el backend: pedir reingreso
    cerrarSesion();
    mostrarLogin();
  } catch (e) {
    mostrarErrorCp(e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
}
function mostrarErrorCp(msg) {
  const err = document.getElementById('cp-error');
  err.textContent = msg;
  err.style.display = 'block';
}

// ------------------------------- HELPERS API -----------------------------------
async function api(path, opts = {}) {
  const headers = { ...authHeaders(), ...(opts.headers || {}) };
  const res = await fetch('/api' + path, { ...opts, headers });
  if (res.status === 401) { cerrarSesion(); mostrarLogin(); throw new Error('Sesión expirada'); }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.error) || 'Error de red');
  return data;
}

function fmtCOP(v) { return '$' + Number(v || 0).toLocaleString('es-CO'); }
function fmtFecha(iso) {
  if (!iso) return '-';
  const f = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso.replace(' ', 'T'));
  return f.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeAttr(obj) {
  return escapeHtml(JSON.stringify(obj));
}

function toast(msg, tipo = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}
function copiarLinkPublico(url){ navigator.clipboard.writeText(url).then(()=>toast('Link copiado')).catch(()=>{ const i=document.getElementById('input-link-publico'); if(i){i.select(); document.execCommand('copy'); toast('Link copiado');}}); }
async function generarReferido(rifaId){ const input=document.getElementById('input-ref-codigo'); const codigo=(input?.value||'').trim(); try{ const r=await api('/referidos/generar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rifa_id:rifaId,codigo:codigo||undefined})}); if(input) input.value=r.codigo; toast('Código '+r.codigo+' generado'); }catch(e){ toast(e.message,'error'); } }
function copiarLinkReferido(rifaId){ const input=document.getElementById('input-ref-codigo'); const code=(input?.value||'').trim(); const url=window.location.origin+'/r/'+rifaId+(code?'?ref='+encodeURIComponent(code):''); copiarLinkPublico(url); }
async function verPagos(rifaId){ const box=document.getElementById('pagos-lista'); if(!box) return; box.innerHTML='<p class="text-sm text-ink-600">Cargando pagos...</p>'; try{ const pagos=await api('/rifas/'+rifaId+'/pagos'); if(!pagos.length) box.innerHTML='<p class="text-sm text-ink-600">Sin pagos aún. Usa el checkout Wompi en Participantes.</p>'; else box.innerHTML='<div class="table-wrap"><table class="tbl"><thead><tr><th>Ref</th><th>Participante</th><th>Monto</th><th>Estado</th></tr></thead><tbody>'+pagos.map(p=>`<tr><td class="mono text-xs">${escapeHtml(p.referencia)}</td><td>${escapeHtml(p.nombre)}</td><td>${fmtCOP(p.monto)}</td><td><span class="badge badge-${p.estado==='aprobado'?'pagado':p.estado}">${p.estado}</span></td></tr>`).join('')+'</tbody></table></div>'; }catch(e){ box.innerHTML='<p class="text-sm" style="color:var(--red-500);">'+escapeHtml(e.message)+'</p>'; } }
async function iniciarCheckout(rifaId, participanteId){ try{ const r=await api('/rifas/'+rifaId+'/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({participante_id:participanteId})}); if(r.checkoutUrl) window.open(r.checkoutUrl,'_blank'); else { if(confirm('Wompi no configurado (stub). ¿Simular pago aprobado?')){ await fetch('/api/webhooks/wompi',{method:'POST',headers:{'Content-Type':'application/json',...authHeaders()},body:JSON.stringify({referencia:r.referencia,estado:'aprobado'})}); toast('Pago simulado aprobado'); verPagos(rifaId); } } }catch(e){ toast(e.message,'error'); } }

// Números por boleta en rifas de múltiples oportunidades (2, 4 o 5; 0 si no aplica)
function nOport(rifa) {
  if (!rifa || rifa.modalidad_boleta !== 'CUATRO_OPORTUNIDADES') return 0;
  const n = Number(rifa.n_oportunidades) || 4;
  return [2, 4, 5].includes(n) ? n : 4;
}

// Muestra los números de una boleta (1 normal / n en múltiples oportunidades)
// Siempre aplica zero-padding: 2 dígitos (00-99) o 4 dígitos (0000-9999) según modalidad
function mostrarNumerosBoleta(rifa, p) {
  const arr = (p && p.numeros && p.numeros.length ? p.numeros : [p && p.numero]).filter(n => n != null);
  const m = rifa && rifa.modalidad_boleta;
  const es4D = m === 'OPORTUNIDADES_4D' || (m === 'CHANCE_INDIVIDUAL' && Number(rifa.cifras || 4) >= 4);
  const pad = es4D ? 4 : 2;
  return arr.map(n => String(n).padStart(pad, '0')).join(', ');
}

function abrirModal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><div class="modal">${html}</div></div>`;
  document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') cerrarModal();
  });
}
function cerrarModal() { document.getElementById('modal-root').innerHTML = ''; }

// ----------------------- SIDEBAR (desktop: colapsar / móvil: off-canvas) ----------
function esMobile() { return window.innerWidth <= 860; }

function setSidebar(abrir) {
  const sb = document.getElementById('sidebar');
  const back = document.getElementById('sidebar-backdrop');
  const btn = document.getElementById('btn-toggle-sidebar');
  if (esMobile()) {
    sb.classList.toggle('open', abrir);
    back.classList.toggle('visible', abrir);
  } else {
    sb.classList.toggle('colapsado', !abrir);
    try { localStorage.setItem('rifas-sidebar-colapsado', sb.classList.contains('colapsado') ? '1' : '0'); } catch (e) {}
  }
  if (btn) btn.setAttribute('aria-expanded', String(abrir));
}
// Restaurar colapsado en desktop (Fase 1.5)
try { if (!esMobile() && localStorage.getItem('rifas-sidebar-colapsado') === '1') document.getElementById('sidebar')?.classList.add('colapsado'); } catch (e) {}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  if (esMobile()) {
    setSidebar(!sb.classList.contains('open'));
  } else {
    setSidebar(sb.classList.contains('colapsado'));
  }
}

// Restaurar estado del sidebar al redimensionar
let _lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  const sb = document.getElementById('sidebar');
  const back = document.getElementById('sidebar-backdrop');
  const cambioBreakpoint = (_lastWidth > 860) !== (window.innerWidth > 860);
  _lastWidth = window.innerWidth;
  if (cambioBreakpoint) {
    sb.classList.remove('open', 'colapsado');
    back.classList.remove('visible');
  }
});

document.addEventListener('click', (e) => {
  if (e.target.closest('#btn-toggle-sidebar')) toggleSidebar();
  else if (e.target.closest('#sidebar-backdrop')) setSidebar(false);
  else if (e.target.closest('.nav-link') && esMobile()) setSidebar(false);
});

const DISCLAIMER = 'ADVERTENCIA: Esta rifa es modalidad promocional entre particulares. Decreto 2480 de 2005. Cumpla normatividad Coljuegos.';

const BADGE_ESTADO = { borrador: 'Borrador', activa: 'Activa', cerrada: 'Cerrada', sorteada: 'Sorteada' };

// ================================================================================
// ROUTER
// ================================================================================
function activarNav(route) {
  document.querySelectorAll('.nav-link').forEach(a => {
    const isActive = route.startsWith(a.dataset.route) && a.dataset.route !== '';
    a.classList.toggle('active', isActive);
    if (isActive) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

async function router() {
  detenerPolling();
  const hash = window.location.hash.replace('#/', '') || 'rifas';
  const parts = hash.split('/');
  const container = document.getElementById('view-container');
  activarNav(hash);

  try {
    if (parts[0] === 'rifas' && parts[1] === 'nueva') {
      document.getElementById('page-title').textContent = 'Crear rifa';
      container.innerHTML = renderFormularioRifa();
      bindFormularioRifa(null);
    } else if (parts[0] === 'rifas' && parts[2] === 'editar') {
      const rifa = await api('/rifas/' + parts[1]);
      document.getElementById('page-title').textContent = 'Editar rifa';
      container.innerHTML = renderFormularioRifa(rifa);
      bindFormularioRifa(rifa);
    } else if (parts[0] === 'rifas' && parts[1]) {
      await vistaDetalleRifa(parts[1], parts[2] || 'resumen');
    } else if (parts[0] === 'plantillas') {
      document.getElementById('page-title').textContent = 'Plantillas de WhatsApp';
      await vistaPlantillas();
    } else if (parts[0] === 'empresa') {
      document.getElementById('page-title').textContent = 'Mi empresa';
      await vistaEmpresa();
    } else if (parts[0] === 'papelera') {
      document.getElementById('page-title').textContent = 'Papelera de reciclaje';
      await vistaPapelera();
    } else if (parts[0] === 'logs') {
      document.getElementById('page-title').textContent = 'Registro de cambios';
      await vistaLogs();
    } else if (parts[0] === 'changelog') {
      document.getElementById('page-title').textContent = 'Historial de versiones';
      await renderChangelog(container);
    } else if (parts[0] === 'pruebas' && parts[1] === 'rifa' && parts[2]) {
      document.getElementById('page-title').textContent = 'Previsualizar Animación';
      await renderPruebaRifa(container, parts[2]);
    } else if (parts[0] === 'pruebas') {
      document.getElementById('page-title').textContent = 'Probar Animaciones';
      renderPruebasTab(container);
    } else if (parts[0] === 'dashboard') {
      document.getElementById('page-title').textContent = 'Dashboard';
      await renderDashboard(container);
    } else if (parts[0] === 'admin' && parts[1] === 'usuarios') {
      document.getElementById('page-title').textContent = 'Administración de Usuarios';
      await renderAdminUsuarios(container);
    } else if (parts[0] === 'admin') {
      document.getElementById('page-title').textContent = 'Panel de Control';
      await renderAdminDashboard(container);
    } else {
      document.getElementById('page-title').textContent = 'Mis rifas';
      await vistaListaRifas();
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${escapeHtml(err.message)}</p></div>`;
  }
}
window.addEventListener('hashchange', router);

// Vuelve a la vista anterior (o al listado de rifas si no hay historial)
function volverAtras() {
  const partes = (window.location.hash || '#/rifas').replace('#/', '').split('/');
  const actual = partes[0] === 'rifas' && partes.length === 1 ? 'rifas' : partes[0];
  if (actual === 'rifas') { window.location.hash = '#/rifas'; return; }
  if (window.history.length > 1) window.history.back();
  else window.location.hash = '#/rifas';
}

// ================================================================================
// VISTA: LISTA DE RIFAS
// ================================================================================
let _rifasVista = 'grid'; // 'grid' | 'list'
let _rifasFiltro = { estado: '', tipo: '', busqueda: '', categoria: '' };

async function vistaListaRifas() {
  const [rifas, categorias] = await Promise.all([api('/rifas'), api('/categorias').catch(() => [])]);
  const rifasArr = Array.isArray(rifas) ? rifas : [];
  const catsArr = Array.isArray(categorias) ? categorias : [];
  const container = document.getElementById('view-container');
  document.getElementById('topbar-actions').innerHTML = `<a href="#/rifas/nueva" class="btn btn-gold">➕ Crear rifa</a>`;

  if (rifasArr.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">🎟️</div>
        <h3>Aún no tienes rifas</h3>
        <p class="mb-3">Crea tu primera rifa y empieza a vender boletas en minutos.</p>
        <a href="#/rifas/nueva" class="btn btn-gold">Crear mi primera rifa</a>
      </div>`;
    return;
  }

  // Estados y tipos disponibles para filtros
  const estados = [...new Set(rifasArr.map(r => r.estado))];
  const tipos = [...new Set(rifasArr.map(r => r.tipo_rifa))];

  const renderToolbar = () => `
    <div class="rifas-toolbar">
      <div class="rifas-toolbar__filtros">
        <input class="input rifas-search" type="text" placeholder="🔍 Buscar por nombre..." value="${_rifasFiltro.busqueda}" id="rifas-busqueda">
        <select class="input rifas-filter" id="rifas-filtro-estado">
          <option value="">Todos los estados</option>
          ${estados.map(e => `<option value="${e}" ${_rifasFiltro.estado === e ? 'selected' : ''}>${BADGE_ESTADO[e] || e}</option>`).join('')}
        </select>
        <select class="input rifas-filter" id="rifas-filtro-tipo">
          <option value="">Todos los tipos</option>
          ${tipos.map(t => `<option value="${t}" ${_rifasFiltro.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        ${catsArr.length ? `
        <select class="input rifas-filter" id="rifas-filtro-categoria">
          <option value="">Todas las carpetas</option>
          ${catsArr.map(c => `<option value="${escapeHtml(c)}" ${_rifasFiltro.categoria === c ? 'selected' : ''}>📁 ${escapeHtml(c)}</option>`).join('')}
        </select>` : ''}
      </div>
      <div class="rifas-toolbar__vistas">
        <button class="btn btn-sm ${_rifasVista === 'grid' ? 'btn-gold' : 'btn-ghost'}" id="btn-vista-grid" title="Cuadrícula">▦</button>
        <button class="btn btn-sm ${_rifasVista === 'list' ? 'btn-gold' : 'btn-ghost'}" id="btn-vista-list" title="Listado">☰</button>
      </div>
    </div>`;

  const renderRifas = (lista) => {
    if (lista.length === 0) {
      return `<div class="empty-state" style="padding:40px;"><div class="icon">🔍</div><p>No se encontraron rifas con estos filtros.</p></div>`;
    }
    if (_rifasVista === 'list') {
      return `
        <div class="rifas-list">
          ${lista.map(r => `
            <a href="#/rifas/${r.id}" class="rifas-list-item">
              <div class="rifas-list-item__icon">${r.imagen_producto ? `<img src="${r.imagen_producto}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;">` : '🎁'}</div>
              <div class="rifas-list-item__info">
                <div class="flex items-center gap-2 mb-1">
                  <span class="badge badge-${r.estado}" style="font-size:10px;">${BADGE_ESTADO[r.estado]}</span>
                  <span class="text-xs text-ink-600">${fmtFecha(r.fecha_sorteo)}</span>
                </div>
                <h4 style="font-size:14px; margin:0;">${escapeHtml(r.nombre)}</h4>
                <p class="text-xs text-ink-600">${escapeHtml(r.producto)} · ${fmtCOP(r.valor_boleta)} · ${r.tipo_rifa}</p>
              </div>
              <div class="rifas-list-item__stats">
                <div class="progress-track" style="width:80px;"><div class="progress-fill" style="width:${r.porcentaje}%"></div></div>
                <span class="text-xs text-ink-600">${r.vendidos}/${r.cantidad_max_participantes} · ${fmtCOP(r.recaudado)}</span>
              </div>
              <div class="rifas-list-item__actions">
                <button class="btn btn-ghost btn-sm" onclick="event.preventDefault(); event.stopPropagation(); window.location.hash='#/rifas/${r.id}/editar'" title="Editar">✏️</button>
                <button class="btn btn-ghost btn-sm" onclick="event.preventDefault(); event.stopPropagation(); window.location.hash='#/pruebas/rifa/${r.id}'" title="Previsualizar">👁️</button>
                <button class="btn btn-ghost btn-sm" onclick="event.preventDefault(); event.stopPropagation(); moverACarpeta('${r.id}', '${escapeHtml(r.categoria || '')}')" title="Mover a carpeta">📁</button>
                <button class="btn btn-ghost btn-sm" onclick="event.preventDefault(); event.stopPropagation(); clonarRifa('${r.id}')" title="Clonar">📋</button>
                <button class="btn btn-ghost btn-sm" onclick="event.preventDefault(); event.stopPropagation(); eliminarRifa('${r.id}', '${escapeHtml(r.nombre)}')" title="Eliminar" style="color:var(--red-500);">🗑️</button>
              </div>
            </a>`).join('')}
        </div>`;
    }
    return `
      <div class="rifas-grid">
        ${lista.map(r => `
          <a href="#/rifas/${r.id}" class="card card-hover" style="display:block;">
            ${r.imagen_producto ? `<img class="rifa-card__img" src="${r.imagen_producto}">` : `<div class="rifa-card__img flex items-center justify-center" style="font-size:34px;">🎁</div>`}
            <div class="rifa-card__body">
              <div class="flex items-center justify-between mb-2">
                <span class="badge badge-${r.estado}">${BADGE_ESTADO[r.estado]}</span>
                <span class="text-xs text-ink-600">${fmtFecha(r.fecha_sorteo)}${r.hora_sorteo ? ' · ' + r.hora_sorteo + 'h' : ''}</span>
              </div>
              <h3 style="font-size:16px; margin:0 0 4px;">${escapeHtml(r.nombre)}</h3>
              <p class="text-sm text-ink-600 mb-3">${escapeHtml(r.producto)} · ${fmtCOP(r.valor_boleta)}</p>
              <div class="progress-track mb-2"><div class="progress-fill" style="width:${r.porcentaje}%"></div></div>
              <div class="flex justify-between text-xs text-ink-600 mb-2">
                <span>${r.vendidos}/${r.cantidad_max_participantes} vendidos</span>
                <span class="mono" style="font-weight:700; color:var(--emerald-500);">${fmtCOP(r.recaudado)}</span>
              </div>
              <div class="flex gap-2">
                <button class="btn btn-outline btn-sm" style="flex:1; font-size:11px;" onclick="event.preventDefault(); event.stopPropagation(); window.location.hash='#/pruebas/rifa/${r.id}'">👁️ Previsualizar</button>
              </div>
            </div>
          </a>`).join('')}
      </div>`;
  };

  const aplicarFiltros = () => {
    let lista = [...rifasArr];
    if (_rifasFiltro.estado) lista = lista.filter(r => r.estado === _rifasFiltro.estado);
    if (_rifasFiltro.tipo) lista = lista.filter(r => r.tipo_rifa === _rifasFiltro.tipo);
    if (_rifasFiltro.categoria) lista = lista.filter(r => (r.categoria || '') === _rifasFiltro.categoria);
    if (_rifasFiltro.busqueda) {
      const q = _rifasFiltro.busqueda.toLowerCase();
      lista = lista.filter(r => r.nombre.toLowerCase().includes(q) || (r.producto || '').toLowerCase().includes(q));
    }
    document.getElementById('rifas-container').innerHTML = renderRifas(lista);
    bindToolbarEvents();
  };

  const bindToolbarEvents = () => {
    const busq = document.getElementById('rifas-busqueda');
    const filtroEstado = document.getElementById('rifas-filtro-estado');
    const filtroTipo = document.getElementById('rifas-filtro-tipo');
    const filtroCategoria = document.getElementById('rifas-filtro-categoria');
    const btnGrid = document.getElementById('btn-vista-grid');
    const btnList = document.getElementById('btn-vista-list');
    if (busq) busq.addEventListener('input', (e) => { _rifasFiltro.busqueda = e.target.value; aplicarFiltros(); });
    if (filtroEstado) filtroEstado.addEventListener('change', (e) => { _rifasFiltro.estado = e.target.value; aplicarFiltros(); });
    if (filtroTipo) filtroTipo.addEventListener('change', (e) => { _rifasFiltro.tipo = e.target.value; aplicarFiltros(); });
    if (filtroCategoria) filtroCategoria.addEventListener('change', (e) => { _rifasFiltro.categoria = e.target.value; aplicarFiltros(); });
    if (btnGrid) btnGrid.addEventListener('click', () => { _rifasVista = 'grid'; render(); });
    if (btnList) btnList.addEventListener('click', () => { _rifasVista = 'list'; render(); });
  };

  const render = () => {
    container.innerHTML = `${renderToolbar()}<div id="rifas-container"></div>`;
    aplicarFiltros();
  };
  render();
}

function moverACarpeta(id, carpetaActual) {
  const nueva = prompt('Carpeta/categoría para esta rifa:', carpetaActual || '');
  if (nueva === null) return;
  api('/rifas/' + id + '/categoria', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoria: nueva.trim() })
  }).then(() => {
    toast(nueva.trim() ? `Movido a "${nueva.trim()}"` : 'Carpeta eliminada');
    router();
  }).catch(e => toast(e.message, 'error'));
}

// ================================================================================
// VISTA: PAPELERA DE RECICLAJE
// ================================================================================
async function vistaPapelera() {
  const container = document.getElementById('view-container');
  document.getElementById('topbar-actions').innerHTML = `<button class="btn btn-danger btn-sm" onclick="vaciarPapelera()">🧹 Vaciar papelera</button>`;
  const rifas = await api('/papelera');

  if (rifas.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">🗑️</div>
        <h3>La papelera está vacía</h3>
        <p class="mb-3">Cuando elimines una rifa quedará aquí de forma temporal por si hay imprevistos. Puedes restaurarla o purgarla para siempre.</p>
        <a href="#/rifas" class="btn btn-gold">Volver a mis rifas</a>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div style="background:rgba(245,158,11,.1); border:1px solid rgba(245,158,11,.3); border-radius:8px; padding:12px 16px; margin-bottom:16px; display:flex; align-items:center; gap:10px;">
      <span style="font-size:20px;">⏰</span>
      <div>
        <div style="font-weight:600;">Purge automático activado</div>
        <div class="text-xs text-ink-600">Las rifas eliminadas se borran permanentemente después de <strong>30 días</strong>. Restaura antes de esa fecha si la necesitas.</div>
      </div>
    </div>
    <p class="text-sm text-ink-600 mb-4">🗑️ Las rifas eliminadas se guardan aquí <strong>temporalmente</strong>. Puedes <strong>restaurarlas</strong> si fue un error, o <strong>purgarlas</strong> para borrarlas definitivamente.</p>
    <div class="rifas-grid">
      ${rifas.map(r => {
        const diasRestantes = 30 - Math.floor((Date.now() - new Date(r.borrada_en).getTime()) / 86400000);
        const urgente = diasRestantes <= 7;
        return `
        <div class="card card-pad" style="opacity:.92;">
          <div class="flex items-center justify-between mb-2">
            <span class="badge badge-cerrada">🗑️ Eliminada ${fmtFecha(r.borrada_en)}</span>
            <span class="text-xs ${urgente ? 'text-bold' : ''}" style="color:${urgente ? '#ef4444' : 'var(--ink-600)'};">${diasRestantes > 0 ? diasRestantes + ' días restantes' : 'Purga pendiente'}</span>
          </div>
          <h3 style="font-size:16px; margin:0 0 4px;">${escapeHtml(r.nombre)}</h3>
          <p class="text-sm text-ink-600 mb-2">${escapeHtml(r.producto)} · ${fmtCOP(r.valor_boleta)}</p>
          <p class="text-xs text-ink-600 mb-3">${r.pagados} pagadas · ${r.pendientes} pendientes · Recaudado ${fmtCOP(r.recaudado)}</p>
          <div class="flex gap-2">
            <button class="btn btn-gold btn-sm" onclick="restaurarRifa(${r.id})">↩️ Restaurar</button>
            <button class="btn btn-danger btn-sm" onclick="purgarRifa(${r.id})">🗑️ Borrar para siempre</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

async function restaurarRifa(id) {
  try {
    await api('/papelera/' + id + '/restaurar', { method: 'POST' });
    toast('↩️ Rifa restaurada');
    vistaPapelera();
  } catch (e) { toast(e.message, 'error'); }
}

async function purgarRifa(id) {
  if (!confirm('⚠️ Esto borra la rifa y TODOS sus datos de forma PERMANENTE. No se puede deshacer. ¿Continuar?')) return;
  try {
    await api('/papelera/' + id, { method: 'DELETE' });
    toast('Rifa eliminada definitivamente');
    vistaPapelera();
  } catch (e) { toast(e.message, 'error'); }
}

async function vaciarPapelera() {
  if (!confirm('⚠️ ¿Vaciar la papelera? Todas las rifas eliminadas se borrarán PERMANENTEMENTE.')) return;
  try {
    const r = await api('/papelera', { method: 'DELETE' });
    toast(`🧹 ${r.purgadas} rifa(s) purgadas`);
    vistaPapelera();
  } catch (e) { toast(e.message, 'error'); }
}

// ================================================================================
// VISTA: LOGS / REGISTRO DE CAMBIOS (AUDITORÍA)
// ================================================================================
const LOG_ACCIONES = {
  creacion: { label: 'Creación', icon: '✨', cls: 'badge-activa' },
  'cambio-estado': { label: 'Estado', icon: '🔁', cls: 'badge-cerrada' },
  config: { label: 'Configuración', icon: '⚙️', cls: 'badge-activa' },
  registro: { label: 'Venta', icon: '🎟️', cls: 'badge-activa' },
  'registro-masivo': { label: 'Venta masiva', icon: '📦', cls: 'badge-activa' },
  pago: { label: 'Pago', icon: '💳', cls: 'badge-activa' },
  'edicion-participante': { label: 'Edición', icon: '✏️', cls: 'badge-cerrada' },
  'liberacion-manual': { label: 'Liberación', icon: '🔓', cls: 'badge-cerrada' },
  'auto-liberacion': { label: 'Auto-liberación', icon: '⏰', cls: 'badge-cerrada' },
  sorteo: { label: 'Sorteo', icon: '🎯', cls: 'badge-sorteada' },
  'sorteo-chance': { label: 'Chance', icon: '🎰', cls: 'badge-sorteada' },
  'sorteo-chance-revancha': { label: 'Revancha', icon: '🔁', cls: 'badge-sorteada' },
  'sorteo-balotera': { label: 'Balotera', icon: '🎱', cls: 'badge-sorteada' },
  'sorteo-finalizado': { label: 'Finalizado', icon: '🏁', cls: 'badge-sorteada' },
  clonacion: { label: 'Clonación', icon: '📋', cls: 'badge-activa' },
  eliminacion: { label: 'Eliminada', icon: '🗑️', cls: 'badge-cerrada' },
  restauracion: { label: 'Restaurada', icon: '↩️', cls: 'badge-activa' },
  purga: { label: 'Purga', icon: '🔥', cls: 'badge-cerrada' },
  poster: { label: 'Poster', icon: '🖼️', cls: 'badge-activa' }
};

function badgeLog(a) {
  const info = LOG_ACCIONES[a] || { label: a, icon: '📝', cls: 'badge-borrador' };
  return `<span class="badge ${info.cls}" title="${escapeHtml(a)}">${info.icon} ${info.label}</span>`;
}

function fmtLogFecha(iso) {
  if (!iso) return '-';
  const f = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(f.getTime())) return iso;
  return f.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function vistaLogs() {
  const container = document.getElementById('view-container');
  document.getElementById('topbar-actions').innerHTML = `<button class="btn btn-outline btn-sm" id="btn-refresh-logs">🔄 Refrescar</button>`;
  container.innerHTML = `
    <div class="card card-pad mb-4">
      <div class="grid-3">
        <div class="field">
          <label>Buscar</label>
          <input class="input" id="log-q" placeholder="Rifa o detalle...">
        </div>
        <div class="field">
          <label>Rifa</label>
          <select class="input" id="log-rifa"><option value="">Todas las rifas</option></select>
        </div>
        <div class="field">
          <label>Tipo de cambio</label>
          <select class="input" id="log-accion"><option value="">Todos</option>${Object.keys(LOG_ACCIONES).map(a => `<option value="${a}">${LOG_ACCIONES[a].icon} ${LOG_ACCIONES[a].label}</option>`).join('')}</select>
        </div>
      </div>
    </div>
    <div id="log-resultado"><div class="empty-state"><div class="icon">⏳</div><p>Cargando registros...</p></div></div>`;

  try {
    const rifas = await api('/rifas');
    const sel = document.getElementById('log-rifa');
    rifas.forEach(r => { sel.insertAdjacentHTML('beforeend', `<option value="${r.id}">${escapeHtml(r.nombre)}</option>`); });
  } catch (e) { /* sin rifas, no importa */ }

  const cargar = async () => {
    const params = new URLSearchParams();
    const q = document.getElementById('log-q').value.trim();
    const rid = document.getElementById('log-rifa').value;
    const ac = document.getElementById('log-accion').value;
    if (q) params.set('q', q);
    if (rid) params.set('rifa_id', rid);
    if (ac) params.set('accion', ac);
    const logs = await api('/logs?' + params.toString());
    const box = document.getElementById('log-resultado');
    if (!logs || !logs.length) {
      box.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>No hay registros que coincidan.</p></div>`;
      return;
    }
    box.innerHTML = `<div class="card card-pad"><div style="overflow-x:auto;">
      <table class="tbl">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Rifa</th><th>Detalle</th>${state.usuario?.rol === 'super_admin' ? '<th>Usuario</th>' : ''}</tr></thead>
        <tbody>
          ${logs.map(l => `
            <tr>
              <td class="text-sm mono" style="white-space:nowrap;">${fmtLogFecha(l.fecha)}</td>
              <td style="white-space:nowrap;">${badgeLog(l.accion)}</td>
              <td>${l.rifa_nombre ? `<a class="text-link" href="#/rifas/${l.rifa_id}">${escapeHtml(l.rifa_nombre)}</a> <span class="text-xs text-ink-600">#${l.rifa_id}</span>` : '<span class="text-xs text-ink-600">(rifa eliminada)</span>'}</td>
              <td class="text-sm">${escapeHtml(l.detalle || '')}</td>
              ${state.usuario?.rol === 'super_admin' ? `<td class="text-sm">${escapeHtml(l.usuario || '—')}</td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table></div></div>`;
  };

  ['log-q', 'log-rifa', 'log-accion'].forEach(id => {
    document.getElementById(id).addEventListener(id === 'log-q' ? 'input' : 'change', cargar);
  });
  document.getElementById('btn-refresh-logs').addEventListener('click', cargar);
  await cargar();
}

// ================================================================================
// VISTA: FORMULARIO CREAR / EDITAR RIFA
// ================================================================================
function renderFormularioRifa(rifa) {
  const v = rifa || {};
  return `
  <form id="form-rifa" class="card card-pad" style="max-width:760px; margin:0 auto;">
    <h3 class="mb-4">Datos de la rifa</h3>

    <div class="field">
      <label>Nombre de la rifa</label>
      <input class="input" name="nombre" required placeholder="Ej: Gran Rifa de Fin de Año" value="${escapeHtml(v.nombre || '')}">
    </div>

    <div class="grid-2">
      <div class="field">
        <label>Producto / premio</label>
        <input class="input" name="producto" required placeholder="Ej: Moto Honda 125" value="${escapeHtml(v.producto || '')}">
      </div>
      <div class="field">
        <label>Valor de la boleta (COP)</label>
        <input class="input" name="valor_boleta" type="number" min="1000" step="1000" required placeholder="20000" value="${v.valor_boleta || ''}">
      </div>
    </div>

    <div class="field">
      <label>Descripción</label>
      <textarea class="input" name="descripcion" rows="3" placeholder="Detalles del premio, condiciones, etc.">${escapeHtml(v.descripcion || '')}</textarea>
    </div>

    <div class="grid-2">
      <div class="field">
        <label>Fecha del sorteo</label>
        <input class="input" name="fecha_sorteo" type="date" required value="${(v.fecha_sorteo || '').slice(0, 10)}">
      </div>
      <div class="field" id="campo-hora-sorteo" ${v.tipo_rifa === 'ruleta' ? '' : 'style="display:none"'}>
        <label>Hora del sorteo <em class="req">*</em> <span class="text-xs text-ink-600">(rifas virtuales)</span></label>
        <input class="input" name="hora_sorteo" type="time" value="${(v.hora_sorteo || '19:00').slice(0, 5)}">
        <span class="hint">Obligatoria para rifas virtuales (Ruleta en vivo).</span>
      </div>
    </div>

    <div class="grid-2">
      <div class="field">
        <label>Modalidad de boleta</label>
        <select class="input" name="modalidad_boleta" id="modalidad-boleta">
          <option value="BOLETAS_NORMAL" ${(v.modalidad_boleta || 'BOLETAS_NORMAL') === 'BOLETAS_NORMAL' ? 'selected' : ''}>Boleta normal (1 número)</option>
          <option value="CUATRO_OPORTUNIDADES" ${v.modalidad_boleta === 'CUATRO_OPORTUNIDADES' ? 'selected' : ''}>Múltiples oportunidades (2, 4 o 5 números 00-99)</option>
          <option value="CHANCE_3_GANADORES" ${v.modalidad_boleta === 'CHANCE_3_GANADORES' ? 'selected' : ''}>3 Ganadores (4 cifras, sin símbolo)</option>
          <option value="CHANCE_CON_SIMBOLO" ${v.modalidad_boleta === 'CHANCE_CON_SIMBOLO' ? 'selected' : ''}>1 o 3 Ganadores (4 cifras + símbolo)</option>
          <option value="CHANCE_INDIVIDUAL" ${v.modalidad_boleta === 'CHANCE_INDIVIDUAL' ? 'selected' : ''}>Chance individual (elige 00-99 o 0000-9999)</option>
          <option value="OPORTUNIDADES_4D" ${v.modalidad_boleta === 'OPORTUNIDADES_4D' ? 'selected' : ''}>Múltiples oportunidades 0000-9999 (al azar)</option>
        </select>
      </div>
      <div class="field">
        <label>Tipo de rifa (modalidad del sorteo)</label>
        <select class="input" name="tipo_rifa" id="sel-tipo-rifa">
          <option value="aleatoria" ${v.tipo_rifa === 'aleatoria' ? 'selected' : ''}>Aleatoria</option>
          <option value="loteria" ${v.tipo_rifa === 'loteria' ? 'selected' : ''}>Por lotería</option>
          <option value="tapazo" ${v.tipo_rifa === 'tapazo' ? 'selected' : ''}>Tapazo</option>
          <option value="ruleta" ${v.tipo_rifa === 'ruleta' ? 'selected' : ''}>Ruleta en vivo</option>
        </select>
      </div>
    </div>

    <div id="config-multiples" style="display:${v.modalidad_boleta === 'CUATRO_OPORTUNIDADES' ? 'block' : 'none'};">
      <div class="field" style="max-width:260px;">
        <label>Números por boleta (oportunidades)</label>
        <select class="input" name="n_oportunidades" id="sel-oportunidades">
          <option value="2" ${(Number(v.n_oportunidades) || 4) === 2 ? 'selected' : ''}>2 números (00-99 · máx 50 boletas)</option>
          <option value="4" ${(Number(v.n_oportunidades) || 4) === 4 ? 'selected' : ''}>4 números (00-99 · máx 25 boletas)</option>
          <option value="5" ${(Number(v.n_oportunidades) || 4) === 5 ? 'selected' : ''}>5 números (00-99 · máx 20 boletas)</option>
        </select>
        <span class="hint">Cada boleta compra <strong>n números</strong> (uno por bloque de 00-99, sin repetir) repartidos al azar.</span>
      </div>
    </div>

    <div id="config-chance" style="display:${modoEsChance(v) ? 'block' : 'none'};">
      <div class="field" data-campo-simbolos>
        <label>Símbolos de la boleta (separados por espacio o coma)</label>
        <input class="input" name="simbolos_texto" placeholder="😁 🥰 😎 🔥 🍀 ⭐ ❤️ 💰 🎯 🏆"
          value="${escapeHtml(v.simbolos ? (JSON.parse(v.simbolos) || []).join(' ') : '😁 🥰 😎 🔥 🍀 ⭐ ❤️ 💰 🎯 🏆')}">
        <span class="hint">La boleta es el número (00-99) + el símbolo. Ej: "47 😁". Cada símbolo agrega 100 boletas (máx 50 símbolos = 5.000 boletas).</span>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Cifras del sorteo</label>
          <select class="input" name="cifras" id="sel-cifras">
            <option value="2" ${(v.cifras || 4) === 2 ? 'selected' : ''}>2 cifras (1 premio)</option>
            <option value="4" ${(v.cifras || 4) === 4 ? 'selected' : ''}>4 cifras (3 premios)</option>
            <option value="5" ${(v.cifras || 4) === 5 ? 'selected' : ''}>5 cifras (4 premios)</option>
          </select>
          <span class="hint">El sorteo dibuja el número de cifras elegido <strong>+ 1 símbolo</strong>. Cada premio es un grupo de 2 cifras seguidas.</span>
        </div>
        <div class="field" data-campo-premio="A">
          <label>Premio 1 <span class="text-xs text-ink-600" id="pos-premio-1"></span></label>
          <input class="input" name="premio1_nombre" value="${escapeHtml(v.premio1_nombre || 'Premio 1')}">
        </div>
      </div>
      <div class="grid-3">
        <div class="field" data-campo-premio="B">
          <label>Premio 2 <span class="text-xs text-ink-600" id="pos-premio-2"></span></label>
          <input class="input" name="premio2_nombre" value="${escapeHtml(v.premio2_nombre || 'Premio 2')}">
        </div>
        <div class="field" data-campo-premio="C">
          <label>Premio 3 <span class="text-xs text-ink-600" id="pos-premio-3"></span></label>
          <input class="input" name="premio3_nombre" value="${escapeHtml(v.premio3_nombre || 'Premio 3')}">
        </div>
        <div class="field" data-campo-premio="D">
          <label>Premio 4 <span class="text-xs text-ink-600" id="pos-premio-4"></span></label>
          <input class="input" name="premio4_nombre" value="${escapeHtml(v.premio4_nombre || 'Premio 4')}">
        </div>
      </div>
    </div>

    <label class="check-row"><input type="checkbox" name="revancha_permitida" ${v.revancha_permitida ? 'checked' : ''}> <span>Permitir <strong>revancha</strong> cuando un premio no tiene ganador</span></label>

    <div class="field">
      <label>Asignación de números al vender</label>
      <select class="input" name="modo_asignacion">
        <option value="AL_AZAR" ${(v.modo_asignacion || 'AL_AZAR') === 'AL_AZAR' ? 'selected' : ''}>Al azar (el sistema asigna)</option>
        <option value="A_ELECCION" ${v.modo_asignacion === 'A_ELECCION' ? 'selected' : ''}>A elección (el cliente elige en una grilla)</option>
      </select>
      <span class="hint">En "A elección" el comprador ve la grilla 10×10 (verdes = disponibles, rojas = vendidas) y escoge su boleta.</span>
    </div>

    <div class="grid-3">
      <div class="field">
        <label>Cantidad máxima de participantes</label>
        <input class="input" name="cantidad_max_participantes" type="number" min="1" required value="${v.cantidad_max_participantes || 100}" ${v.modalidad_boleta === 'CUATRO_OPORTUNIDADES' || v.modalidad_boleta === 'CHANCE_CON_SIMBOLO' ? 'disabled' : ''}>
      </div>
      <div class="field">
        <label>Rango de números — desde</label>
        <input class="input" name="rango_min" type="number" min="0" value="${v.rango_min ?? 0}" ${v.modalidad_boleta === 'CUATRO_OPORTUNIDADES' || v.modalidad_boleta === 'CHANCE_CON_SIMBOLO' ? 'disabled' : ''}>
      </div>
      <div class="field">
        <label>Rango de números — hasta</label>
        <input class="input" name="rango_max" type="number" min="1" required value="${v.rango_max || 99}" ${v.modalidad_boleta === 'CUATRO_OPORTUNIDADES' || v.modalidad_boleta === 'CHANCE_CON_SIMBOLO' ? 'disabled' : ''}>
      </div>
    </div>
    <p class="text-xs text-ink-600 mt-2 mb-3" id="hint-modalidad">
      ${v.modalidad_boleta === 'CUATRO_OPORTUNIDADES'
        ? `Múltiples oportunidades usa siempre los números del <strong>00 al 99</strong>: cada boleta compra <strong>${(Number(v.n_oportunidades) || 4)} números</strong> y hay un máximo de <strong>${100 / (Number(v.n_oportunidades) || 4)} boletas</strong> (sin repetir).`
        : v.modalidad_boleta === 'CHANCE_CON_SIMBOLO'
          ? 'El chance usa siempre los números del <strong>00 al 99</strong>. Cada símbolo multiplica la cantidad de boletas disponibles.'
          : 'El rango de números no se puede editar una vez creada la rifa.'}
    </p>

    <div class="field">
  <label class="check-row mb-1"><input type="checkbox" id="chk-auto-liberar" ${(v.auto_liberar_horas ?? 0) > 0 ? 'checked' : ''}> <span>Habilitar <strong>auto-liberación</strong> de boletas con pago pendiente</span></label>
  <div id="campo-auto-liberar">
    <input class="input" name="auto_liberar_horas" type="number" min="0" value="${v.auto_liberar_horas ?? 0}">
        <span class="hint">La boleta se libera automáticamente si el pago sigue pendiente más de este número de horas.</span>
      </div>
    </div>

    <div class="field">
      <label class="check-row mb-1"><input type="checkbox" id="chk-50-50" ${(v.modalidad_premio === '50_50') ? 'checked' : ''}> <span>Modalidad <strong>50/50</strong> — el organizador se queda con el 50% de la recaudación</span></label>
      <div id="campo-50-50" style="display:${(v.modalidad_premio === '50_50') ? '' : 'none'};">
        <input class="input" name="porcentaje_organizador" type="number" min="10" max="90" value="${v.porcentaje_organizador || 50}">
        <span class="hint">Porcentaje que se queda el organizador (el resto es el premio del ganador).</span>
      </div>
    </div>

    <div class="field">
      <label>Mensaje de WhatsApp para promocionar (opcional)</label>
      <textarea class="input" name="mensaje_whatsapp" rows="2" placeholder="¡Participa en nuestra rifa! 🎉">${escapeHtml(v.mensaje_whatsapp || '')}</textarea>
    </div>

    <div class="grid-2">
      <div class="field">
        <label>Imagen del producto</label>
        <div class="upload-box" id="box-imagen_producto">📷 Haz clic para subir imagen<br>
          ${v.imagen_producto ? `<img class="upload-preview" src="${v.imagen_producto}">` : ''}
        </div>
        <input type="file" name="imagen_producto" accept="image/*" style="display:none">
      </div>
      <div class="field">
        <label>Banner de empresa (opcional)</label>
        <div class="upload-box" id="box-banner_empresa">🏢 Haz clic para subir banner<br>
          ${v.banner_empresa ? `<img class="upload-preview" src="${v.banner_empresa}">` : ''}
        </div>
        <input type="file" name="banner_empresa" accept="image/*" style="display:none">
      </div>
    </div>

    <div class="legal-box mt-3 mb-4">⚖️ ${DISCLAIMER}</div>

    <div class="flex gap-3">
      <button type="submit" class="btn btn-outline" data-estado="borrador">Guardar como borrador</button>
      <button type="submit" class="btn btn-gold" data-estado="activa">Guardar y activar</button>
      <a href="#/rifas" class="btn btn-ghost">Cancelar</a>
    </div>
  </form>`;
}

function bindFormularioRifa(rifa) {
  const form = document.getElementById('form-rifa');

  // Auto-ajuste de la modalidad (00-99 fijo para 4 Oportunidades y Chance)
  const selModalidad = form.querySelector('#modalidad-boleta');
  const configChance = document.getElementById('config-chance');
  const aplicarModalidad = () => {
    const val = selModalidad.value;
    const esCuatro = val === 'CUATRO_OPORTUNIDADES';
    const esOport4D = val === 'OPORTUNIDADES_4D';
    const esCh = modoEsChance({ modalidad_boleta: val });
    const esChSimbolo = val === 'CHANCE_CON_SIMBOLO';
    const esCh3G = val === 'CHANCE_3_GANADORES';
    const esChInd = val === 'CHANCE_INDIVIDUAL';
    const rangoMin = form.querySelector('input[name=rango_min]');
    const rangoMax = form.querySelector('input[name=rango_max]');
    const cantidad = form.querySelector('input[name=cantidad_max_participantes]');
    const hint = document.getElementById('hint-modalidad');
    const configMultiples = document.getElementById('config-multiples');
    const selOport = document.getElementById('sel-oportunidades');
    const selCif = form.querySelector('#sel-cifras');
    if (esCuatro) {
      const n = Number(selOport ? selOport.value : 4);
      rangoMin.value = 0; rangoMax.value = 99; cantidad.value = String(100 / n);
      rangoMin.disabled = rangoMax.disabled = cantidad.disabled = true;
      if (hint) hint.innerHTML = `Múltiples oportunidades usa siempre los números del <strong>00 al 99</strong>: cada boleta compra <strong>${n} números</strong> y hay un máximo de <strong>${100 / n} boletas</strong> (sin repetir).`;
    } else if (esCh) {
      rangoMin.value = 0; rangoMax.value = 99;
      rangoMin.disabled = rangoMax.disabled = cantidad.disabled = true;
      if (esChSimbolo) {
        if (hint) hint.innerHTML = 'Chance <strong>con símbolo</strong>: 1 o 3 ganadores. Cada símbolo = 100 boletas (ej: 6 símbolos = 600). El sorteo elige 1 símbolo ganador.';
        if (selCif) selCif.disabled = false;
      } else if (esCh3G) {
        if (hint) hint.innerHTML = 'Chance <strong>3 Ganadores (4 cifras, sin símbolo)</strong>: GANADOR 1 = 2 primeros, GANADOR 2 = 2 del medio, GANADOR 3 = 2 últimos.';
        if (selCif) { selCif.value = '4'; selCif.disabled = true; }
      } else if (esChInd) {
        if (hint) hint.innerHTML = 'Chance <strong>individual</strong>: el comprador elige su número (00-99 o 0000-9999). 1 ganador.';
        if (selCif) selCif.disabled = false;
      }
    } else if (esOport4D) {
      rangoMin.value = 0; rangoMax.value = 9999; cantidad.value = 10000;
      rangoMin.disabled = rangoMax.disabled = cantidad.disabled = true;
      if (hint) hint.innerHTML = 'Múltiples oportunidades <strong>0000-9999</strong>: cada boleta compra números al azar de 4 cifras, sin repetir (máximo <strong>10.000 boletas</strong>).';
    } else {
      rangoMin.value = 0; rangoMax.value = 99; cantidad.value = 100;
      rangoMin.disabled = rangoMax.disabled = cantidad.disabled = false;
      if (hint) hint.innerHTML = rifa ? 'Rango de números de la rifa.' : 'El rango de números no se puede editar una vez creada la rifa.';
    }
    if (configChance) configChance.style.display = esCh ? 'block' : 'none';
    if (configMultiples) configMultiples.style.display = esCuatro ? 'block' : 'none';
    const simField = form.querySelector('[data-campo-simbolos]');
    if (simField) simField.style.display = esChSimbolo ? '' : 'none';
    aplicarCifras();
  };
  if (selModalidad) {
    aplicarModalidad();
    selModalidad.addEventListener('change', aplicarModalidad);
  }
  // Al cambiar la cantidad de oportunidades se recalcula el cupo y el texto
  const selOport = form.querySelector('#sel-oportunidades');
  if (selOport) {
    selOport.addEventListener('change', aplicarModalidad);
  }


  // Cifras del sorteo del chance: muestra solo los premios correspondientes
  // y recalcula rango + cantidad máxima de participantes según cifras/símbolos
  function aplicarCifras() {
    const sel = form.querySelector('#sel-cifras');
    if (!sel) return;
    const n = Number(sel.value);
    const val = selModalidad.value;
    const esInd = val === 'CHANCE_INDIVIDUAL';
    const esSimbolo = val === 'CHANCE_CON_SIMBOLO';
    const rangoMin = form.querySelector('input[name=rango_min]');
    const rangoMax = form.querySelector('input[name=rango_max]');
    const cantidad = form.querySelector('input[name=cantidad_max_participantes]');
    let total = 0;
    if (val === 'CHANCE_3_GANADORES') {
      total = 100;
      if (rangoMin) rangoMin.value = 0;
      if (rangoMax) rangoMax.value = 99;
    } else if (esInd) {
      total = Math.pow(10, n);
      if (rangoMin) rangoMin.value = 0;
      if (rangoMax) rangoMax.value = Math.pow(10, n) - 1;
    } else if (esSimbolo) {
      const simInput = form.querySelector('input[name=simbolos_texto]');
      const simText = simInput && simInput.value ? simInput.value.trim() : '';
      const sims = simText ? simText.split(/[\s,]+/).filter(Boolean).length : 0;
      total = 100 * (sims || 1);
      if (rangoMin) rangoMin.value = 0;
      if (rangoMax) rangoMax.value = 99;
    }
    if (cantidad && total) cantidad.value = String(total);
    const posiciones = esInd
      ? { 1: n === 4 ? 'GANADOR · 4 cifras (0000-9999)' : 'GANADOR · 2 cifras (00-99)' }
      : {
        2: { 1: 'GANADOR · las 2 cifras' },
        4: { 1: 'GANADOR 1 · 2 primeros', 2: 'GANADOR 2 · 2 del medio', 3: 'GANADOR 3 · 2 últimos' },
        5: { 1: '1ª y 2ª cifra', 2: '2ª y 3ª cifra', 3: '3ª y 4ª cifra', 4: '4ª y 5ª cifra' }
      }[n] || {};
    ['A', 'B', 'C', 'D'].forEach((t, i) => {
      const campo = form.querySelector('[data-campo-premio="' + t + '"]');
      if (campo) campo.style.display = posiciones[i + 1] ? '' : 'none';
      const span = document.getElementById('pos-premio-' + (i + 1));
      if (span) span.textContent = posiciones[i + 1] ? '(' + posiciones[i + 1] + ')' : '';
    });
  };
  const selCifras = form.querySelector('#sel-cifras');
  if (selCifras) {
    aplicarCifras();
    selCifras.addEventListener('change', aplicarCifras);
  }
  const simInput = form.querySelector('input[name=simbolos_texto]');
  if (simInput) simInput.addEventListener('input', aplicarCifras);


  // Toggle habilitar/deshabilitar la auto-liberación de boletas pendientes
  const chkAuto = document.getElementById('chk-auto-liberar');
  const campoAuto = document.getElementById('campo-auto-liberar');
  const inputAuto = form.querySelector('input[name=auto_liberar_horas]');
  if (chkAuto && campoAuto && inputAuto) {
    const aplicarAuto = () => {
      const on = chkAuto.checked;
      campoAuto.style.opacity = on ? '1' : '.55';
      inputAuto.disabled = !on;
      if (!on) inputAuto.value = '0';
      else if (!Number(inputAuto.value)) inputAuto.value = '24';
    };
    aplicarAuto();
    chkAuto.addEventListener('change', aplicarAuto);
  }

  // Toggle modalidad 50/50
  const chk5050 = document.getElementById('chk-50-50');
  const campo5050 = document.getElementById('campo-50-50');
  const input5050 = form.querySelector('input[name=porcentaje_organizador]');
  if (chk5050 && campo5050 && input5050) {
    const aplicar5050 = () => {
      const on = chk5050.checked;
      campo5050.style.display = on ? '' : 'none';
      input5050.disabled = !on;
      if (!on) input5050.value = '0';
      else if (!Number(input5050.value)) input5050.value = '50';
    };
    aplicar5050();
    chk5050.addEventListener('change', aplicar5050);
  }

  // La hora del sorteo solo es obligatoria para rifas virtuales (Ruleta en vivo)
  const campoHora = document.getElementById('campo-hora-sorteo');
  const selTipo = form.querySelector('#sel-tipo-rifa');
  const aplicarHora = () => {
    if (!campoHora) return;
    const esVirtual = selTipo.value === 'ruleta';
    campoHora.style.display = esVirtual ? 'block' : 'none';
    const inputHora = campoHora.querySelector('input[name=hora_sorteo]');
    if (inputHora) inputHora.required = esVirtual;
  };
  if (selTipo) {
    aplicarHora();
    selTipo.addEventListener('change', aplicarHora);
  }

  // Cajas de upload -> abren el input file oculto y muestran preview
  ['imagen_producto', 'banner_empresa'].forEach(campo => {
    const box = document.getElementById('box-' + campo);
    const input = form.querySelector(`input[name="${campo}"]`);
    box.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      if (!input.files[0]) return;
      const url = URL.createObjectURL(input.files[0]);
      let img = box.querySelector('img');
      if (!img) { img = document.createElement('img'); img.className = 'upload-preview'; box.appendChild(img); }
      img.src = url;
    });
  });

  let estadoElegido = rifa ? rifa.estado : 'borrador';
  form.querySelectorAll('button[type=submit]').forEach(btn => {
    btn.addEventListener('click', () => { estadoElegido = btn.dataset.estado; });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    fd.set('estado', estadoElegido);
    if (fd.get('tipo_rifa') !== 'ruleta') fd.delete('hora_sorteo'); // la hora es para rifas virtuales
    // Los campos deshabilitados no viajan en FormData: forzamos valores
    const esCuatro = fd.get('modalidad_boleta') === 'CUATRO_OPORTUNIDADES';
    const esChance = fd.get('modalidad_boleta') === 'CHANCE_CON_SIMBOLO';
    const esOport4D = fd.get('modalidad_boleta') === 'OPORTUNIDADES_4D';
    if (esCuatro) {
      const n = Number(fd.get('n_oportunidades') || 4);
      fd.set('rango_min', '0'); fd.set('rango_max', '99'); fd.set('cantidad_max_participantes', String(100 / n));
    }
    if (esChance) {
      const simbolos = (fd.get('simbolos_texto') || '')
        .split(/[\s,;]+/).map(s => s.trim().slice(0, 4)).filter(Boolean);
      const total = 100 * Math.min(50, Math.max(1, simbolos.length));
      fd.set('simbolos', JSON.stringify(simbolos));
      fd.set('rango_min', '0'); fd.set('rango_max', '99'); fd.set('cantidad_max_participantes', String(total));
    }
    if (esOport4D) {
      fd.set('rango_min', '0');
      fd.set('rango_max', '9999');
      fd.set('cantidad_max_participantes', '10000');
    }
    if (!esCuatro && !esChance && !esOport4D) {
      fd.set('rango_min', fd.get('rango_min') || '0');
      fd.set('rango_max', fd.get('rango_max') || '99');
      fd.set('cantidad_max_participantes', fd.get('cantidad_max_participantes') || '100');
    }
    // Si la auto-liberación está deshabilitada, forzar 0 (el input deshabilitado no viaja en FormData)
    if (chkAuto && !chkAuto.checked) fd.set('auto_liberar_horas', '0');
    // Modalidad 50/50
    if (chk5050 && chk5050.checked) {
      fd.set('modalidad_premio', '50_50');
      fd.set('porcentaje_organizador', input5050 ? input5050.value : '50');
    } else {
      fd.set('modalidad_premio', 'completo');
      fd.set('porcentaje_organizador', '0');
    }
    try {
      const guardado = rifa
        ? await apiForm('/rifas/' + rifa.id, fd, 'PUT')
        : await apiForm('/rifas', fd, 'POST');
      toast(rifa ? 'Rifa actualizada' : 'Rifa creada correctamente');
      window.location.hash = rifa ? '#/rifas/' + guardado.id + '/participantes' : '#/rifas/' + guardado.id;
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function apiForm(path, formData, method = 'POST') {
  const res = await fetch('/api' + path, { method, body: formData, headers: authHeaders() });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401) { cerrarSesion(); mostrarLogin(); throw new Error('Sesión expirada, vuelve a ingresar'); }
  if (!res.ok) throw new Error((data && data.error) || 'Error al guardar');
  return data;
}

// ================================================================================
// VISTA: DETALLE DE RIFA (tabs)
// ================================================================================
async function vistaDetalleRifa(id, tab) {
  const [rifa, dashboard] = await Promise.all([api('/rifas/' + id), api('/rifas/' + id + '/dashboard')]);
  state.rifaActual = rifa;
  document.getElementById('page-title').textContent = rifa.nombre;
  document.getElementById('topbar-actions').innerHTML = `
    <div class="flex gap-2">
      <span class="badge badge-${rifa.estado}">${BADGE_ESTADO[rifa.estado]}</span>
      <a href="#/rifas/${id}/editar" class="btn btn-outline btn-sm">✏️ Editar</a>
      <button class="btn btn-outline btn-sm" onclick="clonarRifa(${id})">📋 Clonar</button>
      <button class="btn btn-danger btn-sm" onclick="eliminarRifa(${id})">🗑️ Eliminar</button>
    </div>`;

  const tabs = [
    ['resumen', '📊 Resumen'], ['participantes', '👥 Participantes'],
    ['publicidad', '📣 Publicidad'], ['balotera', '🎱 Balotera'], ['sorteo', '🎯 Sorteo'],
    ['whatsapp', '📲 WhatsApp'], ['historial', '🕓 Historial']
  ];
  const idxActual = Math.max(0, tabs.findIndex(([k]) => k === tab));
  const prev = tabs[idxActual - 1];
  const next = tabs[idxActual + 1];

  document.getElementById('view-container').innerHTML = `
    <div class="tabs">
      ${tabs.map(([k, l]) => `<a class="tab ${tab === k ? 'active' : ''}" href="#/rifas/${id}/${k}">${l}</a>`).join('')}
    </div>
    <div id="tab-content"></div>
    <div class="nav-pager">
      ${prev ? `<a class="btn btn-outline btn-sm" href="#/rifas/${id}/${prev[0]}">← ${prev[1]}</a>` : '<span></span>'}
      <a class="btn btn-ghost btn-sm" href="#/rifas">⬅ Volver a mis rifas</a>
      ${next ? `<a class="btn btn-gold btn-sm" href="#/rifas/${id}/${next[0]}">${next[1]} →</a>` : '<span></span>'}
    </div>`;

  const box = document.getElementById('tab-content');
  if (tab === 'resumen') box.innerHTML = await renderResumen(rifa, dashboard);
  else if (tab === 'participantes') await renderParticipantesTab(rifa, box);
  else if (tab === 'publicidad') await renderPublicidadTab(rifa, dashboard, box);
  else if (tab === 'balotera') await renderBaloteraTab(rifa, box);
  else if (tab === 'sorteo') await renderSorteoTab(rifa, box);
  else if (tab === 'whatsapp') await renderWhatsappTab(rifa, box);
  else if (tab === 'historial') await renderHistorialTab(rifa, box);
}

async function renderResumen(rifa, d) {
  let dataNum = null;
  try { dataNum = await api('/rifas/' + rifa.id + '/numeros'); } catch (e) { /* sin red / error */ }
  const numeros = Array.isArray(dataNum) ? dataNum : (dataNum && dataNum.numeros) || [];
  const boletasChance = (dataNum && dataNum.boletas) || [];
  const grupos = (dataNum && dataNum.grupos) || [];
  const libres = numeros.filter(n => n.estado === 'libre');
  const esCuatro = rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES';
  const esChance = modoEsChance(rifa);
  const gruposLibres = grupos.filter(g => g.estado === 'libre');
  const chanceLibres = boletasChance.filter(b => b.estado === 'libre');
  const chancePendientes = boletasChance.filter(b => b.estado === 'pendiente');
  const chancePagadas = boletasChance.filter(b => b.estado === 'pagado');

  // En 4 Oportunidades se muestran los 25 GRUPOS (la unidad de venta real),
  // no los números 00-99 sueltos: así se entiende qué grupos aleatorios hay.
  let disponiblesHTML;
  if (esChance) {
    disponiblesHTML = chanceLibres.length
      ? `<div class="grilla-numeros disponibles-lista">${chanceLibres.slice(0, 120).map(b => `<button type="button" class="grilla-celda libre" onclick="window.location.hash='#/rifas/${rifa.id}/participantes'" title="Ver mapa: ${b.label}">${b.label}</button>`).join('')}</div>
         <p class="text-xs text-ink-600 mt-2">Mostrando las primeras 120 de ${chanceLibres.length} boletas disponibles.</p>`
      : `<div class="empty-state" style="padding:20px;"><div class="icon">🎟️</div><p>No quedan boletas disponibles</p></div>`;
  } else if (esCuatro) {
    disponiblesHTML = gruposLibres.length
      ? `<div class="grilla-grupos disponibles-lista">${gruposLibres.map(g => `<button type="button" class="grupo-celda libre" onclick='abrirGrupo(${rifa.id}, ${grupoJs(g)})' title="${escapeHtml(g.numeros.join(' · '))}">
            <span class="grupo-nums">${g.numeros.map(n => `<span class="grupo-num">${n}</span>`).join('')}</span>
            <span class="grupo-estado">🟢 disponible</span>
          </button>`).join('')}</div>`
      : `<div class="empty-state" style="padding:20px;"><div class="icon">🎟️</div><p>No quedan grupos disponibles</p></div>`;
  } else {
    disponiblesHTML = libres.length
      ? `<div class="grilla-numeros disponibles-lista">${libres.map(n => `<button type="button" class="grilla-celda libre" onclick="abrirCasilla(${rifa.id}, '${n.numero}')" title="Registrar ${n.numero}">${n.numero}</button>`).join('')}</div>`
      : `<div class="empty-state" style="padding:20px;"><div class="icon">🎟️</div><p>No quedan números disponibles</p></div>`;
  }

  const etiquetaRestantes = esCuatro ? 'Grupos restantes' : (esChance ? 'Boletas restantes' : 'Números restantes');
  const restantesValor = esCuatro ? gruposLibres.length : d.quedan;
  return `
    <div class="quick-actions mb-4">
      <a class="qa" href="#/rifas/${rifa.id}/participantes"><div class="qa-icon">👥</div><div><strong>Registrar / pagar</strong><span>Participantes y boletas</span></div></a>
      <a class="qa" href="#/rifas/${rifa.id}/balotera"><div class="qa-icon">🎱</div><div><strong>${esChance ? 'Sortear chance' : 'Girar balotera'}</strong><span>${esChance ? (rifa.cifras || 4) + ' cifras + símbolo' : 'Emula la balota en vivo'}</span></div></a>
      <a class="qa" href="#/rifas/${rifa.id}/sorteo"><div class="qa-icon">🎯</div><div><strong>Realizar sorteo</strong><span>Ruleta, lotería o tapazo</span></div></a>
      <a class="qa" href="#/rifas/${rifa.id}/publicidad"><div class="qa-icon">📣</div><div><strong>Publicidad</strong><span>Post, historia y QR</span></div></a>
    </div>

    <div class="kpi-grid mb-4">
      <div class="kpi kpi-gold"><div class="kpi-label">Total recaudado</div><div class="kpi-value">${fmtCOP(d.recaudado)}</div></div>
      <div class="kpi"><div class="kpi-label">Boletas pagadas</div><div class="kpi-value">${esChance ? chancePagadas.length : d.pagados}</div></div>
      <div class="kpi"><div class="kpi-label">Boletas pendientes</div><div class="kpi-value">${esChance ? chancePendientes.length : d.pendientes}</div></div>
      <div class="kpi"><div class="kpi-label">${etiquetaRestantes}</div><div class="kpi-value">${restantesValor}</div></div>
    </div>

    <div class="card card-pad mb-4">
      <div class="flex justify-between mb-2"><strong>Progreso de ventas</strong><span>${d.porcentaje}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${d.porcentaje}%"></div></div>
    </div>

    <div class="card card-pad mb-4">
      <div class="flex justify-between items-center" style="flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0;">${esCuatro ? '🎯 Grupos disponibles' : '🎟️ Boletas disponibles'} <span class="text-sm text-ink-600">(${esCuatro ? `${gruposLibres.length} de ${grupos.length} grupos de ${nOport(rifa)}` : `${esChance ? chanceLibres.length : libres.length} ${esChance ? 'boletas' : 'números'}`})</span></h3>
        <a class="btn btn-outline btn-sm" href="#/rifas/${rifa.id}/participantes">Ver mapa completo →</a>
      </div>
      <div class="mt-3">
        ${disponiblesHTML}
      </div>
    </div>

    <div class="card card-pad mb-4" style="border:1.5px solid #D4A017; background:linear-gradient(135deg,#FFFBEB,#FFFFFF);">
      <h3 class="mb-3">🔗 Compartir y referidos</h3>
      <div class="flex gap-2 mb-3" style="align-items:center;">
        <input class="input" id="input-link-publico" readonly value="${window.location.origin}/r/${rifa.id}" onclick="this.select()" style="flex:1;">
        <button class="btn btn-gold btn-sm" onclick="copiarLinkPublico('${window.location.origin}/r/${rifa.id}')">📋 Copiar link</button>
        <a class="btn btn-outline btn-sm" target="_blank" href="/r/${rifa.id}">Abrir landing</a>
      </div>
      <div class="flex gap-2 mb-2">
        <input class="input" id="input-ref-codigo" placeholder="Código referido (ej. HANS10)" style="flex:1; max-width:180px;">
        <button class="btn btn-outline btn-sm" onclick="generarReferido(${rifa.id})">🎁 Generar código</button>
        <button class="btn btn-outline btn-sm" onclick="copiarLinkReferido(${rifa.id})">📋 Copiar con ref</button>
      </div>
      <p class="text-xs text-ink-600">El link <code>/r/:id</code> tiene OG tags y redirige a <code>/#/rifas/:id</code>. Usa <code>?ref=CODIGO</code> para tracking.</p>
      ${FEATURE_WOMPI ? `<div class="flex gap-2 mt-3"><button class="btn btn-outline btn-sm" onclick="verPagos(${rifa.id})">💳 Ver pagos Wompi</button><a class="btn btn-outline btn-sm" href="/api/rifas/${rifa.id}/og-image" target="_blank">🖼️ Ver OG image</a></div><div id="pagos-lista" class="mt-3"></div>` : `<div class="flex gap-2 mt-3"><a class="btn btn-outline btn-sm" href="/api/rifas/${rifa.id}/og-image" target="_blank">🖼️ Ver OG image</a></div>`}
    </div>

    <div class="grid-2">
      <div class="card card-pad">
        <h3 class="mb-3">Datos del premio</h3>
        ${rifa.imagen_producto ? `<img src="${rifa.imagen_producto}" style="width:100%; border-radius:10px; margin-bottom:12px;">` : ''}
        <p><strong>${escapeHtml(rifa.producto)}</strong></p>
        <p class="text-sm text-ink-600">${escapeHtml(rifa.descripcion || 'Sin descripción')}</p>
        <p class="text-sm mt-2">📅 Sorteo: <strong>${fmtFecha(rifa.fecha_sorteo)}${rifa.hora_sorteo ? ' · ' + rifa.hora_sorteo + 'h' : ''}</strong></p>
        <p class="text-sm">🎟️ Boleta: <strong>${fmtCOP(rifa.valor_boleta)}</strong></p>
        ${rifa.modalidad_premio === '50_50' ? `<p class="text-sm" style="color:var(--gold-600);">💰 Modalidad 50/50 — Organizador: ${rifa.porcentaje_organizador || 50}% · Ganador: ${100 - (rifa.porcentaje_organizador || 50)}%</p>` : ''}
        ${rifa.estado === 'activa' || rifa.estado === 'cerrada' ? `
        <button class="btn btn-outline btn-sm mt-3" onclick='modalAplazarRifa(${safeAttr({ id: rifa.id, fecha_sorteo: rifa.fecha_sorteo, hora_sorteo: rifa.hora_sorteo || '', estado: rifa.estado })})'>📅 Aplazar / cambiar fecha</button>
        <p class="text-xs text-ink-600 mt-2">¿No se vendieron todas las boletas? Cambia la fecha y la hora del sorteo, o vuelve a abrir la rifa si estaba cerrada.</p>` : ''}
      </div>
      <div class="card card-pad">
        <h3 class="mb-3">Transparencia y respaldo</h3>
        <p class="text-sm text-ink-600 mb-3">Comparte este link o el QR en tu publicidad. Muestra la lista de números sin exponer cédulas.</p>
        <div class="flex gap-2 mb-3">
          <input class="input" readonly value="${window.location.origin}/public/rifa/${rifa.id}" onclick="this.select()">
          <a class="btn btn-outline btn-sm" target="_blank" href="/public/rifa/${rifa.id}">Abrir</a>
        </div>
        <img src="/api/rifas/${rifa.id}/qr" style="width:140px; border:1px solid var(--line); border-radius:10px; padding:8px;">
        <div class="btn-group mt-4">
          <button class="btn btn-outline btn-sm" onclick="descargarAutenticada('/api/rifas/${rifa.id}/exportar-excel','rifa-${rifa.id}.xlsx')">⬇️ Excel</button>
          <button class="btn btn-outline btn-sm" onclick="descargarAutenticada('/api/rifas/${rifa.id}/exportar-csv','rifa-${rifa.id}.csv')">📄 CSV</button>
          <button class="btn btn-outline btn-sm" onclick="exportarReportePDF(${rifa.id})">📋 PDF</button>
          <button class="btn btn-outline btn-sm" onclick="descargarAutenticada('/api/backup','backup-rifas.zip')">💾 Backup (.zip)</button>
          <button class="btn btn-outline btn-sm" onclick="abrirRestoreModal()">📂 Restaurar backup</button>
        </div>
      </div>
    </div>

    <div class="card card-pad mt-4" id="card-poster">
      <div class="flex justify-between items-center mb-3" style="flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="margin:0;">🖼️ Poster promocional 2160×2160</h3>
          <p class="text-sm text-ink-600 mt-1">Se genera con foto del producto, título, precio, fecha, QR de la rifa y logo. Se guarda en <code>Raffle.posterImageUrl</code>.</p>
        </div>
        <div class="btn-group">
          <button class="btn btn-gold btn-sm" onclick="generarPoster(${rifa.id})" id="btn-generar-poster">🎨 Generar Poster</button>
          <a class="btn btn-outline btn-sm" id="btn-descargar-poster" style="display:none;" href="#" download="poster-rifa-${rifa.id}.png">⬇️ Descargar PNG</a>
        </div>
      </div>
      ${rifa.poster_image_url
        ? `<div id="poster-preview"><img src="${rifa.poster_image_url}" style="width:100%; max-width:340px; border-radius:12px; box-shadow:var(--shadow-md);"></div>`
        : `<div id="poster-preview"><div class="empty-state" style="padding:30px 20px;"><div class="icon">🎨</div><p>La rifa aún no tiene poster. Pulsa <strong>Generar Poster</strong>.</p></div></div>`}
    </div>`;
}

// -------------------------- TAB PARTICIPANTES --------------------------------
async function renderParticipantesTab(rifa, box) {
  const [participantes, dataNumeros] = await Promise.all([
    api('/rifas/' + rifa.id + '/participantes'),
    api('/rifas/' + rifa.id + '/numeros')
  ]);
  state.participantesActual = participantes;
  const numeros = Array.isArray(dataNumeros) ? dataNumeros : (dataNumeros.numeros || []);
  const grupos = dataNumeros.grupos || [];
  const simbolos = dataNumeros.simbolos || [];
  const boletas = dataNumeros.boletas || [];
  state.gruposActual = grupos;
  state.numerosActual = numeros;

  const esCuatro = rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES';
  const esChance = modoEsChance(rifa);
  // En 4 Oportunidades los conteos de la leyenda se miden en GRUPOS
  // (la unidad de venta real), no en números sueltos. En CHANCE en boletas.
  const libres = esCuatro
    ? grupos.filter(g => g.estado === 'libre').length
    : (esChance ? boletas.filter(b => b.estado === 'libre').length : numeros.filter(n => n.estado === 'libre').length);
  const pendientes = esCuatro
    ? grupos.filter(g => g.estado === 'pendiente').length
    : (esChance ? boletas.filter(b => b.estado === 'pendiente').length : numeros.filter(n => n.estado === 'pendiente').length);
  const pagados = esCuatro
    ? grupos.filter(g => g.estado === 'pagado').length
    : (esChance ? boletas.filter(b => b.estado === 'pagado').length : numeros.filter(n => n.estado === 'pagado').length);

  const leyendaUnidad = esChance ? 'boletas' : (esCuatro ? 'grupos' : 'números');

  box.innerHTML = `
    <div class="flex justify-between items-center mb-3" style="flex-wrap:wrap; gap:10px;">
      <div class="flex gap-2">
        <button class="btn btn-primary btn-sm" onclick="modalRegistroIndividual(${rifa.id})">➕ Registro individual</button>
        <button class="btn btn-outline btn-sm" onclick="modalRegistroMasivo(${rifa.id})">📋 Registro masivo</button>
        <button class="btn btn-outline btn-sm" onclick="modalRegistroMasivoSeleccion(${rifa.id})">🔢 Seleccionar números</button>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="liberarVencidos(${rifa.id})">🔓 Liberar vencidos ahora</button>
    </div>

    <div class="card card-pad mb-4">
      <div class="flex justify-between items-center" style="flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0;">🗺️ ${esChance ? 'Mapa de boletas' : 'Mapa de números'} ${esCuatro ? `<span class="text-sm text-ink-600">(00-99 · ${nOport(rifa)} oportunidades)</span>` : ''}</h3>
        <div class="flex gap-3 text-sm" style="flex-wrap:wrap;">
          <span>⬜ <strong>${libres}</strong> ${leyendaUnidad} disponibles</span>
          <span>🟡 <strong>${pendientes}</strong> ${leyendaUnidad} pendientes</span>
          <span>🟢 <strong>${pagados}</strong> ${leyendaUnidad} pagados</span>
        </div>
      </div>
      ${esChance ? `
        <div class="mt-3">
          <p class="text-sm text-ink-600 mb-2">Elige el símbolo para ver sus 100 boletas (número + símbolo):</p>
          <div class="chance-simbolos" id="chance-simbolos">
            ${simbolos.map(s => `<button type="button" class="chance-simbolo" data-simbolo="${escapeHtml(s)}" title="Boletas ${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}
          </div>
          <div id="chance-mapa-boletas" class="grilla-numeros mapa-numeros mt-3" style="max-height:340px;"></div>
        </div>` : esCuatro ? `
        <p class="text-sm text-ink-600 mt-3">Los grupos de ${nOport(rifa)} oportunidades se muestran más abajo.</p>` : `
        <div class="mt-3">
          <div class="seg-vista" id="numeros-vista-sel" role="tablist">
            <button type="button" class="seg-btn ${(localStorage.getItem('rifas-numeros-vista') || 'cuadricula') === 'cuadricula' ? 'active' : ''}" data-vista="cuadricula" onclick="cambiarVistaNumeros('cuadricula')" title="Cuadrícula de casillas">▦ Cuadrícula</button>
            <button type="button" class="seg-btn ${localStorage.getItem('rifas-numeros-vista') === 'tabla' ? 'active' : ''}" data-vista="tabla" onclick="cambiarVistaNumeros('tabla')" title="Tabla con columnas">▤ Tabla</button>
            <button type="button" class="seg-btn ${localStorage.getItem('rifas-numeros-vista') === 'lista' ? 'active' : ''}" data-vista="lista" onclick="cambiarVistaNumeros('lista')" title="Listado compacto">☰ Lista</button>
          </div>
          <div class="mt-3" id="numeros-vista-cont">${vistaNumerosHtml(rifa, numeros, localStorage.getItem('rifas-numeros-vista') || 'cuadricula')}</div>
        </div>`}
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" onclick="exportarMapaNumeros(${rifa.id}, 'disponibles')">📤 Exportar disponibles</button>
        <button class="btn btn-outline btn-sm" onclick="exportarMapaNumeros(${rifa.id}, 'todos')">📊 Exportar mapa completo</button>
      </div>
      <p class="text-xs text-ink-600 mt-2">Toca una casilla: si está <strong>libre</strong> se abre el registro con esa boleta; si está <strong>vendida</strong> verás la ficha del comprador. Los números se liberan al eliminar un participante o al vencer el pago.</p>
    </div>

    ${esCuatro ? renderMapaGrupos(rifa, grupos) : ''}

    <div class="card" style="overflow-x:auto;">
      ${participantes.length === 0 ? `<div class="empty-state"><div class="icon">👥</div><p>Aún no hay participantes registrados</p></div>` : `
      <table class="tbl">
        <thead><tr><th>Boleta</th><th>Nombre</th><th>Teléfono</th><th>Estado</th><th>Registrado</th><th></th></tr></thead>
        <tbody>
          ${participantes.map(p => `
            <tr>
              <td class="mono" style="font-weight:700;">${mostrarNumerosBoleta(rifa, p)}</td>
              <td>${escapeHtml(p.nombre)}</td>
              <td class="mono text-sm">${escapeHtml(p.telefono || '—')}</td>
              <td>
                <select class="input" style="padding:4px 8px; font-size:12px; width:auto;" onchange="cambiarEstadoPago(${p.id}, this.value, ${rifa.id})">
                  <option value="pendiente" ${p.estado_pago === 'pendiente' ? 'selected' : ''}>Pendiente</option>
                  <option value="pagado" ${p.estado_pago === 'pagado' ? 'selected' : ''}>Pagado</option>
                </select>
              </td>
              <td class="text-xs text-ink-600">${fmtFecha(p.fecha_registro)}</td>
              <td class="flex gap-2">
                ${FEATURE_WOMPI && p.estado_pago === 'pendiente' ? `<button class="btn btn-gold btn-sm" title="Pagar con Wompi" onclick="iniciarCheckout(${rifa.id}, ${p.id})">💳</button>` : ''}
                ${p.estado_pago === 'pendiente' ? `<button class="btn btn-ghost btn-sm" title="Enviar recordatorio" onclick='recordatorioWhatsapp(${safeAttr({ nombre: p.nombre, numeros: p.numeros || [p.numero], rifa_nombre: rifa.nombre, valor: rifa.valor_boleta, telefono: p.telefono })})'>💬</button>` : ''}
                ${rifa.estado === 'activa' ? `<button class="btn btn-ghost btn-sm" title="Editar datos del participante" onclick='modalEditarParticipante(${rifa.id}, ${safeAttr({ id: p.id, nombre: p.nombre, telefono: p.telefono, cedula: p.cedula, numeros: p.numeros || [p.numero], estado_pago: p.estado_pago })})'>✏️</button>` : ''}
                <button class="btn btn-ghost btn-sm" title="Eliminar / liberar número" onclick="eliminarParticipante(${p.id}, ${rifa.id})">🗑️</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`}
    </div>`;

  if (esChance) {
    // Mapa de boletas del chance: el símbolo activo define la grilla 00-99
    const simbolosBox = document.getElementById('chance-simbolos');
    const mapaBox = document.getElementById('chance-mapa-boletas');
    let simboloActivo = simbolos[0] || '';
    const pintarMapa = () => {
      const deSimbolo = boletas.filter(b => b.simbolo === simboloActivo);
      mapaBox.innerHTML = deSimbolo.map(b => {
        const titulo = b.nombre ? `${b.label} · ${b.nombre}` : `${b.label} · disponible`;
        const vendido = b.estado !== 'libre';
        return `<button type="button" class="grilla-celda ${vendido ? b.estado : 'libre'}" onclick="abrirCasilla(${rifa.id}, '${b.numero}', '${escapeHtml(b.simbolo)}')" title="${escapeHtml(titulo)}">${b.label}</button>`;
      }).join('');
      simbolosBox.querySelectorAll('.chance-simbolo').forEach(b => b.classList.toggle('active', b.dataset.simbolo === simboloActivo));
    };
    simbolosBox.addEventListener('click', (e) => {
      const btn = e.target.closest('.chance-simbolo');
      if (!btn) return;
      simboloActivo = btn.dataset.simbolo;
      pintarMapa();
    });
    pintarMapa();
  }
}

// Tablero de los grupos de múltiples oportunidades (cada boleta = un grupo).
// Vista personalizable: cuadrícula (tiles) · tabla · lista. La preferencia
// se guarda en el navegador para aplicarse en todas las rifas.
function renderMapaGrupos(rifa, grupos) {
  const vista = localStorage.getItem('rifas-grupos-vista') || 'cuadricula';
  const n = nOport(rifa);
  return `
    <div class="card card-pad mb-4">
      <div class="flex justify-between items-center" style="flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0;">🎯 Grupos de ${n} oportunidades <span class="text-sm text-ink-600">(${grupos.length} grupos · cada boleta = 1 grupo)</span></h3>
        <div class="seg-vista" id="grupos-vista-sel" role="tablist">
          <button type="button" class="seg-btn ${vista === 'cuadricula' ? 'active' : ''}" data-vista="cuadricula" onclick="cambiarVistaGrupos('cuadricula')" title="Tarjetas en cuadrícula">▦ Cuadrícula</button>
          <button type="button" class="seg-btn ${vista === 'tabla' ? 'active' : ''}" data-vista="tabla" onclick="cambiarVistaGrupos('tabla')" title="Tabla con columnas">▤ Tabla</button>
          <button type="button" class="seg-btn ${vista === 'lista' ? 'active' : ''}" data-vista="lista" onclick="cambiarVistaGrupos('lista')" title="Listado compacto">☰ Lista</button>
        </div>
      </div>
      <div class="mt-3" id="grupos-vista-cont">${vistaGruposHtml(rifa, grupos, vista)}</div>
      <div class="flex gap-2 mt-3" style="flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" onclick="exportarGruposImagen(${rifa.id}, 'disponibles')">📤 Exportar disponibles (PNG)</button>
        <button class="btn btn-outline btn-sm" onclick="exportarGruposImagen(${rifa.id}, 'todos')">📊 Exportar mapa completo (PNG)</button>
      </div>
      <p class="text-xs text-ink-600 mt-2">Cada boleta de múltiples oportunidades equivale a un grupo completo. Toca un grupo <strong>libre</strong> para registrarlo, o uno <strong>vendido</strong> para ver la ficha del comprador.</p>
    </div>`;
}

// Exporta imagen PNG del mapa de números / grupos según modalidad
async function exportarMapaNumeros(rifaId, modo) {
  try {
    const rifa = await api('/rifas/' + rifaId);
    if (rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES') {
      return exportarGruposImagen(rifaId, modo);
    }
    const esChance = modoEsChance(rifa);
    const res = await api('/rifas/' + rifaId + '/numeros');
    const numeros = res.numeros || [];
    const boletas = res.boletas || [];

    let items;
    if (esChance) {
      items = boletas.map(b => ({ numero: b.numero, label: b.label, estado: b.estado }));
    } else {
      items = numeros.map(x => ({ numero: x.numero, label: String(x.numero), estado: x.estado }));
    }

    const filtrados = modo === 'disponibles' ? items.filter(x => x.estado === 'libre') : items;
    if (!filtrados.length) { toast(modo === 'disponibles' ? 'No hay números disponibles' : 'No hay números', 'error'); return; }

    const COLS = 10;
    const CELL_SIZE = 56, PAD = 6;
    const HEADER_H = 70, LEGEND_H = 36, FOOTER_H = 36;
    const totalItems = modo === 'disponibles' ? filtrados.length : items.length;
    const rows = Math.ceil(totalItems / COLS);
    const W = COLS * (CELL_SIZE + PAD) + PAD;
    const H = HEADER_H + rows * (CELL_SIZE + PAD) + PAD + LEGEND_H + FOOTER_H;

    const c = document.createElement('canvas');
    c.width = W * 2; c.height = H * 2;
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);

    ctx.fillStyle = '#F5F6F9';
    ctx.fillRect(0, 0, W, H);

    // Header
    ctx.fillStyle = '#0B1229';
    ctx.font = 'bold 15px Sora, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(modo === 'disponibles'
      ? `Números disponibles — ${filtrados.length} libres`
      : `Mapa de números`, PAD, 28);
    ctx.font = '11px Sora, sans-serif';
    ctx.fillStyle = '#6B7280';
    ctx.fillText(`${rifa.nombre} · ${new Date().toLocaleDateString('es-CO')}`, PAD, 48);

    // Leyenda
    const ly = HEADER_H - 10;
    const legendItems = modo === 'disponibles'
      ? [{ color: '#22c55e', label: 'Disponible' }]
      : [
          { color: '#22c55e', label: 'Disponible' },
          { color: '#f97316', label: 'Pendiente' },
          { color: '#3b82f6', label: 'Pagado' }
        ];
    let lx = PAD;
    legendItems.forEach(item => {
      ctx.fillStyle = item.color;
      ctx.beginPath(); ctx.arc(lx + 6, ly + 6, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#374151';
      ctx.font = '10px Sora, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(item.label, lx + 16, ly + 10);
      lx += ctx.measureText(item.label).width + 30;
    });

    // Celdas
    const colores = { libre: '#22c55e', pendiente: '#f97316', pagado: '#3b82f6' };
    if (modo === 'disponibles') {
      filtrados.forEach((num, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = PAD + col * (CELL_SIZE + PAD);
        const y = HEADER_H + row * (CELL_SIZE + PAD);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(x, y, CELL_SIZE, CELL_SIZE, 8); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#0B1229';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(num.label, x + CELL_SIZE / 2, y + CELL_SIZE / 2 + 5);
      });
    } else {
      const byNum = {};
      items.forEach(x => { byNum[x.numero] = x; });
      for (let i = 0; i < items.length; i++) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = PAD + col * (CELL_SIZE + PAD);
        const y = HEADER_H + row * (CELL_SIZE + PAD);
        const num = items[i];
        const bg = num.estado === 'pagado' ? '#3b82f6' : num.estado === 'pendiente' ? '#f97316' : '#fff';
        const fg = (num.estado === 'pagado' || num.estado === 'pendiente') ? '#fff' : '#0B1229';
        ctx.fillStyle = bg;
        ctx.strokeStyle = colores[num.estado] || '#D1D5DB';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(x, y, CELL_SIZE, CELL_SIZE, 8); ctx.fill(); ctx.stroke();
        ctx.fillStyle = fg;
        ctx.font = 'bold 15px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(num.label || String(num.numero), x + CELL_SIZE / 2, y + CELL_SIZE / 2 + 5);
      }
    }

    // Footer
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '9px Sora, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Rifas SYC', W / 2, H - 12);

    c.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `numeros-${modo}-${rifaId}.png`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Imagen descargada');
    }, 'image/png');
  } catch (e) { toast(e.message, 'error'); }
}

// Exporta imagen PNG del mapa de grupos (disponibles o todos)
async function exportarGruposImagen(rifaId, modo) {
  try {
    const rifa = await api('/rifas/' + rifaId);
    const n = nOport(rifa);
    const res = await api('/rifas/' + rifaId + '/numeros');
    const grupos = res.grupos || [];
    const filtrados = modo === 'disponibles' ? grupos.filter(g => g.estado === 'libre') : grupos;
    if (!filtrados.length) { toast(modo === 'disponibles' ? 'No hay grupos disponibles' : 'No hay grupos', 'error'); return; }

    const COLS = 10;
    const CELL_W = 90, CELL_H = 70, PAD = 8;
    const HEADER_H = 80, FOOTER_H = 50, LEGEND_H = 40;
    const rows = Math.ceil(filtrados.length / COLS);
    const W = COLS * (CELL_W + PAD) + PAD;
    const H = HEADER_H + rows * (CELL_H + PAD) + PAD + LEGEND_H + FOOTER_H;

    const c = document.createElement('canvas');
    c.width = W * 2; c.height = H * 2;
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);

    // Fondo
    ctx.fillStyle = '#F5F6F9';
    ctx.fillRect(0, 0, W, H);

    // Header
    ctx.fillStyle = '#0B1229';
    ctx.font = 'bold 16px Sora, sans-serif';
    ctx.textAlign = 'left';
    const titulo = modo === 'disponibles'
      ? `Grupos de ${n} oportunidades — ${filtrados.length} disponibles`
      : `Mapa de grupos — ${n} oportunidades`;
    ctx.fillText(titulo, PAD, 30);

    ctx.font = '11px Sora, sans-serif';
    ctx.fillStyle = '#6B7280';
    ctx.fillText(`${rifa.nombre} · ${new Date().toLocaleDateString('es-CO')}`, PAD, 50);

    // Leyenda
    const ly = HEADER_H - 12;
    const legendItems = modo === 'disponibles'
      ? [{ color: '#22c55e', label: 'Disponible' }]
      : [
          { color: '#22c55e', label: 'Disponible' },
          { color: '#f97316', label: 'Pendiente' },
          { color: '#3b82f6', label: 'Pagado' },
          { color: '#ef4444', label: 'Vendido' }
        ];
    let lx = PAD;
    legendItems.forEach(item => {
      ctx.fillStyle = item.color;
      ctx.fillRect(lx, ly, 12, 12);
      ctx.fillStyle = '#374151';
      ctx.font = '10px Sora, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(item.label, lx + 16, ly + 10);
      lx += ctx.measureText(item.label).width + 30;
    });

    // Celdas
    const colores = { libre: '#22c55e', pendiente: '#f97316', pagado: '#3b82f6', vendida: '#ef4444' };
    const textos = { libre: 'disponible', pendiente: 'pendiente', pagado: 'pagado', vendida: 'vendido' };
    filtrados.forEach((g, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = PAD + col * (CELL_W + PAD);
      const y = HEADER_H + row * (CELL_H + PAD);

      // Tarjeta
      const bg = g.estado === 'pagado' ? '#3b82f6' : g.estado === 'pendiente' ? '#f97316' : '#fff';
      const fg = (g.estado === 'pagado' || g.estado === 'pendiente') ? '#fff' : '#0B1229';
      const fgEstado = g.estado === 'libre' ? colores.libre : '#fff';
      ctx.fillStyle = bg;
      ctx.strokeStyle = colores[g.estado] || '#D1D5DB';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, CELL_W, CELL_H, 8);
      ctx.fill();
      ctx.stroke();

      // Números
      ctx.fillStyle = fg;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(g.numeros.join('  '), x + CELL_W / 2, y + 28);

      // Estado
      ctx.fillStyle = fgEstado;
      ctx.beginPath();
      ctx.arc(x + 12, y + 50, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '10px Sora, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(textos[g.estado] || g.estado, x + 20, y + 54);
    });

    // Footer
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '9px Sora, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Rifas SYC — rifassyc.local', W / 2, H - 15);

    // Descargar
    c.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `grupos-${modo}-${rifaId}.png`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Imagen descargada');
    }, 'image/png');
  } catch (e) { toast(e.message, 'error'); }
}

// HTML del contenido según la vista elegida
function vistaGruposHtml(rifa, grupos, vista) {
  if (vista === 'tabla') return vistaGruposTabla(rifa, grupos);
  if (vista === 'lista') return vistaGruposLista(rifa, grupos);
  return vistaGruposCuadricula(rifa, grupos);
}

function grupoJs(g) {
  return JSON.stringify({ numeros: g.numeros.map(Number), estado: g.estado, nombre: g.nombre || '' }).replace(/'/g, '&#39;');
}

function estadoGrupoTxt(g) {
  if (g.estado === 'libre') return '🟢 disponible';
  if (g.estado === 'pagado') return '🟢 pagado';
  if (g.estado === 'pendiente') return '🟡 pendiente';
  return '🚫 parcial (no vendible)';
}

function vistaGruposCuadricula(rifa, grupos) {
  return `<div class="grilla-grupos">
    ${grupos.map((g, i) => {
      const nums = g.numeros.join(' · ');
      return `<button type="button" class="grupo-celda ${g.estado}" onclick='abrirGrupo(${rifa.id}, ${grupoJs(g)})' title="${escapeHtml((g.nombre ? nums + ' · ' + g.nombre : nums + ' · grupo ' + (i + 1)))}">
        <span class="grupo-nums">${g.numeros.map(n => `<span class="grupo-num">${n}</span>`).join('')}</span>
        <span class="grupo-estado">${estadoGrupoTxt(g)}</span>
      </button>`;
    }).join('')}
  </div>`;
}

function vistaGruposTabla(rifa, grupos) {
  return `<div style="overflow-x:auto;">
    <table class="tbl tbl-grupos">
      <thead><tr><th>#</th><th>Números</th><th>Estado</th><th>Comprador</th><th></th></tr></thead>
      <tbody>
        ${grupos.map((g, i) => `<tr class="fila-grupo-${g.estado}">
          <td class="text-xs text-ink-600">${String(i + 1).padStart(2, '0')}</td>
          <td class="mono" style="font-weight:700; letter-spacing:1px;">${g.numeros.join(' · ')}</td>
          <td><span class="badge badge-${g.estado === 'libre' ? 'activa' : (g.estado === 'pagado' ? 'pagado' : 'pendiente')}">${estadoGrupoTxt(g)}</span></td>
          <td>${escapeHtml(g.nombre || '—')}</td>
          <td><button class="btn btn-ghost btn-sm" onclick='abrirGrupo(${rifa.id}, ${grupoJs(g)})'>${g.estado === 'libre' ? '🎟️ Registrar' : '👁️ Ver'}</button></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

function vistaGruposLista(rifa, grupos) {
  return `<div class="grupos-lista">
    ${grupos.map((g, i) => {
      const nums = g.numeros.join(' · ');
      return `<button type="button" class="grupos-lista-fila ${g.estado}" onclick='abrirGrupo(${rifa.id}, ${grupoJs(g)})'>
        <span class="text-xs text-ink-600 mono">#${String(i + 1).padStart(2, '0')}</span>
        <span class="grupo-nums">${nums}</span>
        <span class="grupos-lista-who">${escapeHtml(g.nombre || '')}</span>
        <span class="grupo-estado">${estadoGrupoTxt(g)}</span>
      </button>`;
    }).join('')}
  </div>`;
}

// Cambia la vista de grupos y la guarda para la próxima vez
function cambiarVistaGrupos(vista) {
  localStorage.setItem('rifas-grupos-vista', vista);
  const sel = document.getElementById('grupos-vista-sel');
  if (sel) sel.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.vista === vista));
  const cont = document.getElementById('grupos-vista-cont');
  const rifa = state.rifaActual || {};
  const grupos = state.gruposActual || [];
  if (cont) cont.innerHTML = vistaGruposHtml(rifa, grupos, vista);
}

// ==================== VISTAS PARA NÚMEROS (BOLETAS_NORMAL / CHANCE) ====================

function vistaNumerosHtml(rifa, numeros, vista) {
  if (vista === 'tabla') return vistaNumerosTabla(rifa, numeros);
  if (vista === 'lista') return vistaNumerosLista(rifa, numeros);
  return vistaNumerosCuadricula(rifa, numeros);
}

function vistaNumerosCuadricula(rifa, numeros) {
  return `<div class="grilla-numeros mapa-numeros" style="max-height:340px;">
    ${numeros.map(n => {
      const lbl = String(n.numero).padStart(2, '0');
      const titulo = n.nombre ? `${lbl} · ${n.nombre}` : `${lbl} · disponible`;
      return `<button type="button" class="grilla-celda ${n.estado}" onclick="abrirCasilla(${rifa.id}, '${String(n.numero)}')" title="${escapeHtml(titulo)}">${lbl}</button>`;
    }).join('')}
  </div>`;
}

function vistaNumerosTabla(rifa, numeros) {
  return `<div style="overflow-x:auto;">
    <table class="tbl tbl-grupos">
      <thead><tr><th>#</th><th>Número</th><th>Estado</th><th>Comprador</th><th></th></tr></thead>
      <tbody>
        ${numeros.map((n, i) => {
          const lbl = String(n.numero).padStart(2, '0');
          const estado = n.estado === 'libre' ? 'libre' : (n.estado === 'pagado' ? 'pagado' : 'pendiente');
          const badge = n.estado === 'libre' ? 'activa' : (n.estado === 'pagado' ? 'pagado' : 'pendiente');
          const txt = n.estado === 'libre' ? '🟢 disponible' : (n.estado === 'pagado' ? '🟢 pagado' : '🟡 pendiente');
          return `<tr class="fila-grupo-${estado}">
            <td class="text-xs text-ink-600">${String(i + 1).padStart(2, '0')}</td>
            <td class="mono" style="font-weight:700; letter-spacing:1px;">${lbl}</td>
            <td><span class="badge badge-${badge}">${txt}</span></td>
            <td>${escapeHtml(n.nombre || '—')}</td>
            <td><button class="btn btn-ghost btn-sm" onclick="abrirCasilla(${rifa.id}, '${String(n.numero)}')">${n.estado === 'libre' ? '🎟️ Registrar' : '👁️ Ver'}</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

function vistaNumerosLista(rifa, numeros) {
  return `<div class="grupos-lista">
    ${numeros.map((n, i) => {
      const lbl = String(n.numero).padStart(2, '0');
      const txt = n.estado === 'libre' ? '🟢 disponible' : (n.estado === 'pagado' ? '🟢 pagado' : '🟡 pendiente');
      return `<button type="button" class="grupos-lista-fila ${n.estado}" onclick="abrirCasilla(${rifa.id}, '${String(n.numero)}')">
        <span class="text-xs text-ink-600 mono">#${String(i + 1).padStart(2, '0')}</span>
        <span class="grupo-nums">${lbl}</span>
        <span class="grupos-lista-who">${escapeHtml(n.nombre || '')}</span>
        <span class="grupo-estado">${txt}</span>
      </button>`;
    }).join('')}
  </div>`;
}

function cambiarVistaNumeros(vista) {
  localStorage.setItem('rifas-numeros-vista', vista);
  const sel = document.getElementById('numeros-vista-sel');
  if (sel) sel.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.vista === vista));
  const cont = document.getElementById('numeros-vista-cont');
  const rifa = state.rifaActual || {};
  const numeros = state.numerosActual || [];
  if (cont) cont.innerHTML = vistaNumerosHtml(rifa, numeros, vista);
}

// Click sobre una casilla del mapa de números (o de boletas del chance)
function abrirCasilla(rifaId, numero, simbolo) {
  const rifa = state.rifaActual || {};
  const n = Number(numero);
  const p = (state.participantesActual || []).find(pp => {
    if (simbolo !== undefined) return pp.simbolo === simbolo && Number(pp.numero) === n;
    return (pp.numeros || [pp.numero]).map(Number).includes(n);
  });
  if (p) return fichaParticipante(rifa, p);
  modalRegistroIndividual(rifaId, { numero: n, simbolo });
}

// Click sobre un grupo de 4 oportunidades
function abrirGrupo(rifaId, grupo) {
  const rifa = state.rifaActual || {};
  if (grupo.estado !== 'libre') {
    const p = (state.participantesActual || []).find(pp => (pp.numeros || []).map(Number).includes(Number(grupo.numeros[0])));
    if (p) return fichaParticipante(rifa, p);
  }
  modalRegistroIndividual(rifaId, { numeros: grupo.numeros.map(Number) });
}

function modalRegistroIndividual(rifaId, preseleccion) {
  const rifa = state.rifaActual || {};
  const esCuatro = rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES';
  const esChance = modoEsChance(rifa);
  if (esChance) return modalRegistroChance(rifaId, preseleccion);
  const esEleccion = rifa.modo_asignacion === 'A_ELECCION';
  const aElegir = esCuatro ? nOport(rifa) : 1;

  abrirModal(`
    <div class="modal__header"><h3>Registro individual</h3><button class="btn btn-ghost btn-sm" onclick="cerrarModal()">✕</button></div>
    <form id="form-individual" class="modal__body">
      <div class="grid-2">
        <div class="field"><label>Nombre completo <em class="req">*</em></label><input class="input" name="nombre" required placeholder="Ej: Juan Pérez" maxlength="120"></div>
        <div class="field"><label>Teléfono</label><input class="input" name="telefono" inputmode="tel" placeholder="3001234567" maxlength="20"></div>
      </div>
      <div class="field"><label>Cédula (opcional)</label><input class="input" name="cedula" inputmode="numeric" placeholder="Opcional — para no repetir compras"></div>

      <div class="grid-2">
        <div class="field">
          <label>Estado de pago</label>
          <select class="input" name="estado_pago" id="sel-estado-pago" onchange="document.getElementById('campos-pago').style.display = this.value === 'pagado' ? 'grid' : 'none'; document.getElementById('campo-observacion-pago').style.display = this.value === 'pagado' ? 'block' : 'none';">
            <option value="pendiente">⏳ Pendiente</option>
            <option value="pagado">✅ Pagado</option>
          </select>
        </div>
        <div id="campos-pago" style="display:none;">
          <div class="field">
            <label>Método de pago</label>
            <select class="input" name="metodo_pago">
              <option value="">Seleccionar...</option>
              <option value="efectivo">💵 Efectivo</option>
              <option value="transferencia">🏦 Transferencia</option>
            </select>
          </div>
        </div>
      </div>
      <div id="campo-observacion-pago" style="display:none;">
        <div class="field">
          <label>Observación del pago</label>
          <input class="input" name="observacion" placeholder="Ej: Pago parcial, referencia, etc.">
        </div>
      </div>

      <div class="field">
        <label>¿Cómo se asigna el número?</label>
        <select class="input" id="sel-modo-asignacion">
          <option value="AL_AZAR" ${esEleccion || preseleccion ? '' : 'selected'}>🎲 Al azar — el sistema elige ${esCuatro ? `${nOport(rifa)} números disponibles` : 'un número disponible'}</option>
          <option value="A_ELECCION" ${esEleccion || preseleccion ? 'selected' : ''}>📋 Tabla de números disponibles — el cliente escoge ${esCuatro ? `un grupo de ${nOport(rifa)}` : '1 casilla'}</option>
        </select>
      </div>

      <div id="grilla-numeros" style="display:none;">
        <p class="text-sm text-ink-600 mb-2">
          ${esCuatro
            ? `Elige <strong>un grupo</strong> (cada grupo vale ${nOport(rifa)} oportunidades). <span id="contador-seleccion">0/1</span> · 🟢 disponible · 🔴 vendido · ⚪ tu selección`
            : `Elige <strong id="n-a-elegir">${aElegir}</strong> casilla(s). <span id="contador-seleccion">0/${aElegir}</span> · 🟢 disponibles · 🔴 vendidas · ⚪ tu selección`}
        </p>
        <div id="grilla-celdas" class="grilla-numeros ${esCuatro ? 'grilla-grupos' : ''}"></div>
      </div>

      <div class="modal__footer" style="padding:0; margin-top:10px;">
        <button type="button" class="btn btn-ghost" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-gold">Registrar</button>
      </div>
    </form>`);

  let numerosDisponibles = [];
  let gruposDisponibles = [];
  const sel = document.getElementById('sel-modo-asignacion');
  const grillaBox = document.getElementById('grilla-numeros');

  const renderGrilla = async () => {
    const data = await api('/rifas/' + rifaId + '/available-numbers');
    numerosDisponibles = data.numeros;
    gruposDisponibles = data.grupos || [];
    const celdas = document.getElementById('grilla-celdas');

    if (esCuatro) {
      // Grilla de grupos de 4 oportunidades
      celdas.innerHTML = gruposDisponibles.map((g, i) => {
        const vendido = g.estado !== 'libre';
        return `<button type="button" class="grupo-celda ${vendido ? 'vendida' : 'libre'}" data-grupo="${i}" ${vendido ? 'disabled' : ''}>
          <span class="grupo-nums">${g.numeros.map(n => `<span class="grupo-num">${n}</span>`).join('')}</span>
          <span class="grupo-estado">${vendido ? '🔴 vendido' : '🟢 disponible'}</span>
        </button>`;
      }).join('');
      celdas.querySelectorAll('.grupo-celda.libre').forEach(celda => {
        celda.addEventListener('click', () => {
          const ya = celda.classList.contains('seleccionada');
          celdas.querySelectorAll('.grupo-celda').forEach(c => c.classList.remove('seleccionada'));
          if (!ya) celda.classList.add('seleccionada');
          const cont = document.getElementById('contador-seleccion');
          if (cont) cont.textContent = celdas.querySelectorAll('.grupo-celda.seleccionada').length + '/1';
        });
      });
      // Preselección por número (click en casilla del mapa) o por grupo
      if (preseleccion) {
        const target = preseleccion.numeros
          ? gruposDisponibles.findIndex(g => g.numeros.map(Number).join(',') === preseleccion.numeros.map(Number).join(','))
          : gruposDisponibles.findIndex(g => g.numeros.map(Number).includes(Number(preseleccion.numero)));
        if (target >= 0) {
          const celda = celdas.querySelector(`.grupo-celda[data-grupo="${target}"]`);
          if (celda) { celda.classList.remove('libre', 'vendida'); celda.classList.add('seleccionada'); }
        }
      }
    } else {
      // Grilla de números individuales
      celdas.innerHTML = numerosDisponibles.map(n => {
        const vendido = n.estado !== 'libre';
        return `<button type="button" class="grilla-celda ${vendido ? 'vendida' : 'libre'}" data-numero="${n.numero}" data-estado="${n.estado}" ${vendido ? 'disabled' : ''}>${String(n.numero).padStart(2, '0')}</button>`;
      }).join('');
      celdas.querySelectorAll('.grilla-celda.libre').forEach(celda => {
        celda.addEventListener('click', () => {
          const ya = celda.classList.contains('seleccionada');
          const elegidas = celdas.querySelectorAll('.grilla-celda.seleccionada').length;
          if (ya) celda.classList.remove('seleccionada');
          else if (elegidas < aElegir) celda.classList.add('seleccionada');
          const cont = document.getElementById('contador-seleccion');
          if (cont) cont.textContent = celdas.querySelectorAll('.grilla-celda.seleccionada').length + '/' + aElegir;
        });
      });
      if (preseleccion && preseleccion.numero !== undefined) {
        const celda = celdas.querySelector(`.grilla-celda[data-numero="${preseleccion.numero}"]`);
        if (celda) celda.classList.add('seleccionada');
      }
    }
  };

  if (sel.value === 'A_ELECCION') {
    grillaBox.style.display = 'block';
    renderGrilla().catch(err => toast(err.message, 'error'));
  }
  sel.addEventListener('change', () => {
    const esA = sel.value === 'A_ELECCION';
    grillaBox.style.display = esA ? 'block' : 'none';
    if (esA) renderGrilla().catch(err => toast(err.message, 'error'));
  });

  document.getElementById('form-individual').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    if (sel.value === 'A_ELECCION') {
      if (esCuatro) {
        const elegido = document.querySelector('.grupo-celda.seleccionada');
        if (!elegido) { toast(`Selecciona un grupo de ${nOport(rifa)} oportunidades`, 'error'); return; }
        fd.grupo_idx = elegido.dataset.grupo;
        delete fd.numeros;
        delete fd.numero;
      } else {
        const elegidas = [...document.querySelectorAll('.grilla-celda.seleccionada')].map(c => Number(c.dataset.numero));
        if (elegidas.length !== aElegir) {
          toast(`Selecciona exactamente ${aElegir} casilla(s) en la tabla (llevas ${elegidas.length})`, 'error');
          return;
        }
        fd.numeros = elegidas;
        delete fd.numero;
      }
    }
    try {
      await api('/rifas/' + rifaId + '/participantes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) });
      toast('Participante registrado');
      cerrarModal();
      vistaDetalleRifa(rifaId, 'participantes');
    } catch (err) { toast(err.message, 'error'); }
  });
}

// Registro individual para CHANCE_CON_SIMBOLO: la boleta es (número 00-99, símbolo).
// El comprador elige el símbolo y luego la casilla exacta (ej: "47 😁").
function modalRegistroChance(rifaId, preseleccion) {
  const simboloPre = (preseleccion && preseleccion.simbolo) || '';
  abrirModal(`
    <div class="modal__header"><h3>Registro individual — Chance con símbolo</h3><button class="btn btn-ghost btn-sm" onclick="cerrarModal()">✕</button></div>
    <form id="form-individual-chance" class="modal__body">
      <div class="grid-2">
        <div class="field"><label>Nombre completo <em class="req">*</em></label><input class="input" name="nombre" required placeholder="Ej: Juan Pérez" maxlength="120"></div>
        <div class="field"><label>Teléfono</label><input class="input" name="telefono" inputmode="tel" placeholder="3001234567" maxlength="20"></div>
      </div>
      <div class="field"><label>Cédula (opcional)</label><input class="input" name="cedula" inputmode="numeric" placeholder="Opcional — para no repetir compras"></div>

      <div class="field">
        <label>Elige el símbolo</label>
        <div id="chance-modal-simbolos" class="chance-simbolos"></div>
      </div>

      <div class="field">
        <label>Elige la boleta (número + símbolo) <span class="text-sm text-ink-600">· 🟢 disponible · 🔴 vendida · ⚪ tu selección</span></label>
        <div id="chance-modal-grilla" class="grilla-numeros" style="max-height:260px;"></div>
      </div>

      <div class="modal__footer" style="padding:0; margin-top:10px;">
        <button type="button" class="btn btn-ghost" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-gold">Registrar</button>
      </div>
    </form>`);

  let simboloActivo = simboloPre;
  const simbolosBox = document.getElementById('chance-modal-simbolos');
  const grillaBox = document.getElementById('chance-modal-grilla');
  let boletas = [];

  const pintarGrilla = () => {
    const deSimbolo = boletas.filter(b => b.simbolo === simboloActivo);
    grillaBox.innerHTML = deSimbolo.map(b => {
      const vendido = b.estado !== 'libre';
      return `<button type="button" class="grilla-celda ${vendido ? 'vendida' : 'libre'}" data-boleta="${b.numero}" data-simbolo="${escapeHtml(b.simbolo)}" ${vendido ? 'disabled' : ''}>${b.label}</button>`;
    }).join('');
    grillaBox.querySelectorAll('.grilla-celda.libre').forEach(celda => {
      celda.addEventListener('click', () => {
        grillaBox.querySelectorAll('.grilla-celda').forEach(c => c.classList.remove('seleccionada'));
        celda.classList.add('seleccionada');
      });
    });
    simbolosBox.querySelectorAll('.chance-simbolo').forEach(b => b.classList.toggle('active', b.dataset.simbolo === simboloActivo));
  };

  (async () => {
    const data = await api('/rifas/' + rifaId + '/available-numbers');
    boletas = data.boletas || [];
    const simbolos = data.simbolos || [];
    simbolosBox.innerHTML = simbolos.map(s => `<button type="button" class="chance-simbolo" data-simbolo="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
    simbolosBox.addEventListener('click', (e) => {
      const btn = e.target.closest('.chance-simbolo');
      if (!btn) return;
      simboloActivo = btn.dataset.simbolo;
      pintarGrilla();
    });
    if (!simboloActivo) simboloActivo = simbolos[0] || '';
    pintarGrilla();
  })().catch(err => toast(err.message, 'error'));

  document.getElementById('form-individual-chance').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const elegida = document.querySelector('#chance-modal-grilla .grilla-celda.seleccionada');
    if (!elegida) { toast('Selecciona una boleta (número + símbolo) disponible', 'error'); return; }
    fd.numero = elegida.dataset.boleta;
    fd.simbolo = elegida.dataset.simbolo;
    delete fd.boleta_id;
    try {
      await api('/rifas/' + rifaId + '/participantes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) });
      toast('Participante registrado');
      cerrarModal();
      vistaDetalleRifa(rifaId, 'participantes');
    } catch (err) { toast(err.message, 'error'); }
  });
}

function modalRegistroMasivo(rifaId) {
  const rifa = state.rifaActual || {};
  const esCuatro = rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES';
  abrirModal(`
    <div class="modal__header"><h3>Registro masivo</h3><button class="btn btn-ghost btn-sm" onclick="cerrarModal()">✕</button></div>
    <div class="modal__body">
      <p class="text-sm text-ink-600 mb-3">Pega una línea por participante. <strong>Nombre es obligatorio</strong>; teléfono y cédula son opcionales.</p>
      <p class="text-sm mb-2">Formatos válidos:</p>
      <ul class="text-sm text-ink-600 mb-3" style="padding-left:18px;">
        <li><code>Nombre, Teléfono</code> — ejemplo: <code>Juan Pérez, 3001234567</code></li>
        <li><code>Nombre, Cédula, Teléfono</code> — ejemplo: <code>Juan Pérez, 1020304050, 3001234567</code></li>
      </ul>
      <p class="text-sm text-ink-600 mb-2">Se detectan duplicados y ${esCuatro ? `se asignan <strong>${nOport(rifa)} números al azar</strong> por persona` : 'se asigna el número automáticamente'}.</p>
      <textarea class="input" id="texto-masivo" rows="8" placeholder="Juan Pérez, 3001234567
María Gómez, 1020304050, 3007654321"></textarea>
      <div class="modal__footer" style="padding:0; margin-top:14px;">
        <button class="btn btn-ghost" onclick="cerrarModal()">Cancelar</button>
        <button class="btn btn-gold" onclick="enviarRegistroMasivo(${rifaId})">Registrar todos</button>
      </div>
    </div>`);
}

async function enviarRegistroMasivo(rifaId) {
  const texto = document.getElementById('texto-masivo').value;
  try {
    const r = await api('/rifas/' + rifaId + '/participantes/masivo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto })
    });
    cerrarModal();
    toast(`✅ ${r.insertados.length} agregados · ${r.duplicados.length} duplicados · ${r.sinCupo.length} sin cupo`);
    vistaDetalleRifa(rifaId, 'participantes');
  } catch (err) { toast(err.message, 'error'); }
}

// --- Registro masivo con selección manual de números ---

async function modalRegistroMasivoSeleccion(rifaId) {
  abrirModal(`
    <div class="modal__header"><h3>Cargando números...</h3></div>
    <div class="modal__body"><div class="empty-state"><div class="icon">⏳</div><p>Obteniendo números disponibles...</p></div></div>
  `);
  try {
    const datos = await api('/rifas/' + rifaId + '/numeros');
    const rifa = await api('/rifas/' + rifaId);
    state._seleccionNumeros = {
      rifaId, rifa,
      numeros: Array.isArray(datos) ? datos : (datos.numeros || []),
      seleccion: [],
      registrados: 0
    };
    _renderModalSeleccion();
  } catch (err) {
    cerrarModal();
    toast('Error: ' + err.message, 'error');
  }
}

function _renderModalSeleccion() {
  const s = state._seleccionNumeros;
  if (!s) return;
  const libres = s.numeros.filter(n => n.estado === 'libre');
  const seleccionados = s.seleccion;

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div style="position:fixed; inset:0; z-index:90; background:rgba(5,10,25,0.7); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; padding:16px;">
      <div style="width:100%; max-width:700px; max-height:90vh; background:#16213F; border:1px solid #22315A; border-radius:18px; display:flex; flex-direction:column; overflow:hidden;">
        <div style="padding:20px 24px 12px; border-bottom:1px solid var(--line);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0;">🔢 Seleccionar números — ${escapeHtml(s.rifa.nombre)}</h3>
            <button class="btn btn-ghost btn-sm" onclick="state._seleccionNumeros=null; cerrarModal();">✕</button>
          </div>
          <p class="text-sm text-ink-600" style="margin:4px 0 0;">${libres.length} números disponibles · ${seleccionados.length} seleccionados · ${s.registrados} registrados</p>
        </div>

        <div style="display:flex; flex:1; overflow:hidden;">
          <!-- Panel izquierdo: grilla de números -->
          <div style="flex:1; overflow-y:auto; padding:16px; border-right:1px solid var(--line);">
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              ${libres.map(n => {
                const sel = seleccionados.includes(n.numero);
                return `<button type="button" onclick="_toggleNumSeleccion(${n.numero})"
                  style="width:44px; height:36px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; border:2px solid ${sel ? '#D4A017' : 'rgba(255,255,255,0.15)'}; background:${sel ? 'rgba(212,160,23,0.2)' : 'rgba(255,255,255,0.05)'}; color:${sel ? '#F2C14E' : '#fff'};">
                  ${fmtNum(s.rifa, n.numero)}
                </button>`;
              }).join('')}
              ${libres.length === 0 ? '<p class="text-sm text-ink-600">No hay números disponibles</p>' : ''}
            </div>
          </div>

          <!-- Panel derecho: formulario + números seleccionados -->
          <div style="width:280px; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:12px;">
            <div>
              <p style="font-weight:600; font-size:13px; margin:0 0 8px;">Números seleccionados</p>
              <div style="display:flex; flex-wrap:wrap; gap:4px; min-height:32px;">
                ${seleccionados.length === 0
                  ? '<span class="text-xs text-ink-600">Haz clic en un número para seleccionarlo</span>'
                  : seleccionados.map(n => `<span style="padding:4px 8px; background:rgba(212,160,23,0.2); border:1px solid #D4A017; border-radius:6px; font-size:12px; font-weight:600; color:#F2C14E;">${fmtNum(s.rifa, n)}</span>`).join('')
                }
              </div>
            </div>

            <div style="border-top:1px solid var(--line); padding-top:12px;">
              <p style="font-weight:600; font-size:13px; margin:0 0 8px;">Datos del participante</p>
              <div style="margin-bottom:8px;">
                <label style="display:block; font-size:11px; color:rgba(255,255,255,0.5); margin-bottom:4px; text-transform:uppercase;">Nombre *</label>
                <input id="sel-nombre" class="input" placeholder="Nombre completo" maxlength="120" style="font-size:13px;">
              </div>
              <div style="margin-bottom:8px;">
                <label style="display:block; font-size:11px; color:rgba(255,255,255,0.5); margin-bottom:4px; text-transform:uppercase;">Teléfono</label>
                <input id="sel-telefono" class="input" placeholder="Opcional" inputmode="tel" maxlength="20" style="font-size:13px;">
              </div>
              <div style="margin-bottom:12px;">
                <label style="display:block; font-size:11px; color:rgba(255,255,255,0.5); margin-bottom:4px; text-transform:uppercase;">Cédula</label>
                <input id="sel-cedula" class="input" placeholder="Opcional" inputmode="numeric" style="font-size:13px;">
              </div>
              <button class="btn btn-gold btn-sm" style="width:100%;" onclick="_registrarDesdeSeleccion()"
                ${seleccionados.length === 0 ? 'disabled style="width:100%; opacity:0.5;"' : ''}>
                Registrar participante (${seleccionados.length} número${seleccionados.length !== 1 ? 's' : ''})
              </button>
            </div>

            <div style="margin-top:auto; padding-top:12px; border-top:1px solid var(--line); display:flex; gap:6px;">
              <button class="btn btn-ghost btn-sm" style="flex:1;" onclick="state._seleccionNumeros=null; cerrarModal();">Cerrar</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function _toggleNumSeleccion(numero) {
  const s = state._seleccionNumeros;
  if (!s) return;
  const idx = s.seleccion.indexOf(numero);
  if (idx >= 0) s.seleccion.splice(idx, 1);
  else s.seleccion.push(numero);
  _renderModalSeleccion();
}

async function _registrarDesdeSeleccion() {
  const s = state._seleccionNumeros;
  if (!s || s.seleccion.length === 0) return;
  const nombre = (document.getElementById('sel-nombre')?.value || '').trim();
  if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
  const telefono = (document.getElementById('sel-telefono')?.value || '').trim();
  const cedula = (document.getElementById('sel-cedula')?.value || '').trim();

  try {
    for (const num of s.seleccion) {
      await api('/rifas/' + s.rifaId + '/participantes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, telefono, cedula, numero: num })
      });
      const idx = s.numeros.findIndex(n => n.numero === num);
      if (idx >= 0) s.numeros[idx].estado = 'vendido';
    }
    s.registrados += s.seleccion.length;
    const count = s.seleccion.length;
    s.seleccion = [];
    document.getElementById('sel-nombre').value = '';
    document.getElementById('sel-telefono').value = '';
    document.getElementById('sel-cedula').value = '';
    toast(`✅ ${count} participante(s) registrado(s)`);
    _renderModalSeleccion();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function cambiarEstadoPago(participanteId, estado, rifaId) {
  try {
    await api('/participantes/' + participanteId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado_pago: estado }) });
    toast('Estado actualizado');
    vistaDetalleRifa(rifaId, 'participantes');
  } catch (err) { toast(err.message, 'error'); }
}

function modalEditarParticipante(rifaId, p) {
  abrirModal(`
    <div class="modal__header"><h3>Editar participante</h3><button class="btn btn-ghost btn-sm" onclick="cerrarModal()">✕</button></div>
    <form id="form-editar-participante" class="modal__body">
      <p class="text-sm text-ink-600 mb-3">Boleta: <strong class="mono">${escapeHtml(p.numeros.join(', '))}</strong></p>
      <div class="grid-2">
        <div class="field"><label>Nombre completo <em class="req">*</em></label><input class="input" name="nombre" required value="${escapeHtml(p.nombre)}" maxlength="120"></div>
        <div class="field"><label>Teléfono</label><input class="input" name="telefono" inputmode="tel" value="${escapeHtml(p.telefono || '')}" maxlength="20"></div>
      </div>
      <div class="field"><label>Cédula (opcional)</label><input class="input" name="cedula" inputmode="numeric" value="${escapeHtml(p.cedula || '')}"></div>
      <div class="field">
        <label>Estado de pago</label>
        <select class="input" name="estado_pago">
          <option value="pendiente" ${p.estado_pago === 'pendiente' ? 'selected' : ''}>Pendiente</option>
          <option value="pagado" ${p.estado_pago === 'pagado' ? 'selected' : ''}>Pagado</option>
        </select>
      </div>
      <div class="modal__footer" style="padding:0; margin-top:10px;">
        <button type="button" class="btn btn-ghost" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-gold">Guardar cambios</button>
      </div>
    </form>`);

  document.getElementById('form-editar-participante').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await api('/participantes/' + p.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) });
      toast('Participante actualizado');
      cerrarModal();
      vistaDetalleRifa(rifaId, 'participantes');
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function eliminarParticipante(id, rifaId) {
  if (!confirm('¿Eliminar participante y liberar su número?')) return;
  try {
    await api('/participantes/' + id, { method: 'DELETE' });
    toast('Participante eliminado, número liberado');
    vistaDetalleRifa(rifaId, 'participantes');
  } catch (e) { toast(e.message, 'error'); }
}

// Ficha informativa del comprador de una casilla / grupo (mapa clickeable)
function fichaParticipante(rifa, p) {
  const nums = p.numeros && p.numeros.length ? p.numeros : [p.numero];
  const lbl = (rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES')
    ? nums.map(n => String(n).padStart(2, '0')).join(' · ')
    : nums.join(', ');
  const editarJs = JSON.stringify({ id: p.id, nombre: p.nombre, telefono: p.telefono, cedula: p.cedula, numeros: nums, estado_pago: p.estado_pago });
  const recordatorioJs = JSON.stringify({ nombre: p.nombre, numeros: nums, rifa_nombre: rifa.nombre, valor: rifa.valor_boleta, telefono: p.telefono });
  abrirModal(`
    <div class="modal__header"><h3>Boleta ${lbl}</h3><button class="btn btn-ghost btn-sm" onclick="cerrarModal()">✕</button></div>
    <div class="modal__body">
      <div class="ficha-fila"><span>Nombre</span><strong>${escapeHtml(p.nombre)}</strong></div>
      <div class="ficha-fila"><span>Teléfono</span><strong class="mono">${escapeHtml(p.telefono || '—')}</strong></div>
      <div class="ficha-fila"><span>Cédula</span><strong class="mono">${escapeHtml(p.cedula || '—')}</strong></div>
      <div class="ficha-fila"><span>Número(s)</span><strong class="mono">${lbl}</strong></div>
      <div class="ficha-fila"><span>Estado pago</span><strong>${p.estado_pago === 'pagado' ? '🟢 Pagado' : '🟡 Pendiente'}</strong></div>
      <div class="ficha-fila"><span>Registrado</span><strong>${fmtFecha(p.fecha_registro)}</strong></div>
      <div class="flex gap-2 mt-4" style="justify-content:flex-end;">
        ${p.estado_pago === 'pendiente' ? `<button class="btn btn-outline btn-sm" onclick='recordatorioWhatsapp(${recordatorioJs})'>💬 Recordar pago</button>` : ''}
        ${rifa.estado === 'activa' ? `<button class="btn btn-outline btn-sm" onclick='modalEditarParticipante(${rifa.id}, ${editarJs})'>✏️ Editar</button>` : ''}
        <button class="btn btn-danger btn-sm" onclick="cerrarModal(); eliminarParticipante(${p.id}, ${rifa.id})">🗑️ Eliminar / liberar</button>
      </div>
    </div>`);
}

async function liberarVencidos(rifaId) {
  const r = await api('/rifas/' + rifaId + '/liberar-vencidos', { method: 'POST' });
  toast(r.liberados > 0 ? `🔓 ${r.liberados} número(s) liberado(s)` : 'No hay números vencidos por liberar');
  vistaDetalleRifa(rifaId, 'participantes');
}

function recordatorioWhatsapp({ nombre, numeros, rifa_nombre, valor, telefono }) {
  const lista = Array.isArray(numeros) ? numeros.join(', ') : numeros;
  const texto = `Hola ${nombre}, te recordamos que tu boleta (${lista}) de la rifa ${rifa_nombre} está pendiente de pago por ${fmtCOP(valor)}`;
  if (telefono) {
    const tel = telefono.replace(/\D/g, '');
    window.open(`https://wa.me/57${tel}?text=${encodeURIComponent(texto)}`, '_blank');
  } else {
    navigator.clipboard.writeText(texto);
    toast('📋 Mensaje copiado, pégalo en WhatsApp');
  }
}

async function clonarRifa(id) {
  if (!confirm('¿Clonar esta rifa? Se creará una copia con la misma configuración.')) return;
  try {
    const nueva = await api('/rifas/' + id + '/clonar', { method: 'POST' });
    toast('Rifa clonada como borrador');
    window.location.hash = '#/rifas/' + nueva.id + '/editar';
  } catch (e) { toast(e.message, 'error'); }
}

async function eliminarRifa(id, nombre) {
  const rifa = state.rifaActual || {};
  const nombreMostrar = nombre || rifa.nombre || id;
  if (!confirm(`¿Eliminar "${nombreMostrar}"? Se moverá a la papelera y podrás restaurarla desde el filtro "Eliminadas".`)) return;
  try {
    await api('/rifas/' + id, { method: 'DELETE' });
    toast('Rifa movida a la papelera');
    window.location.hash = '#/rifas';
  } catch (e) { toast(e.message, 'error'); }
}

// Aplazar / cambiar fecha y hora del sorteo, o reabrir una rifa cerrada
function modalAplazarRifa(r) {
  const hoy = new Date().toISOString().slice(0, 10);
  abrirModal(`
    <div class="modal__header"><h3>📅 Aplazar / cambiar fecha del sorteo</h3><button class="btn btn-ghost btn-sm" onclick="cerrarModal()">✕</button></div>
    <form id="form-aplazar" class="modal__body">
      <p class="text-sm text-ink-600 mb-3">Si no se vendieron todas las boletas, mueve la fecha y la hora del sorteo en lugar de perder dinero. Puedes elegir nueva fecha, nueva hora y reabrir la rifa.</p>
      <div class="grid-2">
        <div class="field">
          <label>Nueva fecha del sorteo</label>
          <input class="input" name="fecha_sorteo" type="date" required min="${hoy}" value="${(r.fecha_sorteo || '').slice(0, 10)}">
        </div>
        <div class="field">
          <label>Hora del sorteo (opcional)</label>
          <input class="input" name="hora_sorteo" type="time" value="${(r.hora_sorteo || '19:00').slice(0, 5)}">
        </div>
      </div>
      <div class="field">
        <label>Estado de la rifa</label>
        <select class="input" name="estado">
          <option value="activa" ${r.estado === 'activa' ? 'selected' : ''}>🟢 Activa (seguir vendiendo)</option>
          <option value="cerrada" ${r.estado === 'cerrada' ? 'selected' : ''}>🔒 Cerrada (no vender más)</option>
        </select>
        <span class="hint">Si la rifa estaba cerrada por fecha vencida y quieres seguir vendiendo, vuelve a ponerla en <strong>Activa</strong>.</span>
      </div>
      <div class="modal__footer" style="padding:0; margin-top:10px;">
        <button type="button" class="btn btn-ghost" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-gold">Guardar cambios</button>
      </div>
    </form>`);

  document.getElementById('form-aplazar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      const guardada = await api('/rifas/' + r.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fd) });
      toast(guardada.estado === 'activa' && r.estado === 'cerrada' ? '🔓 Rifa reabierta y aplazada' : '📅 Fecha del sorteo actualizada');
      cerrarModal();
      vistaDetalleRifa(r.id, 'resumen');
    } catch (err) { toast(err.message, 'error'); }
  });
}

// -------------------------- TAB PUBLICIDAD --------------------------------
async function renderPublicidadTab(rifa, d, box) {
  box.innerHTML = `
    <p class="text-sm text-ink-600 mb-4">Genera automáticamente el post y la historia para redes / WhatsApp, con tu progreso de ventas y QR de transparencia.</p>
    <div class="card card-pad mb-4">
      <div class="flex gap-4" style="flex-wrap:wrap;">
        <div class="field" style="margin:0; min-width:220px;">
          <label>Calidad de exportación</label>
          <div class="seg-vista" id="sel-calidad" role="tablist">
            <button type="button" class="seg-btn" data-calidad="1">Estándar · 1080</button>
            <button type="button" class="seg-btn active" data-calidad="2">Alta · 2160 (2×)</button>
          </div>
          <span class="hint">La calidad alta rinde imágenes nítidas para imprimir o zoom; ideal para WhatsApp / Instagram.</span>
        </div>
        <div class="field" style="margin:0; min-width:180px;">
          <label>Formato de descarga</label>
          <div class="seg-vista" id="sel-formato" role="tablist">
            <button type="button" class="seg-btn active" data-formato="png">PNG</button>
            <button type="button" class="seg-btn" data-formato="jpeg">JPG</button>
          </div>
          <span class="hint">PNG = pérdida cero (archivo grande). JPG = más liviano para WhatsApp.</span>
        </div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card card-pad text-center">
        <h3 class="mb-3">Post cuadrado <span class="text-xs text-ink-600" id="lbl-post-res">2160×2160</span></h3>
        <canvas id="canvas-post" width="1080" height="1080" style="width:100%; max-width:320px; border-radius:12px; box-shadow:var(--shadow-md);"></canvas>
        <div class="btn-group mt-3">
          <button class="btn btn-outline btn-sm" onclick="previsualizarPost()">👁️ Previsualizar</button>
          <button class="btn btn-gold btn-sm" onclick="descargarPost()">⬇️ Descargar</button>
        </div>
      </div>
      <div class="card card-pad text-center">
        <h3 class="mb-3">Historia vertical <span class="text-xs text-ink-600" id="lbl-historia-res">2160×3840</span></h3>
        <canvas id="canvas-historia" width="1080" height="1920" style="width:100%; max-width:200px; border-radius:12px; box-shadow:var(--shadow-md);"></canvas>
        <div class="btn-group mt-3">
          <button class="btn btn-outline btn-sm" onclick="previsualizarHistoria()">👁️ Previsualizar</button>
          <button class="btn btn-gold btn-sm" onclick="descargarHistoria()">⬇️ Descargar</button>
        </div>
      </div>
    </div>
    <div class="card card-pad mt-4 text-center">
      <p class="text-sm text-ink-600 mb-3">También puedes generar el <strong>poster cuadrado en el servidor</strong> y dejarlo guardado como imagen oficial de la rifa (se muestra en el listado y se usa en los enlaces).</p>
      <button class="btn btn-primary btn-block" id="btn-generar-poster" onclick="generarPoster(${rifa.id})">🖼️ Generar poster oficial (2160×2160)</button>
      <a id="btn-descargar-poster" href="#" download style="display:none;" class="btn btn-gold btn-block">⬇️ Descargar poster</a>
      <div id="card-poster" class="mt-3"></div>
    </div>`;

  const empresa = state.empresa || await api('/empresa');
  state.empresa = empresa;

  window._generador = new GeneradorImagen({
    nombre: rifa.nombre, producto: rifa.producto, valor_boleta: rifa.valor_boleta,
    fecha_sorteo: rifa.fecha_sorteo, hora_sorteo: rifa.hora_sorteo || '', porcentaje: d.porcentaje, quedan: d.quedan,
    imagenProductoUrl: rifa.imagen_producto, logoUrl: empresa.logo_path,
    qrUrl: `/api/rifas/${rifa.id}/qr`, nombreEmpresa: empresa.nombre_empresa,
    descripcion: rifa.descripcion || '', telefono: empresa.telefono || ''
  });

  let calidad = 2;
  let formato = 'png';
  window._pubCalidad = () => calidad;
  window._pubFormato = () => formato;

  const actualizarRes = () => {
    const e = calidad === 1 ? 1080 : 2160;
    const h = calidad === 1 ? 1920 : 3840;
    document.getElementById('lbl-post-res').textContent = e + '×' + e;
    document.getElementById('lbl-historia-res').textContent = e + '×' + h;
  };
  document.getElementById('sel-calidad').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.seg-btn'); if (!btn) return;
    calidad = Number(btn.dataset.calidad);
    document.querySelectorAll('#sel-calidad .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.calidad === String(calidad)));
    actualizarRes();
    previsualizarPost(); previsualizarHistoria();
  });
  document.getElementById('sel-formato').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.seg-btn'); if (!btn) return;
    formato = btn.dataset.formato;
    document.querySelectorAll('#sel-formato .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.formato === formato));
  });
  actualizarRes();
  await previsualizarPost();
  await previsualizarHistoria();

  // Poster oficial guardado (si existe)
  const cardPoster = document.getElementById('card-poster');
  const descargar = document.getElementById('btn-descargar-poster');
  if (rifa.poster_image_url) {
    cardPoster.innerHTML = `<img src="${rifa.poster_image_url}?v=${Date.now()}" style="width:100%; max-width:280px; border-radius:12px; box-shadow:var(--shadow-md);">`;
    descargar.href = rifa.poster_image_url;
    descargar.style.display = 'inline-flex';
    descargar.setAttribute('download', 'poster-rifa-' + rifa.id + '.png');
  }
}

async function previsualizarPost() {
  const canvas = await window._generador.generarPost(window._pubCalidad());
  const viejo = document.getElementById('canvas-post');
  viejo.replaceWith(canvas);
  canvas.id = 'canvas-post';
  canvas.style.cssText = 'width:100%; max-width:320px; border-radius:12px; box-shadow:var(--shadow-md);';
}
async function previsualizarHistoria() {
  const canvas = await window._generador.generarHistoria(window._pubCalidad());
  const viejo = document.getElementById('canvas-historia');
  viejo.replaceWith(canvas);
  canvas.id = 'canvas-historia';
  canvas.style.cssText = 'width:100%; max-width:200px; border-radius:12px; box-shadow:var(--shadow-md);';
}
function descargarPost() { GeneradorImagen.descargarPNG(document.getElementById('canvas-post'), 'post-rifa.png', window._pubFormato()); }
function descargarHistoria() { GeneradorImagen.descargarPNG(document.getElementById('canvas-historia'), 'historia-rifa.png', window._pubFormato()); }

// Genera el poster 2160x2160 en el servidor (@napi-rs/canvas) y lo guarda en la rifa
async function generarPoster(rifaId) {
  const btn = document.getElementById('btn-generar-poster');
  const antes = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generando…'; }
  try {
    const r = await api('/rifas/' + rifaId + '/generar-poster', { method: 'POST' });
    const target = document.getElementById('poster-preview') || document.getElementById('card-poster');
    if (target) target.innerHTML = `<img src="${r.url}?v=${Date.now()}" style="width:100%; max-width:280px; border-radius:12px; box-shadow:var(--shadow-md);">`;
    const descargar = document.getElementById('btn-descargar-poster');
    if (descargar) { descargar.href = r.url; descargar.style.display = 'inline-flex'; descargar.setAttribute('download', 'poster-rifa-' + rifaId + '.png'); }
    toast('🎨 Poster 2160×2160 generado y guardado en la rifa');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = antes; }
  }
}

// -------------------------- TAB SORTEO --------------------------------
async function renderSorteoTab(rifa, box) {
  if (modoEsChance(rifa)) {
    box.innerHTML = `<div class="card card-pad text-center">
      <div style="font-size:40px;">🎰</div>
      <h3 class="mb-2">Esta rifa se sortea por Chance con Símbolo</h3>
      <p class="text-sm text-ink-600 mb-3">El sorteo de ${rifa.cifras || 4} cifras + símbolo se hace desde la balotera.</p>
      <a href="#/rifas/${rifa.id}/balotera" class="btn btn-gold">🎰 Ir a la balotera</a>
    </div>`;
    return;
  }
  const [pagados, ganadores] = await Promise.all([
    api('/rifas/' + rifa.id + '/participantes').then(ps => ps.filter(p => p.estado_pago === 'pagado')),
    api('/rifas/' + rifa.id + '/ganadores')
  ]);

  if (rifa.estado === 'sorteada' && ganadores.length) {
    box.innerHTML = `<div class="card card-pad text-center">
      <div style="font-size:40px;">🏆</div>
      <h3 class="mb-2">Esta rifa ya fue sorteada</h3>
      ${ganadores.map(g => `<p class="mb-1">Número ganador: <strong class="mono" style="font-size:20px; color:var(--gold-500);">#${fmtNum(rifa, g.numero)}</strong> — ${escapeHtml(g.nombre || '')}</p>`).join('')}
      <p class="text-xs text-ink-600 mt-2">Semilla de transparencia: <span class="mono">${ganadores[0].semilla}</span></p>
      <a href="#/rifas/${rifa.id}/historial" class="btn btn-outline btn-sm mt-3">Ver historial completo</a>
    </div>`;
    return;
  }

  if (pagados.length === 0) {
    box.innerHTML = `<div class="empty-state"><div class="icon">🎯</div><p>Necesitas al menos un participante <strong>pagado</strong> para poder sortear.</p></div>`;
    return;
  }

  box.innerHTML = `
    <div class="card card-pad mb-4">
      <div class="field">
        <label>Modalidad de sorteo</label>
        <select class="input" id="sel-modalidad">
          <option value="ruleta">Ruleta en vivo (con evidencia en video)</option>
          <option value="aleatorio">Aleatorio (N ganadores sin repetir)</option>
          <option value="loteria">Por lotería (últimas cifras)</option>
          <option value="tapazo">Tapazo (rango de números)</option>
        </select>
      </div>
      <div id="config-modalidad"></div>
    </div>
    <div id="area-sorteo"></div>`;

  const sel = document.getElementById('sel-modalidad');
  const renderConfig = () => {
    const cfg = document.getElementById('config-modalidad');
    const m = sel.value;
    if (m === 'aleatorio') {
      cfg.innerHTML = `<div class="field"><label>Cantidad de ganadores</label><input class="input" id="cant-ganadores" type="number" min="1" max="${pagados.length}" value="1"></div>`;
    } else if (m === 'loteria') {
      cfg.innerHTML = `
        <div class="grid-2">
          <div class="field"><label>Lotería</label><input class="input" id="loteria-nombre" placeholder="Lotería de Boyacá"></div>
          <div class="field"><label>N° de sorteo</label><input class="input" id="loteria-sorteo" placeholder="2543"></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>Fecha del sorteo</label><input class="input" id="loteria-fecha" type="date"></div>
          <div class="field"><label>Resultado (número ganador)</label><input class="input" id="loteria-resultado" placeholder="Ej: 4587"></div>
        </div>
        <div class="field"><label>Validar por</label>
          <select class="input" id="loteria-cifras"><option value="2">Últimas 2 cifras</option><option value="3">Últimas 3 cifras</option></select>
        </div>`;
    } else if (m === 'tapazo') {
      cfg.innerHTML = `<div class="grid-2">
        <div class="field"><label>Rango desde</label><input class="input" id="tapazo-min" type="number" value="${rifa.rango_min}"></div>
        <div class="field"><label>Rango hasta</label><input class="input" id="tapazo-max" type="number" value="${rifa.rango_max}"></div>
      </div>`;
    } else {
      cfg.innerHTML = `<p class="text-sm text-ink-600">La ruleta girará solo entre los <strong>${pagados.length}</strong> participantes con pago confirmado y grabará un video de evidencia.</p>`;
    }
  };
  sel.addEventListener('change', renderConfig);
  renderConfig();

  document.getElementById('area-sorteo').innerHTML = `<button class="btn btn-gold btn-block" id="btn-sortear" style="max-width:260px;">🎲 Realizar sorteo</button>`;
  document.getElementById('btn-sortear').addEventListener('click', () => ejecutarSorteo(rifa, pagados, sel.value));
}

async function ejecutarSorteo(rifa, pagados, modalidad) {
  const area = document.getElementById('area-sorteo');
  if (!confirm('El sorteo quedará registrado de forma permanente. ¿Continuar?')) return;

  const body = { modalidad };
  if (modalidad === 'aleatorio') body.cantidad_ganadores = document.getElementById('cant-ganadores').value;
  if (modalidad === 'loteria') body.loteria = {
    nombre: document.getElementById('loteria-nombre').value, sorteo: document.getElementById('loteria-sorteo').value,
    fecha: document.getElementById('loteria-fecha').value, resultado: document.getElementById('loteria-resultado').value,
    cifras: document.getElementById('loteria-cifras').value
  };
  if (modalidad === 'tapazo') body.tapazo = { min: Number(document.getElementById('tapazo-min').value), max: Number(document.getElementById('tapazo-max').value) };
  if (modalidad === 'ruleta') body.cantidad_ganadores = 1;

  try {
    if (modalidad === 'ruleta') {
      const etiquetar = (n) => {
        const m = rifa.modalidad_boleta;
        if (m === 'OPORTUNIDADES_4D' || (m === 'CHANCE_INDIVIDUAL' && Number(rifa.cifras || 4) >= 4)) return String(n).padStart(4, '0');
        return String(n).padStart(2, '0');
      };
      const filas = pagados.map(p => `<li data-numero="${etiquetar(p.numero)}"><span class="mono">#${etiquetar(p.numero)}</span><span>${escapeHtml(p.nombre || '')}</span></li>`).join('');
      area.innerHTML = `
        <div class="card card-pad">
          <div class="anim-layout">
            <div class="anim-canvas text-center">
              <canvas id="canvas-ruleta" width="360" height="360" style="max-width:100%;"></canvas>
              <p class="text-sm text-ink-600 mt-2">Girando y grabando evidencia...</p>
            </div>
            <div class="anim-lista">
              <h4>Participantes (${pagados.length})</h4>
              <ol class="anim-lista-ol">${filas}</ol>
            </div>
          </div>
        </div>`;
      const rueda = new RuletaCanvas(document.getElementById('canvas-ruleta'), pagados.map(p => ({ numero: p.numero, nombre: p.nombre, label: etiquetar(p.numero) })));
      const resultado = await api('/rifas/' + rifa.id + '/sortear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const videoUrl = await rueda.girarHasta(resultado.ganadores[0].numero);
      const filaGanadora = document.querySelector(`#area-sorteo [data-numero="${etiquetar(resultado.ganadores[0].numero)}"]`);
      if (filaGanadora) filaGanadora.classList.add('ganador');
      mostrarResultadoSorteo(rifa, resultado, videoUrl);
    } else {
      const resultado = await api('/rifas/' + rifa.id + '/sortear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      mostrarResultadoSorteo(rifa, resultado, null);
    }
  } catch (err) { toast(err.message, 'error'); }
}

function mostrarResultadoSorteo(rifa, resultado, videoUrl) {
  confetti({ particleCount: 180, spread: 90, origin: { y: 0.6 }, colors: ['#D4A017', '#E8B923', '#0B1229'] });
  const urlVerificar = window.location.origin + '/public/rifa/' + rifa.id;
  document.getElementById('area-sorteo').insertAdjacentHTML('beforeend', `
    <div class="card card-pad text-center mt-4">
      <div style="font-size:40px;">🏆</div>
      <h3 class="mb-2">¡Sorteo realizado!</h3>
      ${resultado.ganadores.map(g => `<p class="mb-1">Número ganador: <strong class="mono" style="font-size:22px; color:var(--gold-500);">#${fmtNum(rifa, g.numero)}</strong> — ${escapeHtml(g.nombre)}</p>`).join('')}
      <div style="background:rgba(212,160,23,.08); border:1px solid rgba(212,160,23,.25); border-radius:10px; padding:14px 18px; margin:16px 0; text-align:left;">
        <p style="font-size:13px; font-weight:700; color:var(--gold-500); margin-bottom:6px;">🔐 Transparencia verificable</p>
        <p style="font-size:12px; color:var(--ink-600); margin-bottom:6px;">Semilla de verificación: <span class="mono" style="font-weight:700;">${resultado.semilla}</span></p>
        <p style="font-size:12px; color:var(--ink-600); margin-bottom:8px;">Cualquier persona puede verificar este resultado en:</p>
        <a href="${urlVerificar}" target="_blank" style="font-size:12px; color:var(--gold-500); word-break:break-all; text-decoration:underline;">${urlVerificar}</a>
      </div>
      <div style="font-size:11px; color:var(--ink-400); text-align:left; line-height:1.6; margin-top:12px;">
        <strong>¿Cómo funciona?</strong> El resultado se determina con Math.random() criptográficamente seguro. La semilla se genera antes del sorteo y se registra permanentemente. Los datos no pueden ser alterados después del sorteo.
      </div>
      ${videoUrl ? `<a class="btn btn-gold btn-sm mt-3" href="${videoUrl}" download="evidencia-sorteo-rifa-${rifa.id}.webm">⬇️ Descargar evidencia en video</a>` : ''}
      <a class="btn btn-outline btn-sm mt-2" href="${urlVerificar}" target="_blank">🔗 Página de verificación pública</a>
    </div>`);
}

// -------------------------- DASHBOARD -------------------------------------------------
async function renderDashboard(container) {
  container.innerHTML = '<div class="loading">Cargando estadísticas...</div>';
  const stats = await api('/stats');

  container.innerHTML = `
    <div class="dashboard-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:16px; margin-bottom:24px;">
      <div class="card" style="text-align:center; padding:20px;">
        <div style="font-size:28px; font-weight:700; color:var(--gold-400);">${stats.totalRifas}</div>
        <div class="text-sm text-ink-600">Total Rifas</div>
      </div>
      <div class="card" style="text-align:center; padding:20px;">
        <div style="font-size:28px; font-weight:700; color:#22c55e;">${stats.rifasActivas}</div>
        <div class="text-sm text-ink-600">Activas</div>
      </div>
      <div class="card" style="text-align:center; padding:20px;">
        <div style="font-size:28px; font-weight:700; color:#3b82f6;">${stats.totalParticipantes}</div>
        <div class="text-sm text-ink-600">Participantes</div>
      </div>
      <div class="card" style="text-align:center; padding:20px;">
        <div style="font-size:28px; font-weight:700; color:#f59e0b;">$${stats.recaudado.toLocaleString('es-CO')}</div>
        <div class="text-sm text-ink-600">Recaudado</div>
      </div>
    </div>

    <div style="display:grid; grid-template-columns: 2fr 1fr; gap:20px; margin-bottom:24px;">
      <div class="card" style="padding:20px;">
        <h3 style="margin:0 0 12px;">Recaudado por día (últimos 30 días)</h3>
        <canvas id="chart-recaudado" height="200"></canvas>
      </div>
      <div class="card" style="padding:20px;">
        <h3 style="margin:0 0 12px;">Top Rifas</h3>
        <canvas id="chart-top-rifas" height="200"></canvas>
      </div>
    </div>

    <div class="card" style="padding:20px;">
      <h3 style="margin:0 0 12px;">Resumen de Pagos</h3>
      <div style="display:flex; gap:24px; align-items:center;">
        <div>
          <div style="font-size:22px; font-weight:700; color:#22c55e;">${stats.pagados}</div>
          <div class="text-sm text-ink-600">Pagados</div>
        </div>
        <div>
          <div style="font-size:22px; font-weight:700; color:#f59e0b;">${stats.pendientes}</div>
          <div class="text-sm text-ink-600">Pendientes</div>
        </div>
        <div style="flex:1;">
          <div style="background:#e5e7eb; border-radius:8px; height:12px; overflow:hidden;">
            <div style="background:#22c55e; height:100%; width:${stats.pagados + stats.pendientes > 0 ? (stats.pagados / (stats.pagados + stats.pendientes) * 100) : 0}%; border-radius:8px;"></div>
          </div>
          <div class="text-xs text-ink-600 mt-1">${stats.pagados + stats.pendientes > 0 ? Math.round(stats.pagados / (stats.pagados + stats.pendientes) * 100) : 0}% pagado</div>
        </div>
      </div>
    </div>
  `;

  // Gráfica de recaudado por día
  if (stats.porDia.length > 0) {
    const ctxRec = document.getElementById('chart-recaudado');
    if (ctxRec) {
      new Chart(ctxRec, {
        type: 'bar',
        data: {
          labels: stats.porDia.map(d => d.fecha.slice(5)),
          datasets: [{
            label: 'Recaudado',
            data: stats.porDia.map(d => d.recaudado),
            backgroundColor: 'rgba(212,160,23,0.7)',
            borderColor: '#D4A017',
            borderWidth: 1,
            borderRadius: 4
          }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });
    }
  }

  // Gráfica de top rifas
  if (stats.topRifas.length > 0) {
    const ctxTop = document.getElementById('chart-top-rifas');
    if (ctxTop) {
      new Chart(ctxTop, {
        type: 'doughnut',
        data: {
          labels: stats.topRifas.map(r => r.nombre.length > 20 ? r.nombre.slice(0, 20) + '…' : r.nombre),
          datasets: [{
            data: stats.topRifas.map(r => r.recaudado),
            backgroundColor: ['#D4A017', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444']
          }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
      });
    }
  }
}

// -------------------------- PROBAR ANIMACIONES (MÓDULO DE PRUEBAS) --------------------------
function renderPruebasTab(container) {
  container.innerHTML = `
    <div class="card card-pad mb-4" style="max-width:700px;">
      <h3 class="mb-2">🧪 Probar Animaciones</h3>
      <p class="text-sm text-ink-600 mb-3">Visualiza y prueba las animaciones de la ruleta y la balotera con datos de ejemplo. Útil para verificar que todo funciona correctamente antes de usarlo en un sorteo real.</p>
      <div class="field">
        <label>Animación a probar</label>
        <select class="input" id="sel-tipo-prueba">
          <option value="ruleta">🎡 Ruleta en vivo</option>
          <option value="balotera">🎱 Balotera virtual</option>
        </select>
      </div>
      <div id="config-prueba"></div>
      <div id="area-prueba"></div>
    </div>`;

  const sel = document.getElementById('sel-tipo-prueba');
  const renderConfig = () => {
    const cfg = document.getElementById('config-prueba');
    const area = document.getElementById('area-prueba');
    area.innerHTML = '';
    if (sel.value === 'ruleta') {
      cfg.innerHTML = `
        <div class="grid-2">
          <div class="field"><label>Cantidad de participantes (ejemplo)</label><input class="input" id="prueba-cant" type="number" min="2" max="100" value="12"></div>
          <div class="field"><label>Duración del giro (ms)</label><input class="input" id="prueba-dur" type="number" min="1000" max="15000" value="4500"></div>
        </div>
        <button class="btn btn-gold" id="btn-probar-ruleta">🎡 Probar Ruleta</button>`;
      document.getElementById('btn-probar-ruleta').addEventListener('click', () => probarRuleta());
    } else {
      cfg.innerHTML = `
        <div class="grid-2">
          <div class="field"><label>Cifras</label>
            <select class="input" id="prueba-cifras">
              <option value="2">2 cifras (00-99)</option>
              <option value="4" selected>4 cifras (0000-9999)</option>
              <option value="5">5 cifras (00000-99999)</option>
            </select>
          </div>
          <div class="field"><label>Cantidad de boletas pagadas (ejemplo)</label><input class="input" id="prueba-cant-bal" type="number" min="1" max="100" value="10"></div>
        </div>
        <button class="btn btn-gold" id="btn-probar-balotera">🎱 Probar Balotera</button>`;
      document.getElementById('btn-probar-balotera').addEventListener('click', () => probarBalotera());
    }
  };
  sel.addEventListener('change', renderConfig);
  renderConfig();
}

function probarRuleta() {
  const cant = Math.max(2, Math.min(100, Number(document.getElementById('prueba-cant').value) || 12));
  const dur = Math.max(1000, Math.min(15000, Number(document.getElementById('prueba-dur').value) || 4500));
  const area = document.getElementById('area-prueba');
  const nombres = ['Ana García', 'Carlos López', 'María Martínez', 'Pedro Sánchez', 'Laura Rodríguez', 'Juan Pérez', 'Sofía Hernández', 'Diego Torres', 'Valentina Díaz', 'Andrés Moreno', 'Camila Vargas', 'Luis Ramírez', 'Daniela Cruz', 'Mateo Flores', 'Isabella Reyes', 'Sebastián Muñoz', 'Paula Ortiz', 'Nicolás Castro', 'Mariana Velásquez', 'Felipe Guerrero'];
  const participantes = Array.from({ length: cant }, (_, i) => ({
    numero: i + 1,
    nombre: nombres[i % nombres.length] + (i >= nombres.length ? ' ' + (Math.floor(i / nombres.length) + 1) : ''),
    label: String(i + 1)
  }));
  const ganadorIdx = Math.floor(Math.random() * cant);
  const filtrar = document.getElementById('sel-filtro-nombres-prueba');
  const mostrarNombres = filtrar ? filtrar.value === 'si' : cant <= 20;

  area.innerHTML = `
    <div class="card card-pad mt-3">
      <div class="anim-layout">
        <div class="anim-canvas text-center">
          <canvas id="canvas-prueba-ruleta" width="360" height="360" style="max-width:100%;"></canvas>
          <p class="text-sm text-ink-600 mt-2">Girando...</p>
        </div>
        <div class="anim-lista">
          <h4>Participantes (${cant})</h4>
          <ol class="anim-lista-ol">${participantes.map(p => `<li data-numero="${p.numero}"><span class="mono">#${p.label}</span><span>${p.nombre}</span></li>`).join('')}</ol>
        </div>
      </div>
    </div>`;
  const rueda = new RuletaCanvas(document.getElementById('canvas-prueba-ruleta'), participantes);
  rueda.girarHasta(participantes[ganadorIdx].numero, dur).then(() => {
    const fila = document.querySelector(`#area-prueba [data-numero="${participantes[ganadorIdx].numero}"]`);
    if (fila) fila.classList.add('ganador');
    toast('Ganador: #' + participantes[ganadorIdx].label + ' — ' + participantes[ganadorIdx].nombre, 'success');
  });
}

function probarBalotera() {
  const cifras = Number(document.getElementById('prueba-cifras').value) || 4;
  const cant = Math.max(1, Math.min(100, Number(document.getElementById('prueba-cant-bal').value) || 10));
  const area = document.getElementById('area-prueba');
  const nombres = ['Ana García', 'Carlos López', 'María Martínez', 'Pedro Sánchez', 'Laura Rodríguez', 'Juan Pérez', 'Sofía Hernández', 'Diego Torres', 'Valentina Díaz', 'Andrés Moreno', 'Camila Vargas', 'Luis Ramírez', 'Daniela Cruz', 'Mateo Flores', 'Isabella Reyes', 'Sebastián Muñoz', 'Paula Ortiz', 'Nicolás Castro', 'Mariana Velásquez', 'Felipe Guerrero'];
  const rangoMax = Math.pow(10, cifras);
  const numerosUsados = new Set();
  const participantes = [];
  while (participantes.length < cant && participantes.length < rangoMax) {
    let n;
    do { n = Math.floor(Math.random() * rangoMax); } while (numerosUsados.has(n));
    numerosUsados.add(n);
    participantes.push({ numero: n, nombre: nombres[participantes.length % nombres.length] });
  }
  const bolitas = participantes.map(p => ({ numero: p.numero, nombre: p.nombre }));
  const ganador = bolitas[Math.floor(Math.random() * bolitas.length)];

  area.innerHTML = `
    <div class="card card-pad mt-3">
      <div class="anim-layout">
        <div class="anim-canvas text-center">
          <canvas id="canvas-prueba-balotera" width="480" height="420" style="max-width:100%;"></canvas>
          <p class="text-sm text-ink-600 mt-2">Revolviendo ${bolitas.length} boletas de ejemplo...</p>
        </div>
        <div class="anim-lista">
          <h4>Boletas de ejemplo (${bolitas.length})</h4>
          <ol class="anim-lista-ol">${bolitas.map(b => `<li data-numero="${String(b.numero).padStart(cifras, '0')}"><span class="mono">#${String(b.numero).padStart(cifras, '0')}</span><span>${b.nombre}</span></li>`).join('')}</ol>
        </div>
      </div>
    </div>`;
  const canvas = document.getElementById('canvas-prueba-balotera');
  const balotera = new BaloteraCanvas(canvas, {
    numeroFinal: String(ganador.numero),
    cifras: cifras,
    colorAcento: '#D4A017',
    bolitas
  });
  balotera.jugar(5000).then(() => {
    const fila = document.querySelector(`#area-prueba [data-numero="${String(ganador.numero).padStart(cifras, '0')}"]`);
    if (fila) fila.classList.add('ganador');
    toast('Ganador: #' + String(ganador.numero).padStart(cifras, '0') + ' — ' + ganador.nombre, 'success');
  });
}

// Previsualiza animaciones con datos REALES de una rifa específica
async function renderPruebaRifa(container, rifaId) {
  try {
    const rifa = await api('/rifas/' + rifaId);
    const pagados = (await api('/rifas/' + rifaId + '/participantes')).filter(p => p.estado_pago === 'pagado');
    const esChance = modoEsChance(rifa);
    const esNormal = rifa.modalidad_boleta === 'BOLETAS_NORMAL';

    container.innerHTML = `
      <div class="card card-pad mb-3" style="max-width:700px;">
        <div class="flex items-center gap-3 mb-3">
          <a href="#/rifas/${rifaId}" class="btn btn-ghost btn-sm">← Volver</a>
          <div>
            <h3>Previsualizar: ${escapeHtml(rifa.nombre)}</h3>
            <p class="text-xs text-ink-600">${esChance ? 'Chance con símbolo' : esNormal ? 'Boletas normales' : '4 Oportunidades'} · ${pagados.length} pagados · Rango ${rifa.rango_min}-${rifa.rango_max}</p>
          </div>
        </div>`;

    if (pagados.length === 0) {
      container.innerHTML += `<div class="empty-state"><div class="icon">📭</div><p>No hay participantes pagados para previsualizar.</p></div>`;
      return;
    }

    if (esChance) {
      container.innerHTML += `<p class="text-sm text-ink-600">El chance con símbolo usa una balotera interna. Puedes probar la balotera directamente.</p></div>`;
      return;
    }

    const rangoLen = String(rifa.rango_max).length;
    const cifrasBal = rangoLen >= 5 ? 5 : rangoLen >= 3 ? 4 : 2;
    const etiquetar = (n) => {
      if (esNormal) return String(n).padStart(2, '0');
      const m = rifa.modalidad_boleta;
      if (m === 'OPORTUNIDADES_4D' || (m === 'CHANCE_INDIVIDUAL' && Number(rifa.cifras || 4) >= 4)) return String(n).padStart(4, '0');
      return String(n).padStart(2, '0');
    };

    const filasRuleta = pagados.map(p => `<li data-numero="${etiquetar(p.numero)}"><span class="mono">#${etiquetar(p.numero)}</span><span>${escapeHtml(p.nombre || '')}</span></li>`).join('');

    container.innerHTML += `
      <div class="flex gap-3 mb-3" style="flex-wrap:wrap;">
        <button class="btn btn-gold" id="btn-preview-ruleta">🎡 Probar Ruleta (${pagados.length} participantes)</button>
        <button class="btn btn-outline" id="btn-preview-balotera">🎱 Probar Balotera (${cifrasBal} cifras)</button>
      </div>
      <div id="area-preview-anim"></div>
    </div>`;

    document.getElementById('btn-preview-ruleta').addEventListener('click', () => {
      const area = document.getElementById('area-preview-anim');
      const participantes = pagados.map(p => ({ numero: p.numero, nombre: p.nombre, label: etiquetar(p.numero) }));
      const ganadorIdx = Math.floor(Math.random() * participantes.length);
      area.innerHTML = `
        <div class="card card-pad">
          <div class="anim-layout">
            <div class="anim-canvas text-center">
              <canvas id="canvas-preview-ruleta" width="360" height="360" style="max-width:100%;"></canvas>
              <p class="text-sm text-ink-600 mt-2">Girando con datos reales de "${escapeHtml(rifa.nombre)}"...</p>
            </div>
            <div class="anim-lista">
              <h4>Participantes (${participantes.length})</h4>
              <ol class="anim-lista-ol">${filasRuleta}</ol>
            </div>
          </div>
        </div>`;
      const rueda = new RuletaCanvas(document.getElementById('canvas-preview-ruleta'), participantes);
      rueda.girarHasta(participantes[ganadorIdx].numero, 4500).then(() => {
        const fila = document.querySelector(`#area-preview-anim [data-numero="${etiquetar(participantes[ganadorIdx].numero)}"]`);
        if (fila) fila.classList.add('ganador');
        toast('Ganador: #' + participantes[ganadorIdx].label + ' — ' + participantes[ganadorIdx].nombre, 'success');
      });
    });

    document.getElementById('btn-preview-balotera').addEventListener('click', () => {
      const area = document.getElementById('area-preview-anim');
      const mapa = new Map();
      pagados.forEach(p => {
        const nums = (p.numeros && p.numeros.length ? p.numeros : [p.numero]);
        nums.forEach(n => { if (!mapa.has(String(n))) mapa.set(String(n), { numero: Number(n), nombre: p.nombre }); }
        );
      });
      const bolitas = [...mapa.values()];
      const ganador = bolitas[Math.floor(Math.random() * bolitas.length)];
      const filasBal = bolitas.map(b => `<li data-numero="${String(b.numero).padStart(cifrasBal, '0')}"><span class="mono">#${String(b.numero).padStart(cifrasBal, '0')}</span><span>${b.nombre}</span></li>`).join('');
      area.innerHTML = `
        <div class="card card-pad">
          <div class="anim-layout">
            <div class="anim-canvas text-center">
              <canvas id="canvas-preview-balotera" width="480" height="420" style="max-width:100%;"></canvas>
              <p class="text-sm text-ink-600 mt-2">Revolviendo ${bolitas.length} boletas reales...</p>
            </div>
            <div class="anim-lista">
              <h4>Boletas pagadas (${bolitas.length})</h4>
              <ol class="anim-lista-ol">${filasBal}</ol>
            </div>
          </div>
        </div>`;
      const canvas = document.getElementById('canvas-preview-balotera');
      const balotera = new BaloteraCanvas(canvas, {
        numeroFinal: String(ganador.numero),
        cifras: cifrasBal,
        colorAcento: '#D4A017',
        bolitas
      });
      balotera.jugar(5000).then(() => {
        const fila = document.querySelector(`#area-preview-anim [data-numero="${String(ganador.numero).padStart(cifrasBal, '0')}"]`);
        if (fila) fila.classList.add('ganador');
        toast('Ganador: #' + String(ganador.numero).padStart(cifrasBal, '0') + ' — ' + ganador.nombre, 'success');
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${escapeHtml(err.message)}</p></div>`;
  }
}

// -------------------------- BALOTERA VIRTUAL (TAREA 4) --------------------------
async function renderBaloteraTab(rifa, box) {
  const ganadores = await api('/rifas/' + rifa.id + '/ganadores');
  const d = await api('/rifas/' + rifa.id + '/dashboard');
  const esChance = modoEsChance(rifa);

  if (rifa.estado === 'sorteada' && ganadores.length) {
    if (esChance) {
      // Resultado final de un chance: se muestran los premios con sus ganadores
      box.innerHTML = `<div class="card card-pad text-center">
        <div style="font-size:44px;">🎰</div>
        <h3 class="mb-2">¡Chance sorteado!</h3>
        ${ganadores.map(g => `<p style="font-size:22px; font-weight:700; color:var(--gold-500);">${escapeHtml(g.premio || 'Premio')}: ${g.simbolo ? ticketDisplay(g.numero, g.simbolo) : g.numero} — ${escapeHtml(g.nombre || 'Sin ganador')}</p>`).join('')}
        <p class="text-xs text-ink-600 mt-2">Semilla verificable: <span class="mono">${ganadores[0].semilla}</span></p>
        <a href="#/rifas/${rifa.id}/historial" class="btn btn-outline btn-sm mt-3">Ver historial</a>
      </div>`;
    } else {
      box.innerHTML = `<div class="card card-pad text-center">
        <div style="font-size:44px;">🎱</div>
        <h3 class="mb-2">¡Esta rifa ya tiene ganador!</h3>
        ${ganadores.map(g => `<p style="font-size:26px; font-weight:700; color:var(--gold-500);">GANADOR: ${fmtNum(rifa, g.numero)} — ${escapeHtml(g.nombre || '')}</p>`).join('')}
        <p class="text-xs text-ink-600 mt-2">Semilla verificable: <span class="mono">${ganadores[0].semilla}</span></p>
        <a href="#/rifas/${rifa.id}/historial" class="btn btn-outline btn-sm mt-3">Ver historial</a>
      </div>`;
    }
    setTimeout(() => confetti({ particleCount: 140, spread: 100, origin: { y: 0.4 } }), 200);
    return;
  }

  if (esChance) {
    box.innerHTML = renderChancePanel(rifa, d);
    const btn = document.getElementById('btn-iniciar-chance');
    if (btn) btn.addEventListener('click', () => iniciarChance(rifa, box));
    return;
  }

  function cifrasPorDefecto(rifa) {
    if (rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES') return 2;
    const digitos = String(rifa.rango_max).length;
    if (digitos >= 5) return 5;
    if (digitos >= 3) return 4;
    return 2;
  }

  if (d.vendidos < rifa.cantidad_max_participantes) {
    const total = rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES'
      ? (100 / nOport(rifa)) : rifa.cantidad_max_participantes;
    box.innerHTML = `
      <div class="card card-pad text-center mb-4">
        <div style="font-size:40px;">🎱</div>
        <h3 class="mb-3">Balotera Virtual</h3>
        <p class="text-sm text-ink-600 mb-1">Quedan <strong>${total - d.vendidos} boletas por vender</strong> (${d.vendidos}/${total}).</p>
        <p class="text-sm mb-3">Puedes <strong>girar la balotera ahora</strong>: participarán solo las boletas ya vendidas (${d.pagados} pagadas). Cuando vendas todo, participan todos los números.</p>
        <button class="btn btn-gold" id="btn-jugar-balotera-pre">🎲 Girar balotera ahora</button>
      </div>`;
    document.getElementById('btn-jugar-balotera-pre').addEventListener('click', () => {
      box.innerHTML = renderBaloteraPanel(rifa, cifrasPorDefecto(rifa));
      document.getElementById('btn-jugar-balotera').addEventListener('click', () => ejecutarBalotera(rifa));
    });
    return;
  }

  box.innerHTML = renderBaloteraPanel(rifa, cifrasPorDefecto(rifa));
  document.getElementById('btn-jugar-balotera').addEventListener('click', () => ejecutarBalotera(rifa));
}

function renderBaloteraPanel(rifa, cifrasPorDefecto) {
  const totalBoletas = rifa.modalidad_boleta === 'CUATRO_OPORTUNIDADES'
    ? Math.floor(100 / nOport(rifa)) : rifa.cantidad_max_participantes;
  const yaVendidas = rifa.vendidos || 0;
  const faltan = totalBoletas - yaVendidas;

  return `
    <div class="card card-pad text-center mb-4">
      <h3 class="mb-2">🎱 Balotera Virtual</h3>
      <p class="text-sm text-ink-600 mb-3">Las bolitas giran ~5 segundos con sonido y revelan el ganador. El resultado queda registrado de forma permanente.</p>
      <div class="flex justify-center gap-3" style="flex-wrap:wrap;">
        <div class="field" style="max-width:200px;">
          <label>Selector de cifras</label>
          <select class="input" id="sel-cifras-balotera">
            <option value="2" ${cifrasPorDefecto === 2 ? 'selected' : ''}>2 cifras (00-99)</option>
            <option value="4" ${cifrasPorDefecto === 4 ? 'selected' : ''}>4 cifras (0000-9999)</option>
            <option value="5" ${cifrasPorDefecto === 5 ? 'selected' : ''}>5 cifras (00000-99999)</option>
          </select>
        </div>
        <div class="field" style="max-width:240px;">
          <label>¿Quién participa?</label>
          <select class="input" id="sel-participantes-balotera">
            <option value="pagados" selected>Solo boletas pagadas (${yaVendidas})</option>
            <option value="todos">Todos los números (${totalBoletas})</option>
          </select>
        </div>
        <div class="field" style="justify-content:flex-end; max-width:220px;">
          <button class="btn btn-gold btn-block" id="btn-jugar-balotera">🎲 Girar balotera</button>
        </div>
      </div>
      ${faltan > 0 ? `<p class="text-xs text-ink-600 mt-2">⚠️ Faltan ${faltan} boletas por vender. Si seleccionas "Todos los números" y cae un número no vendido, podrás hacer revancha.</p>` : ''}
    </div>
    <div id="area-balotera"></div>`;
}

async function ejecutarBalotera(rifa) {
  const area = document.getElementById('area-balotera');
  const cifras = document.getElementById('sel-cifras-balotera').value;
  const modoParticipantes = document.getElementById('sel-participantes-balotera').value || 'pagados';
  if (!confirm('El sorteo quedará registrado de forma permanente y la rifa pasará a estado "Sorteada". ¿Continuar?')) return;

  try {
    // 0) Obtener las boletas reales pagadas para construir las bolitas
    const pagados = (await api('/rifas/' + rifa.id + '/participantes')).filter(p => p.estado_pago === 'pagado');
    const mapa = new Map();
    pagados.forEach(p => {
      const nums = (p.numeros && p.numeros.length ? p.numeros : [p.numero]);
      nums.forEach(n => { if (!mapa.has(String(n))) mapa.set(String(n), { numero: Number(n), nombre: p.nombre }); });
    });
    const bolitas = [...mapa.values()];
    const etiquetar = (n) => String(n).padStart(Number(cifras), '0');

    const filas = pagados.map(p => {
      const nums = (p.numeros && p.numeros.length ? p.numeros : [p.numero]).map(etiquetar);
      return `<li data-numero="${escapeHtml(nums[0])}"><span class="mono">#${escapeHtml(nums.join(', '))}</span><span>${escapeHtml(p.nombre || '')}</span></li>`;
    }).join('');

    const btn = document.getElementById('btn-jugar-balotera');
    if (btn) btn.disabled = true;

    area.innerHTML = `
      <div class="card card-pad">
        <div class="anim-layout">
          <div class="anim-canvas text-center">
            <canvas id="canvas-balotera" width="480" height="420" style="max-width:100%;"></canvas>
            <p class="text-sm text-ink-600 mt-2">Revolviendo ${modoParticipantes === 'todos' ? 'todos los números' : bolitas.length + ' boletas pagadas'}...</p>
          </div>
          <div class="anim-lista">
            <h4>Boletas pagadas (${pagados.length})</h4>
            <ol class="anim-lista-ol">${filas}</ol>
          </div>
        </div>
      </div>`;

    // 1) El backend decide el ganador y lo persiste
    const resultado = await api('/rifas/' + rifa.id + '/balotera', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cifras: Number(cifras), participantes: modoParticipantes })
    });

    // Si no hay ganador (número no vendido con modo "todos")
    if (resultado.sinGanador) {
      if (rifa.revancha_permitida) {
        area.innerHTML = `
          <div class="card card-pad text-center">
            <div style="font-size:40px;">😅</div>
            <h3 class="mb-2">Número sin boleta vendida</h3>
            <p class="text-sm text-ink-600 mb-2">Cayó el número <strong class="mono" style="color:var(--gold-500);">${resultado.numeroDisplay}</strong> pero no tiene boleta vendida.</p>
            <p class="text-sm text-ink-600 mb-3">${escapeHtml(resultado.mensaje)}</p>
            <div class="flex gap-3 justify-center">
              <button class="btn btn-gold" id="btn-revancha-balotera">🔁 Revancha</button>
              <button class="btn btn-outline" id="btn-cancelar-revancha">✖ Cancelar</button>
            </div>
          </div>`;
        document.getElementById('btn-revancha-balotera').addEventListener('click', () => ejecutarBalotera(rifa));
        document.getElementById('btn-cancelar-revancha').addEventListener('click', () => {
          area.innerHTML = '';
          if (btn) btn.disabled = false;
        });
      } else {
        area.innerHTML = `
          <div class="card card-pad text-center">
            <div style="font-size:40px;">😅</div>
            <h3 class="mb-2">Número sin boleta vendida</h3>
            <p class="text-sm text-ink-600 mb-3">Cayó el número <strong class="mono" style="color:var(--gold-500);">${resultado.numeroDisplay}</strong> pero no tiene boleta vendida. Esta rifa <strong>no permite revancha</strong>.</p>
          </div>`;
      }
      if (btn) btn.disabled = false;
      return;
    }

    // 2) Animación visual (bolitas rebotando ~5s + sonido) y revelado
    const canvas = document.getElementById('canvas-balotera');
    const balotera = new BaloteraCanvas(canvas, {
      numeroFinal: resultado.numeroDisplay,
      cifras: resultado.cifras,
      colorAcento: '#D4A017',
      bolitas
    });
    await balotera.jugar(5000);
    balotera.detener();

    // Resaltar la boleta ganadora en la lista
    const filaGanadora = document.querySelector(`#area-balotera [data-numero="${escapeHtml(etiquetar(resultado.numero))}"]`);
    if (filaGanadora) filaGanadora.classList.add('ganador');

    // 3) Popup de resultados OBLIGATORIO (todos los formatos)
    mostrarPopupResultado(rifa, resultado);
    if (btn) btn.disabled = false;
  } catch (err) {
    const btn = document.getElementById('btn-jugar-balotera');
    if (btn) btn.disabled = false;
    area.innerHTML = '';
    toast(err.message, 'error');
  }
}

// ------------------------- PANEL DE CHANCE CON SÍMBOLO -------------------------
function renderChancePanel(rifa, d) {  const sims = (() => { try { return JSON.parse(rifa.simbolos || '[]'); } catch (e) { return []; } })();
  const total = rifa.cantidad_max_participantes;
  const nCifras = [2, 4, 5].includes(Number(rifa.cifras)) ? Number(rifa.cifras) : 4;
  const infoPremios = nCifras === 2
    ? [{ n: rifa.premio1_nombre || 'Premio 1', d: 'las 2 cifras sorteadas' }]
    : nCifras === 5
      ? [
          { n: rifa.premio1_nombre || 'Premio 1', d: '1ª y 2ª cifra' },
          { n: rifa.premio2_nombre || 'Premio 2', d: '2ª y 3ª cifra' },
          { n: rifa.premio3_nombre || 'Premio 3', d: '3ª y 4ª cifra' },
          { n: rifa.premio4_nombre || 'Premio 4', d: '4ª y 5ª cifra' }
        ]
      : [
          { n: rifa.premio1_nombre || 'Premio 1', d: '2 primeras cifras' },
          { n: rifa.premio2_nombre || 'Premio 2', d: 'cifras del medio' },
          { n: rifa.premio3_nombre || 'Premio 3', d: '2 últimas cifras' }
        ];
  return `
    <div class="card card-pad text-center mb-4">
      <h3 class="mb-2">🎰 Sorteo de Chance con Símbolo</h3>
      <p class="text-sm text-ink-600 mb-3">Se sortean <strong>${nCifras} cifras + 1 símbolo</strong>. Los ${infoPremios.length} premios:</p>
      <div class="chance-premios-config mb-3">
        ${infoPremios.map(p => `<span class="chance-premio-chip"><strong>${escapeHtml(p.n)}</strong> · ${p.d}</span>`).join('')}
      </div>
      <p class="text-sm mb-3">Vendidas <strong>${d.vendidos}</strong> de ${total} boletas (${d.pagados} pagadas) · Símbolos: ${sims.join(' ')}</p>
      <p class="text-sm text-ink-600 mb-3">⚠️ Al iniciar el sorteo se <strong>bloquean las ventas</strong> de esta rifa.</p>
      <button class="btn btn-gold" id="btn-iniciar-chance">🎰 Iniciar sorteo</button>
    </div>
    <div id="area-chance"></div>`;
}

async function iniciarChance(rifa, box) {
  const area = document.getElementById('area-chance');
  // Bloquea las ventas al iniciar el sorteo
  if (rifa.estado === 'activa' || rifa.estado === 'borrador') {
    try {
      await api('/rifas/' + rifa.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: 'cerrada' }) });
      rifa.estado = 'cerrada';
      toast('Ventas bloqueadas: el sorteo inició');
    } catch (e) { /* continuar de todas formas */ }
  }
  area.innerHTML = `<div class="card card-pad text-center">
    <h3 class="mb-3">🎰 Sortando chance…</h3>
    <div id="chance-tambos"></div>
    <p class="text-sm text-ink-600 mt-3">Girando tambos…</p>
  </div>`;
  try {
    const resultado = await api('/rifas/' + rifa.id + '/chance-sorteo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    await animarChance4D(resultado, area, rifa);
    // El resultado SIEMPRE se muestra en el popup obligatorio
    mostrarPopupResultado(rifa, resultado);
  } catch (err) {
    area.innerHTML = '';
    toast(err.message, 'error');
  }
}

// Animación de los tambos (N cifras + símbolo) ~5s con sonido WebAudio.
// El resultado ya lo decidió el backend (sorteo persistido); aquí es visual.
function animarChance(resultado, area, rifa) {
  const sims = (() => {
    try { const s = JSON.parse(rifa.simbolos || '[]'); return Array.isArray(s) && s.length ? s : ['😁', '🥰', '😎', '🔥', '🍀', '⭐', '❤️', '💰', '🎯', '🏆']; }
    catch (e) { return ['😁', '🥰', '😎', '🔥', '🍀', '⭐', '❤️', '💰', '🎯', '🏆']; }
  })();
  const digitos = String(resultado.numero).split('');
  const DIGITOS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const columnas = digitos.map(d => ({ vals: DIGITOS, fin: d }));
  columnas.push({ vals: sims, fin: resultado.simbolo });
  const cellH = 68, ciclos = 8, duracion = 5000;
  const cont = document.getElementById('chance-tambos');
  const sonidos = (window.crearSonidos) ? crearSonidos() : null;

  cont.innerHTML = `<div class="chance-tambos-row">
    ${columnas.map((c, i) => {
      const esSimbolo = i === columnas.length - 1;
      const posEnCiclo = c.vals.indexOf(c.fin);
      const idxFinal = ciclos * c.vals.length + posEnCiclo;
      const strip = Array.from({ length: idxFinal + 3 }, (_, k) => c.vals[k % c.vals.length]);
      return `<div class="tambo ${esSimbolo ? 'tambo-simbolo' : ''}">
        <div class="tambo-viewport"><div class="tambo-strip" data-final="${idxFinal * cellH}">
          ${strip.map(v => `<div class="tambo-celda">${escapeHtml(v)}</div>`).join('')}
        </div></div>
        <div class="tambo-label">${esSimbolo ? 'SÍMBOLO' : String(i + 1)}</div>
      </div>`;
    }).join('')}
  </div>`;

  return new Promise((resolve) => {
    const strips = [...cont.querySelectorAll('.tambo-strip')];
    const inicio = performance.now();
    let ultimoTick = 0;
    const paso = (ahora) => {
      const t = Math.min(1, (ahora - inicio) / duracion);
      const ease = 1 - Math.pow(1 - t, 3);
      strips.forEach(st => {
        const fin = Number(st.dataset.final);
        st.style.transform = `translateY(${Math.round(-fin * ease)}px)`;
      });
      if (sonidos && ahora - ultimoTick > 95) { sonidos.rebote(); ultimoTick = ahora; }
      if (t < 1) requestAnimationFrame(paso);
      else {
        if (sonidos) sonidos.ding();
        resolve();
      }
    };
    requestAnimationFrame(paso);
  });
}

// Animación de 4 baloteras independientes (B1..BN) + símbolo, revelado secuencial.
// Reemplaza los "tambos" verticales con 4 tanques por dígito para el chance.
function animarChance4D(resultado, area, rifa) {
  const sims = (() => {
    try { const s = JSON.parse(rifa.simbolos || '[]'); return Array.isArray(s) && s.length ? s : ['😁', '🥰', '😎', '🔥', '🍀', '⭐', '❤️', '💰', '🎯', '🏆']; }
    catch (e) { return ['😁', '🥰', '😎', '🔥', '🍀', '⭐', '❤️', '💰', '🎯', '🏆']; }
  })();
  const cont = document.getElementById('chance-tambos');
  if (!cont || !window.Balotera4D) return animarChance(resultado, area, rifa);
  const digitos = String(resultado.numero).split('');
  const b4d = new Balotera4D(cont, {
    digitos,
    simbolo: resultado.simbolo,
    simbolos: sims,
    colorAcento: '#D4A017'
  });
  return b4d.jugar();
}

// ---------- POPUP DE RESULTADOS (OBLIGATORIO para todos los formatos) ----------
// Sin botón ✕ ni cierre por clic fuera: solo "Aceptar" (y revancha si aplica)
// para garantizar que el resultado del sorteo se revise en pantalla.
function mostrarPopupResultado(rifa, resultado) {
  const esChance = modoEsChance(rifa);
  let contenido = '';

  if (esChance) {
    const premios = resultado.premios || [];
    contenido = `
      <div class="modal__header" style="justify-content:center;"><h3>🎰 RESULTADO DEL CHANCE</h3></div>
      <div class="popup-cifras">
        ${String(resultado.numero).split('').map(d => `<span class="popup-cifra">${d}</span>`).join('')}
        <span class="popup-simbolo">${escapeHtml(resultado.simbolo)}</span>
      </div>
      <p class="text-sm text-ink-600 mt-2 text-center">Semilla: <span class="mono">${resultado.semilla}</span></p>
      <div class="popup-premios">
        ${premios.filter(p => p.sorteado).map(p => `
          <div class="premio-card premio-click ${p.ganador ? 'premio-ganador' : 'premio-vacio'}" data-tipo="${escapeHtml(p.tipo)}" data-numero="${String(p.numero).padStart(2, '0')}" data-simbolo="${escapeHtml(resultado.simbolo)}">
            <div class="premio-nombre">${escapeHtml(p.nombre || 'Premio')}</div>
            <div class="premio-numero">${String(p.numero).padStart(2, '0')} ${escapeHtml(resultado.simbolo)}</div>
            ${p.ganador
              ? `<div class="premio-winner"><strong>${escapeHtml(p.ganador.nombre)}</strong><br><span>📞 ${escapeHtml(p.ganador.telefono || '—')}</span></div>`
              : `<div class="premio-sin">😕 SIN GANADOR</div>`}
            <div class="premio-boletas" id="boletas-${escapeHtml(p.tipo)}" hidden></div>
            <div class="premio-vermas">Ver boletas ganadoras ▾</div>
          </div>`).join('')}
      </div>`;
  } else {
    contenido = `
      <div class="modal__header" style="justify-content:center;"><h3>🏆 RESULTADO DE LA BALOTERA</h3></div>
      <div class="popup-cifras" style="gap:6px;">
        <span class="popup-cifra popup-cifra-grande">${resultado.numeroDisplay}</span>
      </div>
      <div class="popup-winner">
        <div style="font-size:44px;">🎊</div>
        <div>
          <div class="premio-nombre">${escapeHtml(rifa.producto || 'Premio')}</div>
          <strong style="font-size:24px;">${escapeHtml(resultado.ganador.nombre)}</strong><br>
          <span>📞 ${escapeHtml(resultado.ganador.telefono || '—')}</span><br>
          <span class="text-sm">Boleta: ${(resultado.ganador.numeros || []).map(escapeHtml).join(', ')}</span>
        </div>
      </div>
      <p class="text-sm text-ink-600 mt-2 text-center">🔐 Semilla: <span class="mono">${resultado.semilla}</span></p>
      <p class="text-xs text-ink-600 text-center">Verificar en: <a href="${window.location.origin}/public/rifa/${rifa.id}" target="_blank" style="color:var(--gold-500);">Página de verificación</a></p>`;
  }

  const sinGanador = esChance ? (resultado.premios || []).filter(p => p.sorteado && !p.ganador) : [];
  const puedeRevancha = esChance && rifa.revancha_permitida && sinGanador.length > 0;

  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop modal-popup">
      <div class="modal modal-popup-box">
        ${contenido}
        <div class="popup-actions">
          ${puedeRevancha ? `<button class="btn btn-gold" id="btn-popup-revancha">🔁 Revancha (${sinGanador.length} sin ganador)</button>` : ''}
          <button class="btn btn-outline" id="btn-popup-acta">📄 Descargar Acta (PDF)</button>
          <button class="btn btn-primary" id="btn-popup-aceptar">✔ Aceptar</button>
        </div>
      </div>
    </div>`;

  confetti({ particleCount: 220, spread: 110, origin: { y: 0.45 }, colors: ['#D4A017', '#E8B923', '#0B1229'] });

  const revancha = async () => {
    const pendientes = (resultado.premios || []).filter(p => p.sorteado && !p.ganador).map(p => p.tipo);
    try {
      const nuevo = await api('/rifas/' + rifa.id + '/chance-sorteo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ premios: pendientes })
      });
      mostrarPopupResultado(rifa, nuevo);
    } catch (e) { toast(e.message, 'error'); }
  };
  const finalizar = async () => {
    if (esChance && rifa.estado !== 'sorteada') {
      try { await api('/rifas/' + rifa.id + '/chance-finalizar', { method: 'POST' }); } catch (e) { /* ya sorteada */ }
    }
    cerrarModal();
    window.location.reload();
  };

  const btnRev = document.getElementById('btn-popup-revancha');
  if (btnRev) btnRev.addEventListener('click', revancha);
  document.getElementById('btn-popup-acta').addEventListener('click', () => descargarActaPDF(rifa, resultado));
  document.getElementById('btn-popup-aceptar').addEventListener('click', finalizar);

  // Tarjetas de ganadores clicables: listan las boletas ganadoras (símbolo + dueño)
  if (esChance) {
    const tarjetas = root.querySelectorAll('.premio-click');
    tarjetas.forEach(card => {
      card.addEventListener('click', async () => {
        const box = card.querySelector('.premio-boletas');
        const vermas = card.querySelector('.premio-vermas');
        if (!box) return;
        if (!box.hidden) { box.hidden = true; if (vermas) vermas.textContent = 'Ver boletas ganadoras ▾'; return; }
        if (box.dataset.cargado) { box.hidden = false; if (vermas) vermas.textContent = 'Ocultar ▴'; return; }
        box.innerHTML = '<p class="text-xs text-ink-600">Cargando boletas…</p>';
        box.hidden = false; if (vermas) vermas.textContent = 'Ocultar ▴';
        try {
          const boletas = await api('/rifas/' + rifa.id + '/boletas-chance');
          const num = Number(card.dataset.numero), sim = card.dataset.simbolo;
          const gan = (boletas || []).filter(b => Number(b.numero) === num && b.simbolo === sim && b.estado === 'vendida');
          box.dataset.cargado = '1';
          if (!gan.length) {
            box.innerHTML = '<p class="text-xs text-ink-600">Sin boletas vendidas para este premio.</p>';
          } else {
            box.innerHTML = `<ul class="lista-boletas-gan">
              ${gan.map(b => `<li><span class="mono">${escapeHtml(ticketDisplay(b.numero, b.simbolo))}</span><span>${escapeHtml(b.nombre || '—')}</span></li>`).join('')}
            </ul>`;
          }
        } catch (e) {
          box.innerHTML = '<p class="text-xs text-ink-600">No se pudieron cargar las boletas.</p>';
        }
      });
    });
  }
}

// Etiqueta de boleta chance en el frontend ("47 😁")
function ticketDisplay(numero, simbolo) {
  return String(numero).padStart(2, '0') + (simbolo ? ' ' + simbolo : '');
}

// Genera y descarga el acta del sorteo como PDF (sin librerías externas)
function descargarActaPDF(rifa, resultado) {
  const esChance = modoEsChance(rifa);
  let subtitulos = 'Rifa: ' + rifa.nombre + '\n';
  subtitulos += 'Producto: ' + (rifa.producto || 'N/A') + '\n';
  subtitulos += 'Sorteo: ' + (rifa.fecha_sorteo || 'N/A') + '\n';
  subtitulos += 'Acta: ' + new Date().toLocaleString('es-CO');

  let encabezados = ['#', 'Detalle'];
  let anchoColumnas = [50, 515];
  let filas = [];

  if (esChance) {
    filas.push(['', 'RESULTADO: ' + resultado.numero + ' ' + resultado.simbolo]);
    filas.push(['', 'Semilla: ' + resultado.semilla]);
    (resultado.premios || []).forEach(p => {
      if (!p.sorteado) return;
      const num = String(p.numero).padStart(2, '0');
      const ganador = p.ganador ? p.ganador.nombre : 'SIN GANADOR';
      filas.push([num, (p.nombre || 'Premio') + ': ' + ganador]);
    });
  } else {
    filas.push(['', 'BOLETA GANADORA: ' + resultado.numeroDisplay]);
    if (resultado.ganador) filas.push(['', 'Ganador: ' + resultado.ganador.nombre]);
    filas.push(['', 'Semilla: ' + resultado.semilla]);
  }
  filas.push(['', '']);
  filas.push(['', 'El ganador debe reclamar presentando la boleta original']);
  filas.push(['', 'y su documento de identidad.']);

  const bytes = crearPDF({
    titulo: 'ACTA DE SORTEO - RIFAS SYC',
    subtitulo: subtitulos,
    encabezados: encabezados,
    filas: filas,
    anchoColumnas: anchoColumnas
  });
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'acta-sorteo-' + rifa.id + '.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// PDF multipágina con tablas (Helvetica, WinAnsi). Devuelve Uint8Array.
function crearPDF(opts) {
  const { titulo, subtitulo, encabezados, filas, anchoColumnas } = opts;
  const ML = 40, TOP = 790, BOT = 50, LH = 14, PW = 595;
  const CW = PW - 80;

  const WINANSI = {
    0x20AC:0x80, 0x201A:0x82, 0x201E:0x84, 0x2026:0x85,
    0x2020:0x86, 0x2021:0x87, 0x2039:0x8B, 0x2018:0x91,
    0x2019:0x92, 0x201C:0x93, 0x201D:0x94, 0x2022:0x95,
    0x2013:0x96, 0x2014:0x97, 0x203A:0x9B, 0x0160:0x8A,
    0x0152:0x8C, 0x017D:0x8E, 0x0161:0x9A, 0x0153:0x9C,
    0x017E:0x9E, 0x0178:0x9F, 0x02C6:0x88, 0x02DC:0x98,
    0x2122:0x99
  };

  const toWinAnsi = (txt) => {
    const bytes = [];
    for (const ch of String(txt)) {
      const cp = ch.codePointAt(0);
      if (cp === 40) { bytes.push(0x5C, 0x28); }
      else if (cp === 41) { bytes.push(0x5C, 0x29); }
      else if (cp === 92) { bytes.push(0x5C, 0x5C); }
      else if (WINANSI[cp] !== undefined) { bytes.push(WINANSI[cp]); }
      else if (cp <= 0xFF) { bytes.push(cp); }
      else { bytes.push(0x3F); }
    }
    return bytes;
  };

  let curY = TOP;
  const pageStreams = [];
  let curBuf = [];

  const textAt = (x, y, size, txt) => {
    const b = [];
    b.push(...strToBytes('BT /F1 ' + size + ' Tf ' + x + ' ' + y + ' Td ('));
    b.push(...toWinAnsi(txt));
    b.push(...strToBytes(') Tj ET\n'));
    return b;
  };

  const lineAt = (x1, y1, x2, y2) => {
    return strToBytes('q 0.5 w ' + x1 + ' ' + y1 + ' m ' + x2 + ' ' + y2 + ' l S Q\n');
  };

  const strToBytes = (s) => {
    const b = [];
    for (let i = 0; i < s.length; i++) b.push(s.charCodeAt(i) & 0xFF);
    return b;
  };

  const newPage = () => {
    if (curBuf.length) pageStreams.push(curBuf);
    curBuf = [];
    curY = TOP;
  };

  const checkPage = (need) => {
    if (curY < BOT + need) newPage();
  };

  // Titulo
  if (titulo) {
    checkPage(LH * 2);
    curBuf.push(...textAt(ML, curY, 16, titulo));
    curY -= LH + 4;
  }
  if (subtitulo) {
    subtitulo.split('\n').forEach(l => {
      checkPage(LH);
      curBuf.push(...textAt(ML, curY, 10, l));
      curY -= LH;
    });
    curY -= 6;
  }

  // Encabezados de tabla
  if (encabezados && encabezados.length) {
    const widths = anchoColumnas || encabezados.map(() => CW / encabezados.length);
    checkPage(LH * 3);

    let x = ML;
    encabezados.forEach((h, i) => {
      curBuf.push(...textAt(x, curY, 8, h.toUpperCase()));
      x += widths[i];
    });
    curY -= LH;
    curBuf.push(...lineAt(ML, curY + 3, ML + CW, curY + 3));
    curY -= 6;

    // Filas
    (filas || []).forEach(f => {
      checkPage(LH);
      let rx = ML;
      f.forEach((c, i) => {
        const maxChars = Math.floor(widths[i] / 5.5);
        const txt = String(c || '').substring(0, maxChars);
        curBuf.push(...textAt(rx, curY, 9, txt));
        rx += widths[i];
      });
      curY -= LH;
    });
  }

  if (curBuf.length) pageStreams.push(curBuf);

  // --- Construir PDF multipágina ---
  let oid = 3;
  const objs = {
    1: strToBytes('<< /Type /Catalog /Pages 2 0 R >>'),
    2: null,
    3: strToBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  };

  const pageIds = [];
  pageStreams.forEach(sc => {
    oid++;
    const contentId = oid;
    objs[contentId] = strToBytes('<< /Length ' + sc.length + ' >>\nstream\n');
    objs[contentId] = objs[contentId].concat(sc, strToBytes('\nendstream'));
    oid++;
    const pageId = oid;
    objs[pageId] = strToBytes('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + contentId + ' 0 R >>');
    pageIds.push(pageId);
  });

  objs[2] = strToBytes('<< /Type /Pages /Kids [' + pageIds.map(p => p + ' 0 R').join(' ') + '] /Count ' + pageIds.length + ' >>');

  // Concatenar todo
  const pdfParts = [strToBytes('%PDF-1.4\n')];
  const offsets = [0];
  for (let i = 1; i <= oid; i++) {
    offsets[i] = pdfParts.reduce((a, p) => a + p.length, 0);
    pdfParts.push(strToBytes(i + ' 0 obj\n'));
    pdfParts.push(objs[i]);
    pdfParts.push(strToBytes('\nendobj\n'));
  }
  const xrefPos = pdfParts.reduce((a, p) => a + p.length, 0);
  pdfParts.push(strToBytes('xref\n0 ' + (oid + 1) + '\n0000000000 65535 f \n'));
  for (let i = 1; i <= oid; i++) {
    pdfParts.push(strToBytes(String(offsets[i]).padStart(10, '0') + ' 00000 n \n'));
  }
  pdfParts.push(strToBytes('trailer\n<< /Size ' + (oid + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF'));

  const totalLen = pdfParts.reduce((a, p) => a + p.length, 0);
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const part of pdfParts) {
    result.set(part, pos);
    pos += part.length;
  }
  return result;
}

// Exporta un reporte completo de la rifa como PDF
async function exportarReportePDF(rifaId) {
  const rifa = await api('/rifas/' + rifaId);
  const participantes = await api('/rifas/' + rifaId + '/participantes');
  const ganadores = await api('/rifas/' + rifaId + '/ganadores');

  const pagados = participantes.filter(p => p.estado_pago === 'pagado');
  const pendientes = participantes.filter(p => p.estado_pago === 'pendiente');
  const recaudado = pagados.length * Number(rifa.precio_boleta || 0);

  const subtitulos = [
    'Rifa: ' + rifa.nombre,
    'Producto: ' + (rifa.producto || 'N/A'),
    'Estado: ' + rifa.estado + ' | Sorteo: ' + (rifa.fecha_sorteo || 'No programada'),
    'Rango: ' + rifa.rango_min + ' - ' + rifa.rango_max + ' | Precio: $' + Number(rifa.precio_boleta || 0).toLocaleString('es-CO'),
    'Vendidas: ' + pagados.length + ' | Pendientes: ' + pendientes.length + ' | Recaudado: $' + recaudado.toLocaleString('es-CO'),
    'Generado: ' + new Date().toLocaleString('es-CO')
  ].join('\n');

  const encabezados = ['Numero', 'Nombre'];
  const anchoColumnas = [80, 485];
  const filasPagados = pagados.map(p => [String(p.numero ?? ''), (p.nombre || '').substring(0, 60)]);

  const bytes = crearPDF({
    titulo: 'REPORTE DE RIFA - RIFAS SYC',
    subtitulo: subtitulos,
    encabezados: encabezados,
    filas: filasPagados,
    anchoColumnas: anchoColumnas
  });
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'reporte-rifa-' + rifa.id + '-' + rifa.nombre.replace(/[^a-zA-Z0-9]/g, '_') + '.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// -------------------------- TAB WHATSAPP (TAREA 5) --------------------------------
async function renderWhatsappTab(rifa, box) {
  const [plantillas, participantes] = await Promise.all([
    api('/plantillas'),
    api('/rifas/' + rifa.id + '/participantes')
  ]);
  const todos = participantes;
  const pagados = participantes.filter(p => p.estado_pago === 'pagado');
  const pendientes = participantes.filter(p => p.estado_pago === 'pendiente');
  const sinTelefono = pagados.filter(p => !p.telefono);
  const conTelefono = pagados.filter(p => p.telefono);

  box.innerHTML = `
    <div class="grid-2">
      <div class="card card-pad">
        <h3 class="mb-3">📲 Conexión de WhatsApp</h3>
        <p class="text-sm text-ink-600 mb-3">Conecta tu propio WhatsApp escaneando el QR. No pagas API de Meta.</p>
        <div id="wa-estado"><p class="text-sm">Verificando estado…</p></div>
        <div id="wa-qr-box" style="display:none;" class="text-center mt-3">
          <img id="wa-qr-img" style="width:220px; max-width:100%; border:1px solid var(--line); border-radius:12px; padding:10px; background:#fff;">
          <p class="text-xs text-ink-600 mt-2">Escanea con WhatsApp → Ajustes → Dispositivos vinculados</p>
        </div>
        <div class="flex gap-2 mt-4">
          <button class="btn btn-gold btn-sm" id="btn-wa-conectar">🔗 Conectar WhatsApp</button>
          <button class="btn btn-danger btn-sm" id="btn-wa-desconectar" style="display:none;">⛔ Desconectar</button>
        </div>
      </div>

      <div class="card card-pad">
        <h3 class="mb-3">📨 Envío masivo personalizado</h3>
        <div class="field">
          <label>Plantilla de mensaje</label>
          <select class="input" id="sel-plantilla-envio">
            ${plantillas.map(t => `<option value="${t.id}">${escapeHtml(t.nombre)}</option>`).join('')}
          </select>
          <span class="hint">Variables: {{nombre}}, {{numeros}}, {{rifa_nombre}}, {{link_pago}}, {{fecha_sorteo}}. Edítalas en <a href="#/plantillas">💬 Plantillas WhatsApp</a>.</span>
        </div>
        <div class="field">
          <label>Enviar a</label>
          <select class="input" id="sel-destino-envio">
            <option value="pagados">Pagados con teléfono (${conTelefono.length})</option>
            <option value="pendientes">Pendientes de pago (${pendientes.length})</option>
            <option value="todos-pagados">Todos los pagados (${pagados.length})</option>
            <option value="sin-telefono">Pagados sin teléfono (${sinTelefono.length})</option>
            <option value="todos">Todos los participantes (${todos.length})</option>
            <option value="seleccion">Solo seleccionados (marca abajo)</option>
          </select>
        </div>
        <div id="lista-compradores" class="wa-lista" style="display:none;">
          ${pagados.map(c => `
            <label class="wa-buyer">
              <input type="checkbox" value="${c.id}">
              <span><strong>${escapeHtml(c.nombre)}</strong> · ${mostrarNumerosBoleta(rifa, c)}</span>
              ${c.telefono ? '' : '<em class="text-xs" style="color:var(--red-500);"> sin teléfono</em>'}
            </label>`).join('') || '<p class="text-sm text-ink-600">Sin compradores pagados.</p>'}
        </div>
        <div class="flex gap-2 mt-3" style="flex-wrap:wrap;">
          <button class="btn btn-gold btn-sm" id="btn-enviar-wa">📨 Enviar mensaje 1 a 1</button>
          <button class="btn btn-outline btn-sm" id="btn-enlace-grupo">👥 Crear enlace para grupo</button>
        </div>
        <p class="text-xs text-ink-600 mt-3">⏱️ Se envía <strong>1 mensaje cada 5 segundos</strong> y se reintenta hasta 2 veces si falla (anti-spam).</p>
      </div>
    </div>

    <div class="card card-pad mt-4">
      <div class="flex justify-between items-center mb-3">
        <h3 style="margin:0;">🕓 Log de envíos</h3>
        <div id="wa-job" class="text-sm"></div>
      </div>
      <div id="wa-log" style="overflow-x:auto;"><p class="text-sm text-ink-600">Cargando…</p></div>
    </div>`;

  const estadoBox = document.getElementById('wa-estado');
  const qrBox = document.getElementById('wa-qr-box');
  const btnConectar = document.getElementById('btn-wa-conectar');
  const btnDesconectar = document.getElementById('btn-wa-desconectar');

  function badgeWa(status) {
    const map = {
      connected: ['✅', 'Conectado', 'badge-pagado'],
      disconnected: ['❌', 'Desconectado', 'badge-cerrada'],
      connecting: ['⏳', 'Conectando…', 'badge-pendiente'],
      waiting_scan: ['📷', 'Esperando escaneo…', 'badge-pendiente'],
      authenticated: ['🔐', 'Autenticado…', 'badge-pendiente'],
      error: ['⚠️', 'Error de conexión', 'badge-cerrada']
    };
    const [emoji, texto, cls] = map[status] || ['?', status, 'badge-borrador'];
    return `<span class="badge ${cls}">${emoji} ${texto}</span>`;
  }

  async function actualizarEstado(mostrarQr = false) {
    try {
      const est = await api('/whatsapp/status');
      estadoBox.innerHTML = `<p class="text-sm">Estado: ${badgeWa(est.status)}</p>` +
        (est.phone ? `<p class="text-sm mt-1">📱 WhatsApp: <strong>${escapeHtml(est.phone)}</strong></p>` : '');
      const conectado = est.status === 'connected';
      btnConectar.style.display = conectado ? 'none' : 'inline-flex';
      btnDesconectar.style.display = conectado ? 'inline-flex' : 'none';

      if (est.status === 'waiting_scan') {
        qrBox.style.display = 'block';
        try {
          const r = await api('/whatsapp/qr');
          const img = document.getElementById('wa-qr-img');
          if (img && img.src !== r.qr) img.src = r.qr;
        } catch (e) { /* aún no hay QR */ }
      } else {
        qrBox.style.display = 'none';
      }
      return est.status;
    } catch (e) {
      estadoBox.innerHTML = `<p class="text-sm">⚠️ ${escapeHtml(e.message)}</p>`;
      return null;
    }
  }

  function pollEstado(hastaConectado = false) {
    detenerPolling();
    state.waPoll = setInterval(async () => {
      const s = await actualizarEstado(true);
      if (hastaConectado && s === 'connected') detenerPolling();
    }, 2500);
  }

  btnConectar.addEventListener('click', async () => {
    btnConectar.disabled = true;
    btnConectar.innerHTML = '<span class="spinner"></span> Conectando…';
    try {
      await api('/whatsapp/conectar', { method: 'POST' });
      await actualizarEstado(true);
      pollEstado(true);
      toast('Escanea el QR con tu WhatsApp');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btnConectar.disabled = false;
      btnConectar.innerHTML = '🔗 Conectar WhatsApp';
    }
  });

  btnDesconectar.addEventListener('click', async () => {
    await api('/whatsapp/desconectar', { method: 'POST' });
    detenerPolling();
    await actualizarEstado();
    toast('WhatsApp desconectado');
  });

  document.getElementById('sel-destino-envio').addEventListener('change', (e) => {
    document.getElementById('lista-compradores').style.display = e.target.value === 'seleccion' ? 'block' : 'none';
  });

  document.getElementById('btn-enviar-wa').addEventListener('click', async () => {
    const btnEnviar = document.getElementById('btn-enviar-wa');
    const plantillaId = document.getElementById('sel-plantilla-envio').value;
    const destino = document.getElementById('sel-destino-envio').value;
    let participanteIds = destino;
    if (destino === 'seleccion') {
      participanteIds = [...document.querySelectorAll('#lista-compradores input:checked')].map(c => Number(c.value));
      if (participanteIds.length === 0) { toast('Marca al menos un comprador', 'error'); return; }
    }
    btnEnviar.disabled = true;
    btnEnviar.textContent = 'Enviando...';
    try {
      const r = await api(`/rifas/${rifa.id}/whatsapp/enviar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participante_ids: participanteIds, plantilla_id: Number(plantillaId) })
      });
      toast(`📨 Envío iniciado a ${r.job.total} persona(s). Revisa el log.`);
      iniciarPollJob();
    } catch (e) { toast(e.message, 'error'); }
    finally { btnEnviar.disabled = false; btnEnviar.textContent = '📨 Enviar mensajes'; }
  });

  document.getElementById('btn-enlace-grupo').addEventListener('click', async () => {
    const plantillaId = document.getElementById('sel-plantilla-envio').value;
    try {
      const r = await api(`/rifas/${rifa.id}/whatsapp/enlace-grupo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plantilla_id: Number(plantillaId) })
      });
      abrirModal(`
        <div class="modal__header"><h3>👥 Texto para el grupo / difusión</h3><button class="btn btn-ghost btn-sm" onclick="cerrarModal()">✕</button></div>
        <div class="modal__body">
          <p class="text-sm text-ink-600 mb-2">Copia este texto y pégalo en tu grupo o lista de difusión de WhatsApp:</p>
          <textarea class="input" id="texto-grupo" rows="12" readonly>${escapeHtml(r.texto)}</textarea>
          <div class="modal__footer" style="padding:0; margin-top:14px;">
            <button class="btn btn-ghost" onclick="cerrarModal()">Cerrar</button>
            <button class="btn btn-gold" onclick="copiarTexto('texto-grupo')">📋 Copiar</button>
          </div>
        </div>`);
    } catch (e) { toast(e.message, 'error'); }
  });

  async function cargarLog() {
    try {
      const { job, logs } = await api(`/rifas/${rifa.id}/whatsapp/envios`);
      const jobBox = document.getElementById('wa-job');
      if (job && job.enCurso) {
        jobBox.innerHTML = `<span class="badge badge-pendiente">Enviando ${job.enviados + job.fallidos}/${job.total}…</span>`;
      } else if (job) {
        jobBox.innerHTML = `<span class="badge badge-pagado">✔ Envío terminado: ${job.enviados} enviados · ${job.fallidos} fallidos</span>`;
      } else {
        jobBox.innerHTML = '';
      }
      const logBox = document.getElementById('wa-log');
      logBox.innerHTML = logs.length === 0
        ? '<p class="text-sm text-ink-600">Aún no hay envíos registrados.</p>'
        : `<table class="tbl">
             <thead><tr><th>Hora</th><th>Destinatario</th><th>Teléfono</th><th>Estado</th><th>Intentos</th><th>Error</th></tr></thead>
             <tbody>
               ${logs.map(l => `
                 <tr>
                   <td class="text-xs">${fmtFecha(l.fecha)}</td>
                   <td>${escapeHtml(l.nombre || '—')}</td>
                   <td class="mono text-xs">${escapeHtml(l.telefono || '—')}</td>
                   <td>${l.estado === 'enviado' ? '<span class="badge badge-pagado">✔ Enviado</span>' : '<span class="badge badge-cerrada">✖ ' + escapeHtml(l.estado) + '</span>'}</td>
                   <td class="text-xs">${l.intentos}</td>
                   <td class="text-xs" style="color:var(--red-500);">${escapeHtml(l.error || '')}</td>
                 </tr>`).join('')}
             </tbody>
           </table>`;
    } catch (e) { /* errores de polling se ignoran */ }
  }

  function iniciarPollJob() {
    detenerPolling();
    cargarLog();
    state.waJobPoll = setInterval(async () => {
      try {
        const { job } = await api(`/rifas/${rifa.id}/whatsapp/envios`);
        cargarLog();
        if (!job || !job.enCurso) detenerPolling();
      } catch (e) { detenerPolling(); }
    }, 3000);
  }

  await actualizarEstado(true);
  cargarLog();
  const est = await api('/whatsapp/status');
  if (est.status !== 'connected') pollEstado(false);
}

async function copiarTexto(idTextarea) {
  const ta = document.getElementById(idTextarea);
  if (!ta) return;
  try {
    await navigator.clipboard.writeText(ta.value);
    toast('📋 Copiado al portapapeles');
  } catch (e) {
    ta.select(); ta.setSelectionRange(0, 99999);
    document.execCommand('copy');
    toast('📋 Copiado');
  }
}

// -------------------------- TAB HISTORIAL --------------------------------
async function renderHistorialTab(rifa, box) {
  const [historial, ganadores] = await Promise.all([
    api('/rifas/' + rifa.id + '/historial'), api('/rifas/' + rifa.id + '/ganadores')
  ]);

  let ganadorHtml = '';
  if (rifa.estado === 'sorteada' && ganadores.length) {
    ganadorHtml = `<div class="card card-pad text-center mb-4" style="background:linear-gradient(135deg,var(--navy-950),var(--navy-800)); color:#fff;">
      <div style="font-size:44px;">🏆</div>
      <h3 style="color:var(--gold-400);">Ganador de "${escapeHtml(rifa.nombre)}"</h3>
      ${ganadores.map(g => `<p style="font-size:22px; font-weight:700;">#${fmtNum(rifa, g.numero)} — ${escapeHtml(g.nombre || '')}</p>`).join('')}
      <p class="text-xs mt-2" style="color:rgba(255,255,255,.6)">Modalidad: ${ganadores[0].modalidad} · Semilla: <span class="mono">${ganadores[0].semilla}</span></p>
    </div>`;
    setTimeout(() => confetti({ particleCount: 140, spread: 100, origin: { y: 0.4 } }), 200);
  }

  box.innerHTML = ganadorHtml + `
    <div class="card">
      ${historial.length === 0 ? `<div class="empty-state"><div class="icon">🕓</div><p>Sin eventos aún</p></div>` : `
      <table class="tbl">
        <thead><tr><th>Fecha y Hora</th><th>Acción</th><th>Detalle</th><th>Quién</th></tr></thead>
        <tbody>${historial.map(h => `<tr><td class="text-xs" style="white-space:nowrap;">${fmtFecha(h.fecha)} ${h.fecha ? (h.fecha.length > 10 ? h.fecha.slice(11, 16) : '') : ''}</td><td><strong>${h.accion}</strong></td><td class="text-sm">${escapeHtml(h.detalle)}</td><td class="text-sm">${escapeHtml(h.usuario || '—')}</td></tr>`).join('')}</tbody>
      </table>`}
    </div>`;
}

// ================================================================================
// VISTA: EMPRESA
// ================================================================================
async function vistaEmpresa() {
  const empresa = await api('/empresa');
  state.empresa = empresa;
  document.getElementById('topbar-actions').innerHTML = '';
  document.getElementById('view-container').innerHTML = `
    <form id="form-empresa" class="card card-pad" style="max-width:520px; margin:0 auto;">
      <h3 class="mb-4">Perfil de tu empresa</h3>
      <div class="field"><label>Nombre de la empresa</label><input class="input" name="nombre_empresa" value="${escapeHtml(empresa.nombre_empresa || '')}"></div>
      <div class="field"><label>Teléfono de contacto</label><input class="input" name="telefono" value="${escapeHtml(empresa.telefono || '')}"></div>
      <div class="field">
        <label>Logo</label>
        <div class="upload-box" id="box-logo">🏢 Haz clic para subir el logo<br>${empresa.logo_path ? `<img class="upload-preview" src="${empresa.logo_path}">` : ''}</div>
        <input type="file" name="logo" accept="image/*" style="display:none">
      </div>
      <button type="submit" class="btn btn-gold btn-block mt-3">Guardar cambios</button>
    </form>`;

  const box = document.getElementById('box-logo');
  const input = document.querySelector('input[name=logo]');
  box.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (!input.files[0]) return;
    let img = box.querySelector('img');
    if (!img) { img = document.createElement('img'); img.className = 'upload-preview'; box.appendChild(img); }
    img.src = URL.createObjectURL(input.files[0]);
  });

  document.getElementById('form-empresa').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(e.target);
      const actualizado = await apiForm('/empresa', fd, 'PUT');
      state.empresa = actualizado;
      document.getElementById('empresa-nombre-sidebar').textContent = actualizado.nombre_empresa;
      toast('Datos de empresa guardados');
    } catch (err) {
      if (!String(err.message).includes('Sesión expirada')) toast(err.message, 'error');
    }
  });
}

// ================================================================================
// VISTA: PLANTILLAS DE WHATSAPP
// ================================================================================
const VARIABLES_PLANTILLA = [
  ['{{nombre}}', 'Nombre del comprador'],
  ['{{numeros}}', 'Su(s) número(s), ej: 05, 12, 34, 99'],
  ['{{rifa_nombre}}', 'Nombre de la rifa'],
  ['{{link_pago}}', 'Link público de la rifa'],
  ['{{link_rifa}}', 'Link público de la rifa'],
  ['{{fecha_sorteo}}', 'Fecha del sorteo'],
  ['{{valor_boleta}}', 'Valor de la boleta en COP'],
  ['{{numeros_disponibles}}', 'Cuántas boletas quedan'],
  ['{{numeros_disponibles_lista}}', 'Primeros números disponibles']
];

async function vistaPlantillas() {
  document.getElementById('topbar-actions').innerHTML = `<button class="btn btn-gold" onclick="modalPlantilla(null)">➕ Nueva plantilla</button>`;
  await renderListaPlantillas();
}

async function renderListaPlantillas() {
  const container = document.getElementById('view-container');
  const plantillas = await api('/plantillas');

  container.innerHTML = `
    <div class="card card-pad mb-4">
      <h3 class="mb-2">💬 Plantillas de WhatsApp</h3>
      <p class="text-sm text-ink-600">Mensajes personalizados que se envían a cada comprador. Puedes usar emojis y variables <strong>{{variable}}</strong>:</p>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap;">
        ${VARIABLES_PLANTILLA.map(([v, d]) => `<span class="badge badge-borrador" title="${escapeHtml(d)}">${v}</span>`).join('')}
      </div>
    </div>
    <div class="rifas-grid">
      ${plantillas.map(t => `
        <div class="card card-pad">
          <div class="flex justify-between items-center mb-2">
            <h3 style="margin:0; font-size:16px;">${escapeHtml(t.nombre)}</h3>
            <span class="text-xs text-ink-600">#${t.id}</span>
          </div>
          <pre class="wa-plantilla-preview">${escapeHtml(t.contenido)}</pre>
          <div class="flex gap-2 mt-3">
            <button class="btn btn-outline btn-sm" onclick="modalPlantilla(${t.id})">✏️ Editar</button>
            <button class="btn btn-danger btn-sm" onclick="eliminarPlantilla(${t.id})">🗑️</button>
          </div>
        </div>`).join('')}
    </div>`;
}

async function modalPlantilla(id) {
  const t = id ? await api('/plantillas/' + id) : null;
  abrirModal(`
    <div class="modal__header"><h3>${t ? 'Editar plantilla' : 'Nueva plantilla'}</h3><button class="btn btn-ghost btn-sm" onclick="cerrarModal()">✕</button></div>
    <div class="modal__body">
      <div class="field">
        <label>Nombre de la plantilla</label>
        <input class="input" id="pl-nombre" value="${t ? escapeHtml(t.nombre) : ''}" placeholder="Ej: Confirmación de Compra">
      </div>
      <div class="field">
        <label>Mensaje (con emojis y variables)</label>
        <textarea class="input" id="pl-contenido" rows="10" placeholder="🎉 ¡FELICIDADES {{nombre}}! 🎉&#10;Tus números: {{numeros}}&#10;Rifa: {{rifa_nombre}}&#10;Sorteo: {{fecha_sorteo}}&#10;Ver boleta: {{link_pago}}">${t ? escapeHtml(t.contenido) : ''}</textarea>
        <span class="hint">Variables: ${VARIABLES_PLANTILLA.map(([v]) => v).join(' · ')}</span>
      </div>
      <div class="modal__footer" style="padding:0; margin-top:14px;">
        <button class="btn btn-ghost" onclick="cerrarModal()">Cancelar</button>
        <button class="btn btn-gold" onclick="guardarPlantilla(${t ? t.id : 'null'})">Guardar</button>
      </div>
    </div>`);
}

async function guardarPlantilla(id) {
  const nombre = document.getElementById('pl-nombre').value.trim();
  const contenido = document.getElementById('pl-contenido').value;
  if (!nombre || !contenido) { toast('Nombre y mensaje son obligatorios', 'error'); return; }
  try {
    if (id) await api('/plantillas/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, contenido }) });
    else await api('/plantillas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, contenido }) });
    cerrarModal();
    toast('Plantilla guardada');
    vistaPlantillas();
  } catch (e) { toast(e.message, 'error'); }
}

async function eliminarPlantilla(id) {
  if (!confirm('¿Eliminar esta plantilla?')) return;
  try {
    await api('/plantillas/' + id, { method: 'DELETE' });
    toast('Plantilla eliminada');
    vistaPlantillas();
  } catch (e) { toast(e.message, 'error'); }
}

// ================================================================================
// PÁGINA PÚBLICA (/public/rifa/:id) — transparencia total, sin sidebar
// ================================================================================
async function renderPaginaPublica(id) {
  document.querySelector('.app-shell').style.display = 'none';
  const data = await api('/public/rifa/' + id);
  const { rifa, numeros, boletas, ganadores, empresa } = data;
  const esChance = modoEsChance(rifa);
  const total = esChance ? (boletas || []).length : rifa.cantidad_max_participantes;
  const vendidos = (esChance ? boletas : numeros).filter(n => n.estado !== 'libre').length;
  const porcentaje = total ? Math.min(100, Math.round((vendidos / total) * 100)) : 0;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="public-hero">
      ${empresa.logo_path ? `<img class="logo" src="${empresa.logo_path}">` : `<h2 style="color:#fff;">${escapeHtml(empresa.nombre_empresa)}</h2>`}
      <span class="badge badge-${rifa.estado}">${BADGE_ESTADO[rifa.estado]}</span>
      <h1 style="margin:10px 0 4px;">${escapeHtml(rifa.nombre)}</h1>
      <p style="color:rgba(255,255,255,.7)">${escapeHtml(rifa.producto)} · ${fmtCOP(rifa.valor_boleta)} · Sorteo ${fmtFecha(rifa.fecha_sorteo)}${rifa.hora_sorteo ? ' ' + rifa.hora_sorteo : ''}</p>
    </div>
    <div class="content" style="max-width:820px;">
      ${ganadores.length ? `
        <div class="card card-pad text-center mb-4" style="background:var(--gold-100); border-color:var(--gold-500);">
          <div style="font-size:36px;">🏆</div>
          <h3>¡Ya tenemos ganador!</h3>
          ${ganadores.map(g => `<p style="font-size:20px; font-weight:700;">#${fmtNum(rifa, g.numero)} — ${escapeHtml(g.nombre || '')}</p>`).join('')}
          <p class="text-xs text-ink-600">Semilla verificable: <span class="mono">${ganadores[0].semilla}</span></p>
        </div>` : ''}
      ${rifa.imagen_producto ? `<img src="${rifa.imagen_producto}" style="width:100%; max-height:320px; object-fit:cover; border-radius:16px; margin-bottom:16px;">` : ''}
      <p class="text-sm text-ink-600 mb-3">${escapeHtml(rifa.descripcion || '')}</p>
      <div class="card card-pad mb-4">
        <div class="flex justify-between mb-2"><strong>${esChance ? 'Boletas vendidas' : 'Números vendidos'}</strong><span>${porcentaje}%</span></div>
        <div class="progress-track mb-3"><div class="progress-fill" style="width:${porcentaje}%"></div></div>
        <p class="text-xs text-ink-600">🔒 Por transparencia, mostramos el nombre de cada comprador pero <strong>ocultamos su cédula</strong>.</p>
      </div>
      ${esChance ? `
        <h3 class="mb-3">Lista de boletas (número + símbolo)</h3>
        <div class="numeros-grid">
          ${(boletas || []).map(b => `<div class="numero-chip ${b.estado}" title="${escapeHtml(b.label)}"><span>${escapeHtml(b.label)}</span>${b.nombre ? `<span class="who">${escapeHtml(b.nombre.split(' ')[0])}</span>` : ''}</div>`).join('')}
        </div>` : `
        <h3 class="mb-3">Lista de números</h3>
        <div class="numeros-grid">
          ${numeros.map(n => `<div class="numero-chip ${n.estado}"><span>${fmtNum(rifa, n.numero)}</span>${n.nombre ? `<span class="who">${escapeHtml(n.nombre.split(' ')[0])}</span>` : ''}</div>`).join('')}
        </div>`}
      <p class="text-center text-xs text-ink-600 mt-4 mb-4">Generado con Rifas SYC · ${DISCLAIMER}</p>
    </div>`);
}

// ================================================================================
// ARRANQUE
// ================================================================================
// ------------------------------- INIT -----------------------------------------
// ================================================================================
// VISTA: CHANGELOG / HISTORIAL DE VERSIONES
// ================================================================================

async function renderChangelog(container) {
  container.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando historial...</p></div>';
  try {
    const data = await api('/changelog');
    const { versionActual, changelog } = data;

    container.innerHTML = `
      <div style="margin-bottom:24px;">
        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <span class="badge badge-activa" style="font-size:14px; padding:6px 14px;">v${escapeHtml(versionActual)}</span>
          <span class="text-sm text-ink-600">Versión actual</span>
        </div>
      </div>

      <div class="changelog-timeline">
        ${changelog.map(v => `
          <div class="changelog-version">
            <div class="changelog-header">
              <div class="changelog-dot"></div>
              <div>
                <h3 style="margin:0;">v${escapeHtml(v.version)}</h3>
                <span class="text-xs text-ink-600">${escapeHtml(v.fecha)}</span>
              </div>
            </div>
            <div class="changelog-body">
              ${v.categorias.map(cat => `
                <div class="changelog-cat">
                  <h4 style="margin:0 0 8px;">${cat.icono} ${escapeHtml(cat.nombre)}</h4>
                  <ul style="margin:0; padding-left:18px;">
                    ${cat.items.map(item => `<li style="margin-bottom:4px;">${escapeHtml(item)}</li>`).join('')}
                  </ul>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function initApp() {
  try {
    const empresa = await api('/empresa');
    state.empresa = empresa;
    document.getElementById('empresa-nombre-sidebar').textContent = empresa.nombre_empresa || 'Colombia';
  } catch (e) {}
  // Tooltip en nav-links: muestra texto completo al pasar el mouse
  document.querySelectorAll('.nav-link').forEach(link => {
    const span = link.querySelector('span');
    if (span) link.title = span.textContent.trim();
  });
  router();
  suscribirPush();
}

(async function init() {
  // Página pública no requiere auth
  if (window.location.pathname.startsWith('/public/rifa/')) {
    const id = window.location.pathname.split('/').pop();
    await renderPaginaPublica(id);
    return;
  }
  // Verificar sesión existente
  const sesionValida = await verificarSesion();
  if (sesionValida) {
    mostrarApp();
    initApp();
  } else {
    mostrarLogin();
  }
})();

// ----------------------- PUSH NOTIFICATIONS -----------------------------------
async function suscribirPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api('/push/vapid-key');
    const convertedKey = urlBase64ToUint8Array(publicKey);
    const existing = await reg.pushManager.getSubscription();
    if (existing) return; // ya suscrito
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: convertedKey });
    const { endpoint, keys } = sub.toJSON();
    await api('/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth }) });
  } catch (e) { /* usuario denegó o error de red */ }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// ================================================================================
// VISTA: PANEL DE CONTROL (ADMIN DASHBOARD)
// ================================================================================

async function renderAdminDashboard(container) {
  container.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando panel de control...</p></div>';
  try {
    const d = await api('/admin/dashboard');
    const e = d.empresa || {};

    const fmtPct = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0;

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
        <div>
          <h2 style="margin:0;">📊 Panel de Control</h2>
          <p class="text-sm text-ink-600">Resumen completo del sistema Rifas SYC</p>
        </div>
      </div>

      <!-- EMPRESA + RESUMEN GENERAL -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px;">
        <div class="card card-pad">
          <h3 class="mb-3">🏢 Mi Empresa</h3>
          <div style="display:flex; align-items:center; gap:16px;">
            ${e.logo_path
              ? `<img src="${escapeHtml(e.logo_path)}" style="width:60px; height:60px; border-radius:12px; object-fit:cover; border:2px solid var(--line);">`
              : `<div style="width:60px; height:60px; border-radius:12px; background:linear-gradient(135deg,#D4A017,#F2C14E); display:flex; align-items:center; justify-content:center; font-size:28px;">🎲</div>`
            }
            <div>
              <p style="font-size:18px; font-weight:700; margin:0;">${escapeHtml(e.nombre_empresa || 'Sin configurar')}</p>
              <p class="text-sm text-ink-600" style="margin:2px 0 0;">📱 ${escapeHtml(e.telefono || 'Sin teléfono')}</p>
              <p class="text-sm text-ink-600" style="margin:2px 0 0;">🎨 ${escapeHtml(e.color_marca || '#D4A017')}</p>
            </div>
          </div>
        </div>

        <div class="card card-pad">
          <h3 class="mb-3">📈 Resumen General</h3>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div style="padding:12px; background:rgba(212,160,23,0.1); border-radius:10px; text-align:center;">
              <p style="font-size:28px; font-weight:800; color:var(--gold-500); margin:0;">${d.totalRifas}</p>
              <p class="text-xs text-ink-600" style="margin:4px 0 0;">Total Rifas</p>
            </div>
            <div style="padding:12px; background:rgba(34,197,94,0.1); border-radius:10px; text-align:center;">
              <p style="font-size:28px; font-weight:800; color:#22c55e; margin:0;">${d.rifasActivas}</p>
              <p class="text-xs text-ink-600" style="margin:4px 0 0;">Activas</p>
            </div>
            <div style="padding:12px; background:rgba(59,130,246,0.1); border-radius:10px; text-align:center;">
              <p style="font-size:28px; font-weight:800; color:#3b82f6; margin:0;">${d.totalParticipantes}</p>
              <p class="text-xs text-ink-600" style="margin:4px 0 0;">Participantes</p>
            </div>
            <div style="padding:12px; background:rgba(245,158,11,0.1); border-radius:10px; text-align:center;">
              <p style="font-size:22px; font-weight:800; color:#f59e0b; margin:0;">${fmtCOP(d.recaudado)}</p>
              <p class="text-xs text-ink-600" style="margin:4px 0 0;">Recaudado</p>
            </div>
          </div>
          <div style="margin-top:12px; display:flex; gap:12px;">
            <div style="flex:1; padding:8px; background:rgba(34,197,94,0.08); border-radius:8px; text-align:center;">
              <span style="font-size:16px; font-weight:700; color:#22c55e;">${d.pagados}</span>
              <span class="text-xs text-ink-600"> pagados</span>
            </div>
            <div style="flex:1; padding:8px; background:rgba(245,158,11,0.08); border-radius:8px; text-align:center;">
              <span style="font-size:16px; font-weight:700; color:#f59e0b;">${d.pendientes}</span>
              <span class="text-xs text-ink-600"> pendientes</span>
            </div>
          </div>
        </div>
      </div>

      <!-- RIFAS -->
      <div class="card card-pad mb-4">
        <h3 class="mb-3">🎯 Rifas (${d.rifas.length})</h3>
        ${d.rifas.length === 0
          ? '<p class="text-sm text-ink-600">No hay rifas creadas aún.</p>'
          : `<div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:13px;">
              <thead>
                <tr style="border-bottom:2px solid var(--line); text-align:left;">
                  <th style="padding:10px 12px;">Nombre</th>
                  <th style="padding:10px 12px;">Producto</th>
                  <th style="padding:10px 12px;">Modalidad</th>
                  <th style="padding:10px 12px;">Estado</th>
                  <th style="padding:10px 12px;">Valor</th>
                  <th style="padding:10px 12px;">Vendidos</th>
                  <th style="padding:10px 12px;">Sorteo</th>
                </tr>
              </thead>
              <tbody>
                ${d.rifas.map(r => {
                  const total = r.cantidad_max_participantes || r.vendidos || 0;
                  const pct = fmtPct(r.vendidos, total);
                  const estadoCls = r.estado === 'activa' ? 'badge-pagado' : r.estado === 'sorteada' ? 'badge-borrador' : 'badge-cerrada';
                  return `<tr style="border-bottom:1px solid var(--line); cursor:pointer;" onclick="window.location.hash='#/rifas/${r.id}/resumen'">
                    <td style="padding:10px 12px; font-weight:600;">${escapeHtml(r.nombre)}</td>
                    <td style="padding:10px 12px;">${escapeHtml(r.producto)}</td>
                    <td style="padding:10px 12px;"><span class="text-xs">${escapeHtml(r.modalidad_boleta)}</span></td>
                    <td style="padding:10px 12px;"><span class="badge ${estadoCls}">${r.estado}</span></td>
                    <td style="padding:10px 12px;">${fmtCOP(r.valor_boleta)}</td>
                    <td style="padding:10px 12px;">
                      <span style="font-weight:600;">${r.vendidos || 0}</span><span class="text-ink-600">/${total}</span>
                      <span class="text-xs text-ink-600"> (${pct}%)</span>
                    </td>
                    <td style="padding:10px 12px; font-size:12px;">${r.fecha_sorteo ? fmtFecha(r.fecha_sorteo) : '—'}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>`
        }
      </div>

      <!-- PARTICIPANTES RECIENTES -->
      <div class="card card-pad mb-4">
        <h3 class="mb-3">👥 Participantes Recientes</h3>
        ${d.participantesRecientes.length === 0
          ? '<p class="text-sm text-ink-600">No hay participantes registrados aún.</p>'
          : `<div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:13px;">
              <thead>
                <tr style="border-bottom:2px solid var(--line); text-align:left;">
                  <th style="padding:10px 12px;">Nombre</th>
                  <th style="padding:10px 12px;">Cédula</th>
                  <th style="padding:10px 12px;">Teléfono</th>
                  <th style="padding:10px 12px;">Rifa</th>
                  <th style="padding:10px 12px;">Pago</th>
                  <th style="padding:10px 12px;">Fecha</th>
                </tr>
              </thead>
              <tbody>
                ${d.participantesRecientes.map(p => {
                  const pagoCls = p.estado_pago === 'pagado' ? 'badge-pagado' : 'badge-cerrada';
                  return `<tr style="border-bottom:1px solid var(--line);">
                    <td style="padding:10px 12px; font-weight:600;">${escapeHtml(p.nombre)}</td>
                    <td style="padding:10px 12px; font-size:12px; font-family:monospace;">${escapeHtml(p.cedula || '—')}</td>
                    <td style="padding:10px 12px; font-size:12px; font-family:monospace;">${escapeHtml(p.telefono || '—')}</td>
                    <td style="padding:10px 12px; font-size:12px;">${escapeHtml(p.rifa_nombre)}</td>
                    <td style="padding:10px 12px;"><span class="badge ${pagoCls}">${p.estado_pago}</span></td>
                    <td style="padding:10px 12px; font-size:12px;">${fmtFecha(p.fecha_registro)}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>`
        }
      </div>

      <!-- USUARIOS + LOGS -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="card card-pad">
          <h3 class="mb-3">👤 Usuarios (${d.usuarios.length})</h3>
          ${d.usuarios.map(u => `
            <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--line);">
              <div style="width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg,#D4A017,#F2C14E); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:#0B1229; flex-shrink:0;">${(u.nombre || u.usuario || '?')[0].toUpperCase()}</div>
              <div style="min-width:0;">
                <p style="font-weight:600; margin:0; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(u.nombre)}</p>
                <p class="text-xs text-ink-600" style="margin:0;">${escapeHtml(u.usuario)} · ${escapeHtml(u.rol)}</p>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="card card-pad">
          <h3 class="mb-3">📋 Actividad Reciente</h3>
          ${d.logsRecientes.length === 0
            ? '<p class="text-sm text-ink-600">Sin actividad registrada.</p>'
            : d.logsRecientes.map(l => `
              <div style="padding:6px 0; border-bottom:1px solid var(--line);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-weight:600; font-size:13px;">${escapeHtml(l.accion)}</span>
                  <span class="text-xs text-ink-600">${fmtFecha(l.fecha)}</span>
                </div>
                <p class="text-xs text-ink-600" style="margin:2px 0 0;">${escapeHtml(l.rifa_nombre || '')} ${escapeHtml(l.detalle || '')}</p>
              </div>
            `).join('')
          }
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${escapeHtml(err.message)}</p></div>`;
  }
}

// ================================================================================
// VISTA: ADMINISTRACIÓN DE USUARIOS
// ================================================================================

async function renderAdminUsuarios(container) {
  container.innerHTML = '<div class="empty-state"><div class="icon">⏳</div><p>Cargando usuarios...</p></div>';
  try {
    const [usuarios, sesiones] = await Promise.all([api('/usuarios'), api('/sesiones')]);
    const esSuperAdmin = state.usuario && state.usuario.rol === 'super_admin';

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
        <div>
          <h2 style="margin:0;">👥 Usuarios del sistema</h2>
          <p class="text-sm text-ink-600">${usuarios.length} usuario(s) registrado(s) · ${sesiones.length} sesión(es) activa(s)</p>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-gold" id="btn-crear-usuario">➕ Crear usuario</button>
          <button class="btn btn-outline" id="btn-ver-sesiones">🔐 Sesiones activas (${sesiones.length})</button>
        </div>
      </div>

      <div class="card" style="overflow-x:auto;">
        <div class="table-wrap">
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <thead>
            <tr style="border-bottom:2px solid var(--line); text-align:left;">
              <th style="padding:12px 16px;">Usuario</th>
              <th style="padding:12px 16px;">Nombre</th>
              <th style="padding:12px 16px;">Email</th>
              <th style="padding:12px 16px;">Rol</th>
              <th style="padding:12px 16px;">Estado</th>
              <th style="padding:12px 16px;">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${usuarios.map(u => `
              <tr style="border-bottom:1px solid var(--line);">
                <td style="padding:12px 16px; font-weight:600;">${escapeHtml(u.usuario)}</td>
                <td style="padding:12px 16px;">${escapeHtml(u.nombre)}</td>
                <td style="padding:12px 16px; color:var(--ink-600);">${escapeHtml(u.email || '—')}</td>
                <td style="padding:12px 16px;">
                  <select class="input" style="width:auto; padding:4px 8px; font-size:12px;"
                    onchange="cambiarRolUsuario(${u.id}, this.value)"
                    ${u.rol === 'super_admin' && !esSuperAdmin ? 'disabled' : ''}>
                    <option value="vendedor" ${u.rol === 'vendedor' ? 'selected' : ''}>Vendedor</option>
                    <option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>Admin</option>
                    <option value="super_admin" ${u.rol === 'super_admin' ? 'selected' : ''}>Super Admin</option>
                  </select>
                </td>
                <td style="padding:12px 16px;">
                  <span style="display:inline-flex; align-items:center; gap:4px;">
                    <span style="width:8px; height:8px; border-radius:50%; background:${u.sesionActiva ? '#22c55e' : '#94a3b8'}; display:inline-block;"></span>
                    ${u.sesionActiva ? 'En línea' : 'Fuera'}
                  </span>
                </td>
                <td style="padding:12px 16px;">
                  <div style="display:flex; gap:6px;">
                    <button class="btn btn-ghost btn-sm" onclick="editarUsuarioModal(${u.id}, '${escapeHtml(u.usuario)}', '${escapeHtml(u.nombre)}', '${escapeHtml(u.email || '')}')">✏️</button>
                    <button class="btn btn-ghost btn-sm" onclick="resetPasswordModal(${u.id}, '${escapeHtml(u.usuario)}')">🔑</button>
                    ${esSuperAdmin && u.rol !== 'super_admin' && u.usuario !== state.usuario.usuario
                      ? `<button class="btn btn-ghost btn-sm" style="color:#ef4444;" onclick="eliminarUsuario(${u.id}, '${escapeHtml(u.usuario)}')">🗑️</button>`
                      : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        </div>
      </div>

      <div id="admin-sesiones-panel" style="display:none; margin-top:24px;"></div>

      ${esSuperAdmin ? `
      <div class="card" style="margin-top:24px; padding:20px;">
        <h3 style="margin:0 0 8px;">💾 Respaldo de datos</h3>
        <p class="text-sm text-ink-600" style="margin:0 0 16px;">Exporta o restaura la base de datos completa. Útil para migrar datos entre servidores o recuperar después de un despliegue.</p>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="descargarAutenticada('/api/backup','backup-rifas.zip')">💾 Descargar backup (.zip)</button>
          <button class="btn btn-outline btn-sm" onclick="abrirRestoreModal()">📂 Restaurar backup</button>
        </div>
      </div>
      ` : ''}
    `;

    document.getElementById('btn-crear-usuario').addEventListener('click', crearUsuarioModal);
    document.getElementById('btn-ver-sesiones').addEventListener('click', () => toggleSesionesPanel(sesiones));
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function toggleSesionesPanel(sesiones) {
  const panel = document.getElementById('admin-sesiones-panel');
  if (!panel) return;
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  const esSuperAdmin = state.usuario && state.usuario.rol === 'super_admin';
  panel.style.display = '';
  panel.innerHTML = `
    <div class="card">
      <h3 style="margin:0 0 12px;">🔐 Sesiones activas (${sesiones.length})</h3>
      <div class="table-wrap">
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid var(--line); text-align:left;">
            <th style="padding:8px 12px;">Token</th>
            <th style="padding:8px 12px;">Usuario</th>
            <th style="padding:8px 12px;">Rol</th>
            <th style="padding:8px 12px;">Expira</th>
            <th style="padding:8px 12px;">Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${sesiones.map(s => `
            <tr style="border-bottom:1px solid var(--line);">
              <td style="padding:8px 12px; font-family:monospace;">${escapeHtml(s.token)}</td>
              <td style="padding:8px 12px;">${escapeHtml(s.nombre)} ${s.esActual ? '<span class="text-xs" style="color:var(--gold-400);">(tú)</span>' : ''}</td>
              <td style="padding:8px 12px;"><span class="badge">${escapeHtml(s.rol)}</span></td>
              <td style="padding:8px 12px; font-size:12px;">${new Date(s.expiraEn).toLocaleString('es-CO')}</td>
              <td style="padding:8px 12px;">
                ${!s.esActual && esSuperAdmin
                  ? `<button class="btn btn-ghost btn-sm" style="color:#ef4444;" onclick="cerrarSesionRemota('${escapeHtml(s.token)}')">🚪 Cerrar</button>`
                  : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>
    </div>
  `;
}

function crearUsuarioModal() {
  abrirModal(`
    <div class="modal__header"><h3>➕ Crear usuario</h3><button class="btn btn-ghost btn-sm" onclick="cerrarModal()">✕</button></div>
    <form id="form-crear-usuario" class="modal__body">
      <label class="input-label">Nombre completo *</label>
      <input class="input" name="nombre" required placeholder="Ej: Juan Pérez">
      <label class="input-label">Usuario *</label>
      <input class="input" name="usuario" required placeholder="Ej: juan123">
      <label class="input-label">Email</label>
      <input class="input" name="email" type="email" placeholder="juan@ejemplo.com">
      <label class="input-label">Contraseña *</label>
      <input class="input" name="password" type="password" required minlength="6" placeholder="Mínimo 6 caracteres">
      <label class="input-label">Rol</label>
      <select class="input" name="rol">
        <option value="vendedor">Vendedor</option>
        <option value="admin">Admin</option>
        ${state.usuario && state.usuario.rol === 'super_admin' ? '<option value="super_admin">Super Admin</option>' : ''}
      </select>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
        <button type="button" class="btn btn-ghost" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-gold">Crear usuario</button>
      </div>
    </form>
  `);
  document.getElementById('form-crear-usuario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/usuarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: fd.get('nombre'), usuario: fd.get('usuario'),
          email: fd.get('email'), password: fd.get('password'), rol: fd.get('rol')
        })
      });
      toast('Usuario creado');
      cerrarModal();
      renderAdminUsuarios(document.getElementById('view-container'));
    } catch (err) { toast(err.message, 'error'); }
  });
}

function editarUsuarioModal(id, usuario, nombre, email) {
  abrirModal(`
    <div class="modal__header"><h3>✏️ Editar usuario "${escapeHtml(usuario)}"</h3><button class="btn btn-ghost btn-sm" onclick="cerrarModal()">✕</button></div>
    <form id="form-editar-usuario" class="modal__body">
      <label class="input-label">Nombre</label>
      <input class="input" name="nombre" value="${escapeHtml(nombre)}">
      <label class="input-label">Email</label>
      <input class="input" name="email" type="email" value="${escapeHtml(email)}">
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
        <button type="button" class="btn btn-ghost" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-gold">Guardar</button>
      </div>
    </form>
  `);
  document.getElementById('form-editar-usuario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/usuarios/' + id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: fd.get('nombre'), email: fd.get('email') })
      });
      toast('Usuario actualizado');
      cerrarModal();
      renderAdminUsuarios(document.getElementById('view-container'));
    } catch (err) { toast(err.message, 'error'); }
  });
}

function resetPasswordModal(id, usuario) {
  abrirModal(`
    <div class="modal__header"><h3>🔑 Cambiar contraseña de "${escapeHtml(usuario)}"</h3><button class="btn btn-ghost btn-sm" onclick="cerrarModal()">✕</button></div>
    <form id="form-reset-pw" class="modal__body">
      <label class="input-label">Nueva contraseña *</label>
      <input class="input" name="password" type="password" required minlength="6" placeholder="Mínimo 6 caracteres">
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
        <button type="button" class="btn btn-ghost" onclick="cerrarModal()">Cancelar</button>
        <button type="submit" class="btn btn-gold">Cambiar contraseña</button>
      </div>
    </form>
  `);
  document.getElementById('form-reset-pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/usuarios/' + id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: fd.get('password') })
      });
      toast('Contraseña actualizada');
      cerrarModal();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function eliminarUsuario(id, usuario) {
  if (!confirm(`¿Eliminar el usuario "${usuario}"? Se cerrarán todas sus sesiones.`)) return;
  try {
    await api('/usuarios/' + id, { method: 'DELETE' });
    toast('Usuario eliminado');
    renderAdminUsuarios(document.getElementById('view-container'));
  } catch (err) { toast(err.message, 'error'); }
}

async function cambiarRolUsuario(id, nuevoRol) {
  try {
    await api('/usuarios/' + id + '/rol', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rol: nuevoRol })
    });
    toast('Rol actualizado');
  } catch (err) { toast(err.message, 'error'); renderAdminUsuarios(document.getElementById('view-container')); }
}

async function cerrarSesionRemota(tokenPrefix) {
  if (!confirm('¿Cerrar esta sesión remotamente?')) return;
  try {
    await api('/sesiones/' + tokenPrefix, { method: 'DELETE' });
    toast('Sesión cerrada');
    renderAdminUsuarios(document.getElementById('view-container'));
  } catch (err) { toast(err.message, 'error'); }
}

// ---------------------------- RESTORE .DB -----------------------------------

function abrirRestoreModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div style="position:fixed; inset:0; z-index:90; background:rgba(5,10,25,0.7); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; padding:16px;" onclick="if(event.target===this)cerrarRestoreModal()">
      <div style="width:100%; max-width:440px; background:#16213F; border:1px solid #22315A; border-radius:18px; padding:28px 26px;">
        <h3 style="color:#fff; font-size:20px; font-weight:800; margin-bottom:4px;">📂 Restaurar base de datos</h3>
        <p style="color:rgba(255,255,255,0.55); font-size:13px; margin-bottom:16px;">Sube un archivo <code>.zip</code> (backup completo con imágenes) o <code>.db</code> (solo base de datos).</p>
        <div style="padding:16px; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.3); border-radius:10px; margin-bottom:16px;">
          <p style="color:#fca5a5; font-size:13px; margin:0;">⚠️ <strong>Atención:</strong> Esta acción sobreescribirá TODOS los datos actuales. Se cerrarán las sesiones activas. Se recomienda hacer un backup primero.</p>
        </div>
        <div id="restore-drop-zone" style="border:2px dashed rgba(255,255,255,0.2); border-radius:12px; padding:32px 16px; text-align:center; cursor:pointer; transition:border-color 0.2s;" onclick="document.getElementById('restore-file-input').click()" ondragover="event.preventDefault(); this.style.borderColor='#D4A017'" ondragleave="this.style.borderColor='rgba(255,255,255,0.2)'" ondrop="event.preventDefault(); this.style.borderColor='rgba(255,255,255,0.2)'; handleRestoreFile(event.dataTransfer.files[0])">
          <p style="color:rgba(255,255,255,0.6); font-size:14px; margin:0;">Arrastra un archivo <strong>.zip</strong> o <strong>.db</strong> aquí</p>
          <input type="file" id="restore-file-input" accept=".db,.zip" style="display:none;" onchange="handleRestoreFile(this.files[0])">
        </div>
        <div id="restore-file-info" style="display:none; margin-top:12px; padding:10px 14px; background:rgba(34,197,94,0.12); border:1px solid rgba(34,197,94,0.3); border-radius:10px; color:#86efac; font-size:13px;"></div>
        <div id="restore-progress" style="display:none; margin-top:12px;">
          <div style="height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
            <div id="restore-progress-bar" style="height:100%; width:0%; background:linear-gradient(90deg,#D4A017,#F2C14E); border-radius:3px; transition:width 0.3s;"></div>
          </div>
          <p id="restore-progress-text" style="color:rgba(255,255,255,0.5); font-size:12px; margin:6px 0 0; text-align:center;"></p>
        </div>
        <div style="display:flex; gap:10px; margin-top:18px;">
          <button onclick="cerrarRestoreModal()" style="flex:1; padding:12px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:10px; color:#fff; font-size:14px; font-weight:600; cursor:pointer;">Cancelar</button>
          <button id="restore-btn-confirm" onclick="ejecutarRestore()" disabled style="flex:1; padding:12px; background:linear-gradient(135deg,#D4A017,#F2C14E); border:none; border-radius:10px; color:#0B1229; font-size:14px; font-weight:700; cursor:pointer; opacity:0.5;">Restaurar</button>
        </div>
      </div>
    </div>`;
}

let restoreFile = null;

function handleRestoreFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.db') && !file.name.endsWith('.zip')) {
    toast('Solo se permiten archivos .db o .zip', 'error');
    return;
  }
  restoreFile = file;
  const info = document.getElementById('restore-file-info');
  const size = file.size < 1024 * 1024
    ? (file.size / 1024).toFixed(1) + ' KB'
    : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
  info.innerHTML = `📄 <strong>${file.name}</strong> (${size})`;
  info.style.display = 'block';
  document.getElementById('restore-btn-confirm').disabled = false;
  document.getElementById('restore-btn-confirm').style.opacity = '1';
}

async function ejecutarRestore() {
  if (!restoreFile) return;
  if (!confirm('⚠️ ¿Estás SEGURO de restaurar? Se sobreescribirán todos los datos actuales.')) return;

  const btn = document.getElementById('restore-btn-confirm');
  const progress = document.getElementById('restore-progress');
  const bar = document.getElementById('restore-progress-bar');
  const text = document.getElementById('restore-progress-text');

  btn.disabled = true;
  btn.textContent = 'Restaurando...';
  progress.style.display = 'block';
  bar.style.width = '30%';
  text.textContent = 'Subiendo archivo...';

  try {
    const fd = new FormData();
    fd.append('backup', restoreFile);

    bar.style.width = '60%';
    text.textContent = 'Reemplazando base de datos...';

    const res = await fetch('/api/restore', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('rifassyc_token') || '') },
      body: fd
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al restaurar');

    bar.style.width = '100%';
    text.textContent = '✅ Restaurado correctamente. Recargando...';

    setTimeout(() => { location.reload(); }, 1500);
  } catch (err) {
    toast('Error: ' + err.message, 'error');
    bar.style.width = '100%';
    bar.style.background = '#ef4444';
    text.textContent = '❌ ' + err.message;
    btn.disabled = false;
    btn.textContent = 'Restaurar';
  }
}

function cerrarRestoreModal() {
  restoreFile = null;
  document.getElementById('modal-root').innerHTML = '';
}

