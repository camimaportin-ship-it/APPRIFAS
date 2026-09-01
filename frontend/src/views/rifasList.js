// frontend/src/views/rifasList.js — Corte real Fase — vistaListaRifas modular
// Extraído de app.js:459-601 sin cambiar lógica. Imports puros, fallback a globals si no hay import.
// Este módulo es la fuente canónica; app.js delega aquí con try/import y fallback.

import { fmtCOP, fmtFecha, escapeHtml } from '../utils/format.js';
import { BADGE_ESTADO } from '../utils/constants.js';
import { moverACarpeta, clonarRifa, eliminarRifa } from '../utils/actions.js';

let _rifasVista = 'grid';
let _rifasFiltro = { estado: '', tipo: '', busqueda: '', categoria: '' };

export async function vistaListaRifasModular(api, deps = {}) {
  const toast = deps.toast || (typeof window !== 'undefined' && window.toast);
  const moverACarpeta = deps.moverACarpeta || (typeof window !== 'undefined' && window.moverACarpeta);
  const clonarRifa = deps.clonarRifa || (typeof window !== 'undefined' && window.clonarRifa);
  const eliminarRifa = deps.eliminarRifa || (typeof window !== 'undefined' && window.eliminarRifa);

  const [rifas, categorias] = await Promise.all([api('/rifas'), api('/categorias').catch(() => [])]);
  const rifasArr = Array.isArray(rifas) ? rifas : [];
  const catsArr = Array.isArray(categorias) ? categorias : [];
  const container = document.getElementById('view-container');
  const topbarActions = document.getElementById('topbar-actions');
  if (topbarActions) topbarActions.innerHTML = `<a href="#/rifas/nueva" class="btn btn-gold">➕ Crear rifa</a>`;

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
                <button class="btn btn-ghost btn-sm" onclick="event.preventDefault(); event.stopPropagation(); moverACarpeta('${r.id}', '${escapeHtml(r.categoria || '')}', { api, toast, router })" title="Mover a carpeta">📁</button>
                <button class="btn btn-ghost btn-sm" onclick="event.preventDefault(); event.stopPropagation(); clonarRifa('${r.id}', { api, toast })" title="Clonar">📋</button>
                <button class="btn btn-ghost btn-sm" onclick="event.preventDefault(); event.stopPropagation(); eliminarRifa('${r.id}', '${escapeHtml(r.nombre)}', { api, toast, state: window.state })" title="Eliminar" style="color:var(--red-500);">🗑️</button>
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
    const c = document.getElementById('rifas-container');
    if (c) c.innerHTML = renderRifas(lista);
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

// Compatibilidad: expone estado para tests
export function __getState() { return { vista: _rifasVista, filtro: _rifasFiltro }; }
