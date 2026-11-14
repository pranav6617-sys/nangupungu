// The cache name is a hash of every file listed in SHELL, stamped by the build, so a changed file is always a new cache.
// If you edit a file by hand, change the name here too.
const CACHE = 'mood2-c1c81a0381';
const SHELL = ['./', 'index.html', 'data.js', 'app.js', 'geist-mono-ui.woff2', 'manifest.json',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))));
  // No skipWaiting here: the page asks for it once it is back on the first screen, so code never changes mid check-in.
});
self.addEventListener('message', event => { if (event.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('mood2-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url), scope = new URL(self.registration.scope);
  // Only this app's own files. The Google Sheet and the other trackers are never touched.
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  // Everything comes from the cache, so the app opens instantly and offline.
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    return cached || fetch(event.request);
  }));
});
