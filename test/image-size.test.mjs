/**
 * Reading a picture's shape from its own bytes.
 *
 * This exists because `media` recorded mime, kind, bytes and a path and nothing about shape, so a
 * profile was a ragged column rather than a grid and a detail view could not reserve its space
 * before the image arrived.
 *
 * **The malformed cases matter more than the happy ones.** This function runs on bytes a stranger
 * uploaded, before anything else has vouched for them. It must return null rather than throw, must
 * never loop forever on a truncated file, and must never let a length field inside the file decide
 * how far it reads. A parser that throws here turns a bad upload into a 500.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { imageSize } from '../server/image-size.mjs';

/** A minimal but genuine PNG header: signature, then IHDR with width and height. */
function png(w, h) {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

function gif(w, h) {
  const b = Buffer.alloc(16);
  b.write('GIF89a', 0, 'ascii');
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
}

/** JPEG: SOI, an APP0 segment to be walked past, then a SOF0 carrying the size. */
function jpeg(w, h, { marker = 0xc0 } = {}) {
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0', 'ascii'),
    Buffer.alloc(9),
  ]);
  const sof = Buffer.alloc(11);
  sof.writeUInt8(0xff, 0); sof.writeUInt8(marker, 1);
  sof.writeUInt16BE(8, 2);          // segment length
  sof.writeUInt8(8, 4);             // precision
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

function webpLossy(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write('VP8 ', 12, 'ascii');
  b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a;
  b.writeUInt16LE(w, 26);
  b.writeUInt16LE(h, 28);
  return b;
}

describe('it reads the real formats', () => {
  test('PNG', () => assert.deepEqual(imageSize(png(1200, 800)), { width: 1200, height: 800 }));
  test('GIF', () => assert.deepEqual(imageSize(gif(320, 240)), { width: 320, height: 240 }));
  test('JPEG, walking past a segment to reach the frame header', () =>
    assert.deepEqual(imageSize(jpeg(4032, 3024)), { width: 4032, height: 3024 }));
  test('WebP lossy', () => assert.deepEqual(imageSize(webpLossy(800, 600)), { width: 800, height: 600 }));

  test('a portrait photograph is not silently transposed', () => {
    // JPEG stores height BEFORE width, which is the classic place to get this backwards.
    assert.deepEqual(imageSize(jpeg(1080, 1350)), { width: 1080, height: 1350 });
  });

  test('every SOF variant that carries a size is read, and the three that do not are skipped', () => {
    for (const marker of [0xc0, 0xc1, 0xc2, 0xc9, 0xcf]) {
      assert.deepEqual(imageSize(jpeg(100, 50, { marker })), { width: 100, height: 50 }, `SOF ${marker.toString(16)}`);
    }
    // 0xC4 is a Huffman table, not a frame — reading a size from it would be nonsense.
    assert.equal(imageSize(jpeg(100, 50, { marker: 0xc4 })), null);
  });
});

describe('it refuses rather than throws', () => {
  const cases = {
    'empty buffer': Buffer.alloc(0),
    'a few random bytes': Buffer.from([1, 2, 3, 4, 5]),
    'plain text': Buffer.from('this is not an image at all, it is a sentence'),
    'a PNG signature and nothing else': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'a JPEG that ends mid-walk': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    'a RIFF header with no WEBP': Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(26)]),
    'not a buffer at all': 'a string',
    'null': null,
  };
  for (const [name, input] of Object.entries(cases)) {
    test(name, () => {
      assert.doesNotThrow(() => imageSize(input));
      assert.equal(imageSize(input), null);
    });
  }

  test('A ZERO-LENGTH JPEG SEGMENT DOES NOT LOOP FOREVER', () => {
    // The cursor advances by the segment length. A length of zero would leave it where it was, and
    // the walk would spin until the process was killed — a denial of service in a single upload.
    const b = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe0, 0x00, 0x00]),   // segment claiming length 0
      Buffer.alloc(64),
    ]);
    const done = { hit: false };
    const t = setTimeout(() => { done.hit = true; }, 0);
    assert.equal(imageSize(b), null);
    clearTimeout(t);
  });

  test('a JPEG claiming a segment longer than the file stops at the end', () => {
    const b = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe0, 0xff, 0xff]),   // says 65535 bytes follow; they do not
      Buffer.alloc(20),
    ]);
    assert.equal(imageSize(b), null);
  });

  test('entropy-coded data ends the walk instead of being scanned as markers', () => {
    const b = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xda]), Buffer.alloc(200, 0xff)]);
    assert.equal(imageSize(b), null);
  });
});

describe('an implausible size is not a size', () => {
  test('zero is rejected — reserving space from it is worse than reserving none', () => {
    assert.equal(imageSize(png(0, 500)), null);
    assert.equal(imageSize(png(500, 0)), null);
  });

  test('a dimension past any real photograph is rejected as a parse error', () => {
    assert.equal(imageSize(png(100000, 100)), null);
  });

  test('a large but genuine image is kept', () => {
    assert.deepEqual(imageSize(png(12000, 8000)), { width: 12000, height: 8000 });
  });
});
