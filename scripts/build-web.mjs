#!/usr/bin/env node
// Builds the website: the Expo web export, with the hosting layer in public/ copied in by the
// export, finished for the path it will be served under.
//
//   node scripts/build-web.mjs [--base-url /drawdraw] [--output-dir .web-build] [--host <host>]
//
// --base-url    the path the site is served under: /drawdraw for a GitHub Pages project site,
//               nothing (the default) for a site at the root of its own domain.
// --output-dir  where the site is written (default .web-build): a folder inside the project that
//               is absent, empty or an earlier build, because it is emptied first.
// --host        netlify, cloudflare, apache, nginx or github-pages: keep only the config file
//               that host reads (_headers and _redirects for Netlify and Cloudflare Pages,
//               .htaccess for Apache, none for nginx, whose config is deploy/nginx.conf, or for
//               GitHub Pages, which reads none), so no host serves another's config as a file;
//               for GitHub Pages also write .nojekyll, without which a branch deploy runs Jekyll,
//               which drops every path that starts with _ (the bundle is under _expo/). Without
//               --host all three configs stay, and each host ignores the others'.
//
// `expo export` copies public/ into the site and fills in public/index.html; this then
//  - adds the Content-Security-Policy and referrer <meta> tags to every page, from the policy in
//    public/_headers, so a host that cannot send headers (GitHub Pages) still enforces it. They
//    are added here rather than written into public/index.html because that file is also the
//    dev server's page, whose live reload the policy would block;
//  - points every root-absolute address in the pages, and .htaccess's ErrorDocument lines, at
//    the base path: index.html's own (the stylesheet, the safety net) and 404.html's, which is
//    served at whatever depth the missing address had;
//  - removes metadata.json, which the export writes for EAS Update and no page loads;
//  - and refuses a site in which a page names a file the site does not hold.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** What every built site holds besides the bundle. */
export const SITE_FILES = [
  'index.html',
  '404.html',
  'site.css',
  'guard.js',
  'favicon.ico',
  'robots.txt',
  '.well-known/security.txt',
  '_headers',
  '_redirects',
  '.htaccess',
];

/** The value of `name` in the `/*` rule of a `_headers` file (Netlify, Cloudflare Pages). */
export function headerFor(headersText, name) {
  const block = /^\/\*\n((?:[ \t]+.*\n?)*)/m.exec(headersText);
  if (!block) throw new Error('_headers has no /* rule');
  const line = block[1]
    .split('\n')
    .map((l) => /^[ \t]+([A-Za-z-]+):[ \t]*(.*)$/.exec(l))
    .find((m) => m && m[1].toLowerCase() === name.toLowerCase());
  if (!line) throw new Error(`_headers sets no ${name} for /*`);
  return line[2].trim();
}

/**
 * The policy as a <meta> tag can carry it. A browser ignores frame-ancestors there (and says so
 * in the console), so it is left out: framing is refused by the header alone, on the hosts that
 * can send one.
 */
export function metaPolicy(csp) {
  return csp
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !/^frame-ancestors\b/.test(d))
    .join('; ');
}

/** `html` with the two <meta> tags straight after `<meta charset>`, before anything they govern. */
export function withPolicyMeta(html, { csp, referrer }) {
  const charset = /<meta charset="utf-8"\s*\/?>/i;
  if (!charset.test(html)) throw new Error('a page without <meta charset="utf-8"> to put the policy after');
  if (/http-equiv="Content-Security-Policy"/i.test(html)) throw new Error('the page already carries a policy');
  const tags =
    `<meta http-equiv="Content-Security-Policy" content="${metaPolicy(csp)}" />\n` +
    `    <meta name="referrer" content="${referrer}" />`;
  return html.replace(charset, (m) => `${m}\n    ${tags}`);
}

/** Every root-absolute href and src in `html` moved under `base`, leaving those already there. */
export function underBase(html, base) {
  if (!base) return html;
  return html.replace(/\b(href|src)="\/(?!\/)([^"]*)"/g, (whole, attr, rest) =>
    `/${rest}`.startsWith(`${base}/`) ? whole : `${attr}="${base}/${rest}"`
  );
}

/** The addresses a page names inside the site, as paths relative to the site's root. */
export function pageReferences(html, base) {
  const refs = [];
  for (const m of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
    const url = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || url.startsWith('#')) continue;
    let p = url.split(/[?#]/)[0];
    if (p.startsWith('/')) {
      if (base && !p.startsWith(`${base}/`)) {
        refs.push({ url, outside: true });
        continue;
      }
      p = p.slice(base.length + 1);
    }
    refs.push({ url, path: p === '' ? 'index.html' : p.endsWith('/') ? `${p}index.html` : p });
  }
  return refs;
}

/** The config files each host reads from the published folder. */
export const HOST_CONFIGS = {
  netlify: ['_headers', '_redirects'],
  cloudflare: ['_headers', '_redirects'],
  apache: ['.htaccess'],
  nginx: [],
  'github-pages': [],
};
const CONFIGS = ['_headers', '_redirects', '.htaccess'];

/** Leave in the site at `out` only the config files `host` reads, and what else it needs. */
export function finishForHost(out, host) {
  if (!Object.hasOwn(HOST_CONFIGS, host)) throw new Error(`--host is one of ${Object.keys(HOST_CONFIGS).join(', ')}, not ${host}`);
  for (const file of CONFIGS) {
    if (!HOST_CONFIGS[host].includes(file)) fs.rmSync(path.join(out, file), { force: true });
  }
  if (host === 'github-pages') fs.writeFileSync(path.join(out, '.nojekyll'), '');
}

function parseArgs(argv) {
  const out = { baseUrl: '', outputDir: '.web-build', host: null };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=', 2);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--base-url') out.baseUrl = value.replace(/\/+$/, '');
    else if (flag === '--output-dir') out.outputDir = value;
    else if (flag === '--host') out.host = value;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (out.baseUrl && !/^(\/[A-Za-z0-9._~-]+)+$/.test(out.baseUrl)) {
    throw new Error(`--base-url is a path such as /drawdraw, not ${out.baseUrl}`);
  }
  if (out.host !== null && !Object.hasOwn(HOST_CONFIGS, out.host)) {
    throw new Error(`--host is one of ${Object.keys(HOST_CONFIGS).join(', ')}, not ${out.host}`);
  }
  return out;
}

/**
 * The folder the site is written to, which is emptied first: inside the project, never the
 * project itself, and either absent, empty or an earlier build. `--output-dir .` or
 * `--output-dir src` would otherwise delete the checkout, and the Expo CLI itself writes outside
 * the project when asked to (measured: `--output-dir /tmp/x` exported there).
 */
export function outputFolder(outputDir) {
  const out = path.resolve(ROOT, outputDir);
  const rel = path.relative(ROOT, out);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`--output-dir is a folder inside the project, not ${outputDir}`);
  }
  if (fs.existsSync(out)) {
    const entries = fs.statSync(out).isDirectory() ? fs.readdirSync(out) : null;
    if (!entries || (entries.length > 0 && !entries.includes('_expo'))) {
      throw new Error(`--output-dir ${outputDir} holds something that is not a website build; it is not emptied`);
    }
  }
  return out;
}

export function build({ baseUrl, outputDir, host = null }) {
  const out = outputFolder(outputDir);
  fs.rmSync(out, { recursive: true, force: true });
  const run = spawnSync(
    process.execPath,
    [path.join(ROOT, 'node_modules/expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', out],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, CI: process.env.CI || '1', WEB_BASE_URL: baseUrl } }
  );
  if (run.status !== 0) throw new Error(`expo export failed (${run.status ?? run.signal})`);

  for (const f of SITE_FILES) {
    if (!fs.existsSync(path.join(out, f))) throw new Error(`the export has no ${f}: is public/ complete?`);
  }
  const headers = fs.readFileSync(path.join(out, '_headers'), 'utf8');
  const policy = {
    csp: headerFor(headers, 'Content-Security-Policy'),
    referrer: headerFor(headers, 'Referrer-Policy'),
  };
  const pages = fs.readdirSync(out).filter((f) => f.endsWith('.html'));
  for (const page of pages) {
    const file = path.join(out, page);
    fs.writeFileSync(file, withPolicyMeta(underBase(fs.readFileSync(file, 'utf8'), baseUrl), policy));
  }
  const htaccess = path.join(out, '.htaccess');
  fs.writeFileSync(
    htaccess,
    fs.readFileSync(htaccess, 'utf8').replace(/^(ErrorDocument \d{3} )\/404\.html$/gm, `$1${baseUrl}/404.html`)
  );
  fs.rmSync(path.join(out, 'metadata.json'), { force: true });

  const missing = [];
  for (const page of pages) {
    for (const ref of pageReferences(fs.readFileSync(path.join(out, page), 'utf8'), baseUrl)) {
      if (ref.outside) missing.push(`${page}: ${ref.url} is outside ${baseUrl}/`);
      else if (!fs.existsSync(path.join(out, ref.path))) missing.push(`${page}: ${ref.url}`);
    }
  }
  if (missing.length) throw new Error(`pages name files the site does not hold:\n  ${missing.join('\n  ')}`);
  if (host) finishForHost(out, host);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const out = build(parseArgs(process.argv.slice(2)));
    console.log(`\nWebsite built in ${path.relative(ROOT, out) || '.'}`);
  } catch (err) {
    console.error(`build-web: ${err.message}`);
    process.exit(1);
  }
}
