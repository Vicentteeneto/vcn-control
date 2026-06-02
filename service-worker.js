const CACHE_NAME = 'vcn-control-v1';
const ASSETS = ['./'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Sempre busca da rede primeiro; cai no cache só se offline
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
