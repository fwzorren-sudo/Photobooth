/* Cache-first service worker: once the booth has loaded, the venue Wi-Fi can
   die and the app keeps working. Bump CACHE when you change any asset. */
var CACHE = 'quince-booth-v16';
var ASSETS = [
  './', './index.html', './booth.js', './share.js', './faces.js', './gif.js', './qrcode.js', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png', './icon-1024.png',
  // Artwork props. Precached rather than fetched on demand: the venue has no
  // Wi-Fi to speak of, and a prop the guest taps has to appear at once.
  './props/manifest.json',
  './props/crown-gold-rose.webp', './props/crown-gold-fuchsia.webp',
  './props/tiara-silver-wide.webp', './props/tiara-silver-arch.webp',
  './props/sash-quince.webp', './props/sceptre.webp',
  './props/fan.webp', './props/mask.png',
  './props/mustache.png', './props/lips.png',
  './props/xv.webp', './props/princesa.webp',
  './props/finally15.webp', './props/num15.webp',
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

/* The code that makes up the booth is fetched from the network first, with the
   cache as the fallback. It used to be cache-first like everything else, which
   meant a changed booth took TWO reloads to appear: the first served the old
   page from cache while the new worker installed behind it. That is a miserable
   way to test on a device, and worse on the day if something needs a fix.

   Everything else -- artwork, the face model, icons -- stays cache-first. Those
   are large, they change rarely, and the hall's Wi-Fi is not to be relied on. */
var SHELL = ['/', '/index.html', '/booth.js', '/share.js', '/faces.js',
             '/gif.js', '/qrcode.js', '/facecheck.html', '/manifest.webmanifest'];

function isShell(url) {
  if (url.origin !== location.origin) return false;
  var path = url.pathname.replace(/\/index\.html$/, '/');
  return SHELL.some(function (name) {
    return path === name || path.endsWith(name);
  });
}

function cacheIfOk(request, response) {
  if (response && response.ok && new URL(request.url).origin === location.origin) {
    var copy = response.clone();
    caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
  }
  return response;
}

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);

  if (event.request.mode === 'navigate' || isShell(url)) {
    event.respondWith(
      fetch(event.request)
        .then(function (response) { return cacheIfOk(event.request, response); })
        .catch(function () {
          return caches.match(event.request).then(function (hit) {
            return hit || caches.match('./index.html');
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (hit) {
      if (hit) return hit;
      return fetch(event.request)
        .then(function (response) { return cacheIfOk(event.request, response); })
        .catch(function () { return caches.match('./index.html'); });
    })
  );
});
