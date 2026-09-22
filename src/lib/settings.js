/**
 * The app's own preferences, and the shape every record read back from
 * storage is held to.
 *
 * Storage keys are `<app>.<record>.v<N>`, and every one the app writes is
 * named here: a key spelled out beside its own module is one that a rename,
 * a reset and the contract test all fail to see. `LEGACY_KEYS` are the ones
 * an earlier build wrote and this one folds into a record above
 * (settingsStore.js does the folding).
 *
 * A record loaded from storage is untrusted. It was written by an older build
 * (missing fields), a newer one (unknown values), or — on the web build, where
 * AsyncStorage is plain localStorage — by anything on the origin. So each
 * record is rebuilt field by field from a known default, and a value that
 * does not hold up costs that field alone, never the record: the user's other
 * choices survive one bad one. Table lookups are by own property only (`has`),
 * because every name on `Object.prototype` — `constructor`, `__proto__`,
 * `toString` — is truthy on a plain object, and `JSON.parse('{"x":"__proto__"}')`
 * is an ordinary way for one to arrive.
 *
 * Pure and dependency-free on purpose, like projectShape.js: the contract test
 * reads it without a device, and settingsStore.js is the one module that
 * touches AsyncStorage.
 */

export const KEYS = {
  projects: 'drawdraw.projects.v1',
  entitlements: 'drawdraw.entitlements.v1',
  settings: 'drawdraw.settings.v1',
};

/** Written by an earlier build. Each one is migrated into a record above, then removed. */
export const LEGACY_KEYS = {
  /** `'1'` once the intro had been dismissed; now `settings.seenIntro`. */
  onboarded: 'drawdraw.onboarded.v1',
};

/**
 * The settings record. `seenIntro` records what was shown rather than a
 * preference, which is why `resetSettings` keeps it. There is no theme: the
 * app has one palette (src/theme.js), so a row offering a choice would be a
 * lie, and `__tests__/appearance.test.js` pins the native config to match.
 */
export const DEFAULTS = {
  /** Ticks when the guide snaps to a standard view and when a three-tap fit lands. */
  haptics: true,
  seenIntro: false,
};

/**
 * The enum tables, `{ value: true }`, one per field that picks from a list —
 * the first such field goes through `pick` with its table added here. None
 * today: both fields are booleans.
 */
export const TABLES = {};

/** `raw` when it is a plain object, else an empty one — so a missing record reads as all-missing fields. */
const fields = (raw) => (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});

/** True when `value` is one of `table`'s own keys — never an inherited one like `constructor` or `toString`. */
export function has(table, value) {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  return Object.prototype.hasOwnProperty.call(table, value);
}

/** `value` when it is one of `table`'s own keys, else `fallback`. */
export function pick(value, table, fallback) {
  return has(table, value) ? value : fallback;
}

/** `value` when it is a boolean, else `fallback`. `1` and `'true'` are not ours: the app only ever writes booleans. */
export function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/** The stored settings, with every unknown or missing field replaced from `fallback`. */
export function cleanSettings(raw, fallback) {
  const s = fields(raw);
  return {
    haptics: bool(s.haptics, fallback.haptics),
    seenIntro: bool(s.seenIntro, fallback.seenIntro),
  };
}

/**
 * The stored entitlement. `pro` is a plain flag with no receipt behind it (see
 * purchases.js for why); anything but `true` is not a purchase.
 */
export function cleanEntitlements(raw) {
  return { pro: bool(fields(raw).pro, false) };
}

/** Every preference back to how it shipped; what the user has already seen stays seen. */
export function resetSettings(prev) {
  return { ...DEFAULTS, seenIntro: prev.seenIntro };
}
