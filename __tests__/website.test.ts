/**
 * The website's hosting layer, read out of every file it is written in.
 *
 * One policy, written four times: `public/_headers` (Netlify, Cloudflare
 * Pages), `public/.htaccess` (Apache), `deploy/nginx.conf` (nginx), and the
 * <meta> tags scripts/build-web.mjs adds to every page for a host that sends
 * no headers (GitHub Pages). A header changed in one and not the others is a
 * site that is safe on one host and not on the next, so they are held equal
 * here. The same goes for the list of files the site is: Apache and nginx
 * refuse everything else, which is what keeps a host config, a dotfile or a
 * repository file that was copied up by mistake from being served.
 *
 * `npm run test:e2e` serves the built site with the headers exactly as
 * `_headers` writes them and drives the app under them, then serves it from a
 * real nginx and Apache with the other two files (e2e/hosts.mjs). This is the
 * part a browser cannot see; it reads .htaccess line by line and nginx.conf
 * directive by directive, so the lines that made a server send something other
 * than they said (a condition, an <IfModule>, a header in a location) fail here
 * first.
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = path.join(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const HEADERS = read('public/_headers');
const HTACCESS = read('public/.htaccess');
const NGINX = read('deploy/nginx.conf');

/** Every header the site sends on every response. Cache-Control is per path and checked below. */
const SECURITY_HEADERS = [
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Cross-Origin-Opener-Policy',
  'Cross-Origin-Resource-Policy',
  'Strict-Transport-Security',
];

/** `_headers` as rules, in file order: the path pattern and its [name, value] pairs. */
function headerRules(text: string): { pattern: string; headers: [string, string][] }[] {
  const rules: { pattern: string; headers: [string, string][] }[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: [] });
      continue;
    }
    const m = /^\s+([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
    const rule = rules.at(-1);
    if (!m || !rule) throw new Error(`_headers: cannot read ${JSON.stringify(line)}`);
    rule.headers.push([m[1] ?? '', (m[2] ?? '').trim()]);
  }
  return rules;
}

const rules = headerRules(HEADERS);
const ruleFor = (pattern: string) => rules.find((r) => r.pattern === pattern);
/** Name -> value for one `_headers` rule. */
const ruleHeaders = (pattern: string) => new Map(ruleFor(pattern)?.headers ?? []);

/**
 * .htaccess, every line, read the way Apache acts on it. A header set at the top level with nothing
 * after its value is sent on every response; inside `<If>`/`<Else>` only Cache-Control is set, per
 * path. Anything else throws, because then the file does not say what Apache sends: a condition
 * after a value (`env=HTTPS` sent no HSTS behind a proxy that ends TLS), a header without `always`
 * (left off error responses, the 404 page among them), or an `<IfModule>` around the rest (without
 * the module, Apache served every file in the folder with none of the headers and no allow-list).
 */
function readHtaccess(text: string) {
  const headers = new Map<string, string>();
  const cache: [string, string][] = [];
  const rewrite: string[] = [];
  let block: string | null = null;
  const known = [
    /^Options -Indexes$/,
    /^ServerSignature Off$/,
    /^AddDefaultCharset utf-8$/,
    /^ErrorDocument 40[34] \/404\.html$/,
    /^AddType [a-z]+\/[a-z-]+ \.[a-z]+$/,
  ];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^Header always set ([A-Za-z-]+) "([^"]*)"$/.exec(line);
    if (line === '<If "%{REQUEST_URI} =~ m#/_expo/static/#">' || line === '<Else>') {
      if (block !== null) throw new Error(`.htaccess: ${line} inside ${block}`);
      block = line;
    } else if (line === '</If>' || line === '</Else>') {
      if (block === null || /^<(\w+)/.exec(block)?.[1] !== line.slice(2, -1)) throw new Error(`.htaccess: ${line} closes nothing it opened`);
      block = null;
    } else if (header && block !== null) {
      if (header[1] !== 'Cache-Control') throw new Error(`.htaccess: ${header[1]} set only under ${block}`);
      cache.push([block, header[2] ?? '']);
    } else if (header) {
      if (headers.has(header[1] ?? '')) throw new Error(`.htaccess: ${header[1]} set twice`);
      headers.set(header[1] ?? '', header[2] ?? '');
    } else if (block === null && /^(RewriteEngine On|Rewrite(Cond|Rule) .+)$/.test(line)) {
      rewrite.push(line);
    } else if (block !== null || !known.some((k) => k.test(line))) {
      throw new Error(`.htaccess: cannot say what Apache does with ${JSON.stringify(line)}`);
    }
  }
  if (block !== null) throw new Error(`.htaccess: ${block} is never closed`);
  return { headers, cache, rewrite };
}

/**
 * nginx.conf as nginx reads it: each directive's words (quotes taken off) and the blocks it sits
 * in, outermost first, each named by its first word and the order it opened in (`server#2`). A
 * `#` at the start of a word comments out the rest of the line, a quoted string is one word, `{`
 * opens a block, `}` closes one, and `;` ends a directive.
 */
function nginxDirectives(text: string): { words: string[]; blocks: string[] }[] {
  const out: { words: string[]; blocks: string[] }[] = [];
  const blocks: string[] = [];
  let opened = 0;
  let words: string[] = [];
  let word: string | null = null;
  let quote = '';
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  for (const line of text.split('\n')) {
    for (const c of line) {
      if (quote) {
        if (c === quote) quote = '';
        else word += c;
      } else if (c === '#' && word === null) {
        break;
      } else if (c === '"' || c === "'") {
        word ??= '';
        quote = c;
      } else if (/\s/.test(c)) {
        endWord();
      } else if (c === '{' || c === ';' || c === '}') {
        endWord();
        if (c === '{') blocks.push(`${words[0] ?? ''}#${++opened}`);
        else if (c === ';') out.push({ words, blocks: [...blocks] });
        else if (words.length > 0 || blocks.pop() === undefined) throw new Error('nginx.conf: a } that closes nothing, or ends a directive');
        words = [];
      } else {
        word = (word ?? '') + c;
      }
    }
    if (quote) word += '\n';
    else endWord();
  }
  if (blocks.length > 0 || quote || words.length > 0) throw new Error('nginx.conf ends inside a block, a string or a directive');
  return out;
}

const NGINX_DIRECTIVES = nginxDirectives(NGINX);
/** The server block that answers HTTPS, as `nginxDirectives` names it. */
const NGINX_HTTPS = NGINX_DIRECTIVES.find((d) => d.words[0] === 'listen' && /^(\S+:)?443$/.test(d.words[1] ?? ''))?.blocks ?? [];

/** `add_header Name "value" always;` in nginx.conf's HTTPS server, the only place one may be. */
function nginxHeaders(): Map<string, string> {
  const out = new Map<string, string>();
  for (const { words, blocks } of NGINX_DIRECTIVES) {
    if (words[0] === 'add_header' && words[3] === 'always' && words.length === 4 && blocks.join() === NGINX_HTTPS.join()) {
      out.set(words[1] ?? '', words[2] ?? '');
    }
  }
  return out;
}

/** The policy as a <meta> can carry it: a browser ignores frame-ancestors there. */
const withoutFrameAncestors = (csp: string) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !d.startsWith('frame-ancestors'))
    .join('; ');

/** A page as scripts/build-web.mjs finishes it, run through the script itself. */
function builtPage(file: string, base: string): string {
  const script = `
    import fs from 'node:fs';
    import { headerFor, underBase, withPolicyMeta } from './scripts/build-web.mjs';
    const headers = fs.readFileSync('public/_headers', 'utf8');
    const policy = { csp: headerFor(headers, 'Content-Security-Policy'), referrer: headerFor(headers, 'Referrer-Policy') };
    process.stdout.write(withPolicyMeta(underBase(fs.readFileSync(${JSON.stringify(file)}, 'utf8'), ${JSON.stringify(base)}), policy));
  `;
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' });
}

describe('the policy is the same in every place it is written', () => {
  const site = ruleHeaders('/*');
  // A line readHtaccess cannot vouch for fails the test below, by name, rather than the suite.
  const apache = (() => {
    try {
      return readHtaccess(HTACCESS).headers;
    } catch {
      return new Map<string, string>();
    }
  })();
  const nginx = nginxHeaders();

  it.each(SECURITY_HEADERS)('%s', (name) => {
    const value = site.get(name);
    expect(value).toBeTruthy();
    expect(apache.get(name)).toBe(value);
    expect(nginx.get(name)).toBe(value);
  });

  it('and no file sets a header the others do not', () => {
    const names = (m: Map<string, string>) => [...m.keys()].filter((n) => n !== 'Cache-Control').sort();
    expect(names(site)).toEqual([...SECURITY_HEADERS].sort());
    expect(names(apache)).toEqual([...SECURITY_HEADERS].sort());
    expect(names(nginx)).toEqual([...SECURITY_HEADERS].sort());
  });

  it('Apache sets every header on every response, under no condition and no <IfModule>', () => {
    // readHtaccess throws on a line it cannot vouch for, these among them: a header Apache sends
    // only sometimes, or not on an error, read as one it always sends.
    expect(() => readHtaccess(HTACCESS)).not.toThrow();
    const bad = [
      HTACCESS.replace('"max-age=31536000; includeSubDomains"', '"max-age=31536000; includeSubDomains" env=HTTPS'),
      HTACCESS.replace('Header always set X-Frame-Options', 'Header set X-Frame-Options'),
      HTACCESS.replace(/^(Header always set Content-Security-Policy .*)$/m, '<IfModule mod_headers.c>\n$1\n</IfModule>'),
      HTACCESS.replace('RewriteEngine On', 'RewriteEngine Off'),
    ];
    for (const text of bad) {
      expect(text).not.toBe(HTACCESS);
      expect(() => readHtaccess(text)).toThrow();
    }
    expect(HTACCESS).not.toMatch(/^\s*<IfModule/m);
  });

  it('nginx sets every header for the whole HTTPS server, on every answer, and in no location', () => {
    // nginx inherits add_header into a location only when the location sets none of its own: one
    // add_header there drops every header the server sets, for every path it matches. Without
    // `always`, none is sent with an error, the 404 page among them.
    expect(NGINX_HTTPS).toEqual([expect.stringMatching(/^server#\d+$/)]);
    const headers = NGINX_DIRECTIVES.filter((d) => d.words[0] === 'add_header');
    expect(headers).toHaveLength(SECURITY_HEADERS.length + 1); // and Cache-Control
    for (const { words, blocks } of headers) expect([words, blocks]).toEqual([[...words.slice(0, 3), 'always'], NGINX_HTTPS]);
    // A header moved into a location is read as sitting there, and so fails the line above.
    const moved = nginxDirectives(NGINX.replace('    return 404;\n', '    add_header X-Robots-Tag "noindex" always;\n    return 404;\n'));
    expect(moved.find((d) => d.words[1] === 'X-Robots-Tag')?.blocks).toEqual([NGINX_HTTPS[0], expect.stringMatching(/^location#/)]);
  });

  it('nginx turns HTTP/2 on the way 1.24, the LTS one, reads it: a listen parameter, not the http2 directive', () => {
    // `http2 on;` arrived in 1.25.1, and Ubuntu 24.04's 1.24 refuses the whole file over it.
    expect(NGINX_DIRECTIVES.filter((d) => d.words[0] === 'http2')).toEqual([]);
    const listens = NGINX_DIRECTIVES.filter((d) => d.words[0] === 'listen').map((d) => d.words.join(' '));
    expect(listens).toEqual(['listen 80', 'listen [::]:80', 'listen 443 ssl http2', 'listen [::]:443 ssl http2']);
  });

  it.each(['index.html', '404.html'])('%s carries it as <meta> tags once built, frame-ancestors aside', (page) => {
    const csp = site.get('Content-Security-Policy') ?? '';
    const html = builtPage(`public/${page}`, '/drawdraw');
    const metas = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/g)];
    expect(metas).toHaveLength(1);
    expect(metas[0]?.[1]).toBe(withoutFrameAncestors(csp));
    expect(/<meta name="referrer" content="([^"]*)"/.exec(html)?.[1]).toBe(site.get('Referrer-Policy'));
    // Before anything it governs: nothing but the charset may come first.
    const head = html.slice(html.indexOf('<head>'), html.indexOf('http-equiv="Content-Security-Policy"'));
    expect(head.match(/<(link|script|style)\b/g)).toBeNull();
  });
});

describe('the policy', () => {
  const csp = ruleHeaders('/*').get('Content-Security-Policy') ?? '';
  const directives = new Map(
    csp.split(';').map((d): [string, string] => {
      const [name = '', ...sources] = d.trim().split(/\s+/);
      return [name, sources.join(' ')];
    })
  );

  it('starts from nothing, and allows no inline script, no eval and no other origin', () => {
    expect(directives.get('default-src')).toBe("'none'");
    expect(directives.get('script-src')).toBe("'self'");
    expect(csp).not.toMatch(/'unsafe-inline'|'unsafe-eval'|'unsafe-hashes'|\*|https?:|data:/);
    expect(directives.get('connect-src')).toBe("'none'");
    expect(directives.get('object-src')).toBe("'none'");
    expect(directives.get('base-uri')).toBe("'none'");
    expect(directives.get('form-action')).toBe("'none'");
    expect(directives.get('frame-ancestors')).toBe("'none'");
    expect(directives.has('upgrade-insecure-requests')).toBe(true);
    expect(directives.get('require-trusted-types-for')).toBe("'script'");
    expect(directives.get('trusted-types')).toBe("'none'");
  });

  it('allows exactly one inline style: an empty one, which react-native-web fills through the CSSOM', () => {
    const [, hash] = (directives.get('style-src') ?? '').split(' ');
    const empty = createHash('sha256').update('').digest('base64');
    expect(directives.get('style-src')).toBe(`'self' 'sha256-${empty}'`);
    expect(hash).toBe(`'sha256-${empty}'`);
  });

  it('has the same framing answer for old browsers', () => {
    expect(ruleHeaders('/*').get('X-Frame-Options')).toBe('DENY');
  });

  it('denies every powerful feature, the camera and microphone first', () => {
    const features = (ruleHeaders('/*').get('Permissions-Policy') ?? '').split(/,\s*/);
    expect(features.length).toBeGreaterThan(20);
    for (const feature of features) expect(feature).toMatch(/^[a-z-]+=\(\)$/);
    for (const name of ['camera', 'microphone', 'geolocation', 'clipboard-read', 'display-capture', 'usb', 'payment']) {
      expect(features).toContain(`${name}=()`);
    }
  });
});

/** The files a built site holds: public/ less the host configs, Expo's favicon, and a bundle. */
const PUBLIC = (() => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, 'public', dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  walk('');
  return files.sort();
})();
const CONFIGS = ['_headers', '_redirects', '.htaccess'];
const SITE_FILES = [...PUBLIC.filter((f) => !CONFIGS.includes(f)), 'favicon.ico', '_expo/static/js/web/index-0123456789abcdef0123456789abcdef.js'];

/** What a host must not serve, whether or not it is in the published folder. */
const NOT_SITE = [
  ...CONFIGS,
  'README.md',
  'SECURITY.md',
  '.git/config',
  '.git/HEAD',
  '.env',
  'deploy/nginx.conf',
  'package.json',
  'package-lock.json',
  'app.json',
  'app.config.js',
  'metadata.json',
  'src/screens/HomeScreen.tsx',
  'scripts/build-web.mjs',
  'node_modules/expo/package.json',
  '_expo/',
  '_expo/static/',
  '_expo/static/js/',
  '_expo/static/js/web/',
  '.well-known/',
  '.well-known/other.txt',
  'index.html.bak',
  'guard.js/x',
];

/** nginx's allow-list location, as written: a PCRE over the request path that JavaScript reads the same. */
const NGINX_ALLOW = (() => {
  const m = /^\s*location ~ (\^\/\S+\$) \{$/m.exec(NGINX);
  if (!m?.[1]) throw new Error('nginx.conf has no regex location for the site');
  return m[1];
})();
/** .htaccess's allow-list, as written: a negated RewriteRule over the path below the site. */
const APACHE_ALLOW = (() => {
  const m = /^\s*RewriteRule !(\^\S+\$) - \[R=404,L\]$/m.exec(HTACCESS);
  if (!m?.[1]) throw new Error('.htaccess has no negated RewriteRule for the site');
  return m[1];
})();
const nginxAllowList = () => new RegExp(NGINX_ALLOW);
const apacheAllowList = () => new RegExp(APACHE_ALLOW);

describe('the hosts serve the site and nothing else', () => {
  it('is the same list for Apache and nginx', () => {
    // nginx matches the path with its leading slash; Apache, in a directory's
    // .htaccess, without it and with the empty path for the page itself.
    expect(APACHE_ALLOW).toBe(NGINX_ALLOW.replace('^/', '^').replace(/\)\$$/, ')?$'));
  });

  it.each(SITE_FILES)('serves %s', (file) => {
    expect(nginxAllowList().test(`/${file}`)).toBe(true);
    expect(apacheAllowList().test(file)).toBe(true);
  });

  it('serves the page itself at the folder', () => {
    expect(NGINX).toMatch(/location = \/ \{\s*try_files \/index\.html =404;\s*\}/);
    expect(apacheAllowList().test('')).toBe(true);
  });

  it.each(NOT_SITE)('answers %s with a 404', (file) => {
    expect(nginxAllowList().test(`/${file}`)).toBe(false);
    expect(apacheAllowList().test(file)).toBe(false);
  });

  it('sends everything nginx does not list to the 404 page, with no listing and no version', () => {
    expect(NGINX).toMatch(/location \/ \{\s*return 404;\s*\}/);
    expect(NGINX).toMatch(/^\s*error_page 404 \/404\.html;$/m);
    expect(NGINX).toMatch(/^\s*error_page 403 =404 \/404\.html;$/m);
    expect(NGINX).toMatch(/^\s*autoindex off;$/m);
    expect(NGINX.match(/^\s*server_tokens off;$/gm)).toHaveLength(2);
    // Plain HTTP only ever redirects.
    expect(NGINX).toMatch(/listen 80;[\s\S]*?return 301 https:\/\/\$host\$request_uri;/);
  });

  it('and Apache: no listing, the 404 page, plain HTTP redirected, and the allow-list on no condition', () => {
    expect(HTACCESS).toMatch(/^Options -Indexes$/m);
    expect(HTACCESS).toMatch(/^ErrorDocument 404 \/404\.html$/m);
    expect(HTACCESS).toMatch(/^ErrorDocument 403 \/404\.html$/m);
    // In this order, and only these: a RewriteCond in front of the allow-list would decide when
    // it applies, and RewriteEngine Off would turn both rules off.
    expect(readHtaccess(HTACCESS).rewrite).toEqual([
      'RewriteEngine On',
      'RewriteCond %{HTTPS} !=on',
      'RewriteCond %{HTTP:X-Forwarded-Proto} !=https',
      'RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]',
      `RewriteRule !${APACHE_ALLOW} - [R=404,L]`,
    ]);
  });

  it("and leaves Apache's version to the server config, which is where the README asks for it", () => {
    // ServerSignature is the footer of a page Apache writes itself, and every error here is the
    // site's own 404.html. The Server header is ServerTokens, which no .htaccess can set.
    expect(HTACCESS).toMatch(/^ServerSignature Off$/m);
    expect(HTACCESS).not.toMatch(/^\s*ServerTokens\b/m);
    expect(HTACCESS).toMatch(/^# .*`ServerTokens Prod` in the server config/m);
    const apacheRow = read('README.md')
      .split('\n')
      .find((l) => l.startsWith('| Apache 2.4 |'));
    expect(apacheRow).toContain('`ServerTokens Prod`');
  });

  it('and Netlify refuses the one config file it would serve', () => {
    // It reads _headers and _redirects and serves neither.
    expect(read('public/_redirects')).toMatch(/^\/\.htaccess\s+\/404\.html\s+404!$/m);
  });
});

describe('caching', () => {
  const IMMUTABLE = 'public, max-age=31536000, immutable';

  it('keeps the content-hashed bundle for a year and revalidates every other file', () => {
    expect(ruleHeaders('/_expo/static/*').get('Cache-Control')).toBe(IMMUTABLE);
    for (const file of SITE_FILES.filter((f) => !f.startsWith('_expo/'))) {
      expect([file, ruleHeaders(`/${file}`).get('Cache-Control')]).toEqual([file, 'no-cache']);
    }
    expect(ruleHeaders('/').get('Cache-Control')).toBe('no-cache');
  });

  it('never sets one header twice for a path, which a host would join with a comma', () => {
    expect(ruleHeaders('/*').has('Cache-Control')).toBe(false);
    const patterns = rules.map((r) => r.pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it('says the same in nginx and Apache', () => {
    expect(NGINX).toContain(`~^/_expo/static/   "${IMMUTABLE}";`);
    expect(NGINX).toMatch(/default\s+"no-cache";/);
    expect(NGINX).toMatch(/add_header Cache-Control \$drawdraw_cache_control always;/);
    expect(readHtaccess(HTACCESS).cache).toEqual([
      ['<If "%{REQUEST_URI} =~ m#/_expo/static/#">', IMMUTABLE],
      ['<Else>', 'no-cache'],
    ]);
  });
});

describe('/.well-known/security.txt', () => {
  const fields = new Map(
    read('public/.well-known/security.txt')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l): [string, string] => {
        const at = l.indexOf(': ');
        return [l.slice(0, at), l.slice(at + 2)];
      })
  );

  it('names the private reporting route SECURITY.md asks for, and the policy', () => {
    expect(fields.get('Contact')).toBe('https://github.com/Platteration/drawdraw/security/advisories/new');
    expect(read('SECURITY.md')).toContain('Report a vulnerability');
    expect(fields.get('Policy')).toBe('https://github.com/Platteration/drawdraw/blob/HEAD/SECURITY.md');
    expect(fields.get('Preferred-Languages')).toBe('en');
  });

  it('has not expired, and expires within a year (RFC 9116): renew it before then', () => {
    const expires = Date.parse(fields.get('Expires') ?? '');
    expect(expires).toBeGreaterThan(Date.now());
    expect(expires - Date.now()).toBeLessThanOrEqual(366 * 24 * 60 * 60 * 1000);
  });
});

describe('the pages', () => {
  it('carry no inline script, no inline style and no inline handler for the policy to refuse', () => {
    for (const page of ['public/index.html', 'public/404.html']) {
      const html = read(page);
      expect([page, html.match(/<script(?![^>]*\bsrc=)[^>]*>/g)]).toEqual([page, null]);
      expect([page, html.match(/<style\b|\sstyle=|\son[a-z]+=/gi)]).toEqual([page, null]);
    }
  });

  it('load the safety net before the stylesheet and the bundle, from its own file', () => {
    // A stylesheet that fails fires its error before a script after it runs.
    const html = read('public/index.html');
    const guard = html.indexOf('<script src="/guard.js"></script>');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
    expect(guard).toBeLessThan(html.indexOf('</head>'));
    expect(html).toContain('<noscript>');
  });
});

describe('scripts/build-web.mjs', () => {
  /** Run the build script with `args`; it must refuse before it exports or deletes anything. */
  const refuse = (...args: string[]) => {
    try {
      execFileSync(process.execPath, ['scripts/build-web.mjs', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    throw new Error(`build-web.mjs ${args.join(' ')} was not refused`);
  };

  it.each([['.'], ['..'], ['src'], ['public'], ['/tmp/drawdraw-site'], ['package.json']])(
    'refuses to empty --output-dir %s, which is not a website build',
    (dir) => {
      expect(refuse('--output-dir', dir)).toMatch(/--output-dir/);
      expect(fs.existsSync(path.join(root, 'src/screens/HomeScreen.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'public/index.html'))).toBe(true);
    }
  );

  it.each([
    ['netlify', ['_headers', '_redirects']],
    ['cloudflare', ['_headers', '_redirects']],
    ['apache', ['.htaccess']],
    ['nginx', []],
    ['github-pages', ['.nojekyll']],
  ])('--host %s keeps only the config that host reads', (host, kept) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drawdraw-site-'));
    try {
      for (const f of ['_headers', '_redirects', '.htaccess', 'index.html']) fs.writeFileSync(path.join(dir, f), 'x');
      const script = `import { finishForHost } from './scripts/build-web.mjs'; finishForHost(${JSON.stringify(dir)}, ${JSON.stringify(host)});`;
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root });
      expect(fs.readdirSync(dir).sort()).toEqual([...kept, 'index.html'].sort());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is shown with --host github-pages wherever the docs build for a sub-path', () => {
    // A sub-path build is for GitHub Pages. Without --host github-pages it has no .nojekyll, so a
    // branch deploy's Jekyll drops _expo/ and the page is blank, and an Actions deploy publishes
    // the other hosts' configs as files.
    const commands = ['README.md', 'CLAUDE.md'].flatMap((doc) =>
      read(doc)
        .split('\n')
        .filter((line) => /build:web\b.*--base-url/.test(line))
        .map((line) => [doc, line])
    );
    expect(commands.length).toBeGreaterThanOrEqual(2);
    for (const [doc, line] of commands) expect([doc, line]).toEqual([doc, expect.stringContaining('--host github-pages')]);
  });

  it('refuses a host it does not know, before it touches anything', () => {
    // With an --output-dir it would also refuse, so the host is what was refused first.
    expect(refuse('--host', 'iis', '--output-dir', '.')).toMatch(/--host is one of/);
    expect(refuse('--host', 'constructor', '--output-dir', '.')).toMatch(/--host is one of/);
  });

  it('refuses a base path that is not one', () => {
    expect(refuse('--base-url', 'drawdraw')).toMatch(/--base-url/);
    expect(refuse('--base-url', '/draw draw')).toMatch(/--base-url/);
    expect(refuse('--base-url', '//evil.example')).toMatch(/--base-url/);
  });
});
