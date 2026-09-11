/**
 * What the app config asks the operating systems for. The config plugins fill
 * in their own defaults for anything left out, so an omission here becomes a
 * permission in the shipped build that nothing in the app ever uses — and the
 * only place that shows up is a prebuild, which no other suite runs.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/**
 * The Android manifest a prebuild would generate: `expo config --type
 * introspect` runs the same plugin chain, so this is the merged result rather
 * than the app.json that feeds it. The template's own permissions only exist
 * here — app.json never mentions them.
 */
const manifest = JSON.parse(
  execFileSync('node', [require.resolve('expo/bin/cli'), 'config', '--type', 'introspect', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
  })
)._internal.modResults.android.manifest.manifest;

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
    const app = sources.concat(fs.readFileSync(path.join(root, 'App.js'), 'utf8')).join('\n');
    expect(app).not.toMatch(/recordAsync|MediaTypeOptions\.Videos|'videos'/i);
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
    expect(manifest.application[0].$['android:allowBackup']).toBe('false');
  });
});

describe('Android system bars', () => {
  it('does not draw under them while nothing supplies insets', () => {
    // React Native's SafeAreaView insets on iOS only. With edge-to-edge on and
    // no inset provider, the Android header and export row end up under the
    // status bar and the gesture pill.
    const suppliesInsets = Object.keys(pkg.dependencies).some((d) =>
      /safe-area/.test(d)
    );
    if (!suppliesInsets) {
      expect(appConfig.android.edgeToEdgeEnabled).toBe(false);
    }
  });
});
