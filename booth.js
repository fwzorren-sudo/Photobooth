/*
 * Quinceañera photo booth — web build.
 *
 * Mirrors the native iPad app: same modes, same look names, same strip layout,
 * so a guest cannot tell which one they are standing in front of. Runs offline
 * once cached; the only hard requirement is HTTPS (or localhost), because
 * getUserMedia will not hand over a camera otherwise.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- config

  var DEFAULTS = {
    celebrantName: 'Mis Quince',
    eventDate: '',
    hashtag: '',
    theme: 'light',
    // Empty means "use the theme's colour"; a URL param or admin edit overrides.
    accent: '',
    secondary: '',
    adminPIN: '1515',
    enableStrip: true,
    enableSingle: true,
    enableBoomerang: true,
    countdownSeconds: 3,
    stripShotCount: 4,
    idleResetSeconds: 45,
    enablePrint: true,
    enableShare: true,
    /// Spoken Spanish countdown, so guests look at the lens not the screen.
    voice: true,
    /// Show tonight's photos on the attract screen between guests.
    slideshow: true
  };

  var STORAGE_KEY = 'booth.config.v1';

  // Defaults < URL query (how an MDM Web Clip is configured) < on-device edits.
  var URL_KEYS = {
    name: 'celebrantName', date: 'eventDate', tag: 'hashtag',
    accent: 'accent', secondary: 'secondary', pin: 'adminPIN', theme: 'theme',
    countdown: 'countdownSeconds', shots: 'stripShotCount', idle: 'idleResetSeconds'
  };

  function loadConfig() {
    var config = Object.assign({}, DEFAULTS);

    var params = new URLSearchParams(location.search);
    Object.keys(URL_KEYS).forEach(function (key) {
      if (!params.has(key)) return;
      var field = URL_KEYS[key];
      var raw = params.get(key);
      config[field] = typeof DEFAULTS[field] === 'number' ? Number(raw) || DEFAULTS[field] : raw;
    });
    ['strip', 'single', 'boomerang', 'print', 'share', 'voice', 'slideshow'].forEach(function (key) {
      if (!params.has(key)) return;
      var field = 'enable' + key.charAt(0).toUpperCase() + key.slice(1);
      config[field] = params.get(key) !== '0' && params.get(key) !== 'false';
    });

    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) Object.assign(config, saved);
    } catch (e) { /* private browsing or cleared storage: defaults are fine */ }

    return sanitize(config);
  }

  function sanitize(config) {
    config.countdownSeconds = clamp(Math.round(config.countdownSeconds), 1, 10);
    config.stripShotCount = clamp(Math.round(config.stripShotCount), 2, 6);
    config.idleResetSeconds = clamp(Math.round(config.idleResetSeconds), 15, 600);
    if (!config.enableStrip && !config.enableSingle && !config.enableBoomerang) {
      config.enableStrip = true;
    }
    if (config.theme !== 'dark') config.theme = 'light';
    return config;
  }

  function saveConfig() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch (e) {}
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  var config = loadConfig();

  /** Light blue and white, with gold as the accent metal. */
  var THEME_DEFAULTS = {
    light: { accent: '#2f86bf', secondary: '#d3a238' },
    dark: { accent: '#3e9fd6', secondary: '#e8bd52' }
  };

  function themeDefaults() { return THEME_DEFAULTS[config.theme] || THEME_DEFAULTS.light; }
  function accentColor() { return (config.accent || '').trim() || themeDefaults().accent; }
  function secondaryColor() { return (config.secondary || '').trim() || themeDefaults().secondary; }

  // ---------------------------------------------------------------- colour

  var WHITE = [255, 255, 255];
  var NEAR_BLACK = [10, 30, 42];

  function parseHex(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return [47, 134, 191];
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** Blend toward a target colour: t=0 keeps it, t=1 becomes the target. */
  function mix(hex, target, t) {
    var c = parseHex(hex);
    return 'rgb(' + c.map(function (v, i) {
      return Math.round(v + (target[i] - v) * t);
    }).join(',') + ')';
  }

  // ---------------------------------------------------------------- catalogs

  // Every look is a plain CSS filter string, used verbatim for both the live
  // preview and the canvas render. That is what keeps the two identical.
  var FILTERS = [
    { id: 'none', title: 'Original', emoji: '🌈', css: 'none' },
    { id: 'noir', title: 'B y N', emoji: '⚫️', css: 'grayscale(1) contrast(1.12)' },
    { id: 'vintage', title: 'Vintage', emoji: '🟤', css: 'sepia(.8) saturate(1.15) contrast(1.05) brightness(1.02)' },
    { id: 'glow', title: 'Brillo', emoji: '✨', css: 'brightness(1.12) saturate(1.12) contrast(.92) blur(.4px)' },
    { id: 'rosa', title: 'Rosa', emoji: '🌸', css: 'saturate(1.3) hue-rotate(-12deg) brightness(1.05)' },
    { id: 'vivid', title: 'Vívido', emoji: '🔆', css: 'saturate(1.5) contrast(1.15)' },
    { id: 'frio', title: 'Frío', emoji: '❄️', css: 'hue-rotate(18deg) saturate(1.2) brightness(1.04)' }
  ];

  var PROP_CATEGORIES = [
    { id: 'corona', title: 'Corona', glyphs: ['👑', '👸', '💎', '🎀', '🌹', '🪮'] },
    { id: 'cara', title: 'Cara', glyphs: ['🕶️', '🤓', '🥸', '💋', '😎', '🤠', '🎭', '🦄'] },
    { id: 'fiesta', title: 'Fiesta', glyphs: ['🎉', '🎊', '🪅', '🎈', '🥳', '💃', '🕺', '🎸'] },
    { id: 'amor', title: 'Amor', glyphs: ['💖', '✨', '⭐️', '💫', '🌟', '🦋', '🌸', '🍰'] }
  ];

  var MODES = {
    strip: { title: 'Tira de Fotos', emoji: '🎞️', shoot: '¡Foto!', shootSub: 'Shoot' },
    single: { title: 'Foto', emoji: '📸', shoot: '¡Foto!', shootSub: 'Shoot' },
    boomerang: { title: 'Boomerang', emoji: '🔁', shoot: '¡Grabar!', shootSub: 'Record' }
  };

  var BOOMERANG = { frames: 14, interval: 1000 / 12, delay: 0.07, width: 480 };

  /** Double-tap window for removing a prop. */
  var DOUBLE_TAP_MS = 400;

  // ---------------------------------------------------------------- state

  var state = {
    phase: 'attract',
    mode: 'strip',
    filter: FILTERS[0],
    props: [],
    shots: [],
    shotIndex: 0,
    result: null,
    propCategory: PROP_CATEGORIES[0].id,
    cancelled: false,
    /// Index of the single strip frame being reshot, or -1.
    redoIndex: -1
  };

  var el = {};
  ['attract', 'capture', 'review', 'video', 'frame', 'props', 'shots', 'overlay',
   'filterRow', 'propRow', 'propCats', 'modeRow', 'shootBtn', 'shootLabel', 'startBtn',
   'exitBtn', 'resultImg', 'actionPane', 'toast', 'hotcorner', 'attractName',
   'attractDate', 'attractTag', 'sparkles', 'pinModal', 'pinInput', 'pinError',
   'pinCancel', 'pinOk', 'adminModal', 'adminBody', 'adminDone', 'adminReset',
   'printArea', 'printImg', 'cameraNotice', 'cameraNoticeTitle', 'cameraNoticeDetail',
   'guide', 'gallery', 'galleryRow', 'warnings', 'redoRow',
   'redoThumbs'].forEach(function (id) { el[id] = document.getElementById(id); });

  // ---------------------------------------------------------------- helpers

  function enabledModes() {
    var list = [];
    if (config.enableStrip) list.push('strip');
    if (config.enableSingle) list.push('single');
    if (config.enableBoomerang) list.push('boomerang');
    return list.length ? list : ['strip'];
  }

  function totalShots() { return state.mode === 'strip' ? config.stripShotCount : 1; }

  function hashtagText() {
    var tag = (config.hashtag || '').trim();
    if (!tag) return '';
    return tag.charAt(0) === '#' ? tag : '#' + tag;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var toastTimer;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2600);
  }

  // ---------------------------------------------------------------- sound

  var audio;
  function tone(freq, duration, type, gain) {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      var osc = audio.createOscillator();
      var amp = audio.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      amp.gain.setValueAtTime(gain || 0.12, audio.currentTime);
      amp.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
      osc.connect(amp).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + duration);
    } catch (e) { /* muted device or no WebAudio: the booth still works */ }
  }

  // ---------------------------------------------------------------- speech

  var speech = window.speechSynthesis;
  var spanishVoice = null;

  function pickVoice() {
    if (!speech || !speech.getVoices) return;
    var voices = speech.getVoices() || [];
    spanishVoice = voices.filter(function (v) { return /^es/i.test(v.lang || ''); })[0] || null;
  }

  if (speech) {
    pickVoice();
    // Voices load asynchronously in most browsers.
    if (speech.addEventListener) speech.addEventListener('voiceschanged', pickVoice);
  }

  var SPANISH_NUMBERS = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco',
                         'seis', 'siete', 'ocho', 'nueve', 'diez'];

  function say(text) {
    if (!config.voice || !speech) return false;
    try {
      speech.cancel();
      var utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-MX';
      if (spanishVoice) utterance.voice = spanishVoice;
      utterance.rate = 1.05;
      utterance.pitch = 1.05;
      speech.speak(utterance);
      return true;
    } catch (e) {
      return false;   // no speech engine: the beep still carries the countdown
    }
  }

  function tick() { tone(880, 0.12, 'triangle', 0.1); }
  function shutter() { tone(1600, 0.06, 'square', 0.12); setTimeout(function () { tone(900, 0.09, 'square', 0.1); }, 60); }
  function buzz() { if (navigator.vibrate) { try { navigator.vibrate(18); } catch (e) {} } }

  // ---------------------------------------------------------------- gallery

  /// Blob URLs stay alive while they are on screen, so the list is bounded.
  var GALLERY_MAX = 24;
  var GALLERY_SHOWN = 5;
  var gallery = [];
  var galleryOffset = 0;
  var galleryTimer = null;

  function rememberKeepsake(url) {
    gallery.unshift(url);
    while (gallery.length > GALLERY_MAX) URL.revokeObjectURL(gallery.pop());
  }

  function renderGallery() {
    if (!config.slideshow || !gallery.length) {
      el.gallery.classList.add('hidden');
      el.galleryRow.innerHTML = '';
      return;
    }
    el.gallery.classList.remove('hidden');
    el.galleryRow.innerHTML = '';
    var shown = Math.min(GALLERY_SHOWN, gallery.length);
    for (var i = 0; i < shown; i++) {
      var img = document.createElement('img');
      img.src = gallery[(galleryOffset + i) % gallery.length];
      img.alt = '';
      img.style.animationDelay = (i * 0.07) + 's';
      el.galleryRow.appendChild(img);
    }
  }

  function startGalleryRotation() {
    clearInterval(galleryTimer);
    renderGallery();
    if (!config.slideshow) return;
    galleryTimer = setInterval(function () {
      if (state.phase !== 'attract' || gallery.length <= GALLERY_SHOWN) return;
      galleryOffset = (galleryOffset + 1) % gallery.length;
      renderGallery();
    }, 5000);
  }

  function stopGalleryRotation() {
    clearInterval(galleryTimer);
    galleryTimer = null;
  }

  // ---------------------------------------------------------------- health

  /// Operator-facing warnings. The booth failing quietly halfway through the
  /// night is the failure mode that actually costs you the party.
  var warnings = {};

  function setWarning(key, text) {
    if (text) warnings[key] = text; else delete warnings[key];
    var keys = Object.keys(warnings);
    el.warnings.classList.toggle('hidden', keys.length === 0);
    el.warnings.innerHTML = '';
    keys.forEach(function (k) {
      var chip = document.createElement('div');
      chip.className = 'warn';
      chip.textContent = warnings[k];
      el.warnings.appendChild(chip);
    });
  }

  function watchHealth() {
    function checkNetwork() {
      // Offline does not stop the booth, but it does silently kill sharing.
      setWarning('net', navigator.onLine ? null : 'Sin Wi-Fi · Offline');
    }
    window.addEventListener('online', checkNetwork);
    window.addEventListener('offline', checkNetwork);
    checkNetwork();

    // Battery status is unavailable in Safari; the native app covers iPad.
    if (navigator.getBattery) {
      navigator.getBattery().then(function (battery) {
        function check() {
          var percent = Math.round(battery.level * 100);
          setWarning('battery',
            (!battery.charging && percent <= 20) ? 'Batería ' + percent + '% · Plug in' : null);
        }
        battery.addEventListener('levelchange', check);
        battery.addEventListener('chargingchange', check);
        check();
      }).catch(function () {});
    }

    function checkStorage() {
      if (!navigator.storage || !navigator.storage.estimate) return;
      navigator.storage.estimate().then(function (estimate) {
        if (!estimate || !estimate.quota) return;
        var freeMB = (estimate.quota - (estimate.usage || 0)) / 1048576;
        setWarning('storage', freeMB < 120 ? 'Poco espacio · Low storage' : null);
      }).catch(function () {});
    }
    checkStorage();
    setInterval(checkStorage, 60000);
  }

  // ---------------------------------------------------------------- theming

  function applyTheme() {
    var root = document.documentElement;
    root.setAttribute('data-theme', config.theme);

    // Only pin the custom properties when the operator actually chose a
    // colour; otherwise the stylesheet's own theme tokens win.
    [['--accent', config.accent], ['--secondary', config.secondary]].forEach(function (pair) {
      var value = (pair[1] || '').trim();
      if (value) root.style.setProperty(pair[0], value);
      else root.style.removeProperty(pair[0]);
    });
    el.attractName.textContent = config.celebrantName || 'Mis Quince';
    el.attractDate.textContent = (config.eventDate || '').toUpperCase();
    el.attractTag.textContent = hashtagText();
    document.title = (config.celebrantName || 'Cabina de Fotos') + ' · Photo Booth';
  }

  function buildSparkles() {
    var html = '';
    for (var i = 0; i < 22; i++) {
      var x = Math.random() * 96 + 2;
      var y = Math.random() * 92 + 2;
      var size = Math.random() * 18 + 10;
      var delay = (Math.random() * 2.4).toFixed(2);
      html += '<i style="left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) + '%;font-size:' +
        size.toFixed(0) + 'px;animation-delay:' + delay + 's">' + (i % 3 ? '✦' : '✧') + '</i>';
    }
    el.sparkles.innerHTML = html;
  }

  // ---------------------------------------------------------------- camera

  var stream = null;
  var cameraReady = false;

  /**
   * A booth that silently refuses to start is the worst possible failure, so
   * every way this can go wrong gets its own explanation on screen.
   */
  function showCameraNotice(title, detail) {
    el.cameraNoticeTitle.textContent = title;
    el.cameraNoticeDetail.textContent = detail;
    el.cameraNotice.classList.remove('hidden');
  }

  function hideCameraNotice() { el.cameraNotice.classList.add('hidden'); }

  var SECURE_ORIGIN = window.isSecureContext ||
    location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  async function startCamera() {
    if (cameraReady) return true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (!SECURE_ORIGIN) {
        showCameraNotice(
          'Se necesita HTTPS · This page needs HTTPS',
          'Browsers only hand over the camera on a secure origin. Open the booth over https://, or run it from localhost while testing.');
      } else {
        showCameraNotice(
          'Cámara no disponible · Camera unavailable',
          'This browser will not give the page a camera. On an iPad, open the booth in Safari or from its Home Screen icon.');
      }
      return false;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      el.video.srcObject = stream;
      await el.video.play();
      cameraReady = true;
      hideCameraNotice();
      setWarning('camera', null);

      // A track can end when another app grabs the camera. The preview just
      // freezes, so surface it rather than letting guests shoot a still image.
      var track = stream.getVideoTracks()[0];
      if (track) {
        track.addEventListener('ended', function () {
          cameraReady = false;
          setWarning('camera', 'Cámara detenida · Camera stopped');
        });
      }
      return true;
    } catch (err) {
      var name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        showCameraNotice(
          'Permite la cámara · Camera access is off',
          'Allow camera access for this page and tap again. In Safari: aA in the address bar → Website Settings → Camera → Allow. If the booth is embedded in another page, open it in its own tab instead.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        showCameraNotice(
          'No se encontró una cámara · No camera found',
          'This device has no camera the booth can use.');
      } else if (name === 'NotReadableError') {
        showCameraNotice(
          'La cámara está ocupada · Camera is busy',
          'Another app is using the camera. Close it and tap again.');
      } else {
        showCameraNotice(
          'No se pudo abrir la cámara · Could not start the camera',
          (err && err.message) || 'Unknown error.');
      }
      return false;
    }
  }

  // Keeps the iPad awake between guests.
  var wakeLock = null;
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  // ---------------------------------------------------------------- rendering

  // Safari gained canvas `filter` in 16.4. Older builds fall back to a
  // per-pixel path so saved photos still match the preview.
  var supportsCanvasFilter = (function () {
    try {
      var ctx = document.createElement('canvas').getContext('2d');
      ctx.filter = 'blur(1px)';
      return ctx.filter === 'blur(1px)';
    } catch (e) { return false; }
  })();

  function cropRect() {
    var vw = el.video.videoWidth || 1280;
    var vh = el.video.videoHeight || 960;
    var target = 4 / 3;
    var sw, sh;
    if (vw / vh > target) { sh = vh; sw = vh * target; } else { sw = vw; sh = vw / target; }
    return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw: sw, sh: sh };
  }

  /** One finished frame: mirrored, filtered, props burned in. */
  function renderFrame(width) {
    var w = Math.round(width);
    var h = Math.round(w * 3 / 4);
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d', { alpha: false });
    var crop = cropRect();

    ctx.save();
    if (supportsCanvasFilter) ctx.filter = state.filter.css;
    ctx.translate(w, 0);
    ctx.scale(-1, 1); // mirror, so the photo matches what the guest just saw
    ctx.drawImage(el.video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
    ctx.restore();

    if (!supportsCanvasFilter) applyFilterFallback(ctx, w, h, state.filter.css);
    drawProps(ctx, w, h);
    return canvas;
  }

  function propFontSize(prop, frameHeight) { return Math.max(prop.h * frameHeight * 0.85, 8); }

  function drawProps(ctx, w, h) {
    state.props.forEach(function (prop) {
      var size = propFontSize(prop, h);
      ctx.save();
      ctx.translate(prop.x * w, prop.y * h);
      ctx.rotate(prop.r * Math.PI / 180);
      ctx.font = size + 'px "Apple Color Emoji", "Segoe UI Emoji", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(prop.glyph, 0, 0);
      ctx.restore();
    });
  }

  /**
   * Per-pixel stand-in for the CSS filters above, for browsers without canvas
   * `filter`. Covers every function we actually use except blur, which is
   * decorative and simply skipped.
   */
  function applyFilterFallback(ctx, w, h, css) {
    if (!css || css === 'none') return;
    var ops = [];
    var re = /(grayscale|sepia|saturate|contrast|brightness|hue-rotate)\(([-0-9.]+)(deg|%)?\)/g;
    var match;
    while ((match = re.exec(css)) !== null) {
      var value = parseFloat(match[2]);
      if (match[3] === '%') value /= 100;
      ops.push({ name: match[1], value: value });
    }
    if (!ops.length) return;

    var image = ctx.getImageData(0, 0, w, h);
    var d = image.data;

    for (var i = 0; i < d.length; i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2];
      for (var k = 0; k < ops.length; k++) {
        var op = ops[k], amount = op.value, lum;
        switch (op.name) {
          case 'grayscale':
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            r += (lum - r) * amount; g += (lum - g) * amount; b += (lum - b) * amount;
            break;
          case 'sepia':
            var sr = 0.393 * r + 0.769 * g + 0.189 * b;
            var sg = 0.349 * r + 0.686 * g + 0.168 * b;
            var sb = 0.272 * r + 0.534 * g + 0.131 * b;
            r += (sr - r) * amount; g += (sg - g) * amount; b += (sb - b) * amount;
            break;
          case 'saturate':
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            r = lum + (r - lum) * amount; g = lum + (g - lum) * amount; b = lum + (b - lum) * amount;
            break;
          case 'contrast':
            r = (r - 128) * amount + 128; g = (g - 128) * amount + 128; b = (b - 128) * amount + 128;
            break;
          case 'brightness':
            r *= amount; g *= amount; b *= amount;
            break;
          case 'hue-rotate':
            var a = amount * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
            var nr = (0.213 + cos * 0.787 - sin * 0.213) * r + (0.715 - cos * 0.715 - sin * 0.715) * g + (0.072 - cos * 0.072 + sin * 0.928) * b;
            var ng = (0.213 - cos * 0.213 + sin * 0.143) * r + (0.715 + cos * 0.285 + sin * 0.140) * g + (0.072 - cos * 0.072 - sin * 0.283) * b;
            var nb = (0.213 - cos * 0.213 - sin * 0.787) * r + (0.715 - cos * 0.715 + sin * 0.715) * g + (0.072 + cos * 0.928 + sin * 0.072) * b;
            r = nr; g = ng; b = nb;
            break;
        }
      }
      d[i] = r < 0 ? 0 : (r > 255 ? 255 : r);
      d[i + 1] = g < 0 ? 0 : (g > 255 ? 255 : g);
      d[i + 2] = b < 0 ? 0 : (b > 255 ? 255 : b);
    }
    ctx.putImageData(image, 0, 0);
  }

  // ---------------------------------------------------------------- composition

  function roundRectPath(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function seededRandom(seed) {
    var s = seed >>> 0;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function drawBackground(ctx, w, h) {
    var accent = accentColor();
    var gold = secondaryColor();

    var gradient = ctx.createLinearGradient(0, 0, w * 0.3, h);
    gradient.addColorStop(0, mix(accent, WHITE, 0.56));
    gradient.addColorStop(0.4, mix(accent, WHITE, 0.86));
    gradient.addColorStop(0.66, '#ffffff');
    gradient.addColorStop(1, mix(accent, WHITE, 0.64));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Deterministic flourishes: reprinting a strip looks like the first one.
    var rand = seededRandom(0x515cea5e);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = gold;
    var count = Math.max(Math.floor(h / 120), 6);
    for (var i = 0; i < count; i++) {
      var size = 14 + rand() * 20;
      ctx.font = size + 'px system-ui, sans-serif';
      ctx.fillText('✦', rand() * w, rand() * h);
    }
    ctx.restore();

    ctx.strokeStyle = gold;
    ctx.lineWidth = 3;
    roundRectPath(ctx, 20, 20, w - 40, h - 40, 22);
    ctx.stroke();
  }

  function fittedText(ctx, text, cx, cy, maxW, maxH, family, weight, color, shadowColor) {
    if (!text) return;
    var size = maxH;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    for (var guard = 0; guard < 80; guard++) {
      ctx.font = weight + ' ' + Math.round(size) + 'px ' + family;
      var width = ctx.measureText(text).width;
      if (width <= maxW || size <= 9) break;
      size *= 0.94;
    }
    ctx.save();
    ctx.shadowColor = shadowColor || 'rgba(0,0,0,.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  function drawPhotoCell(ctx, canvas, x, y, w, h) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.28)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#fff';
    roundRectPath(ctx, x, y, w, h, 18);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, x + 6, y + 6, w - 12, h - 12, 14);
    ctx.clip();
    ctx.drawImage(canvas, x + 6, y + 6, w - 12, h - 12);
    ctx.restore();
  }

  var SCRIPT_FAMILY = '"Snell Roundhand", "Zapfino", cursive';
  var ROUND_FAMILY = 'ui-rounded, -apple-system, system-ui, sans-serif';

  function drawHeaderFooter(ctx, x, width, headerTop, headerHeight, footerTop, footerHeight) {
    var name = config.celebrantName || 'Mis Quince';
    var date = (config.eventDate || '').trim();
    var nameHeight = date ? headerHeight * 0.62 : headerHeight;

    // Deep ink on a pale ground; a soft white halo keeps it off the gradient.
    var ink = mix(accentColor(), NEAR_BLACK, 0.62);
    var inkSoft = mix(accentColor(), NEAR_BLACK, 0.44);
    var bronze = mix(secondaryColor(), NEAR_BLACK, 0.42);
    var halo = 'rgba(255,255,255,.75)';

    fittedText(ctx, name, x + width / 2, headerTop + nameHeight / 2,
               width, nameHeight * 0.9, SCRIPT_FAMILY, '700', ink, halo);

    if (date) {
      fittedText(ctx, date.toUpperCase(), x + width / 2,
                 headerTop + nameHeight + (headerHeight - nameHeight) / 2,
                 width, (headerHeight - nameHeight) * 0.6, ROUND_FAMILY, '700', inkSoft, halo);
    }

    var footer = hashtagText() || '✦ MIS QUINCE ✦';
    fittedText(ctx, footer, x + width / 2, footerTop + footerHeight / 2,
               width, footerHeight * 0.6, ROUND_FAMILY, '800', bronze, halo);
  }

  function composeStrip(frames) {
    var W = 1200, pad = 60, gap = 26, header = 240, footer = 150;
    var cellW = W - pad * 2;
    var cellH = Math.round(cellW * 3 / 4);
    var H = header + frames.length * cellH + (frames.length - 1) * gap + footer;

    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d', { alpha: false });

    drawBackground(ctx, W, H);
    var y = header;
    frames.forEach(function (frame) {
      drawPhotoCell(ctx, frame, pad, y, cellW, cellH);
      y += cellH + gap;
    });
    drawHeaderFooter(ctx, pad, cellW, 26, header - 44, H - footer + 14, footer - 34);
    return canvas;
  }

  function composeSingle(frame) {
    var W = 1800, pad = 70, header = 190, footer = 150;
    var photoW = W - pad * 2;
    var photoH = Math.round(photoW * 3 / 4);
    var H = header + photoH + footer;

    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d', { alpha: false });

    drawBackground(ctx, W, H);
    drawPhotoCell(ctx, frame, pad, header, photoW, photoH);
    drawHeaderFooter(ctx, pad, photoW, 24, header - 44, H - footer + 14, footer - 34);
    return canvas;
  }

  /** A slim themed band so a boomerang still says whose party it was. */
  function decorateBoomerangFrame(ctx, w, h) {
    var bandHeight = Math.round(h * 0.16);
    var gradient = ctx.createLinearGradient(0, h - bandHeight, 0, h);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,.62)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, h - bandHeight, w, bandHeight);

    var label = (config.celebrantName || 'Mis Quince');
    var tag = hashtagText();
    if (tag) label += '  ·  ' + tag;
    fittedText(ctx, label, w / 2, h - bandHeight * 0.45, w - 24, bandHeight * 0.46,
               ROUND_FAMILY, '700', '#fff', 'rgba(0,0,0,.6)');
  }

  // ---------------------------------------------------------------- props UI

  function renderPropElements() {
    el.props.innerHTML = '';
    var rect = el.frame.getBoundingClientRect();
    state.props.forEach(function (prop) {
      var size = propFontSize(prop, rect.height);
      var node = document.createElement('div');
      node.className = 'prop';
      node.textContent = prop.glyph;
      node.style.width = size + 'px';
      node.style.height = size + 'px';
      node.style.fontSize = size + 'px';
      node.style.display = 'grid';
      node.style.placeItems = 'center';
      node.style.transform = 'translate(' + (prop.x * rect.width - size / 2) + 'px,' +
        (prop.y * rect.height - size / 2) + 'px) rotate(' + prop.r + 'deg)';
      attachPropGestures(node, prop);
      el.props.appendChild(node);
    });
  }

  /** Drag with one finger, pinch/twist with two, double-tap to remove. */
  function attachPropGestures(node, prop) {
    var pointers = new Map();
    var start = null;

    function frameRect() { return el.frame.getBoundingClientRect(); }

    node.addEventListener('pointerdown', function (event) {
      if (state.phase !== 'ready') return;
      event.preventDefault();
      event.stopPropagation();
      node.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      noteActivity();

      if (pointers.size === 1) {
        // The tap timestamp lives on the prop, not in this closure: the
        // element is rebuilt whenever the prop list re-renders, which would
        // otherwise reset the double-tap window on every single tap.
        var now = Date.now();
        if (now - (prop.lastTap || 0) < DOUBLE_TAP_MS) {
          prop.lastTap = 0;
          removeProp(prop.id);
          return;
        }
        prop.lastTap = now;
      }
      start = snapshot();
    });

    node.addEventListener('pointermove', function (event) {
      if (!pointers.has(event.pointerId) || !start) return;
      event.preventDefault();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      apply();
    });

    ['pointerup', 'pointercancel'].forEach(function (type) {
      node.addEventListener(type, function (event) {
        if (!pointers.has(event.pointerId)) return;
        pointers.delete(event.pointerId);
        start = pointers.size ? snapshot() : null;
        // No re-render here: `apply()` already wrote the new transform, and
        // rebuilding would throw away the element mid-gesture.
      });
    });

    function snapshot() {
      var list = Array.from(pointers.values());
      return {
        prop: { x: prop.x, y: prop.y, h: prop.h, r: prop.r },
        centre: centreOf(list),
        spread: spreadOf(list),
        angle: angleOf(list),
        count: list.length
      };
    }

    function centreOf(list) {
      var sx = 0, sy = 0;
      list.forEach(function (p) { sx += p.x; sy += p.y; });
      return { x: sx / list.length, y: sy / list.length };
    }
    function spreadOf(list) {
      if (list.length < 2) return 0;
      return Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
    }
    function angleOf(list) {
      if (list.length < 2) return 0;
      return Math.atan2(list[1].y - list[0].y, list[1].x - list[0].x) * 180 / Math.PI;
    }

    function apply() {
      var list = Array.from(pointers.values());
      if (!list.length) return;
      var rect = frameRect();
      var centre = centreOf(list);

      prop.x = clamp(start.prop.x + (centre.x - start.centre.x) / rect.width, -0.05, 1.05);
      prop.y = clamp(start.prop.y + (centre.y - start.centre.y) / rect.height, -0.05, 1.05);

      if (list.length >= 2 && start.count >= 2 && start.spread > 0) {
        prop.h = clamp(start.prop.h * (spreadOf(list) / start.spread), 0.08, 0.8);
        prop.r = start.prop.r + (angleOf(list) - start.angle);
      }

      var size = propFontSize(prop, rect.height);
      node.style.width = size + 'px';
      node.style.height = size + 'px';
      node.style.fontSize = size + 'px';
      node.style.transform = 'translate(' + (prop.x * rect.width - size / 2) + 'px,' +
        (prop.y * rect.height - size / 2) + 'px) rotate(' + prop.r + 'deg)';
    }
  }

  function addProp(glyph) {
    if (state.props.length >= 8) { toast('¡Ya hay muchos! · That’s plenty of props'); return; }
    var offset = (state.props.length % 4) * 0.07;
    state.props.push({
      id: 'p' + Date.now() + Math.random().toString(16).slice(2),
      glyph: glyph, x: 0.4 + offset, y: 0.36 + offset * 0.4, h: 0.26, r: 0
    });
    renderPropElements();
    noteActivity();
  }

  function removeProp(id) {
    state.props = state.props.filter(function (p) { return p.id !== id; });
    renderPropElements();
    noteActivity();
  }

  function clearProps() {
    state.props = [];
    renderPropElements();
    noteActivity();
  }

  // ---------------------------------------------------------------- UI build

  function buildControls() {
    el.modeRow.innerHTML = '';
    var modes = enabledModes();
    if (modes.indexOf(state.mode) === -1) state.mode = modes[0];

    modes.forEach(function (id) {
      var button = document.createElement('button');
      button.className = 'pill' + (state.mode === id ? ' on' : '');
      button.textContent = MODES[id].emoji + ' ' + MODES[id].title;
      button.addEventListener('click', function () {
        state.mode = id;
        buildControls();
        noteActivity();
      });
      el.modeRow.appendChild(button);
    });
    el.modeRow.style.visibility = modes.length > 1 ? 'visible' : 'hidden';

    el.shootLabel.innerHTML = MODES[state.mode].shoot + '<span class="sub">' + MODES[state.mode].shootSub + '</span>';

    el.filterRow.innerHTML = '';
    FILTERS.forEach(function (filter) {
      var button = document.createElement('button');
      button.className = 'swatch' + (state.filter.id === filter.id ? ' on' : '');
      button.innerHTML = '<span class="emoji">' + filter.emoji + '</span><span>' + filter.title + '</span>';
      button.addEventListener('click', function () {
        state.filter = filter;
        el.video.style.filter = filter.css;
        buildControls();
        noteActivity();
      });
      el.filterRow.appendChild(button);
    });

    el.propCats.innerHTML = '';
    PROP_CATEGORIES.forEach(function (category) {
      var button = document.createElement('button');
      button.className = 'pill' + (state.propCategory === category.id ? ' on' : '');
      button.textContent = category.title;
      button.addEventListener('click', function () {
        state.propCategory = category.id;
        buildControls();
      });
      el.propCats.appendChild(button);
    });
    if (state.props.length) {
      var clearButton = document.createElement('button');
      clearButton.className = 'pill';
      clearButton.textContent = 'Quitar todo';
      clearButton.addEventListener('click', clearProps);
      el.propCats.appendChild(clearButton);
    }

    el.propRow.innerHTML = '';
    var active = PROP_CATEGORIES.filter(function (c) { return c.id === state.propCategory; })[0] || PROP_CATEGORIES[0];
    active.glyphs.forEach(function (glyph) {
      var button = document.createElement('button');
      button.className = 'prop-btn';
      button.textContent = glyph;
      button.addEventListener('click', function () { addProp(glyph); });
      el.propRow.appendChild(button);
    });
  }

  function setPhase(phase) {
    state.phase = phase;
    el.attract.classList.toggle('hidden', phase !== 'attract');
    el.review.classList.toggle('hidden', phase !== 'review');
    el.capture.classList.toggle('hidden', phase === 'attract' || phase === 'review');

    var shooting = phase !== 'ready';
    el.shootBtn.disabled = shooting;
    el.exitBtn.style.visibility = shooting ? 'hidden' : 'visible';
    el.filterRow.style.opacity = el.propRow.style.opacity = el.propCats.style.opacity = shooting ? 0.3 : 1;
    el.filterRow.style.pointerEvents = el.propRow.style.pointerEvents = el.propCats.style.pointerEvents = shooting ? 'none' : 'auto';

    el.guide.classList.toggle('hidden', phase !== 'ready');

    if (phase === 'attract') {
      el.overlay.innerHTML = '';
      el.overlay.className = '';
      el.shots.innerHTML = '';
      startGalleryRotation();
    } else {
      stopGalleryRotation();
    }
    scheduleIdleReset();
  }

  function showOverlay(html, className) {
    el.overlay.className = className || '';
    el.overlay.innerHTML = html;
  }

  function updateShotStrip() {
    el.shots.innerHTML = '';
    if (state.mode !== 'strip') return;
    state.shots.forEach(function (canvas) {
      var img = document.createElement('img');
      img.src = canvas.toDataURL('image/jpeg', 0.6);
      el.shots.appendChild(img);
    });
  }

  // ---------------------------------------------------------------- capture

  async function beginSession() {
    if (!(await startCamera())) return;
    requestWakeLock();
    state.props = [];
    state.shots = [];
    state.result = null;
    state.shotIndex = 0;
    state.filter = FILTERS[0];
    el.video.style.filter = 'none';
    renderPropElements();
    buildControls();
    setPhase('ready');
  }

  async function runCountdown(seconds) {
    for (var value = seconds; value >= 1; value--) {
      if (state.cancelled) return false;
      var caption = state.mode === 'strip'
        ? 'Foto ' + (state.shotIndex + 1) + ' de ' + totalShots()
        : MODES[state.mode].title;
      showOverlay('<div class="overlay-stack"><div class="count">' + value +
                  '</div><div class="count-caption">' + caption + '</div></div>', 'dim');
      // Speak the number when we can; fall back to the beep when we cannot.
      if (!say(SPANISH_NUMBERS[value] || String(value))) tick();
      buzz();
      await sleep(1000);
    }
    return !state.cancelled;
  }

  async function startCapture() {
    if (state.phase !== 'ready') return;
    state.cancelled = false;
    state.shots = [];
    state.redoIndex = -1;
    updateShotStrip();
    setPhase('shooting');
    say('¡Miren a la cámara!');

    try {
      if (state.mode === 'boomerang') {
        if (!(await runCountdown(config.countdownSeconds))) return abortCapture();
        shutter();
        await recordBoomerang();
      } else {
        var count = totalShots();
        for (var i = 0; i < count; i++) {
          state.shotIndex = i;
          var seconds = i === 0 ? config.countdownSeconds : Math.max(2, config.countdownSeconds - 1);
          if (!(await runCountdown(seconds))) return abortCapture();

          showOverlay('', 'flash');
          shutter();
          state.shots.push(renderFrame(1440));
          await sleep(250);
          if (state.cancelled) return abortCapture();
          updateShotStrip();
        }
        await composeStills();
      }
    } catch (err) {
      toast('Algo salió mal · Something went wrong');
      setPhase('ready');
      showOverlay('');
    }
  }

  function abortCapture() {
    showOverlay('');
    setPhase('ready');
  }

  function processingOverlay() {
    showOverlay('<div class="overlay-stack"><div class="big">Preparando tu recuerdo…</div>' +
                '<div class="hint" style="opacity:.85">Building your keepsake</div></div>', 'dim');
  }

  async function composeStills() {
    processingOverlay();
    await sleep(30); // let the overlay paint before the main thread blocks
    var canvas = state.mode === 'strip' ? composeStrip(state.shots) : composeSingle(state.shots[0]);
    var blob = await new Promise(function (resolve) {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });
    finishWith(blob, 'image/jpeg', 'jpg');
  }

  async function recordBoomerang() {
    var captured = [];
    var width = BOOMERANG.width;
    var height = Math.round(width * 3 / 4);

    for (var i = 0; i < BOOMERANG.frames; i++) {
      if (state.cancelled) return abortCapture();
      var progress = i / BOOMERANG.frames;
      var circumference = 2 * Math.PI * 64;
      showOverlay(
        '<div class="overlay-stack">' +
        '<svg class="ring" viewBox="0 0 140 140">' +
        '<circle class="track" cx="70" cy="70" r="64"></circle>' +
        '<circle class="value" cx="70" cy="70" r="64" stroke-dasharray="' + circumference +
        '" stroke-dashoffset="' + (circumference * (1 - progress)) + '"></circle></svg>' +
        '<div class="big">¡Muévete! · Keep moving!</div></div>', 'dim');

      var frame = renderFrame(width);
      var ctx = frame.getContext('2d');
      decorateBoomerangFrame(ctx, width, height);
      captured.push(ctx.getImageData(0, 0, width, height));
      await sleep(BOOMERANG.interval);
    }

    processingOverlay();
    await sleep(30);

    // Forward then back, minus the repeated end frames, so the loop bounces.
    var sequence = captured.concat(captured.slice(1, -1).reverse());
    var bytes = window.BoothGIF.encode(sequence.map(function (imageData) {
      return { data: imageData.data, width: width, height: height };
    }), BOOMERANG.delay);

    finishWith(new Blob([bytes], { type: 'image/gif' }), 'image/gif', 'gif');
  }

  function finishWith(blob, mime, extension) {
    if (state.result && state.result.url) URL.revokeObjectURL(state.result.url);
    var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    state.result = {
      blob: blob,
      mime: mime,
      mode: state.mode,
      url: URL.createObjectURL(blob),
      filename: 'photobooth-' + stamp + '.' + extension
    };
    el.resultImg.src = state.result.url;
    el.printImg.src = state.result.url;
    buildActions();
    buildRedoRow();
    showOverlay('');
    setPhase('review');
  }

  // ---------------------------------------------------------------- review

  /// A single blink should not cost the guest all four shots.
  function buildRedoRow() {
    var canRedo = state.result && state.result.mode === 'strip' && state.shots.length > 1;
    el.redoRow.classList.toggle('hidden', !canRedo);
    el.redoThumbs.innerHTML = '';
    if (!canRedo) return;

    state.shots.forEach(function (canvas, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Repetir foto ' + (index + 1));

      var img = document.createElement('img');
      img.src = canvas.toDataURL('image/jpeg', 0.6);
      img.alt = '';
      button.appendChild(img);

      var badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = index + 1;
      button.appendChild(badge);

      button.addEventListener('click', function () { redoShot(index); });
      el.redoThumbs.appendChild(button);
    });
  }

  async function redoShot(index) {
    if (state.phase !== 'review' || !cameraReady) return;

    state.cancelled = false;
    state.redoIndex = index;
    state.shotIndex = index;
    setPhase('shooting');
    say('¡Otra vez!');

    try {
      if (!(await runCountdown(Math.max(2, config.countdownSeconds - 1)))) {
        state.redoIndex = -1;
        showOverlay('');
        setPhase('review');
        return;
      }

      showOverlay('', 'flash');
      shutter();
      state.shots[index] = renderFrame(1440);
      await sleep(250);
      state.redoIndex = -1;

      await composeStills();
    } catch (err) {
      state.redoIndex = -1;
      toast('Algo salió mal · Something went wrong');
      showOverlay('');
      setPhase('review');
    }
  }

  function buildActions() {
    el.actionPane.innerHTML = '';

    var file = new File([state.result.blob], state.result.filename, { type: state.result.mime });
    var canShareFile = config.enableShare && navigator.canShare && navigator.canShare({ files: [file] });

    if (canShareFile) {
      addAction('📤', 'Compartir', 'Guardar, enviar por mensaje o email', async function () {
        try {
          await navigator.share({ files: [file], text: shareText() });
        } catch (e) { /* the guest dismissed the sheet */ }
        noteActivity();
      });
    }

    addAction('⬇️', 'Descargar', 'Save to Files', function () {
      var link = document.createElement('a');
      link.href = state.result.url;
      link.download = state.result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      noteActivity();
    });

    if (config.enablePrint) {
      addAction('🖨️', 'Imprimir', 'AirPrint', function () {
        noteActivity();
        window.print();
      });
    }

    var hint = document.createElement('p');
    hint.className = 'hint';
    hint.style.textAlign = 'center';
    hint.textContent = 'Para guardarla en Fotos: mantén presionada la imagen → Añadir a Fotos.';
    el.actionPane.appendChild(hint);

    var spacer = document.createElement('div');
    spacer.className = 'spacer';
    el.actionPane.appendChild(spacer);

    addAction('🔄', 'Otra vez', 'Take another', function () {
      state.shots = [];
      updateShotStrip();
      setPhase('ready');
    });
    addAction('✅', '¡Listo!', 'All done', goAttract, true);
  }

  function addAction(icon, title, subtitle, handler, primary) {
    var button = document.createElement('button');
    button.className = 'btn' + (primary ? ' primary' : '');
    button.innerHTML = '<span style="font-size:24px">' + icon + '</span>' +
      '<span style="text-align:left">' + title + '<span class="sub">' + subtitle + '</span></span>';
    button.addEventListener('click', handler);
    el.actionPane.appendChild(button);
  }

  function shareText() {
    var name = config.celebrantName || 'la quinceañera';
    var tag = hashtagText();
    return '¡Gracias por celebrar con nosotros! From the photo booth at ' + name + (tag ? ' ' + tag : '');
  }

  function goAttract() {
    // Hand the finished keepsake to the slideshow rather than revoking it;
    // intermediate versions were already revoked by finishWith().
    if (state.result && state.result.url) {
      rememberKeepsake(state.result.url);
      state.result = null;
    }
    state.cancelled = true;
    state.redoIndex = -1;
    state.props = [];
    state.shots = [];
    state.shotIndex = 0;
    state.filter = FILTERS[0];
    el.video.style.filter = 'none';
    renderPropElements();
    updateShotStrip();
    setPhase('attract');
  }

  // ---------------------------------------------------------------- idle

  var idleTimer;
  function scheduleIdleReset() {
    clearTimeout(idleTimer);
    if (state.phase === 'attract' || state.phase === 'shooting') return;
    idleTimer = setTimeout(function () {
      if (state.phase === 'ready' || state.phase === 'review') goAttract();
    }, config.idleResetSeconds * 1000);
  }

  function noteActivity() {
    if (state.phase === 'ready' || state.phase === 'review') scheduleIdleReset();
  }

  // ---------------------------------------------------------------- admin

  var ADMIN_FIELDS = [
    { group: 'Evento', key: 'celebrantName', label: 'Quinceañera', type: 'text' },
    { key: 'eventDate', label: 'Fecha', type: 'text' },
    { key: 'hashtag', label: 'Hashtag', type: 'text' },
    { group: 'Colores', key: 'theme', label: 'Tema', type: 'choice',
      options: [['light', 'Claro · Light'], ['dark', 'Oscuro · Dark']] },
    { key: 'accent', label: 'Color principal', type: 'text', placeholder: 'auto' },
    { key: 'secondary', label: 'Color secundario', type: 'text', placeholder: 'auto' },
    { group: 'Modos', key: 'enableStrip', label: 'Tira de fotos', type: 'bool' },
    { key: 'enableSingle', label: 'Foto sencilla', type: 'bool' },
    { key: 'enableBoomerang', label: 'Boomerang GIF', type: 'bool' },
    { group: 'Captura', key: 'countdownSeconds', label: 'Cuenta regresiva (s)', type: 'number', min: 1, max: 10 },
    { key: 'stripShotCount', label: 'Fotos por tira', type: 'number', min: 2, max: 6 },
    { key: 'idleResetSeconds', label: 'Reinicio automático (s)', type: 'number', min: 15, max: 600 },
    { group: 'Cabina', key: 'voice', label: 'Cuenta regresiva hablada', type: 'bool' },
    { key: 'slideshow', label: 'Mostrar fotos de la noche', type: 'bool' },
    { group: 'Compartir', key: 'enableShare', label: 'Botón compartir', type: 'bool' },
    { key: 'enablePrint', label: 'Imprimir (AirPrint)', type: 'bool' },
    { group: 'Seguridad', key: 'adminPIN', label: 'PIN', type: 'text' }
  ];

  function buildAdmin() {
    el.adminBody.innerHTML = '';
    ADMIN_FIELDS.forEach(function (field) {
      if (field.group) {
        var group = document.createElement('div');
        group.className = 'group';
        group.innerHTML = '<h3>' + field.group + '</h3>';
        el.adminBody.appendChild(group);
      }
      var label = document.createElement('label');
      var span = document.createElement('span');
      span.textContent = field.label;
      label.appendChild(span);

      var control;
      if (field.type === 'choice') {
        control = document.createElement('select');
        field.options.forEach(function (option) {
          var node = document.createElement('option');
          node.value = option[0];
          node.textContent = option[1];
          control.appendChild(node);
        });
        control.value = config[field.key];
      } else {
        control = document.createElement('input');
        if (field.type === 'bool') {
          control.type = 'checkbox';
          control.checked = !!config[field.key];
        } else {
          control.type = field.type === 'number' ? 'number' : 'text';
          if (field.min !== undefined) { control.min = field.min; control.max = field.max; }
          if (field.placeholder) control.placeholder = field.placeholder;
          control.value = config[field.key];
        }
      }
      control.id = 'admin-' + field.key;
      span.setAttribute('for', control.id);

      control.addEventListener('change', function () {
        config[field.key] = field.type === 'bool' ? control.checked
          : (field.type === 'number' ? Number(control.value) : control.value);
        config = sanitize(config);
        saveConfig();
        applyTheme();
        buildControls();
      });
      label.appendChild(control);
      el.adminBody.appendChild(label);
    });

    var note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Deja los colores en blanco para usar los del tema. Restablecer borra los ajustes de este dispositivo y vuelve a los valores del enlace (los parámetros de la URL que envía tu MDM).';
    el.adminBody.appendChild(note);
  }

  function bindAdmin() {
    var holdTimer;
    el.hotcorner.addEventListener('pointerdown', function () {
      holdTimer = setTimeout(function () {
        el.pinInput.value = '';
        el.pinError.style.display = 'none';
        el.pinModal.classList.remove('hidden');
      }, 3000);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
      el.hotcorner.addEventListener(type, function () { clearTimeout(holdTimer); });
    });

    el.pinCancel.addEventListener('click', function () { el.pinModal.classList.add('hidden'); });
    el.pinOk.addEventListener('click', function () {
      if (el.pinInput.value === String(config.adminPIN)) {
        el.pinModal.classList.add('hidden');
        buildAdmin();
        el.adminModal.classList.remove('hidden');
      } else {
        el.pinError.style.display = 'block';
        el.pinInput.value = '';
      }
    });
    el.pinInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') el.pinOk.click();
    });

    el.adminDone.addEventListener('click', function () {
      el.adminModal.classList.add('hidden');
      applyTheme();
      buildControls();
    });
    el.adminReset.addEventListener('click', function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      config = loadConfig();
      applyTheme();
      buildAdmin();
      buildControls();
      toast('Ajustes restablecidos');
    });
  }

  // ---------------------------------------------------------------- boot

  function bind() {
    el.startBtn.addEventListener('click', beginSession);
    el.attract.addEventListener('click', function (event) {
      if (event.target === el.startBtn || el.startBtn.contains(event.target)) return;
      beginSession();
    });
    el.shootBtn.addEventListener('click', startCapture);
    el.exitBtn.addEventListener('click', goAttract);

    document.addEventListener('pointerdown', noteActivity, true);
    window.addEventListener('resize', function () {
      if (state.props.length) renderPropElements();
    });
    window.addEventListener('orientationchange', function () {
      setTimeout(renderPropElements, 320);
    });

    // A booth screen should never show a context menu or a text cursor.
    document.addEventListener('contextmenu', function (event) {
      if (event.target !== el.resultImg) event.preventDefault();
    });
    document.addEventListener('gesturestart', function (event) { event.preventDefault(); });
  }

  applyTheme();
  buildSparkles();
  buildControls();
  bind();
  bindAdmin();
  watchHealth();
  setPhase('attract');

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
