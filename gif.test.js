// Independent GIF89a parser + LZW decoder, written from the decoder side of
// the spec, used to validate the booth's encoder byte-for-byte.
const assert = require('assert');
const gif = require('./gif.js');

function lzwDecode(minCodeSize, bytes, pixelCount) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let dict, nBits;

  const reset = () => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict.push([i]);
    dict.push(null, null);            // clear, eoi placeholders
    nBits = minCodeSize + 1;
  };
  reset();

  const out = [];
  let acc = 0, accBits = 0, pos = 0, prev = null;

  while (true) {
    while (accBits < nBits) {
      if (pos >= bytes.length) return out;
      acc |= bytes[pos++] << accBits;
      accBits += 8;
    }
    const code = acc & ((1 << nBits) - 1);
    acc >>>= nBits;
    accBits -= nBits;

    if (code === clearCode) { reset(); prev = null; continue; }
    if (code === eoiCode) break;

    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (code === dict.length && prev) entry = prev.concat([prev[0]]);
    else throw new Error(`bad code ${code} (table ${dict.length}, nBits ${nBits})`);

    for (const v of entry) out.push(v);

    if (prev) {
      dict.push(prev.concat([entry[0]]));
      if (dict.length >= (1 << nBits) && nBits < 12) nBits++;
    }
    prev = entry;
  }
  return out;
}

// ---- LZW round trips -------------------------------------------------------

function roundTrip(name, pixels) {
  const encoded = gif.lzwEncode(8, Uint8Array.from(pixels));
  const decoded = lzwDecode(8, encoded, pixels.length);
  assert.strictEqual(decoded.length, pixels.length, `${name}: length`);
  for (let i = 0; i < pixels.length; i++) {
    assert.strictEqual(decoded[i], pixels[i], `${name}: pixel ${i}`);
  }
  console.log(`  ok  ${name} (${pixels.length} px -> ${encoded.length} bytes)`);
}

console.log('LZW round trips:');
roundTrip('empty-ish', [7]);
roundTrip('uniform run', new Array(5000).fill(42));
roundTrip('tiny alphabet', Array.from({ length: 40000 }, (_, i) => i % 3));
roundTrip('ramp', Array.from({ length: 30000 }, (_, i) => i % 216));

let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
roundTrip('random 216', Array.from({ length: 60000 }, () => Math.floor(rand() * 216)));
// Structured noise builds a very large dictionary and forces a table reset.
roundTrip('dictionary overflow',
  Array.from({ length: 400000 }, (_, i) => (i * 7 + Math.floor(i / 211)) % 216));

// ---- Full GIF structure ----------------------------------------------------

function parseGIF(bytes) {
  let p = 0;
  const str = (n) => { const s = Buffer.from(bytes.slice(p, p + n)).toString('latin1'); p += n; return s; };
  const u8 = () => bytes[p++];
  const u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };

  assert.strictEqual(str(6), 'GIF89a', 'signature');
  const width = u16(), height = u16();
  const packed = u8();
  assert.strictEqual(packed & 0x80, 0x80, 'global colour table flag');
  u8(); u8();
  const gctSize = 3 * (1 << ((packed & 7) + 1));
  assert.strictEqual(gctSize, 768, 'global colour table size');
  const palette = bytes.slice(p, p + gctSize); p += gctSize;

  const frames = [];
  let looping = false;
  let pendingDelay = null;

  const readSubBlocks = () => {
    const parts = [];
    while (true) {
      const len = u8();
      if (len === 0) break;
      parts.push(bytes.slice(p, p + len));
      p += len;
    }
    return parts.length ? Uint8Array.from(Buffer.concat(parts.map(Buffer.from))) : new Uint8Array(0);
  };

  while (p < bytes.length) {
    const marker = u8();
    if (marker === 0x3b) { assert.strictEqual(p, bytes.length, 'trailer is last byte'); break; }

    if (marker === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        assert.strictEqual(u8(), 4, 'GCE block size');
        u8();
        pendingDelay = u16();
        u8(); 
        assert.strictEqual(u8(), 0, 'GCE terminator');
      } else if (label === 0xff) {
        assert.strictEqual(u8(), 11, 'app ext block size');
        assert.strictEqual(str(11), 'NETSCAPE2.0', 'netscape ext');
        assert.strictEqual(u8(), 3, 'sub-block size');
        assert.strictEqual(u8(), 1, 'loop sub-block id');
        assert.strictEqual(u16(), 0, 'loop count = forever');
        assert.strictEqual(u8(), 0, 'app ext terminator');
        looping = true;
      } else {
        readSubBlocks();
      }
      continue;
    }

    if (marker === 0x2c) {
      const left = u16(), top = u16(), fw = u16(), fh = u16();
      const imgPacked = u8();
      assert.strictEqual(left, 0); assert.strictEqual(top, 0);
      assert.strictEqual(fw, width); assert.strictEqual(fh, height);
      assert.strictEqual(imgPacked & 0x80, 0, 'no local colour table');
      const minCodeSize = u8();
      assert.strictEqual(minCodeSize, 8, 'LZW minimum code size');
      const data = readSubBlocks();
      const indices = lzwDecode(minCodeSize, data, fw * fh);
      assert.strictEqual(indices.length, fw * fh, 'decoded pixel count');
      frames.push({ delay: pendingDelay, indices });
      pendingDelay = null;
      continue;
    }

    throw new Error(`unexpected marker 0x${marker.toString(16)} at ${p - 1}`);
  }

  return { width, height, palette, frames, looping };
}

console.log('\nFull GIF encode:');
const W = 61, H = 37;                 // deliberately not multiples of 4 or 8
const sources = [];
for (let f = 0; f < 3; f++) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data[i] = (x * 4 + f * 30) % 256;
      data[i + 1] = (y * 6) % 256;
      data[i + 2] = (x * y + f * 17) % 256;
      data[i + 3] = 255;
    }
  }
  sources.push({ data, width: W, height: H });
}

const bytes = gif.encode(sources, 0.07);
const parsed = parseGIF(bytes);

assert.strictEqual(parsed.width, W);
assert.strictEqual(parsed.height, H);
assert.ok(parsed.looping, 'loops forever');
assert.strictEqual(parsed.frames.length, 3, 'frame count');

parsed.frames.forEach((frame, i) => {
  assert.strictEqual(frame.delay, 7, `frame ${i} delay (hundredths)`);
  const expected = gif.quantize(sources[i].data, W, H);
  assert.strictEqual(frame.indices.length, expected.length);
  for (let k = 0; k < expected.length; k++) {
    assert.strictEqual(frame.indices[k], expected[k], `frame ${i} pixel ${k}`);
  }
  // Every index must fall inside the 216-colour cube we actually populate.
  assert.ok(Math.max(...frame.indices) < 216, `frame ${i} index range`);
});

console.log(`  ok  3 frames, ${W}x${H}, ${bytes.length} bytes, decoded identical to quantizer output`);

// A realistic boomerang: does the size stay shareable?
const big = [];
for (let f = 0; f < 22; f++) {
  const data = new Uint8ClampedArray(480 * 360 * 4);
  for (let i = 0; i < data.length; i += 4) {
    const px = (i / 4) % 480, py = Math.floor((i / 4) / 480);
    data[i] = (px + f * 8) % 256;
    data[i + 1] = (py * 2 + f * 3) % 256;
    data[i + 2] = ((px ^ py) + f) % 256;
    data[i + 3] = 255;
  }
  big.push({ data, width: 480, height: 360 });
}
const t0 = Date.now();
const bigBytes = gif.encode(big, 0.07);
const ms = Date.now() - t0;
const parsedBig = parseGIF(bigBytes);
assert.strictEqual(parsedBig.frames.length, 22);
console.log(`  ok  22 frames @480x360 -> ${(bigBytes.length / 1024 / 1024).toFixed(2)} MB in ${ms}ms, decodes cleanly`);

console.log('\nAll GIF encoder tests passed.');
