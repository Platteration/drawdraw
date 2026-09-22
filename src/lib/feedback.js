import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Every haptic the app fires goes through here, so one flag — set from the
 * settings record by App.js — turns them all off. Best effort: nothing
 * happens on the web, while the Vibration switch is off, or on a device
 * without a haptic engine, and no caller has to care which.
 */
let enabled = true;

/** Called by the settings layer; haptics are skipped entirely when off. */
export function setHapticsEnabled(on) {
  enabled = on;
}

const safe = (fn) => {
  if (Platform.OS === 'web' || !enabled) return;
  fn().catch(() => {});
};

export const haptics = {
  /** A three-tap fit point was taken. */
  tap: () => safe(() => Haptics.selectionAsync()),
  /** The yaw snapped onto a standard view. */
  snap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** A three-tap fit solved. */
  fitted: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
};
