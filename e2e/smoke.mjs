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

  // Walk the shared editing controls, checking both the rendered result and
  // the real AsyncStorage adapter. Native capture/share/camera need devices.
  const settingsAfterSave = async () => {
    await page.waitForTimeout(750);
    return page.evaluate(() => JSON.parse(localStorage.getItem('drawdraw.projects.v1'))[0].settings);
  };
  const canvasImage = page.locator('img').first();
  const canvas = () => canvasImage.locator('../..');
  const canvasPaths = () => canvas().locator('svg path');
  const flatLineCount = (thickness) => canvas().evaluate((element, weight) =>
    [...element.querySelectorAll('div')].filter((line) => line.style.backgroundColor &&
      (Number.parseFloat(line.style.height) === weight || Number.parseFloat(line.style.width) === weight)).length, thickness);
  const drag = async (from, to) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
  };
  const onCanvas = async (fx, fy) => {
    const bounds = await canvasImage.boundingBox();
    return { x: bounds.x + bounds.width * fx, y: bounds.y + bounds.height * fy };
  };
  const setSlider = async (label, fraction) => {
    const slider = page.getByLabel(label, { exact: true });
    await slider.scrollIntoViewIfNeeded();
    const bounds = await slider.boundingBox();
    await page.mouse.click(bounds.x + bounds.width * fraction, bounds.y + bounds.height / 2);
  };

  for (const [label, yaw, pitch] of [['Front', 0, 0], ['¾', 40, 0], ['Profile', 90, 0], ['Above', 25, 22], ['Below', 25, -22]]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    const saved = await settingsAfterSave();
    check(`${label} preset saves its pose`, saved.headTransform.yaw === yaw && saved.headTransform.pitch === pitch && saved.headTransform.roll === 0);
  }
  await tap('Front');
  const startPose = (await settingsAfterSave()).headTransform;
  const rotationStart = await onCanvas(0.4, 0.4);
  await drag(rotationStart, { x: rotationStart.x + 50, y: rotationStart.y + 30 });
  const rotated = (await settingsAfterSave()).headTransform;
  check('dragging in Rotate changes yaw and pitch without moving the head',
    Math.abs(rotated.yaw - 20) < 0.01 && Math.abs(rotated.pitch - 12) < 0.01 && rotated.x === startPose.x && rotated.y === startPose.y);
  await tap('Move');
  const moveStart = await onCanvas(0.5, 0.5);
  const moveBounds = await canvasImage.boundingBox();
  await drag(moveStart, { x: moveStart.x + 20, y: moveStart.y + 15 });
  const moved = (await settingsAfterSave()).headTransform;
  check('dragging in Move changes position without rotating the head',
    Math.abs(moved.x - rotated.x - 20 / moveBounds.width) < 0.001 &&
    Math.abs(moved.y - rotated.y - 15 / moveBounds.height) < 0.001 && moved.yaw === rotated.yaw && moved.pitch === rotated.pitch);

  await tap('3D head');
  check('hiding the 3D head removes its rendered paths', await canvasPaths().count() === 0);
  await tap('3D head');
  check('showing the 3D head restores rendered paths', await canvasPaths().count() > 0);
  await tap('H lines');
  await tap('V lines');
  await page.getByRole('button', { name: 'Center', exact: true }).click();
  const flatSettings = await settingsAfterSave();
  check('horizontal, vertical and center guides render and save their toggles',
    flatSettings.showHorizontal && flatSettings.showVertical && flatSettings.showCenter &&
    await flatLineCount(2) === 5);
  await tap('Lines');
  const horizontalStart = await onCanvas(0.15, 1 / 3);
  const flatBounds = await canvasImage.boundingBox();
  await drag(horizontalStart, { x: horizontalStart.x, y: horizontalStart.y + 25 });
  const horizontal = await settingsAfterSave();
  check('dragging a horizontal guide saves its new fraction', Math.abs(horizontal.hGuides[0] - 1 / 3 - 25 / flatBounds.height) < 0.001);
  const verticalStart = await onCanvas(1 / 3, 0.85);
  await drag(verticalStart, { x: verticalStart.x + 20, y: verticalStart.y });
  const vertical = await settingsAfterSave();
  check('dragging a vertical guide saves its new fraction', Math.abs(vertical.vGuides[0] - 1 / 3 - 20 / flatBounds.width) < 0.001);

  await tap('Practice');
  check('Practice hides the photo while retaining the guide',
    await canvasImage.locator('..').evaluate((element) => getComputedStyle(element).opacity === '0') && await canvasPaths().count() > 0);
  const peek = page.getByText('Hold to peek', { exact: true }).locator('..');
  await peek.scrollIntoViewIfNeeded();
  const peekBounds = await peek.boundingBox();
  await page.mouse.move(peekBounds.x + peekBounds.width / 2, peekBounds.y + peekBounds.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  check('holding Peek reveals the photo', await canvasImage.locator('..').evaluate((element) => getComputedStyle(element).opacity === '1'));
  await page.mouse.up();
  await page.waitForTimeout(150);
  check('releasing Peek hides the photo again', await canvasImage.locator('..').evaluate((element) => getComputedStyle(element).opacity === '0'));
  await tap('Practice');

  await tap('Build');
  const fullFreePaths = await canvasPaths().count();
  await page.getByRole('button', { name: 'Center', exact: true }).click();
  await tap('Eye line');
  const disabledElements = await settingsAfterSave();
  check('free construction toggles remove paths and persist',
    !disabledElements.elements.center && !disabledElements.elements.eyeLine && await canvasPaths().count() < fullFreePaths);
  await tap('Slim');
  const slim = await settingsAfterSave();
  check('Slim selects its distinct proportions', slim.proportions.width === 0.94 && slim.proportions.depth === 0.98);
  await tap('Adult');
  check('Adult restores default proportions', JSON.stringify((await settingsAfterSave()).proportions) === JSON.stringify({ width: 1, depth: 1, noseY: -0.5, browY: 0.5 }));
  for (const [label, key, min, max, step] of [['Brow line', 'browY', 0, 0.9, 0.02], ['Nose line', 'noseY', -0.9, -0.1, 0.02], ['Width', 'width', 0.8, 1.25, 0.01], ['Depth', 'depth', 0.8, 1.25, 0.01]]) {
    await setSlider(label, 0.7);
    const expected = Number((Math.round((min + 0.7 * (max - min)) / step) * step).toFixed(6));
    check(`${label} slider saves its selected value`, (await settingsAfterSave()).proportions[key] === expected);
  }
  for (const label of ['Side planes', 'Jaw', 'Ears', 'Hairline', 'Mouth', 'Fifths', 'Start', 'Child', 'Infant', 'Stylized']) {
    await page.getByRole('button', { name: `${label}, requires Pro`, exact: true }).click();
    await page.getByText('Purchases are not available yet.', { exact: true }).waitFor();
    check(`${label} opens the unavailable Pro screen`, await page.getByText('DrawDraw Pro', { exact: true }).isVisible());
    await page.getByText('Close', { exact: true }).click();
  }

  await tap('Style');
  const blueSwatch = page.getByRole('button', { name: 'Blue guide color', exact: true });
  check('guide colors have accessible names', await blueSwatch.count() === 1);
  if (await blueSwatch.count()) {
    await blueSwatch.click();
    check('guide color updates both saved settings and rendered paths',
      (await settingsAfterSave()).guideColor === '#3f6fb0' && await canvasPaths().first().getAttribute('stroke') === '#3f6fb0');
  }
  await page.getByRole('button', { name: 'Chalk guide color', exact: true }).click();
  await tap('Guide');
  await tap('Practice');
  const chalkContrast = await canvas().evaluate((element) => {
    const luminance = (color) => {
      const channels = color.startsWith('#')
        ? color.slice(1).match(/../g).map((part) => Number.parseInt(part, 16))
        : color.match(/[\d.]+/g).slice(0, 3).map(Number);
      const linear = channels.map((channel) => channel / 255 <= 0.04045 ? channel / 255 / 12.92 : ((channel / 255 + 0.055) / 1.055) ** 2.4);
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const line = element.querySelector('path[stroke-opacity="1"]');
    const foreground = luminance(line.getAttribute('stroke'));
    const background = luminance(getComputedStyle(element).backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  check('Chalk remains visible against the Practice background', chalkContrast >= 3, `${chalkContrast.toFixed(2)}:1`);
  await page.screenshot({ path: join(tmpdir(), 'drawdraw-chalk-practice.png'), fullPage: true });
  await tap('Practice');
  await tap('Style');
  await blueSwatch.click();
  await setSlider('Line weight', 0.7);
  check('line weight changes saved settings and rendered strokes',
    (await settingsAfterSave()).lineWeight === 4.5 &&
    await flatLineCount(4.5) === 5);
  await setSlider('Tracing', 0.7);
  check('tracing opacity updates the offscreen export layer and saves',
    (await settingsAfterSave()).tracingOpacity === 0.6 &&
    await page.locator('img').last().locator('..').evaluate((element) => Math.abs(Number(getComputedStyle(element).opacity) - 0.6) < 0.001));
  const editedSettings = await settingsAfterSave();
  await page.getByText('‹ Portraits', { exact: true }).click();
  await page.getByText('Choose a portrait', { exact: true }).waitFor();
  await page.locator('img').first().click();
  await page.getByText('Fit to face', { exact: true }).waitFor();
  check('reopening restores all edited guide settings', JSON.stringify(await settingsAfterSave()) === JSON.stringify(editedSettings));
  await tap('Reset');
  const reset = await settingsAfterSave();
  check('Reset restores pose, proportions and line positions',
    JSON.stringify(reset.headTransform) === JSON.stringify({ yaw: 0, pitch: 0, roll: 0, x: 0.5, y: 0.45, scale: 0.6 }) &&
    reset.proportions.width === 1 && reset.proportions.depth === 1 && reset.proportions.browY === 0.5 && reset.proportions.noseY === -0.5 &&
    reset.hGuides.every((value, index) => value === [1 / 3, 2 / 3][index]) && reset.vGuides.every((value, index) => value === [1 / 3, 2 / 3][index]));
  await page.getByRole('button', { name: 'Turnaround six views ✦', exact: true }).click();
  await page.getByText('Purchases are not available yet.', { exact: true }).waitFor();
  check('Turnaround export requires Pro', await page.getByText('DrawDraw Pro', { exact: true }).isVisible());
  await page.getByText('Close', { exact: true }).click();

  // Navigation must flush the latest edit even inside the debounce window.
  await page.getByText('Profile', { exact: true }).click();
  await page.getByText('‹ Portraits', { exact: true }).click();
  await page.getByText('Choose a portrait', { exact: true }).waitFor();
  const savedYaw = await page.evaluate(() => JSON.parse(localStorage.getItem('drawdraw.projects.v1'))[0].settings.headTransform.yaw);
  check('leaving immediately saves the latest pose', savedYaw === 90, `yaw=${savedYaw}`);
  await page.locator('img').first().click();
  await page.getByText('Fit to face', { exact: true }).waitFor();

  // Exercise the real AsyncStorage web adapter through a recoverable write failure.
  await page.evaluate(() => {
    window.originalStorageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'drawdraw.projects.v1') throw new Error('Simulated full storage');
      return window.originalStorageSet.call(this, key, value);
    };
  });
  await page.getByText('Front', { exact: true }).click();
  await page.getByText('‹ Portraits', { exact: true }).click();
  await page.getByText('Retry save', { exact: true }).waitFor();
  check('a failed save keeps the portrait open with a visible recovery action',
    await page.getByText('Fit to face', { exact: true }).isVisible());
  await page.screenshot({ path: join(tmpdir(), 'drawdraw-save-warning.png'), fullPage: true });
  await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSet; });
  await page.getByText('Retry save', { exact: true }).click();
  await page.getByText('Retry save', { exact: true }).waitFor({ state: 'hidden' });
  const retriedYaw = await page.evaluate(() => JSON.parse(localStorage.getItem('drawdraw.projects.v1'))[0].settings.headTransform.yaw);
  check('retry saves the latest work after storage recovers', retriedYaw === 0);
  await page.getByText('Profile', { exact: true }).click();
  const backgroundYaw = await page.evaluate(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const yaw = JSON.parse(localStorage.getItem('drawdraw.projects.v1'))[0].settings.headTransform.yaw;
    if (descriptor) Object.defineProperty(document, 'visibilityState', descriptor);
    else delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
    return yaw;
  });
  check('backgrounding flushes the pending edit', backgroundYaw === 90);

  await page.evaluate(() => {
    window.originalStorageGet = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'drawdraw.projects.v1') throw new Error('Simulated unavailable storage');
      return window.originalStorageGet.call(this, key);
    };
  });
  await page.getByText('‹ Portraits', { exact: true }).click();
  await page.getByText('Retry loading drawings', { exact: true }).waitFor();
  check('home reports a project read failure instead of pretending storage is empty',
    (await page.locator('body').innerText()).includes('Saved drawings could not be loaded'));
  await page.evaluate(() => { Storage.prototype.getItem = window.originalStorageGet; });
  await page.getByText('Retry loading drawings', { exact: true }).click();
  await page.locator('img').first().waitFor();
  const recoveredCount = await page.evaluate(() => JSON.parse(localStorage.getItem('drawdraw.projects.v1')).length);
  check('retry recovers the original saved drawing', recoveredCount === 1);
  const goodIndex = await page.evaluate(() => localStorage.getItem('drawdraw.projects.v1'));
  await page.evaluate(() => localStorage.setItem('drawdraw.projects.v1', '[null]'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Retry loading drawings', { exact: true }).waitFor();
  check('malformed project data shows a recoverable error and remains untouched',
    await page.evaluate(() => localStorage.getItem('drawdraw.projects.v1') === '[null]'));
  await page.evaluate((raw) => localStorage.setItem('drawdraw.projects.v1', raw), goodIndex);
  await page.getByText('Retry loading drawings', { exact: true }).click();
  await page.locator('img').first().waitFor();
  const mixedIndex = JSON.stringify([...JSON.parse(goodIndex), null]);
  await page.evaluate((raw) => localStorage.setItem('drawdraw.projects.v1', raw), mixedIndex);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Recover saved drawings', { exact: true }).waitFor();
  check('a damaged drawing does not hide readable drawings or overwrite the original index',
    await page.locator('img').first().isVisible() &&
    await page.evaluate((raw) => localStorage.getItem('drawdraw.projects.v1') === raw, mixedIndex));
  await page.locator('img').first().click();
  await page.getByText('Recover saved drawings', { exact: true }).waitFor();
  await page.getByText('Front', { exact: true }).click();
  await page.getByText('‹ Portraits', { exact: true }).click();
  check('recovery remains available in the editor after an unsaved edit',
    await page.getByText('Recover saved drawings', { exact: true }).isVisible());
  await page.evaluate(() => {
    window.recoveryBackupAttempts = 0;
    window.originalRecoverySet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'drawdraw.projects.recovery.v1') {
        window.recoveryBackupAttempts += 1;
        throw new Error('Simulated full recovery storage');
      }
      return window.originalRecoverySet.call(this, key, value);
    };
  });
  await page.getByText('Recover saved drawings', { exact: true }).click();
  await page.waitForFunction(() => window.recoveryBackupAttempts > 0);
  check('failed recovery backup preserves the original data and current edit',
    await page.evaluate((raw) => localStorage.getItem('drawdraw.projects.v1') === raw, mixedIndex) &&
    await page.getByText('Fit to face', { exact: true }).isVisible());
  await page.evaluate(() => { Storage.prototype.setItem = window.originalRecoverySet; });
  await page.getByText('Recover saved drawings', { exact: true }).click();
  await page.getByText('Recover saved drawings', { exact: true }).waitFor({ state: 'hidden' });
  const repaired = await page.evaluate((raw) => {
    const projects = JSON.parse(localStorage.getItem('drawdraw.projects.v1'));
    const copies = JSON.parse(localStorage.getItem('drawdraw.projects.recovery.v1'));
    return projects.length === 1 && projects[0].settings.headTransform.yaw === 0 && copies.some((copy) => copy.raw === raw);
  }, mixedIndex);
  check('editor recovery preserves the exact original copy and saves the latest edit', repaired);
  await page.getByText('‹ Portraits', { exact: true }).click();
  await page.getByText('Choose a portrait', { exact: true }).waitFor();
  const secondMixed = await page.evaluate(() => {
    const raw = JSON.stringify([...JSON.parse(localStorage.getItem('drawdraw.projects.v1')), { id: 'damaged' }]);
    localStorage.setItem('drawdraw.projects.v1', raw);
    return raw;
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Recover saved drawings', { exact: true }).click();
  await page.getByText('Recover saved drawings', { exact: true }).waitFor({ state: 'hidden' });
  check('home recovery preserves earlier recovery copies', await page.evaluate((raw) => {
    const copies = JSON.parse(localStorage.getItem('drawdraw.projects.recovery.v1'));
    return copies.length === 2 && copies.some((copy) => copy.raw === raw) && JSON.parse(localStorage.getItem('drawdraw.projects.v1')).length === 1;
  }, secondMixed));
  await page.getByText('Remove recovery copies', { exact: true }).waitFor();
  check('recovery copies have a visible removal control',
    await page.getByText('Remove recovery copies', { exact: true }).isVisible());
  await page.screenshot({ path: join(tmpdir(), 'drawdraw-recovered-home.png'), fullPage: true });

  const malformedSettingsIndex = JSON.stringify([{
    ...JSON.parse(goodIndex)[0],
    settings: {
      hGuides: 'damaged', showHorizontal: true, vGuides: {}, showVertical: true,
      headTransform: [], proportions: { width: 'damaged' },
      lineWeight: 'damaged', tracingOpacity: {},
    },
  }]);
  await page.evaluate((raw) => localStorage.setItem('drawdraw.projects.v1', raw), malformedSettingsIndex);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Recover saved drawings', { exact: true }).waitFor();
  check('damaged guide settings keep the portrait available with a recovery warning',
    (await page.locator('body').innerText()).includes('damaged guide settings') &&
    await page.locator('img').first().isVisible());
  await page.locator('img').first().click();
  await page.getByText('Fit to face', { exact: true }).waitFor();
  await page.getByText('H lines', { exact: true }).click();
  await page.getByText('V lines', { exact: true }).click();
  await page.getByText('Build', { exact: true }).click();
  await page.getByText('Brow line', { exact: true }).waitFor();
  await page.getByText('Style', { exact: true }).click();
  await page.getByText('Line weight', { exact: true }).waitFor();
  check('safe default guides render every editor panel without replacing damaged settings',
    await page.getByText('Guide only', { exact: false }).first().isVisible() &&
    await page.evaluate((raw) => localStorage.getItem('drawdraw.projects.v1') === raw, malformedSettingsIndex));
  await page.screenshot({ path: join(tmpdir(), 'drawdraw-settings-recovery.png'), fullPage: true });
  await page.getByText('Recover saved drawings', { exact: true }).click();
  await page.getByText('Recover saved drawings', { exact: true }).waitFor({ state: 'hidden' });
  check('recovering malformed guide settings archives the original and saves usable guides',
    await page.evaluate((raw) => {
      const saved = JSON.parse(localStorage.getItem('drawdraw.projects.v1'));
      const copies = JSON.parse(localStorage.getItem('drawdraw.projects.recovery.v1'));
      return copies.some((copy) => copy.raw === raw) && saved.length === 1 &&
        saved[0].settings.headTransform.yaw === 0 && saved[0].settings.lineWeight === 2 &&
        Array.isArray(saved[0].settings.hGuides) && saved[0].settings.showHorizontal === true;
    }, malformedSettingsIndex));
  await page.getByText('‹ Portraits', { exact: true }).click();
  await page.getByText('Choose a portrait', { exact: true }).waitFor();
  const collisionBase = JSON.parse(goodIndex)[0];
  const firstCollision = {
    ...collisionBase, id: 'legacy-collision',
    settings: { ...collisionBase.settings, headTransform: { ...collisionBase.settings.headTransform, yaw: 40 } },
  };
  const secondCollision = {
    ...collisionBase, id: 'legacy-collision',
    image: { ...collisionBase.image, uri: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#dddddd"/></svg>')}` },
    settings: { ...collisionBase.settings, headTransform: { ...collisionBase.settings.headTransform, yaw: 90 } },
  };
  const collisionIndex = JSON.stringify([firstCollision, secondCollision]);
  await page.evaluate((raw) => localStorage.setItem('drawdraw.projects.v1', raw), collisionIndex);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Recover saved drawings', { exact: true }).waitFor();
  check('legacy collisions keep both portraits visible without rewriting either drawing',
    await page.locator('img').count() === 2 &&
    (await page.locator('body').innerText()).includes('keep their guide settings separate') &&
    await page.evaluate((raw) => localStorage.getItem('drawdraw.projects.v1') === raw, collisionIndex));
  await page.screenshot({ path: join(tmpdir(), 'drawdraw-collision-recovery.png'), fullPage: true });
  await page.locator('img').nth(1).click();
  await page.getByText('Front', { exact: true }).click();
  await page.getByText('‹ Portraits', { exact: true }).click();
  await page.getByText('Recover saved drawings', { exact: true }).waitFor();
  await page.getByText('Recover saved drawings', { exact: true }).click();
  await page.getByText('Recover saved drawings', { exact: true }).waitFor({ state: 'hidden' });
  check('collision recovery archives the original and saves only the selected drawing',
    await page.evaluate(({ raw, firstUri, secondUri }) => {
      const saved = JSON.parse(localStorage.getItem('drawdraw.projects.v1'));
      const copies = JSON.parse(localStorage.getItem('drawdraw.projects.recovery.v1'));
      const first = saved.find(({ image }) => image.uri === firstUri);
      const second = saved.find(({ image }) => image.uri === secondUri);
      return copies.some((copy) => copy.raw === raw) && saved.length === 2 &&
        first.id !== second.id && first.settings.headTransform.yaw === 40 && second.settings.headTransform.yaw === 0;
    }, { raw: collisionIndex, firstUri: firstCollision.image.uri, secondUri: secondCollision.image.uri }));
  await page.getByText('‹ Portraits', { exact: true }).click();
  await page.getByText('Choose a portrait', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  check('onboarding stays dismissed after reload', !(await page.locator('body').innerText()).includes('Three segments'));
  await page.locator('img').first().click();
  await page.getByText('Fit to face', { exact: true }).waitFor();

  await tap('Build');
  await tap('Jaw'); // a Pro-gated construction line
  const paywall = await page.locator('body').innerText();
  check('a locked control opens the paywall', paywall.includes('DrawDraw Pro'));
  check('unconfigured billing is clearly unavailable without a fictional price or restore action',
    paywall.includes('Purchases are not available yet.') && !paywall.includes('$7.99') && !paywall.includes('Restore purchase'));
  const availabilityContrast = await page.getByText('Purchases are not available yet.', { exact: true }).evaluate((element) => {
    const luminance = (rgb) => {
      const channels = rgb.match(/[\d.]+/g).slice(0, 3).map((value) => {
        const c = Number(value) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    let background = element;
    while (background && getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)') background = background.parentElement;
    const foregroundLuminance = luminance(getComputedStyle(element).color);
    const backgroundLuminance = luminance(getComputedStyle(background).backgroundColor);
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  });
  check('billing availability text meets WCAG AA contrast', availabilityContrast >= 4.5, `${availabilityContrast.toFixed(2)}:1`);
  await page.screenshot({ path: join(tmpdir(), 'drawdraw-pro-unavailable.png'), fullPage: true });

  await page.getByText('Close', { exact: true }).click();
  await page.getByText('‹ Portraits', { exact: true }).click();
  await page.getByText('Choose a portrait', { exact: true }).waitFor();
  await tap('How it works');
  await tap('Next');
  const secondIntro = await page.getByText('Turn it with the face', { exact: true }).boundingBox();
  check('replayed introduction advances to its second page', secondIntro.x >= 0 && secondIntro.x + secondIntro.width <= 390);
  await tap('Next');
  check('replayed introduction reaches the Start drawing action', await page.getByText('Start drawing', { exact: true }).isVisible());
  await tap('Start drawing');
  check('finishing the replay returns to saved portraits', await page.locator('img').count() === 2);
  check('saved portraits have named opening and removal controls',
    await page.getByRole('button', { name: 'Open drawing 1', exact: true }).count() === 1 &&
    await page.getByRole('button', { name: 'Open drawing 2', exact: true }).count() === 1 &&
    await page.getByRole('button', { name: 'Remove drawing 1', exact: true }).isEnabled() &&
    await page.getByRole('button', { name: 'Remove drawing 2', exact: true }).isEnabled());
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByText('How it works', { exact: true }).scrollIntoViewIfNeeded();
  const smallFooter = await page.getByText('How it works', { exact: true }).boundingBox();
  check('Home scrolls its footer into reach on a small phone', smallFooter.y >= 0 && smallFooter.y + smallFooter.height <= 568);
  const openDrawing = page.getByRole('button', { name: 'Open drawing 1', exact: true });
  await openDrawing.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(tmpdir(), 'drawdraw-accessible-home-small.png'), fullPage: true });
  await openDrawing.focus();
  await page.keyboard.press('Enter');
  await page.getByText('Fit to face', { exact: true }).waitFor();
  check('a named portrait can be reopened with the keyboard', await page.getByRole('button', { name: 'Guide only transparent', exact: true }).isEnabled());

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
