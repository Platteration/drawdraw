# DrawDraw

A portrait-drawing app for iOS and Android, built with [Expo](https://expo.dev) / React Native.

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
4096px on the long edge), saved to your photo library or sent through the share sheet:

1. **Photo + guide** — the portrait with the construction baked in, for reference.
2. **Guide only** — the construction alone on a transparent background, to drop over your
   canvas as its own layer.
3. **Tracing layer** — the portrait faded back (opacity adjustable) on transparency.
4. **Turnaround sheet** — the same head, in the same proportions, at six standard angles as
   one transparent sheet. This is the thing a flat overlay can never give you: views the
   photo does not contain.

**Pick up where you left off.** Portraits are kept as projects with their full guide setup
autosaved. Picked images are copied out of the OS cache into the app's documents directory,
so recents cannot break when the system clears its cache.

## How the fit works

A head turned or tilted away from the viewer foreshortens its segments *unequally*, and the
nose and brow — which sit forward on the curve of the face — swing sideways relative to the
chin. So three points on the midline carry enough information to recover the pose.

`src/lib/fitSolver.js` searches yaw and pitch coarse-to-fine. At each candidate it solves
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

Billing is deliberately **not wired up in this repo**. `src/lib/purchases.js` defines the
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

Scan the QR code with [Expo Go](https://expo.dev/go) on an iOS or Android device. Exports,
haptics and the share sheet need a real device.

Expo Go ships only the current Expo SDK, and this app is still on SDK 53, so a current
Expo Go will refuse to open it. Until that upgrade lands, use a development build —
`npx expo run:ios` or `npx expo run:android` — which is what the exports and the share
sheet want anyway.

## Development

```bash
npm test          # unit tests: head model, fit solver, storage, entitlements, screens
npm run e2e       # build for web and drive the app in a real browser
npm run icons     # regenerate assets/ from the head model
```

The geometry and solver are pure modules with no React Native imports, so they
are tested directly: rotation orthonormality, finite output across the full
sphere of orientations and every proportion preset, hidden-line splitting, the
two signals the fit reads, and the solver's recovery, noise tolerance and
refusal of degenerate input. CI runs the tests, bundles for both platforms, and
checks that `assets/` still matches what the model generates.

Bundling proves the app compiles; `npm run e2e` proves it runs. It builds for
web, serves it, and drives the real critical path in Chromium — onboarding,
importing a portrait, fitting the guide with three taps — then reads the
rendered SVG back and checks where the guide actually landed against a
synthetic portrait laid out on known thirds. Any console or page error fails
the run, which is how a runtime break gets caught while bundling still
succeeds. Web is a test surface rather than a shipping target.

## Building standalone apps

```bash
npm install -g eas-cli
eas build --platform ios
eas build --platform android
```

Photo library and camera permission strings are configured in `app.json`.

## Project layout

```
App.js                          Root — onboarding, projects, editor, paywall
src/theme.js                    Sketchbook palette and type

src/lib/headModel.js            3D head: ellipsoid, construction curves,
                                rotation, orthographic projection, hidden-line
                                splitting, proportion presets
src/lib/fitSolver.js            Three-tap pose solver (Procrustes + search)
src/lib/storage.js              Projects: durable image copies + settings
src/lib/pro.js                  Entitlements and what each tier includes
src/lib/purchases.js            Store provider seam

src/screens/HomeScreen.js       Pick a portrait, reopen recents
src/screens/EditorScreen.js     The overlay editor and exports
src/screens/OnboardingScreen.js Three pages teaching the method
src/screens/PaywallScreen.js    One-time unlock

src/components/HeadGuide.js         SVG rendering of the head (screen + export)
src/components/HeadGestureLayer.js  Rotate / move / pinch / twist, snap haptics
src/components/FitOverlay.js        Three-tap capture and markers
src/components/TurnaroundSheet.js   Six-view contact sheet
src/components/GuideOverlay.js      Flat 2D guide lines
src/components/DraggableGuide.js    Drag handles for the 2D lines
src/components/ui.js                Chips, sliders, buttons

tools/make-icons.mjs            Renders assets/ from the head model
```

App icons and the splash mark are generated from `src/lib/headModel.js` rather
than checked in as opaque art, so the app's mark and its subject cannot drift
apart. The generator is standard library only — an analytic-coverage line
rasterizer and a minimal PNG encoder over `node:zlib`.

The 3D guide has no GL or engine dependency: `headModel.js` rotates and orthographically
projects the head analytically (the silhouette is the projected quadric of the rotated
ellipsoid), and the result is drawn with `react-native-svg` — which keeps it crisp at export
resolution and fully capturable in the transparent PNGs. Exports are produced by
`react-native-view-shot` capturing off-screen views that mirror the on-screen overlay
exactly.
