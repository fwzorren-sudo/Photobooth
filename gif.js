/*
 * Minimal GIF89a encoder for the web photo booth.
 *
 * The booth has to work on a venue's flaky Wi-Fi, or none at all, so it
 * cannot pull a GIF library off a CDN. This is a from-scratch encoder:
 * a fixed 6x6x6 colour cube with ordered dithering (fast and parallel-safe,
 * unlike error diffusion) plus a standard variable-width LZW coder.
 */
(function (global) {
  'use strict';

  // 6 levels per channel = 216 colours, indices 0..215.
  var LEVELS = 6;
  var STEP = 255 / (LEVELS - 1); // 51

  // 4x4 Bayer matrix, normalised to -0.5..0.5 when divided by 16 and shifted.
  var BAYER = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5
  ];

  function buildPalette() {
    var table = new Uint8Array(256 * 3);
    var i = 0;
    for (var r = 0; r < LEVELS; r++) {
      for (var g = 0; g < LEVELS; g++) {
        for (var b = 0; b < LEVELS; b++) {
          table[i++] = Math.round(r * STEP);
          table[i++] = Math.round(g * STEP);
          table[i++] = Math.round(b * STEP);
        }
      }
    }
    // Remaining slots stay black; nothing indexes them.
    return table;
  }

  /**
   * RGBA bytes -> palette indices, with ordered dithering so gradients and
   * skin tones do not band badly at only 216 colours.
   */
  function quantize(rgba, width, height) {
    var out = new Uint8Array(width * height);
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var p = (y * width + x) * 4;
        var bias = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.46875) * STEP;

        var r = clampLevel((rgba[p] + bias) / STEP);
        var g = clampLevel((rgba[p + 1] + bias) / STEP);
        var b = clampLevel((rgba[p + 2] + bias) / STEP);

        out[y * width + x] = (r * LEVELS + g) * LEVELS + b;
      }
    }
    return out;
  }

  function clampLevel(value) {
    var v = Math.round(value);
    return v < 0 ? 0 : (v > LEVELS - 1 ? LEVELS - 1 : v);
  }

  /**
   * GIF variable-width LZW. Follows the classic `compress` behaviour: the
   * code width grows only after the code that filled the table is emitted.
   */
  function lzwEncode(minCodeSize, pixels) {
    var clearCode = 1 << minCodeSize;
    var eoiCode = clearCode + 1;

    var nBits = minCodeSize + 1;
    var maxCode = (1 << nBits) - 1;
    var next = eoiCode + 1;
    var dict = new Map();

    var out = [];
    var acc = 0;
    var accBits = 0;

    function emit(code) {
      acc |= code << accBits;
      accBits += nBits;
      while (accBits >= 8) {
        out.push(acc & 0xff);
        acc >>= 8;
        accBits -= 8;
      }
    }

    function resetTable() {
      dict.clear();
      next = eoiCode + 1;
      nBits = minCodeSize + 1;
      maxCode = (1 << nBits) - 1;
    }

    emit(clearCode);

    if (pixels.length === 0) {
      emit(eoiCode);
      if (accBits > 0) out.push(acc & 0xff);
      return out;
    }

    var prefix = pixels[0];

    for (var i = 1; i < pixels.length; i++) {
      var k = pixels[i];
      var key = prefix * 256 + k;
      var found = dict.get(key);

      if (found !== undefined) {
        prefix = found;
        continue;
      }

      emit(prefix);

      if (next < 4095) {
        // The width must grow based on the table size as it stood when the
        // code above was emitted, before this new entry lands - matching the
        // reference `compress`/giflib behaviour that every decoder expects.
        if (next > maxCode && nBits < 12) {
          nBits++;
          maxCode = (1 << nBits) - 1;
        }
        dict.set(key, next);
        next++;
      } else {
        emit(clearCode);
        resetTable();
      }

      prefix = k;
    }

    emit(prefix);
    emit(eoiCode);
    if (accBits > 0) out.push(acc & 0xff);
    return out;
  }

  function pushSubBlocks(bytes, data) {
    for (var offset = 0; offset < data.length; offset += 255) {
      var chunk = data.slice(offset, offset + 255);
      bytes.push(chunk.length);
      for (var i = 0; i < chunk.length; i++) bytes.push(chunk[i]);
    }
    bytes.push(0);
  }

  function pushShort(bytes, value) {
    bytes.push(value & 0xff, (value >> 8) & 0xff);
  }

  /**
   * frames: array of { data: Uint8ClampedArray (RGBA), width, height }
   * delay:  seconds between frames
   * Returns a Uint8Array containing a complete, infinitely looping GIF.
   */
  function encode(frames, delay) {
    if (!frames.length) throw new Error('No frames to encode');

    var width = frames[0].width;
    var height = frames[0].height;
    var delayHundredths = Math.max(2, Math.round(delay * 100));
    var palette = buildPalette();
    var bytes = [];

    // Header + logical screen descriptor.
    'GIF89a'.split('').forEach(function (ch) { bytes.push(ch.charCodeAt(0)); });
    pushShort(bytes, width);
    pushShort(bytes, height);
    bytes.push(0xf7); // global colour table, 8-bit colour, 256 entries
    bytes.push(0);    // background colour index
    bytes.push(0);    // pixel aspect ratio
    for (var i = 0; i < palette.length; i++) bytes.push(palette[i]);

    // NETSCAPE2.0 application extension: loop forever.
    bytes.push(0x21, 0xff, 0x0b);
    'NETSCAPE2.0'.split('').forEach(function (ch) { bytes.push(ch.charCodeAt(0)); });
    bytes.push(0x03, 0x01);
    pushShort(bytes, 0);
    bytes.push(0);

    frames.forEach(function (frame) {
      // Graphic control extension: disposal method 1 (leave in place).
      bytes.push(0x21, 0xf9, 0x04, 0x04);
      pushShort(bytes, delayHundredths);
      bytes.push(0, 0);

      // Image descriptor.
      bytes.push(0x2c);
      pushShort(bytes, 0);
      pushShort(bytes, 0);
      pushShort(bytes, width);
      pushShort(bytes, height);
      bytes.push(0); // no local colour table, not interlaced

      var indices = quantize(frame.data, width, height);
      bytes.push(8); // LZW minimum code size
      pushSubBlocks(bytes, lzwEncode(8, indices));
    });

    bytes.push(0x3b); // trailer
    return new Uint8Array(bytes);
  }

  var api = { encode: encode, quantize: quantize, lzwEncode: lzwEncode, buildPalette: buildPalette };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.BoothGIF = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
