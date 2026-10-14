# DrawDraw

A portrait-drawing app for iOS, Android and the web, built with [Expo](https://expo.dev) / React
Native in TypeScript.

Load a portrait and DrawDraw overlays the **three-segment head** — the classic method of
dividing a face into three equal parts: chin→nose, nose→eyebrows, eyebrows→top of the
skull. The guide is not a flat grid but a **3D construction head**: the divisions are rings
that wrap around it, so they stay proportionally true when the face turns, tips or tilts,
and you can turn the guide through a full 360° to match any pose. Lines running behind the
head render dashed and faded, and near lines carry more weight than far ones, the way a
construction drawing is weighted.

## What it does

**Fit it to a face in three taps.** Tap the chin, the base of the nose, and the brow, and
the guide solves its own pose — orientation, roll, size and position. No face detection and
no native module involved; see *How the fit works* below.

**Turn, place, and adjust it.** One finger rotates, pinch scales, a two-finger twist rolls,
and Move mode repositions. Yaw snaps to the standard views (front, ¾, profile, back) with a
haptic tick. Presets jump to Front / ¾ / Profile / Above / Below.

**Build up the whole construction.** Beyond the three segments: center line, eye line, side
planes, jaw, ears, hairline, mouth line, and the fifths meridians that divide the head
across its widest point — each toggled independently. A step-by-step mode reveals them in
construction order, by hand or on a timer.

**Adjust the proportions.** The brow and nose lines are parameters, not constants, because
that is exactly what separates an adult head from a child's. Sliders move them plus head
width and depth; presets cover adult, slim, child, infant and stylized proportions.

**Practice from it.** Practice mode hides the photo so you draw from the guide alone, with a
hold-to-peek button to check yourself.

**Export layers to draw on.** Every export is a PNG at the photo's own resolution (capped at
4096px on the long edge), saved to your photo library or sent through the share sheet — or, in a
browser, downloaded:

1. **Photo + guide** — the portrait with the construction baked in, for reference.
2. **Guide only** — the construction alone on a transparent background, to drop over your
   canvas as its own layer.
3. **Tracing layer** — the portrait faded back (opacity adjustable) on transparency.
4. **Turnaround sheet** — the same head, in the same proportions, at six standard angles as
   one transparent sheet. This is the thing a flat overlay can never give you: views the
   photo does not contain.

**Pick up where you left off.** Portraits are kept as projects with their full guide setup
autosaved, and written again as you leave the editor or the app goes to the background; a save
that fails is said, and leaving then is your call. Picked images are copied out of the OS cache
into the app's documents directory, so recents cannot break when the system clears its cache,
and every drawing stays until you remove it (a long press on a recent). A browser has no such
directory: the website keeps your settings, not your portraits, and says so on its home screen.

## How the fit works

A head turned or tilted away from the viewer foreshortens its segments *unequally*, and the
nose and brow — which sit forward on the curve of the face — swing sideways relative to the
chin. So three points on the midline carry enough information to recover the pose.

`src/lib/fitSolver.ts` searches yaw and pitch coarse-to-fine. At each candidate it solves
the remaining unknowns — uniform scale, in-plane rotation, translation — in closed form with
a similarity Procrustes fit, and keeps the orientation with the smallest residual. Because
roll is applied last in the rotation and the projection is orthographic, the in-plane
rotation the fit recovers *is* the roll, exactly.

Against synthetic ground truth, exact taps recover pose to within 0.1° across a range of
poses; fingertip-scale noise (±6px) stays within about 4°, well inside nudging distance.
A solve takes about 2.5ms. Degenerate input returns `null` rather than a bad fit.

## Free and Pro

The method itself, fitting it to a photo, and all three portrait exports are free and
**never watermarked**. There are no ads and no consumable currency. Pro is a single
one-time unlock (not a subscription) covering the full construction head, the child /
infant / stylized proportion packs, turnaround sheets, and the step-by-step lessons.

Billing is deliberately **not wired up in this repo**. `src/lib/purchases.ts` defines the
provider interface and ships a `NotConfiguredProvider` that reports honestly rather than
pretending to charge, so the app builds and runs without a billing SDK. Implementing
`getProducts` / `purchase` / `restore` against StoreKit or Play Billing (directly or
through a service such as RevenueCat) and calling `setPurchaseProvider` at startup is the
only change needed; entitlement storage and every gate already work.

The website can sell Pro itself: see *Sign in and Pro on the website* below. There Pro is a
Stripe Checkout payment recorded against the visitor's Google account, and the phone apps
are untouched by it.

## Running it

```bash
npm install
npx expo start
```

Scan the QR code with [Expo Go](https://expo.dev/go) on an iOS or Android device. Saving to
Photos, haptics and the share sheet need a real device; `npm run web` runs the website, where an
export downloads instead and the Vibration row says a browser cannot vibrate.

Expo Go runs one Expo SDK at a time; this app is on SDK 57, the current one when this was
written. Expo Go carries its own native configuration rather than this app's, so the
permission strings and the blocked permissions described below only apply to a development
build — `npx expo run:ios` or `npx expo run:android` — or a store build.

### Native builds

```bash
npm install -g eas-cli
eas build --platform ios
eas build --platform android
```

Photo library and camera permission strings are configured in `app.json`, and so
is everything the build deliberately does *not* ask for. The Expo modules bring
their own Android permissions — expo-media-library alone asks for the whole
media-read set, images, video, audio and legacy storage, through its manifest
and its config plugin — and the prebuild
template adds the "display over other apps" overlay; none of it is used by an
app that only ever writes one PNG, so `android.blockedPermissions` takes it back
out. What ships is the camera, the vibrator and, on Android 12 and below, write
access to save an export to Photos. `INTERNET` is blocked with the rest:
expo-file-system declares it, nothing a phone build carries ever opens a socket (the
website's account client, `src/lib/accountClient.web.ts`, is bundled into the web build
alone, and `__tests__/appConfig.test.ts` holds both halves of that), and it is
the one permission that turns a malicious dependency from something that reads
the app's own documents into something that sends them somewhere. A development
build does need it — that is how Metro's bundle reaches the device — so
`plugins/withDebugInternet.js` adds it back at prebuild, to
`android/app/src/debug/AndroidManifest.xml` alone: the manifest merger gives a
build-type source set higher priority than the main manifest, and the release
variant never reads that file. It is the same split React Native's own template
uses for its debug-only overlay permission.

`android.allowBackup` is off. Expo's default turns it on, which would put the
app's own full-resolution copies of the portraits into Android Auto Backup and
within reach of `adb backup` on Android 11 and below. For a photo taken with the
in-app camera that copy is the only one in existence, so the default is what
would send a face to a cloud account — from a phone app that has no network code of
its own at all. The cost of turning it off is that the portrait list does not
follow you to a new device. On iOS the documents directory is still covered by
iCloud backup and there is no Expo API for excluding a file from it, so deleting
a portrait (hold its thumbnail on the home screen) is what takes it out of the
next backup.

### Deploy

DrawDraw is also a website: the same app, exported for the browser, with everything still on
the visitor's device. The photo is read by the browser, never uploaded, and the page connects
to nothing but its own site's `api/` (`connect-src 'self'`): once per load, to ask whether
sign-in is offered, and beyond that only when the visitor signs in or buys (see *Sign in and
Pro on the website*). Where no API runs, that one question is answered with the site's 404 page
and nothing more is asked.

```bash
npm run build:web -- --host netlify        # a site for the root of its own domain, in .web-build/
npm run build:web -- --host github-pages --base-url /drawdraw   # served under /drawdraw/
```

`scripts/build-web.mjs` runs `expo export --platform web`, which copies `public/` into the site
and fills in `public/index.html`; then it writes the Content-Security-Policy and the referrer
policy into every page as `<meta>` tags, points the pages' addresses at the base path, removes
Expo's `metadata.json`, and refuses a site in which a page names a file it does not hold.
**Publish the contents of `.web-build/`, never the checkout.** The site is exactly `index.html`,
`404.html`, `guard.js`, `site.css`, `favicon.ico`, `robots.txt`, `.well-known/security.txt` and
the content-hashed bundle under `_expo/static/`, plus the config file for your host; without
`--host` all four configs stay, and each host ignores the others':

| Host | Reads | Notes |
| --- | --- | --- |
| Netlify, Cloudflare Pages | `_headers`, `_redirects`; Cloudflare Pages also `_routes.json` | Build with `--host netlify` or `--host cloudflare`, which leaves `.htaccess` out (Netlify would refuse it through `_redirects` anyway; Cloudflare Pages has no 404 rule and would serve it as a file). `_routes.json` sends `/api/*`, and nothing else, to the site's API on Cloudflare Pages; `--host netlify` leaves it out, and `_redirects` refuses it. Cloudflare Pages serves a project at the root of its domain, where `functions/api/[[path]].js` answers `/api/*`, so `--host cloudflare` refuses a `--base-url`. |
| Apache 2.4 | `.htaccess` | Build with `--host apache`. Needs `mod_rewrite` and `mod_headers` (`a2enmod rewrite headers`) and `AllowOverride FileInfo Options`; without either module every request is a 500 and the error log names the directive. Set `ServerTokens Prod` in the server config, which no `.htaccess` can: without it every response names Apache's version and the system's. The site's API needs `ProxyPass "/api/" "http://127.0.0.1:8788/api/"` in the virtual host, with `mod_proxy` and `mod_proxy_http` (`ProxyPass` is server configuration; an `.htaccess` could proxy through a `RewriteRule` with `[P]`, but the virtual host is the place for it, as `server/kit/README.md` says), and beside it `ErrorDocument 502 /404.html`, `ErrorDocument 503 /404.html` and `ErrorDocument 504 /404.html`: while the API is not running Apache answers 503, and with these that is the site's 404 page with every header rather than Apache's own page with none. Under a sub-path, every path in those four lines starts with it, the `ProxyPass` target's included. |
| nginx | `deploy/nginx.conf` | Build with `--host nginx`; copy the config into the server's, set `server_name`, `root` and the certificate paths. Written for a domain root. HTTP/2 is turned on in the `listen` lines, which nginx 1.24 (Ubuntu 24.04's) reads; `http2 on;` would need 1.25.1. `location ^~ /api/` hands the site's API to `server/start.mjs` on `127.0.0.1:8788`; while it is not running nginx answers 502 (504 when it does not answer in time) with the site's 404 page and every header, and the page reads that as no account. |
| GitHub Pages | nothing | Build with `--host github-pages --base-url /<repo>`, which writes `.nojekyll`: a branch deploy otherwise runs Jekyll, which drops every path starting with `_`, the bundle's `_expo/` among them. Pages sends no headers of the site's choosing: only the `<meta>` policy applies (not `frame-ancestors`, which a `<meta>` cannot carry), and HSTS, nosniff, the framing refusal, the Permissions-Policy and COOP/CORP do not. |

The headers, the same in `public/_headers`, `public/.htaccess` and `deploy/nginx.conf`
(`__tests__/website.test.ts` fails when they are not, and `npm run test:e2e` checks what a real
nginx and Apache send with them). They are the site's files' headers; the API's answers under
`api/` carry the API's own (`default-src 'none'` and the rest, see `server/kit/README.md`):

| Header | Value | Why |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'none'; script-src 'self'; style-src 'self' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests; require-trusted-types-for 'script'; trusted-types 'none'` | Only the site's own script and stylesheet run. The one hash is that of an *empty* string: react-native-web creates one empty `<style>` and fills it through the CSSOM, and without the hash Chromium refuses it and the layout collapses; no `'unsafe-inline'`. `blob:` is the portrait the file picker hands over and the guide redrawn for an export. Connections to the site's own `api/` alone (sign-in and the shop; with `'none'` the page's one question to it is refused): Google and Stripe are top-level navigations, which the policy does not govern, and no script, frame, font or image of theirs is loaded. Trusted Types, under which React and react-native-web run. Every source was measured in Chromium with the policy sent as a header, and `npm run test:e2e` fails on any violation. |
| `X-Frame-Options` | `DENY` | With `frame-ancestors 'none'`: the app is not meant to be embedded. |
| `X-Content-Type-Options` | `nosniff` | Files are what their type says. |
| `Referrer-Policy` | `no-referrer` | The site makes no cross-origin request, and nothing it leaves for (the source, Google's sign-in, Stripe's Checkout) gains anything from one. |
| `Permissions-Policy` | 51 features denied (`=()`): camera, microphone, geolocation, the motion sensors, clipboard, payment, USB, serial, HID, screen capture, fullscreen, and the advertising, storage-sharing and on-device AI APIs | The app uses none of them. "Take a photo" in a browser is the file picker's own capture, not the camera API. Every name is one Chromium 141 recognises (an unknown one is a console warning), except `web-share`, which Chromium recognises only where it supports sharing. |
| `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` | `same-origin` | No other window reaches this one; no other site embeds its files. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Browsers remember to use HTTPS. Apache and nginx also redirect plain HTTP. |
| `Cache-Control` | a year, `immutable`, for `_expo/static/`; `no-cache` for every other file | The bundle's name is a hash of its contents; every other name stays the same across builds, so it is revalidated on every load. |

Apache and nginx serve the site's files and nothing else: a dotfile, a host config, a folder
listing or a repository file copied up by mistake is answered with the site's own `404.html`,
which needs no script. `guard.js`, loaded before the stylesheet and the bundle, is the safety
net: a bundle or stylesheet that fails to load or is refused, or a bundle that throws before the
app draws, shows "DrawDraw has not started" instead of a blank page, and an app that stops after
starting says so. With JavaScript off, a
`<noscript>` note says what is needed.

**One origin per app.** Browser storage is per origin. A GitHub Pages project site shares
`<user>.github.io` with every other site the account publishes, so their pages can read and
write each other's storage. DrawDraw keeps only its settings and the Pro flag there, under keys
prefixed `drawdraw.`, and reads both through validators, but give the site a domain or
subdomain of its own. On the web the Pro flag is a record the visitor can edit. While the
site's API answers that it sells Pro, Pro is what the API says the signed-in visitor bought and
the flag is not read for it; where it sells nothing, or does not answer (down, blocked), the
site behaves as one without a shop and the flag is all there is. The site's API
needs an origin of its own all the more: its sign-in cookie goes with every request to the
origin, so every page on it can act as the signed-in visitor (`server/kit/README.md`,
"One origin per app is a security boundary").

**Launch checklist**, with `SITE` the https address:

```sh
curl -sI http://SITE/ | head -1                       # a 301 to https (Apache, nginx)
curl -sI https://SITE/ | grep -iE 'content-security|strict-transport|nosniff|x-frame|referrer|permissions|cache-control'
curl -sI https://SITE/.htaccess | head -1             # 404
curl -sI https://SITE/_expo/ | head -1                # 404, not a listing
curl -sI https://SITE/nonexistent | head -1           # 404, the site's own page
curl -s  https://SITE/.well-known/security.txt        # the contacts, and an Expires date in the future
curl -s  https://SITE/api/config                      # with the API: what is on; without it: the 404 page
```

Then open the site, choose a portrait, fit it, export a layer, and check that the console shows
no `Content Security Policy` line. `.well-known/security.txt` expires on 8 October 2027; the
unit tests fail once it has, or if it is ever set more than a year ahead.

### Sign in and Pro on the website

The website can sign visitors in with Google and sell Pro through Stripe Checkout, with
a small API on the site's own origin under `api/`: `server/kit/`, the shared kit, copied
byte for byte from its canonical copy and never edited here (its `README.md` is the full
setup guide and the owner's checklist). It is **off until it is given keys**: with none set,
and on any host that runs no API (GitHub Pages, Netlify, Apache or nginx without it),
`api/config` says nothing is on or is answered with the site's 404 page, and the site looks
and behaves as it does without it. The phone apps never use it: they keep their store seam in `src/lib/purchases.ts`,
since the App Store and Google Play require their own in-app purchase for a digital unlock.

- **What is sold** is the one thing the app already sells: Pro, product `pro`
  (`server/catalogue.js`), one payment, granting the entitlement `pro`. Free features are
  not sold and never watermarked. Only Stripe's signed webhook grants it; coming back from
  Checkout grants nothing by itself.
- **Where it runs.** Cloudflare Pages: `functions/api/[[path]].js` (the kit's entry with this
  catalogue), the `_routes.json` the build writes (`/api/*` only), a KV namespace bound as
  `KIT_STORE`, and the variables below. A host of your own: `KIT_DATA_DIR=/var/lib/drawdraw-api
  node server/start.mjs` (loopback, port 8788) behind `deploy/nginx.conf`'s `location ^~ /api/`
  or Apache's `ProxyPass`, with the data directory outside the web root.
- **Variables** (environment only, never in the repository): `APP_URL` (the site's address,
  with its trailing slash), `SESSION_SECRET`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (a
  Web client whose redirect URI is `APP_URL` + `api/auth/google/callback`), `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET` (the endpoint `APP_URL` + `api/webhooks/stripe`) and `STRIPE_PRICE_PRO`.
  Sign-in turns on with the first four; the shop also needs the last three.
- **On the page** (web build only): Settings gains an Account section (Sign in with Google;
  Signed in as …, Sign out, Delete account, which asks first), and the paywall sells Pro at
  Stripe's price, with Buy, Sign in to buy or Owned. While `api/config` says the site sells
  Pro, Pro is what `api/me` says: the Pro flag in the browser's storage is not read for it.
  When `api/config` does not answer (the API down, or the request blocked), the site
  behaves as one without a shop, the flag included. The first frame waits for those answers
  at most five seconds; one that comes later is applied then, so a slow API shows a paying
  visitor the free build for a moment rather than for the rest of the visit. A line at the
  top says "Sign-in didn't complete.", "Thank you — DrawDraw Pro is unlocked." or that the
  payment is on its way; it goes when the visitor signs out or deletes the account.
- **What leaves the device**, and only if the visitor signs in or buys: Google tells the site
  an account id and the email address, and Stripe handles the payment and is told that account
  id with it (as the Checkout's reference and in its metadata, where it stays after the account
  here is deleted; never the email address). The site keeps the
  account id, what was bought, Stripe's customer id and, for 30 days, the Checkout page it last
  sent the visitor to (so that a second Buy before Stripe's webhook is given the same one), and
  the email address only while the visitor is signed in. The About card says so on such a
  site; the portraits are never uploaded.
- **What it does not protect.** Pro unlocks drawing aids in a page the visitor runs: someone who
  edits the page can turn them on without paying. The server's record of a paid Checkout is what
  a sale is; the unlock in the page is a convenience, not protection.

## Development

```bash
npm run check     # the gate before a push: lint, type check, unit tests, conventions test
npm run lint      # eslint, the shared Expo configuration
npm run typecheck # tsc --noEmit
npm test          # the kit's self-test and the site's API (node --test), then the unit tests
npm run test:e2e  # build for web and drive the app in a real browser
npm run icons     # regenerate assets/ from the head model
```

The geometry and solver are pure modules with no React Native imports, so they
are tested directly: rotation orthonormality, finite output across the full
sphere of orientations and every proportion preset, hidden-line splitting, the
two signals the fit reads, and the solver's recovery, noise tolerance and
refusal of degenerate input. CI lints, type-checks, runs the tests and the conventions test,
bundles for iOS and Android, checks that `assets/` still matches what the model
generates, and then runs the browser test of the website; a separate job runs
`node .github/audit/npm-audit.mjs`, the shared audit gate: it runs `npm audit --omit=dev`
against the lockfile and fails on every high or critical advisory but those
`.github/audit/accepted.json` accepts (braces and node-forge, which reach only the build
tooling, each along every route it arrives by, with no release to take, until a date at most
90 days ahead).

Bundling proves the app compiles; `npm run test:e2e` proves the website runs. It
builds the site for `/drawdraw/`, serves it from a host that sends the headers
exactly as `public/_headers` writes them, and drives the real critical path in
Chromium under that policy — onboarding, importing a portrait, fitting the guide
with three taps, every export downloaded and read back pixel by pixel, the
paywall and Settings — then checks where the guide actually landed against a
synthetic portrait laid out on known thirds. Any policy violation, console or
page error, or request outside the site fails the run, which is how a runtime
break, or a policy that blocks something real, gets caught while bundling still
succeeds. It also checks the 404 page, the safety net with the bundle blocked
and with a bundle that runs but never draws, the page with JavaScript off, and
the files a host must not serve. Then it serves the same build with the site's API
beside it, Google and Stripe faked through the kit's injected `fetch`, and plays the
whole flow under the site's policy: sign in with Google, buy Pro through Checkout,
Stripe's signed webhook, sign out (the thank-you going with it), sign in again, an
`api/config` held past the first frame's limit and Pro applied when it answers, Pro drawn in
the editor, delete the account, a refused sign-in and a cancelled Checkout. Then `e2e/hosts.mjs` serves the same build from
the nginx and Apache installed on the machine, `deploy/nginx.conf` and the
`.htaccess` as the table above says to install them, and checks that every file
of the site is answered with the headers `_headers` gives it, that everything
else is the site's 404 page, that `api/` reaches the site's API with the API's own
headers and, with the API stopped, is the site's 404 page with every header, and that plain
HTTP is redirected; where nginx or
Apache is missing it says so and skips, except under CI. The web is a shipping
target as well as the device stand-in for CI.

## Project layout

```
App.tsx                          Root — onboarding, projects, editor, paywall
src/theme.ts                     Sketchbook palette and type

src/lib/headModel.ts             3D head: ellipsoid, construction curves,
                                 rotation, orthographic projection, hidden-line
                                 splitting, proportion presets
src/lib/fitSolver.ts             Three-tap pose solver (Procrustes + search)
src/lib/storage.ts               Projects: durable image copies + settings
src/lib/pro.ts                   Entitlements and what each tier includes
src/lib/purchases.ts             Store provider seam
src/lib/account.ts               The website's account and shop: what api/ says, checked,
                                 and the words the page says
src/lib/accountClient.web.ts     The website's client for its own api/ (web build only)
src/lib/accountClient.ts         Its phone twin: not configured, opens nothing
src/lib/useAccount.ts            The account as App.tsx sees it
src/lib/settings.ts              Storage keys, the settings record and its validator
src/lib/settingsStore.ts         Reads and writes it; migrates the old onboarding flag
src/lib/feedback.ts              Every haptic, behind the Vibration switch
src/lib/confirm.ts               Confirmations that also work on react-native-web
src/lib/errors.ts                What a caught error says, for an alert

src/screens/HomeScreen.tsx       Pick a portrait, reopen recents
src/screens/EditorScreen.tsx     The overlay editor and exports
src/screens/OnboardingScreen.tsx Three pages teaching the method
src/screens/PaywallScreen.tsx    One-time unlock (on the website, through Stripe Checkout)
src/screens/SettingsScreen.tsx   Vibration, reset to defaults, the website's account, about

src/components/HeadGuide.tsx         SVG rendering of the head (screen + export)
src/components/HeadGestureLayer.tsx  Rotate / move / pinch / twist, snap haptics
src/components/FitOverlay.tsx        Three-tap capture and markers
src/components/TurnaroundSheet.tsx   Six-view contact sheet
src/components/GuideOverlay.tsx      Flat 2D guide lines
src/components/DraggableGuide.tsx    Drag handles for the 2D lines
src/components/ui.tsx                Chips, sliders, buttons
src/components/AccountNotice.tsx     The website account's one line on arrival

plugins/withDebugInternet.js     Config plugin: network access in the debug
                                 manifest only, never in the release build
tools/make-icons.mjs             Renders assets/ from the head model

src/lib/webExport.ts             Exports in a browser: drawn at full size, downloaded
app.config.js                    The website's base path, for a sub-path build
scripts/build-web.mjs            Builds the website: the export plus the hosting layer
public/                          Copied into the site: the page template, site.css,
                                 guard.js (the safety net), 404.html, robots.txt,
                                 .well-known/security.txt, and the host configs
                                 (_headers, _redirects, .htaccess)
deploy/nginx.conf                The same headers and rules for nginx, and the API's proxy
server/kit/                      The shared sign-in, shop and webhook kit (never edited here)
server/catalogue.js              What the website sells: Pro
server/start.mjs                 The API on a host of its own (node:http, loopback)
server/api.test.mjs, fakes.mjs   The API as deployed, against fake Google and Stripe
functions/api/[[path]].js        The API on Cloudflare Pages
e2e/smoke.mjs, e2e/host.mjs      The website, served as _headers says, driven in Chromium
e2e/hosts.mjs                    The same build on a real nginx and Apache
```

App icons and the splash mark are generated from `src/lib/headModel.ts` rather
than checked in as opaque art, so the app's mark and its subject cannot drift
apart. The generator is standard library only — an analytic-coverage line
rasterizer and a minimal PNG encoder over `node:zlib` — and imports the model
by its `.ts` name, which Node runs without a build step from 22.18 on (the
`engines` floor).

The 3D guide has no GL or engine dependency: `headModel.ts` rotates and orthographically
projects the head analytically (the silhouette is the projected quadric of the rotated
ellipsoid), and the result is drawn with `react-native-svg` — which keeps it crisp at export
resolution and fully capturable in the transparent PNGs. Exports are produced by
`react-native-view-shot` capturing off-screen views that mirror the on-screen overlay
exactly.
