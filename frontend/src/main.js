// frontend/src/main.js — Entry vite — Fase pulido app.js
// Por ahora importa los módulos nuevos y deja app.js como fallback.
// Cuando la migración a módulos termine, este archivo será el único entry.

import { createSidebar } from './components/sidebar.js';
import { createApi } from './api.js';

// Inicializa sidebar modular (no rompe app.js porque app.js también lo hace, es idempotente)
try { createSidebar(); } catch (e) {}

// API modular disponible como window.apiModular para migración progresiva
const getToken = () => localStorage.getItem('rifassyc_token');
export const apiModular = createApi(getToken);

console.log('[Rifas SYC] main.js modular cargado — Fase pulido');
