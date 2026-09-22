import AsyncStorage from '@react-native-async-storage/async-storage';

import { cleanSettings, DEFAULTS, KEYS, LEGACY_KEYS } from './settings';

/**
 * The settings record on its way in and out of storage. Every read goes
 * through `cleanSettings`, and the one migration lives here, ahead of the
 * read, so nothing can look at the new key before it has run.
 *
 * `drawdraw.onboarded.v1` held `'1'` once the intro had been dismissed. It is
 * folded into `settings.seenIntro` by the shared rule: read NEW; if present,
 * remove OLD and stop; if absent, read OLD, write NEW, and remove OLD only
 * once that write has succeeded, so a write that fails (quota, a private
 * window) leaves OLD where it was for the next launch to retry. Both present
 * means NEW wins: the only way both exist is that a migrated build wrote NEW
 * and then could not remove OLD, and NEW is what it has read and written
 * since. There is no flag saying the migration ran, and none to lose — NEW
 * being present is the idempotence.
 */
async function migrateOnboarded() {
  const old = await AsyncStorage.getItem(LEGACY_KEYS.onboarded);
  if (old == null) return null;
  // The old reader was `v === '1'`; the fold keeps exactly that meaning.
  const record = JSON.stringify({ seenIntro: old === '1' });
  try {
    await AsyncStorage.setItem(KEYS.settings, record);
  } catch {
    // This launch still honours the flag; the next one migrates again.
    return record;
  }
  await AsyncStorage.removeItem(LEGACY_KEYS.onboarded).catch(() => {});
  return record;
}

/** NEW exists, so OLD is a leftover from a remove that failed. Try again; the next launch will if this fails. */
async function dropLegacy() {
  try {
    if ((await AsyncStorage.getItem(LEGACY_KEYS.onboarded)) != null) {
      await AsyncStorage.removeItem(LEGACY_KEYS.onboarded);
    }
  } catch {
    // Nothing to do now.
  }
}

function parse(raw) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * The settings as stored, cleaned; the defaults when there is no record. When
 * storage cannot be read at all, the intro counts as seen: nothing could be
 * saved either, so the user would meet it on every launch, and that is the
 * one thing the old reader's catch already refused to do.
 */
export async function loadSettings() {
  let raw;
  try {
    raw = await AsyncStorage.getItem(KEYS.settings);
    if (raw == null) raw = await migrateOnboarded();
    else await dropLegacy();
  } catch {
    return { ...DEFAULTS, seenIntro: true };
  }
  return cleanSettings(parse(raw), DEFAULTS);
}

export async function persistSettings(settings) {
  await AsyncStorage.setItem(KEYS.settings, JSON.stringify(settings));
}
