/* CardVault service worker: makes the app work offline.
   It caches only the app's own files. Your cards are never cached here:
   they live encrypted in IndexedDB. */
const VERSION = 'cardvault-v1.0.0';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'parser.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(e.request);
      // Language files and the OCR engine are cached the first time they are used.
      if (res.ok && url.pathname.includes('/vendor/')) cache.put(e.request, res.clone());
      return res;
    })
  );
});
