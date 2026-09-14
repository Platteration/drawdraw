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
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
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

const server = createServer((req, res) => {
  const path = join(BUILD, decodeURIComponent(req.url.split('?')[0]));
  const file = existsSync(path) && statSync(path).isFile() ? path : join(BUILD, 'index.html');
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

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(`console: ${m.text().slice(0, 500)}`);
});

const tap = async (text) => {
  await page.getByText(text, { exact: false }).first().click({ timeout: 10000 });
  await page.waitForTimeout(400);
};

try {
  await page.goto(`${origin}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const intro = await page.locator('body').innerText();
  const onboardingShown = intro.includes('Three segments');
  check('onboarding is shown on first launch', onboardingShown);
  if (!onboardingShown) {
    console.error(`body: ${intro.slice(0, 1000) || '<empty>'}`);
    for (const error of consoleErrors) console.error(error);
    throw new Error('App did not render onboarding');
  }

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
      .filter((y) => Number.isFinite(y));

    const nearest = (target) => level.reduce(
      (best, y) => (Math.abs(y - target) < Math.abs(best - target) ? y : best),
      level[0] ?? Infinity
    );
    const checkLevel = (label, target) => {
      const actual = nearest(target);
      check(label, Math.abs(actual - target) <= TOLERANCE,
        `${Number.isFinite(actual) ? actual.toFixed(1) : 'none'} vs ${target}`);
    };

    check('crown lands on the portrait', Math.abs(toSource(outline.min) - PORTRAIT.crown) <= TOLERANCE,
      `${toSource(outline.min).toFixed(1)} vs ${PORTRAIT.crown}`);
    check('chin lands on the portrait', Math.abs(toSource(outline.max) - PORTRAIT.chin) <= TOLERANCE,
      `${toSource(outline.max).toFixed(1)} vs ${PORTRAIT.chin}`);
    checkLevel('brow ring lands on the portrait', PORTRAIT.brow);
    checkLevel('eye line lands on the portrait', PORTRAIT.eye);
    checkLevel('nose ring lands on the portrait', PORTRAIT.nose);
  }

  check('no browser errors', consoleErrors.length === 0, consoleErrors.join(' | '));
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed`);
  process.exit(1);
}
