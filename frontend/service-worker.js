// service-worker.js
// -----------------------------------------------------------------------------
// Cachea el "app shell" (HTML/CSS/JS estáticos) para que la interfaz cargue
// instantáneamente y funcione aunque se pierda la conexión. Las llamadas a
// /api/* NO se cachean porque dependen de la base de datos local en vivo
// (esta app corre en la misma red/máquina, así que "offline" aquí significa
// "sin internet", no "sin el propio servidor").
// -----------------------------------------------------------------------------
const CACHE_NAME = 'rifas-syc-shell-v8'; // Fase 2.3
const APP_SHELL = [
  '/', '/index.html', '/style.css',
  '/components/RuletaCanvas.js', '/components/GeneradorImagen.js',
  '/components/BaloteraCanvas.js',
  '/vendor/canvas-confetti.js', '/vendor/chart.umd.js', '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Ignorar peticiones que no sean http/https (p. ej. chrome-extension://,
  // data:, blob:) para evitar errores al intentar cachearlas
  const scheme = new URL(event.request.url).protocol;
  if (scheme !== 'http:' && scheme !== 'https:') return;
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  // Nunca cachear la API ni las imágenes subidas: siempre deben ser frescas
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;

  // Estrategia NETWORK-FIRST: primero el servidor (siempre trae la última
  // versión); la caché solo se usa como respaldo si no hay conexión.
  event.respondWith(
    fetch(event.request).then((resp) => {
      if (resp && resp.status === 200) {
        // Guardado defensivo: nunca debe romper la respuesta aunque falle el cache
        caches.open(CACHE_NAME)
          .then((cache) => cache.put(event.request, resp.clone()))
          .catch(() => {});
      }
      return resp;
    }).catch(() => caches.match(event.request).then((cached) => cached))
  );
});

// Push notifications
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Rifas SYC';
  const options = {
    body: data.body || 'Nueva notificación',
    icon: data.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: data.data || {},
    vibrate: [100, 50, 100]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.rifaId ? `/rifas/${data.rifaId}` : '/';
  event.waitUntil(clients.matchAll({ type: 'window' }).then((windowClients) => {
    for (const client of windowClients) {
      if (client.url.includes(url) && 'focus' in client) return client.focus();
    }
    return clients.openWindow(url);
  }));
});
