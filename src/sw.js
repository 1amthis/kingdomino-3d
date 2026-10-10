// The service worker that makes the game installable and playable offline. It is not part of the app's
// bundle: the build (vite.config.js) fills in the file list and version and writes it out as sw.js.
// Every file of a build is cached when it installs, and served from that cache from then on, so the game
// starts with no network at all. Online play still needs one, for the PeerJS signalling server.
// A new build installs beside the old one and waits; the page lets it take over only when that cannot
// interrupt anything (see the offline section of main.js), and the old build's files go once it has.
const VERSION = __VERSION__;
const FILES = __FILES__;
const CACHE = `kingdomino3d-${VERSION}`;
const FONTS = 'kingdomino3d-fonts';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => { if (e.data === 'update') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // The page itself, whatever its query (?join=…): the cached one, else the network.
  if (request.mode === 'navigate' && url.origin === location.origin) {
    e.respondWith(caches.open(CACHE).then((c) => c.match('./')).then((hit) => hit || fetch(request)));
    return;
  }
  // The build's own files.
  if (url.origin === location.origin) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(request, { ignoreSearch: true })).then((hit) => hit || fetch(request)));
    return;
  }
  // Google Fonts: from the cache at once, refreshed in the background when online.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async (c) => {
      const hit = await c.match(request);
      const fresh = fetch(request).then((res) => {
        if (res.ok || res.type === 'opaque') c.put(request, res.clone());
        return res;
      });
      if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
      return fresh;
    }));
  }
});
