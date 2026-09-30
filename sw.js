/* Cache-first service worker: once the booth has loaded, the venue Wi-Fi can
   die and the app keeps working. Bump CACHE when you change any asset. */
var CACHE = 'quince-booth-v11';
var ASSETS = [
  './', './index.html', './booth.js', './share.js', './faces.js', './gif.js', './qrcode.js', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png', './icon-1024.png',
  // Artwork props. Precached rather than fetched on demand: the venue has no
  // Wi-Fi to speak of, and a prop the guest taps has to appear at once.
  './props/manifest.json',
  './props/crown-gold-rose.webp', './props/crown-gold-fuchsia.webp',
  './props/tiara-silver-wide.webp', './props/tiara-silver-arch.webp',
  './props/sash15.webp', './props/sceptre.webp', './props/num15.webp',
  './props/mask.png', './props/mustache.png', './props/lips.png',
  './props/bubble.png'
];

/* Face detection: about 1.5MB of runtime and model. Kept out of ASSETS so a
   flaky connection on first load cannot fail the whole install and leave the
   booth uncached — it is fetched in the background once the rest is safe, and
   a miss just means props are placed by hand. */
var FACE_ASSETS = [
  './vendor/tfjs/tf-core.min.js', './vendor/tfjs/tf-converter.min.js',
  './vendor/tfjs/tf-backend-webgl.min.js', './vendor/tfjs/tf-backend-cpu.min.js',
  './vendor/tfjs/blazeface.min.js',
  './vendor/tfjs/model/model.json', './vendor/tfjs/model/group1-shard1of1.bin'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) {
        return cache.addAll(ASSETS).then(function () {
          // Best effort, and deliberately not awaited: the booth is already
          // usable without it.
          FACE_ASSETS.forEach(function (url) { cache.add(url).catch(function () {}); });
        });
      })
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
