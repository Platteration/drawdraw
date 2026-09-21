/**
 * What the app config asks the operating systems for. The config plugins fill
 * in their own defaults for anything left out, so an omission here becomes a
 * permission in the shipped build that nothing in the app ever uses — and the
 * only place that shows up is a prebuild, which no other suite runs.
 *
 * The same goes for every other key a plugin defaults: app.json states them,
 * even at the default, so the file and this test say the same thing and a
 * default that moves between SDKs moves visibly.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
/** The versions expo@53 ships its modules at, which is what `expo install` pins. */
const bundled = JSON.parse(
  fs.readFileSync(path.join(root, 'node_modules/expo/bundledNativeModules.json'), 'utf8')
);

/**
 * The Android manifest a prebuild would generate: `expo config --type
 * introspect` runs the same plugin chain, so this is the merged result rather
 * than the app.json that feeds it. The template's own permissions only exist
 * here — app.json never mentions them.
 */
const introspected = JSON.parse(
  execFileSync('node', [require.resolve('expo/bin/cli'), 'config', '--type', 'introspect', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
  })
);
const androidResults = introspected._internal.modResults.android;
const manifest = androidResults.manifest.manifest;
/** res/values/colors.xml as the plugins leave it, name -> value. */
const colors = Object.fromEntries(androidResults.colors.resources.color.map((c) => [c.$.name, c._]));
/** gradle.properties as the plugins leave it, key -> value. */
const gradleProperties = Object.fromEntries(
  androidResults.gradleProperties.filter((p) => p.type === 'property').map((p) => [p.key, p.value])
);

/**
 * The only Android permissions this app has a use for. `tools:node="remove"`
 * on everything else is what keeps a module's own manifest from widening the
 * shipped build.
 */
const USED = [
  'android.permission.CAMERA', // launchCameraAsync
  'android.permission.VIBRATE', // expo-haptics
  'android.permission.WRITE_EXTERNAL_STORAGE', // saveToLibraryAsync, Android 12 and below
];
// Not in USED: INTERNET. A development build needs it to load its bundle and
// nothing else here ever opens a socket, so it is blocked in the config and
// added back to the debug source set alone — see plugins/withDebugInternet.js
// and the test at the bottom of this file.
const INTERNET = 'android.permission.INTERNET';

/**
 * Every AndroidManifest.xml under `dir`. `isDirectory()` is false for a
 * symlink, so a linked package — and any cycle through one — is left alone.
 */
const manifestsUnder = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...manifestsUnder(full));
    else if (entry.isFile() && entry.name === 'AndroidManifest.xml') out.push(full);
  }
  return out;
};

/**
 * Every source file the app ships, as one string: `src/` less its tests, plus
 * the entry points. What the config asks for is justified against this
 * rather than assumed.
 */
function appSource() {
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full);
      } else if (entry.name.endsWith('.js')) {
        sources.push(fs.readFileSync(full, 'utf8'));
      }
    }
  };
  walk(path.join(root, 'src'));
  for (const entry of ['App.js', 'index.js']) {
    sources.push(fs.readFileSync(path.join(root, entry), 'utf8'));
  }
  return sources.join('\n');
}

/**
 * A PNG as tools/png.mjs writes them: 8-bit RGBA, no filtering. Enough to
 * check an asset the generator produced; not a general decoder.
 */
function readPng(file) {
  const buf = fs.readFileSync(file);
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(buf.toString('ascii', 12, 16)).toBe('IHDR');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  expect([buf[24], buf[25]]).toEqual([8, 6]); // bit depth 8, truecolour with alpha
  const idat = [];
  for (let offset = 8; offset < buf.length; ) {
    const length = buf.readUInt32BE(offset);
    if (buf.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      idat.push(buf.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    if (raw[y * (stride + 1)] !== 0) throw new Error(`${file}: row ${y} is filtered`);
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, pixels };
}

const pluginOptions = (name) => {
  const entry = appConfig.plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);
  expect(entry).toBeDefined();
  return Array.isArray(entry) ? entry[1] || {} : {};
};

describe('permissions requested by the config plugins', () => {
  it('declares nothing in the generated manifest the app does not use', () => {
    // The plugin options only control usage strings and runtime requests; the
    // prebuild template adds permissions of its own (legacy storage, the
    // 'display over other apps' overlay) that nothing here ever asked for, and
    // blockedPermissions is the only thing that takes one back out.
    const declared = manifest['uses-permission']
      .filter((p) => p.$['tools:node'] !== 'remove')
      .map((p) => p.$['android:name']);
    expect(declared.length).toBeGreaterThan(0); // the introspection found a manifest at all
    expect(declared.filter((name) => !USED.includes(name))).toEqual([]);
  });

  it('blocks every permission a bundled native module merges in', () => {
    // The generated manifest is only half of it: each native module ships an
    // AndroidManifest.xml that Gradle folds in at build time, which no plugin
    // option touches. expo-media-library alone declares the whole media-read
    // set — images, video, audio, user-selected — for an app that only writes.
    //
    // Every manifest in the tree is read rather than the ones at a guessed
    // path inside a directory whose name starts with 'expo'. A scoped package
    // is not a top-level directory name at all, react-native keeps its own
    // under ReactAndroid/src/debug, and react-native-svg, react-native-view-
    // shot and async-storage each ship one — so the ratchet this is here to be
    // only held for expo-branded permission creep, and the module someone adds
    // tomorrow is the one it is for.
    const files = manifestsUnder(path.join(root, 'node_modules'));
    const declaredBy = new Map(); // permission -> the manifests declaring it
    for (const file of files) {
      const xml = fs.readFileSync(file, 'utf8');
      for (const m of xml.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)) {
        declaredBy.set(m[1], [...(declaredBy.get(m[1]) || []), path.relative(root, file)]);
      }
    }

    // The scan found the module manifests, and reaches the three kinds the
    // name filter used to miss: a package that is not expo-*, a scoped one,
    // and a source set that is not src/main.
    const seen = files.map((f) => path.relative(path.join(root, 'node_modules'), f));
    expect(seen.length).toBeGreaterThan(10);
    expect(declaredBy.size).toBeGreaterThan(0);
    expect(seen.some((f) => f.startsWith('react-native/'))).toBe(true);
    expect(seen.some((f) => f.startsWith('@'))).toBe(true);
    expect(seen.some((f) => f.includes(`src${path.sep}debug${path.sep}`))).toBe(true);

    // INTERNET needs no exception here: expo-file-system declares it and the
    // blocked list is what takes it back out of the shipped build.
    const blocked = appConfig.android.blockedPermissions || [];
    const unblocked = [...declaredBy]
      .filter(([name]) => !USED.includes(name) && !blocked.includes(name))
      .map(([name, where]) => `${name} (${where.join(', ')})`);
    expect(unblocked).toEqual([]);
  });

  it('does not ask for the microphone', () => {
    // expo-image-picker writes NSMicrophoneUsageDescription *and* adds
    // android.permission.RECORD_AUDIO unless microphonePermission is exactly
    // false. The app only ever takes still photos.
    expect(pluginOptions('expo-image-picker').microphonePermission).toBe(false);
  });

  it('never captures audio or video anywhere in the app', () => {
    // The reason the microphone is not needed, checked against the source
    // rather than assumed.
    expect(appSource()).not.toMatch(/recordAsync|MediaTypeOptions\.Videos|'videos'/i);
  });

  it('keeps the add-only photo library string the save flow relies on', () => {
    // EditorScreen requests write-only access, which is backed by
    // NSPhotoLibraryAddUsageDescription; expo-media-library writes it from
    // savePhotosPermission.
    expect(typeof pluginOptions('expo-media-library').savePhotosPermission).toBe('string');
  });
});

describe('what leaves the device', () => {
  it('does not ship network access', () => {
    // The privacy argument for keeping the portraits on the device is that the
    // app has no network code; INTERNET in the shipped manifest is what turns
    // a malicious dependency or in-process code execution from 'reads the
    // app's own documents' into 'sends them somewhere'. expo-file-system
    // declares it, so it has to be blocked rather than merely not asked for.
    const internet = manifest['uses-permission'].find(
      (p) => p.$['android:name'] === INTERNET
    );
    expect(internet).toBeDefined(); // it is in the merge, and being removed
    expect(internet.$['tools:node']).toBe('remove');
  });

  it('has no network code to need it', () => {
    // The reason INTERNET can be blocked at all, checked against the source
    // rather than remembered: these are the APIs that open a socket, or hand
    // a URL to something that does. Adding one means the shipped build needs
    // the permission back, and the privacy argument above is over.
    expect(appSource()).not.toMatch(
      /\bfetch\s*\(|XMLHttpRequest|WebSocket|\baxios\b|openURL|openBrowserAsync|expo-updates/
    );
    // ...and with no URL handled anywhere, no scheme is registered either: a
    // scheme is an entry point other apps can open.
    expect(appConfig.scheme).toBeUndefined();
  });

  it('gives a development build the network back, in the debug source set only', async () => {
    // Blocking it outright would stop a dev client loading its bundle. The
    // manifest merger gives a build-type source set higher priority than the
    // main manifest, so the permission is added to android/app/src/debug —
    // the same split React Native's own template uses for its debug-only
    // SYSTEM_ALERT_WINDOW. The release variant never reads that file.
    expect(appConfig.plugins).toContain('./plugins/withDebugInternet');

    const plugin = require('../plugins/withDebugInternet');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drawdraw-prebuild-'));
    try {
      // What expo-template-bare-minimum@53.0.42 puts there, verbatim.
      const template = [
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
        '    xmlns:tools="http://schemas.android.com/tools">',
        '',
        '    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>',
        '',
        '    <application android:usesCleartextTraffic="true" tools:targetApi="28" />',
        '</manifest>',
        '',
      ].join('\n');
      const file = path.join(dir, plugin.DEBUG_MANIFEST);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, template);

      const config = plugin({ name: 'DrawDraw', slug: 'drawdraw' });
      expect(typeof config.mods.android.dangerous).toBe('function');
      await config.mods.android.dangerous({
        ...config,
        modRequest: { platformProjectRoot: dir },
      });

      const written = fs.readFileSync(file, 'utf8');
      expect(written).toMatch(/<uses-permission[^>]*android:name="android\.permission\.INTERNET"/);
      // ...without dropping what the template had there.
      expect(written).toContain('android.permission.SYSTEM_ALERT_WINDOW');
      expect(written).toContain('usesCleartextTraffic');
      // ...and running it again changes nothing.
      expect(plugin.addInternetPermission(written)).toBe(written);
      // A project whose template wrote no debug manifest gets one.
      const fresh = path.join(dir, 'fresh');
      expect(fs.readFileSync(plugin.writeDebugManifest(fresh), 'utf8')).toContain(
        'android.permission.INTERNET'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the portrait copies out of Android backup', () => {
    // @expo/config-plugins defaults allowBackup to true, writing over the bare
    // template's own false. Portraits are copied into filesDir, which is
    // exactly what Auto Backup uploads and what `adb backup` pulls off an
    // unlocked Android 11 device — and for a photo taken in the app, that copy
    // is the only one that exists.
    expect(appConfig.android.allowBackup).toBe(false);
    expect(manifest.application[0].$['android:allowBackup']).toBe('false');
  });
});

describe('Android system bars', () => {
  it('does not draw under them while nothing supplies insets', () => {
    // React Native's SafeAreaView insets on iOS only. With edge-to-edge on and
    // no inset provider, the Android header and export row end up under the
    // status bar and the gesture pill.
    //
    // SDK 57 drops this key from the schema — Android 16 makes edge-to-edge
    // mandatory, and its prebuild warns about the key — and `newArchEnabled`
    // (the next test) leaves with it. Whoever upgrades flips both assertions
    // to `toBeUndefined()` and gives the screens a safe-area provider, rather
    // than carrying keys nothing reads.
    const suppliesInsets = Object.keys(pkg.dependencies).some((d) =>
      /safe-area/.test(d)
    );
    if (!suppliesInsets) {
      expect(appConfig.android.edgeToEdgeEnabled).toBe(false);
      expect(gradleProperties['expo.edgeToEdgeEnabled']).toBe('false');
    }
  });

  it('runs on the new architecture, and says so while the SDK still asks', () => {
    // SDK 53's prebuild writes gradle.properties' newArchEnabled from this
    // key, so leaving it out is not neutral. Gone in SDK 57 — see above.
    expect(appConfig.newArchEnabled).toBe(true);
    expect(gradleProperties.newArchEnabled).toBe('true');
  });
});

describe('appearance', () => {
  it('forces the light scheme on Android, not only on iOS', () => {
    // `userInterfaceStyle` reaches iOS through the config alone; on Android it
    // needs expo-system-ui installed (@expo/config-types says so on the key).
    // Without it a phone in dark mode inverts an app whose palette is paper
    // and sanguine. The pin is the one expo@53 bundles, read from expo's own
    // list rather than typed here, so an SDK upgrade moves it.
    expect(appConfig.userInterfaceStyle).toBe('light');
    expect(pkg.dependencies['expo-system-ui']).toBe(bundled['expo-system-ui']);
    expect(fs.existsSync(path.join(root, 'node_modules/expo-system-ui/package.json'))).toBe(true);
    // Its plugin ran: the root view colour it writes for iOS is in the merge.
    expect(typeof introspected.ios.infoPlist.RCTRootViewBackgroundColor).toBe('number');
  });

  it('configures the splash screen through the plugin, with no block beside it', () => {
    // expo-splash-screen's plugin reads its props, and falls back to a
    // top-level `splash` only when given none (getAndroidSplashConfig in
    // @expo/prebuild-config) — so a block there is a second source nothing
    // reads, and SDK 57 removes it from the schema altogether.
    expect(appConfig.splash).toBeUndefined();
    expect(appConfig.android.splash).toBeUndefined();
    expect(appConfig.ios.splash).toBeUndefined();
    const splash = pluginOptions('expo-splash-screen');
    expect(splash).toMatchObject({
      image: './assets/splash-icon.png',
      imageWidth: 200,
      resizeMode: 'contain',
      backgroundColor: appConfig.backgroundColor,
    });
    expect(fs.existsSync(path.join(root, splash.image))).toBe(true);
    // ...and the merge carries the colour it asked for.
    expect(colors.splashscreen_background).toBe(appConfig.backgroundColor);
  });
});

describe('what the sibling apps pin', () => {
  it("states the keys the plugins would otherwise default, at this app's values", () => {
    expect(appConfig.orientation).toBe('portrait');
    expect(appConfig.ios.supportsTablet).toBe(true);
    expect(appConfig.web.bundler).toBe('metro');
  });

  it('keeps predictive back off', () => {
    // EditorScreen and OnboardingScreen answer the back gesture through React
    // Native's BackHandler, which Android 13+ stops delivering once an app
    // opts into OnBackInvokedCallback. SDK 53's prebuild has no reader for
    // this key (none in @expo/config-plugins, prebuild-config or @expo/cli)
    // and its template leaves the gesture off, so today the key is a
    // statement; SDK 57's prebuild does read it, and this is what keeps the
    // upgrade from turning the gesture on under those handlers.
    expect(appConfig.android.predictiveBackGestureEnabled).toBe(false);
    expect(appSource()).toMatch(/BackHandler\.addEventListener\('hardwareBackPress'/);
  });

  it('keeps the EAS profiles in the shared shape', () => {
    // appVersionSource "remote" keeps the build number on EAS and
    // autoIncrement bumps it per production build, which is what a store
    // that has already seen a number needs. `cli.version` is a floor, not a
    // pin; the profiles are what hold the shape.
    const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
    expect(eas.cli).toEqual({ version: '>= 16.0.0', appVersionSource: 'remote' });
    expect(eas.build.development).toEqual({ developmentClient: true, distribution: 'internal' });
    expect(eas.build.preview).toEqual({ distribution: 'internal', android: { buildType: 'apk' } });
    expect(eas.build.production).toEqual({ autoIncrement: true });
    expect(eas.submit).toEqual({ production: {} });
  });
});

describe('the launcher icon', () => {
  const PAPER = [0xf4, 0xef, 0xe6]; // the app's backgroundColor, as the generator has it
  let icon;
  let foreground;
  let background;
  let monochrome;

  beforeAll(() => {
    icon = appConfig.android.adaptiveIcon;
    foreground = readPng(path.join(root, icon.foregroundImage));
    background = readPng(path.join(root, icon.backgroundImage));
    monochrome = readPng(path.join(root, icon.monochromeImage));
  });

  it('ships all three adaptive layers, each the size of the foreground', () => {
    // A foreground alone leaves the launcher to fill in the other two: the
    // background from `backgroundColor`, which is fine, and the monochrome
    // layer from nothing, so a themed launcher (Android 13+) shows a blank
    // tile in the accent colour. All three come out of tools/make-icons.mjs
    // — `npm run icons:check` in CI is what keeps them matching the model;
    // this is what keeps them named, present, decodable and one size.
    expect(icon).toMatchObject({
      foregroundImage: './assets/adaptive-icon.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
      backgroundColor: appConfig.backgroundColor,
    });
    expect([foreground.width, foreground.height]).toEqual([1024, 1024]);
    for (const layer of [background, monochrome]) {
      expect([layer.width, layer.height]).toEqual([foreground.width, foreground.height]);
    }
  });

  it('draws the background flat and the monochrome layer in white alone', () => {
    // The launcher reads only the monochrome layer's alpha and tints it, so
    // any colour in it is one that will never show — and a sign the
    // foreground was pasted in. The background is the paper colour edge to
    // edge; the launcher's mask does the shaping.
    const flat = background.pixels.every((v, i) => v === (i % 4 === 3 ? 255 : PAPER[i % 4]));
    expect(flat).toBe(true);

    let drawn = 0;
    let tinted = 0;
    let offSilhouette = 0;
    for (let i = 0; i < monochrome.pixels.length; i += 4) {
      // ...and it is the foreground's own silhouette, alpha for alpha.
      if (monochrome.pixels[i + 3] !== foreground.pixels[i + 3]) offSilhouette++;
      if (monochrome.pixels[i + 3] === 0) continue;
      drawn++;
      if (monochrome.pixels[i] !== 255 || monochrome.pixels[i + 1] !== 255 || monochrome.pixels[i + 2] !== 255) {
        tinted++;
      }
    }
    expect(drawn).toBeGreaterThan(0);
    expect(tinted).toBe(0);
    expect(offSilhouette).toBe(0);
  });
});
