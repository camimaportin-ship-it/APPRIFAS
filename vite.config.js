// vite.config.js — Fase 2.2 — Build opcional, sin romper el flujo actual
// `npm run build` genera frontend/dist/; server.js sirve dist/ si existe, si no frontend/
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'frontend',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'frontend/index.html')
    }
  },
  server: { port: 5173, strictPort: false }
});
