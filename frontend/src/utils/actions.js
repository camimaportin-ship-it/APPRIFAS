// frontend/src/utils/actions.js — Corte real: moverACarpeta, clonarRifa, eliminarRifa
// Extraído de app.js:608-619 y app.js:2536-2554. Dependencias inyectadas via deps o desde window.

export function moverACarpeta(id, carpetaActual, deps = {}) {
  const api = deps.api || window.api;
  const toast = deps.toast || window.toast;
  const router = deps.router || window.router;

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

export function clonarRifa(id, deps = {}) {
  const api = deps.api || window.api;
  const toast = deps.toast || window.toast;

  if (!confirm('¿Clonar esta rifa? Se creará una copia con la misma configuración.')) return;
  try {
    const nueva = await api('/rifas/' + id + '/clonar', { method: 'POST' });
    toast('Rifa clonada como borrador');
    window.location.hash = '#/rifas/' + nueva.id + '/editar';
  } catch (e) { toast(e.message, 'error'); }
}

export function eliminarRifa(id, nombre, deps = {}) {
  const api = deps.api || window.api;
  const toast = deps.toast || window.toast;
  const rifa = deps.state && deps.state.rifaActual ? deps.state.rifaActual : window.state.rifaActual || {};
  const nombreMostrar = nombre || rifa.nombre || id;

  if (!confirm(`¿Eliminar "${nombreMostrar}"? Se moverá a la papelera y podrás restaurarla desde el filtro "Eliminadas".`)) return;
  try {
    await api('/rifas/' + id, { method: 'DELETE' });
    toast('Rifa movida a la papelera');
    window.location.hash = '#/rifas';
  } catch (e) { toast(e.message, 'error'); }
}