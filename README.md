# DrawDraw

A portrait-drawing app for iOS and Android, built with [Expo](https://expo.dev) / React Native.

Warm paper, graphite labels, and dark sanguine controls give it a sketchbook look.

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

Save failures keep your current work open with a retry action. If the saved project
index is partly damaged, readable drawings remain available for export. Recovery
keeps the original index before restoring those drawings; **Remove recovery copies**
deletes those snapshots separately from your current projects. Recent portraits have
named open and removal buttons, with removal confirmed before deleting; damaged
indexes must be recovered before individual drawings can be removed. Home scrolls
to keep these controls reachable on smaller screens and with larger text.

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

Billing is **not wired up in this repo**. `src/lib/purchases.js` ships an unavailable
provider, and the Pro screen shows no purchase price or purchase/restore actions until a
store provider is configured. Paid launch requires StoreKit / Play Billing integration
(directly or through a service such as RevenueCat) and matching store product records.

Register the provider with `setPurchaseProvider` at startup. `getProducts` returns the
known product ID and the store's localized `price`; `purchase` must return `{ pro: true }`
only after validating an active, completed entitlement. A resolved pending or canceled
transaction does not unlock Pro. `restore` returns an explicit boolean `pro`, including
`false` when the store confirms no active purchase. The local entitlement cache supports
offline use; production integration must also validate receipts and refresh entitlements
on launch/resume to handle refunds and revocations. Complete the billing cases in
[native release validation](docs/NATIVE_VALIDATION.md) before enabling paid purchases.

## Running it

CI and EAS profiles use Node 22.23.3. Use the same version for local validation.

```bash
npm ci
npx expo start
```

Scan the QR code with [Expo Go](https://expo.dev/go) on an iOS or Android device. Exports,
haptics and the share sheet need a real device.

## Development

```bash
npm test          # geometry, fitting, storage, billing and regression tests
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
web, serves it, and drives onboarding, importing a portrait, fitting the guide,
editing its pose and construction, flat guides, style controls, practice,
autosave, recovery and Pro gating. It reads the rendered SVG back and checks
where the guide actually landed against a synthetic portrait laid out on
known thirds. Any console or page error fails
the run, which is how a runtime break gets caught while bundling still
succeeds. Web is a test surface rather than a shipping target.

## Building standalone apps

`eas.json` pins EAS CLI 24.12.1 and defines `preview` for internal device testing and
`production` for store builds. Production build numbers are managed remotely by EAS
and increment automatically; the user-visible version remains in `app.json`.

Use EAS CLI 24.12.1 from the intended toolchain and check `eas --version` before
building. In the prepared Codex cloud environment, setup installs a separate CLI
with reviewed official dependency patches. Select that installation:

```bash
export PATH=/workspace/.drawdraw-release-tools/node_modules/.bin:$PATH
eas --version
```

That prefix is specific to the prepared environment. Elsewhere, an upstream command
such as `npx --yes eas-cli@24.12.1` uses its own dependencies and does **not** inherit
the reviewed overrides. The published CLI pins older tar, nanoid and other packages
with known advisories; selecting the same CLI version alone does not reproduce the
patched toolchain. Review build-tool dependencies when preparing another environment.
Remaining upstream tooling advisories also mean the reviewed installation is not
claimed to be advisory-free.

Before building, authenticate with the intended Expo account and link this checkout to
its actual EAS project using `eas init`. Configure signing for
`com.platteration.drawdraw`; internal iOS builds also need registered test devices.
The repository does not contain account IDs or signing credentials.

```bash
eas build --profile preview --platform all
# After completing docs/NATIVE_VALIDATION.md on iOS and Android:
eas build --profile production --platform all
```

These commands request builds, not store publication. Store submission additionally
requires the App Store Connect / Play Console app records, signing and submission
access, privacy policy and support URLs, disclosures, screenshots, and review details.
Paid releases also require the billing integration described above. Native permission
configuration is in `app.json`; review permissions in the final signed artifacts.

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
