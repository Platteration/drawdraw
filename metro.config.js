const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-media-library is native-only in SDK 57. Web exists only as a test
// surface for DrawDraw, so resolve that package to a small web shim while
// leaving the native module untouched on iOS and Android.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'expo-media-library') {
    return context.resolveRequest(
      context,
      path.resolve(__dirname, 'src/lib/mediaLibrary.web.js'),
      platform
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
