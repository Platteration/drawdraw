/**
 * End-to-end test of the website.
 *
 * Bundling proves the app compiles; this proves the site runs. It serves the
 * built site (scripts/build-web.mjs) at a sub-path, from a host that sends the
 * response headers exactly as the site's `_headers` writes them (e2e/host.mjs),
 * and drives the real critical path in Chromium under that policy —
 * onboarding, importing a portrait, fitting the guide with three taps, the
 * three free exports read back pixel by pixel, the paywall and Settings —
 * measuring where the guide actually landed against a portrait laid out on
 * known thirds. Any Content-Security-Policy or Trusted Types violation, any
 * console or page error, and any request outside the site fails the run, so a
 * policy that blocks something real is caught here. It then checks the
 * hosting layer itself: the 404 page, the safety net when the bundle cannot
 * load or never draws, the page without JavaScript, and the files a host must
 * not serve. e2e/hosts.mjs then serves the same build from a real nginx and
 * Apache.
 *
 * That host runs no API, as GitHub Pages and Netlify run none: the page asks
 * api/config once per load, is answered with the 404 page, and draws no
 * sign-in and no shop. Then the same build is served with the site's API
 * beside it (server/kit with server/catalogue.js, as Cloudflare Pages runs
 * functions/api/[[path]].js), its Google and Stripe the fakes of
 * server/fakes.mjs handed to the kit as its `fetch`, and the whole flow is
 * played under the site's policy: sign in with Google, buy Pro through
 * Checkout, Stripe's signed webhook, Pro drawn in the editor, sign out, sign
 * in again, delete the account, a refused sign-in and a cancelled Checkout.
 *
 *   npm run test:e2e
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import catalogue from '../server/catalogue.js';
import { createFakes, envFor, signedDelivery } from '../server/fakes.mjs';
import { createNodeHandler } from '../server/kit/node.js';
import { createMemoryStore } from '../server/kit/store.js';
import { headersFor, startHost } from './host.mjs';
import { PORTRAIT, writePortrait } from './portrait.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(root, process.env.WEB_BUILD_DIR || '.web-build');
const BASE = process.env.WEB_BASE_URL || '/drawdraw';
const TOLERANCE = 8; // source-image pixels; taps are placed exactly here

if (!existsSync(join(BUILD, 'index.html'))) {
  console.error(`No web build at ${BUILD}. Run: node scripts/build-web.mjs --base-url ${BASE}`);
  process.exit(1);
}

const host = await startHost({ dir: BUILD, base: BASE });
const { site } = host;

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
 * is precisely why a traversal is never noticed from inside a browser.
 */
const rawRequest = (line) =>
  new Promise((done) => {
    const socket = connect(host.port, '127.0.0.1', () =>
      socket.write(`GET ${line} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`)
    );
    let received = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => (received += chunk));
    socket.on('close', () => done(received));
    socket.on('error', () => done(''));
  });

for (const line of [`${BASE}/../../../../etc/passwd`, `${BASE}/%2e%2e/package.json`, `${BASE}/..%2f..%2fpackage.json`, `${BASE}/%`]) {
  const response = await rawRequest(line);
  check(`the host serves nothing outside the site: ${line}`, response.startsWith('HTTP/1.1 404'), response.split('\r\n')[0]);
}
host.outside.length = 0; // those were this test's own probes

// The policy, as the hosts send it and as the pages carry it.
const sent = headersFor(host.rules, '/index.html');
const policy = sent['content-security-policy'];
const metaPolicy = (csp) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !d.startsWith('frame-ancestors'))
    .join('; ');
for (const page of ['index.html', '404.html']) {
  const html = readFileSync(join(BUILD, page), 'utf8');
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1];
  check(`${page} carries the policy as a <meta>, frame-ancestors aside`, meta === metaPolicy(policy), meta ?? 'no meta');
  const referrer = /<meta name="referrer" content="([^"]*)"/.exec(html)?.[1];
  check(`${page} carries the referrer policy`, referrer === sent['referrer-policy'], referrer ?? 'none');
  check(`${page} names nothing outside ${BASE}/`, ![...html.matchAll(/\b(?:href|src)="(\/[^"]*)"/g)].some((m) => !m[1].startsWith(`${BASE}/`)));
}

const browser = await chromium.launch({ executablePath: findChromium() });

/**
 * A page that records everything that must not happen on the site: a
 * policy violation (reported in the page, and in the console, where a
 * Trusted Types refusal inside a frame the page made also lands), a page
 * error, a console error, and a request for anything outside the site.
 *
 * `on` is the site the page is served from. `leaves` are the outside
 * addresses the page may navigate to, each answered by page.route in the
 * browser and never sent (Google's authorize page and Stripe's Checkout);
 * those navigations are kept in `left`. The one console error excused is
 * Chromium's line for the page's own api/config when it is a 404, as it is on
 * every host that runs no API: matched by the address it is reported at, not
 * by its words, and counted in `probes`.
 */
async function sitePage(options = {}, { on = site, leaves = [] } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    acceptDownloads: true,
    ...options,
  });
  const page = await context.newPage();
  const problems = [];
  const probes = [];
  const left = [];
  await page.exposeBinding('__reportViolation', (_source, text) => problems.push(`violation: ${text}`));
  await page.addInitScript(() => {
    document.addEventListener(
      'securitypolicyviolation',
      (e) => window.__reportViolation(`${e.effectiveDirective} blocked ${e.blockedURI || 'inline'} (${e.sourceFile}:${e.lineNumber})`),
      true
    );
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && m.location().url === `${on}api/config` && /status of 404/.test(m.text())) {
      probes.push(m.text());
      return;
    }
    if (m.type() === 'error' || /Content Security Policy|Trusted ?(Type|HTML|Script)/i.test(m.text())) {
      problems.push(`console.${m.type()}: ${m.text().slice(0, 200)} (${m.location().url})`);
    }
  });
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith(on) || url.startsWith('blob:') || url.startsWith('data:')) return;
    if (r.isNavigationRequest() && leaves.some((prefix) => url.startsWith(prefix))) left.push(url);
    else problems.push(`request outside the site: ${url}`);
  });
  return { context, page, problems, probes, left };
}

const { context, page, problems, probes } = await sitePage();
const dialogs = [];
page.on('dialog', async (dialog) => {
  dialogs.push(dialog.message());
  await dialog.accept();
});

// Visible matches only: the safety net's notes sit hidden in the page with words of their own.
const tap = async (text, { exact = false } = {}) => {
  await page.getByText(text, { exact }).filter({ visible: true }).first().click({ timeout: 10000 });
  await page.waitForTimeout(400);
};

/** The RGBA pixels of a PNG file, decoded by the browser (in a page with no policy of its own). */
async function decodePng(path) {
  const decoder = await browser.newPage();
  try {
    return await decoder.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, data: Array.from(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data) };
    }, readFileSync(path).toString('base64'));
  } finally {
    await decoder.close();
  }
}
const pixel = (png, x, y) => {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return png.data.slice(i, i + 4);
};
/** Whether row `y` of `png` holds the guide colour (sanguine, #b4543a) anywhere across the face. */
const guideOnRow = (png, y, from, to) => {
  for (let dy = -3; dy <= 3; dy++) {
    for (let x = from; x <= to; x++) {
      const [r, g, b, a] = pixel(png, x, y + dy);
      if (a > 200 && Math.abs(r - 180) < 30 && Math.abs(g - 84) < 30 && Math.abs(b - 58) < 30) return true;
    }
  }
  return false;
};

/** Press an export button and read the PNG it downloads. */
async function exportPng(label) {
  const download = page.waitForEvent('download', { timeout: 15000 });
  await page.getByText(label, { exact: false }).filter({ visible: true }).first().click({ timeout: 10000 });
  const file = await download;
  const path = join(mkdtempSync(join(tmpdir(), 'drawdraw-export-')), file.suggestedFilename());
  await file.saveAs(path);
  return { name: file.suggestedFilename(), png: await decodePng(path) };
}

const portraitPath = writePortrait(join(mkdtempSync(join(tmpdir(), 'drawdraw-')), 'portrait.png'));

/** The app's critical path, under the policy. */
async function walkThrough() {
  const response = await page.goto(site, { waitUntil: 'networkidle' });
  check('the page is served with the policy as _headers writes it', response.headers()['content-security-policy'] === policy);
  await page.waitForTimeout(1200);

  const intro = await page.locator('body').innerText();
  check('onboarding is shown on first launch', intro.includes('Three segments'));
  check('the safety net stays out of the way of a running app', !(await page.locator('#site-not-started').isVisible()) && !(await page.locator('#site-stopped').isVisible()));

  await tap('Skip');
  const home = await page.locator('body').innerText();
  check('home screen offers a portrait', home.includes('Choose a portrait'));
  check('home screen says a browser does not keep portraits', home.includes('In a browser, DrawDraw keeps your settings but not your portraits'));

  // The dismissal has to be written, or the intro is back on every launch.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const again = await page.locator('body').innerText();
  check('the dismissed intro stays dismissed across a reload', !again.includes('Three segments') && again.includes('Choose a portrait'));

  const chooser = page.waitForEvent('filechooser');
  await tap('Choose a portrait');
  await (await chooser).setFiles(portraitPath);
  await page.waitForTimeout(2500);

  const editor = await page.locator('body').innerText();
  check('importing a portrait opens the editor', editor.includes('Fit to face'));
  check('a browser import raises no "not saved" dialog', dialogs.length === 0, dialogs.join(' | '));

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

  // The three free exports, downloaded and read back. Each is at the photo's
  // own size, not the 361-pixel view stretched, and holds what it says.
  const face = { from: PORTRAIT.centerX - 140, to: PORTRAIT.centerX + 140 };
  const background = { x: 40, y: 60 }; // outside the head, inside the photo
  const combined = await exportPng('Photo\n+ guide');
  check('"Photo + guide" downloads a PNG named for what it is', combined.name === 'drawdraw-photo-with-guide.png', combined.name);
  check('"Photo + guide" is at the photo\'s own size', combined.png.width === PORTRAIT.width && combined.png.height === PORTRAIT.height, `${combined.png.width}x${combined.png.height}`);
  check('"Photo + guide" carries the photo', pixel(combined.png, background.x, background.y)[3] === 255 && Math.abs(pixel(combined.png, background.x, background.y)[2] - 214) < 8, pixel(combined.png, background.x, background.y).join(','));
  check('"Photo + guide" carries the fitted brow line, on the brow', guideOnRow(combined.png, PORTRAIT.brow, face.from, face.to));

  await tap('H lines'); // flat guide lines are boxes, not SVG: the export draws both
  const guide = await exportPng('Guide only');
  check('"Guide only" is at the photo\'s own size', guide.png.width === PORTRAIT.width && guide.png.height === PORTRAIT.height, `${guide.png.width}x${guide.png.height}`);
  check('"Guide only" is transparent where there is no line', pixel(guide.png, background.x, background.y)[3] === 0, pixel(guide.png, background.x, background.y).join(','));
  check('"Guide only" carries the brow line and the nose line', guideOnRow(guide.png, PORTRAIT.brow, face.from, face.to) && guideOnRow(guide.png, PORTRAIT.nose, face.from, face.to));
  check('"Guide only" carries the flat thirds, edge to edge', [1, 2].every((k) => guideOnRow(guide.png, (PORTRAIT.height * k) / 3, 2, 30)));
  await tap('H lines');

  const tracing = await exportPng('Tracing');
  const faded = pixel(tracing.png, background.x, background.y);
  check('"Tracing layer" is the photo faded to its 30% default', Math.abs(faded[3] - 0.3 * 255) <= 3, faded.join(','));
  check('"Tracing layer" carries no guide', !guideOnRow(tracing.png, PORTRAIT.brow, face.from, face.to));

  await tap('Build');
  await tap('Jaw'); // a Pro-gated construction line
  const paywall = await page.locator('body').innerText();
  check('a locked control opens the paywall', paywall.includes('Unlock Pro'));
  // This build's provider sells nothing, so the button carries its words and no
  // currency amount. (The body text also holds the editor's slider values —
  // 0.68 and the like — so "digits with two decimals" is not the test here.)
  const buy = paywall.split('\n').find((line) => line.startsWith('Unlock Pro'));
  check('the paywall prices nothing it cannot sell', buy === 'Unlock Pro · not available in this build' && !/[$£€¥]\s?\d/.test(paywall), buy || 'no button');
  // react-native-web's Alert is an empty stub: the browser dialog is the only
  // kind this build can raise, and the handler above is what proves one was.
  dialogs.length = 0;
  await tap('Unlock Pro · not available');
  check('buying says it is not available, through the browser dialog', dialogs.length === 1 && dialogs[0].startsWith('Not available yet'), dialogs.join(' | ') || 'no dialog');

  await tap('Close');
  // Leaving the instant after an edit, before the 600 ms autosave has fired.
  // On a device the editor writes the edit before it goes, and a write that
  // fails keeps it open and asks (the unit suite holds both); a browser keeps
  // no portrait, so there is no record to write and it leaves at once, with
  // no dialog about it.
  await tap('Guide', { exact: true });
  dialogs.length = 0;
  await page.getByText('Profile', { exact: true }).filter({ visible: true }).first().click({ timeout: 10000 });
  await page.getByText('‹ Portraits', { exact: true }).filter({ visible: true }).first().click({ timeout: 10000 });
  const left = await page.getByText('Choose a portrait', { exact: true }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  check('leaving straight after an edit goes home at once, with no dialog', left && dialogs.length === 0, dialogs.join(' | ') || (left ? '' : 'still in the editor'));
  await page.waitForTimeout(400);
  await tap('Settings', { exact: true }); // the home screen's web note mentions settings too
  const settings = await page.locator('body').innerText();
  check('settings shows its rows', settings.includes('Vibration') && settings.includes('Reset to defaults'));
  check('the Vibration row says a browser cannot vibrate', settings.includes('A browser cannot vibrate'));
  check('the Vibration switch is disabled in a browser', await page.getByRole('switch', { name: 'Vibration' }).isDisabled());
  const version = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.version;
  check('about carries the version from app.json', settings.includes(`DrawDraw ${version}`), `wanted ${version}`);
  check('about says what stays on the device', settings.includes('Nothing leaves your device: the page sends nothing of yours'));
  // GitHub Pages and Netlify run nothing: api/config is the 404 page, and the account and the
  // shop do not exist. The page asked once per load and nothing after the 404.
  check('with no API on the host, Settings draws no account', !settings.includes('Sign in with Google') && !/\bACCOUNT\b/i.test(settings));
  const asked = host.served.filter((s) => s.path.startsWith('/api/'));
  check(
    'with no API on the host, the page asked for api/config once per load, and nothing more',
    asked.length === 2 && asked.every((s) => s.path === '/api/config' && s.status === 404) && probes.length === 2,
    JSON.stringify(asked)
  );
  dialogs.length = 0;
  await tap('Reset to defaults');
  check('reset asks first, through the browser dialog', dialogs.length === 1 && dialogs[0].startsWith('Reset settings?'), dialogs.join(' | ') || 'no dialog');
}

/** The headers server/kit sends on every answer of its own (server/kit/http.js). */
const API_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

/**
 * The website with its API beside it, as Cloudflare Pages serves functions/api/[[path]].js: the
 * real build under `_headers`, server/kit with this app's catalogue answering <base>/api/*, and
 * APP_URL this host's own address, as on a deployment. Google and Stripe are the fakes of
 * server/fakes.mjs, handed to the kit as its fetch; in the browser, page.route answers Google's
 * authorize page and Stripe's Checkout, and nothing reaches either.
 */
async function withApi() {
  const fakes = await createFakes();
  let handler = null;
  const shop = await startHost({ dir: BUILD, base: BASE, api: (req, res) => handler(req, res) });
  const logs = [];
  handler = createNodeHandler({
    catalogue,
    env: envFor(shop.site),
    store: createMemoryStore(),
    fetch: fakes.fetch,
    log: (level, message) => logs.push(`${level}: ${message}`),
  });
  check('the API beside the site has sign-in and the shop on', handler.features.signIn && handler.features.shop);
  const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?';
  const CHECKOUT = 'https://checkout.stripe.com/c/pay/';
  const visitor = await sitePage({}, { on: shop.site, leaves: [GOOGLE, CHECKOUT] });
  const p = visitor.page;
  const dialogs = [];
  p.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });
  // The API's own answers carry its headers, not _headers': Pages applies neither to a Function.
  const apiHeaders = [];
  p.on('response', (r) => {
    if (!r.url().startsWith(`${shop.site}api/`)) return;
    const got = r.headers();
    for (const [name, value] of Object.entries(API_HEADERS)) if (got[name] !== value) apiHeaders.push(`${r.url()} ${name}: ${got[name]}`);
  });
  // Pro bought nowhere, planted in this browser's storage as anything on the origin could: while
  // the site sells Pro it is what api/me says, and this unlocks nothing.
  await p.addInitScript(() => {
    localStorage.setItem('drawdraw.settings.v1', JSON.stringify({ seenIntro: true }));
    localStorage.setItem('drawdraw.entitlements.v1', JSON.stringify({ pro: true }));
  });

  // Google's side. Playwright routes no redirect's target: measured, neither page.route nor
  // context.route sees the browser follow the kit's 302 to accounts.google.com (nor one that
  // route.fulfill hands it), and the browser goes to Google for real. So the kit's own answer to
  // api/auth/google/start, its sign-in cookie included, reaches the browser as a Refresh to the
  // same address: the browser then navigates to Google's authorize URL itself, and the route
  // below answers it as Google does, with a 302 to the callback (fakes.consent checks the URL as
  // Google would), or with Google's error=access_denied when refusing. The callback arrives from
  // that cross-site hop, as it does from Google, so the cookie's SameSite is what a real sign-in meets.
  const answered = [];
  const startProblems = [];
  let refuse = false;
  await p.route(`${shop.site}api/auth/google/start?*`, async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const { location = '', ...headers } = response.headers();
    if (response.status() !== 302 || !location.startsWith(GOOGLE)) startProblems.push(`${response.status()} ${location}`);
    await route.fulfill({ status: 200, headers: { ...headers, refresh: `0;url=${location}` }, body: '' });
  });
  await p.route('https://accounts.google.com/**', async (route) => {
    const url = route.request().url();
    answered.push(url);
    let back;
    if (refuse) {
      const asked = new URL(url).searchParams;
      back = new URL(asked.get('redirect_uri'));
      back.searchParams.set('error', 'access_denied');
      back.searchParams.set('state', asked.get('state'));
    } else {
      back = fakes.consent(url, { sub: '1001', email: 'ada@example.com' });
    }
    await route.fulfill({ status: 302, headers: { location: back.href } });
  });
  // Stripe's side: Checkout, paid at once, sends the visitor back to the success_url.
  const checkouts = [];
  await p.route('https://checkout.stripe.com/**', (route) => {
    const url = route.request().url();
    answered.push(url);
    checkouts.push(url);
    return route.fulfill({ status: 302, headers: { location: `${shop.site}?purchase=success` } });
  });

  const visible = (text, exact = true) => p.getByText(text, { exact }).filter({ visible: true }).first();
  const press = async (text, exact = true) => {
    await visible(text, exact).click({ timeout: 10000 });
    await p.waitForTimeout(300);
  };
  const shows = (text, exact = true) => visible(text, exact).waitFor({ timeout: 20000 }).then(() => true, () => false);
  const home = () => visible('Choose a portrait').waitFor({ timeout: 15000 });
  const footerOffersPro = async () => (await p.getByText('Unlock Pro', { exact: true }).filter({ visible: true }).count()) === 1;
  const settingsText = async () => {
    await press('Settings');
    await shows('Reset to defaults');
    const text = await p.locator('body').innerText();
    await press('Close');
    return text;
  };
  /** Waits for a press to leave the page and for the page it comes back to, at `back`, to draw. */
  const leaveAndReturn = async (text, through, back = shop.site) => {
    const left = p.waitForRequest((r) => r.url().startsWith(through), { timeout: 15000 });
    const returned = p.waitForRequest((r) => r.url() === back && r.isNavigationRequest(), { timeout: 15000 });
    await press(text);
    await left;
    await returned;
    await p.waitForLoadState('load');
  };
  const signIn = async (from = 'Sign in with Google') => {
    if (from === 'Sign in with Google') await press('Settings');
    await leaveAndReturn(from, `${shop.site}api/auth/google/callback`);
    await home();
  };

  try {
    await p.goto(shop.site, { waitUntil: 'networkidle' });
    await home();
    check('with the shop on, a Pro flag in this browser\'s storage unlocks nothing', await footerOffersPro());
    const signedOut = await settingsText();
    check('Settings offers Sign in with Google', /\bACCOUNT\b/i.test(signedOut) && signedOut.includes('Sign in with Google'));
    check('about says what signing in and buying tell the site', signedOut.includes('Nothing leaves your device unless you sign in or buy.'));

    await press('Unlock Pro');
    check('the paywall sells Pro at the price Stripe states', await shows('$7.99'));
    check('and asks a signed-out visitor to sign in to buy, with no Restore', (await shows('Sign in to buy')) && (await p.getByText('Restore purchase').count()) === 0);
    await signIn('Sign in to buy');
    check('signing in comes back to the page', new URL(p.url()).pathname === `${BASE}/`, p.url());
    check('Settings names who is signed in', (await settingsText()).includes('Signed in as ada@example.com'));
    check('signed in, nothing is owned yet', await footerOffersPro());

    await press('Unlock Pro');
    await leaveAndReturn('Buy', CHECKOUT, `${shop.site}?purchase=success`);
    await home();
    check('Buy left for Stripe\'s Checkout once, and Checkout sent the visitor back', checkouts.length === 1 && new URL(p.url()).search === '', `${checkouts.length} ${p.url()}`);
    // Back from Checkout nothing is granted yet: only Stripe's signed word grants it.
    check('coming back from Checkout grants nothing by itself', await footerOffersPro());
    const delivery = signedDelivery(fakes.paid(checkouts[0]));
    const hook = await fetch(`${shop.site}api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': delivery.signature },
      body: delivery.body,
    });
    check('Stripe\'s signed webhook is taken', hook.status === 200, String(hook.status));
    check('the page asks api/me until Pro shows, then says thank you', await shows('Thank you — DrawDraw Pro is unlocked.'));
    check('and Pro is no longer offered', !(await footerOffersPro()));
    await press('Dismiss');

    // Pro drawn: the editor's Pro construction lines are no longer locked.
    const chooser = p.waitForEvent('filechooser');
    await press('Choose a portrait');
    await (await chooser).setFiles(portraitPath);
    await shows('Fit to face');
    await press('Build');
    check('the editor draws Pro\'s construction lines unlocked', (await shows('Jaw')) && (await p.getByText('Jaw ✦').count()) === 0);
    await press('‹ Portraits');
    await home();

    await press('Settings');
    await press('Sign out');
    check('signing out offers Sign in with Google again', await shows('Sign in with Google'));
    await press('Close');
    check('and Pro goes with the account', await footerOffersPro());

    await signIn();
    check('the purchase is the account\'s: signing in again brings Pro back', !(await footerOffersPro()));

    await press('Settings');
    dialogs.length = 0;
    await press('Delete account');
    check('deleting the account asks first, and says Pro goes with it', dialogs.length === 1 && dialogs[0].startsWith('Delete account?') && dialogs[0].includes('DrawDraw Pro'), dialogs.join(' | '));
    check('then signs out', await shows('Sign in with Google'));
    await press('Close');
    check('and Pro is gone', await footerOffersPro());
    await signIn();
    check('signing in again after deleting starts with nothing', await footerOffersPro());
    check('as the same person, signed in', (await settingsText()).includes('Signed in as ada@example.com'));

    // A sign-in Google refuses comes back to the site, which says so once and cleans the address.
    await press('Settings');
    await press('Sign out');
    await shows('Sign in with Google');
    refuse = true;
    await leaveAndReturn('Sign in with Google', `${shop.site}api/auth/google/callback`, `${shop.site}?signin=failed`);
    check("a refused sign-in says Sign-in didn't complete.", await shows("Sign-in didn't complete."));
    check('and leaves the address clean', new URL(p.url()).search === '', p.url());
    await press('Dismiss');
    await p.goto(`${shop.site}?purchase=cancelled`, { waitUntil: 'networkidle' });
    await home();
    check('a cancelled Checkout only cleans the address', new URL(p.url()).search === '' && (await p.getByRole('alert').count()) === 0, p.url());
  } catch (err) {
    check('the sign-in and shop walk ran to its end', false, err.message.split('\n')[0]);
  } finally {
    await visitor.context.close();
    await shop.close();
  }

  // Every page that left the site went to Google's authorize URL or Stripe's Checkout, each
  // answered in the browser; nothing reached either, and the fakes were asked nothing they do not serve.
  check('the kit sent the browser to Google\'s authorize URL each time', startProblems.length === 0, startProblems.join(' | '));
  check(
    'every page that left the site was answered in the browser: four sign-ins at Google, one Checkout',
    JSON.stringify(visitor.left) === JSON.stringify(answered) && answered.filter((u) => u.startsWith(GOOGLE)).length === 4 && checkouts.length === 1,
    `${visitor.left.length} left, ${answered.length} answered`
  );
  check('the API answered with its own headers', apiHeaders.length === 0, apiHeaders.slice(0, 3).join(' | '));
  check('the sign-in and shop walk raised no violation, page or console error, and asked nothing outside the site', visitor.problems.length === 0 && shop.outside.length === 0, [...visitor.problems, ...shop.outside].slice(0, 4).join(' | '));
  check('the fakes of Google and Stripe were asked nothing they do not serve, and the kit logged nothing', fakes.unexpected.length === 0 && logs.length === 0, [...fakes.unexpected, ...logs].join(' | '));
}

try {
  // A step that cannot be taken (a control the policy kept from rendering) still
  // reports what the page recorded on the way, which is usually why.
  await walkThrough().catch((err) => check('the walk-through ran to its end', false, err.message.split('\n')[0]));
  check('no policy violation, page error, console error or request outside the site', problems.length === 0, problems.slice(0, 4).join(' | '));
  check('the host saw no request outside the site', host.outside.length === 0, host.outside.slice(0, 3).join(' | '));
  await context.close();

  // The hosting layer itself.
  const missing = await sitePage();
  const nowhere = `${site}no/such/page`;
  const notFound = await missing.page.goto(nowhere, { waitUntil: 'networkidle' });
  check('a missing address is a 404', notFound.status() === 404, String(notFound.status()));
  check('it shows the site\'s own 404 page', (await missing.page.locator('h1').innerText()) === 'That page isn’t here');
  const paper = await missing.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('the 404 page is styled at any depth', paper === 'rgb(244, 239, 230)', paper);
  check('its way back leads to the app', (await missing.page.locator('a.button').getAttribute('href')) === `${BASE}/`);
  // Chromium logs the 404 status of the page itself as a console error; that one is the point.
  const notFoundProblems = missing.problems.filter((p) => !(p.includes('status of 404') && p.endsWith(`(${nowhere})`)));
  check('the 404 page raises no violation and asks for nothing outside the site', notFoundProblems.length === 0, notFoundProblems.slice(0, 3).join(' | '));
  await missing.context.close();

  // Each config also by other spellings of the same file, which this host served while it
  // refused the configs by name rather than by the file a path resolves to.
  for (const path of ['_headers', '_redirects', '.htaccess', '_routes.json', '/_headers', '/_redirects', '/.htaccess', '%2F.htaccess', 'README.md', 'server/catalogue.js', 'functions/api/[[path]].js', 'package.json', 'app.json', '.git/config', 'deploy/nginx.conf', 'src/screens/HomeScreen.tsx', '_expo/']) {
    const status = (await fetch(`${site}${path}`)).status;
    check(`the host does not serve ${path}`, status === 404, String(status));
  }
  const securityTxt = await fetch(`${site}.well-known/security.txt`);
  check('/.well-known/security.txt is served as text', securityTxt.status === 200 && securityTxt.headers.get('content-type').startsWith('text/plain') && (await securityTxt.text()).includes('Contact: '));
  const bundle = readdirSync(join(BUILD, '_expo/static/js/web'))[0];
  const cached = await fetch(`${site}_expo/static/js/web/${bundle}`);
  check('the content-hashed bundle is cached for a year', cached.headers.get('cache-control') === 'public, max-age=31536000, immutable', cached.headers.get('cache-control'));
  check('the page is revalidated on every load', (await fetch(site)).headers.get('cache-control') === 'no-cache');

  // The safety net: a bundle that cannot load leaves a note, not a blank page.
  const broken = await sitePage();
  await broken.page.route('**/_expo/static/**', (route) => route.abort());
  await broken.page.goto(site, { waitUntil: 'load' });
  await broken.page.waitForTimeout(500);
  check('a bundle that fails to load shows the "has not started" note', await broken.page.locator('#site-not-started').isVisible());
  await broken.context.close();

  // Without site.css the app still draws, into a root with no height: the note stays.
  const unstyled = await sitePage();
  await unstyled.page.route('**/site.css', (route) => route.abort());
  await unstyled.page.goto(site, { waitUntil: 'networkidle' });
  await unstyled.page.waitForTimeout(800);
  check('a stylesheet that fails to load keeps the "has not started" note up', await unstyled.page.locator('#site-not-started').isVisible());
  await unstyled.context.close();

  // A bundle that loads and runs but never draws (not every failure throws): guard.js's watchdog
  // shows the note eight seconds after load. The page runs on Playwright's clock, so the test
  // moves time on rather than waiting for it.
  const silent = await sitePage();
  await silent.page.clock.install();
  await silent.page.route('**/_expo/static/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await silent.page.goto(site, { waitUntil: 'load' });
  await silent.page.clock.runFor(7000);
  check('a bundle that runs but never draws shows no note seven seconds after load', !(await silent.page.locator('#site-not-started').isVisible()));
  await silent.page.clock.runFor(1500);
  check('and the "has not started" note once the watchdog\'s eight seconds are up', await silent.page.locator('#site-not-started').isVisible());
  check('a silent bundle raises no violation and asks for nothing outside the site', silent.problems.length === 0, silent.problems.slice(0, 3).join(' | '));
  await silent.context.close();

  // Pro's turnaround sheet, the one export with text in it. This build sells
  // nothing, so the test plants the stored entitlement the way a purchase would.
  const pro = await sitePage();
  await pro.page.addInitScript(() => {
    localStorage.setItem('drawdraw.settings.v1', JSON.stringify({ seenIntro: true }));
    localStorage.setItem('drawdraw.entitlements.v1', JSON.stringify({ pro: true }));
  });
  await pro.page.goto(site, { waitUntil: 'networkidle' });
  const proChooser = pro.page.waitForEvent('filechooser');
  await pro.page.getByText('Choose a portrait', { exact: true }).click();
  await (await proChooser).setFiles(portraitPath);
  await pro.page.waitForTimeout(2000);
  const sheetDownload = pro.page.waitForEvent('download', { timeout: 15000 });
  await pro.page.getByText('Turnaround', { exact: false }).filter({ visible: true }).first().click();
  const sheetPath = join(mkdtempSync(join(tmpdir(), 'drawdraw-export-')), 'sheet.png');
  await (await sheetDownload).saveAs(sheetPath);
  const sheet = await decodePng(sheetPath);
  check('the turnaround sheet is six 240x280 views at 3x', sheet.width === 2160 && sheet.height === 1680, `${sheet.width}x${sheet.height}`);
  /** Pixels in the guide colour within a rectangle of `png`. */
  const ink = (png, x0, y0, x1, y1, minAlpha = 200) => {
    let count = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const [r, g, b, a] = pixel(png, x, y);
        if (a > minAlpha && Math.abs(r - 180) < 40 && Math.abs(g - 84) < 40 && Math.abs(b - 58) < 40) count++;
      }
    }
    return count;
  };
  const heads = [0, 1].flatMap((row) => [0, 1, 2].map((col) => ink(sheet, col * 720 + 60, row * 840 + 60, col * 720 + 660, row * 840 + 700)));
  check('every view on the sheet has its head', heads.every((n) => n > 2000), heads.join(', '));
  // The label sits on the bottom of its cell, 12 points up, in the guide colour at 75%.
  const labels = [0, 1].flatMap((row) => [0, 1, 2].map((col) => ink(sheet, col * 720, row * 840 + 756, col * 720 + 720, row * 840 + 804, 100)));
  check('every view on the sheet carries its label', labels.every((n) => n > 200), labels.join(', '));
  check('Pro on the web raises no violation and asks for nothing outside the site', pro.problems.length === 0, pro.problems.slice(0, 3).join(' | '));
  await pro.context.close();

  // A hostile portrait: an SVG the visitor was sent, with a script, an event
  // handler, a remote image, a foreignObject and markup in its file name. As a
  // picture it runs nothing and fetches nothing, and the export the browser will
  // not hand back (a foreignObject taints the canvas) fails with a plain message.
  const hostileDir = mkdtempSync(join(tmpdir(), 'drawdraw-hostile-'));
  const hostile = join(hostileDir, '<img src=x onerror=alert(2)>.svg');
  writeFileSync(
    hostile,
    '<svg xmlns="http://www.w3.org/2000/svg" width="700" height="900" onload="alert(1)"><script>alert(3)</script>' +
      '<rect width="700" height="900" fill="#ccd"/><image href="https://example.com/track.png" width="10" height="10"/>' +
      '<foreignObject width="700" height="900"><div xmlns="http://www.w3.org/1999/xhtml">hi<img src="https://example.com/x.png"/></div></foreignObject></svg>'
  );
  const attack = await sitePage();
  const attackDialogs = [];
  attack.page.on('dialog', async (dialog) => {
    attackDialogs.push(dialog.message());
    await dialog.accept();
  });
  await attack.page.addInitScript(() => localStorage.setItem('drawdraw.settings.v1', JSON.stringify({ seenIntro: true })));
  await attack.page.goto(site, { waitUntil: 'networkidle' });
  const attackChooser = attack.page.waitForEvent('filechooser');
  await attack.page.getByText('Choose a portrait', { exact: true }).click();
  await (await attackChooser).setFiles(hostile);
  await attack.page.waitForTimeout(2000);
  check('a hostile SVG portrait still opens the editor', (await attack.page.locator('body').innerText()).includes('Fit to face'));
  await attack.page.getByText('Photo\n+ guide').click();
  await attack.page.waitForTimeout(2500);
  check('it runs no script: the only dialog is the failed export, in plain words', attackDialogs.length === 1 && attackDialogs[0].startsWith('Export failed\n\nThis picture can be shown but not exported'), attackDialogs.join(' | '));
  check('it reaches nothing outside the site and breaks no policy', attack.problems.length === 0, attack.problems.slice(0, 3).join(' | '));
  await attack.context.close();

  // React 19 unmounts the whole tree on an uncaught render error, leaving the
  // root empty: the note says the app stopped instead of a blank page.
  const stopping = await sitePage();
  await stopping.page.goto(site, { waitUntil: 'networkidle' });
  await stopping.page.waitForTimeout(800);
  await stopping.page.evaluate(() => document.getElementById('root').replaceChildren());
  await stopping.page.waitForTimeout(200);
  check('an app that empties its root after starting shows the "stopped" note', await stopping.page.locator('#site-stopped').isVisible());
  await stopping.context.close();

  const noScript = await sitePage({ javaScriptEnabled: false });
  await noScript.page.goto(site, { waitUntil: 'load' });
  check('with JavaScript off the page says it needs it', (await noScript.page.locator('body').innerText()).includes('DrawDraw needs JavaScript'));
  await noScript.context.close();

  // connect-src 'self': the site's own api/ and nothing else. Were the policy to let a request
  // through, the route below stops it in the browser; what is read is the policy's own refusal.
  const reach = await sitePage();
  await reach.page.route('https://example.com/**', (route) => route.abort());
  await reach.page.goto(site, { waitUntil: 'networkidle' });
  const reached = await reach.page.evaluate(async () => {
    try {
      await fetch('https://example.com/collect');
      return 'fetched';
    } catch (e) {
      return e.name;
    }
  });
  await reach.page.waitForTimeout(500); // the violation event is reported after the fetch rejects
  // The page enforces the policy twice, as the header and as its <meta>, and each reports.
  const violations = reach.problems.filter((p) => p.startsWith('violation: connect-src blocked https://example.com/collect '));
  const aboutIt = reach.problems.filter((p) => p.includes('https://example.com/collect'));
  check('connect-src lets the page reach no other origin', reached === 'TypeError' && violations.length >= 1, `${reached} ${reach.problems.join(' | ')}`);
  check('and that refusal is the only thing that page reports', aboutIt.length === reach.problems.length, reach.problems.join(' | '));
  await reach.context.close();

  await withApi();
} finally {
  await browser.close();
  await host.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
