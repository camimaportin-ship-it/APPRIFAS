// frontend/src/views/rifaDetalle.js — Corte real Fase — vistaDetalleRifa + renderResumen modular
// Extraído de app.js:1241-1412. Imports puros; funciones de dependencias pasadas vía deps o desde app.js globals.

import { fmtCOP, fmtFecha, escapeHtml } from '../utils/format.js';
import { modoEsChance, nOport } from '../utils/format.js'; // asumen exportados en format.js
import { BADGE_ESTADO } from '../utils/constants.js';

export async function vistaDetalleRifaModular(id, tab, deps = {}) {
  const W = typeof window !== 'undefined' ? window : {};
  const api = deps.api || W.api;
  const toast = deps.toast || W.toast;
  const moverACarpeta = deps.moverACarpeta || W.moverACarpeta;
  const clonarRifa = deps.clonarRifa || W.clonarRifa;
  const eliminarRifa = deps.eliminarRifa || W.eliminarRifa;
  const renderParticipantesTab = deps.renderParticipantesTab || W.renderParticipantesTab;
  const renderPublicidadTab = deps.renderPublicidadTab || W.renderPublicidadTab;
  const renderBaloteraTab = deps.renderBaloteraTab || W.renderBaloteraTab;
  const renderSorteoTab = deps.renderSorteoTab || W.renderSorteoTab;
  const renderWhatsappTab = deps.renderWhatsappTab || W.renderWhatsappTab;
  const renderHistorialTab = deps.renderHistorialTab || W.renderHistorialTab;
  const modalAplazarRifa = deps.modalAplazarRifa || W.modalAplazarRifa;
  const safeAttr = deps.safeAttr || W.safeAttr;
  const copiarLinkPublico = deps.copiarLinkPublico || W.copiarLinkPublico;
  const generarReferido = deps.generarReferido || W.generarReferido;
  const copiarLinkReferido = deps.copiarLinkReferido || W.copiarLinkReferido;
  const verPagos = deps.verPagos || W.verPagos;
  const descargarAutenticada = deps.descargarAutenticada || W.descargarAutenticada;
  const exportarReportePDF = deps.exportarReportePDF || W.exportarReportePDF;
  const abrirRestoreModal = deps.abrirRestoreModal || W.abrirRestoreModal;
  const FEATURE_WOMPI = deps.FEATURE_WOMPI !== undefined ? deps.FEATURE_WOMPI : W.FEATURE_WOMPI;

  const [rifa, dashboard] = await Promise.all([api('/rifas/' + id), api('/rifas/' + id + '/dashboard')]);
  state.rifaActual = rifa;
  const pageTitle = document.getElementById('page-title');
  if (pageTitle) pageTitle.textContent = rifa.nombre;
  const topbar = document.getElementById('topbar-actions');
  if (topbar) topbar.innerHTML = `
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

  const container = document.getElementById('view-container');
  container.innerHTML = `
    <div class="tabs">
      ${tabs.map(([k, l]) => `<a class="tab ${tab === k ? 'active' : ''}" href="#/rifas/${id}/${k}">${l}</a>`).join('')}
    </div>
    <div id="tab-content"></div>
    <div class="nav-pager">
      ${prev ? `<a class="btn btn-outline btn-sm" href="#/rifas/${id}/${prev[0]}">← ${prev[1]}</a>` : '<span></span>'}
      <a class="btn btn-ghost btn-sm" href="#/rifas">⬅ Volver a mis rifas</a>
      ${next ? `<a class="btn btn-gold btn-sm" href="#/rifas/${id}/${next[1]}">${next[1]} →</a>` : '<span></span>'}
    </div>`;
  const box = document.getElementById('tab-content');

  if (tab === 'resumen') box.innerHTML = await renderResumenModular(rifa, dashboard, { api, FEATURE_WOMPI });
  else if (tab === 'participantes') await (renderParticipantesTab || renderParticipantesTabOld)(rifa, box);
  else if (tab === 'publicidad') await (renderPublicidadTab || renderPublicidadTabOld)(rifa, dashboard, box);
  else if (tab === 'balotera') await (renderBaloteraTab || renderBaloteraTabOld)(rifa, box);
  else if (tab === 'sorteo') await (renderSorteoTab || renderSorteoTabOld)(rifa, box);
  else if (tab === 'whatsapp') await (renderWhatsappTab || renderWhatsappTabOld)(rifa, box);
  else if (tab === 'historial') await (renderHistorialTab || renderHistorialTabOld)(rifa, box);
}

// renderResumen modular — extraído de app.js:1283-1412
export async function renderResumenModular(rifa, d, deps = {}) {
  const api = deps.api || (typeof window !== 'undefined' && window.api);
  const fmtCOP = deps.fmtCOP || (typeof window !== 'undefined' && window.fmtCOP);
  const fmtFecha = deps.fmtFecha || (typeof window !== 'undefined' && window.fmtFecha);
  const escapeHtml = deps.escapeHtml || (typeof window !== 'undefined' && window.escapeHtml);
  const modoEsChance = deps.modoEsChance || (typeof window !== 'undefined' && window.modoEsChance);
  const nOport = deps.nOport || (typeof window !== 'undefined' && window.nOport);
  const FEATURE_WOMPI = deps.FEATURE_WOMPI !== undefined ? deps.FEATURE_WOMPI : (typeof window !== 'undefined' && window.FEATURE_WOMPI);

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

  let disponiblesHTML;
  if (esChance) {
    disponiblesHTML = chanceLibres.length
      ? `<div class="grilla-numeros disponibles-lista">${chanceLibres.slice(0, 120).map(b => `<button type="button" class="grilla-celda libre" onclick="window.location.hash='#/rifas/${rifa.id}/participantes'" title="Ver mapa: ${b.label}">${b.label}</button>`).join('')}</div>
         <p class="text-xs text-ink-600 mt-2">Mostrando las primeras 120 de ${chanceLibres.length} boletas disponibles.</p>`
      : `<div class="empty-state" style="padding:20px;"><div class="icon">🎟️</div><p>No quedan boletas disponibles</p></div>`;
  } else if (esCuatro) {
    disponiblesHTML = gruposLibres.length
      ? `<div class="grilla-grupos disponibles-lista">${gruposLibres.map(g => `<button type="button" class="grupo-celda libre" onclick='abrirGrupo(${rifa.id}, ${window.grupoJs(g)})' title="${escapeHtml(g.numeros.join(' · '))}">
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
    </div>`;
}

// Funciones legacy para compatibilidad (mantenidas en app.js globals)
if (typeof window !== 'undefined') window.renderResumenModular = renderResumenModular;