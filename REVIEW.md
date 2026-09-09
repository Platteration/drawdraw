# DrawDraw — security & upgrade review (2026-09-09)

Two independent reviewers read every first-party file in this repository; a third then re-read each security or bug claim against the code and tried to refute it. Only claims that survived that check are listed as findings; the ones that did not are recorded at the end so they are not re-raised.

## Status — what has been fixed

These findings are now fixed on `claude/repo-review-security-baiyud`, each with a regression test:

- **VER-1**
- **SEC-1**
- **SEC-2**
- **SEC-3**
- **BUG-5**
- **BUG-6**

The rest of this document is the review as written, and the fixed items are left in place so the reasoning behind each change stays with it.

Repository hardening applied here as well: every GitHub Action is pinned to a commit rather than a floating tag, each workflow declares a least-privilege `permissions` block, and a Dependabot config, a licence and a security policy are in place.

## Summary

DrawDraw is a well-built Expo/React Native portrait-drawing app: it overlays a parametric 3D Loomis-style construction head on a photo, recovers the head's pose from three taps with a Procrustes + orientation-search solver, and exports transparent PNG drawing layers. The engineering is unusually disciplined for a side project — pure dependency-free geometry and solver modules with real numerical tests, app icons generated from the same model that draws the guide, and a Playwright smoke test that measures where the fitted guide actually lands against a synthetic portrait laid out on known thirds. Its maturity gap is entirely at the edges rather than in the core: it is the last repo in the portfolio on Expo SDK 53 (siblings are all on SDK 57 / RN 0.86.3 / React 19.2.3), the only one in plain JavaScript with no typecheck step, the only one pinned to a now-EOL Node 20 in CI, and it carries all 20 npm advisories (8 HIGH — image-size DoS through metro, postcss, playwright) that the SDK upgrade closes. The headline recommendations are: (1) walk SDK 53 to 57 one SDK at a time, which is a real migration and not a version bump — expo-file-system's whole API changed in SDK 54, react-native-view-shot needs a 4.x to 5.x major for the new architecture, and Android edge-to-edge is now unconditional while App.js still uses react-native's iOS-only SafeAreaView; (2) add TypeScript, ESLint and a typecheck/lint/audit gate to CI to match the siblings; and (3) close the app-store readiness gaps — there is no eas.json despite the README telling you to run eas build, no LICENSE or privacy policy, a hardcoded $7.99 price that never asks the store, and a light-only palette whose muted greys fail WCAG AA.

## Attack surface

DrawDraw is an offline, single-user Expo app: there is no network code anywhere in the first-party source (grep for fetch/XMLHttpRequest/WebSocket/Linking/http:// across src, App.js and index.js returns nothing), no accounts, no analytics, no API keys and no server, so the classic injection/SSRF/CORS/authz surface is absent. Everything untrusted enters through the operating system: an image chosen with expo-image-picker (its URI string, its pixel data, its declared width/height) and, on Android, a content:// URI whose filename cannot be trusted. Everything trusted-but-local lives in AsyncStorage (the project index 'drawdraw.projects.v1', the onboarding flag, and the Pro entitlement 'drawdraw.entitlements.v1') and in two file locations: durable portrait copies under FileSystem.documentDirectory + 'portraits/' and export PNGs written to the cache by react-native-view-shot. The app asks the OS for camera, photo-library read (image picker) and photo-library read+write (media library) permissions, and hands exported files to arbitrary third-party apps through the system share sheet. The only local trust boundary is the Pro flag, which is a plaintext boolean in AsyncStorage with no server behind it. CI runs on push and pull_request with no secrets, but installs Playwright browsers over the network; the web build exists only as a test surface and is served by a loopback-bound dev-only static server. Realistically, the material risks here are privacy (how much photo-library access is asked for, and what copies of the user's photos are left lying around) and correctness on Android, not remote compromise.

## Already done well

- No network of any kind: no fetch/XHR/WebSocket/Linking/WebView in src, App.js or index.js, no analytics SDK, no third-party service, and a grep for api key / secret / token / private key patterns across the tree finds nothing committed.
- Filenames for imported photos are derived defensively with an extension allow-list rather than by trusting the picker URI (src/lib/filenames.js:10-21), and the behaviour is unit-tested against content:// URIs, dotfiles, query strings and null (src/lib/__tests__/filenames.test.js).
- The destination path for a copied portrait is entirely app-generated — `${PORTRAIT_DIR}${id}.${portraitExtension(asset.uri)}` with id = `p${Date.now().toString(36)}` — so no part of an OS-supplied URI reaches the filesystem path (src/lib/storage.js:41-46).
- deleteProject refuses to delete anything outside the app's own portrait directory: `if (target?.image?.uri?.startsWith(PORTRAIT_DIR))` (src/lib/storage.js:75).
- Permission usage strings are declared through the config plugins with app-specific, honest wording rather than left to defaults (app.json:24-34), and ACCESS_MEDIA_LOCATION is explicitly disabled (`"isAccessMediaLocationEnabled": false`, app.json:34); the picker is never asked for EXIF, so no GPS metadata reaches JS.
- The Pro filter is applied where the wireframe is built (src/screens/EditorScreen.js:104-107) and buildHeadWireframe treats the caller's element set as authoritative (src/lib/headModel.js:352-354), so a free-tier export cannot contain locked construction lines even though the same render path serves screen and export.
- The pure modules (headModel, fitSolver) carry real numerical tests — orthonormality, finiteness across the whole sphere of orientations, hidden-line splitting, noise tolerance, refusal of degenerate input (src/lib/__tests__/headModel.test.js, fitSolver.test.js).
- The e2e smoke test drives the real critical path in Chromium and fails the run on any console or page error (e2e/smoke.mjs:63-67, 159), which catches runtime breakage that bundling would miss.
- CI uses `npm ci` against a committed lockfileVersion 3 lockfile rather than `npm install` (.github/workflows/ci.yml:17,33), and verifies the committed icons still match the model.
- Interactive controls carry accessibility roles, states and labels, including a locked-feature label (src/components/ui.js:12-14,58-60) and an adjustable role with increment/decrement actions on the hand-rolled slider (src/components/Slider.js:68-72).
- Failure paths degrade instead of crashing: a failed portrait copy falls back to the original URI (src/lib/storage.js:48-50), haptics and AsyncStorage writes are `.catch(() => {})`, and a degenerate three-tap fit returns null and shows an explanation rather than a nonsense pose (src/lib/fitSolver.js:118, EditorScreen.js:219-224).

## Findings (22)

| # | Severity | Category | Title | Where | Effort | Status |
|---|---|---|---|---|---|---|
| VER-1 | High | bug | On iOS every export is rendered at device scale, so a full-resolution photo produces a ~110-megapixel PNG and the 4096px cap is not a cap | `src/screens/EditorScreen.js:231` | small | found by second reviewer |
| SEC-1 | Medium | privacy | Save-to-Photos requests full photo-library read access when it only ever writes | `src/screens/EditorScreen.js:238` | trivial | confirmed |
| SEC-2 | Medium | privacy | Photo import is hard-gated on a library permission the system picker does not need | `src/screens/HomeScreen.js:74` | trivial | confirmed |
| SEC-3 | Medium | privacy | expo-image-picker's plugin ships a microphone usage string the app never uses | `app.json:24` | trivial | confirmed, severity raised |
| BUG-3 | Medium | bug | Exports are an upscale of a screen-sized rendering, not the photo's own resolution | `src/screens/EditorScreen.js:626` | medium | confirmed |
| BUG-4 | Medium | reliability | Off-screen export views re-render at full quality on every gesture frame, defeating draft mode | `src/screens/EditorScreen.js:623` | medium | confirmed |
| BUG-5 | Medium | bug | Android hardware Back exits the app instead of leaving the editor | `App.js:36` | small | confirmed |
| BUG-6 | Medium | bug | iOS-only SafeAreaView combined with edge-to-edge puts the Android UI under the system bars | `App.js:34` | small | confirmed |
| SUP-1 | Medium | supply-chain | Expo SDK 53 toolchain is two majors behind; all 8 high advisories are build-time, but the platform is out of support | `package.json:17` | large | confirmed |
| BUG-1 | Low | bug | Export temp files are never released, so every export leaks a full-size PNG into the cache | `src/screens/EditorScreen.js:231` | small | confirmed, severity lowered |
| BUG-2 | Low | privacy | Portrait copies are orphaned once a project falls off the 30-item list | `src/lib/storage.js:59` | small | confirmed, severity lowered |
| BUG-7 | Low | bug | Debounced autosave is cancelled on unmount, so the last edits before closing are discarded | `src/screens/EditorScreen.js:156` | trivial | confirmed |
| BUG-8 | Low | reliability | Persisted project and settings shapes are restored with no validation or migration path | `src/screens/EditorScreen.js:57` | small | confirmed |
| SEC-4 | Low | security | Pro entitlement is a plaintext local flag granted on any resolved purchase promise | `src/lib/pro.js:61` | trivial | confirmed |
| SUP-2 | Low | supply-chain | CI installs Playwright browsers with a version whose downloader skips certificate validation | `.github/workflows/ci.yml:34` | trivial | confirmed |
| CI-1 | Low | ci-cd | Workflow uses floating action tags, declares no permissions block, and has no automated dependency updates | `.github/workflows/ci.yml:12` | trivial | confirmed |
| VER-2 | Low | bug | When the durable copy fails, createProject still persists the picker's cache URI, so a recent portrait can permanently point at a deleted file | `src/lib/storage.js:48` | small | found by second reviewer |
| VER-3 | Low | bug | The entitlement's `ready` flag is never used, so a paying user is treated as free on every cold start | `App.js:20` | trivial | found by second reviewer |
| CI-2 | Info | supply-chain | Caret ranges on native modules let a fresh install drift out of the SDK 53 matrix | `package.json:13` | trivial | confirmed, severity lowered |
| SEC-5 | Info | security | The e2e static server joins the raw request path, so it serves files outside the build directory | `e2e/smoke.mjs:35` | trivial | confirmed, severity lowered |
| SEC-6 | Info | supply-chain | No LICENSE and no SECURITY.md for a repo that ships to app stores | `README.md` | trivial | confirmed |
| VER-4 | Info | hygiene | The bundle output directory the CI and CLAUDE.md both write to is not gitignored | `.gitignore` | trivial | found by second reviewer |

### VER-1 · On iOS every export is rendered at device scale, so a full-resolution photo produces a ~110-megapixel PNG and the 4096px cap is not a cap

**Severity:** High · **Category:** bug · **Effort:** small · **Where:** `src/screens/EditorScreen.js:231`

MAX_EXPORT_DIMENSION exists so 'huge photos don't blow memory' (comment at :178), and exportW/exportH are clamped to 4096 on the long edge. On Android that clamp is honoured - ViewShot resizes the bitmap to exactly width x height. On iOS it is not. RNViewShot reads the width/height options as a CGSize in POINTS and opens the drawing context with `UIGraphicsBeginImageContextWithOptions(size, NO, 0)`, where a scale of 0 means 'use the main screen's scale'. The resulting PNG is therefore width x scale by height x scale PIXELS. For a 12MP iPhone photo (4032x3024) exportScale clamps to 1, so a 3x device renders a 12096x9072 = 109.7 megapixel bitmap: roughly 440 MB for the backing store alone before PNG encoding, on top of the source bitmap. That is an OOM/jetsam-class allocation on most iPhones, and it happens on the app's headline action ('Export · PNG at full resolution'). Even when it survives, the delivered file is 3x the documented cap and 3x more upscaled than BUG-3 accounts for. The turnaround sheet has the same problem: SHEET_SIZE x TURNAROUND_SCALE = 2160x1680 points becomes 6480x5040 pixels. Nothing in the repo can catch this: jest stubs nothing here and the e2e runs the web build, where captureRef has a different implementation entirely.

Evidence:

```
src/screens/EditorScreen.js:178-181  `// Export at the source resolution (capped so huge photos don't blow memory).` / `const exportScale = Math.min(1, MAX_EXPORT_DIMENSION / Math.max(image.width, image.height));` / `const exportW = Math.round(image.width * exportScale);` — with MAX_EXPORT_DIMENSION = 4096 at :35.
src/screens/EditorScreen.js:231  `const uri = await captureRef(ref, { format: 'png', quality: 1, ...size });` where `size` is `photoSize = { width: exportW, height: exportH }` (:273) or `{ width: SHEET_SIZE.width * TURNAROUND_SCALE, height: SHEET_SIZE.height * TURNAROUND_SCALE }` (:606-609).
react-native-view-shot@4.0.3 ios/RNViewShot.mm:71  `CGSize size = [RCTConvert CGSize:options];`  and :112  `UIGraphicsBeginImageContextWithOptions(size, NO, 0);`  — Apple: a scale of 0.0 sets the bitmap scale factor to the device main screen's. The same code path is used under the New Architecture (the file's only RCT_NEW_ARCH_ENABLED block, :195-199, is just the TurboModule shim).
Contrast react-native-view-shot@4.0.3 android/.../ViewShot.java:440  `final Bitmap scaledBitmap = Bitmap.createScaledBitmap(bitmap, width, height, true);` — Android does honour the requested pixel size.
```

**Recommendation.** Divide the requested size by the device scale before handing it to captureRef: `const s = PixelRatio.get(); captureRef(ref, { format: 'png', quality: 1, width: exportW / s, height: exportH / s })`, which makes the iOS output exactly exportW x exportH pixels and leaves Android unchanged only if you branch on Platform.OS (Android takes the option as pixels). Cleanest is a small helper that returns the per-platform option object, with a comment naming RNViewShot.mm:112 as the reason. Verify by exporting a 12MP photo on a 3x device and reading the PNG header - the long edge must be <= MAX_EXPORT_DIMENSION. Do this before BUG-3's 'lay the views out at export size' change, or the two multiply.

### SEC-1 · Save-to-Photos requests full photo-library read access when it only ever writes

**Severity:** Medium · **Category:** privacy · **Effort:** trivial · **Where:** `src/screens/EditorScreen.js:238`

The only thing the app does with expo-media-library is `saveToLibraryAsync` — it never enumerates, reads or deletes assets. But it requests the default (read + write) permission scope. On iOS that triggers the full 'Allow access to all your photos / Limited / Don't allow' authorization backed by NSPhotoLibraryUsageDescription, when the add-only prompt (NSPhotoLibraryAddUsageDescription, already configured at app.json:33) is all the operation needs; on Android 13+ it triggers the READ_MEDIA_IMAGES/READ_MEDIA_VIDEO runtime prompt for a library the app never reads. For an app whose whole pitch is 'your photos stay yours', asking to read the entire camera roll in order to write one PNG is both an unnecessary privacy exposure and the kind of over-ask App Review flags. It also makes the failure mode worse: a user who declines full access cannot save an export at all, even though add-only access would have worked.

Evidence:

```
src/screens/EditorScreen.js:238-243  `const permission = await MediaLibrary.requestPermissionsAsync();` … `await MediaLibrary.saveToLibraryAsync(uri);`  — and the only expo-media-library import in the tree is `import * as MediaLibrary from 'expo-media-library';` (line 13); no read API is used anywhere.
```

**Recommendation.** Change EditorScreen.js:238 to `await MediaLibrary.requestPermissionsAsync(true)` (or cache with `MediaLibrary.usePermissions({ writeOnly: true })`). That alone removes the Android prompt entirely (empty permission array on API 33+) and reduces iOS to add-only. Do NOT follow the `android.blockedPermissions: [READ_MEDIA_VIDEO]` half of the original advice: expo-media-library computes `shouldAddGranularPermissions` only when *every* granular permission it wants is present in the manifest, so blocking one silently falls back to requesting READ_EXTERNAL_STORAGE, which is a no-op on Android 13+ and leaves the check in a worse state. Also be careful with `"photosPermission": false` on the expo-media-library plugin: expo-image-picker (app.json:24-28) sets the same NSPhotoLibraryUsageDescription key and runs first, so a `false` here deletes the string that plugin wrote - only do it if SEC-2 is applied at the same time.

### SEC-2 · Photo import is hard-gated on a library permission the system picker does not need

**Severity:** Medium · **Category:** privacy · **Effort:** trivial · **Where:** `src/screens/HomeScreen.js:74`

`pickFromLibrary` refuses to open the picker unless full media-library permission is granted. Both iOS (PHPickerViewController) and Android 13+ (PickVisualMedia) run the picker out of process and hand back only the single image the user chose, with no library authorization at all — which is strictly better for privacy than the app holding read access to every photo. As written, a privacy-conscious user who declines the prompt is shown 'Permission needed' and can never import a portrait, even though the OS would happily have let them pick one; and a user who accepts has granted the app read access to their entire camera roll for no functional reason. This is the app's primary entry point, so the failure is not recoverable from inside the app.

Evidence:

```
src/screens/HomeScreen.js:74-79
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow photo access to pick a portrait.');
        return;
      }
      await openAsset(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }));
```

**Recommendation.** Same fix (drop the request/gate for the library path, keep requestCameraPermissionsAsync for launchCameraAsync at HomeScreen.js:89), but note that removing `photosPermission` from the expo-image-picker plugin block is only safe once the media-library side is also settled - expo-media-library's plugin writes its own default NSPhotoLibraryUsageDescription unless you pass `photosPermission: false` there too, so removing it from one plugin does not remove it from the build.

### SEC-3 · expo-image-picker's plugin ships a microphone usage string the app never uses

**Severity:** Medium (reported as low, adjusted after review) · **Category:** privacy · **Effort:** trivial · **Where:** `app.json:24`

The expo-image-picker config plugin writes NSPhotoLibraryUsageDescription, NSCameraUsageDescription and NSMicrophoneUsageDescription into Info.plist, filling in its own generic default for any prop that is not supplied. app.json supplies `photosPermission` and `cameraPermission` but not `microphonePermission`, so a build ships a microphone purpose string for an app that only ever calls `launchCameraAsync({ quality: 1 })` on still images. An unused purpose string is a small thing, but it is visible to users in Settings, has to be justified in the App Privacy questionnaire, and is exactly the sort of inconsistency that draws a review question.

Evidence:

```
app.json:24-28 declares only `"photosPermission"` and `"cameraPermission"` for expo-image-picker; src/screens/HomeScreen.js:94 `await openAsset(await ImagePicker.launchCameraAsync({ quality: 1 }));` — no video or audio capture anywhere in the tree.
```

**Recommendation.** Add `"microphonePermission": false` to the expo-image-picker plugin options in app.json. Verify on BOTH platforms after a prebuild, not just iOS: `npx expo prebuild --clean` then check that ios/*/Info.plist has no NSMicrophoneUsageDescription AND that android/app/src/main/AndroidManifest.xml has `android.permission.RECORD_AUDIO` under `tools:node="remove"` rather than as a plain uses-permission.

*Reviewer note (confirmed, severity raised):* The finding is true but materially understated: it is not just an unused iOS purpose string. I read the pinned plugin. Because `microphonePermission` is not supplied in app.json, withImagePicker takes the `microphonePermission !== false` branch and adds `android.permission.RECORD_AUDIO` to the Android manifest as well as writing the default NSMicrophoneUsageDescription. So a shipped Android build of a still-image drawing app declares a dangerous microphone permission: it appears on the Play listing, has to be justified in the Data Safety form, and is exactly the kind of thing that gets an app pulled up in review. The one-character fix (`"microphonePermission": false`) both deletes the plist key and adds RECORD_AUDIO to blockedPermissions, so the cost of fixing is unchanged - only the impact was wrong.

### BUG-3 · Exports are an upscale of a screen-sized rendering, not the photo's own resolution

**Severity:** Medium · **Category:** bug · **Effort:** medium · **Where:** `src/screens/EditorScreen.js:626`

The off-screen views that get captured are laid out at `displayW × displayH` — the size the photo is displayed at inside the editor viewport, typically ~350×450 dp — and `captureRef` is then asked for a `width`/`height` of up to 4096. react-native-view-shot resizes the finished snapshot to that size (on Android literally `Bitmap.createScaledBitmap` over the captured bitmap), so the output is a 3-10x bilinear upscale of a phone-screen rendering. The `<Image>` inside the captured view is never rendered above display size, so the photo in the 'Photo + guide' and 'Tracing layer' exports physically cannot contain more detail than the on-screen preview, whatever number is in the PNG header. This directly contradicts the product claim ('Every export is a PNG at the photo's own resolution', README, and the SVG 'keeps it crisp at export resolution'), and it is the app's headline feature: users drop these layers into a drawing app at full canvas size, where the softness is obvious.

Evidence:

```
src/screens/EditorScreen.js:179-181  `const exportScale = Math.min(1, MAX_EXPORT_DIMENSION / Math.max(image.width, image.height)); const exportW = Math.round(image.width * exportScale); …`
src/screens/EditorScreen.js:626-628  `<View ref={combinedRef} collapsable={false} style={{ width: displayW, height: displayH }}>` / `<Image source={{ uri: image.uri }} style={{ width: displayW, height: displayH }} />`
src/screens/EditorScreen.js:231  `captureRef(ref, { format: 'png', quality: 1, ...size })` with `size = { width: exportW, height: exportH }`.
```

**Recommendation.** Lay the off-screen views out at export size and drop the width/height override, as suggested - but size them in POINTS, not pixels: on iOS captureRef renders into a screen-scale context, so a view laid out at exportW points yields exportW * PixelRatio.get() pixels (see the missed finding VER-1). Use `exportW / PixelRatio.get()` for the layout, or accept the multiplier and lower MAX_EXPORT_DIMENSION accordingly. Mount those views only during an export (BUG-4) - a 4096-point view tree kept alive permanently is not affordable.

### BUG-4 · Off-screen export views re-render at full quality on every gesture frame, defeating draft mode

**Severity:** Medium · **Category:** reliability · **Effort:** medium · **Where:** `src/screens/EditorScreen.js:623`

The draft-sampling optimisation ('Render a lighter wireframe while the head is being dragged') only applies to the on-screen guide: `renderGuides({ draft: interacting })` at line 331. The two off-screen capture views call `renderGuides()` with no draft flag and are mounted permanently, so every `setHeadTransform` from the pan responder — i.e. every touch-move frame — re-runs `buildHeadWireframe` at the full 96 samples twice more and rebuilds hundreds of <Path> nodes that cross the bridge, on top of the draft one. For a Pro user the always-mounted TurnaroundSheet adds six more HeadGuide subtrees to reconcile on any element/proportion/colour change. The net effect is that the work the draft path was written to avoid is done anyway, roughly three times over, which is felt as gesture jank on mid-range Android exactly when responsiveness matters most.

Evidence:

```
src/screens/EditorScreen.js:331  `{renderGuides({ draft: interacting })}`  versus src/screens/EditorScreen.js:628 and :635  `{renderGuides()}` inside `<View style={styles.offscreen} pointerEvents="none">` (line 623), and :649-658 `{pro && (<View ref={turnaroundRef} …><TurnaroundSheet … /></View>)}`.
src/components/HeadGuide.js:32-36  `const samples = draft ? DRAFT_SAMPLES : undefined;` … `useMemo(() => buildHeadWireframe(yaw, pitch, roll, { elements, proportions, samples }), [yaw, pitch, roll, …])`.
```

**Recommendation.** As written. One caveat on the suggested `await new Promise(requestAnimationFrame)`: CLAUDE.md forbids requestAnimationFrame for deadline-bearing timers, and RN does not guarantee layout has flushed after one frame for a freshly mounted subtree. Use `InteractionManager.runAfterInteractions()` plus the `onLayout` of the export container as the signal that it is safe to capture.

### BUG-5 · Android hardware Back exits the app instead of leaving the editor

**Severity:** Medium · **Category:** bug · **Effort:** small · **Where:** `App.js:36`

Navigation is a hand-rolled conditional in App.js with no navigation library and no BackHandler subscription anywhere in the tree. On Android the hardware/gesture Back button therefore falls through to the default handler and closes the app: from the editor it does not return to the portrait list, and from onboarding it does not go to the previous page. Back is the primary navigation affordance on Android, so this is hit within the first minute of use. Because the editor's autosave is debounced (BUG-7), backing out this way can also drop the last edits.

Evidence:

```
App.js:36-56 renders `onboarded === false ? <OnboardingScreen …> : project ? <EditorScreen … onClose={() => setProject(null)} /> : <HomeScreen …>`; a grep for `BackHandler` across src, App.js and index.js returns nothing. Only the paywall handles it, via `<Modal … onRequestClose={() => setPaywall(false)}>` (App.js:58).
```

**Recommendation.** As written. Add one more case the original missed: EditorScreen has an internal mode stack too - when `mode === 'fit'` with taps already collected (src/screens/EditorScreen.js:60, :206-225), back should clear fitTaps and return to 'rotate' before it closes the editor, otherwise a half-finished three-tap fit is silently discarded.

### BUG-6 · iOS-only SafeAreaView combined with edge-to-edge puts the Android UI under the system bars

**Severity:** Medium · **Category:** bug · **Effort:** small · **Where:** `App.js:34`

app.json sets `"edgeToEdgeEnabled": true`, which on Android makes the app draw behind the status bar and the navigation/gesture bar. The root component then relies on React Native's `SafeAreaView`, which is documented as applying only on iOS — on Android it is an ordinary View. So on Android the editor header ('‹ Portraits' / 'Reset', src/screens/EditorScreen.js:308-316) sits under the status bar and the export buttons at the bottom (:578-612) sit under the gesture pill, where they are partly obscured and can be hard or impossible to tap. react-native-safe-area-context is not in the dependency list, so nothing else is compensating. The e2e runs against the web build in a 390x844 viewport, so it cannot catch this.

Evidence:

```
App.js:2  `import { Modal, SafeAreaView, StyleSheet } from 'react-native';`  App.js:34 `<SafeAreaView style={styles.root}>`; app.json:16 `"edgeToEdgeEnabled": true,`; package.json dependencies contain no `react-native-safe-area-context`.
```

**Recommendation.** As written. Install it with `npx expo install react-native-safe-area-context` so the version matches the SDK 53 matrix rather than `npm i` (see CI-2), and remember to remove the now-misleading `SafeAreaView` import from react-native at App.js:2 rather than leaving both in the tree.

### SUP-1 · Expo SDK 53 toolchain is two majors behind; all 8 high advisories are build-time, but the platform is out of support

**Severity:** Medium · **Category:** supply-chain · **Effort:** large · **Where:** `package.json:17`

The audit's 8 high advisories are all in the bundler chain and none of them is reachable from the shipped app: image-size 1.2.1 (ICNS/JXL/HEIF infinite-loop DoS, GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq) is pulled in by metro-transform-worker and only parses image assets during `expo export`; postcss 8.4.49 (sourceMappingURL arbitrary .map read, GHSA-r28c-9q8g-f849) sits under @expo/metro-config for the web build; react-native and @react-native/community-cli-plugin are flagged through metro. None of them ships in the iOS/Android binary, and the inputs they parse are this repo's own committed assets, so the practical exposure is a developer or CI machine bundling attacker-supplied art — not a user. The real issue is the one underneath: SDK 53 is two releases behind (SDK 57 is current and every sibling repo of this owner is on it), so React Native 0.79.6 and the Expo modules no longer receive fixes, the README's 'scan the QR code with Expo Go' instructions no longer work for anyone with a current Expo Go (it supports only the current SDK), and each skipped SDK makes the upgrade harder — SDK 53 to 57 crosses React Native 0.79 to 0.82 and the New Architecture defaults.

Evidence:

```
package.json:17 `"expo": "~53.0.9",` with package-lock.json resolving expo 53.0.27, react-native 0.79.6, metro 0.82.5, image-size 1.2.1, postcss 8.4.49. npm audit metadata: 12 moderate, 8 high, 0 critical across 872 dependencies; every high resolves through metro / @expo/metro-config / @react-native/community-cli-plugin or the Playwright devDependency.
```

**Recommendation.** As written. Two additions: (1) `expo-media-library` gates its granular permissions on an is_expo_go flag (MediaLibraryModule.kt:61-69), so the README's 'scan the QR code with Expo Go' path is already degraded on this SDK independently of version support - the README fix is not cosmetic. (2) When the upgrade happens, re-check BUG-6 first: SDK 54+ makes Android edge-to-edge non-optional, so shipping without react-native-safe-area-context gets worse, not better.

### BUG-1 · Export temp files are never released, so every export leaks a full-size PNG into the cache

**Severity:** Low (reported as medium, adjusted after review) · **Category:** bug · **Effort:** small · **Where:** `src/screens/EditorScreen.js:231`

`captureRef` with the default `result: 'tmpfile'` writes a PNG (up to 4096px on the long edge) into the app's temporary/cache directory and returns its URI. Nothing ever deletes it. The file survives whichever branch the user takes — Save to Photos, Share, Cancel, or dismissing the alert by tapping outside on Android — so the cache grows by one full-resolution PNG per export button press, for the whole life of the install, until the OS decides to reclaim it. A user iterating on a drawing can press these four buttons dozens of times in a session; on iOS the temp directory is not aggressively purged while the app is in use. react-native-view-shot ships an API specifically for this and it is not being called.

Evidence:

```
src/screens/EditorScreen.js:231  `const uri = await captureRef(ref, { format: 'png', quality: 1, ...size });` — `uri` is used at lines 243 and 255 and then goes out of scope; the file has no `import { releaseCapture }` and no `FileSystem.deleteAsync` anywhere in the tree (grep for deleteAsync finds only src/lib/storage.js:76).
```

**Recommendation.** Unchanged in substance - `import { releaseCapture } from 'react-native-view-shot'` and release the uri once each branch of the alert has finished, plus Android's `onDismiss`. Note that on iOS the uri is a bare filesystem path (RCTTempFilePath), not a `file://` URL; releaseCapture handles that, but `FileSystem.deleteAsync(uri)` would need the scheme prepended, so prefer releaseCapture.

*Reviewer note (confirmed, severity lowered):* The code claim is exactly right - captureRef defaults to result:'tmpfile', the returned uri is used at :243 and :255 and then dropped, and there is no releaseCapture import or deleteAsync anywhere outside src/lib/storage.js:76. But the stated impact ('for the whole life of the install, until the OS decides to reclaim it') does not hold on Android: react-native-view-shot's own module deletes every ReactNative-snapshot-image* file from the internal and external cache dirs when the React context is invalidated, i.e. on app shutdown or a JS reload. So the Android leak is bounded to a single session. On iOS there is no equivalent sweep (RNViewShot.mm only deletes on an explicit releaseCapture), so files sit in NSTemporaryDirectory until iOS reclaims it - a directory the OS is explicitly allowed to purge and which is excluded from backups. Real hygiene bug, worth the two-line fix, but not medium.

### BUG-2 · Portrait copies are orphaned once a project falls off the 30-item list

**Severity:** Low (reported as medium, adjusted after review) · **Category:** privacy · **Effort:** small · **Where:** `src/lib/storage.js:59`

`createProject` copies every picked photo into documentDirectory/portraits/ and then truncates the index to 30 entries. The truncation drops the *record* but never deletes the *file*, and only the explicit long-press delete path removes anything from disk. So the 31st import silently orphans the oldest photo: a full-resolution copy of someone's portrait stays in the app's documents directory forever, unreachable from the UI and invisible to the user. On iOS documentDirectory is included in iCloud device backups by default and on Android in Auto Backup, so these orphaned copies of people's faces are also being uploaded to the user's cloud account with no way to clear them short of deleting the app. It is also an unbounded disk leak — a heavy user accumulates hundreds of megabytes of unreferenced JPEGs.

Evidence:

```
src/lib/storage.js:58-59
  const projects = await listProjects();
  await writeIndex([project, ...projects].slice(0, 30));
— compare src/lib/storage.js:72-78, where deleteProject is the only code that ever calls FileSystem.deleteAsync.
```

**Recommendation.** As written (delete the truncated tail, plus a startup reconcile of PORTRAIT_DIR against the index). Skip the 'move to cacheDirectory' suggestion: the file header at src/lib/storage.js:10-14 explains that documentDirectory was chosen precisely because the OS may clear the cache, and moving there would reintroduce the broken-thumbnail failure this design avoids.

*Reviewer note (confirmed, severity lowered):* The mechanism is real and the code reads exactly as quoted: the 31st import drops the oldest record from the index without touching the copied file, and deleteProject (:72-79) is the only caller of FileSystem.deleteAsync. But the severity is over-calibrated for this app's threat model. The orphans are copies of the user's own photos, in the user's own app container, on the user's own device; the originals are already in the photo library and already in the same iCloud/Auto Backup the finding cites, so no new party gains access and no new data leaves the device. What is actually left is an unbounded, user-invisible disk leak that only starts after 30 imports and is cleared by deleting the app. That is a low-severity storage-hygiene bug, not a medium privacy one - the fix and the effort estimate are both right.

### BUG-7 · Debounced autosave is cancelled on unmount, so the last edits before closing are discarded

**Severity:** Low · **Category:** bug · **Effort:** trivial · **Where:** `src/screens/EditorScreen.js:156`

Editor settings are persisted by a 600 ms debounce whose cleanup clears the pending timer. Leaving the editor unmounts the component, so any change made within 600 ms of tapping '‹ Portraits' (or of Android Back, once BUG-5 is fixed) is thrown away rather than flushed. Adjusting a slider or tapping Reset and immediately closing is a natural thing to do, and the app's promise is 'Pick up where you left off' — the user comes back to a state that silently differs from what they left.

Evidence:

```
src/screens/EditorScreen.js:156-161
  useEffect(() => {
    const id = setTimeout(() => {
      saveSettings(project.id, settings).catch(() => {});
    }, 600);
    return () => clearTimeout(id);
  }, [project.id, settings]);
```

**Recommendation.** As written (ref + mount-scoped unmount flush). Note the flush must not re-run on every `settings` change or it will write on each render pass - keep the dependency array as `[project.id]` exactly as suggested, and be aware `saveSettings` does a read-modify-write of the whole 30-item index (src/lib/storage.js:64-71), so an unmount flush racing a pending debounce can interleave; guard by clearing the timer id in the same effect.

### BUG-8 · Persisted project and settings shapes are restored with no validation or migration path

**Severity:** Low · **Category:** reliability · **Effort:** small · **Where:** `src/screens/EditorScreen.js:57`

`listProjects` checks only `Array.isArray`, and the editor restores stored settings straight into state with `??`, which guards null/undefined but not a partial or wrong-shaped object. A record written by an older or newer build — or a partially-written index — propagates: a project without `image` crashes the home screen at `project.image.uri`; a `headTransform` missing `scale` makes `ppu` NaN and produces path data full of 'NaN'; a `proportions` missing `browY` reaches `SliderRow`'s `format` as `undefined.toFixed(2)` and throws. Nothing versions or migrates these blobs beyond the '.v1' key suffix, so the first schema change ships a crash to existing users with no recovery path inside the app.

Evidence:

```
src/lib/storage.js:28-30  `const projects = raw ? JSON.parse(raw) : []; return Array.isArray(projects) ? projects : [];`
src/screens/EditorScreen.js:57-58  `const [showHead, setShowHead] = useState(saved.showHead ?? true);` / `const [headTransform, setHeadTransform] = useState(saved.headTransform ?? DEFAULT_HEAD);`
src/screens/HomeScreen.js:145  `<Image source={{ uri: project.image.uri }} style={styles.thumbImage} />`
```

**Recommendation.** As written. Add one concrete pin the original left implicit: the sanitizer must also accept the legitimately-`null` case, since src/lib/storage.js:56 writes `settings: null` for every freshly created project - a sanitizer that requires an object there will break every new import.

### SEC-4 · Pro entitlement is a plaintext local flag granted on any resolved purchase promise

**Severity:** Low · **Category:** security · **Effort:** trivial · **Where:** `src/lib/pro.js:61`

Two separate points. (a) The entitlement is `{"pro":true}` in AsyncStorage with no receipt, signature or server check, so on a rooted/jailbroken device, from an unencrypted backup, or trivially via localStorage in the web build, it can be flipped. For a $7.99 one-time cosmetic unlock with no server and no consumables this is a defensible trade — a backend would be a much bigger change than the loss it prevents — and it is worth stating explicitly rather than leaving implied. (b) The more actionable half is the seam contract: `purchase()` grants as soon as `purchases.purchase(productId)` *resolves*, without inspecting what it resolved to. Real store SDKs (StoreKit 2, Play Billing, RevenueCat) commonly resolve with a result object carrying `userCancelled: true`, or a pending/deferred transaction, instead of rejecting. Whoever wires billing in — the README explicitly invites them to, and says 'every gate already works' — inherits an unlock-on-cancel bug unless they notice this line.

Evidence:

```
src/lib/pro.js:61-68
  const purchase = useCallback(
    async (productId) => {
      const result = await purchases.purchase(productId);
      await grant();
      return result;
    },
    [grant]
  );
src/lib/pro.js:36-38  `async function write(entitlements) { await AsyncStorage.setItem(KEY, JSON.stringify(entitlements)); }`
```

**Recommendation.** As written - make purchase() grant only on `result?.pro`, matching restore(), and document the contract in src/lib/purchases.js above the NotConfiguredProvider so the next implementer sees it. src/lib/pro.js:40-43 already carries a comment claiming both calls 'only grant on a resolved transaction'; fix that comment at the same time, since it currently describes behaviour the code does not have.

### SUP-2 · CI installs Playwright browsers with a version whose downloader skips certificate validation

**Severity:** Low · **Category:** supply-chain · **Effort:** trivial · **Where:** `.github/workflows/ci.yml:34`

playwright 1.49.1 is subject to GHSA-7mvr-c777-76hp: the browser downloader does not verify the authenticity of the TLS certificate when fetching browser builds. The e2e job runs `npx playwright install --with-deps chromium` on every push and pull request, so a network position between the runner and the CDN could substitute a Chromium binary that then executes on the runner. GitHub-hosted runners make that unlikely, the job holds no secrets, and the workflow declares no write permissions — but this is the one place in the repo where remote code is fetched and executed, and the fix is a version bump of a devDependency with no API change.

Evidence:

```
.github/workflows/ci.yml:34  `- run: npx playwright install --with-deps chromium`; package.json devDependencies `"playwright": "^1.49.1"` with package-lock.json pinning 1.49.1 (advisory range <1.55.1).
```

**Recommendation.** As written. Since the caret range `^1.49.1` already permits 1.55.1+, the whole fix is `npm i -D playwright@latest` to refresh the lockfile - no package.json edit needed.

### CI-1 · Workflow uses floating action tags, declares no permissions block, and has no automated dependency updates

**Severity:** Low · **Category:** ci-cd · **Effort:** trivial · **Where:** `.github/workflows/ci.yml:12`

All four action references are floating major tags (`actions/checkout@v4`, `actions/setup-node@v4`, twice each), so a compromise or a bad release of either action executes in this repo's CI without any change here; 0 of 4 are pinned to a commit SHA. The workflow also declares no `permissions:` block, so both jobs get whatever the repository/organisation default is for GITHUB_TOKEN — which for older repositories is read/write on contents, far more than a test-and-bundle job needs. There is no Dependabot configuration, so nothing tells you when the SDK 53 chain in SUP-1 gains a new advisory. Impact is bounded (no secrets are used and nothing is published from CI), which is why this is low rather than higher.

Evidence:

```
.github/workflows/ci.yml:12-13 and :28-29  `- uses: actions/checkout@v4` / `- uses: actions/setup-node@v4`; the file contains no `permissions:` key at any level; no .github/dependabot.yml exists (the only file under .github is workflows/ci.yml).
```

**Recommendation.** As written. The `node-version: 22` suggestion is worth doing now rather than at upgrade time - Expo SDK 53 already supports Node 22, and matching the sibling repos removes one variable from the SDK upgrade in SUP-1.

### VER-2 · When the durable copy fails, createProject still persists the picker's cache URI, so a recent portrait can permanently point at a deleted file

**Severity:** Low · **Category:** bug · **Effort:** small · **Where:** `src/lib/storage.js:48`

The file's own header explains the design: 'The picker hands back a URI in the app's cache, which the OS is free to clear, so the image is copied into the documents directory on import and the project references that durable copy.' But when the copy throws, the catch falls back to `uri = asset.uri` with the comment 'the project still works this session' - and then the project is written to the persistent index anyway, at :59. So a transient copy failure (out of disk, an unreadable content:// provider, a permission revoked between pick and copy) produces a permanent index entry pointing into the cache. Once the OS clears it, the Recent thumbnail on the home screen renders blank forever and reopening the project gives an editor with guides over nothing; there is no repair path except long-press-remove, and deleteProject's PORTRAIT_DIR guard (:75) means the stale entry is removed from the index but nothing is cleaned up. The failure is silent - the catch swallows the error and the user is never told the import was degraded.

Evidence:

```
src/lib/storage.js:40-50
  let uri = asset.uri;
  try {
    await ensureDir();
    const dest = `${PORTRAIT_DIR}${id}.${portraitExtension(asset.uri)}`;
    await FileSystem.copyAsync({ from: asset.uri, to: dest });
    uri = dest;
  } catch {
    // Fall back to the original URI; the project still works this session.
  }
src/lib/storage.js:52-59  `const project = { id, updatedAt: Date.now(), image: { uri, width: asset.width, height: asset.height }, settings: null };` / `await writeIndex([project, ...projects].slice(0, 30));`
src/lib/storage.js:9-16 (header comment) — the invariant the fallback breaks.
```

**Recommendation.** Make the fallback honest about its own comment: keep using the cache URI for this session, but do not write the project into the durable index when the copy failed - return it with a flag (e.g. `ephemeral: true`) that createProject checks before calling writeIndex, and surface a one-line Alert so the user knows the portrait will not be in Recent. src/lib/storage.js has no tests at all; this is pure enough to cover in src/lib/__tests__ alongside filenames.test.js with a stubbed FileSystem.

### VER-3 · The entitlement's `ready` flag is never used, so a paying user is treated as free on every cold start

**Severity:** Low · **Category:** bug · **Effort:** trivial · **Where:** `App.js:20`

useEntitlements deliberately exposes `ready` to distinguish 'not Pro' from 'not loaded yet' - `pro` is initialised to false and only becomes true after the AsyncStorage read resolves. App.js destructures `{ pro, purchase, restore }` and drops `ready`, then renders the whole app immediately. So on every launch there is a window in which a Pro user is rendered as a free user: EditorScreen's activeElements filter strips every `el.pro` construction line out of the guide (:104-107), the turnaround button shows the locked '✦' label (:600) and tapping it opens the paywall, the Pro proportion presets are locked, and the off-screen turnaround view is not mounted. If the project was restored from the index with pro elements enabled, the guide visibly loses lines and then gains them back. It also races the first render of HomeScreen, which shows the 'Unlock Pro' footer link to someone who already paid (:157). The fix is the reason `ready` exists.

Evidence:

```
src/lib/pro.js:44-53  `const [pro, setPro] = useState(false); const [ready, setReady] = useState(false); useEffect(() => { read().then((e) => { setPro(!!e.pro); setReady(true); }); }, []);` and :76 `return { pro, ready, purchase, restore };`
App.js:20  `const { pro, purchase, restore } = useEntitlements();` — `ready` is discarded; `grep -rn "ready" App.js src/screens` returns only the unrelated `const ready = viewport && displayW > 0 && displayH > 0;` in EditorScreen.
src/screens/EditorScreen.js:104-107  `if (pro) return chosen; const free = {}; for (const el of ELEMENTS) if (!el.pro && chosen[el.key]) free[el.key] = true; return free;`
src/screens/HomeScreen.js:157  `{!pro && (` — the Unlock Pro footer.
```

**Recommendation.** Take `ready` from useEntitlements and hold the tree back until both it and the onboarding read have settled - App.js already has the pattern at :36 (`onboarded === null ? null : ...`), so extend that guard to `onboarded === null || !ready ? null : ...`. That keeps a single splash frame instead of a visible downgrade-then-upgrade, and removes the window in which a paying customer can be shown the paywall.

### CI-2 · Caret ranges on native modules let a fresh install drift out of the SDK 53 matrix

**Severity:** Info (reported as low, adjusted after review) · **Category:** supply-chain · **Effort:** trivial · **Where:** `package.json:13`

The Expo-managed dependencies mostly use the tilde ranges `expo install` writes (`~53.0.9`, `~18.1.11`, `~16.1.4`), but five entries use carets: `@react-native-async-storage/async-storage ^2.1.2`, `react-native-svg ^15.11.2`, `expo-splash-screen ^0.30.10`, `react-dom ^19.0.0` and `react-native-web ^0.20.0`. CI is protected by `npm ci` against the lockfile, but the README tells a contributor to run plain `npm install`, which can resolve a minor version of a native module that was never tested against SDK 53 / React Native 0.79 — the classic source of a build that compiles in CI and fails on a device, and it is hard to diagnose because the lockfile still looks fine.

Evidence:

```
package.json:13-28  `"@react-native-async-storage/async-storage": "^2.1.2",` … `"expo-splash-screen": "^0.30.10",` … `"react-native-svg": "^15.11.2",` … `"react-native-web": "^0.20.0"` alongside `"expo-file-system": "~18.1.11"` and `"expo-image-picker": "~16.1.4"`.
```

**Recommendation.** Still worth running `npx expo install --check` (and `--fix`) as SDK hygiene, but drop the 'npm install drifts' justification - it does not, because the lockfile is committed. Frame it instead as: keep package.json ranges consistent with the SDK's bundledNativeModules manifest so that a lockfile regeneration, a `npm update`, or the SDK upgrade in SUP-1 lands on tested versions.

*Reviewer note (confirmed, severity lowered):* The observation is factually right - five dependencies use caret ranges where `expo install` would have written tildes - but the stated mechanism of harm is wrong, which is what drops this to info. package-lock.json is committed (it is in `git ls-files`), and `npm install` against a committed lockfile installs the locked versions; it only re-resolves when a range in package.json can no longer be satisfied by the lock, which is not the case here. So the README's `npm install` (README.md:83) is deterministic today and a contributor cannot silently drift onto an untested react-native-svg. The real (small) exposure is narrower: anyone who regenerates or deletes the lockfile, or runs `npm update`, can drift. Also note the cited line is wrong - package.json:13 is `"build:web"`; the caret entries are at :18, :25, :28, :30 and :32.

### SEC-5 · The e2e static server joins the raw request path, so it serves files outside the build directory

**Severity:** Info (reported as low, adjusted after review) · **Category:** security · **Effort:** trivial · **Where:** `e2e/smoke.mjs:35`

The smoke test's throwaway server builds a filesystem path by joining the decoded request path onto the build directory with no normalisation or containment check, so `GET /../../etc/passwd` (Node does not resolve `..` out of req.url) resolves outside `.web-build` and is streamed back with a 200. It is bound to 127.0.0.1 on an ephemeral port, lives only for the duration of `npm run e2e`, and serves a machine that already has the files — so the real-world impact is close to nil. It is worth fixing because it is the one path-handling bug in the repo and because the same three lines tend to get copied into a `npm start`-style server later, where it would matter.

Evidence:

```
e2e/smoke.mjs:34-39
const server = createServer((req, res) => {
  const path = join(BUILD, decodeURIComponent(req.url.split('?')[0]));
  const file = existsSync(path) && statSync(path).isFile() ? path : join(BUILD, 'index.html');
```

**Recommendation.** As written (resolve + containment check + try/catch), with one import correction the original omits: `resolve` and `sep` are not currently imported - line 16 is `import { dirname, extname, join } from 'node:path';`, so the fix needs `resolve` and `sep` added there. Also note the local `const path = ...` shadows nothing today but will collide if `node:path` is ever imported as a namespace; rename it while you are in the file.

*Reviewer note (confirmed, severity lowered):* The code defect is real and I verified the mechanism the auditor slightly mis-stated: req.url is delivered raw (a browser normalises, but curl --path-as-is or a raw socket does not), and it is `path.join` that then resolves the `..` segments out of BUILD - so `GET /../../etc/passwd` does escape the build directory and is streamed with a 200. The URIError point is also correct: decodeURIComponent('%') throws synchronously inside the request listener, which is an uncaught exception that kills the process mid-run. But there is no privilege boundary here at all: the server binds 127.0.0.1 on an ephemeral port (`server.listen(0, '127.0.0.1', ...)`), exists only for the duration of `npm run e2e`, and serves a machine on which any process that could reach it could already read the same files directly. Low overstates it; this is a code-hygiene note, worth fixing exactly because these three lines get copy-pasted into a real server later.

### SEC-6 · No LICENSE and no SECURITY.md for a repo that ships to app stores

**Severity:** Info · **Category:** supply-chain · **Effort:** trivial · **Where:** `README.md`

The repository has no LICENSE file, so it is 'all rights reserved' by default — which is fine if that is intended, but it is undeclared, and the README reads like an open project (it documents how to run, test and extend it, and invites someone to wire up billing). There is also no SECURITY.md, so anyone who finds a problem in a published app has no stated way to report it privately. Neither is a vulnerability; both are the standard paperwork for a repo whose artefact is a store-distributed app handling people's photos.

Evidence:

```
`git ls-files` lists 40 files with no LICENSE, no SECURITY.md, no PRIVACY.md and no CODEOWNERS; README.md documents public build and contribution workflows ('## Running it', '## Development', '## Building standalone apps').
```

**Recommendation.** As written.

### VER-4 · The bundle output directory the CI and CLAUDE.md both write to is not gitignored

**Severity:** Info · **Category:** hygiene · **Effort:** trivial · **Where:** `.gitignore`

.gitignore covers dist/, web-build/ and .web-build/ (the e2e output), but not .export-check/ - which is exactly the directory the CI bundle step and the workflow documented in CLAUDE.md write to. A developer following the documented pre-push check (`npx expo export --platform ios --platform android --output-dir .export-check`) is left with an untracked directory containing the full JS bundle and a copy of every asset sitting in `git status`, ready to be swept into a commit by `git add -A`. It is small, but it is the one gap in an otherwise complete ignore file, and committing a bundle is annoying to undo.

Evidence:

```
.gitignore contains `dist/`, `web-build/` and (with the comment `# web build used by the e2e smoke test`) `.web-build/`, but no `.export-check` entry.
.github/workflows/ci.yml:19-20  `      - name: Bundle for iOS and Android` / `        run: npx expo export --platform ios --platform android --output-dir .export-check`
CLAUDE.md (Commands): `npx expo export --platform ios --platform android --output-dir .export-check`
```

**Recommendation.** Add `.export-check/` to .gitignore next to the existing `.web-build/` entry, with the same style of comment.

## Upgrades

| Value | Effort | Upgrade | Now | Move to |
|---|---|---|---|---|
| high | large | Expo SDK 53 to 57 — the migration, one SDK at a time | expo ~53.0.9, react-native 0.79.6, react 19.0.0, react-dom ^19.0.0, react-native-web ^0.20.0, jest-expo ~53.0.0 | expo ~57.0.21, react-native 0.86.3, react 19.2.3, jest-expo ~57.0.5 — matching multidconnect4/multidcheckers/chesscheatser exactly. Do it as four hops (53→54→55→56→57), and after each: `npx expo install --fix`, `npx expo-doctor`, `npm test`, `npx expo export --platform ios --platform android`, `npm run e2e`. Commit each hop separately so a regression is bisectable. The distinct pieces of work, in order: (a) SDK 54 — Node floor rises to >=20.19.4 and expo-file-system ships a new File/Directory/Paths API with the old one moved to the `expo-file-system/legacy` subpath, so src/lib/storage.js must either switch its import to `expo-file-system/legacy` as a one-line stopgap or be rewritten against the new API; Android edge-to-edge becomes unconditional (the `edgeToEdgeEnabled` flag in app.json is then redundant). (b) SDK 55+ is new-architecture only — app.json already has `newArchEnabled: true`, which removes most of the usual risk here, but every native dependency must have a Fabric/TurboModule build. (c) react-native-view-shot 4.0.3 -> 5.1.1: 5.x is the first release with a `codegenConfig` TurboModule spec (peer react-native >=0.76, engines node >=20.19.4); this is the single highest-risk dependency because the whole export feature rides on captureRef. (d) @react-native-async-storage/async-storage ^2.1.2 -> 3.x (major). (e) react-native-svg ^15.11.2 -> ~15.15.x. (f) @expo/metro-runtime ~5.0.5 -> ~57.0.x, and every expo-* module to ~57.x (Expo unified module versions to the SDK number from SDK 54 on: expo-file-system 57.x, expo-image-picker 57.x, expo-media-library 57.x, expo-sharing 57.x, expo-haptics 57.x, expo-splash-screen 57.x, expo-status-bar 57.x). (g) Xcode/Android toolchain floors move with the SDK, so regenerate any EAS build profile. |
| high | small | App.js uses react-native's SafeAreaView, which does nothing on Android edge-to-edge | `import { Modal, SafeAreaView, StyleSheet } from 'react-native'` wrapping the whole app; app.json sets `android.edgeToEdgeEnabled: true`; react-native-safe-area-context is not a dependency at all | Add react-native-safe-area-context (`npx expo install react-native-safe-area-context`), wrap the tree in `<SafeAreaProvider>` and replace the root with its `SafeAreaView`, or use `useSafeAreaInsets()` for the EditorScreen header/controls padding specifically |
| high | medium | No TypeScript — the only JavaScript repo in the portfolio | Plain .js throughout, no tsconfig.json, no `typecheck` script; siblings all ship tsconfig.json + `npm run typecheck` in CI with @types/react and typescript in devDependencies | Add typescript + @types/react (+ @types/jest), a tsconfig.json extending expo/tsconfig.base with `strict: true`, an `npm run typecheck` script, and migrate incrementally: src/lib/* first (headModel.js, fitSolver.js, filenames.js are pure and have the richest types — Vec3, Mat3, Curve, Wireframe, HeadTransform, Proportions), then components. `allowJs: true` lets this land file by file. |
| high | trivial | CI runs on Node 20, which is past end of life | Both jobs in .github/workflows/ci.yml pin `node-version: 20`; no .nvmrc, no `engines` field in package.json | Move both jobs to Node 22 (what chesscheatser, multidconnect4 and multidcheckers all use), add `"engines": { "node": ">=22" }` to package.json and a .nvmrc so local and CI agree |
| high | medium | Text colours fail WCAG AA contrast, and the app is light-mode only | `colors.graphiteFaint` #9c9285 on `colors.paper` #f4efe6 measures 2.67:1 and is used for 10-12px text everywhere (SectionLabel, slider values, recents label and hint, Skip, the paywall fine print). `colors.accent` #b4543a on paper is 4.29:1 and carries the 'Unlock Pro' link plus the paper-on-accent primary button text at 15px bold. `colors.graphiteSoft` on `paperDeep` is 4.43:1 for chip labels. All below the 4.5:1 AA floor for normal text. app.json pins `userInterfaceStyle: "light"`. | Darken graphiteFaint and accent to reach 4.5:1, add a src/lib/__tests__/palette.test.js modelled on tvsham's, then split colors into light/dark palettes behind a `useTheme()` and drop the forced `userInterfaceStyle` |
| medium | small | No linter or formatter at all | No eslint dependency, no .eslintrc / eslint.config.js, no prettier, no `lint` script; CI has no lint step | `npx expo lint` sets up eslint-config-expo; add `npm run lint` and wire it into CI alongside typecheck. Add rules that matter here: react-hooks/exhaustive-deps (EditorScreen has several hand-tuned effect dep arrays), no-unused-vars (would have flagged `ready` from useEntitlements and the dead `taper` prop path), and import ordering. |
| medium | trivial | GitHub Actions unpinned and workflow has no permissions block | 4 action uses (actions/checkout@v4 and actions/setup-node@v4 in each of two jobs), all floating on the major tag; no top-level `permissions:` in ci.yml | Pin each `uses:` to a full commit SHA with the version in a trailing comment, and add `permissions: { contents: read }` at the top of the workflow (each job here only reads the repo) |
| medium | trivial | No Dependabot or Renovate — nothing tells you a CVE landed | No .github/dependabot.yml; the 8 HIGH advisories accumulated silently across 15 commits | Add .github/dependabot.yml with a weekly `npm` ecosystem entry and a `github-actions` entry (the latter keeps the SHA pins above fresh). Group Expo SDK packages into one PR so they move together rather than one at a time, which would otherwise break the Expo version alignment. |
| medium | small | CI never runs an audit, a lint, a typecheck, or checks the lockfile is current | The test job runs `npx jest --ci`, an iOS+Android export and `npm run icons:check`; the e2e job runs the browser smoke test. That is all. | Add `npm audit --audit-level=high` (advisory or blocking), plus `npm run lint` and `npm run typecheck` once those exist. Cache the Playwright browser download (actions/cache keyed on the playwright version) — the e2e job currently re-downloads Chromium with `--with-deps` on every push. Also switch `npx jest --ci` to `npm test -- --ci` so the script stays the single source of truth. |
| medium | small | No eas.json, though the README documents `eas build` | README 'Building standalone apps' says to run `eas build --platform ios\|android`; there is no eas.json in the repo. chesscheatser, multidconnect4 and multidcheckers all have one. | Add eas.json with the same shape as chesscheatser's (`cli.version >= 16`, `appVersionSource: remote`, development / preview(apk) / production(autoIncrement) profiles and a submit block). Add `scheme: "drawdraw"` to app.json — required for a development client and for any deep link — and decide on expo-updates for OTA (add `runtimeVersion: { policy: "appVersion" }` if you adopt it). |
| medium | trivial | No LICENSE, SECURITY.md, CHANGELOG or PRIVACY policy | Repo has README.md and CLAUDE.md only. chesscheatser — the closest sibling in maturity — ships LICENSE, PRIVACY.md and CHANGELOG.md. | Add a LICENSE (the app is `"private": true` but the repo is public-shaped and headModel.js/fitSolver.js are genuinely reusable), a short SECURITY.md pointing at a contact, a CHANGELOG.md, and a PRIVACY.md. The privacy story is unusually strong and worth stating plainly: photos never leave the device, there is no network call anywhere in src/, no analytics, no ads. |
| medium | small | app.json is missing several store-readiness and Android-modernity fields | No `scheme`; no `ios.infoPlist.ITSAppUsesNonExemptEncryption`; no `android.predictiveBackGestureEnabled`; adaptiveIcon has a foreground but no `monochromeImage`; `userInterfaceStyle: "light"` forces light mode; `android.edgeToEdgeEnabled` becomes a no-op from SDK 54 | Add `scheme`, `ios.infoPlist.ITSAppUsesNonExemptEncryption: false`, `android.predictiveBackGestureEnabled: false` (what both multid* siblings set) and a `monochromeImage` for Android 13+ themed icons — tools/make-icons.mjs already generates a transparent single-colour mark, so a monochrome output is a fifth entry in its OUTPUTS array. Drop `edgeToEdgeEnabled` after the SDK bump. |
| medium | small | Accessibility gaps outside src/components/ui.js | Chip, PrimaryButton and Slider are properly labelled (roles, states, adjustable slider with increment/decrement actions) — but nothing else is. HomeScreen's 'Choose a portrait' / 'Take a photo' / recents thumbnails / footer links, PaywallScreen's Close / buy / restore, EditorScreen's header actions and colour swatches, and OnboardingScreen's pages all use bare Pressables with no accessibilityRole or accessibilityLabel. The colour swatches are especially bad: GUIDE_COLORS carries a human name for every colour ('Sanguine', 'Graphite', 'Chalk'…) and none of it reaches the accessibility tree. The recents 'hold to remove' delete is long-press only with no accessibilityAction alternative. The step-by-step auto-play runs a 1.1s setInterval with no AccessibilityInfo.isReduceMotionEnabled check. | Add accessibilityRole="button" + accessibilityLabel to every remaining Pressable; label swatches from `c.name`; expose delete as an accessibilityAction on the thumbnail; gate auto-play on reduced motion; give each onboarding page an accessible name. All font sizes are fixed numbers, so also consider `allowFontScaling` behaviour under large Dynamic Type. |
| medium | trivial | Photo-library permission asks for full access when write-only would do | EditorScreen calls `MediaLibrary.requestPermissionsAsync()` with no argument before `saveToLibraryAsync` | `MediaLibrary.requestPermissionsAsync(true)` — the writeOnly form — since the app only ever saves and never reads the library |
| medium | trivial | Splash screen is never held, so first launch flashes an empty paper screen | expo-splash-screen is a dependency and configured as a plugin in app.json, but is never imported. App.js renders `null` while the onboarded flag loads from AsyncStorage. | Call `SplashScreen.preventAutoHideAsync()` at module scope in App.js and `SplashScreen.hideAsync()` once both the onboarded flag and `useEntitlements().ready` have resolved |
| medium | small | No error boundary and no opt-in error reporting | Nothing catches a render-time throw; a bad restored settings object or a NaN transform white-screens the app with no way back | Add a small ErrorBoundary around the screen switch in App.js that offers 'Back to portraits' and clears the offending project's saved settings. If any telemetry is ever added, keep it opt-in and behind a settings toggle — but the boundary is worth having with no telemetry at all. |
| low | medium | PanResponder for all three gesture surfaces | HeadGestureLayer, DraggableGuide and Slider each build their own PanResponder and drive React state on every touch move; HeadGuide compensates with a coarse 'draft' sampling mode | After the SDK upgrade, consider react-native-gesture-handler + react-native-reanimated (both are Expo-supported and already in the SDK's version matrix) so pan/pinch/rotate run on the UI thread. Reanimated cannot drive the SVG geometry itself — the wireframe genuinely has to be rebuilt in JS — but it can own the pan/pinch/rotate state and commit to React state only on gesture end, which is what actually costs frames. |
| low | medium | All UI strings are hardcoded English | Every label, prompt and Alert string is inline; FIT_STEPS prompts, PRO_FEATURES/FREE_FEATURES and the onboarding copy are the largest blocks | Extract to a src/lib/strings.js keyed map first (a mechanical change that costs nothing and makes the surface visible), then adopt expo-localization + a small lookup if a second locale is ever wanted |

- **Expo SDK 53 to 57 — the migration, one SDK at a time** (high value, large, `/home/user/drawdraw/package.json`). This is the only repo left on SDK 53 and it is where every one of the 20 npm advisories lives. npm audit names the fixes directly: expo@57.0.21 clears the @expo/cli / @expo/config-plugins / @expo/metro-config / postcss (HIGH, 4 CVEs incl. arbitrary .map file disclosure) / uuid / xcode chain; react-native@0.86.3 clears metro, metro-config, metro-transform-worker and image-size (HIGH — ICNS/JXL/HEIF parsers loop forever on crafted input, and this app feeds user-chosen photos through the bundler's image tooling in dev); jest-expo@57.0.5 and expo-splash-screen@57.0.8 clear the rest. Beyond security: SDK 53 is several releases past Expo Go support, so the README's `npx expo start` + Expo Go instructions no longer work for a new contributor, and staying behind makes every future dependency bump a bigger cliff.
- **App.js uses react-native's SafeAreaView, which does nothing on Android edge-to-edge** (high value, small, `/home/user/drawdraw/App.js`). React Native's own SafeAreaView is an iOS-only shim — it is a plain View on Android. With edge-to-edge already enabled (and unconditional from SDK 54 on, since Android 15 forces it for targetSdk 35+), the EditorScreen header row ('‹ Portraits' / 'Three-segment head' / 'Reset') renders under the status bar and the export buttons under the gesture bar on Android today. This is a live layout bug, not just a migration chore, and it gets worse rather than better after the SDK upgrade.
- **No TypeScript — the only JavaScript repo in the portfolio** (high value, medium, `/home/user/drawdraw/src/lib/headModel.js`). The geometry and solver traffic in structurally identical but semantically different shapes — [x,y,z] model tuples vs {x,y} projected points vs {x,y,z,visible} tagged points vs {yaw,pitch,roll,x,y,scale} transforms — and nothing but a comment distinguishes them. `projectLandmarks` returns {x,y} while `projectCurve` returns {x,y,z,visible}; `buildHeadWireframe`'s options bag is documented in prose only. A HeadTransform type would also have caught the settings-restore path in EditorScreen, where anything at all can come out of AsyncStorage into `saved.headTransform ?? DEFAULT_HEAD`. It is also the last thing standing between this repo and the portfolio's shared conventions.
- **CI runs on Node 20, which is past end of life** (high value, trivial, `/home/user/drawdraw/.github/workflows/ci.yml`). Node 20 left maintenance in April 2026 and no longer receives security patches. Expo SDK 54+ requires >=20.19.4 and react-native-view-shot 5.x declares `engines.node >= 20.19.4`, so the bare `20` label in setup-node is not even guaranteed to satisfy the toolchain after the upgrade. Nothing else in the portfolio is still on 20.
- **Text colours fail WCAG AA contrast, and the app is light-mode only** (high value, medium, `/home/user/drawdraw/src/theme.js`). tvsham already has exactly the right pattern for this — `palette.test.ts` asserts every text pairing in both schemes against WCAG AA, and its CLAUDE.md makes keeping it green a hard rule. The same test over src/theme.js would fail today. Darkening graphiteFaint to about #7c7367 and accent to about #9d4630 clears AA without changing the sketchbook feel. Adding a dark scheme is the larger half of the work but is what every sibling app does.
- **No linter or formatter at all** (medium value, small, `/home/user/drawdraw/package.json`). tvsham runs eslint; this repo runs nothing. The two real findings a linter would already have surfaced — an unused destructured value that hides a Pro-flicker bug, and a component prop with no caller — are listed separately below.
- **GitHub Actions unpinned and workflow has no permissions block** (medium value, trivial, `/home/user/drawdraw/.github/workflows/ci.yml`). A floating major tag is mutable — a compromised or force-pushed tag runs arbitrary code with whatever token the job holds. Without an explicit permissions block the job gets the repository default, which on many repos is still write. Both are one-line fixes and apply identically to every repo in the portfolio.
- **No Dependabot or Renovate — nothing tells you a CVE landed** (medium value, trivial, `/home/user/drawdraw/.github/workflows/ci.yml`). This is exactly how the repo got 20 advisories behind. The github-actions ecosystem entry is the piece that makes SHA-pinning maintainable rather than a one-off.
- **CI never runs an audit, a lint, a typecheck, or checks the lockfile is current** (medium value, small, `/home/user/drawdraw/.github/workflows/ci.yml`). The bundle-for-both-platforms step and the pixel-exact icon check are genuinely good and better than most of the siblings have — the gap is entirely on the dependency and static-analysis side, which is the axis this repo has actually drifted on.
- **No eas.json, though the README documents `eas build`** (medium value, small, `/home/user/drawdraw/app.json`). A documented build command that cannot run is a README promise not met, and without `appVersionSource: remote` + `autoIncrement` every store submission needs a manual version bump in app.json. `scheme` is also a prerequisite for the pose-sharing deep link listed under features.
- **No LICENSE, SECURITY.md, CHANGELOG or PRIVACY policy** (medium value, trivial, `/home/user/drawdraw/README.md`). Both stores require a reachable privacy policy URL for an app that requests camera and photo-library permission, and DrawDraw would otherwise be rejected at review. The 'we send nothing anywhere' claim is also a selling point that currently exists nowhere a user can see.
- **app.json is missing several store-readiness and Android-modernity fields** (medium value, small, `/home/user/drawdraw/app.json`). ITSAppUsesNonExemptEncryption saves an export-compliance questionnaire on every single App Store submission. The monochrome icon is a five-minute change here specifically because the icon pipeline is already generative — that is the payoff of having built it that way.
- **Accessibility gaps outside src/components/ui.js** (medium value, small, `/home/user/drawdraw/src/screens/HomeScreen.js`). The browser e2e suite in a sibling repo (ambient noiser) explicitly checks that every focusable control has an accessible name — the same assertion added to e2e/smoke.mjs would catch these and keep them from coming back. Half the app is already done correctly, which makes the other half a small, mechanical job.
- **Photo-library permission asks for full access when write-only would do** (medium value, trivial, `/home/user/drawdraw/src/screens/EditorScreen.js`). On iOS 14+ the no-argument call triggers the full 'Allow access to all photos' prompt for an app that only needs 'Add Photos Only'; on Android 13+ it pulls in READ_MEDIA_IMAGES unnecessarily. app.json already sets `isAccessMediaLocationEnabled: false`, so the intent is clearly minimal permissions — this is the missing half.
- **Splash screen is never held, so first launch flashes an empty paper screen** (medium value, trivial, `/home/user/drawdraw/App.js`). A commit in the history already tried to fix the 'first-launch flash' by rendering null; holding the splash is the actual fix. It also solves the Pro-flicker item below in the same stroke, since `ready` becomes the second gate.
- **No error boundary and no opt-in error reporting** (medium value, small, `/home/user/drawdraw/App.js`). The editor restores arbitrary JSON from AsyncStorage into ~13 pieces of state with no validation; a single corrupt value makes the app permanently unopenable for that project, and 'Reset' is inside the screen that will not render. The boundary is the difference between a bad state and a bricked install.
- **PanResponder for all three gesture surfaces** (low value, medium, `/home/user/drawdraw/src/components/HeadGestureLayer.js`). The existence of DRAFT_SAMPLES and the `draft` prop is direct evidence that the JS-thread gesture path is the bottleneck. It is also the one place where taking on two dependencies is defensible in a project that has otherwise correctly refused them. Note the cheaper fix listed under code quality first — the offscreen export views currently defeat draft mode entirely, and fixing that may make this unnecessary.
- **All UI strings are hardcoded English** (low value, medium, `/home/user/drawdraw/src/lib/fitSolver.js`). A drawing-method app has no language-specific content — the audience is global and the vocabulary (brow, nose, crown, three-quarter) is small and fixed. Low priority, but the extraction step alone makes the copy reviewable in one place.

## Features worth adding

- **Export the guide as SVG (and PDF) as well as PNG** (high value, small). The construction head is already vector — buildHeadWireframe returns polylines and HeadGuide turns them into SVG path strings — but every export goes through react-native-view-shot and lands as a raster PNG. Add a src/lib/exportSvg.js that takes { front, back, outline } plus a transform and emits an SVG document string (reusing the toPath helper extracted per the code-quality item), write it with expo-file-system and hand it to expo-sharing. Hooks into the existing export row in EditorScreen as a fifth button, or as a format toggle above it. This also fixes the discrepancy where the README claims exports are 'crisp at export resolution' while captureRef actually rescales a screen-sized render.
- **Draggable landmarks — nudge the fit instead of redoing it** (high value, small). solveHeadFromTaps runs in about 2.5ms, but after the third tap FitOverlay clears `fitTaps` and the markers vanish; getting the fit slightly wrong means starting all three taps over. Keep the taps in EditorScreen state after solving, keep FitOverlay's markers on screen as draggable handles (the DraggableGuide PanResponder pattern already exists), and re-solve on each drag. Because the solve is closed-form per orientation candidate, this is genuinely live.
- **Undo / redo** (high value, medium). There is no undo anywhere — a mis-drag of the head, an accidental Reset, or a slider knocked while scrolling is unrecoverable. EditorScreen already collects every piece of guide state into one memoized `settings` object for autosave; wrap that in a small useHistory reducer (push on commit, not on every gesture frame — the HeadGestureLayer already reports gesture start/end through onInteractingChange, which is the natural commit boundary) and put undo/redo next to Reset in the header.
- **Guide-only mode: use the construction head with no photo** (high value, small). Today a project requires an imported portrait — EditorScreen derives its whole layout from image.width/height. Add a third button on HomeScreen ('Just the head') that creates a project with a null image and a default canvas aspect, so the app doubles as a standalone rotatable Loomis reference for drawing from imagination. This is the single most requested thing for a tool of this shape, and the model, gestures, proportion sliders and turnaround export all already work without a photo.
- **Timed gesture-drawing practice** (high value, medium). Practice mode hides the photo but has no clock. Add a countdown (30s / 1m / 2m / 5m / custom) that runs while practising, auto-advances through the recent-projects list, and reveals the photo when time is up. The step-by-step reveal in EditorScreen already has the exact setInterval + play/pause machinery to copy, and 'Hold to peek' becomes the mid-exercise check. This turns a single-portrait tool into something a user opens daily.
- **Body proportions: the figure beyond the head** (high value, large). The natural product extension, and the one the geometry is already set up for — headModel exports HEAD_HEIGHT_UNITS precisely because a figure is measured in head-heights. Add a src/lib/figureModel.js with an eight-heads-tall proportion ladder (plus 7.5 realistic and 6 child variants) rendered as horizontal division lines locked to the fitted head's scale and roll, and a Pro figure pack. It reuses the fit, the export pipeline and the proportion-preset UI wholesale.
- **Save and reuse poses** (medium value, small). VIEW_PRESETS gives five fixed angles but a pose you fitted to a photo cannot be kept. Add a 'Save pose' action that stores { yaw, pitch, roll, proportions } under a name in storage.js next to the project index, and show saved poses as chips beside the presets. Pairs naturally with the turnaround sheet: any saved pose becomes a cell you can export.
- **Show the recovered pose numerically** (medium value, trivial). The fit solves yaw, pitch, roll, scale and position to a documented 0.1 degrees on clean taps, and then throws the numbers away into an opaque transform. Display 'yaw 38 degrees, pitch 6, roll -3' in the Guide panel (and let them be typed in). Teaching the user to name the pose they are looking at is squarely the point of the app, it makes poses reproducible across photos, and it is a two-line read from the existing headTransform state.
- **Configurable turnaround sheet** (medium value, small). TURNAROUND_VIEWS is a hardcoded six and SHEET_COLS a hardcoded three. Let the user choose which angles and how many (a 12-view full rotation at 30-degree steps is the classic character-reference sheet), with the grid deriving its size as it already does from the array length. The rendering is entirely data-driven already — this is mostly UI.
- **Compare your drawing against the guide** (medium value, medium). Import a second photo — a shot of the drawing you just made — and cross-fade it against the portrait and the fitted guide to see where the proportions went wrong. Hooks into the existing picker on HomeScreen and reuses the tracingOpacity slider and the tracingRef layer machinery in EditorScreen almost unchanged. It closes the loop the app currently leaves open: it helps you start a drawing but never tells you whether it worked.
- **Share a pose as a link or short code** (medium value, medium). Encode { yaw, pitch, roll, proportions, elements } into a compact string behind a `drawdraw://` scheme (which app.json needs anyway for EAS dev clients) so a teacher can send a class a pose, or a user can move a setup between devices. SimplaCAD's share.js and Ambient Noiser's share codes are the same idea in sibling repos; reuse the pattern including validating everything on the way back in.
- **Web demo on GitHub Pages** (medium value, small). `npm run build:web` already produces a working single-page build that the e2e suite drives end to end, and chesscheatser already has the exact Pages deploy workflow to copy. Publishing it gives the app a try-before-installing link and turns the existing web build from a pure test surface into a shopfront — while the README's 'web is a test surface, not a shipping target' caveat stays honest, since exports and haptics need a device.

## Code quality

- **The offscreen export views defeat the draft-sampling optimisation entirely** (high value, small, `/home/user/drawdraw/src/screens/EditorScreen.js`). `renderGuides({ draft: interacting })` is used for the on-screen overlay, but the three offscreen export views at the bottom of the component call `renderGuides()` with no arguments — so draft is false. All four HeadGuide instances live in the same component and re-render on every setHeadTransform during a pan; the on-screen one drops to DRAFT_SAMPLES (40) and skips the depth-bucket split, while the combined and guides-only offscreen copies rebuild the full 96-sample wireframe and emit the full depth-tapered Path fan on every single touch move. Two thirds of the work the draft mode was written to avoid is still being done, invisibly. Cheapest fix: pass the same `{ draft: interacting }` to the offscreen views — nothing reads them until capture time, and capture never happens mid-gesture. Better fix: mount the offscreen views only while an export is in flight (set an `exporting` state, render, capture on the next frame, unmount), which also stops them costing anything at rest. Worth measuring before reaching for reanimated.
- **Untested modules: storage, entitlements, and the two pure functions hidden inside components** (high value, medium, `/home/user/drawdraw/src/lib/storage.js`). The three test files cover headModel, fitSolver and filenames thoroughly and cover nothing else. Add: (a) src/lib/__tests__/storage.test.js with AsyncStorage and expo-file-system mocked — listProjects returns [] on corrupt JSON and on a non-array, createProject falls back to the original URI when the copy throws, the index caps at 30, saveSettings re-sorts by updatedAt, and deleteProject only unlinks a file under PORTRAIT_DIR (the `startsWith` guard is a real safety check with no test). (b) src/lib/__tests__/pro.test.js — restore only grants when result.pro is truthy, a rejected purchase never writes the entitlement, a corrupt stored value reads as not-Pro. (c) Extract `snapYaw` out of HeadGestureLayer.js and `quantize` out of Slider.js into src/lib/ and test them: snapYaw pulls to the nearest 45 only inside the window and fires the haptic exactly once per arrival; quantize is idempotent, respects the step and never emits floating-point dust. Both are pure logic sitting inside components purely by accident, which is the pattern tvsham's CLAUDE.md calls out explicitly.
- **The wireframe-to-SVG renderer is written out four times** (medium value, small, `/home/user/drawdraw/src/screens/HomeScreen.js`). HomeScreen's HeadMark, OnboardingScreen's PageArt and PaywallScreen's FullHead are the same twenty-line component three times over — identical `toPath` closure, identical back(dashed, 0.3 opacity)/outline/front layering, differing only in size, stroke widths and the dash pattern (4 4 vs 5 5, which is drift rather than intent). HeadGuide contains a fourth copy of toPath, and tools/make-icons.mjs a fifth of the same project-and-stroke logic. Extract one `<WireframeArt size yaw pitch elements proportions weight />` into src/components/, have all three screens use it, and export the point-projection helper from headModel.js so HeadGuide and the icon tool share it too. About 90 lines of duplication, and it is the reason the three marks have already diverged.
- **EditorScreen is 763 lines and holds twenty pieces of state** (medium value, medium, `/home/user/drawdraw/src/screens/EditorScreen.js`). Everything lives here: guide state, mode state, fit taps, step playback, four export refs, the offscreen capture views, the three-tab control panel and ~180 lines of styles. Split it: a `useGuideSettings(project)` hook owning the thirteen values that already travel together as the memoized `settings` object plus its debounced autosave; `<GuidePanel>`, `<BuildPanel>` and `<StylePanel>` as siblings; `<ExportBar>` taking the refs; and an `<ExportSurfaces>` component for the offscreen views. The CLAUDE.md rule that everything visual must go through `renderGuides()` survives the split intact — pass it down as a render prop.
- **Restored project settings are never validated** (medium value, small, `/home/user/drawdraw/src/lib/storage.js`). EditorScreen spreads `project.settings` straight into thirteen useState initialisers with `??` defaults. `??` only catches null and undefined, so a truncated or hand-edited AsyncStorage value — headTransform.scale as a string, elements as an array, proportions.browY as NaN — flows into buildHeadWireframe and produces NaN path coordinates and an unopenable project with no way to reset. Add a `sanitizeSettings(raw)` to storage.js that range-clamps every number, checks the element keys against ELEMENTS and drops anything unrecognised, exactly as Ambient Noiser's `cleanSettings` and SimplaCAD's `CadDocument.restore` do for the same class of input in sibling repos. Test it with a corrupt-settings fixture.
- **useEntitlements exposes `ready` and nobody reads it** (medium value, trivial, `/home/user/drawdraw/src/lib/pro.js`). `ready` is returned from the hook and destructured nowhere — App.js takes only { pro, purchase, restore }. Because the initial state is `pro: false`, a paying user sees the Pro chips locked and the paywall link visible for the duration of the AsyncStorage read on every cold start, and a fast tap in that window opens the paywall for something they already own. Gate the first render on `ready` (naturally combined with holding the splash screen, per the upgrades list). A linter with no-unused-vars would have caught this.
- **Purchase grants unconditionally, and the price is hardcoded** (medium value, small, `/home/user/drawdraw/src/lib/pro.js`). `purchase()` awaits `purchases.purchase(productId)` and then calls `grant()` regardless of what came back — `restore()` correctly checks `result?.pro` but `purchase()` checks nothing, so any provider that resolves with a cancelled, deferred or pending transaction silently unlocks Pro. Mirror restore's check. Separately, `purchases.getProducts()` is defined, exported and never called anywhere in the app: PaywallScreen renders `PRODUCTS.pro.price`, the literal string '$7.99', which will be wrong in every non-US storefront and which both stores' review guidelines require to come from the store. Wire getProducts into PaywallScreen with the hardcoded value as the pre-load placeholder. Both are seams that will be filled in wrong later precisely because the stub currently hides the requirement.
- **Export error handling: the spinner ends before the work does** (medium value, small, `/home/user/drawdraw/src/screens/EditorScreen.js`). `exportView` sets busy=true, captures, shows an Alert, and clears busy in its `finally` — which fires as soon as the Alert is presented, not when the user picks an option. The Save-to-Photos and Share branches then run permission requests, a library write and a share sheet with no busy state and no spinner, and each has its own duplicated try/catch that surfaces `String(err?.message ?? err)` — a raw native error string — in an Alert. That same expression appears four times in this one function. Extract a `reportError(title, err)` helper, and hold busy across the chosen branch rather than across the capture only.
- **Exports are laid out at screen size and rescaled at capture** (medium value, small, `/home/user/drawdraw/src/screens/EditorScreen.js`). The offscreen views are styled `{ width: displayW, height: displayH }` — the on-screen fit size, a few hundred points — while captureRef is passed `{ width: exportW, height: exportH }` computed from the source image (up to 4096). So the vector guide is rasterised at screen resolution and then scaled up, which contradicts the README's claim that SVG rendering 'keeps it crisp at export resolution'. Either lay the offscreen views out at exportW/exportH (they are offscreen, so their size costs nothing but memory) or drop the width/height capture options and document that exports are at screen scale. This is also the strongest argument for the SVG export feature listed above.
- **`clamp` is defined three times; the standard views are defined twice and disagree** (medium value, small, `/home/user/drawdraw/src/components/Slider.js`). The identical `const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))` appears in fitSolver.js, HeadGestureLayer.js and Slider.js — put it in a src/lib/math.js alongside the `rad` helper. More substantively, EditorScreen's VIEW_PRESETS and TurnaroundSheet's TURNAROUND_VIEWS are two hand-maintained lists of the same standard views (Front/three-quarter/Profile/Above/Below), and HeadGestureLayer's SNAP_STEP of 45 disagrees with both: the '¾' preset is yaw 40, so dragging toward three-quarter snaps to 45 and the preset button jumps back to 40. Define one STANDARD_VIEWS list next to the model and derive the snap targets from it.
- **Magic numbers in headModel.js that no test pins** (medium value, trivial, `/home/user/drawdraw/src/lib/headModel.js`). `MAX_RADIUS = 1.6` is a hand-derived bound on how far any model point can sit from the centre, used by HeadGuide's depth bucketing. It happens to hold today (depth 1.25 x BASE_C 1.25 = 1.5625) but nothing checks it, so widening the depth slider past 1.28 would silently clamp every near stroke to the same weight and quietly flatten the drawing. Add a test that walks every PROPORTION_PRESET plus the slider extremes and asserts no |z| exceeds MAX_RADIUS — and derive the bound from the axes rather than from the constant, or the test excuses the bug. Separately, the side-plane fraction 0.62 is written out five times (in `ear`, twice in `jaw`, and twice in the sidePlanes branch) with `Math.sqrt(1 - 0.62 ** 2)` recomputed at each site: name it SIDE_PLANE_X and hoist the derived `s`.
- **Android hardware back is unhandled in the editor** (medium value, trivial, `/home/user/drawdraw/src/screens/EditorScreen.js`). App.js swaps between HomeScreen and EditorScreen with plain conditional rendering and no navigation library, and nothing subscribes to BackHandler. On Android, pressing back in the editor backgrounds the app instead of returning to the portrait list; the only way back is the small '‹ Portraits' text. Add a BackHandler.addEventListener in EditorScreen calling onClose (and one in OnboardingScreen), or adopt expo-router as the siblings do. The paywall Modal already handles onRequestClose correctly, which shows the gap is an oversight rather than a decision.
- **HeadGuide's `taper` prop has no caller** (low value, trivial, `/home/user/drawdraw/src/components/HeadGuide.js`). `taper = true` is destructured from props and only ever read as `if (!taper || draft)`. No call site in EditorScreen, TurnaroundSheet or anywhere else passes it, so the branch is only ever reached through `draft`. Either delete the prop and test `draft` directly, or use it: the natural caller is a low-motion / high-contrast accessibility setting where uniform stroke weight is easier to see.
- **The e2e static server serves any path under the URL it is given** (low value, trivial, `/home/user/drawdraw/e2e/smoke.mjs`). `join(BUILD, decodeURIComponent(req.url.split('?')[0]))` with no normalisation or containment check means `..%2f..%2f` escapes the build directory. It binds to 127.0.0.1 and only ever serves a local build, so the practical risk is nil, but the two-line fix (resolve the path and assert it still starts with BUILD, else fall through to index.html) is worth having in a file that will be copied into the next repo. The dev servers in the SimplaCAD and Ambient Noiser siblings face the same pattern.
- **make-icons.mjs loads headModel through a data: URL** (low value, small, `/home/user/drawdraw/tools/make-icons.mjs`). The tool reads src/lib/headModel.js as text and imports it as `data:text/javascript,...` because the file is ESM inside a CommonJS-by-default package. It works only while headModel.js imports nothing — a comment says as much — so the first `import` added to the model breaks the icon pipeline and the CI `icons:check` step with a confusing error. Once TypeScript lands the problem changes shape anyway; in the meantime, either add `"type": "module"` support via a .mjs re-export shim or make the constraint a test rather than a comment.

## Shared across all Platteration repositories

The same gaps recur in every repository; fixing them once as a template and copying it is cheaper than fixing them fourteen times.

### CI and supply chain

1. **No workflow sets `permissions:`** (except the two Pages deploy jobs). Add `permissions: { contents: read }` at the top of every workflow so the `GITHUB_TOKEN` handed to third-party actions cannot write to the repository.
2. **No action is pinned to a commit SHA** (0 of 50 `uses:` lines across the fourteen repositories). `actions/checkout@v4` follows a movable tag; pin to the full 40-character SHA with the version in a comment, and let Dependabot bump it.
3. **No repository has Dependabot or Renovate.** Add `.github/dependabot.yml` with `npm` (or `pip`) and `github-actions` ecosystems, weekly.
4. **No CI step runs `npm audit`** (two workflows pass `--no-audit` explicitly). Add `npm audit --audit-level=high` after `npm ci`; for the Expo apps the current transitive advisories are build-time only (`uuid` via `xcode` via `@expo/config-plugins`), so gate on `high` rather than `moderate` until Expo ships the fix.
5. **`tvsham` runs `npm ci || npm install` in CI and in its Dockerfile.** The fallback silently discards the lockfile guarantee; drop it and fix the lockfile instead.
6. **`selfreportle`, `simplacad` and `phonogeometry` have no lockfile** and install Playwright ad hoc in CI. Add a `package-lock.json` (even with devDependencies only) and use `npm ci`.
7. **Enable secret scanning and push protection** in each repository's settings; nothing is committed today, and this keeps it that way.

### Repository hygiene

8. **Ten repositories have no `LICENSE`** (battleshiple, collectcollect, drawdraw, multidcheckers, multidconnect4, notenote, randostats, selfreportle, simplacad, tvsham). Without one, nobody else may legally use or contribute to the code. The siblings that have one use MIT.
9. **Only `simplacad` has a `SECURITY.md`.** Copy it to the others with a private reporting address.
10. **No repository has a `main` branch.** In all fourteen the default branch is the original `claude/...` feature branch, so branch protection, Dependabot targets and the two GitHub Pages workflows (`abientnoiser`, `chesscheatser` both trigger on `main`/`master`) all point at a branch that does not exist; those deploys have never run. Create `main` from the current branch, make it the default, and protect it.
11. **`drawdraw` is the one repository still on Expo SDK 53** (the rest are on 57). Its eight high-severity `npm audit` findings (`image-size`, `metro`) disappear with the SDK upgrade; it is also the only app not written in TypeScript and the only one pinned to Node 20 in CI.
12. **`multidcheckers` and `multidconnect4` are near-identical copies** (same branch name, same 65-file layout, same dependencies). The timeline/multiverse engine, persistence and share code should live in one shared package so fixes land in both.

### A hardened workflow to copy

```yaml
name: CI
on:
  push:
    branches: ["**"]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@<full-sha> # v4
      - uses: actions/setup-node@<full-sha> # v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm audit --audit-level=high
      - run: npm run lint --if-present
      - run: npm run typecheck --if-present
      - run: npm test
```
