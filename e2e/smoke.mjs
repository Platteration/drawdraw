/**
 * End-to-end smoke test against the web build.
 *
 * Bundling proves the app compiles; this proves it runs. It drives the real
 * critical path in a browser — onboarding, importing a portrait, and fitting
 * the guide with three taps — and measures where the guide actually landed
 * against a portrait laid out on known thirds. Anything logged to the console
 * as an error along the way fails the run.
 *
 *   npm run e2e
 */
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { PORTRAIT, writePortrait } from './portrait.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(root, process.env.WEB_BUILD_DIR || '.web-build');
const TOLERANCE = 8; // source-image pixels; taps are placed exactly here

if (!existsSync(join(BUILD, 'index.html'))) {
  console.error(`No web build at ${BUILD}. Run: npm run build:web`);
  process.exit(1);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

/**
 * The file a request asks for, or the app shell.
 *
 * The request path is resolved and then checked to be inside the build
 * directory, because `join` happily resolves `..` out of it: a raw
 * `GET /../../../../etc/passwd` (or its `%2e%2e` form — decoding before
 * resolving is part of it) served any file on the machine for as long as the
 * run lasted. Anything outside falls through to index.html along with every
 * other unknown path, so the single-page fallback the app needs is also the
 * refusal. A malformed escape such as `/%` throws URIError, which would be an
 * uncaught exception inside a request listener.
 */
function fileFor(url) {
  const shell = join(BUILD, 'index.html');
  let requested;
  try {
    requested = decodeURIComponent(url.split('?')[0]);
  } catch {
    return shell;
  }
  const file = resolve(BUILD, '.' + normalize(requested));
  const inside = file === BUILD || file.startsWith(BUILD + sep);
  return inside && existsSync(file) && statSync(file).isFile() ? file : shell;
}

const server = createServer((req, res) => {
  const file = fileFor(req.url);
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

/** Use whatever Chromium this machine has, wherever the install put it. */
function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return undefined;
  for (const entry of readdirSync(base)) {
    if (!entry.startsWith('chromium-')) continue;
    const candidate = join(base, entry, 'chrome-linux', 'chrome');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

/**
 * Speak HTTP over a socket, so the request line arrives exactly as written.
 * A browser — and node's own fetch — normalise `..` away before sending, which
 * is precisely why the traversal below was never noticed from inside a test.
 */
const rawRequest = (line) =>
  new Promise((done) => {
    const socket = connect(server.address().port, '127.0.0.1', () =>
      socket.write(`GET ${line} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`)
    );
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => (received += chunk));
    socket.on('close', () => done(received));
    socket.on('error', () => done(''));
  });

const shell = readFileSync(join(BUILD, 'index.html'), 'utf8');
for (const line of ['/../../../../etc/passwd', '/%2e%2e/package.json', '/%']) {
  const body = await rawRequest(line);
  check(`the server serves nothing above the build directory: ${line}`, body.includes(shell.slice(0, 60)));
}

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(`console: ${m.text().slice(0, 200)}`);
});

const tap = async (text) => {
  await page.getByText(text, { exact: false }).first().click({ timeout: 10000 });
  await page.waitForTimeout(400);
};

try {
  await page.goto(`${origin}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const intro = await page.locator('body').innerText();
  check('onboarding is shown on first launch', intro.includes('Three segments'));

  await tap('Skip');
  const home = await page.locator('body').innerText();
  check('home screen offers a portrait', home.includes('Choose a portrait'));

  const portraitPath = join(mkdtempSync(join(tmpdir(), 'drawdraw-')), 'portrait.png');
  writePortrait(portraitPath);
  const chooser = page.waitForEvent('filechooser');
  await tap('Choose a portrait');
  await (await chooser).setFiles(portraitPath);
  await page.waitForTimeout(2500);

  const editor = await page.locator('body').innerText();
  check('importing a portrait opens the editor', editor.includes('Fit to face'));

  const box = await page.locator('img').first().boundingBox();
  const at = (sx, sy) => ({
    x: box.x + (sx / PORTRAIT.width) * box.width,
    y: box.y + (sy / PORTRAIT.height) * box.height,
  });

  await tap('Fit to face');
  for (const y of [PORTRAIT.chin, PORTRAIT.nose, PORTRAIT.brow]) {
    const point = at(PORTRAIT.centerX, y);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(600);

  // Read the fitted guide straight out of the rendered SVG.
  const geometry = await page.evaluate(() => {
    const svg = document.querySelector('svg');
    if (!svg) return null;
    const spans = [];
    for (const path of svg.querySelectorAll('path')) {
      const nums = (path.getAttribute('d') || '').match(/-?\d+\.?\d*/g);
      if (!nums || nums.length < 8) continue;
      const ys = [];
      for (let i = 1; i < nums.length; i += 2) ys.push(parseFloat(nums[i]));
      spans.push({ min: Math.min(...ys), max: Math.max(...ys) });
    }
    return { spans, top: svg.getBoundingClientRect().top };
  });
  check('the guide rendered', !!geometry && geometry.spans.length > 0);

  if (geometry) {
    const toSource = (y) => ((y + geometry.top - box.y) / box.height) * PORTRAIT.height;
    const outline = geometry.spans.reduce((a, b) => (b.max - b.min > a.max - a.min ? b : a));
    const level = geometry.spans
      .filter((s) => s.max - s.min < 3)
      .map((s) => toSource(s.min))
      .sort((a, b) => a - b);
    // The level lines arrive as several depth-tapered runs per ring; cluster them.
    const rings = [];
    for (const y of level) {
      const last = rings[rings.length - 1];
      if (last && y - last[last.length - 1] < 20) last.push(y);
      else rings.push([y]);
    }
    const centers = rings.map((r) => r.reduce((a, b) => a + b, 0) / r.length);
    const near = (actual, expected) => Math.abs(actual - expected) <= TOLERANCE;
    const report = (a, e) => `${a.toFixed(1)} vs ${e.toFixed(1)}`;

    check('fit puts the crown on the crown', near(toSource(outline.min), PORTRAIT.crown), report(toSource(outline.min), PORTRAIT.crown));
    check('fit puts the chin on the chin', near(toSource(outline.max), PORTRAIT.chin), report(toSource(outline.max), PORTRAIT.chin));
    check('three level lines were drawn', centers.length === 3, `got ${centers.length}`);
    if (centers.length === 3) {
      const [brow, eye, nose] = centers;
      check('brow line lands on the brow', near(brow, PORTRAIT.brow), report(brow, PORTRAIT.brow));
      check('eye line lands mid-head', near(eye, (PORTRAIT.crown + PORTRAIT.chin) / 2), report(eye, (PORTRAIT.crown + PORTRAIT.chin) / 2));
      check('nose line lands on the nose', near(nose, PORTRAIT.nose), report(nose, PORTRAIT.nose));
    }
  }

  await tap('Build');
  await tap('Jaw'); // a Pro-gated construction line
  const paywall = await page.locator('body').innerText();
  check('a locked control opens the paywall', paywall.includes('Unlock Pro'));

  check('no console or page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
