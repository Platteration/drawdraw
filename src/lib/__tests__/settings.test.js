/**
 * The settings record is read back on every launch, and on the web build it
 * is plain localStorage on a shared origin. So the reader is held to its
 * contract: a value that does not hold up costs that one field, a name on
 * Object.prototype is never a value, and the fold from the old onboarding
 * key never loses the flag — not on a failed write, not on a second run.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __store: store,
    getItem: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItem: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    removeItem: jest.fn(async (key) => {
      store.delete(key);
    }),
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  bool,
  cleanEntitlements,
  cleanSettings,
  DEFAULTS,
  has,
  KEYS,
  LEGACY_KEYS,
  pick,
  resetSettings,
  TABLES,
} from '../settings';
import { loadSettings, persistSettings } from '../settingsStore';

const D = DEFAULTS;
const NEW = KEYS.settings;
const OLD = LEGACY_KEYS.onboarded;
const PROTOTYPE_NAMES = Object.getOwnPropertyNames(Object.prototype);

describe('cleanSettings', () => {
  it('rejects every name on Object.prototype, as a value and as a key', () => {
    // Built with JSON.parse, not a literal: `{__proto__: x}` as a literal
    // sets the prototype, while JSON.parse makes an own `__proto__` key —
    // which is what a stored record actually holds.
    expect(PROTOTYPE_NAMES).toContain('constructor');
    for (const name of PROTOTYPE_NAMES) {
      expect(cleanSettings(JSON.parse(`{"haptics":"${name}","seenIntro":"${name}"}`), D)).toEqual(D);
      expect(cleanSettings(JSON.parse(`{"${name}":true}`), D)).toEqual(D);
    }
  });

  it('round-trips the defaults and every value a field can hold', () => {
    expect(cleanSettings(D, D)).toEqual(D);
    for (const haptics of [true, false]) {
      for (const seenIntro of [true, false]) {
        expect(cleanSettings({ haptics, seenIntro }, D)).toEqual({ haptics, seenIntro });
      }
    }
    // Every member of every enum table survives the round trip. (None today;
    // the loop is what a first table is held to.)
    for (const table of Object.values(TABLES)) {
      for (const value of Object.keys(table)) expect(pick(value, table, 'not it')).toBe(value);
    }
  });

  it('replaces one bad field and keeps the rest', () => {
    // Falling back per field is what keeps a user's other choices through one
    // value an older or newer build wrote differently.
    expect(cleanSettings({ haptics: 'yes', seenIntro: true }, D)).toEqual({ haptics: true, seenIntro: true });
    expect(cleanSettings({ haptics: false, seenIntro: 1 }, D)).toEqual({ haptics: false, seenIntro: false });
    expect(cleanSettings({ haptics: false, extra: 'ignored' }, D)).toEqual({ haptics: false, seenIntro: false });
  });

  it('reads anything that is not a record as an empty one', () => {
    for (const raw of [null, undefined, [], 'string', 42, true]) {
      expect(cleanSettings(raw, D)).toEqual(D);
    }
  });
});

describe('the table helpers', () => {
  const TABLE = { on: true, off: true };

  it('look up own keys only', () => {
    expect(has(TABLE, 'on')).toBe(true);
    expect(has(TABLE, 'On')).toBe(false);
    expect(has(TABLE, undefined)).toBe(false);
    expect(has(TABLE, { toString: () => 'on' })).toBe(false);
    for (const name of PROTOTYPE_NAMES) {
      expect(has(TABLE, name)).toBe(false);
      expect(pick(name, TABLE, 'off')).toBe('off');
    }
    expect(pick('on', TABLE, 'off')).toBe('on');
  });

  it('take a boolean and nothing that merely coerces to one', () => {
    expect(bool(true, false)).toBe(true);
    expect(bool(false, true)).toBe(false);
    for (const value of [1, 0, 'true', '', null, undefined, {}]) {
      expect(bool(value, true)).toBe(true);
      expect(bool(value, false)).toBe(false);
    }
  });
});

describe('cleanEntitlements', () => {
  it('grants Pro on a stored true and on nothing else', () => {
    expect(cleanEntitlements({ pro: true })).toEqual({ pro: true });
    for (const raw of [{ pro: 1 }, { pro: 'true' }, { pro: false }, {}, null, 'pro', ['pro']]) {
      expect(cleanEntitlements(raw)).toEqual({ pro: false });
    }
    for (const name of PROTOTYPE_NAMES) {
      expect(cleanEntitlements(JSON.parse(`{"pro":"${name}"}`))).toEqual({ pro: false });
      expect(cleanEntitlements(JSON.parse(`{"${name}":true}`))).toEqual({ pro: false });
    }
  });
});

describe('resetSettings', () => {
  it('returns every preference to its default and keeps what has been seen', () => {
    expect(resetSettings({ haptics: false, seenIntro: true })).toEqual({ haptics: true, seenIntro: true });
    expect(resetSettings({ haptics: false, seenIntro: false })).toEqual({ haptics: true, seenIntro: false });
  });
});

describe('the onboarded flag migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AsyncStorage.__store.clear();
    AsyncStorage.setItem.mockImplementation(async (key, value) => {
      AsyncStorage.__store.set(key, value);
    });
    AsyncStorage.getItem.mockImplementation(async (key) =>
      AsyncStorage.__store.has(key) ? AsyncStorage.__store.get(key) : null
    );
  });

  it('old only: folds the flag into the new record and removes the old key', async () => {
    AsyncStorage.__store.set(OLD, '1');
    expect(await loadSettings()).toEqual({ ...D, seenIntro: true });
    expect(AsyncStorage.__store.get(NEW)).toBe(JSON.stringify({ seenIntro: true }));
    expect(AsyncStorage.__store.has(OLD)).toBe(false);
  });

  it('old only, with a value the old reader did not count as seen', async () => {
    // The old reader was `v === '1'`; the fold says exactly what it said.
    AsyncStorage.__store.set(OLD, '0');
    expect(await loadSettings()).toEqual({ ...D, seenIntro: false });
    expect(AsyncStorage.__store.get(NEW)).toBe(JSON.stringify({ seenIntro: false }));
    expect(AsyncStorage.__store.has(OLD)).toBe(false);
  });

  it('new only: reads it and writes nothing', async () => {
    AsyncStorage.__store.set(NEW, JSON.stringify({ haptics: false, seenIntro: true }));
    expect(await loadSettings()).toEqual({ haptics: false, seenIntro: true });
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });

  it('both present: the new record wins, untouched, and the old key goes', async () => {
    // A migrated build wrote NEW and then could not remove OLD; NEW is what it
    // has read and written since, so NEW is the newer record.
    AsyncStorage.__store.set(NEW, JSON.stringify({ haptics: false, seenIntro: false }));
    AsyncStorage.__store.set(OLD, '1');
    expect(await loadSettings()).toEqual({ haptics: false, seenIntro: false });
    expect(AsyncStorage.__store.get(NEW)).toBe(JSON.stringify({ haptics: false, seenIntro: false }));
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.__store.has(OLD)).toBe(false);
  });

  it('write fails: keeps the old key for the next launch, and still honours it now', async () => {
    AsyncStorage.__store.set(OLD, '1');
    AsyncStorage.setItem.mockRejectedValueOnce(new Error('QuotaExceededError'));

    expect(await loadSettings()).toEqual({ ...D, seenIntro: true });
    expect(AsyncStorage.__store.has(NEW)).toBe(false);
    expect(AsyncStorage.__store.get(OLD)).toBe('1'); // not removed: nothing replaced it
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();

    // The next launch, with storage back, completes it.
    expect(await loadSettings()).toEqual({ ...D, seenIntro: true });
    expect(AsyncStorage.__store.get(NEW)).toBe(JSON.stringify({ seenIntro: true }));
    expect(AsyncStorage.__store.has(OLD)).toBe(false);
  });

  it('write fails: honours a never-seen flag too, not the unreadable-storage answer', async () => {
    // migrateOnboarded's own guard, not loadSettings' outer catch: that one
    // answers seenIntro true for every failure, which for a '0' would skip an
    // intro that was never dismissed.
    AsyncStorage.__store.set(OLD, '0');
    AsyncStorage.setItem.mockRejectedValueOnce(new Error('QuotaExceededError'));
    expect(await loadSettings()).toEqual({ ...D, seenIntro: false });
    expect(AsyncStorage.__store.has(NEW)).toBe(false);
    expect(AsyncStorage.__store.get(OLD)).toBe('0');
  });

  it('old only, remove fails after the write: the record stands and the flag is honoured', async () => {
    // The write succeeded, so NEW is the record from here on; a remove that
    // fails is retried by the next launch's cleanup, and must not cost this
    // one the flag it just folded.
    AsyncStorage.__store.set(OLD, '0');
    AsyncStorage.removeItem.mockRejectedValueOnce(new Error('busy'));
    expect(await loadSettings()).toEqual({ ...D, seenIntro: false });
    expect(AsyncStorage.__store.get(NEW)).toBe(JSON.stringify({ seenIntro: false }));
    expect(AsyncStorage.__store.get(OLD)).toBe('0');

    expect(await loadSettings()).toEqual({ ...D, seenIntro: false });
    expect(AsyncStorage.__store.has(OLD)).toBe(false);
  });

  it("both present, remove fails: the user's own record, not the defaults", async () => {
    // dropLegacy's guard: a cleanup that cannot remove the old key is not a
    // reason to read the record as the defaults for this session.
    AsyncStorage.__store.set(NEW, JSON.stringify({ haptics: false, seenIntro: false }));
    AsyncStorage.__store.set(OLD, '1');
    AsyncStorage.removeItem.mockRejectedValueOnce(new Error('busy'));
    expect(await loadSettings()).toEqual({ haptics: false, seenIntro: false });
    expect(AsyncStorage.__store.get(OLD)).toBe('1');
  });

  it('run twice: the second run finds the new record and changes nothing', async () => {
    AsyncStorage.__store.set(OLD, '1');
    const first = await loadSettings();
    jest.clearAllMocks();

    const second = await loadSettings();
    expect(second).toEqual(first);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect([...AsyncStorage.__store.keys()]).toEqual([NEW]);
  });

  it('neither: the defaults, and nothing written', async () => {
    expect(await loadSettings()).toEqual(D);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.__store.size).toBe(0);
  });

  it('counts the intro as seen when storage cannot be read at all', async () => {
    // Nothing could be saved either, so the alternative is the intro on every
    // launch — which is what the old reader's catch already refused.
    AsyncStorage.getItem.mockRejectedValue(new Error('storage unavailable'));
    expect(await loadSettings()).toEqual({ ...D, seenIntro: true });
  });

  it('reads a record that is not JSON as no record', async () => {
    AsyncStorage.__store.set(NEW, '{not json');
    expect(await loadSettings()).toEqual(D);
  });

  it('cleans a record on the way in', async () => {
    AsyncStorage.__store.set(NEW, JSON.stringify({ haptics: 'constructor', seenIntro: true, theme: 'dark' }));
    expect(await loadSettings()).toEqual({ haptics: true, seenIntro: true });
  });
});

describe('persistSettings', () => {
  it('writes the record under the settings key', async () => {
    AsyncStorage.__store.clear();
    await persistSettings({ haptics: false, seenIntro: true });
    expect(AsyncStorage.__store.get(NEW)).toBe(JSON.stringify({ haptics: false, seenIntro: true }));
  });

  it('round-trips through loadSettings', async () => {
    AsyncStorage.__store.clear();
    await persistSettings({ haptics: false, seenIntro: true });
    expect(await loadSettings()).toEqual({ haptics: false, seenIntro: true });
  });
});
