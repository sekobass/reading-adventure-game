const scope = self.registration.scope;
const cachePrefix = `seven-seals-${scope}-`;
const cacheName = cachePrefix + 'v1.0.0-dev.1';
const files = [
  './', './index.html', './css/style.css', './js/main.js', './js/game.js',
  './js/render.js', './js/combat.js', './js/campaign.js', './js/music.js', './js/question-data.js', './js/question-editor.js', './js/input.js', './js/storage.js', './data/stages.json',
  './data/questions.json', './manifest.webmanifest', './assets/icon-192.png',
  './assets/icon-512.png', './assets/kingdom-dusk.png',
];
const cachedUrls = new Set(files.map(path => new URL(path, scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache =>
    cache.addAll([...cachedUrls].map(url => new Request(url, { cache:'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(cachePrefix) && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

async function serveGameFile(request, cacheKey) {
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  } catch {
    // A cache failure should still allow the browser to load the file online.
  }
  try {
    return await fetch(request);
  } catch {
    return new Response('通信できません。接続を確認して、ページを再読み込みしてください。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.endsWith('/data/questions.json') && url.searchParams.has('refresh')) return;
  // Precached files are static, including when requested with tracking parameters.
  url.search = '';
  if (!cachedUrls.has(url.href)) return;
  event.respondWith(serveGameFile(request,url.href));
});
