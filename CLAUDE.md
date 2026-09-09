# DrawDraw

Expo / React Native app (iOS + Android) that overlays a rotatable 3D
three-segment construction head on a portrait photo and exports drawing layers.
See README.md for what it does and how the pose fit works.

## Commands

```bash
npm install
npx expo start          # run on a device via Expo Go
npm test                # jest, via the jest-expo preset
npm run icons           # regenerate assets/ from the head model
npm run e2e             # build for web and drive the app in a browser
npx expo export --platform ios --platform android --output-dir .export-check
```

`npx expo export` is the fastest way to confirm a change still compiles for both
platforms. `npm run e2e` is how to confirm it actually *runs*: there is no
device in CI, so the web build stands in for one. Run both (and `npm test`)
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
- `src/components/HeadGuide.js` — renders the model with `react-native-svg`.
  Used both on screen and inside the off-screen export views, which is what
  keeps exports identical to what you see.
- `src/screens/EditorScreen.js` — the editor; holds the guide state.
- `tools/make-icons.mjs` — renders `assets/` from `headModel.js`.
- `e2e/smoke.mjs` — drives the real critical path in a browser and measures
  where the three-tap fit actually lands, against a synthetic portrait laid out
  on known thirds (`e2e/portrait.mjs`). It fails on any console or page error,
  which is how a runtime break gets caught when bundling still succeeds.

## Conventions

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
