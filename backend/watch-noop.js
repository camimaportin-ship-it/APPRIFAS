// watch-noop.js
// -----------------------------------------------------------------------------
// Este proceso simula el "servidor de frontend" para que `npm run dev` levante
// backend Y frontend con concurrently, tal como pide el brief.
// En realidad el frontend YA es servido como archivos estáticos por Express
// (server.js) para que la app sea offline-first (todo en un solo puerto,
// sin necesidad de bundlers ni de internet). Este script solo vigila la
// carpeta /frontend y avisa por consola cuando detecta cambios, útil en
// desarrollo para saber que hay que refrescar el navegador.
// -----------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const frontendDir = path.join(__dirname, '..', 'frontend');

console.log('[CLIENT] Vigilando cambios en /frontend ...');
console.log('[CLIENT] Abre http://localhost:3000 en tu navegador.');

try {
  fs.watch(frontendDir, { recursive: true }, (eventType, filename) => {
    if (filename) {
      console.log(`[CLIENT] Cambio detectado en frontend/${filename} -> refresca el navegador`);
    }
  });
} catch (err) {
  console.log('[CLIENT] fs.watch no soportado en este sistema, pero el frontend sigue activo en el backend.');
}

// Mantener el proceso vivo
setInterval(() => {}, 1000 * 60 * 60);
