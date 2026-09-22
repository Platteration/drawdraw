/**
 * One palette, so no theme row — and the native config has to say the same
 * thing. `userInterfaceStyle: 'automatic'` belongs to an app whose settings
 * offer a theme; pinning it to a scheme belongs to an app with one palette.
 * The two are held together here so neither can move alone.
 */
const fs = require('fs');
const path = require('path');

const { DEFAULTS, TABLES } = require('../src/lib/settings');

const root = path.join(__dirname, '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;

/** Every shipped source file under `dir`, as one string. */
function source(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full);
      } else if (entry.name.endsWith('.js')) {
        out.push(fs.readFileSync(full, 'utf8'));
      }
    }
  };
  walk(path.join(root, dir));
  return out.join('\n');
}

it('pins the interface style to the one palette the app has', () => {
  // src/theme.js is warm paper and graphite, and there is no second palette
  // to switch to: a Theme row with one option would be a lie, and
  // 'automatic' would let a phone in dark mode invert paper and sanguine
  // (appConfig.test.js holds the Android half of that). If a dark palette
  // ever arrives, the row, the table and this value change together.
  const hasThemeRow = Object.prototype.hasOwnProperty.call(DEFAULTS, 'theme');
  expect(appConfig.userInterfaceStyle).toBe(hasThemeRow ? 'automatic' : 'light');
  expect(hasThemeRow).toBe(false);
  expect(TABLES.theme).toBeUndefined();
});

it('reads no scheme from the OS, and has no second palette to switch to', () => {
  expect(source('src')).not.toMatch(/useColorScheme|\bAppearance\b/);
  // The palette is one object, not a light/dark pair.
  const theme = require('../src/theme');
  expect(Object.keys(theme).filter((k) => /dark|light|scheme/i.test(k))).toEqual([]);
});
