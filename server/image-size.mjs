/**
 * How big a picture actually is, read from its own bytes.
 *
 * ─── Why the server does this and not the browser ───────────────────────────────────────
 *
 * A client can say anything. Dimensions decide how much space the interface reserves, and a lie
 * here is a layout that jumps under the reader's thumb, or a grid cell that a hostile upload can
 * stretch across the page. The bytes are already on this machine and already being read for MIME
 * sniffing — this is the same argument, one step further.
 *
 * ─── Why this file exists at all ────────────────────────────────────────────────────────
 *
 * `media` recorded mime, kind, bytes and a path, and nothing about shape. So every photograph
 * rendered at whatever ratio it happened to arrive with: a profile was a ragged column rather than
 * a grid, and a detail view could not reserve its space before the image loaded.
 *
 * The decision it serves: **the grid is a fixed cell that crops, and the detail view shows the
 * original.** The grid does not need these numbers — `object-fit: cover` handles it. The DETAIL
 * view does, so it can hold the right shape open while the bytes arrive instead of reflowing the
 * page when they land.
 *
 * ─── Why not a library ──────────────────────────────────────────────────────────────────
 *
 * Four container formats, each of which states its size in the first few dozen bytes. The parsing
 * below is short and total: it never decodes pixels, never allocates from a length field, and
 * returns null rather than throwing on anything it does not recognise. A dependency here would run
 * attacker-supplied bytes through far more code than this.
 */

/** PNG: an 8-byte signature, then IHDR whose width and height are big-endian at 16 and 20. */
function png(b) {
  if (b.length < 24) return null;
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** GIF: 'GIF87a' or 'GIF89a', then width and height as little-endian 16-bit at 6 and 8. */
function gif(b) {
  if (b.length < 10) return null;
  const sig = b.toString('ascii', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

/**
 * JPEG: walk the marker chain to a Start-Of-Frame, which carries the dimensions.
 *
 * The loop is bounded by the buffer and every segment length is validated before it is trusted —
 * a truncated or hostile file must end the walk rather than send the cursor backwards or off the
 * end. SOF0-SOF15 are 0xC0..0xCF except 0xC4 (Huffman table), 0xC8 (JPEG extension) and 0xCC
 * (arithmetic coding conditioning), which are not frame headers and do not carry a size.
 */
function jpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }          // resynchronise on fill bytes
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;   // end of image, or entropy data begins
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;                          // a zero-length segment would loop forever
    const isSOF = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      if (i + 9 > b.length) return null;
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/** WebP: RIFF container, then one of three chunk layouts that each state the size differently. */
function webp(b) {
  if (b.length < 30) return null;
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);

  if (chunk === 'VP8 ') {
    // Lossy: a 3-byte start code, then 14-bit dimensions with 2 scale bits above them.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    // Lossless: 14 bits each, packed across four bytes after the 0x2f signature byte.
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // Extended: canvas size as two 24-bit little-endian values, each stored one less than actual.
    const w = b[24] | (b[25] << 8) | (b[26] << 16);
    const h = b[27] | (b[28] << 8) | (b[29] << 16);
    return { width: w + 1, height: h + 1 };
  }
  return null;
}

/**
 * Dimensions, or null when they cannot be read.
 *
 * Null is a normal answer, not a failure: video, PDFs and anything unrecognised have no size this
 * function can know, and the interface has to cope with not knowing anyway — an upload from before
 * this existed has no dimensions either. Callers must treat it as absent, never as zero.
 */
export function imageSize(buf, mime = '') {
  if (!Buffer.isBuffer(buf) || buf.length < 10) return null;
  let size = null;
  try {
    size = png(buf) ?? gif(buf) ?? jpeg(buf) ?? webp(buf);
  } catch {
    return null;                                       // a malformed file is not an exception here
  }
  if (!size) return null;

  // A dimension of zero, or one implausible enough to be a parse error rather than a photograph,
  // is discarded — reserving space from a bad number is worse than reserving none.
  const { width, height } = size;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width < 1 || height < 1 || width > 60_000 || height > 60_000) return null;
  return { width, height };
}
