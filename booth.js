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
    /// Link to the shared album for the whole night. Shown as a QR code on
    /// the review screen so guests can grab everything afterwards.
    albumUrl: '',
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
    slideshow: true,
    /// Video guestbook: a short spoken message for the celebrant.
    enableVideo: true,
    videoSeconds: 15,
    /// Let guests sign their keepsake with a finger before saving it.
    enableSign: true,
    /// Monogram burned into every keepsake. A data URL, set from the admin
    /// panel so it is same-origin and never taints the canvas.
    monogram: '',
    /// Origin of the handoff Worker, e.g. https://quince-booth-share.you.workers.dev
    /// Empty falls back to the album QR, which is what this build did before.
    uploadUrl: '',
    /// Shared secret the Worker checks on upload. A web page cannot keep a
    /// secret, so this is a speed bump, not a lock -- see mdm/README.md.
    uploadKey: ''
  };

  var STORAGE_KEY = 'booth.config.v1';

  // Defaults < URL query (how an MDM Web Clip is configured) < on-device edits.
  var URL_KEYS = {
    name: 'celebrantName', date: 'eventDate', tag: 'hashtag',
    accent: 'accent', secondary: 'secondary', pin: 'adminPIN', theme: 'theme',
    album: 'albumUrl', upload: 'uploadUrl', ukey: 'uploadKey',
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
    ['strip', 'single', 'boomerang', 'print', 'share', 'voice', 'slideshow',
     'video', 'sign'].forEach(function (key) {
      if (!params.has(key)) return;
      var field = key === 'sign' ? 'enableSign'
        : 'enable' + key.charAt(0).toUpperCase() + key.slice(1);
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
    config.videoSeconds = clamp(Math.round(config.videoSeconds), 5, 60);
    if (!config.enableStrip && !config.enableSingle &&
        !config.enableBoomerang && !config.enableVideo) {
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
  // Every guest-facing control carries its English underneath: roughly half the
  // guests read one language, half the other, and nobody should have to guess
  // which pill does what.
  var FILTERS = [
    { id: 'none', title: 'Original', sub: 'No filter', emoji: '🌈', css: 'none' },
    { id: 'noir', title: 'B y N', sub: 'B&W', emoji: '⚫️', css: 'grayscale(1) contrast(1.12)' },
    { id: 'vintage', title: 'Vintage', sub: 'Sepia', emoji: '🟤', css: 'sepia(.8) saturate(1.15) contrast(1.05) brightness(1.02)' },
    { id: 'glow', title: 'Brillo', sub: 'Glow', emoji: '✨', css: 'brightness(1.12) saturate(1.12) contrast(.92) blur(.4px)' },
    { id: 'rosa', title: 'Rosa', sub: 'Rose', emoji: '🌸', css: 'saturate(1.3) hue-rotate(-12deg) brightness(1.05)' },
    { id: 'vivid', title: 'Vívido', sub: 'Vivid', emoji: '🔆', css: 'saturate(1.5) contrast(1.15)' },
    { id: 'frio', title: 'Frío', sub: 'Cool', emoji: '❄️', css: 'hue-rotate(18deg) saturate(1.2) brightness(1.04)' }
  ];

  /**
   * Prop palette. Each category holds items that are either an emoji glyph or a
   * piece of artwork (a PNG with an alpha channel, served from the booth).
   * Artwork listed in props/manifest.json is merged in at boot, so adding a new
   * prop is a file plus a line of JSON - no code change.
   */
  var PROP_CATEGORIES = [
    { id: 'corona', title: 'Corona', sub: 'Crowns',
      items: ['👑', '👸', '💎', '🎀', '🌹'] },
    { id: 'cara', title: 'Cara', sub: 'Faces',
      items: ['🕶️', '🤓', '🥸', '💋', '😎', '🤠', '🎭', '🦄'] },
    { id: 'fiesta', title: 'Fiesta', sub: 'Party',
      items: ['🎉', '🎊', '🪅', '🎈', '🥳', '💃', '🕺', '🎸'] },
    { id: 'amor', title: 'Amor', sub: 'Love',
      items: ['💖', '✨', '⭐️', '💫', '🌟', '🦋', '🌸', '🍰'] }
  ];


  var MODES = {
    strip: { title: 'Tira de Fotos', sub: 'Photo strip', emoji: '🎞️', shoot: '¡Foto!', shootSub: 'Shoot' },
    single: { title: 'Foto', sub: 'Single photo', emoji: '📸', shoot: '¡Foto!', shootSub: 'Shoot' },
    boomerang: { title: 'Boomerang', sub: 'GIF loop', emoji: '🔁', shoot: '¡Grabar!', shootSub: 'Record' },
    video: { title: 'Mensaje', sub: 'Video message', emoji: '🎥', shoot: '¡Grabar!', shootSub: 'Record a message' }
  };

  var BOOMERANG = { frames: 14, interval: 1000 / 12, delay: 0.07, width: 480 };

  /** Double-tap window for removing a prop. */
  var DOUBLE_TAP_MS = 400;

  /** How long the operator holds the corner to reach the settings. */
  var HOLD_MS = 3000;

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
    /// Which tray is showing: 'filtros', or a prop category id. Only one is on
    /// screen at a time, because two stacked rows left the camera a thumbnail.
    tray: 'filtros',
    cancelled: false,
    /// Index of the single strip frame being reshot, or -1.
    redoIndex: -1,
    /// The composed keepsake, kept so a signature can be added without
    /// recomposing from the original frames.
    composed: null,
    /// Signature strokes in normalised coordinates.
    strokes: []
  };

  var el = {};
  ['attract', 'capture', 'review', 'video', 'videoBg', 'frame', 'crop', 'props', 'shots', 'overlay',
   'filterRow', 'propRow', 'propCats', 'propHint', 'modeRow', 'shootBtn', 'shootLabel', 'startBtn',
   'exitBtn', 'resultImg', 'actionPane', 'toast', 'hotcorner', 'attractName',
   'attractDate', 'attractTag', 'sparkles', 'pinModal', 'pinInput', 'pinError',
   'signModeBand', 'signModeFull', 'signHint', 'signScroll', 'signUp', 'signDown', 'signPos',
   'pinCancel', 'pinOk', 'adminModal', 'adminBody', 'adminDone', 'adminReset',
   'printArea', 'printImg', 'cameraNotice', 'cameraNoticeTitle', 'cameraNoticeDetail',
   'guide', 'gallery', 'galleryRow', 'warnings', 'redoRow', 'redoThumbs',
   'resultVideo', 'signModal', 'signStage', 'signImg', 'signCanvas', 'signColors',
   'signUndo', 'signClear', 'signCancel', 'signDone',
   'decorModal', 'decorFrames', 'decorStage', 'decorImg', 'decorProps',
   'decorCats', 'decorRow', 'decorCancel', 'decorFit',
   'decorDone'].forEach(function (id) { el[id] = document.getElementById(id); });

  // ---------------------------------------------------------------- helpers

  function enabledModes() {
    var list = [];
    if (config.enableStrip) list.push('strip');
    if (config.enableSingle) list.push('single');
    if (config.enableBoomerang) list.push('boomerang');
    if (config.enableVideo && supportsVideoRecording() && videoModeAvailable) list.push('video');
    return list.length ? list : ['strip'];
  }

  /// MediaRecorder reached Safari in 14.3; hide the mode rather than offer a
  /// button that cannot work.
  function supportsVideoRecording() {
    return typeof MediaRecorder !== 'undefined' && !!videoMimeType();
  }

  /// Safari records MP4, Chromium WebM. Pick whatever this browser admits to.
  function videoMimeType() {
    var candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    for (var i = 0; i < candidates.length; i++) {
      try {
        if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
      } catch (e) { /* older engines throw instead of returning false */ }
    }
    return '';
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
  var englishVoice = null;

  function pickVoice() {
    if (!speech || !speech.getVoices) return;
    var voices = speech.getVoices() || [];
    spanishVoice = voices.filter(function (v) { return /^es/i.test(v.lang || ''); })[0] || null;
    englishVoice = voices.filter(function (v) { return /^en/i.test(v.lang || ''); })[0] || null;
  }

  if (speech) {
    pickVoice();
    // Voices load asynchronously in most browsers.
    if (speech.addEventListener) speech.addEventListener('voiceschanged', pickVoice);
  }

  var SPANISH_NUMBERS = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco',
                         'seis', 'siete', 'ocho', 'nueve', 'diez'];

  /** Queues one utterance. Callers cancel first when they need to cut in. */
  function enqueue(text, lang, voice) {
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    if (voice) utterance.voice = voice;
    utterance.rate = 1.05;
    utterance.pitch = 1.05;
    speech.speak(utterance);
  }

  function say(text) {
    if (!config.voice || !speech) return false;
    try {
      speech.cancel();
      enqueue(text, 'es-MX', spanishVoice);
      return true;
    } catch (e) {
      return false;   // no speech engine: the beep still carries the countdown
    }
  }

  /**
   * The instruction lines, spoken Spanish then English. Counting down is
   * understood from context in either language, so the numbers stay Spanish
   * (see say) — but "look at the camera" is the line that actually changes how
   * the photo comes out, and half the room doesn't speak Spanish.
   */
  function sayBoth(spanish, english) {
    if (!config.voice || !speech) return false;
    try {
      speech.cancel();
      enqueue(spanish, 'es-MX', spanishVoice);
      enqueue(english, 'en-US', englishVoice);
      return true;
    } catch (e) {
      return false;
    }
  }

  function tick() { tone(880, 0.12, 'triangle', 0.1); }
  function shutter() { tone(1600, 0.06, 'square', 0.12); setTimeout(function () { tone(900, 0.09, 'square', 0.1); }, 60); }
  function buzz() { if (navigator.vibrate) { try { navigator.vibrate(18); } catch (e) {} } }

  // ---------------------------------------------------------------- QR

  /// Only http(s) links become a QR: a typo should show nothing rather than a
  /// code that sends a phone somewhere strange.
  function albumLink() {
    var url = (config.albumUrl || '').trim();
    return /^https?:\/\/\S+$/i.test(url) ? url : '';
  }

  /// Crisp vector QR, built from the module matrix so it stays sharp at any
  /// size and needs no canvas.
  function qrSvg(text) {
    if (!window.qrcode) return '';
    var qr = window.qrcode(0, 'H');
    qr.addData(text);
    qr.make();

    var count = qr.getModuleCount();
    var quiet = 4;
    var total = count + quiet * 2;
    var rects = '';
    for (var row = 0; row < count; row++) {
      for (var col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          rects += '<rect x="' + (col + quiet) + '" y="' + (row + quiet) + '" width="1" height="1"/>';
        }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total +
           '" shape-rendering="crispEdges" role="img" aria-label="Código QR">' +
           '<rect width="' + total + '" height="' + total + '" fill="#ffffff"/>' +
           '<g fill="#000000">' + rects + '</g></svg>';
  }

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

  /// Video messages are large, and this build has no disk to put them on, so
  /// only the last few are kept alive for the host to collect.
  var VIDEO_KEEP = 6;
  var retainedVideos = [];

  function retainVideo(url) {
    retainedVideos.push(url);
    while (retainedVideos.length > VIDEO_KEEP) URL.revokeObjectURL(retainedVideos.shift());
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

    // Photos waiting to upload are safe on the tablet, but the operator
    // should know before the queue is the whole night.
    if (window.BoothShare) {
      window.BoothShare.onChange(function (share) {
        setWarning('upload', share.pending
          ? share.pending + ' sin subir · waiting to upload'
          : null);
      });
    }

    // Battery status is unavailable in Safari; the native app covers iPad.
    if (navigator.getBattery) {
      navigator.getBattery().then(function (battery) {
        function check() {
          var percent = Math.round(battery.level * 100);
          setWarning('battery',
            (!battery.charging && percent <= 20) ? 'Battery ' + percent + '% · Plug in' : null);
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
    loadMonogram();
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
  /// False once we know the microphone is unavailable, which hides the video
  /// mode rather than offering a message that would record silence.
  var videoModeAvailable = true;

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

    var constraints = { video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } } };
    var wantAudio = config.enableVideo && supportsVideoRecording();

    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          Object.assign({}, constraints, { audio: wantAudio }));
      } catch (audioError) {
        // A booth that takes photos beats no booth: if the microphone is
        // refused or missing, carry on without the video guestbook.
        if (!wantAudio) throw audioError;
        stream = await navigator.mediaDevices.getUserMedia(
          Object.assign({}, constraints, { audio: false }));
      }

      videoModeAvailable = stream.getAudioTracks().length > 0;
      el.video.srcObject = stream;
      // Same stream, blurred, behind: it fills whatever the photo area cannot.
      if (el.videoBg) el.videoBg.srcObject = stream;
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

  // Keeps the iPad awake between guests. The browser releases the lock on its
  // own when the page hides, so re-request on the way back — but only when we
  // are not already holding a live one.
  var wakeLock = null;
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    if (wakeLock && !wakeLock.released) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {
      wakeLock = null;
    }
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

  /**
   * Size the preview so the region that actually reaches the photo is as large
   * as the screen allows, and mark it.
   *
   * The subtlety: a photo is a 4:3 centre crop of the camera, so the video and
   * the photo are different shapes. Scaling the video to fit the screen is the
   * wrong move -- it scales by the whole sensor, and on a portrait screen with
   * a landscape camera that left the actual photo area at 24% of the display.
   * Scaling by the CROP instead makes the photo area as big as it can be and
   * lets the rest of the sensor spill past the edges as context.
   */
  function syncCropRegion() {
    if (!el.crop || !el.frame) return;
    var rect = el.frame.getBoundingClientRect();
    var vw = el.video.videoWidth, vh = el.video.videoHeight;
    if (!rect.width || !rect.height || !vw || !vh) return;

    var crop = cropRect();
    var scale = Math.min(rect.width / crop.sw, rect.height / crop.sh);

    // The video is positioned by hand, so object-fit has nothing to do.
    el.video.style.width = Math.round(vw * scale) + 'px';
    el.video.style.height = Math.round(vh * scale) + 'px';

    var w = Math.round(crop.sw * scale), h = Math.round(crop.sh * scale);
    el.crop.style.width = w + 'px';
    el.crop.style.height = h + 'px';
    el.crop.style.left = Math.round((rect.width - w) / 2) + 'px';
    el.crop.style.top = Math.round((rect.height - h) / 2) + 'px';
    renderPropElements();
  }

  function cropRect() {
    var vw = el.video.videoWidth || 1280;
    var vh = el.video.videoHeight || 960;
    var target = 4 / 3;
    var sw, sh;
    if (vw / vh > target) { sh = vh; sw = vh * target; } else { sw = vw; sh = vw / target; }
    return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw: sw, sh: sh };
  }

  /**
   * One finished frame: mirrored and filtered, but *without* props. Props stay
   * data on the shot so each frame of a strip can carry its own, and so a guest
   * can still move them after the shutter has fired.
   */
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
    return canvas;
  }

  /**
   * A captured frame: the bare photo plus its own props. The props the guest
   * had on screen when the shutter fired are copied in, so the shot looks like
   * the preview, but from here on each frame owns them.
   */
  function newShot(width) {
    return { canvas: renderFrame(width), props: cloneProps(state.props), baked: null };
  }

  function cloneProps(props) {
    return props.map(function (prop) {
      return { id: nextPropId(), glyph: prop.glyph, src: prop.src, aspect: prop.aspect,
               anchor: prop.anchor, x: prop.x, y: prop.y, h: prop.h, r: prop.r };
    });
  }

  /** The shot with its props drawn in, ready to compose or thumbnail. */
  function frameImage(shot) {
    if (shot.baked) return shot.baked;
    if (!shot.props.length) { shot.baked = shot.canvas; return shot.baked; }

    var w = shot.canvas.width, h = shot.canvas.height;
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(shot.canvas, 0, 0);
    drawProps(ctx, w, h, shot.props);
    shot.baked = canvas;
    return canvas;
  }

  /** Call after editing a shot's props so the next compose redraws it. */
  function invalidateShot(shot) { if (shot) shot.baked = null; }

  /**
   * How large a prop renders. `h` is the prop's height as a fraction of the
   * frame; artwork keeps its own aspect ratio, emoji are square.
   */
  function propSize(prop, frameHeight) {
    var h = Math.max(prop.h * frameHeight * 0.85, 8);
    return { w: h * (prop.aspect || 1), h: h };
  }

  function propFontSize(prop, frameHeight) { return propSize(prop, frameHeight).h; }

  function drawProps(ctx, w, h, props) {
    (props || []).forEach(function (prop) {
      var size = propSize(prop, h);
      ctx.save();
      ctx.translate(prop.x * w, prop.y * h);
      ctx.rotate(prop.r * Math.PI / 180);
      if (prop.src) {
        var art = propArt(prop.src);
        // Artwork that has not finished loading is skipped rather than drawn
        // as a broken box; the guest can only place one once it has loaded.
        if (art) ctx.drawImage(art, -size.w / 2, -size.h / 2, size.w, size.h);
      } else {
        ctx.font = size.h + 'px "Apple Color Emoji", "Segoe UI Emoji", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(prop.glyph, 0, 0);
      }
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

  /// Decoded lazily and cached: the same monogram is drawn on every keepsake.
  var monogramImage = null;
  var monogramSource = '';

  function loadMonogram() {
    var source = (config.monogram || '').trim();
    if (!source) { monogramImage = null; monogramSource = ''; return; }
    if (source === monogramSource && monogramImage) return;

    var img = new Image();
    img.onload = function () { monogramImage = img; monogramSource = source; };
    img.onerror = function () { monogramImage = null; monogramSource = ''; };
    img.src = source;
  }

  /// Draws the monogram centred in `rect`, preserving its aspect ratio.
  function drawMonogram(ctx, x, y, width, height) {
    if (!monogramImage || !monogramImage.width || !monogramImage.height) return false;
    var scale = Math.min(width / monogramImage.width, height / monogramImage.height);
    var w = monogramImage.width * scale;
    var h = monogramImage.height * scale;
    ctx.drawImage(monogramImage, x + (width - w) / 2, y + (height - h) / 2, w, h);
    return true;
  }

  var SCRIPT_FAMILY = '"Snell Roundhand", "Zapfino", cursive';
  var ROUND_FAMILY = 'ui-rounded, -apple-system, system-ui, sans-serif';

  function drawHeaderFooter(ctx, x, width, headerTop, headerHeight, footerTop, footerHeight) {
    var name = config.celebrantName || 'Mis Quince';
    var date = (config.eventDate || '').trim();

    // A monogram takes the top of the header like a crest, and the name and
    // date share what is left.
    var top = headerTop;
    var remaining = headerHeight;
    if (monogramImage) {
      var crest = headerHeight * 0.38;
      if (drawMonogram(ctx, x + width / 2 - crest / 2, top, crest, crest)) {
        top += crest + headerHeight * 0.04;
        remaining = headerHeight - crest - headerHeight * 0.04;
      }
    }

    headerTop = top;
    headerHeight = remaining;
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

  function composeStrip(frames, signBand) {
    var W = 1200, pad = 60, gap = 26, header = 240, footer = 150;
    var band = signBand || 0;
    var cellW = W - pad * 2;
    var cellH = Math.round(cellW * 3 / 4);
    var H = header + frames.length * cellH + (frames.length - 1) * gap + footer + band;

    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d', { alpha: false });

    drawBackground(ctx, W, H);
    var y = header;
    frames.forEach(function (shot) {
      drawPhotoCell(ctx, frameImage(shot), pad, y, cellW, cellH);
      y += cellH + gap;
    });
    drawHeaderFooter(ctx, pad, cellW, 26, header - 44, H - band - footer + 14, footer - 34);
    if (band) drawSignatureBand(ctx, pad, H - band, cellW, band);
    return canvas;
  }

  function composeSingle(frame, signBand) {
    var W = 1800, pad = 70, header = 190, footer = 150;
    var band = signBand || 0;
    var photoW = W - pad * 2;
    var photoH = Math.round(photoW * 3 / 4);
    var H = header + photoH + footer + band;

    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d', { alpha: false });

    drawBackground(ctx, W, H);
    drawPhotoCell(ctx, frameImage(frame), pad, header, photoW, photoH);
    drawHeaderFooter(ctx, pad, photoW, 24, header - 44, H - band - footer + 14, footer - 34);
    if (band) drawSignatureBand(ctx, pad, H - band, photoW, band);
    return canvas;
  }

  /**
   * The guest's handwriting, inside the keepsake's own border rather than
   * bolted underneath it. Strokes are normalised to the band they were
   * written in, so a message spanning an iPad lands here at the same
   * proportions instead of being crushed into the keepsake's narrow column.
   */
  function drawSignatureBand(ctx, x, y, w, h) {
    var inset = Math.round(h * 0.1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h - inset);
    ctx.clip();
    ctx.translate(x, y);
    drawStrokes(ctx, state.signature.strokes, w, h - inset);
    ctx.restore();
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

  var propImages = {};
  var propArtLoaded = false;

  function propArt(src) {
    var img = propImages[src];
    return img && img.complete && img.naturalWidth ? img : null;
  }

  /**
   * Artwork props are PNGs (or any image the browser decodes) listed in
   * props/manifest.json:
   *
   *   [{ "src": "crown-gold.png", "label": "Corona", "sub": "Crown",
   *      "category": "corona" }]
   *
   * They must be served from the booth itself. A cross-origin image taints the
   * canvas, and `toBlob` then refuses to hand back the keepsake - the guest
   * would lose the photo, not just the prop. Anything that fails to load is
   * dropped from the palette rather than offered as a broken tile.
   */
  async function loadPropArt() {
    if (propArtLoaded) return;
    propArtLoaded = true;
    var manifest;
    try {
      var response = await fetch('props/manifest.json', { cache: 'no-cache' });
      if (!response.ok) return;
      manifest = await response.json();
    } catch (err) { return; }
    if (!Array.isArray(manifest)) return;

    var loaded = await Promise.all(manifest.map(function (entry) {
      if (!entry || typeof entry.src !== 'string') return null;
      var src = 'props/' + entry.src.replace(/^\/+/, '');
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          propImages[src] = img;
          resolve({ src: src, aspect: img.naturalWidth / img.naturalHeight,
                    label: entry.label || '', sub: entry.sub || '',
                    anchor: entry.anchor || null,
                    category: entry.category || 'corona' });
        };
        img.onerror = function () { resolve(null); };
        img.src = src;
      });
    }));

    var art = {};
    loaded.forEach(function (item) {
      if (!item) return;
      (art[item.category] = art[item.category] || []).push(item);
    });
    Object.keys(art).forEach(function (id) {
      var category = PROP_CATEGORIES.filter(function (c) { return c.id === id; })[0];
      if (!category) {
        category = { id: id, title: art[id][0].label || id, sub: art[id][0].sub || '', items: [] };
        PROP_CATEGORIES.push(category);
      }
      // Artwork leads the row, in manifest order: it is what we would rather
      // the guest reached for.
      category.items = art[id].concat(category.items);
    });
    buildControls();
  }

  var propSerial = 0;
  function nextPropId() { return 'p' + (++propSerial) + '-' + Date.now().toString(36); }

  /**
   * A layer of draggable props over some rectangle. The camera preview and the
   * post-capture decorator both use one; they differ only in the element they
   * sit over, the prop list they edit, and when editing is allowed.
   *
   *   host()    the element whose box the normalised coordinates map onto
   *   layer()   the absolutely-positioned container the nodes go in
   *   props()   the array being edited
   *   enabled() whether gestures are live right now
   *   onChange() called after a prop is added, removed or moved
   */
  function propLayer(opts) {
    function rect() { return opts.host().getBoundingClientRect(); }

    function place(node, prop, box) {
      node.style.width = box.w + 'px';
      node.style.height = box.h + 'px';
      node.style.fontSize = box.h + 'px';
      node.style.transform = 'translate(' + (prop.x * box.rw - box.w / 2) + 'px,' +
        (prop.y * box.rh - box.h / 2) + 'px) rotate(' + prop.r + 'deg)';
    }

    function boxFor(prop, r) {
      var size = propSize(prop, r.height);
      return { w: size.w, h: size.h, rw: r.width, rh: r.height };
    }

    function render() {
      var container = opts.layer();
      container.innerHTML = '';
      var r = rect();
      opts.props().forEach(function (prop) {
        var node = document.createElement('div');
        node.className = 'prop';
        if (prop.src) {
          var img = document.createElement('img');
          img.src = prop.src;
          img.alt = '';
          img.draggable = false;
          node.appendChild(img);
        } else {
          node.textContent = prop.glyph;
          node.style.display = 'grid';
          node.style.placeItems = 'center';
        }
        place(node, prop, boxFor(prop, r));
        attach(node, prop);
        container.appendChild(node);
      });
    }

    /** Drag with one finger, pinch/twist with two, double-tap to remove. */
    function attach(node, prop) {
      var pointers = new Map();
      var start = null;

      node.addEventListener('pointerdown', function (event) {
        if (!opts.enabled()) return;
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
            remove(prop.id);
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
          if (!pointers.size) changed();
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
        var r = rect();
        var centre = centreOf(list);

        prop.x = clamp(start.prop.x + (centre.x - start.centre.x) / r.width, -0.05, 1.05);
        prop.y = clamp(start.prop.y + (centre.y - start.centre.y) / r.height, -0.05, 1.05);

        if (list.length >= 2 && start.count >= 2 && start.spread > 0) {
          prop.h = clamp(start.prop.h * (spreadOf(list) / start.spread), 0.08, 0.8);
          prop.r = start.prop.r + (angleOf(list) - start.angle);
        }

        place(node, prop, boxFor(prop, r));
      }
    }

    function changed() { if (opts.onChange) opts.onChange(); noteActivity(); }

    function add(item) {
      var props = opts.props();
      if (props.length >= 8) { toast('¡Ya hay muchos! · That’s plenty of props'); return; }
      var offset = (props.length % 4) * 0.07;
      var prop = { id: nextPropId(), x: 0.4 + offset, y: 0.36 + offset * 0.4, h: 0.26, r: 0 };
      if (typeof item === 'string') prop.glyph = item;
      else { prop.src = item.src; prop.aspect = item.aspect || 1; prop.anchor = item.anchor || null; }
      // Anchored artwork lands on a face when the layer knows about one.
      if (opts.fit) opts.fit(prop);
      props.push(prop);
      render();
      changed();
    }

    function remove(id) {
      var props = opts.props();
      // Edit the array in place: the decorator hands us a shot's own prop list
      // and reassigning would only rebind our local copy.
      var keep = props.filter(function (p) { return p.id !== id; });
      props.length = 0;
      keep.forEach(function (p) { props.push(p); });
      render();
      changed();
    }

    function clear() {
      var props = opts.props();
      props.length = 0;
      render();
      changed();
    }

    return {
      render: render, add: add, remove: remove, clear: clear,
      count: function () { return opts.props().length; }
    };
  }

  /** The live layer over the camera preview. */
  var liveProps = propLayer({
    // #crop, not #frame: prop coordinates are fractions of the CAPTURED photo,
    // and the preview is now full-bleed, so the frame is bigger than the photo.
    host: function () { return el.crop; },
    layer: function () { return el.props; },
    props: function () { return state.props; },
    enabled: function () { return state.phase === 'ready'; },
    // So "Quitar todo" appears as soon as there is something to clear.
    onChange: function () { buildControls(); }
  });

  function renderPropElements() { liveProps.render(); }
  function addProp(item) { liveProps.add(item); }
  function clearProps() { liveProps.clear(); }

  // ---------------------------------------------------------------- UI build

  /**
   * Two-line control label: Spanish on top, English underneath. Built as text
   * nodes rather than innerHTML so a label can never smuggle in markup.
   */
  function setPillLabel(button, main, sub) {
    button.textContent = main;
    if (!sub) return;
    var span = document.createElement('span');
    span.className = 'sub';
    span.textContent = sub;
    button.appendChild(span);
  }

  function buildControls() {
    el.modeRow.innerHTML = '';
    var modes = enabledModes();
    if (modes.indexOf(state.mode) === -1) state.mode = modes[0];

    modes.forEach(function (id) {
      var button = document.createElement('button');
      button.className = 'pill' + (state.mode === id ? ' on' : '');
      setPillLabel(button, MODES[id].emoji + ' ' + MODES[id].title, MODES[id].sub);
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
      var glyph = document.createElement('span');
      glyph.className = 'emoji';
      glyph.textContent = filter.emoji;
      var name = document.createElement('span');
      setPillLabel(name, filter.title, filter.sub);
      button.appendChild(glyph);
      button.appendChild(name);
      button.addEventListener('click', function () {
        state.filter = filter;
        el.video.style.filter = filter.css;
        buildControls();
        noteActivity();
      });
      el.filterRow.appendChild(button);
    });

    buildPalette(el.propCats, el.propRow, liveProps, buildControls);
    applyTray();
  }

  /**
   * The capture screen used to show the filters AND the props at once, which
   * cost about 100px of a screen whose whole job is to show the guest their own
   * face. They share one row now, chosen by the pills above it.
   */
  function applyTray() {
    var filters = state.tray === 'filtros';
    el.filterRow.classList.toggle('hidden', !filters);
    el.propRow.classList.toggle('hidden', filters);
    // The hint is about props, so it only earns its space on a prop tray.
    el.propHint.classList.toggle('hidden', filters);
  }

  /**
   * The category pills and the prop tray. Shared by the camera screen and the
   * post-capture decorator so both always offer the same props.
   */
  function buildPalette(catsEl, rowEl, layer, rebuild) {
    catsEl.innerHTML = '';

    // Only the capture screen shares its row with the filters; the decorator
    // has no filters to show.
    if (catsEl === el.propCats) {
      var filterPill = document.createElement('button');
      filterPill.className = 'pill' + (state.tray === 'filtros' ? ' on' : '');
      setPillLabel(filterPill, '\ud83c\udfa8 Filtros', 'Looks');
      filterPill.addEventListener('click', function () {
        state.tray = 'filtros';
        rebuild();
        noteActivity();
      });
      catsEl.appendChild(filterPill);
    }

    PROP_CATEGORIES.forEach(function (category) {
      var button = document.createElement('button');
      var live = catsEl === el.propCats;
      var on = state.propCategory === category.id && (!live || state.tray === category.id);
      button.className = 'pill' + (on ? ' on' : '');
      setPillLabel(button, category.title, category.sub);
      button.addEventListener('click', function () {
        state.propCategory = category.id;
        if (live) state.tray = category.id;
        rebuild();
      });
      catsEl.appendChild(button);
    });

    rowEl.innerHTML = '';
    var active = PROP_CATEGORIES.filter(function (c) { return c.id === state.propCategory; })[0] || PROP_CATEGORIES[0];
    active.items.forEach(function (item) {
      var button = document.createElement('button');
      button.className = 'prop-btn' + (typeof item === 'string' ? '' : ' art');
      if (typeof item === 'string') {
        button.textContent = item;
        button.setAttribute('aria-label', 'Prop');
      } else {
        var img = document.createElement('img');
        img.src = item.src;
        img.alt = item.label || '';
        img.draggable = false;
        button.appendChild(img);
        button.setAttribute('aria-label', item.label || 'Prop');
      }
      button.addEventListener('click', function () { layer.add(item); });
      rowEl.appendChild(button);
    });

    var clearButton = document.createElement('button');
    clearButton.className = 'pill';
    clearButton.style.visibility = layer.count() ? 'visible' : 'hidden';
    setPillLabel(clearButton, 'Quitar todo', 'Clear all');
    clearButton.addEventListener('click', function () { layer.clear(); rebuild(); });
    catsEl.appendChild(clearButton);
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
    state.shots.forEach(function (shot) {
      var img = document.createElement('img');
      img.src = frameImage(shot).toDataURL('image/jpeg', 0.6);
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
    // The screen only has a size once it is visible.
    requestAnimationFrame(syncCropRegion);
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
    sayBoth('¡Miren a la cámara!', 'Look at the camera!');

    try {
      if (state.mode === 'video') {
        if (!(await runCountdown(3))) return abortCapture();
        await recordMessage();
      } else if (state.mode === 'boomerang') {
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
          state.shots.push(newShot(1440));
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

  /**
   * Build the keepsake from the shots and publish it.
   *
   * `keep` is set when the frames themselves did not change shape - decorating
   * an already-published keepsake - so any signature stays and the guest link
   * keeps its code. A fresh capture or a redone frame starts clean.
   */
  async function composeStills(keep) {
    processingOverlay();
    await sleep(30); // let the overlay paint before the main thread blocks
    if (!keep) state.signature = { mode: 'band', strokes: [] };
    var canvas = state.mode === 'strip' ? composeStrip(state.shots) : composeSingle(state.shots[0]);
    state.composed = canvas;
    await publishCanvas(canvas, keep ? (state.result && state.result.code) : undefined);
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
      // A boomerang is a single moving take, so there is nothing to decorate
      // afterwards: whatever props are on screen burn in as they are.
      drawProps(ctx, width, height, state.props);
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

    state.composed = null;
    state.signature = { mode: 'band', strokes: [] };
    finishWith(new Blob([bytes], { type: 'image/gif' }), 'image/gif', 'gif');
  }

  /// Renders the composed keepsake (plus any signature) to a file.
  async function publishCanvas(canvas, reuseCode) {
    var output = canvas;
    var signed = state.signature.strokes.length;
    if (signed && state.signature.mode === 'full') {
      output = document.createElement('canvas');
      output.width = canvas.width;
      output.height = canvas.height;
      var ctx = output.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      drawStrokes(ctx, state.signature.strokes, canvas.width, canvas.height);
    } else if (signed && state.shots.length) {
      // Rebuilt rather than appended to, so the border wraps the signature
      // instead of closing above it.
      output = state.mode === 'strip'
        ? composeStrip(state.shots, SIGN_BAND_HEIGHT)
        : composeSingle(state.shots[0], SIGN_BAND_HEIGHT);
    }
    var blob = await new Promise(function (resolve) {
      output.toBlob(resolve, 'image/jpeg', 0.92);
    });
    finishWith(blob, 'image/jpeg', 'jpg', '', reuseCode);
  }

  /// Strokes are stored normalised, so the same gesture scales from a phone
  /// preview to a 1200px print without redrawing anything.
  function drawStrokes(ctx, strokes, width, height) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    strokes.forEach(function (stroke) {
      if (stroke.points.length < 1) return;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = Math.max(stroke.width * width, 1);
      ctx.beginPath();
      stroke.points.forEach(function (point, index) {
        var x = point.x * width;
        var y = point.y * height;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      if (stroke.points.length === 1) {
        // A tap is a dot, not nothing.
        ctx.lineTo(stroke.points[0].x * width + 0.01, stroke.points[0].y * height);
      }
      ctx.stroke();
    });
    ctx.restore();
  }

  /// A short spoken message for the celebrant. Records the camera stream
  /// directly rather than a filtered canvas: a guestbook message is about the
  /// person talking, and the raw stream is far less to go wrong mid-party.
  async function recordMessage() {
    var mime = videoMimeType();
    if (!mime || !stream) {
      toast('No se puede grabar aquí · Recording unavailable');
      return abortCapture();
    }

    // Poster frame first, so the attract slideshow has something to show.
    var poster = renderFrame(640);
    drawProps(poster.getContext('2d'), poster.width, poster.height, state.props);

    var chunks = [];
    var recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime });
    } catch (err) {
      toast('No se puede grabar aquí · Recording unavailable');
      return abortCapture();
    }

    recorder.ondataavailable = function (event) {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    var stopped = new Promise(function (resolve) { recorder.onstop = resolve; });

    var finishEarly = false;
    var tapToFinish = function () { finishEarly = true; };
    el.frame.addEventListener('click', tapToFinish);

    sayBoth('¡Cuéntale algo bonito!', 'Say something sweet!');
    recorder.start();

    var total = config.videoSeconds * 1000;
    var startedAt = Date.now();
    var circumference = 2 * Math.PI * 64;

    while (!finishEarly && !state.cancelled && Date.now() - startedAt < total) {
      var elapsed = Date.now() - startedAt;
      var remaining = Math.max(0, Math.ceil((total - elapsed) / 1000));
      showOverlay(
        '<div class="overlay-stack">' +
        '<svg class="ring" viewBox="0 0 140 140">' +
        '<circle class="track" cx="70" cy="70" r="64"></circle>' +
        '<circle class="value" cx="70" cy="70" r="64" stroke-dasharray="' + circumference +
        '" stroke-dashoffset="' + (circumference * (elapsed / total)) + '"></circle></svg>' +
        '<div class="big">🔴 ' + remaining + 's</div>' +
        '<div class="big" style="font-size:.7em">Toca para terminar · Tap to finish</div></div>', 'dim');
      await sleep(120);
    }

    el.frame.removeEventListener('click', tapToFinish);

    try { recorder.stop(); } catch (e) { /* already stopped */ }
    await stopped;

    if (state.cancelled) return abortCapture();

    processingOverlay();
    await sleep(30);

    var container = mime.split(';')[0];
    var blob = new Blob(chunks, { type: container });
    if (!blob.size) {
      toast('La grabación salió vacía · Nothing was recorded');
      return abortCapture();
    }

    state.composed = null;
    state.signature = { mode: 'band', strokes: [] };
    finishWith(blob, container, container.indexOf('mp4') >= 0 ? 'mp4' : 'webm',
               poster.toDataURL('image/jpeg', 0.7));
  }

  function finishWith(blob, mime, extension, posterUrl, reuseCode) {
    if (state.result && state.result.url) URL.revokeObjectURL(state.result.url);
    var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    // The code is picked here, before anything is uploaded, so the QR can go
    // up immediately and the upload never blocks the guest.
    var code = reuseCode || (window.BoothShare && window.BoothShare.newCode()) || '';
    state.result = {
      blob: blob,
      mime: mime,
      mode: state.mode,
      code: code,
      isVideo: mime.indexOf('video/') === 0,
      url: URL.createObjectURL(blob),
      posterUrl: posterUrl || '',
      filename: 'photobooth-' + stamp + '.' + extension
    };
    keepKeepsake();

    el.resultImg.classList.toggle('hidden', state.result.isVideo);
    el.resultVideo.classList.toggle('hidden', !state.result.isVideo);
    if (state.result.isVideo) {
      el.resultVideo.src = state.result.url;
    } else {
      el.resultImg.src = state.result.url;
      el.printImg.src = state.result.url;
    }

    buildActions();
    buildRedoRow();
    showOverlay('');
    setPhase('review');
  }

  /**
   * Hands the finished keepsake to the store, which persists it and starts
   * the upload. Fire and forget: the guest is already looking at their photo,
   * and a failure here shows up as an operator warning rather than as
   * anything the guest has to care about.
   */
  function keepKeepsake() {
    if (!window.BoothShare || !state.result || !state.result.code) return;
    window.BoothShare.save(state.result.code, state.result.blob, {
      mime: state.result.mime,
      mode: state.result.mode,
      filename: state.result.filename
    });
  }

  // ---------------------------------------------------------------- signing

  var INKS = ['#0E3549', '#D3A238', '#FFFFFF', '#C2185B'];
  var signState = { mode: 'band', strokes: [], ink: INKS[0], drawing: null };

  /**
   * The signature band appended under the photos. A guest signing the whole
   * strip gets a 1:3 column to write in, which on a landscape iPad is about
   * an inch and a half wide -- unusable with a finger. Writing into a wide
   * band instead gives them the full screen, and the strokes land here.
   */
  var SIGN_BAND_HEIGHT = 320;

  function cloneStroke(stroke) {
    return { color: stroke.color, width: stroke.width, points: stroke.points.slice() };
  }

  function openSignSheet() {
    if (!state.composed) return;
    signState.mode = state.signature.mode || 'band';
    signState.strokes = state.signature.strokes.map(cloneStroke);
    signState.ink = INKS[0];

    // Backdrop is the UNSIGNED keepsake; existing ink is redrawn on the
    // overlay, so reopening the sheet never double-draws a stroke.
    el.signImg.src = state.composed.toDataURL('image/jpeg', 0.82);
    buildInkSwatches();
    el.signModal.classList.remove('hidden');
    applySignMode();

    if (el.signImg.complete) syncSignCanvas();
    else el.signImg.onload = syncSignCanvas;
    noteActivity();
  }

  /**
   * Switching mode throws the strokes away, because they are normalised to
   * whichever surface they were drawn on and mean nothing on the other one.
   * Only ask when there is something to lose.
   */
  function setSignMode(mode) {
    if (signState.mode === mode) return;
    if (signState.strokes.length &&
        !window.confirm('Cambiar borra lo que escribiste. ¿Seguir?\n\n'
                        + 'Switching clears what you wrote. Continue?')) return;
    signState.mode = mode;
    signState.strokes = [];
    signState.drawing = null;
    applySignMode();
    noteActivity();
  }

  function applySignMode() {
    var band = signState.mode === 'band';
    el.signStage.classList.toggle('band', band);
    el.signStage.classList.toggle('full', !band);
    el.signModeBand.classList.toggle('on', band);
    el.signModeFull.classList.toggle('on', !band);
    el.signScroll.classList.toggle('hidden', band);
    updateSignHint();
    // The stage changes shape, so the backing store has to follow it.
    requestAnimationFrame(syncSignCanvas);
  }

  function updateSignHint() {
    el.signHint.classList.toggle('gone', signState.strokes.length > 0);
  }

  /** Full mode scrolls by button: a two-finger gesture would fight the pen. */
  function scrollSign(direction) {
    var step = el.signStage.clientHeight * 0.7;
    el.signStage.scrollTop += direction * step;
    updateSignPos();
  }

  function updateSignPos() {
    if (signState.mode === 'band') return;
    var stage = el.signStage;
    var span = Math.max(1, stage.scrollHeight - stage.clientHeight);
    var pct = Math.round((stage.scrollTop / span) * 100);
    el.signPos.textContent = pct + '%';
    el.signUp.disabled = stage.scrollTop <= 1;
    el.signDown.disabled = stage.scrollTop >= span - 1;
  }

  function closeSignSheet() {
    el.signModal.classList.add('hidden');
    signState.drawing = null;
    noteActivity();
  }

  function buildInkSwatches() {
    el.signColors.innerHTML = '';
    INKS.forEach(function (color) {
      var button = document.createElement('button');
      button.className = 'ink' + (color === signState.ink ? ' on' : '');
      button.style.background = color;
      button.setAttribute('aria-label', 'Color ' + color);
      button.addEventListener('click', function () {
        signState.ink = color;
        buildInkSwatches();
      });
      el.signColors.appendChild(button);
    });
  }

  function syncSignCanvas() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w, h;

    if (signState.mode === 'band') {
      var stage = el.signStage.getBoundingClientRect();
      w = stage.width; h = stage.height;
    } else {
      // Track the keepsake itself, which is taller than the stage and
      // scrolls inside it.
      var img = el.signImg.getBoundingClientRect();
      w = img.width; h = img.height;
      el.signCanvas.style.height = h + 'px';
    }
    if (!w || !h) return;

    el.signCanvas.width = Math.round(w * dpr);
    el.signCanvas.height = Math.round(h * dpr);
    redrawSign();
    updateSignPos();
  }

  function redrawSign() {
    var ctx = el.signCanvas.getContext('2d');
    ctx.clearRect(0, 0, el.signCanvas.width, el.signCanvas.height);
    drawStrokes(ctx, signState.strokes, el.signCanvas.width, el.signCanvas.height);
  }

  function signPoint(event) {
    var rect = el.signCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height
    };
  }

  function bindSigning() {
    el.signCanvas.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      el.signCanvas.setPointerCapture(event.pointerId);
      signState.drawing = { color: signState.ink, width: 0.007, points: [signPoint(event)] };
      signState.strokes.push(signState.drawing);
      updateSignHint();
      redrawSign();
    });

    el.signCanvas.addEventListener('pointermove', function (event) {
      if (!signState.drawing) return;
      event.preventDefault();
      signState.drawing.points.push(signPoint(event));
      redrawSign();
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
      el.signCanvas.addEventListener(type, function () { signState.drawing = null; });
    });

    el.signModeBand.addEventListener('click', function () { setSignMode('band'); });
    el.signModeFull.addEventListener('click', function () { setSignMode('full'); });
    el.signUp.addEventListener('click', function () { scrollSign(-1); });
    el.signDown.addEventListener('click', function () { scrollSign(1); });
    el.signStage.addEventListener('scroll', updateSignPos);

    el.signUndo.addEventListener('click', function () {
      signState.strokes.pop();
      redrawSign();
      updateSignHint();
    });
    el.signClear.addEventListener('click', function () {
      signState.strokes = [];
      redrawSign();
      updateSignHint();
    });
    el.signCancel.addEventListener('click', closeSignSheet);
    el.signDone.addEventListener('click', async function () {
      state.signature = { mode: signState.mode, strokes: signState.strokes.map(cloneStroke) };
      closeSignSheet();
      // Reuse the code so a guest who already scanned the QR gets the
      // signed version rather than the one from before they signed.
      if (state.composed) {
        await publishCanvas(state.composed, state.result && state.result.code);
      }
    });

    window.addEventListener('resize', function () {
      if (!el.signModal.classList.contains('hidden')) syncSignCanvas();
    });
  }

  // ------------------------------------------------------- decorate a frame

  /**
   * Props after the fact. Props chosen at the camera are copied onto every
   * frame as it is shot, which is fine for a crown you wear through all four -
   * but a strip where each frame is decorated differently is the whole point of
   * a strip. Here each frame is shown one at a time, big, with its own props.
   */
  var decorIndex = 0;

  function decorShot() { return state.shots[decorIndex] || null; }

  var decorProps = propLayer({
    // The image, not its wrapper: the normalised coordinates are the photo's,
    // and letterboxing inside the stage would shift every prop.
    host: function () { return el.decorImg; },
    layer: function () { return el.decorProps; },
    props: function () { var shot = decorShot(); return shot ? shot.props : []; },
    enabled: function () { return !el.decorModal.classList.contains('hidden'); },
    // A crown dropped on a frame whose face we already know goes straight onto
    // the head, rather than into the middle for the guest to drag up.
    fit: function (prop) { fitPropToFace(prop, decorShot(), nextFaceIndex(decorShot())); },
    onChange: function () {
      invalidateShot(decorShot());
      buildDecorPalette();
      renderDecorFrames();
    }
  });

  // ---------------------------------------------------------- face anchoring

  /**
   * Faces are found once per frame and kept on the shot. Detection runs on the
   * capture canvas, which is already mirrored and cropped, so the coordinates
   * belong to the photo the guest actually receives - not the raw video.
   */
  async function facesFor(shot) {
    if (!shot || !window.BoothFaces) return [];
    if (shot.faces) return shot.faces;
    if (shot.facesPending) return shot.facesPending;
    shot.facesPending = window.BoothFaces.detect(shot.canvas).then(function (found) {
      shot.faces = found;
      shot.facesPending = null;
      return found;
    }).catch(function () {
      shot.faces = [];
      shot.facesPending = null;
      return [];
    });
    return shot.facesPending;
  }

  /** Spread props across the faces present, so four heads get four crowns. */
  function nextFaceIndex(shot) {
    if (!shot || !shot.faces || shot.faces.length < 2) return 0;
    var anchored = shot.props.filter(function (p) { return p.anchor; }).length;
    return anchored % shot.faces.length;
  }

  function fitPropToFace(prop, shot, faceIndex) {
    if (!prop || !prop.anchor || !shot || !shot.faces || !shot.faces.length) return false;
    if (!window.BoothFaces) return false;
    var face = shot.faces[Math.min(faceIndex || 0, shot.faces.length - 1)];
    var placed = window.BoothFaces.place(face, prop.anchor, prop.aspect || 1,
                                         { w: shot.canvas.width, h: shot.canvas.height });
    if (!placed) return false;
    prop.x = placed.x;
    prop.y = placed.y;
    prop.h = clamp(placed.h, 0.08, 0.8);
    prop.r = placed.r;
    return true;
  }

  /** The "a la cara" button: re-snap everything anchored on this frame. */
  async function fitAllToFaces() {
    var shot = decorShot();
    if (!shot) return;
    var anchored = shot.props.filter(function (p) { return p.anchor; });
    if (!anchored.length) {
      toast('Primero elige una corona \u00b7 Add a crown or mask first');
      return;
    }

    setDecorBusy(true);
    var faces = await facesFor(shot);
    setDecorBusy(false);

    if (!faces.length) {
      toast(window.BoothFaces && window.BoothFaces.unavailable()
        ? 'No se pudo cargar \u00b7 Face fitting unavailable'
        : 'No encontr\u00e9 una cara \u00b7 No face found - drag it yourself');
      return;
    }

    var fitted = 0;
    anchored.forEach(function (prop, index) {
      if (fitPropToFace(prop, shot, index % faces.length)) fitted++;
    });
    invalidateShot(shot);
    decorProps.render();
    renderDecorFrames();
    if (fitted) toast(faces.length > 1
      ? '\u00a1Listo! \u00b7 Fitted to ' + faces.length + ' faces'
      : '\u00a1Listo! \u00b7 Fitted to the face');
    noteActivity();
  }

  function setDecorBusy(busy) {
    el.decorFit.disabled = busy;
    el.decorFit.classList.toggle('busy', busy);
  }


  function canDecorate() {
    return state.shots.length > 0 && (state.mode === 'strip' || state.mode === 'single');
  }

  function openDecorSheet() {
    if (!canDecorate()) return;
    decorIndex = 0;
    el.decorModal.classList.remove('hidden');
    showDecorFrame();
    noteActivity();
  }

  function closeDecorSheet() {
    el.decorModal.classList.add('hidden');
    el.decorProps.innerHTML = '';
  }

  function showDecorFrame() {
    var shot = decorShot();
    if (!shot) return closeDecorSheet();

    // Warm the detector for this frame in the background: by the time the
    // guest has picked a crown, the face is usually already known.
    facesFor(shot);

    // The backdrop is the bare photo; the props on top are live nodes, so
    // reopening never shows a prop twice.
    if (!shot.previewUrl) shot.previewUrl = shot.canvas.toDataURL('image/jpeg', 0.82);
    var wasSrc = el.decorImg.getAttribute('src');
    el.decorImg.src = shot.previewUrl;

    renderDecorFrames();
    buildDecorPalette();
    if (wasSrc === shot.previewUrl && el.decorImg.complete) decorProps.render();
    else el.decorImg.onload = function () { decorProps.render(); };
  }

  function buildDecorPalette() {
    buildPalette(el.decorCats, el.decorRow, decorProps, buildDecorPalette);
  }

  /** Thumbnails of every frame, so the guest can see and pick what to decorate. */
  function renderDecorFrames() {
    el.decorFrames.innerHTML = '';
    if (state.shots.length < 2) return;
    state.shots.forEach(function (shot, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'decor-frame' + (index === decorIndex ? ' on' : '');
      button.setAttribute('aria-label', 'Foto ' + (index + 1));
      var img = document.createElement('img');
      img.src = frameImage(shot).toDataURL('image/jpeg', 0.5);
      img.alt = '';
      button.appendChild(img);
      var badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = index + 1;
      button.appendChild(badge);
      button.addEventListener('click', function () {
        if (index === decorIndex) return;
        decorIndex = index;
        showDecorFrame();
        noteActivity();
      });
      el.decorFrames.appendChild(button);
    });
  }

  function wireDecorSheet() {
    el.decorFit.addEventListener('click', fitAllToFaces);
    el.decorCancel.addEventListener('click', function () {
      closeDecorSheet();
      noteActivity();
    });
    el.decorDone.addEventListener('click', async function () {
      closeDecorSheet();
      // Keep the signature and the guest link: only the pixels inside the
      // frames changed, so anyone who already scanned gets the decorated one.
      await composeStills(true);
    });
    window.addEventListener('resize', function () {
      if (!el.decorModal.classList.contains('hidden')) decorProps.render();
    });
  }

  // ---------------------------------------------------------------- review

  /// A single blink should not cost the guest all four shots.
  function buildRedoRow() {
    var canRedo = state.result && state.result.mode === 'strip' && state.shots.length > 1;
    el.redoRow.classList.toggle('hidden', !canRedo);
    el.redoThumbs.innerHTML = '';
    if (!canRedo) return;

    state.shots.forEach(function (shot, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Repetir foto ' + (index + 1));

      var img = document.createElement('img');
      img.src = frameImage(shot).toDataURL('image/jpeg', 0.6);
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
    sayBoth('¡Otra vez!', 'One more!');

    try {
      if (!(await runCountdown(Math.max(2, config.countdownSeconds - 1)))) {
        state.redoIndex = -1;
        showOverlay('');
        setPhase('review');
        return;
      }

      showOverlay('', 'flash');
      shutter();
      state.shots[index] = newShot(1440);
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

  function qrCard(url, title, subtitle) {
    var svg = qrSvg(url);
    if (!svg) return;
    var card = document.createElement('div');
    card.className = 'album-card';
    var qr = document.createElement('div');
    qr.className = 'qr';
    qr.innerHTML = svg;                       // built here from a fixed grid
    var heading = document.createElement('div');
    heading.className = 'qr-title';
    heading.textContent = title;
    var sub = document.createElement('div');
    sub.className = 'qr-sub';
    sub.textContent = subtitle;
    card.appendChild(qr);
    card.appendChild(heading);
    card.appendChild(sub);
    el.actionPane.appendChild(card);
  }

  function buildActions() {
    el.actionPane.innerHTML = '';

    // A QR for this one photo when the handoff Worker is configured,
    // otherwise the album QR this build has always shown.
    var mine = state.result.code && window.BoothShare
      ? window.BoothShare.linkFor(state.result.code) : '';
    if (mine) {
      qrCard(mine, 'Escanea para llevártela', 'Scan to take this one home');
    } else {
      var album = albumLink();
      if (album) {
        qrCard(album, 'Escanea para todas las fotos', 'Scan for every photo from tonight');
      }
    }

    var file = new File([state.result.blob], state.result.filename, { type: state.result.mime });
    var canShareFile = config.enableShare && navigator.canShare && navigator.canShare({ files: [file] });

    if (canDecorate()) {
      addAction('🎨', 'Decorar', 'Add props to each photo', openDecorSheet);
    }

    if (config.enableSign && state.composed) {
      addAction('✍️', 'Firmar', 'Sign it', openSignSheet);
    }

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

    if (config.enablePrint && !state.result.isVideo) {
      addAction('🖨️', 'Imprimir', 'AirPrint', function () {
        noteActivity();
        window.print();
      });
    }

    var hint = document.createElement('p');
    hint.className = 'hint';
    hint.style.textAlign = 'center';
    hint.textContent = state.result.isVideo
      ? 'Guarda o comparte el mensaje antes de terminar — no se queda en la tablet.'
        + '  ·  Save or share the message before you finish — it does not stay on the tablet.'
      : 'Para guardarla en Fotos: mantén presionada la imagen → Añadir a Fotos.'
        + '  ·  To keep it: press and hold the photo, then Add to Photos.';
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
      if (state.result.isVideo) {
        retainVideo(state.result.url);
        if (state.result.posterUrl) rememberKeepsake(state.result.posterUrl);
      } else {
        rememberKeepsake(state.result.url);
      }
      state.result = null;
    }
    state.composed = null;
    state.signature = { mode: 'band', strokes: [] };
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

  // Operator-facing, so English: whoever runs the booth is reading this in a
  // dim room with a queue forming, and no guest ever sees this panel.
  var ADMIN_FIELDS = [
    { group: 'Event', key: 'celebrantName', label: 'Quinceañera', type: 'text' },
    { key: 'eventDate', label: 'Date', type: 'text' },
    { key: 'hashtag', label: 'Hashtag', type: 'text' },
    { group: 'Colors', key: 'theme', label: 'Theme', type: 'choice',
      options: [['light', 'Light'], ['dark', 'Dark']] },
    { key: 'accent', label: 'Main color', type: 'text', placeholder: 'auto' },
    { key: 'secondary', label: 'Secondary color', type: 'text', placeholder: 'auto' },
    { group: 'Modes', key: 'enableStrip', label: 'Photo strip', type: 'bool' },
    { key: 'enableSingle', label: 'Single photo', type: 'bool' },
    { key: 'enableBoomerang', label: 'Boomerang GIF', type: 'bool' },
    { group: 'Capture', key: 'countdownSeconds', label: 'Countdown (s)', type: 'number', min: 1, max: 10 },
    { key: 'stripShotCount', label: 'Shots per strip', type: 'number', min: 2, max: 6 },
    { key: 'idleResetSeconds', label: 'Auto-reset (s)', type: 'number', min: 15, max: 600 },
    { group: 'Booth', key: 'voice', label: 'Spoken countdown', type: 'bool' },
    { key: 'enableVideo', label: 'Video message', type: 'bool' },
    { key: 'videoSeconds', label: 'Message length (s)', type: 'number', min: 5, max: 60 },
    { key: 'enableSign', label: 'Let guests sign the photo', type: 'bool' },
    { group: 'Monogram', key: 'monogram', label: 'Image', type: 'file' },
    { key: 'slideshow', label: "Show tonight's photos", type: 'bool' },
    { group: 'Sharing', key: 'enableShare', label: 'Share button', type: 'bool' },
    { key: 'enablePrint', label: 'Print (AirPrint)', type: 'bool' },
    { group: 'Album', key: 'albumUrl', label: 'Album link', type: 'text', placeholder: 'https://…' },
    { group: 'Photo handoff', key: 'uploadUrl', label: 'Worker URL', type: 'text',
      placeholder: 'https://….workers.dev' },
    { key: 'uploadKey', label: 'Booth key', type: 'text' },
    { group: 'Security', key: 'adminPIN', label: 'PIN', type: 'text' }
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
      if (field.type === 'file') {
        control = document.createElement('input');
        control.type = 'file';
        control.accept = 'image/png,image/jpeg,image/svg+xml';
        control.id = 'admin-' + field.key;
        control.addEventListener('change', function () {
          var picked = control.files && control.files[0];
          if (!picked) return;
          // Stored as a data URL in localStorage: same-origin, so it never
          // taints the canvas, and it survives without a hosting step.
          if (picked.size > 250 * 1024) {
            toast('Imagen muy grande · Keep it under 250 KB');
            control.value = '';
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            config[field.key] = String(reader.result);
            saveConfig();
            applyTheme();
            buildAdmin();
            toast('Monograma actualizado');
          };
          reader.readAsDataURL(picked);
        });
        label.appendChild(control);
        el.adminBody.appendChild(label);

        if ((config[field.key] || '').trim()) {
          var preview = document.createElement('label');
          var thumb = document.createElement('img');
          thumb.src = config[field.key];
          thumb.alt = '';
          thumb.style.height = '44px';
          thumb.style.background = 'rgba(0,0,0,.06)';
          thumb.style.borderRadius = '8px';
          preview.appendChild(thumb);

          var clear = document.createElement('button');
          clear.className = 'btn';
          clear.style.padding = '8px 14px';
          clear.textContent = 'Quitar';
          clear.addEventListener('click', function () {
            config[field.key] = '';
            saveConfig();
            applyTheme();
            buildAdmin();
          });
          preview.appendChild(clear);
          el.adminBody.appendChild(preview);
        }
        return;
      }

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
    note.textContent = 'Leave the colors blank to use the theme\u2019s own. Reset clears this '
      + 'device\u2019s settings and returns to the values from the link (the URL parameters your MDM sends).';
    el.adminBody.appendChild(note);
  }

  function bindAdmin() {
    var holdTimer;
    /**
     * Press and hold to reach the settings. Three things made this unreliable
     * on a tablet:
     *
     *  - `pointerleave` cancelled it. A finger resting for three seconds rolls
     *    and drifts, and leaving the box by a pixel killed the hold silently.
     *    The pointer is captured instead, so the gesture belongs to this
     *    element until it is released.
     *  - There was no feedback at all. Three seconds of nothing is
     *    indistinguishable from pressing the wrong place, so the only way to
     *    learn it was not working was to give up.
     *  - Touch scrolling could steal the gesture; `touch-action: none` in the
     *    stylesheet stops that.
     */
    function endHold() {
      clearTimeout(holdTimer);
      holdTimer = null;
      el.hotcorner.classList.remove('holding');
    }

    el.hotcorner.addEventListener('pointerdown', function (event) {
      if (holdTimer) return;
      try { el.hotcorner.setPointerCapture(event.pointerId); } catch (e) { /* mouse, or unsupported */ }
      el.hotcorner.classList.add('holding');
      holdTimer = setTimeout(function () {
        endHold();
        el.pinInput.value = '';
        el.pinError.style.display = 'none';
        el.pinModal.classList.remove('hidden');
        // The keyboard should be up: the operator is here to type a PIN.
        setTimeout(function () { try { el.pinInput.focus(); } catch (e) {} }, 60);
      }, HOLD_MS);
    });
    ['pointerup', 'pointercancel'].forEach(function (type) {
      el.hotcorner.addEventListener(type, endHold);
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
    el.video.addEventListener('loadedmetadata', syncCropRegion);
    el.video.addEventListener('resize', syncCropRegion);
    window.addEventListener('resize', syncCropRegion);
    window.addEventListener('orientationchange', function () {
      setTimeout(syncCropRegion, 320);
    });

    // A booth screen should never show a context menu or a text cursor.
    document.addEventListener('contextmenu', function (event) {
      if (event.target !== el.resultImg) event.preventDefault();
    });
    document.addEventListener('gesturestart', function (event) { event.preventDefault(); });
  }

  if (window.BoothShare) {
    window.BoothShare.init({
      uploadBase: config.uploadUrl,
      uploadKey: config.uploadKey
    });
  }

  applyTheme();
  buildSparkles();
  buildControls();
  bind();
  bindAdmin();
  bindSigning();
  wireDecorSheet();
  watchHealth();
  loadPropArt();
  setPhase('attract');

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
