/**
 * Give the debug build — and only the debug build — network access.
 *
 * `android.blockedPermissions` in app.json takes INTERNET back out of the
 * merged manifest, because nothing in `src/` opens a socket and the app's
 * whole privacy story is that a portrait it copied cannot leave the device.
 * expo-file-system declares INTERNET in its own module manifest, so blocking
 * it is the only way the shipped APK does not carry it.
 *
 * A development build does need it: that is how Metro's bundle reaches the
 * device. Android's manifest merger gives a build-type source set higher
 * priority than the main manifest, so a declaration in
 * `android/app/src/debug/AndroidManifest.xml` survives the removal that main
 * applies to the library manifests — which is the same split React Native's
 * own template uses for its debug-only SYSTEM_ALERT_WINDOW, and that file is
 * where this adds the permission. The release variant never reads it.
 *
 * This is a dangerous mod because a build-type manifest is a file rather than
 * a part of the config: there is no first-party mod for one. It runs at
 * prebuild, is idempotent, and keeps whatever the template already put there.
 */
const fs = require('fs');
const path = require('path');

const { withDangerousMod } = require('expo/config-plugins');

const PERMISSION = 'android.permission.INTERNET';
const DEBUG_MANIFEST = 'app/src/debug/AndroidManifest.xml';

const EMPTY_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
</manifest>
`;

/**
 * The given debug manifest with INTERNET declared in it, unchanged if it
 * already is. String surgery rather than an XML round-trip so the template's
 * own comments, formatting and `tools:` attributes come through untouched.
 */
function addInternetPermission(xml) {
  if (new RegExp(`<uses-permission[^>]*android:name="${PERMISSION}"`).test(xml)) return xml;
  const openTagEnd = xml.indexOf('>', xml.indexOf('<manifest'));
  if (!xml.includes('<manifest') || openTagEnd === -1) {
    throw new Error(`${DEBUG_MANIFEST} has no <manifest> element to add ${PERMISSION} to`);
  }
  const head = xml.slice(0, openTagEnd + 1);
  const tail = xml.slice(openTagEnd + 1);
  return `${head}\n    <uses-permission android:name="${PERMISSION}"/>\n${tail}`;
}

/** Write the permission into the debug source set, creating the file if needed. */
function writeDebugManifest(platformProjectRoot) {
  const file = path.join(platformProjectRoot, DEBUG_MANIFEST);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : EMPTY_MANIFEST;
  const next = addInternetPermission(existing);
  if (next !== existing) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next);
  }
  return file;
}

const withDebugInternet = (config) =>
  withDangerousMod(config, [
    'android',
    (modConfig) => {
      writeDebugManifest(modConfig.modRequest.platformProjectRoot);
      return modConfig;
    },
  ]);

module.exports = withDebugInternet;
module.exports.addInternetPermission = addInternetPermission;
module.exports.writeDebugManifest = writeDebugManifest;
module.exports.DEBUG_MANIFEST = DEBUG_MANIFEST;
module.exports.PERMISSION = PERMISSION;
