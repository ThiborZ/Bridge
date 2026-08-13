/**
 * Generates the home-screen icons.
 *
 * Written by hand rather than pulled from a library because the alternative is a
 * native image dependency for four small pictures. It rasterises a spade by
 * testing each pixel against a few shapes, then encodes a PNG directly — zlib is
 * in Node, and PNG's container is four chunks and a CRC.
 *
 *   node scripts/make-icons.mjs
 *
 * Output goes to public/, which Vite copies to the site root.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');

/* --------------------------------------------------------------- PNG output */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** `pixels` is RGBA, four bytes each, row-major. */
function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;  // bit depth
  header[9] = 6;  // colour type: RGBA
  // 10..12 are compression, filter and interlace — all zero.

  // Every scanline carries a leading filter byte; 0 means "none".
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const from = y * width * 4;
    const to = y * (width * 4 + 1) + 1;
    raw[to - 1] = 0;
    pixels.copy(raw, to, from, from + width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------- the drawing */

/**
 * A spade, as a silhouette measured row by row rather than a union of circles.
 *
 * The first attempt unioned two lobes with a triangle and produced a club with
 * spurs sticking out of its sides — wherever a lobe was wider than the triangle
 * at the same height, its edge showed as a spike. Describing one half-width per
 * row cannot do that: the outline is a single function, so it is smooth by
 * construction.
 *
 *   outer  the body, pointed at the top and rounding off below
 *   notch  carved up from the bottom centre, which is what splits the body
 *          into two lobes
 *   stem   sits in the notch
 */
function insideSpade(x, y) {
  const fromCentre = Math.abs(x - 0.5);

  const TIP = 0.06;
  const WIDEST = 0.57;
  const FOOT = 0.83;
  const HALF_WIDTH = 0.43;

  let outer = 0;
  if (y >= TIP && y <= WIDEST) {
    // Above the widest point: grows from nothing, with slightly hollow sides.
    outer = HALF_WIDTH * Math.pow((y - TIP) / (WIDEST - TIP), 1.28);
  } else if (y > WIDEST && y <= FOOT) {
    // Below it: a circular falloff, giving the lobes their roundness.
    const down = (y - WIDEST) / (FOOT - WIDEST);
    outer = HALF_WIDTH * Math.sqrt(Math.max(0, 1 - down * down));
  }
  if (fromCentre > outer) {
    // Not in the body — but it may still be in the stem.
    return insideStem(fromCentre, y);
  }

  /*
   * The notch is capped. Left to grow it outruns the shrinking body and pinches
   * each lobe to a sharp horn; held narrow, the lobe's underside is the body's
   * own circular falloff and stays round.
   */
  const NOTCH_TOP = 0.66;
  if (y >= NOTCH_TOP) {
    // Eased rather than clamped: reaching the cap abruptly leaves a visible
    // step in the underside of each lobe.
    const t = Math.min(1, (y - NOTCH_TOP) / 0.14);
    const notch = 0.15 * t * t * (3 - 2 * t);
    if (fromCentre <= notch) return insideStem(fromCentre, y);
  }
  return true;
}

/** Narrow where it meets the body, flaring into a foot. */
function insideStem(fromCentre, y) {
  if (y < 0.62 || y > 0.93) return false;
  const down = (y - 0.62) / 0.31;
  return fromCentre <= 0.030 + 0.165 * down * down;
}

/**
 * `padding` is how much of the tile to leave empty around the glyph. A maskable
 * icon gets a lot, because the launcher may crop it to a circle and anything in
 * the corners is thrown away.
 */
function drawIcon(size, { padding, background, ink }) {
  const pixels = Buffer.alloc(size * size * 4);
  const glyph = 1 - padding * 2;
  const samples = 3; // supersampling, so the curves are not jagged

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const fx = (px + (sx + 0.5) / samples) / size;
          const fy = (py + (sy + 0.5) / samples) / size;
          const gx = (fx - padding) / glyph;
          const gy = (fy - padding) / glyph;
          if (gx >= 0 && gx <= 1 && gy >= 0 && gy <= 1 && insideSpade(gx, gy)) hits++;
        }
      }
      const coverage = hits / (samples * samples);
      const offset = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel++) {
        pixels[offset + channel] = Math.round(
          background[channel] * (1 - coverage) + ink[channel] * coverage,
        );
      }
      pixels[offset + 3] = 255;
    }
  }
  return encodePng(size, size, pixels);
}

/* -------------------------------------------------------------------- write */

const FELT = [14, 82, 68];    // the table
const CARD = [252, 252, 250]; // card stock

mkdirSync(PUBLIC, { recursive: true });

const icons = [
  ['icon-192.png', 192, 0.14],
  ['icon-512.png', 512, 0.14],
  // Maskable icons are cropped by the launcher, so the glyph sits well inside.
  ['icon-maskable-512.png', 512, 0.26],
  ['apple-touch-icon.png', 180, 0.12],
];

for (const [name, size, padding] of icons) {
  const png = drawIcon(size, { padding, background: FELT, ink: CARD });
  writeFileSync(join(PUBLIC, name), png);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}
