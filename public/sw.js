const CACHE_NAME = 'matn-shell-v4.1.0';
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css?v=4.1.0',
  '/manifest.json',
  '/js/main.js?v=4.1.0',
  '/js/constants.js',
  '/js/icons.js',
  '/js/utils.js',
  '/js/auth-views.js',
  '/js/student-views.js',
  '/js/admin-views.js',
  '/vendor/pdfjs/pdf.min.js',
  '/vendor/pdfjs/pdf.worker.min.js',
  '/assets/favicon.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache protected API endpoints, byte-range streams, videos, uploads, or PDFs
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/uploads/') ||
    event.request.headers.has('range') ||
    /\.(mp4|webm|pdf)$/i.test(url.pathname)
  ) {
    return;
  }

  // Network-first for shell UI with offline cache fallback
  event.respondWith(
    fetch(event.request)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        }
        return networkRes;
      })
      .catch(() => caches.match(event.request).then((cached) => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('/index.html');
        return Response.error();
      }))
  );
});
