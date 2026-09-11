/**
 * What the app config asks the operating systems for. The config plugins fill
 * in their own defaults for anything left out, so an omission here becomes a
 * permission in the shipped build that nothing in the app ever uses — and the
 * only place that shows up is a prebuild, which no other suite runs.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
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
  'android.permission.INTERNET', // loading the bundle in development
];

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

  it('blocks every permission the bundled expo modules merge in', () => {
    // The generated manifest is only half of it: each expo module ships an
    // AndroidManifest.xml that Gradle folds in at build time, which no plugin
    // option touches. expo-media-library alone declares the whole media-read
    // set — images, video, audio, user-selected — for an app that only writes.
    const declared = new Set();
    for (const dir of fs.readdirSync(path.join(root, 'node_modules'))) {
      if (!dir.startsWith('expo')) continue;
      const file = path.join(root, 'node_modules', dir, 'android/src/main/AndroidManifest.xml');
      if (!fs.existsSync(file)) continue;
      const xml = fs.readFileSync(file, 'utf8');
      for (const m of xml.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)) declared.add(m[1]);
    }
    expect(declared.size).toBeGreaterThan(0); // the scan found the module manifests
    const blocked = appConfig.android.blockedPermissions || [];
    const unblocked = [...declared].filter((name) => !USED.includes(name) && !blocked.includes(name));
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
