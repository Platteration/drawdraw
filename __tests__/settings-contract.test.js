/**
 * The settings contract, pinned. A renamed storage key silently orphans every
 * user's record, which is the costliest drift there is; a row or a table that
 * moves without this file moving is the next.
 */
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '9.8.7' } } }));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import fs from 'fs';
import path from 'path';

import { DEFAULTS, KEYS, LEGACY_KEYS, TABLES } from '../src/lib/settings';
import SettingsScreen from '../src/screens/SettingsScreen';

const root = path.join(__dirname, '..');

describe('storage keys', () => {
  it('are these, and every one is <app>.<record>.v<N>', () => {
    expect(Object.values(KEYS)).toEqual([
      'drawdraw.projects.v1',
      'drawdraw.entitlements.v1',
      'drawdraw.settings.v1',
    ]);
    expect(Object.values(LEGACY_KEYS)).toEqual(['drawdraw.onboarded.v1']);
    for (const key of [...Object.values(KEYS), ...Object.values(LEGACY_KEYS)]) {
      expect(key).toMatch(/^drawdraw\.[a-z]+\.v\d+$/);
    }
  });

  it('are spelled out in settings.js and nowhere else the app ships', () => {
    // A key beside its own module is one the table, a reset and this test
    // cannot see. String literals only: a doc comment naming a key in
    // backticks is how a migration explains itself.
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full);
        } else if (entry.name.endsWith('.js') && full !== path.join(root, 'src/lib/settings.js')) {
          if (/['"]drawdraw\.[a-z]+\.v\d/.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(root, full));
        }
      }
    };
    walk(path.join(root, 'src'));
    expect(/['"]drawdraw\.[a-z]+\.v\d/.test(fs.readFileSync(path.join(root, 'App.js'), 'utf8'))).toBe(false);
    expect(offenders).toEqual([]);
  });
});

describe('the settings record', () => {
  it('holds exactly these rows, at these defaults', () => {
    expect(Object.keys(DEFAULTS)).toEqual(['haptics', 'seenIntro']);
    expect(DEFAULTS).toEqual({ haptics: true, seenIntro: false });
  });

  it('has these enum tables', () => {
    // None: both fields are booleans. The first enum row adds its table here
    // and its values to the round-trip in settings.test.js.
    expect(TABLES).toEqual({});
    for (const value of Object.values(DEFAULTS)) expect(typeof value).toBe('boolean');
  });
});

describe('the settings screen', () => {
  it('shows these rows', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <SettingsScreen settings={DEFAULTS} onChange={() => {}} onReset={() => {}} onClose={() => {}} />
      );
    });
    const texts = tree.root.findAllByType('Text').map((t) => [].concat(t.props.children).join(''));
    expect(texts.filter((t) => ['Vibration', 'Reset to defaults'].includes(t))).toEqual([
      'Vibration',
      'Reset to defaults',
    ]);
    // About: name and version, one sentence, the licence and source, and a privacy line that is true.
    expect(texts).toContain('DrawDraw 9.8.7');
    expect(texts).toContain('MIT licence · Source on GitHub');
    expect(texts.some((t) => t.startsWith('Nothing leaves your device.'))).toBe(true);
    // No theme row: see appearance.test.js.
    expect(texts.some((t) => /theme|appearance|dark/i.test(t))).toBe(false);
    await act(async () => tree.unmount());
  });
});
