const CACHE_PREFIX = 'vcn-control-';
const CACHE_NAME = 'vcn-control-v21-847ee4cf0580';
const STATIC_FILES = [
  "./index.html",
  "./manifest.json",
  "./assets/control.0349d83eb2d8.js",
  "./assets/app.3d34b9f7986c.js",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-192.png",
  "./assets/icon-maskable-512.png",
  "./assets/apple-touch-icon.png",
  "./assets/favicon.svg",
  "./assets/fonts/inter.woff2",
  "./assets/fonts/space-grotesk.woff2"
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const scopePath = new URL(self.registration.scope).pathname;
  // Nunca armazena autenticação, comandos, dados remotos ou outros aplicativos.
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(scopePath)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    if (request.mode === 'navigate') return (await cache.match('./index.html')) || fetch(request);
    return (await cache.match(request)) || fetch(request);
  }));
});
