/**
 * A static host for the built website, the way Netlify or Cloudflare Pages
 * serves the folder: under a base path, with the response headers exactly as
 * the site's own `_headers` writes them, its `_redirects` 404 rules, the
 * site's `404.html` for anything missing, and neither config file served.
 *
 * Every request outside the base path is answered 404 and recorded, so a
 * page that reaches for anything but its own site is caught.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** `_headers` as [{ pattern, headers: [[name, value]] }], in file order. */
export function parseHeaders(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: [] });
      continue;
    }
    const m = /^\s+([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
    if (!m || rules.length === 0) throw new Error(`_headers: cannot read ${JSON.stringify(line)}`);
    rules[rules.length - 1].headers.push([m[1], m[2].trim()]);
  }
  return rules;
}

/** Whether a `_headers` path pattern (exact, or ending in a `*` splat) matches `path`. */
export function matches(pattern, path) {
  return pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern;
}

/**
 * The headers `_headers` gives `path`. A name set by two rules that both
 * match would be joined with a comma by the host, which is never what the
 * file means, so it is an error here.
 */
export function headersFor(rules, path) {
  const out = {};
  for (const rule of rules.filter((r) => matches(r.pattern, path))) {
    for (const [name, value] of rule.headers) {
      const key = name.toLowerCase();
      if (Object.hasOwn(out, key)) throw new Error(`_headers sets ${name} twice for ${path}`);
      out[key] = value;
    }
  }
  return out;
}

/** `_redirects`' 404 rules, as a Set of site paths. */
export function refusedPaths(text) {
  const refused = new Set();
  for (const line of text.split('\n')) {
    const [from, , status] = line.trim().split(/\s+/);
    if (from && !from.startsWith('#') && /^404!?$/.test(status ?? '')) refused.add(from);
  }
  return refused;
}

/** The site path (`/x`) a request names under `base`, or null when it is outside it or malformed. */
function sitePath(url, base) {
  let path;
  try {
    path = decodeURIComponent(new URL(url, 'http://host').pathname);
  } catch {
    return null;
  }
  if (path !== base && !path.startsWith(`${base}/`)) return null;
  return path.slice(base.length) || '/';
}

export async function startHost({ dir, base }) {
  const root = resolve(dir);
  const rules = parseHeaders(readFileSync(join(root, '_headers'), 'utf8'));
  const refused = refusedPaths(readFileSync(join(root, '_redirects'), 'utf8'));
  const outside = [];
  const served = [];

  const fileFor = (path) => {
    if (path === '/_headers' || path === '/_redirects' || refused.has(path)) return null;
    const file = resolve(root, '.' + normalize(path.endsWith('/') ? `${path}index.html` : path));
    const inside = file.startsWith(root + sep);
    return inside && existsSync(file) && statSync(file).isFile() ? file : null;
  };

  const server = createServer((req, res) => {
    const path = sitePath(req.url, base);
    if (path === null) {
      outside.push(req.url);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('outside the site');
      return;
    }
    if (path === '/' && req.url.split('?')[0] === base) {
      // A host redirects the folder to its slash form, so relative addresses resolve inside it.
      res.writeHead(301, { Location: `${base}/` });
      res.end();
      return;
    }
    let headers;
    try {
      headers = headersFor(rules, path);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(err.message);
      return;
    }
    const file = fileFor(path);
    const status = file ? 200 : 404;
    const body = file ?? join(root, '404.html');
    served.push({ path, status });
    res.writeHead(status, { 'Content-Type': TYPES[extname(body)] ?? 'application/octet-stream', ...headers });
    createReadStream(body).pipe(res);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    site: `${origin}${base}/`,
    port: server.address().port,
    rules,
    outside,
    served,
    close: () => new Promise((done) => server.close(done)),
  };
}
