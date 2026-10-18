// Service worker: makes the app open and run with no signal.
// IMPORTANT: change VERSION every time you upload new app files, or phones keep the old copy.
const VERSION = 'labellog-v1';
const SHELL = ['./', 'index.html', 'parser.js', 'manifest.json', 'icon-192.png', 'icon-512.png',
  'lib/tesseract.min.js', 'lib/worker.min.js', 'lib/eng.traineddata.gz',
  'lib/tesseract-core.wasm.js', 'lib/tesseract-core-simd.wasm.js',
  'lib/tesseract-core-lstm.wasm.js', 'lib/tesseract-core-simd-lstm.wasm.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const host = new URL(req.url).hostname;
  if (host.endsWith('google.com') || host.endsWith('googleusercontent.com')) return;   // never cache the Sheet API
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => req.mode === 'navigate' ? caches.match('index.html') : Response.error()))
  );
});
