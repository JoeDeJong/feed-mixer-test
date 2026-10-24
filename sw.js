// Offline support: serve the app from cache so it works with no signal in the yard.
// Bump VERSION whenever app files change so tablets pick up the new version.
const VERSION = 'feedmixer-v5';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'css/app.css',
  'js/app.js', 'js/calc.js', 'js/csv.js', 'js/parser.js', 'js/scale.js', 'js/store.js', 'js/users.js', 'js/metrics.js', 'js/icons.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ?? fetch(e.request)));
});
