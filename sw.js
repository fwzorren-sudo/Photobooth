/* Cache-first service worker: once the booth has loaded, the venue Wi-Fi can
   die and the app keeps working. Bump CACHE when you change any asset. */
var CACHE = 'quince-booth-v2';
var ASSETS = [
  './', './index.html', './booth.js', './gif.js', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png', './icon-1024.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) { return key !== CACHE; })
                             .map(function (key) { return caches.delete(key); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function (hit) {
      if (hit) return hit;
      return fetch(event.request).then(function (response) {
        // Only cache same-origin successes; opaque responses would poison it.
        if (response.ok && new URL(event.request.url).origin === location.origin) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      }).catch(function () { return caches.match('./index.html'); });
    })
  );
});
