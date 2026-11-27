const cacheName = 'reading-dungeon-v0.1.0';
const files = [
  './', './index.html', './css/style.css', './js/main.js', './js/game.js',
  './js/render.js', './js/input.js', './js/storage.js', './data/stages.json',
  './data/questions.json', './manifest.webmanifest', './assets/icon-192.png',
  './assets/icon-512.png',
];
const cachedUrls = new Set(files.map(path => new URL(path, self.location.href).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache =>
    cache.addAll(files.map(path => new Request(path, { cache:'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('reading-dungeon-') && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(cacheName).then(async cache => {
    if (event.request.mode === 'navigate') {
      const route = new URL(url);
      route.search = '';
      if (cachedUrls.has(route.href)) return await cache.match(route.href) ?? fetch(event.request);
    } else if (cachedUrls.has(url.href)) {
      return await cache.match(event.request) ?? fetch(event.request);
    }
    return fetch(event.request);
  }));
});
