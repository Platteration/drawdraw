/**
 * One palette, so no theme row — and the native config has to say the same
 * thing. `userInterfaceStyle: 'automatic'` belongs to an app whose settings
 * offer a theme; pinning it to a scheme belongs to an app with one palette.
 * The two are held together here so neither can move alone.
 */
import fs from 'fs';
import path from 'path';

import { DEFAULTS, TABLES } from '../src/lib/settings';
import * as theme from '../src/theme';

const root = path.join(__dirname, '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;

/** Every shipped source file under `dir`, as one string. */
function source(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full);
      } else if (/\.[jt]sx?$/.test(entry.name)) {
        out.push(fs.readFileSync(full, 'utf8'));
      }
    }
  };
  walk(path.join(root, dir));
  return out.join('\n');
}

it('pins the interface style to the one palette the app has', () => {
  // src/theme.ts is warm paper and graphite, and there is no second palette
  // to switch to: a Theme row with one option would be a lie, and
  // 'automatic' would let a phone in dark mode invert paper and sanguine
  // (appConfig.test.ts holds the Android half of that). If a dark palette
  // ever arrives, the row, the table and this value change together.
  const hasThemeRow = Object.prototype.hasOwnProperty.call(DEFAULTS, 'theme');
  expect(appConfig.userInterfaceStyle).toBe(hasThemeRow ? 'automatic' : 'light');
  expect(hasThemeRow).toBe(false);
  expect(TABLES.theme).toBeUndefined();
});

it('reads no scheme from the OS, and has no second palette to switch to', () => {
  const src = source('src');
  expect(src).toMatch(/export const colors\b/); // the scan reached src/theme.ts, so it read the app
  expect(src).not.toMatch(/useColorScheme|\bAppearance\b/);
  // The palette is one object, not a light/dark pair.
  expect(Object.keys(theme).filter((k) => /dark|light|scheme/i.test(k))).toEqual([]);
});
