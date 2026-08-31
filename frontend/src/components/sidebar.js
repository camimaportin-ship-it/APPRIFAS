// frontend/src/components/sidebar.js — Fase pulido app.js — extraído de app.js:306-348
export function createSidebar() {
  function esMobile() { return window.innerWidth <= 860; }
  function setSidebar(abrir) {
    const sb = document.getElementById('sidebar');
    const back = document.getElementById('sidebar-backdrop');
    const btn = document.getElementById('btn-toggle-sidebar');
    if (!sb) return;
    if (esMobile()) {
      sb.classList.toggle('open', abrir);
      if (back) back.classList.toggle('visible', abrir);
    } else {
      sb.classList.toggle('colapsado', !abrir);
      try { localStorage.setItem('rifas-sidebar-colapsado', sb.classList.contains('colapsado') ? '1' : '0'); } catch (e) {}
    }
    if (btn) btn.setAttribute('aria-expanded', String(abrir));
  }
  function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    if (!sb) return;
    if (esMobile()) setSidebar(!sb.classList.contains('open'));
    else setSidebar(sb.classList.contains('colapsado'));
  }
  // Restaurar colapsado
  try { if (!esMobile() && localStorage.getItem('rifas-sidebar-colapsado') === '1') document.getElementById('sidebar')?.classList.add('colapsado'); } catch (e) {}
  // Listeners
  let _lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    const sb = document.getElementById('sidebar');
    const back = document.getElementById('sidebar-backdrop');
    const cambioBreakpoint = (_lastWidth > 860) !== (window.innerWidth > 860);
    _lastWidth = window.innerWidth;
    if (cambioBreakpoint && sb) { sb.classList.remove('open', 'colapsado'); if (back) back.classList.remove('visible'); }
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-toggle-sidebar')) toggleSidebar();
    else if (e.target.closest('#sidebar-backdrop')) setSidebar(false);
    else if (e.target.closest('.nav-link') && esMobile()) setSidebar(false);
  });
  return { setSidebar, toggleSidebar, esMobile };
}
