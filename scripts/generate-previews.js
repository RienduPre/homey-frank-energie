'use strict';

/*
 * Generates the widget previews (widgets/<id>/preview-light.png and
 * preview-dark.png): 1024×1024, transparent, simple shapes, no text.
 * No dependencies; run with `npm run images`.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;
const C = {
  g: [46, 158, 79], lg: [140, 193, 82], y: [242, 193, 46], o: [240, 138, 44], r: [228, 71, 60],
};
const NEUTRAL = { light: [213, 213, 220], dark: [85, 85, 92] };

// ------------------------------------------------------------------ shapes
// Each shape: { sd(x, y) → signed distance (px, < 0 inside), color, alpha }

const roundRect = (x, y, w, h, r, color, alpha = 1) => ({
  color,
  alpha,
  sd(px, py) {
    const cx = x + w / 2; const cy = y + h / 2;
    const qx = Math.abs(px - cx) - w / 2 + r;
    const qy = Math.abs(py - cy) - h / 2 + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  },
});

const circle = (cx, cy, r, color, alpha = 1) => ({
  color, alpha, sd: (px, py) => Math.hypot(px - cx, py - cy) - r,
});

/** Arc stroke with round caps; angles in degrees, 0 = top, clockwise. */
const arc = (cx, cy, r, a0, a1, width, color, alpha = 1) => {
  const pt = (a) => {
    const t = ((a - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  };
  const [x0, y0] = pt(a0);
  const [x1, y1] = pt(a1);
  return {
    color,
    alpha,
    sd(px, py) {
      let a = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;
      if (a > 180) a -= 360;
      const inside = a >= a0 && a <= a1;
      const d = inside
        ? Math.abs(Math.hypot(px - cx, py - cy) - r)
        : Math.min(Math.hypot(px - x0, py - y0), Math.hypot(px - x1, py - y1));
      return d - width / 2;
    },
  };
};

// ----------------------------------------------------------------- designs

function pricesCurve() {
  const pts = [];
  for (let i = 0; i < 48; i++) {
    const h = i / 2;
    pts.push(0.45 + 0.18 * Math.exp(-((h - 8) ** 2) / 3) - 0.2 * Math.exp(-((h - 13.5) ** 2) / 8)
      + 0.4 * Math.exp(-((h - 18.5) ** 2) / 4));
  }
  return pts;
}

const levelColor = (v) => (v < 0.32 ? C.g : v < 0.4 ? C.lg : v < 0.55 ? C.y : v < 0.7 ? C.o : C.r);

const DESIGNS = {
  price_now: (n) => [
    arc(512, 470, 300, -120, 120, 64, n),
    arc(512, 470, 300, -120, -20, 64, C.y),
    circle(512, 470, 70, n),
    roundRect(232, 800, 560, 96, 48, C.g, 0.85),
  ],
  price_forecast: (n) => {
    const bars = [[0.35, C.lg], [0.45, C.y], [0.85, C.r], [1, C.r], [0.9, C.r], [0.65, C.o], [0.5, C.y]];
    return [
      roundRect(96, 130, 112, 470, 30, n, 0.5),
      ...bars.map(([h, c], i) => roundRect(112 + i * 118, 560 - 420 * h, 80, 420 * h, 22, c)),
      roundRect(112, 690, 800, 40, 20, n), roundRect(250, 690, 420, 40, 20, C.g),
      roundRect(112, 810, 800, 40, 20, n), roundRect(380, 810, 460, 40, 20, C.r),
    ];
  },
  price_chart: (n) => {
    const pts = pricesCurve();
    const x0 = 112; const W = 800; const dx = W / 48; const bottom = 720;
    const y = (v) => bottom - v * 560;
    const shapes = [roundRect(x0, bottom, W, 8, 4, n)];
    pts.forEach((v, i) => shapes.push(roundRect(x0 + i * dx, y(v), dx + 0.6, bottom - y(v), 0, levelColor(v), 0.25)));
    pts.forEach((v, i) => {
      shapes.push(roundRect(x0 + i * dx - 7, y(v) - 7, dx + 14, 14, 7, levelColor(v)));
      if (i < pts.length - 1) {
        const top = Math.min(y(v), y(pts[i + 1]));
        const h = Math.abs(y(v) - y(pts[i + 1]));
        shapes.push(roundRect(x0 + (i + 1) * dx - 7, top - 7, 14, h + 14, 7, levelColor(pts[i + 1])));
      }
    });
    shapes.push(
      roundRect(x0, 790, W, 26, 13, n),
      roundRect(x0 + W * 0.47, 790, W * 0.17, 26, 13, C.g),
      roundRect(x0 + W * 0.7, 790, W * 0.2, 26, 13, C.r),
      roundRect(x0, 870, W, 64, 32, n),
    );
    return shapes;
  },
};

// ---------------------------------------------------------------------- png

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
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

function render(shapes) {
  const stride = SIZE * 4 + 1;
  const raw = Buffer.alloc(stride * SIZE);
  for (let py = 0; py < SIZE; py++) {
    raw[py * stride] = 0;
    for (let px = 0; px < SIZE; px++) {
      let r = 0; let g = 0; let b = 0; let a = 0; // premultiplied
      for (const s of shapes) {
        const cov = Math.min(1, Math.max(0, 0.5 - s.sd(px + 0.5, py + 0.5))) * s.alpha;
        if (cov <= 0) continue;
        r = s.color[0] * cov + r * (1 - cov);
        g = s.color[1] * cov + g * (1 - cov);
        b = s.color[2] * cov + b * (1 - cov);
        a = cov + a * (1 - cov);
      }
      const o = py * stride + 1 + px * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = path.join(__dirname, '..');
for (const [id, design] of Object.entries(DESIGNS)) {
  for (const mode of ['light', 'dark']) {
    const rel = `widgets/${id}/preview-${mode}.png`;
    fs.writeFileSync(path.join(root, rel), render(design(NEUTRAL[mode])));
    console.log('wrote', rel);
  }
}
