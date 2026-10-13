/**
 * The website on real servers: deploy/nginx.conf loaded into the nginx installed here, and the
 * built site's .htaccess read by the Apache installed here, each serving the folder
 * scripts/build-web.mjs wrote, with repository files planted in it as if a checkout had been
 * copied over it. __tests__/website.test.ts reads both files and holds them equal to
 * public/_headers; only a server shows what a file makes it do. A header can be written right and
 * still not be sent: Apache's `env=HTTPS` sent no HSTS behind a proxy that ends TLS, an add_header
 * in an nginx location drops every header the server sets, and nginx 1.24 refused the whole file
 * over `http2 on;` (1.25.1 and later only). The site's API (server/start.mjs) runs beside them, with
 * nothing configured: nginx's `location ^~ /api/` and the ProxyPass README.md gives Apache must
 * hand it api/, and it must answer with its own headers, not the site's.
 *
 * Needs nginx, Apache as Debian and Ubuntu lay it out (/usr/sbin/apache2, its modules in
 * /usr/lib/apache2/modules) and openssl, which GitHub's ubuntu-24.04 runner has, at the versions
 * Ubuntu 24.04 ships (nginx 1.24.0, Apache 2.4.58). Where one is missing this says so and passes,
 * unless CI is set: skipped there, it would read as passed.
 *
 *   npm run test:e2e        builds the site, drives it in Chromium (e2e/smoke.mjs), then runs this
 *   node e2e/hosts.mjs      runs this against the .web-build/ already there
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { headersFor, parseHeaders } from './host.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(root, process.env.WEB_BUILD_DIR || '.web-build');
const BASE = process.env.WEB_BASE_URL || '/drawdraw';
const MODULES = '/usr/lib/apache2/modules';
const NOT_FOUND = 'That page isn’t here';
const CONFIGS = ['_headers', '_redirects', '.htaccess', '_routes.json'];
/** The headers server/kit sends on every answer of its own (server/kit/http.js). */
const API_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

const which = (name, fallback) => {
  const found = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  return found || (existsSync(fallback) ? fallback : null);
};
const NGINX = which('nginx', '/usr/sbin/nginx');
const APACHE = existsSync(join(MODULES, 'mod_rewrite.so')) ? which('apache2', '/usr/sbin/apache2') : null;
const OPENSSL = which('openssl', '/usr/bin/openssl');
const missing = [
  ...(NGINX ? [] : ['nginx']),
  ...(APACHE ? [] : [`Apache (apache2 and ${MODULES})`]),
  ...(OPENSSL ? [] : ['openssl']),
  ...(existsSync('/etc/mime.types') && existsSync('/etc/nginx/mime.types') ? [] : ['/etc/mime.types and /etc/nginx/mime.types']),
];
if (missing.length) {
  const note = `hosts: not installed here: ${missing.join(', ')}`;
  if (process.env.CI) {
    console.error(`${note}. CI runs this on a runner that has them, so this is a failure.`);
    process.exit(1);
  }
  console.log(`${note}. SKIPPED: the real nginx and Apache were not run; CI runs them.`);
  process.exit(0);
}
if (!existsSync(join(BUILD, 'index.html')) || !existsSync(join(BUILD, '.htaccess'))) {
  console.error(`No web build with its .htaccess at ${BUILD}. Run: node scripts/build-web.mjs --base-url ${BASE}`);
  process.exit(1);
}

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const rules = parseHeaders(readFileSync(join(BUILD, '_headers'), 'utf8'));
/** What `_headers` gives a site path (no query): every host must send the same. */
const want = (sitePath) => headersFor(rules, sitePath);
/** The names of `want(path)` the response does not carry, or carries with another value. */
const differences = (response, sitePath) =>
  Object.entries(want(sitePath))
    .filter(([name, value]) => response.headers[name] !== value)
    .map(([name, value]) => `${name}: ${JSON.stringify(response.headers[name])}, not ${JSON.stringify(value)}`);

/** A free port on loopback, as the system hands one out. */
const freePort = () =>
  new Promise((done, fail) => {
    const server = net.createServer().once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

/** One request, answered: status, headers and body. The test's own certificate is accepted. */
const get = (url, headers = {}) =>
  new Promise((done, fail) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, { headers, rejectUnauthorized: false, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body }));
    });
    request.on('error', fail);
    request.setTimeout(10000, () => request.destroy(new Error(`${url}: no answer in 10 s`)));
  });

async function waitFor(url, log) {
  for (let i = 0; i < 100; i += 1) {
    try {
      return await get(url);
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  throw new Error(`${url} never answered:\n${log()}`);
}

// The site as it would be copied to a server, with what a checkout copied over it would add: none
// of these may be served. Under the system's temporary folder and readable by everyone, because a
// server started as root reads it as an unprivileged user.
const work = mkdtempSync(join(tmpdir(), 'drawdraw-hosts-'));
chmodSync(work, 0o755);
const site = join(work, 'site');
cpSync(BUILD, site, { recursive: true });
const PLANTED = {
  'README.md': '# the README\n',
  '.git/config': '[core]\n',
  '.git/HEAD': 'ref: refs/heads/main\n',
  '.env': 'SECRET=1\n',
  'deploy/nginx.conf': 'server {}\n',
  'package.json': '{}\n',
  'metadata.json': '{}\n',
  'src/screens/HomeScreen.tsx': 'export {};\n',
};
for (const [file, text] of Object.entries(PLANTED)) {
  mkdirSync(dirname(join(site, file)), { recursive: true });
  writeFileSync(join(site, file), text);
}
spawnSync('chmod', ['-R', 'a+rX', work]);
const asRoot = process.getuid?.() === 0;

/** Every file the build wrote, as a site path, but the host configs. */
const BUILT = (() => {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else out.push(`/${relative(BUILD, file).split(sep).join('/')}`);
    }
  };
  walk(BUILD);
  return out.filter((p) => !CONFIGS.includes(p.slice(1))).sort();
})();
const bundle = BUILT.find((p) => p.startsWith('/_expo/static/') && p.endsWith('.js'));
/** The paths of the site, each a 200 with exactly the headers `_headers` gives it. */
const SERVED = ['/', '/index.html?utm_source=x', ...BUILT];
/** The repository's files, the hosts' configs, folders that would list and missing names: the 404 page. */
const REFUSED = [
  ...Object.keys(PLANTED).map((f) => `/${f}`),
  '/_headers',
  '/_redirects',
  '/_routes.json',
  '//_headers',
  '/_expo/',
  '/_expo/static/',
  '/_expo/static/js/web/',
  '/.well-known/',
  '/index.html/',
  '/INDEX.HTML',
  '/no/such/page',
  '/_expo/static/js/web/index-ffffffffffffffffffffffffffffffff.js',
];
const sitePathOf = (p) => p.split('?')[0];
/** The headers every response carries, the 404 page's included. */
const SECURITY = Object.keys(want('/')).filter((name) => name !== 'cache-control');

/** Run every check of the site's paths against one server, `origin` being the site's root there. */
async function sameSite(label, origin, requestHeaders = {}) {
  const wrong = [];
  for (const p of SERVED) {
    const response = await get(`${origin}${p}`, requestHeaders);
    if (response.status !== 200) wrong.push(`${p} answered ${response.status}`);
    for (const d of differences(response, sitePathOf(p))) wrong.push(`${p} ${d}`);
  }
  check(`${label}: every file of the site answers 200, with every header _headers gives it`, wrong.length === 0, wrong.slice(0, 4).join(' | '));
  const script = await get(`${origin}${bundle}`, requestHeaders);
  check(`${label}: the bundle is served as JavaScript`, /javascript/.test(script.headers['content-type'] ?? ''), script.headers['content-type']);

  const refused = [];
  for (const p of [...REFUSED, '/.htaccess']) {
    const response = await get(`${origin}${p}`, requestHeaders);
    // A stock Apache refuses .ht* itself, with a 403 before .htaccess is read; ErrorDocument 403
    // answers it with the same page.
    const status = p === '/.htaccess' && label.startsWith('Apache') ? 403 : 404;
    if (response.status !== status) refused.push(`${p} answered ${response.status}`);
    if (!response.body.includes(NOT_FOUND)) refused.push(`${p} is not the site's 404 page`);
    for (const name of SECURITY) {
      if (response.headers[name] !== want('/')[name]) refused.push(`${p} ${name}: ${JSON.stringify(response.headers[name])}`);
    }
    // A missing hashed name is revalidated, never kept for a year.
    if (response.headers['cache-control'] !== 'no-cache') refused.push(`${p} cache-control: ${response.headers['cache-control']}`);
  }
  check(`${label}: the repository's files, the configs, folders and missing names answer the site's 404 page, with every header`, refused.length === 0, refused.slice(0, 4).join(' | '));
}

const children = [];
function start(command, args, log) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  children.push(child);
  return () => output + log();
}
const readLog = (file) => () => (existsSync(file) ? readFileSync(file, 'utf8') : '');

/**
 * The site's API as a host of its own runs it: server/start.mjs, with a data directory and a
 * port and none of the kit's variables, so `api/config` says nothing is on and every other route
 * is the kit's JSON 404.
 */
async function startApi() {
  const port = await freePort();
  const data = join(work, 'api-data');
  const child = spawn(process.execPath, [join(root, 'server/start.mjs')], {
    env: { PATH: process.env.PATH ?? '', KIT_DATA_DIR: data, KIT_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  children.push(child);
  await waitFor(`http://127.0.0.1:${port}/api/config`, () => output);
  return port;
}

/**
 * What a server answers under api/ when it hands the path to the API: the API's own JSON and
 * headers, none of the site's (a host that added the site's beside them would send two policies),
 * and `extra`, the headers the host itself adds there.
 */
async function apiChecks(label, origin, requestHeaders = {}, extra = {}) {
  const wrong = [];
  const config = await get(`${origin}/api/config`, requestHeaders);
  if (config.status !== 200) wrong.push(`api/config answered ${config.status}`);
  if (config.body !== JSON.stringify({ auth: { google: false }, shop: { products: [] } })) wrong.push(`api/config said ${config.body.slice(0, 80)}`);
  if (config.headers['cache-control'] !== 'public, max-age=60') wrong.push(`api/config cache-control: ${config.headers['cache-control']}`);
  const missing = await get(`${origin}/api/me`, requestHeaders);
  if (missing.status !== 404 || missing.body.includes(NOT_FOUND)) wrong.push(`api/me answered ${missing.status}, ${missing.body.slice(0, 40)}`);
  if (missing.headers['cache-control'] !== 'no-store') wrong.push(`api/me cache-control: ${missing.headers['cache-control']}`);
  for (const response of [config, missing]) {
    for (const [name, value] of Object.entries({ ...API_HEADERS, ...extra })) {
      if (response.headers[name] !== value) wrong.push(`${name}: ${JSON.stringify(response.headers[name])}`);
    }
    for (const name of SECURITY.filter((n) => !Object.hasOwn(API_HEADERS, n) && !Object.hasOwn(extra, n))) {
      if (response.headers[name] !== undefined) wrong.push(`the site's ${name} sent beside the API's`);
    }
  }
  check(`${label}: api/ is the site's API, with its own headers and none of the site's`, wrong.length === 0, wrong.slice(0, 4).join(' | '));
}

async function nginx(apiPort) {
  const dir = join(work, 'nginx');
  mkdirSync(join(dir, 'logs'), { recursive: true });
  spawnSync(OPENSSL, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-days', '1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  const [plain, tls] = [await freePort(), await freePort()];
  // deploy/nginx.conf as its header says to install it: server_name, root and the certificate
  // paths set, and here the ports. Each edit has to find its line exactly once, so a file that has
  // moved on fails here rather than being tested as something it no longer is.
  let conf = readFileSync(join(root, 'deploy/nginx.conf'), 'utf8');
  const edits = [];
  const edit = (from, to) => {
    const found = typeof from === 'string' ? conf.split(from).length - 1 : [...conf.matchAll(new RegExp(from.source, 'gm'))].length;
    if (found !== 1) edits.push(`${from} is there ${found} times`);
    conf = conf.replace(from, to);
  };
  // The address alone: whatever else the listen lines ask for is loaded as written.
  edit('  listen 80;\n', `  listen 127.0.0.1:${plain};\n`);
  edit('  listen [::]:80;\n', '');
  edit(/^ {2}listen 443 ([^;\n]*);$/m, `  listen 127.0.0.1:${tls} $1;`);
  edit(/^ {2}listen \[::\]:443 [^;\n]*;\n/m, '');
  edit('  root /var/www/drawdraw;\n', `  root ${site};\n`);
  edit('/etc/letsencrypt/live/example.com/fullchain.pem', join(dir, 'cert.pem'));
  edit('/etc/letsencrypt/live/example.com/privkey.pem', join(dir, 'key.pem'));
  edit('    proxy_pass http://127.0.0.1:8788;\n', `    proxy_pass http://127.0.0.1:${apiPort};\n`);
  check('deploy/nginx.conf has the lines its header says to change, once each', edits.length === 0, edits.join(' | '));
  writeFileSync(join(dir, 'site.conf'), conf);
  // The http {} block a stock Debian or Ubuntu nginx.conf includes it from, less the logging.
  const temp = ['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map((t) => `  ${t}_temp_path ${join(dir, `${t}_temp`)};`);
  writeFileSync(
    join(dir, 'nginx.conf'),
    [
      ...(asRoot ? ['user www-data;'] : []),
      'worker_processes 1;',
      `pid ${join(dir, 'nginx.pid')};`,
      'events {}',
      'http {',
      '  include /etc/nginx/mime.types;',
      '  default_type application/octet-stream;',
      '  access_log off;',
      ...temp,
      `  include ${join(dir, 'site.conf')};`,
      '}',
      '',
    ].join('\n')
  );
  const args = ['-p', dir, '-e', join(dir, 'logs/error.log'), '-c', join(dir, 'nginx.conf')];
  const version = spawnSync(NGINX, ['-v'], { encoding: 'utf8' }).stderr.trim().replace(/^nginx version: /, '');

  const test = spawnSync(NGINX, ['-t', ...args], { encoding: 'utf8' });
  check(`${version} loads deploy/nginx.conf (nginx -t)`, test.status === 0 && !/\[emerg\]/.test(test.stderr), test.stderr.split('\n').find((l) => /emerg/.test(l)) ?? '');
  if (test.status !== 0) return;

  const log = start(NGINX, [...args, '-g', 'daemon off;'], readLog(join(dir, 'logs/error.log')));
  const origin = `https://127.0.0.1:${tls}`;
  await waitFor(`${origin}/`, log);

  // nginx.conf is written for a site at the root of its domain, so the site is there.
  await sameSite('nginx', origin);
  // The one header nginx adds to the API's answers is its Strict-Transport-Security line.
  await apiChecks('nginx', origin, {}, { 'strict-transport-security': want('/')['strict-transport-security'] });

  const redirect = await get(`http://127.0.0.1:${plain}/a/b?x=1`);
  check('nginx: plain HTTP is redirected to https, and names no version', redirect.status === 301 && redirect.headers.location === 'https://127.0.0.1/a/b?x=1' && redirect.headers.server === 'nginx', `${redirect.status} ${redirect.headers.location} ${redirect.headers.server}`);
  const page = await get(`${origin}/`);
  check('nginx: the site names no version', page.headers.server === 'nginx', page.headers.server);
}

/**
 * Apache as a stock Debian or Ubuntu install has it (its default modules, its <FilesMatch "^\.ht">
 * denial, `Options Indexes FollowSymLinks` on the folder), with what the README asks for on top:
 * `modules`, `AllowOverride FileInfo Options` and `ServerTokens Prod`. The site is under BASE, as
 * it was built, through an Alias.
 */
async function apache(label, modules, extra = []) {
  const dir = join(work, label);
  mkdirSync(dir, { recursive: true });
  const port = await freePort();
  const stock = ['mpm_event', 'authz_core', 'authz_host', 'mime', 'dir', 'alias', 'autoindex', 'negotiation', 'env', 'setenvif', 'filter', 'deflate'];
  writeFileSync(
    join(dir, 'httpd.conf'),
    [
      `ServerRoot ${dir}`,
      `DefaultRuntimeDir ${dir}`,
      `PidFile ${join(dir, 'httpd.pid')}`,
      `ErrorLog ${join(dir, 'error.log')}`,
      'LogLevel warn',
      `Listen 127.0.0.1:${port}`,
      'ServerName localhost',
      'ServerTokens Prod',
      ...(asRoot ? ['User www-data', 'Group www-data'] : []),
      ...[...stock, ...modules].map((m) => `LoadModule ${m}_module ${join(MODULES, `mod_${m}.so`)}`),
      'TypesConfig /etc/mime.types',
      'DirectoryIndex index.html',
      '<Directory />',
      '  AllowOverride None',
      '  Require all denied',
      '</Directory>',
      '<FilesMatch "^\\.ht">',
      '  Require all denied',
      '</FilesMatch>',
      ...extra,
      `Alias ${BASE} ${site}`,
      `<Directory ${site}>`,
      '  Options Indexes FollowSymLinks',
      '  AllowOverride FileInfo Options',
      '  Require all granted',
      '</Directory>',
      '',
    ].join('\n')
  );
  const log = start(APACHE, ['-f', join(dir, 'httpd.conf'), '-DFOREGROUND'], readLog(join(dir, 'error.log')));
  const origin = `http://127.0.0.1:${port}${BASE}`;
  await waitFor(`${origin}/`, log);
  const version = spawnSync(APACHE, ['-v'], { encoding: 'utf8' }).stdout.split('\n')[0].replace(/^Server version: /, '');
  return { origin, log, version };
}

async function apacheChecks(apiPort) {
  const { origin, version } = await apache('apache', ['rewrite', 'headers']);
  // Behind a proxy that ends TLS, which is what the redirect's X-Forwarded-Proto is for: this
  // Apache speaks plain HTTP, and the proxy says the visitor used https.
  await sameSite(`Apache (${version}, behind a proxy that ends TLS)`, origin, { 'X-Forwarded-Proto': 'https' });

  const redirect = await get(`${origin}/a?x=1`);
  check('Apache: plain HTTP is redirected to https', redirect.status === 301 && redirect.headers.location === `https://127.0.0.1:${new URL(origin).port}${BASE}/a?x=1`, `${redirect.status} ${redirect.headers.location}`);
  check('Apache under the README\'s `ServerTokens Prod` names no version', redirect.headers.server === 'Apache', redirect.headers.server);

  // .htaccess cannot proxy: the README's ProxyPass goes in the server's own configuration, and
  // answers api/ before the folder (and so its .htaccess and allow-list) is reached.
  const proxied = await apache('apache-api', ['rewrite', 'headers', 'proxy', 'proxy_http'], [
    `ProxyPass "${BASE}/api/" "http://127.0.0.1:${apiPort}${BASE}/api/"`,
  ]);
  await apiChecks(`Apache (${version}) with the README's ProxyPass`, proxied.origin, { 'X-Forwarded-Proto': 'https' });
  const page = await get(`${proxied.origin}/`, { 'X-Forwarded-Proto': 'https' });
  check('Apache with the ProxyPass still serves the site through its .htaccess', page.status === 200 && differences(page, '/').length === 0, differences(page, '/').join(' | '));

  const bare = await apache('apache-bare', []);
  // Debian and Ubuntu ship with both off. A site served without them would hand out every file
  // in the folder with none of the headers: refusing everything, and saying why in the log, is
  // the way for it to fail.
  const served = [];
  for (const p of ['/', '/index.html', '/README.md', '/.git/config']) {
    const response = await get(`${bare.origin}${p}`, { 'X-Forwarded-Proto': 'https' });
    if (response.status !== 500 || /\[core\]|the README|<div id="root">/.test(response.body)) served.push(`${p} answered ${response.status}`);
  }
  const said = /Invalid command '(RewriteEngine|Header)'/.test(bare.log());
  check('Apache without mod_rewrite and mod_headers serves nothing, and its log says why', served.length === 0 && said, [...served, ...(said ? [] : ['the log names no directive'])].join(' | '));
}

try {
  const apiPort = await startApi();
  await nginx(apiPort);
  await apacheChecks(apiPort);
} catch (err) {
  check('the servers ran to the end', false, err.message.split('\n').slice(0, 6).join(' | '));
} finally {
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(children.map((child) => (child.exitCode === null && child.signalCode === null ? new Promise((done) => child.once('exit', done)) : null)));
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nhosts: all checks passed, nginx and Apache');
