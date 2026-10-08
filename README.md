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
autosaved. Picked images are copied out of the OS cache into the app's documents directory,
so recents cannot break when the system clears its cache. A browser has no such directory: the
website keeps your settings, not your portraits, and says so on its home screen.

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
expo-file-system declares it, nothing in `src/` ever opens a socket, and it is
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
would send a face to a cloud account — from an app that has no network code of
its own at all. The cost of turning it off is that the portrait list does not
follow you to a new device. On iOS the documents directory is still covered by
iCloud backup and there is no Expo API for excluding a file from it, so deleting
a portrait (hold its thumbnail on the home screen) is what takes it out of the
next backup.

### Deploy

DrawDraw is also a website: the same app, exported for the browser, with everything still on
the visitor's device. The photo is read by the browser, never uploaded, and the page opens no
connection of its own (`connect-src 'none'`).

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
`--host` all three configs stay, and each host ignores the others':

| Host | Reads | Notes |
| --- | --- | --- |
| Netlify, Cloudflare Pages | `_headers`, `_redirects` | Build with `--host netlify` or `--host cloudflare`, which leaves `.htaccess` out (Netlify would refuse it through `_redirects` anyway; Cloudflare Pages has no 404 rule and would serve it as a file). |
| Apache 2.4 | `.htaccess` | Build with `--host apache`. Needs `mod_rewrite`, `mod_headers` and `AllowOverride FileInfo Options`. |
| nginx | `deploy/nginx.conf` | Build with `--host nginx`; copy the config into the server's, set `server_name`, `root` and the certificate paths. Written for a domain root. |
| GitHub Pages | nothing | Build with `--host github-pages --base-url /<repo>`, which writes `.nojekyll`: a branch deploy otherwise runs Jekyll, which drops every path starting with `_`, the bundle's `_expo/` among them. Pages sends no headers of the site's choosing: only the `<meta>` policy applies (not `frame-ancestors`, which a `<meta>` cannot carry), and HSTS, nosniff, the framing refusal, the Permissions-Policy and COOP/CORP do not. |

The headers, the same in `public/_headers`, `public/.htaccess` and `deploy/nginx.conf`
(`__tests__/website.test.ts` fails when they are not):

| Header | Value | Why |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'none'; script-src 'self'; style-src 'self' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='; img-src 'self' blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests; require-trusted-types-for 'script'; trusted-types 'none'` | Only the site's own script and stylesheet run. The one hash is that of an *empty* string: react-native-web creates one empty `<style>` and fills it through the CSSOM, and without the hash Chromium refuses it and the layout collapses; no `'unsafe-inline'`. `blob:` is the portrait the file picker hands over and the guide redrawn for an export. No connection of any kind, and Trusted Types, under which React and react-native-web run. Every source was measured in Chromium with the policy sent as a header, and `npm run test:e2e` fails on any violation. |
| `X-Frame-Options` | `DENY` | With `frame-ancestors 'none'`: the app is not meant to be embedded. |
| `X-Content-Type-Options` | `nosniff` | Files are what their type says. |
| `Referrer-Policy` | `no-referrer` | The site makes no cross-origin request, and the one outbound link (the source) gains nothing from one. |
| `Permissions-Policy` | 51 features denied (`=()`): camera, microphone, geolocation, the motion sensors, clipboard, payment, USB, serial, HID, screen capture, fullscreen, and the advertising, storage-sharing and on-device AI APIs | The app uses none of them. "Take a photo" in a browser is the file picker's own capture, not the camera API. Every name is one Chromium 141 recognises (an unknown one is a console warning), except `web-share`, which Chromium recognises only where it supports sharing. |
| `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` | `same-origin` | No other window reaches this one; no other site embeds its files. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Browsers remember to use HTTPS. Apache and nginx also redirect plain HTTP. |
| `Cache-Control` | a year, `immutable`, for `_expo/static/`; `no-cache` for every other file | The bundle's name is a hash of its contents; every other name stays the same across builds, so it is revalidated on every load. |

Apache and nginx serve the site's files and nothing else: a dotfile, a host config, a folder
listing or a repository file copied up by mistake is answered with the site's own `404.html`,
which needs no script. `guard.js`, loaded before the bundle, is the safety net: a bundle that
fails to load, is refused or throws before the app draws shows "DrawDraw has not started"
instead of a blank page, and an app that stops after starting says so. With JavaScript off, a
`<noscript>` note says what is needed.

**One origin per app.** Browser storage is per origin. A GitHub Pages project site shares
`<user>.github.io` with every other site the account publishes, so their pages can read and
write each other's storage. DrawDraw keeps only its settings and the Pro flag there, under keys
prefixed `drawdraw.`, and reads both through validators, but give the site a domain or
subdomain of its own. On the web the Pro flag is a record the visitor can edit: this build sells
nothing, and a store wired up on the web would need a server to check purchases.

**Launch checklist**, with `SITE` the https address:

```sh
curl -sI http://SITE/ | head -1                       # a 301 to https (Apache, nginx)
curl -sI https://SITE/ | grep -iE 'content-security|strict-transport|nosniff|x-frame|referrer|permissions|cache-control'
curl -sI https://SITE/.htaccess | head -1             # 404
curl -sI https://SITE/_expo/ | head -1                # 404, not a listing
curl -sI https://SITE/nonexistent | head -1           # 404, the site's own page
curl -s  https://SITE/.well-known/security.txt        # the contact, and an Expires date in the future
```

Then open the site, choose a portrait, fit it, export a layer, and check that the console shows
no `Content Security Policy` line. `.well-known/security.txt` expires on 8 October 2027; the
unit tests fail once it has, or if it is ever set more than a year ahead.

## Development

```bash
npm run check     # the gate before a push: lint, type check, unit tests, conventions test
npm run lint      # eslint, the shared Expo configuration
npm run typecheck # tsc --noEmit
npm test          # unit tests: head model, fit solver, storage, entitlements, screens
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
`npm audit --omit=dev --audit-level=high` against the lockfile.

Bundling proves the app compiles; `npm run test:e2e` proves the website runs. It
builds the site for `/drawdraw/`, serves it from a host that sends the headers
exactly as `public/_headers` writes them, and drives the real critical path in
Chromium under that policy — onboarding, importing a portrait, fitting the guide
with three taps, every export downloaded and read back pixel by pixel, the
paywall and Settings — then checks where the guide actually landed against a
synthetic portrait laid out on known thirds. Any policy violation, console or
page error, or request outside the site fails the run, which is how a runtime
break, or a policy that blocks something real, gets caught while bundling still
succeeds. It also checks the 404 page, the safety net with the bundle blocked,
the page with JavaScript off, and the files a host must not serve. The web is a
shipping target as well as the device stand-in for CI.

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
src/lib/settings.ts              Storage keys, the settings record and its validator
src/lib/settingsStore.ts         Reads and writes it; migrates the old onboarding flag
src/lib/feedback.ts              Every haptic, behind the Vibration switch
src/lib/confirm.ts               Confirmations that also work on react-native-web
src/lib/errors.ts                What a caught error says, for an alert

src/screens/HomeScreen.tsx       Pick a portrait, reopen recents
src/screens/EditorScreen.tsx     The overlay editor and exports
src/screens/OnboardingScreen.tsx Three pages teaching the method
src/screens/PaywallScreen.tsx    One-time unlock
src/screens/SettingsScreen.tsx   Vibration, reset to defaults, about

src/components/HeadGuide.tsx         SVG rendering of the head (screen + export)
src/components/HeadGestureLayer.tsx  Rotate / move / pinch / twist, snap haptics
src/components/FitOverlay.tsx        Three-tap capture and markers
src/components/TurnaroundSheet.tsx   Six-view contact sheet
src/components/GuideOverlay.tsx      Flat 2D guide lines
src/components/DraggableGuide.tsx    Drag handles for the 2D lines
src/components/ui.tsx                Chips, sliders, buttons

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
deploy/nginx.conf                The same headers and rules for nginx
e2e/smoke.mjs, e2e/host.mjs      The website, served as _headers says, driven in Chromium
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
