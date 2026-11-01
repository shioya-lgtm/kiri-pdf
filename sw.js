// KiriPDF Service Worker — アプリ本体を端末にキャッシュしてオフライン動作させる。
// 同梱ファイルを変更したら CACHE_VERSION を上げること（上げないと利用者側が旧版のまま）。
const CACHE_VERSION = 'kiripdf-v3';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tailwind.css',
  './vendor/pdf-lib.min.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/pdf-encrypt.umd.js',
  './vendor/jszip.min.js',
  './vendor/lucide.min.js',
  './vendor/fonts/plus-jakarta-sans-latin-400-normal.woff2',
  './vendor/fonts/plus-jakarta-sans-latin-500-normal.woff2',
  './vendor/fonts/plus-jakarta-sans-latin-600-normal.woff2',
  './vendor/fonts/plus-jakarta-sans-latin-700-normal.woff2',
  './vendor/fonts/jetbrains-mono-latin-400-normal.woff2',
  './vendor/fonts/jetbrains-mono-latin-500-normal.woff2',
  './vendor/fonts/jetbrains-mono-latin-600-normal.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);
    // 日本語表示用の CMap（vendor/cmaps/index.json に一覧）
    const cmapNames = await (await fetch('./vendor/cmaps/index.json')).json();
    await cache.addAll(cmapNames.map(name => './vendor/cmaps/' + name));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // 画面本体はネット優先（更新を早く反映）、オフライン時はキャッシュ
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // ライブラリ・フォント・アイコンはキャッシュ優先
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req))
  );
});
