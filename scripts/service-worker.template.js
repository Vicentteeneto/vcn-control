const CACHE_PREFIX = 'vcn-control-';
const CACHE_NAME = '__VCN_CACHE_VERSION__';
const STATIC_FILES = __VCN_STATIC_FILES__;

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
