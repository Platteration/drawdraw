/**
 * Generates the app icons and splash mark from the real head model, so the
 * app's identity and its subject can never drift apart. Run: npm run icons
 *
 * Everything here is standard library: a small analytic-coverage line
 * rasterizer and a minimal PNG encoder (zlib ships with Node).
 */
import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// headModel.js is ESM but lives in a CommonJS-by-default package and imports
// nothing itself, so it loads cleanly as a data: module.
const source = readFileSync(join(root, 'src/lib/headModel.js'), 'utf8');
const { buildHeadWireframe, HEAD_HEIGHT_UNITS } = await import(
  `data:text/javascript,${encodeURIComponent(source)}`
);

const PAPER = [0xf4, 0xef, 0xe6];
const SANGUINE = [0xb4, 0x54, 0x3a];

// --- raster ---------------------------------------------------------------

function createCanvas(size, background) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  if (background) {
    for (let i = 0; i < size * size; i++) {
      pixels[i * 4] = background[0];
      pixels[i * 4 + 1] = background[1];
      pixels[i * 4 + 2] = background[2];
      pixels[i * 4 + 3] = 255;
    }
  }
  return { size, pixels };
}

/**
 * Strokes accumulate into a coverage mask before being composited once, so
 * overlapping round caps at segment joins cannot double-blend — which shows
 * up as beading along any stroke drawn below full opacity.
 */
function compositeMask(canvas, mask, color, opacity) {
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 0) blend(canvas, i % canvas.size, (i / canvas.size) | 0, color, mask[i] * opacity);
  }
}

function blend(canvas, x, y, color, alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const i = (y * canvas.size + x) * 4;
  const dstA = canvas.pixels[i + 3] / 255;
  const outA = alpha + dstA * (1 - alpha);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c++) {
    const dst = canvas.pixels[i + c];
    canvas.pixels[i + c] = (color[c] * alpha + dst * dstA * (1 - alpha)) / outA;
  }
  canvas.pixels[i + 3] = outA * 255;
}

/** Round-capped line with analytic coverage: a one-pixel ramp at the edge. */
function strokeSegment(mask, size, x0, y0, x1, y1, width) {
  const half = width / 2;
  const pad = half + 1;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1) + pad));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1) + pad));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSq = dx * dx + dy * dy;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5 - x0;
      const py = y + 0.5 - y0;
      const t = lengthSq > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq)) : 0;
      const distance = Math.hypot(px - t * dx, py - t * dy);
      const coverage = Math.max(0, Math.min(1, half - distance + 0.5));
      const i = y * size + x;
      if (coverage > mask[i]) mask[i] = coverage;
    }
  }
}

function strokePolyline(mask, size, points, closed, width) {
  const list = closed ? [...points, points[0]] : points;
  for (let i = 1; i < list.length; i++) {
    strokeSegment(mask, size, list[i - 1].x, list[i - 1].y, list[i].x, list[i].y, width);
  }
}

// --- PNG ------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng({ size, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolor with alpha
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, rowStart + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- the mark -------------------------------------------------------------

/**
 * Draws the head centred on the canvas. `coverage` is the fraction of the
 * canvas height the head occupies — Android's adaptive icon crops to a circle,
 * so its foreground needs a smaller head than the plain iOS icon.
 */
function drawHead(canvas, { coverage, weight, elements }) {
  const { size } = canvas;
  const wire = buildHeadWireframe(VIEW.yaw, VIEW.pitch, 0, { elements, proportions: PROPORTIONS });
  const ppu = (size * coverage) / HEAD_HEIGHT_UNITS;
  const center = size / 2;
  const project = (points) =>
    points.map((p) => ({ x: center + p.x * ppu, y: center - p.y * ppu }));
  const width = size * weight;

  // Hidden curves read as a wash rather than dashes: dashes turn to mush at
  // favicon size, a lighter stroke survives the downscale.
  const hidden = new Float32Array(size * size);
  for (const poly of wire.back) {
    strokePolyline(hidden, size, project(poly.points), poly.closed, width * 0.8);
  }
  compositeMask(canvas, hidden, SANGUINE, 0.24);

  const visible = new Float32Array(size * size);
  strokePolyline(visible, size, project(wire.outline.points), true, width);
  for (const poly of wire.front) {
    strokePolyline(visible, size, project(poly.points), poly.closed, width);
  }
  compositeMask(canvas, visible, SANGUINE, 1);
}

// The mark is the method: a head cut into three. A centre line crossing the
// two division rings reads as a globe's grid instead, so the icon carries only
// the silhouette and the two rings, turned just far enough that their curve
// shows the form is solid rather than flat.
const VIEW = { yaw: 26, pitch: 4 };
const ELEMENTS = { segments: true };
const PROPORTIONS = { width: 0.9, depth: 0.98, noseY: -0.5, browY: 0.5 };

const OUTPUTS = [
  { file: 'icon.png', size: 1024, background: PAPER, coverage: 0.72, weight: 0.022 },
  { file: 'adaptive-icon.png', size: 1024, background: null, coverage: 0.5, weight: 0.019 },
  { file: 'splash-icon.png', size: 1024, background: null, coverage: 0.66, weight: 0.016 },
  { file: 'favicon.png', size: 96, background: PAPER, coverage: 0.72, weight: 0.03 },
];

for (const output of OUTPUTS) {
  const canvas = createCanvas(output.size, output.background);
  drawHead(canvas, { coverage: output.coverage, weight: output.weight, elements: ELEMENTS });
  const path = join(root, 'assets', output.file);
  writeFileSync(path, encodePng(canvas));
  console.log(`wrote assets/${output.file} (${output.size}×${output.size})`);
}
