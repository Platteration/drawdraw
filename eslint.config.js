// https://docs.expo.dev/guides/using-eslint/
// The shared Expo lint configuration (see CONVENTIONS.md): Expo's own preset at the
// SDK-pinned version, with only the deltas every app here needs. This is the SDK 53
// form: its preset ships react-hooks v5, which has no React Compiler rules to relax.
const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expo,
  // ESLint 9 does not skip dot-folders; these are build output.
  { ignores: ['dist/**', 'dist-web/**', '.expo/**', '.web-build/**', '.export-check/**'] },
  // Build scripts, config plugins and the browser smoke test run in Node, not the app.
  { files: ['e2e/**', 'scripts/**', 'tools/**', 'plugins/**'], languageOptions: { globals: globals.node } },
  { files: ['**/__tests__/**', '**/*.test.*'], languageOptions: { globals: { ...globals.jest, ...globals.node } } },
  {
    rules: {
      // Prose apostrophes in JSX text.
      'react/no-unescaped-entities': 'off',
    },
  },
]);
