/*
 * Face-anchored props.
 *
 * Finding a face is Google's BlazeFace, vendored under vendor/tfjs so the booth
 * still works when the hall has no Wi-Fi. It gives, per face, a box and six
 * landmarks: both eyes, the nose, the mouth and both ears. That is all the
 * geometry a crown needs.
 *
 * The placement maths below is deliberately separate from the model and takes
 * plain numbers, so it can be tested without a camera or a face.
 *
 * Coordinates: everything here is in the pixel space of whatever image was
 * handed to `detect`. The booth passes the ALREADY MIRRORED capture canvas, not
 * the raw video, so these land on the photo the guest actually gets.
 */
(function () {
  'use strict';

  var SCRIPTS = [
    'vendor/tfjs/tf-core.min.js',
    'vendor/tfjs/tf-converter.min.js',
    'vendor/tfjs/tf-backend-webgl.min.js',
    // The CPU backend is the safety net. WebGL is what makes this quick, but a
    // locked-down browser, an exhausted GPU or a headless test rig can leave
    // tfjs with no backend at all, and then nothing works. CPU is slower by an
    // order of magnitude and still fast enough: we detect once per frame when
    // a guest asks, not sixty times a second.
    'vendor/tfjs/tf-backend-cpu.min.js',
    'vendor/tfjs/blazeface.min.js'
  ];
  var MODEL_URL = 'vendor/tfjs/model/model.json';

  /** Below this the "face" is usually a bit of the backdrop. */
  var MIN_CONFIDENCE = 0.75;

  var model = null;
  var loadPromise = null;
  var loadFailed = false;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = function () { reject(new Error('could not load ' + src)); };
      document.head.appendChild(tag);
    });
  }

  /**
   * Pulls in ~1.5MB of model and runtime, so it is deliberately not part of
   * boot: nothing loads until a guest first asks for a face-anchored prop.
   */
  function load() {
    if (model) return Promise.resolve(model);
    if (loadFailed) return Promise.resolve(null);
    if (loadPromise) return loadPromise;

    loadPromise = (async function () {
      try {
        for (var i = 0; i < SCRIPTS.length; i++) await loadScript(SCRIPTS[i]);
        if (!window.blazeface || !window.tf) throw new Error('face libraries missing');
        await window.tf.ready();
        model = await window.blazeface.load({ modelUrl: MODEL_URL });
        return model;
      } catch (err) {
        // A booth that cannot find a face still has to take photographs.
        loadFailed = true;
        return null;
      }
    })();
    return loadPromise;
  }

  function point(pair) { return { x: pair[0], y: pair[1] }; }

  /** BlazeFace hands back tensors or arrays depending on the flag; normalise. */
  function toArray(value) {
    if (!value) return null;
    if (typeof value.arraySync === 'function') return value.arraySync();
    return value;
  }

  /**
   * Faces in the image, largest first. Returns [] rather than throwing when
   * there is no model, no face, or the detector falls over.
   */
  async function detect(source) {
    var net = await load();
    if (!net) return [];

    var raw;
    try {
      raw = await net.estimateFaces(source, false);
    } catch (err) {
      return [];
    }

    var faces = [];
    (raw || []).forEach(function (item) {
      var topLeft = toArray(item.topLeft);
      var bottomRight = toArray(item.bottomRight);
      var marks = toArray(item.landmarks);
      var probability = toArray(item.probability);
      var score = Array.isArray(probability) ? probability[0] : probability;
      if (!topLeft || !bottomRight || !marks || marks.length < 6) return;
      if (typeof score === 'number' && score < MIN_CONFIDENCE) return;

      // BlazeFace landmark order: right eye, left eye, nose, mouth, right ear,
      // left ear -- "right" being the subject's right, so the image's left.
      faces.push({
        score: typeof score === 'number' ? score : 1,
        box: { x: topLeft[0], y: topLeft[1],
               w: bottomRight[0] - topLeft[0], h: bottomRight[1] - topLeft[1] },
        eyeRight: point(marks[0]),
        eyeLeft: point(marks[1]),
        nose: point(marks[2]),
        mouth: point(marks[3]),
        earRight: point(marks[4]),
        earLeft: point(marks[5])
      });
    });

    faces.sort(function (a, b) { return b.box.w * b.box.h - a.box.w * a.box.h; });
    return faces;
  }

  // ------------------------------------------------------------- placement

  /**
   * Where each anchor sits, in units of the distance between the eyes.
   *
   *   width  how wide the artwork should be
   *   rise   how far along the "up" axis from the eye line its seat sits;
   *          negative is down the face
   *   side   sideways offset along the eye line
   *   seat   which part of the ARTWORK rests on that point, as a fraction from
   *          the top of the image. 0.5 centres it; a crown's seat is the
   *          bottom of its band, near 1.
   *
   * A prop's own `anchor` in props/manifest.json can override any of these.
   */
  var ANCHORS = {
    crown: { width: 2.40, rise: 1.35, side: 0, seat: 0.93 },
    eyes:  { width: 2.60, rise: 0.00, side: 0, seat: 0.50 },
    nose:  { width: 1.55, rise: -0.62, side: 0, seat: 0.38 },
    mouth: { width: 1.30, rise: -1.05, side: 0, seat: 0.42 },
    chest: { width: 5.00, rise: -4.40, side: 0, seat: 0.50 },
    beside:{ width: 3.20, rise: 1.05, side: 2.35, seat: 0.50 }
  };

  function anchorFor(spec) {
    if (!spec) return null;
    var name = typeof spec === 'string' ? spec : spec.at;
    var base = ANCHORS[name];
    if (!base) return null;
    if (typeof spec === 'string') return base;
    return {
      width: spec.width != null ? spec.width : base.width,
      rise: spec.rise != null ? spec.rise : base.rise,
      side: spec.side != null ? spec.side : base.side,
      seat: spec.seat != null ? spec.seat : base.seat
    };
  }

  function knownAnchor(spec) { return !!anchorFor(spec); }

  /**
   * Turn a face plus an anchor into the four numbers a prop is made of.
   *
   * `aspect` is the artwork's width over its height, `frame` the size of the
   * image the face was found in. Returns null when the anchor is unknown, so
   * callers can fall back to dropping the prop in the middle.
   */
  function place(face, spec, aspect, frame) {
    var anchor = anchorFor(spec);
    if (!face || !anchor || !frame || !frame.w || !frame.h) return null;

    var dx = face.eyeLeft.x - face.eyeRight.x;
    var dy = face.eyeLeft.y - face.eyeRight.y;
    var eyeSpan = Math.hypot(dx, dy);
    if (!(eyeSpan > 0)) return null;

    // Along the eye line, and square to it pointing at the top of the head.
    var ex = dx / eyeSpan, ey = dy / eyeSpan;
    var ux = ey, uy = -ex;

    var midX = (face.eyeLeft.x + face.eyeRight.x) / 2;
    var midY = (face.eyeLeft.y + face.eyeRight.y) / 2;

    var width = anchor.width * eyeSpan;
    var height = width / (aspect || 1);

    var seatX = midX + ux * anchor.rise * eyeSpan + ex * anchor.side * eyeSpan;
    var seatY = midY + uy * anchor.rise * eyeSpan + ey * anchor.side * eyeSpan;

    // The seat is a point on the artwork, not its centre, so step back from it
    // along the up axis by however far the centre is from the seat.
    var offset = (anchor.seat - 0.5) * height;
    var centreX = seatX + ux * offset;
    var centreY = seatY + uy * offset;

    return {
      x: centreX / frame.w,
      y: centreY / frame.h,
      // Undo propSize()'s 0.85, so `h` means what it means everywhere else.
      h: height / (frame.h * 0.85),
      r: Math.atan2(dy, dx) * 180 / Math.PI
    };
  }

  window.BoothFaces = {
    detect: detect,
    load: load,
    place: place,
    knownAnchor: knownAnchor,
    anchors: ANCHORS,
    ready: function () { return !!model; },
    unavailable: function () { return loadFailed; }
  };
})();
