// @ts-check
// The website's API as this app deploys it: server/catalogue.js through the kit, by both ways in
// (functions/api/[[path]].js on Cloudflare Pages, server/start.mjs on a host of its own), with a
// fake Google and a fake Stripe handed to the kit through its `fetch` (server/fakes.mjs).
// `node --test server/api.test.mjs`, run by `npm test` beside the kit's own self-test.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import catalogue from './catalogue.js';
import { createFakes, envFor, PRO_PRICE, signedDelivery } from './fakes.mjs';
import { priceVariable, validateCatalogue } from './kit/app.js';
import { pagesHandler } from './kit/cloudflare.js';
import { start } from './start.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (/** @type {string} */ file) => fs.readFileSync(path.join(root, file), 'utf8');

/** What every test here must never do: reach the network. The fakes are injected instead. */
const realFetch = globalThis.fetch;
/** @type {string[]} */
const escaped = [];
before(() => {
  globalThis.fetch = async (input) => {
    escaped.push(String(input));
    throw new Error(`a test reached for the network: ${String(input)}`);
  };
});
after(() => {
  globalThis.fetch = realFetch;
  assert.deepEqual(escaped, []);
});

describe('the catalogue', () => {
  it('sells DrawDraw Pro once, as the app lists it, and nothing else', () => {
    const checked = validateCatalogue(catalogue);
    assert.equal(checked.app, 'drawdraw');
    assert.deepEqual(
      checked.products.map((p) => [p.id, p.mode, p.grants]),
      [['pro', 'payment', 'pro']],
    );
    assert.equal(priceVariable('pro'), 'STRIPE_PRICE_PRO');
    // The web build asks for that product and reads that entitlement (src/lib/account.ts)...
    const model = read('src/lib/account.ts');
    assert.match(model, /^export const PRO_PRODUCT = 'pro';$/m);
    assert.match(model, /^export const PRO_ENTITLEMENT = 'pro';$/m);
    // ...and it is the product the app's own listing describes (src/lib/purchases.ts), sold once.
    const listing = read('src/lib/purchases.ts');
    const product = checked.products[0];
    assert.ok(product);
    assert.ok(listing.includes(`title: '${product.name}'`), product.name);
    assert.ok(listing.includes(`blurb: '${product.description}'`), product.description);
    assert.match(listing, /kind: 'one-time'/);
  });

  it('is what the API is built from, and the fakes are not', () => {
    for (const file of ['server/start.mjs', 'server/catalogue.js', 'functions/api/[[path]].js']) {
      for (const line of read(file).match(/^import .*$/gm) ?? []) assert.doesNotMatch(line, /fakes|test/, `${file} imports nothing of the tests`);
    }
  });
});

describe('Cloudflare Pages: functions/api/[[path]].js', () => {
  it("is the kit's three-line entry with this app's catalogue", () => {
    const entry = 'functions/api/[[path]].js';
    assert.equal(
      read(entry),
      [
        "import { pagesHandler } from '../../server/kit/cloudflare.js';",
        "import catalogue from '../../server/catalogue.js';",
        'export const onRequest = pagesHandler(catalogue);',
        '',
      ].join('\n'),
    );
    for (const target of ['../../server/kit/cloudflare.js', '../../server/catalogue.js']) {
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(entry), target)), target);
    }
  });

  /** A Workers KV namespace in memory, as much of one as the kit uses. */
  const kv = () => {
    /** @type {Map<string, string>} */
    const data = new Map();
    return {
      data,
      get: async (/** @type {string} */ key) => (data.has(key) ? JSON.parse(data.get(key) ?? 'null') : null),
      put: async (/** @type {string} */ key, /** @type {string} */ value) => void data.set(key, value),
      delete: async (/** @type {string} */ key) => void data.delete(key),
    };
  };
  const onRequest = pagesHandler(catalogue);
  const call = (/** @type {string} */ url, /** @type {Record<string, unknown>} */ env) => onRequest({ request: new Request(url), env });

  it('reports nothing on, and answers nothing else, with no variables set', async () => {
    const env = { KIT_STORE: kv() };
    const config = await call('https://drawdraw.example/api/config', env);
    assert.equal(config.status, 200);
    assert.deepEqual(await config.json(), { auth: { google: false }, shop: { products: [] } });
    assert.equal(config.headers.get('cache-control'), 'public, max-age=60');
    for (const route of ['me', 'auth/google/start', 'checkout', 'webhooks/stripe', 'nothing']) {
      assert.equal((await call(`https://drawdraw.example/api/${route}`, env)).status, 404, route);
    }
  });

  it('starts a sign-in towards Google once sign-in is configured, without a call of its own', async () => {
    const store = kv();
    const { STRIPE_SECRET_KEY: _key, STRIPE_WEBHOOK_SECRET: _hook, STRIPE_PRICE_PRO: _price, ...signIn } = envFor('https://drawdraw.example/');
    const env = { ...signIn, KIT_STORE: store };
    assert.deepEqual(await (await call('https://drawdraw.example/api/config', env)).json(), { auth: { google: true }, shop: { products: [] } });
    const started = await call('https://drawdraw.example/api/auth/google/start?return=%2F', env);
    assert.equal(started.status, 302);
    const google = new URL(started.headers.get('location') ?? '');
    assert.equal(`${google.origin}${google.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(google.searchParams.get('redirect_uri'), 'https://drawdraw.example/api/auth/google/callback');
    assert.match(started.headers.get('set-cookie') ?? '', /^__Host-drawdraw-oauth=[^;]+; .*HttpOnly/);
    assert.deepEqual(escaped, []);
  });
});

describe('a host of its own: server/start.mjs through the Node adapter', () => {
  // The public address is the proxy's (deploy/nginx.conf), not the loopback port the API
  // listens on: the kit takes every absolute URL from APP_URL, and the CSRF gate the origin.
  const APP_URL = 'https://drawdraw.example/';
  const ORIGIN = 'https://drawdraw.example';
  /** @type {Awaited<ReturnType<typeof createFakes>>} */
  let fakes;
  /** @type {Awaited<ReturnType<typeof start>>} */
  let api;
  /** @type {string} */
  let dataDir;
  /** @type {string[]} */
  const logs = [];

  before(async () => {
    fakes = await createFakes();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drawdraw-api-'));
    api = await start({ env: envFor(APP_URL), dataDir, port: 0, fetch: fakes.fetch, log: (level, message) => logs.push(`${level}: ${message}`) });
  });
  after(async () => {
    await api?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  /** A browser's cookie jar, sending what the proxy would pass on. */
  const browser = () => {
    /** @type {Map<string, string>} */
    const jar = new Map();
    /**
     * @param {string} method
     * @param {string} target a path, or an address on APP_URL's origin
     * @param {{ json?: unknown }} [options]
     */
    const send = async (method, target, options = {}) => {
      const url = new URL(target, APP_URL);
      const headers = new Headers();
      if (jar.size) headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
      if (method !== 'GET') headers.set('origin', ORIGIN);
      if (options.json !== undefined) headers.set('content-type', 'application/json');
      const response = await realFetch(new URL(`${url.pathname}${url.search}`, api.url), {
        method,
        headers,
        body: options.json === undefined ? undefined : JSON.stringify(options.json),
        redirect: 'manual',
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair = ''] = cookie.split(';');
        const name = pair.slice(0, pair.indexOf('='));
        if (/;\s*Max-Age=0(?:;|$)/i.test(cookie)) jar.delete(name);
        else jar.set(name, pair.slice(pair.indexOf('=') + 1));
      }
      return response;
    };
    const signIn = async (person = { sub: '1001', email: 'ada@example.com' }) => {
      const started = await send('GET', 'api/auth/google/start?return=%2F');
      assert.equal(started.status, 302);
      const back = fakes.consent(started.headers.get('location') ?? '', person);
      const landed = await send('GET', back.href);
      assert.equal(landed.status, 302);
      assert.equal(landed.headers.get('location'), `${ORIGIN}/`);
    };
    const me = async () => /** @type {{ user: { email?: string } | null, entitlements: string[] }} */ (await (await send('GET', 'api/me')).json());
    return { jar, send, signIn, me };
  };

  it('lists Pro with its price from Stripe', async () => {
    const response = await browser().send('GET', 'api/config');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      auth: { google: true },
      shop: {
        products: [{ id: 'pro', name: 'DrawDraw Pro', description: catalogue.products[0]?.description, mode: 'payment', price: PRO_PRICE }],
      },
    });
    assert.equal(api.features.signIn, true);
    assert.equal(api.features.shop, true);
  });

  it('signs in, sells Pro, grants it on the signed webhook alone, signs out and deletes the account', async () => {
    const visitor = browser();
    assert.deepEqual(await visitor.me(), { user: null, entitlements: [] });
    await visitor.signIn();
    assert.deepEqual(await visitor.me(), { user: { email: 'ada@example.com' }, entitlements: [] });

    const checkout = await visitor.send('POST', 'api/checkout', { json: { product: 'pro' } });
    assert.equal(checkout.status, 200);
    const { url } = /** @type {{ url: string }} */ (await checkout.json());
    assert.match(url, /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_drawdraw\d+$/);
    const asked = fakes.sessions.get(new URL(url).pathname.split('/').pop() ?? '');
    assert.ok(asked);
    assert.equal(asked.get('mode'), 'payment');
    assert.equal(asked.get('line_items[0][price]'), 'price_drawdrawProFake');
    assert.equal(asked.get('metadata[app]'), 'drawdraw');
    assert.equal(asked.get('metadata[product]'), 'pro');
    assert.equal(asked.get('metadata[user]'), 'google:1001');
    assert.equal(asked.get('success_url'), `${APP_URL}?purchase=success`);
    assert.equal(asked.get('cancel_url'), `${APP_URL}?purchase=cancelled`);

    // Coming back from Checkout grants nothing: only Stripe's signed word does.
    assert.deepEqual((await visitor.me()).entitlements, []);
    const forged = signedDelivery(fakes.paid(url), { secret: 'whsec_notTheEndpointsSecret000' });
    const refused = await realFetch(new URL('api/webhooks/stripe', api.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': forged.signature },
      body: forged.body,
    });
    assert.equal(refused.status, 400);
    assert.deepEqual((await visitor.me()).entitlements, []);
    const delivery = signedDelivery(fakes.paid(url));
    const hook = await realFetch(new URL('api/webhooks/stripe', api.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': delivery.signature },
      body: delivery.body,
    });
    assert.equal(hook.status, 200);
    assert.deepEqual(await visitor.me(), { user: { email: 'ada@example.com' }, entitlements: ['pro'] });
    assert.equal((await visitor.send('POST', 'api/checkout', { json: { product: 'pro' } })).status, 409);

    assert.equal((await visitor.send('POST', 'api/auth/logout')).status, 204);
    assert.deepEqual(await visitor.me(), { user: null, entitlements: [] });
    await visitor.signIn();
    assert.deepEqual((await visitor.me()).entitlements, ['pro']);
    assert.equal((await visitor.send('DELETE', 'api/me')).status, 204);
    assert.deepEqual(await visitor.me(), { user: null, entitlements: [] });
    await visitor.signIn();
    assert.deepEqual(await visitor.me(), { user: { email: 'ada@example.com' }, entitlements: [] });

    assert.deepEqual(fakes.unexpected, []);
    assert.deepEqual(logs, []);
    // The file store holds the records, one file per key named by its hash.
    assert.ok(fs.readdirSync(dataDir).every((name) => /^[0-9a-f]{64}\.json$/.test(name)));
  });

  it('refuses a write from another origin, and one without an Origin', async () => {
    const visitor = browser();
    await visitor.signIn({ sub: '2002', email: 'grace@example.com' });
    const cookie = [...visitor.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    for (const origin of ['https://evil.example', null]) {
      const response = await realFetch(new URL('api/checkout', api.url), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        body: JSON.stringify({ product: 'pro' }),
      });
      assert.equal(response.status, 403, String(origin));
    }
  });
});

describe('server/start.mjs run as a program', () => {
  const script = path.join(here, 'start.mjs');
  /**
   * The environment a service manager would start it with: none of the developer's.
   * @param {Record<string, string>} extra
   * @returns {NodeJS.ProcessEnv}
   */
  const bare = (extra) => ({ PATH: process.env.PATH ?? '', NODE_ENV: 'production', ...extra });

  it('refuses to start without a data directory', () => {
    const run = spawnSync(process.execPath, [script], { env: bare({}), encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /set KIT_DATA_DIR/);
  });

  it('listens on loopback, with everything off when nothing is configured', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drawdraw-start-'));
    const child = spawn(process.execPath, [script], { env: bare({ KIT_DATA_DIR: dir, KIT_PORT: '0' }), stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const line = await new Promise((resolve, reject) => {
        let out = '';
        child.stdout.on('data', (chunk) => {
          out += String(chunk);
          if (out.includes('\n')) resolve(out.trim());
        });
        child.on('exit', (code) => reject(new Error(`exited ${code}`)));
      });
      const match = /^drawdraw api listening on (http:\/\/127\.0\.0\.1:\d+\/) \(sign-in off, shop off\)$/.exec(String(line));
      assert.ok(match, String(line));
      const config = await realFetch(new URL('api/config', match[1]));
      assert.deepEqual(await config.json(), { auth: { google: false }, shop: { products: [] } });
      assert.equal((await realFetch(new URL('api/me', match[1]))).status, 404);
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
