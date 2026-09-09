/**
 * What the app config asks the operating systems for. The config plugins fill
 * in their own defaults for anything left out, so an omission here becomes a
 * permission in the shipped build that nothing in the app ever uses — and the
 * only place that shows up is a prebuild, which no other suite runs.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const pluginOptions = (name) => {
  const entry = appConfig.plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);
  expect(entry).toBeDefined();
  return Array.isArray(entry) ? entry[1] || {} : {};
};

describe('permissions requested by the config plugins', () => {
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
