# DrawDraw

Expo / React Native app (iOS + Android) that overlays a rotatable 3D
three-segment construction head on a portrait photo and exports drawing layers.
See README.md for what it does and how the pose fit works.

## Commands

```bash
npm install
npx expo start          # run on a device via Expo Go
npm run check           # the gate before a push: lint, unit tests, conventions test
npm run lint            # eslint, the shared Expo configuration
npm test                # jest, via the jest-expo preset
npm run icons           # regenerate assets/ from the head model
npm run test:e2e        # build for web and drive the app in a browser
npx expo export --platform ios --platform android --output-dir .export-check
```

`npx expo export` is the fastest way to confirm a change still compiles for both
platforms. `npm run test:e2e` is how to confirm it actually *runs*: there is no
device in CI, so the web build stands in for one. Run both (and `npm run check`)
before pushing.

## Where things live

- `src/lib/headModel.js` — all the geometry. The head is an ellipsoid three
  units tall so each facial segment is one unit. Curves are built in model
  space, rotated, projected orthographically, then split into visible and
  hidden runs. Pure, dependency-free, and covered by tests.
- `src/lib/fitSolver.js` — recovers a head pose from three taps. Pure, tested.
- `src/lib/exportSize.js` — turns a wanted export size in pixels into the
  options `react-native-view-shot` actually reads. iOS takes them as points
  and rasterises at the screen scale, so a pixel count there is multiplied by
  the device scale. Pure, tested.
- `src/lib/projectShape.js` — checks what comes back out of storage. Anything
  that does not hold up is dropped so the caller's own default applies; it
  invents nothing and never completes an element set. Pure, tested.
- `src/components/HeadGuide.js` — renders the model with `react-native-svg`.
  Used both on screen and inside the off-screen export views, which is what
  keeps exports identical to what you see.
- `src/screens/EditorScreen.js` — the editor; holds the guide state.
- `plugins/withDebugInternet.js` — config plugin. `app.json` blocks every Android
  permission the app does not use, `INTERNET` included; this adds `INTERNET` back
  to `android/app/src/debug/AndroidManifest.xml` at prebuild, so a development
  build can load its bundle and the release build still has no network
  capability. `__tests__/appConfig.test.js` holds both halves.
- `tools/make-icons.mjs` — renders `assets/` from `headModel.js`.
- `e2e/smoke.mjs` — drives the real critical path in a browser and measures
  where the three-tap fit actually lands, against a synthetic portrait laid out
  on known thirds (`e2e/portrait.mjs`). It fails on any console or page error,
  which is how a runtime break gets caught when bundling still succeeds.

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
  New paid surface goes behind `pro` in `src/lib/pro.js`.
- Web is a test surface, not a shipping target, but it has to stay working
  because the smoke test rides on it. Prefer a dependency that behaves the same
  on all three platforms over one that needs a web special case.

## Native configuration

The Android/iOS posture is pinned by `__tests__/appConfig.test.js`, which
introspects the real plugin chain (`expo config --type introspect`) rather than
reading app.json alone: app.json states every key the test pins, even at its
default, so the two say the same thing and a default that moves between SDKs
moves visibly. `expo-system-ui` is what makes `userInterfaceStyle` reach Android
(its pin is read from `expo/bundledNativeModules.json`, so an SDK upgrade moves
it); `android.predictiveBackGestureEnabled: false` protects the
BackHandler-driven screens and has no reader on SDK 53 — it is there for the SDK
57 upgrade, which also drops `newArchEnabled` and `android.edgeToEdgeEnabled`
from the schema, so those two assertions flip to `toBeUndefined()` then. The
adaptive icon is three generated layers (`adaptive-icon.png`,
`android-icon-background.png`, `android-icon-monochrome.png`) out of
`tools/make-icons.mjs` — the monochrome layer is the foreground's geometry in
white because a themed launcher reads only its alpha — and `npm run icons:check`
plus the pixel checks in the config test keep them honest; never hand-draw one.
`eas.json` uses `appVersionSource: remote` with `autoIncrement` on production,
so build numbers live on EAS. `expo export --output-dir` must be inside the
project (a /tmp path is refused), which is why CI writes to `.export-check`.

## Settings

User preferences are one record under `drawdraw.settings.v1`, beside the project index
(`drawdraw.projects.v1`) and the Pro flag (`drawdraw.entitlements.v1`); every key is named
in `KEYS` in `src/lib/settings.js`, and `__tests__/settings-contract.test.js` pins the key
list, the rows (`haptics`, `seenIntro`) and the enum tables (none yet: both fields are
booleans, and the first enum row adds its table to `TABLES`). `settings.js` is the
validator — pure, like `projectShape.js` — and every read goes through `cleanSettings` /
`cleanEntitlements`, which rebuild a record field by field from the defaults and look tables
up by own property only (`has`); its test walks `Object.prototype`'s names built with
`JSON.parse`, and must fail if `has` becomes `in`. `src/lib/settingsStore.js` is the only
module that reads or writes the record, and holds the one migration: the old
`drawdraw.onboarded.v1` flag is folded into `seenIntro` (read NEW; else read OLD, write NEW,
remove OLD only after the write succeeded; both present means NEW wins). `App.js` loads the
record before the first frame, gates every haptic through `setHapticsEnabled` in
`src/lib/feedback.js` (no call site touches `expo-haptics` directly), and shows
`SettingsScreen` in a Modal from the home screen's footer. Reset to defaults is confirmed and
touches the settings record alone — never projects, Pro or `seenIntro`, which records what
was shown rather than a preference. Confirmations go through `src/lib/confirm.js`, because
react-native-web's `Alert.alert` is an empty stub and a two-button confirm through it did
nothing on the web build the e2e drives. There is no theme row: the app has one palette, and
`__tests__/appearance.test.js` pins `userInterfaceStyle: light` to that. About shows the
version from `expo-constants` (`Constants.expoConfig.version`, app.json's `version`; not yet
checked on an EAS build, where `appVersionSource: remote` may need `expo-application` as the
fallback) and the source link — the one URL the app hands to the OS, which
`appConfig.test.js` pins to that single `Linking.openURL` call.

## Conventions

This repository follows `CONVENTIONS.md`, which is identical in every platteration
repository and pinned by the conventions test (`npm run test:conventions`, or
`tests/test_conventions.py` in a Python repository): the script set (`test`,
`typecheck`, `lint`, `check`, `test:e2e`, `test:all`), Node 22 via `.nvmrc`, one
`.editorconfig`, ESLint per stack, the `ci.yml` shape, the documents every repository
carries and the README skeleton. `npm run check` is the gate before a push. To change a
convention, change it in every repository in one pass and update the hashes in the test.
