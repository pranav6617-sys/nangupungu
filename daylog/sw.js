// Keeps the page openable with no signal: it loads the newest copy when it can and falls back to the saved one.
const CACHE = 'day-log-v1';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

// Caches are shared by every app on this site, so only clear out this app's own old copies.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('day-log-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const host = new URL(req.url).hostname;
  if (host === self.location.hostname) e.respondWith(newestFirst(e, req));
});

// The page and its files: ask the server for the latest, and use the saved copy if there's no signal or it's slow.
async function newestFirst(e, req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req.url, { cache: 'no-cache' }).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  try {
    return await Promise.race([net, new Promise((_, no) => setTimeout(no, 3000))]);
  } catch (_) {
    return (await cache.match(req, { ignoreSearch: true })) || Response.error();
  }
}
