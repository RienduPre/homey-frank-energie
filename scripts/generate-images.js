'use strict';

/*
 * Generates the PNG images Homey requires (no dependencies).
 * Run once after cloning: `npm run images`.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [26, 60, 52];
const BOLT = [255, 205, 60];
const WHITE = [255, 255, 255];
// Lightning bolt polygon in unit coordinates (x, y)
const POLY = [[0.56, 0.16], [0.32, 0.55], [0.48, 0.55], [0.43, 0.86], [0.69, 0.44], [0.53, 0.44]];

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/**
 * @param {number} w width
 * @param {number} h height
 * @param {boolean} square rounded square icon on white (driver images)
 */
function render(w, h, square) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const pts = square
    ? POLY
    : POLY.map(([x, y]) => [0.5 + (x - 0.5) * (h / w), y]); // keep bolt proportional, centered
  const r = 0.18;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      let col = BG;
      if (square) {
        // rounded rectangle 0.08..0.92
        const dx = Math.max(0.08 + r - u, 0, u - (0.92 - r));
        const dy = Math.max(0.08 + r - v, 0, v - (0.92 - r));
        const outside = u < 0.08 || u > 0.92 || v < 0.08 || v > 0.92 || dx * dx + dy * dy > r * r;
        col = outside ? WHITE : BG;
      }
      if (inPoly(u, v, pts)) col = BOLT;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = path.join(__dirname, '..');
const jobs = [
  ['assets/images/small.png', 250, 175, false],
  ['assets/images/large.png', 500, 350, false],
  ['assets/images/xlarge.png', 1000, 700, false],
  ['drivers/prices/assets/images/small.png', 75, 75, true],
  ['drivers/prices/assets/images/large.png', 500, 500, true],
  ['drivers/prices/assets/images/xlarge.png', 1000, 1000, true],
  ['drivers/account/assets/images/small.png', 75, 75, true],
  ['drivers/account/assets/images/large.png', 500, 500, true],
  ['drivers/account/assets/images/xlarge.png', 1000, 1000, true],
];
for (const [rel, w, h, sq] of jobs) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, render(w, h, sq));
  console.log('wrote', rel);
}
