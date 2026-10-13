# DrawDraw

Read AGENTS.md first. It holds the working rules every coding agent follows in this repository; this file adds the notes specific to this project.

Expo / React Native app (iOS, Android and a website), in TypeScript, that
overlays a rotatable 3D three-segment construction head on a portrait photo and
exports drawing layers.
See README.md for what it does and how the pose fit works.

## Commands

```bash
npm install
npx expo start          # run on a device via Expo Go
npm run check           # the gate before a push: lint, type check, unit tests, conventions test
npm run lint            # eslint, the shared Expo configuration
npm run typecheck       # tsc --noEmit: strict, with noUncheckedIndexedAccess
npm test                # node --test server/kit/selftest.mjs server/api.test.mjs, then jest via the jest-expo preset
npm run icons           # regenerate assets/ from the head model
npm run build:web       # the website in .web-build/ (-- --host github-pages --base-url /drawdraw for a sub-path)
npm run test:e2e        # build the website for /drawdraw/, drive it in a browser under its policy, then serve it from real nginx and Apache
npx expo export --platform ios --platform android --output-dir .export-check
```

`tsconfig.json` extends `expo/tsconfig.base` the way the sibling apps' do, and
lists the `jest` and `node` types because the tests read the file system;
`@types/node` is a devDependency for that reason only, pinned to the Node 22
line CI runs. `App.tsx`, `index.ts`, everything under `src/` and every test are
TypeScript (jest matches `*.test.ts` and `*.test.tsx` only); the tools that run
under plain Node (`tools/`, `e2e/`, `plugins/`, `scripts/`, the config files),
the website's own `public/guard.js`, and the website's API (`server/`, `functions/`:
JavaScript with JSDoc and `// @ts-check`, which `npm run typecheck` checks under this
tsconfig, the kit included) stay JavaScript. Jest's `testTimeout` is 15 s in `package.json`: a suite's first mount of a
screen (App, HomeScreen, EditorScreen) costs 3-4 s cold, measured here, and CI's
runner went over the 5 s default in two of them; every other test takes under a
second. Types describe what the code does: no `as` casts, no `any`, no
`@ts-ignore` or `@ts-expect-error`, in the tests as well. An index that can miss
is handled as a miss; a non-null assertion (`!`) is only for an index the code
beside it has bounded (a loop condition, a remainder, a length check, a
`toHaveBeenCalledTimes` just above), with the bound said in a comment. A
function that is defensive about its input (the storage validators,
`portraitExtension`, `captureSize`) takes `unknown` or the wide type it checks,
so its tests can hand it junk without a cast. Tests reach a mocked module's
functions through `jest.mocked()`, keep a mocked AsyncStorage's contents in a
`mockStore` map beside the factory, and throw a named Error (a small `found()`
helper in the screen tests) where the renderer or a mock's call list could come
back empty. A React
Native event cannot be made whole in a test (its targets are host elements), so
`HeadGestureLayer` exports `gestureCallbacks`, typed by the fingers it reads,
and its test drives those.

`npx expo export` is the fastest way to confirm a change still compiles for both
platforms. `npm run test:e2e` is how to confirm it actually *runs*: there is no
device in CI, so the website stands in for one, and is tested as the website it
also is. Run both (and `npm run check`) before pushing.

## Where things live

- `src/lib/headModel.ts` — all the geometry. The head is an ellipsoid three
  units tall so each facial segment is one unit. Curves are built in model
  space, rotated, projected orthographically, then split into visible and
  hidden runs. Pure, dependency-free, and covered by tests.
- `src/lib/fitSolver.ts` — recovers a head pose from three taps. Pure, tested.
- `src/lib/exportSize.ts` — turns a wanted export size in pixels into the
  options `react-native-view-shot` actually reads. iOS takes them as points
  and rasterises at the screen scale, so a pixel count there is multiplied by
  the device scale. Pure, tested.
- `src/lib/storage.ts` and `src/lib/exports.ts` import
  `expo-file-system/legacy` and `expo-media-library/legacy`: since SDK 54 and 56
  the package roots are object APIs whose functions of the old names are stubs
  that throw. The unit suites mock native modules wholesale, so
  `__tests__/nativeApi.test.ts` checks every name the app imports from a mocked
  module, or reads off its namespace or default export as `X.name`
  (`AsyncStorage.getItem`, `Constants.expoConfig`), against the installed
  package's own type declarations; a default export's members are read through
  the TypeScript checker, which follows the type the export names.
- `src/lib/projectShape.ts` — checks what comes back out of storage, and
  defines the shapes it checks (`Project`, `ProjectSettings`). Anything
  that does not hold up is dropped so the caller's own default applies; it
  invents nothing and never completes an element set. Pure, tested.
- `src/components/HeadGuide.tsx` — renders the model with `react-native-svg`.
  Used both on screen and inside the off-screen export views, which is what
  keeps exports identical to what you see.
- `src/lib/storage.ts` — the project index and the portrait copies it owns.
  Every read-modify-write of the index runs one at a time (`mutate`); an index
  that will not read is reported and never written over (an import then opens
  unsaved, `ephemeral`, like one whose copy failed); nothing removes a drawing
  but the user, and a removal deletes only the file `createProject` named for
  that project.
- `src/lib/exports.ts` — `offerExport`, the device's Save to Photos / Share
  dialog for a captured PNG, which releases the temporary file once, after the
  choice has finished with it.
- `src/screens/EditorScreen.tsx` — the editor; holds the guide state, and
  writes it before it leaves (a write that fails keeps it open and asks).
- `src/lib/errors.ts` — reads `message` and `code` off a caught value of
  unknown type, the way the screens' alerts always read them.
- `plugins/withDebugInternet.js` — config plugin. `app.json` blocks every Android
  permission the app does not use, `INTERNET` included; this adds `INTERNET` back
  to `android/app/src/debug/AndroidManifest.xml` at prebuild, so a development
  build can load its bundle and the release build still has no network
  capability. `__tests__/appConfig.test.ts` holds both halves.
- `server/kit/` — the shared sign-in, shop and webhook kit (sign in with Google,
  Stripe Checkout and its signed webhook), byte for byte the canonical copy every
  platteration repository carries, at this path. **Never edit it here**: a change is
  made to the canonical copy and copied everywhere, and `diff -r` against it must be
  empty. It lints under `eslint.config.js` and type-checks under `tsconfig.json`
  with no ignore and no setting changed; its own tests are `server/kit/selftest.mjs`,
  which `npm test` runs. Its `README.md` is the setup guide and the owner's checklist.
- `server/catalogue.js` (what the website sells: `pro`, one payment, granting `pro`,
  priced by `STRIPE_PRICE_PRO`), `server/start.mjs` (the API on a host of its own,
  loopback, port 8788, records under `KIT_DATA_DIR`), `functions/api/[[path]].js`
  (the kit's three-line Cloudflare Pages entry) and `server/package.json` (only
  `"type": "module"`). `server/api.test.mjs` drives the catalogue through both entries
  with `server/fakes.mjs`'s Google and Stripe handed to the kit as its `fetch`; no
  test or shipped code points the kit at another host. The fakes are test tooling
  and nothing the API imports.
- The website's account in the page: `src/lib/account.ts` (pure: reads what `api/`
  says field by field, the words, the privacy sentences), `src/lib/accountClient.web.ts`
  (the one module that makes a request, to the site's own `api/`, relative to the
  page; navigates only to `api/auth/google/start` and to an address starting
  `https://checkout.stripe.com/`), its twin `src/lib/accountClient.ts` (what a phone
  build resolves: not configured, opens nothing), and `src/lib/useAccount.ts`, which
  asks `api/config` once and leaves everything off for good on a 404, an error or a
  body that is not the kit's. An answer slower than `LOAD_LIMIT_MS` does not hold the
  first frame, which is drawn without an account, and is applied when it comes (with
  `api/me` and the address's `?purchase=`): stayed off for good, it showed a paying
  visitor the free build for the whole visit. The notice line goes when a refresh
  finds nobody signed in (sign-out, deletion, a session that ended), and an `api/me`
  poll asked before that is not applied after it. `useEntitlements(account)` in
  `pro.ts` takes Pro from `api/me` once `api/config` has said the site sells it, and
  from the stored flag otherwise (a site without a shop, or whose `api/config` has not
  answered), and is not `ready` until the account has settled. `appConfig.test.ts`'s
  no-network scan exempts exactly `accountClient.web.ts` and pins the twin inert.
- `tools/make-icons.mjs` — renders `assets/` from `headModel.ts`, which it
  imports by that name: Node strips the types itself from 22.18 on, which is
  why `engines.node` says `>=22.18`. Node warns once that the package has no
  `"type"` field (`MODULE_TYPELESS_PACKAGE_JSON`); that is expected. So
  `headModel.ts` keeps to erasable TypeScript (no enums, no namespaces) and
  imports nothing.
- `e2e/smoke.mjs` — drives the real critical path in a browser and measures
  where the three-tap fit actually lands, against a synthetic portrait laid out
  on known thirds (`e2e/portrait.mjs`), then downloads every free export and
  reads its pixels back. `e2e/host.mjs` serves the built site at `/drawdraw/`
  with the headers exactly as `public/_headers` writes them. It fails on any
  policy violation, console or page error, or request outside the site, which
  is how a runtime break — or a policy that blocks something real — gets caught
  when bundling still succeeds. `e2e/host.mjs` refuses `_headers`, `_redirects`
  and `_redirects`' 404 rules by the file a path resolves to, so `//_headers`
  is refused like `/_headers`. Given `api`, it hands `<base>/api/*` to the site's
  API as Cloudflare Pages does a Function, and the smoke test plays the whole
  sign-in and shop flow there: Playwright routes no redirect's target (measured:
  neither `page.route` nor `context.route` sees the browser follow the kit's 302 to
  accounts.google.com), so the kit's answer to `api/auth/google/start` reaches the
  browser as a `Refresh` to the same address, and `page.route` answers Google's
  authorize URL with the redirect to the callback. A request to Google or Stripe
  that no route answered fails the run.
- `e2e/hosts.mjs` — the last step of `npm run test:e2e`: the same build served
  by the nginx and Apache installed on the machine (GitHub's Ubuntu runner has
  nginx 1.24 and Apache 2.4.58), `deploy/nginx.conf` loaded with only the lines
  its header says to change, `.htaccess` under `AllowOverride FileInfo Options`
  and `ServerTokens Prod`, and checks what they send: every site file with the
  headers `_headers` gives it (HSTS included behind a proxy that ends TLS),
  everything else the 404 page with every header, plain HTTP redirected, no
  version named, an Apache without `mod_rewrite` and `mod_headers` serving
  nothing, and `api/` handed to `server/start.mjs` with the API's own headers by
  nginx's `location ^~ /api/` and by the README's Apache lines (read out of its
  table), then, with the API stopped, answered by both with the site's 404 page and
  every header (nginx's 502 through the location's `error_page`, Apache's 503 through
  the README's `ErrorDocument`), never the server's own page. `website.test.ts` reads `.htaccess` line by line (an `<IfModule>`
  or a condition after a header's value fails it) and nginx.conf directive by
  directive (an `add_header` outside the HTTPS server, or `http2 on;`, fails
  it; the one stated exception is `location ^~ /api/`, whose one `add_header` is
  the server's Strict-Transport-Security line, so the API's own headers go out
  alone), but only a server shows what a file does. Where nginx, Apache or openssl
  is missing it says so and passes, except under `CI`.
- The website. `scripts/build-web.mjs` runs `expo export --platform web`, which
  copies `public/` into the site and fills in `public/index.html` (SDK 57's
  single-output template: no inline script or style, `guard.js` first); then it
  adds the policy as `<meta>` tags from `public/_headers`, points root-absolute
  addresses at the base path (`app.config.js` hands Expo that path as
  `experiments.baseUrl`, only when `WEB_BASE_URL` is set, so app.json is read as
  written everywhere else), and checks every page reference resolves;
  `--host` keeps only the config file that host reads (and writes `.nojekyll`
  for GitHub Pages, whose Jekyll drops `_expo/`). The
  policy is in four places — `public/_headers`, `public/.htaccess`,
  `deploy/nginx.conf`, and the built pages' `<meta>` — and
  `__tests__/website.test.ts` holds them equal, along with the allow-list of
  site files Apache and nginx serve (everything else is a 404). Every source in
  the policy was measured in Chromium with the policy as a header: the one
  `style-src` hash is the empty string's, for react-native-web's empty
  `<style>` that it fills through the CSSOM (refused, the layout collapses);
  `img-src blob:` is the picked portrait and the export's redrawn SVG;
  `connect-src 'self'` is the site's own `api/` (with `'none'` the page's
  `api/config` is refused). The build also writes `_routes.json` (`<base>/api/*`),
  which only `--host cloudflare` keeps and `_redirects` refuses; `--host cloudflare`
  refuses a `--base-url`, since Pages serves a project at the root of its domain and
  `functions/api/[[path]].js` answers `/api/*` alone. A new
  file the site loads goes in the allow-lists and the `_headers` cache rules,
  and the test fails until it does.
- `src/lib/webExport.ts` — exports in a browser. react-native-view-shot's web
  capture is html2canvas, which writes its copy of the page with
  `document.write` (refused under the site's Trusted Types) and stretches the
  on-screen view to the export size; this draws the export view's photo, flat
  lines, SVG and text onto a canvas at full size and downloads it. Anything new
  drawn into an export view has to be one of those four kinds, or the web
  export leaves it out: the e2e reads the exported pixels back to catch that.

## Rules of this codebase

- The geometry and solver modules stay free of React and React Native imports.
  That is what makes them testable, and CI depends on it — keep it that way.
- Anything that changes what the guide looks like must go through
  `renderGuides()` in `EditorScreen`, so the screen and the exports cannot
  drift apart.
- `buildHeadWireframe` treats the caller's element set as authoritative: an
  element left out is off. Do not merge defaults back in — the free tier
  filters elements by omission.
- Draft rendering (coarser sampling, no depth taper) is for live gestures only.
  Exports always render at full quality.
- Free features are never watermarked, and there are no ads or consumables.
  New paid surface goes behind `pro` in `src/lib/pro.ts`.
- The web is a shipping target (a website) as well as the device stand-in the
  e2e rides on. Prefer a dependency that behaves the same on all three
  platforms over one that needs a web special case. What a browser cannot do
  says so on the page rather than leaving a dead control: messages go through
  `notify` in `src/lib/confirm.ts` (react-native-web's `Alert.alert` is an
  empty stub, so a message through it is never seen), the home screen says a
  browser keeps settings but not portraits, and the Vibration row is disabled
  with its reason. Nothing may add an inline script, an inline style, a
  connection beyond the site's own `api/`, or a third-party file to the page:
  the policy refuses them and the e2e fails. Google and Stripe are top-level
  navigations, never a script, frame or image of theirs.
- The website's sign-in and shop (`server/kit`) are web only and off until the owner
  sets the keys; a site with no API behaves as it did before. The phone apps keep
  their no-network posture (INTERNET blocked) and the store seam in `purchases.ts`.

## Native configuration

The Android/iOS posture is pinned by `__tests__/appConfig.test.ts`, which
introspects the real plugin chain (`expo config --type introspect`) rather than
reading app.json alone: app.json states every key the test pins, even at its
default, so the two say the same thing and a default that moves between SDKs
moves visibly. `expo-system-ui` is what makes `userInterfaceStyle` reach Android
(its pin is read from `expo/bundledNativeModules.json`, so an SDK upgrade moves
it); `android.predictiveBackGestureEnabled: false` protects the
BackHandler-driven screens, and SDK 57's prebuild writes it into the manifest as
`android:enableOnBackInvokedCallback="false"`, which the test reads back.
`newArchEnabled` and `android.edgeToEdgeEnabled` left the schema in SDK 57 and
the test holds both absent. Edge-to-edge is mandatory on Android, so every screen
takes its insets from `react-native-safe-area-context` — React Native's own
`SafeAreaView` insets on iOS only — and each Modal (Settings, the paywall) carries
its own `SafeAreaView`, because a Modal is a window of its own and inherits none
of the root's padding; `__tests__/App.test.tsx` pins both. The
adaptive icon is three generated layers (`adaptive-icon.png`,
`android-icon-background.png`, `android-icon-monochrome.png`) out of
`tools/make-icons.mjs` — the monochrome layer is the foreground's geometry in
white because a themed launcher reads only its alpha — and `npm run icons:check`
plus the pixel checks in the config test keep them honest; never hand-draw one.
`eas.json` uses `appVersionSource: remote` with `autoIncrement` on production,
so build numbers live on EAS. CI bundles iOS and Android into `.export-check`,
which git and the lint config ignore; delete it after a local run.

## Settings

User preferences are one record under `drawdraw.settings.v1`, beside the project index
(`drawdraw.projects.v1`) and the Pro flag (`drawdraw.entitlements.v1`); every key is named
in `KEYS` in `src/lib/settings.ts`, and `__tests__/settings-contract.test.tsx` pins the key
list, the rows (`haptics`, `seenIntro`) and the enum tables (none yet: both fields are
booleans, and the first enum row adds its table to `TABLES`). `settings.ts` is the
validator — pure, like `projectShape.ts` — and every read goes through `cleanSettings` /
`cleanEntitlements`, which rebuild a record field by field from the defaults and look tables
up by own property only (`has`); its test walks `Object.prototype`'s names built with
`JSON.parse`, and must fail if `has` becomes `in`. `src/lib/settingsStore.ts` is the only
module that reads or writes the record, and holds the one migration: the old
`drawdraw.onboarded.v1` flag is folded into `seenIntro` (read NEW; else read OLD, write NEW,
remove OLD only after the write succeeded; both present means NEW wins). `App.tsx` loads the
record before the first frame, gates every haptic through `setHapticsEnabled` in
`src/lib/feedback.ts` (no call site touches `expo-haptics` directly), and shows
`SettingsScreen` in a Modal from the home screen's footer. Reset to defaults is confirmed and
touches the settings record alone — never projects, Pro or `seenIntro`, which records what
was shown rather than a preference. Confirmations go through `src/lib/confirm.ts` (`confirmAction`; one-button messages through
`notify`), because react-native-web's `Alert.alert` is an empty stub and a two-button confirm
through it did nothing on the web build the e2e drives. There is no theme row: the app has one palette, and
`__tests__/appearance.test.ts` pins `userInterfaceStyle: light` to that. About shows the
version from `expo-constants` (`Constants.expoConfig.version`, app.json's `version`; not yet
checked on an EAS build, where `appVersionSource: remote` may need `expo-application` as the
fallback), the source link — the one URL the app hands to the OS, which
`appConfig.test.ts` pins to that single `Linking.openURL` call — and what leaves the
device, exact for each build (`privacyLine` in `SettingsScreen.tsx`, the sentences in
`src/lib/account.ts`): the phone app has no network access; the website sends nothing of the
visitor's; a website whose API offers sign-in says what signing in and buying tell the site and
Stripe. On such a site Settings also has an Account section (Sign in with Google; Signed in
as …, Sign out, Delete account through `confirmAction`). The account lives on the server, not
in a storage key: none is added to `KEYS`.

## Conventions

This repository follows `CONVENTIONS.md`, which is identical in every platteration
repository and pinned by the conventions test (`npm run test:conventions`, or
`tests/test_conventions.py` in a Python repository): the script set (`test`,
`typecheck`, `lint`, `check`, `test:e2e`, `test:all`), Node 22 via `.nvmrc`, one
`.editorconfig`, ESLint per stack, the `ci.yml` shape, the documents every repository
carries and the README skeleton. The repository's check command (`npm run check`, or
`ruff check .` then `pytest -q` in a Python repository) is the gate before a push. To
change a convention, change it in every repository in one pass and update the hashes in
the test.
