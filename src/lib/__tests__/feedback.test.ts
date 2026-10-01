/**
 * The Vibration switch is only a switch if every haptic in the app goes
 * through the one flag it sets. The call sites route through `haptics`, and
 * this holds the gate itself.
 */
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { haptics, setHapticsEnabled } from '../feedback';

const realOS = Platform.OS;
const calls = () =>
  jest.mocked(Haptics.selectionAsync).mock.calls.length +
  jest.mocked(Haptics.impactAsync).mock.calls.length +
  jest.mocked(Haptics.notificationAsync).mock.calls.length;

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  setHapticsEnabled(true);
});

afterEach(() => {
  Platform.OS = realOS;
});

it('fires each cue while on', () => {
  haptics.tap();
  haptics.snap();
  haptics.fitted();
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
});

it('fires nothing while off, and comes back when switched on again', () => {
  setHapticsEnabled(false);
  haptics.tap();
  haptics.snap();
  haptics.fitted();
  expect(calls()).toBe(0);

  setHapticsEnabled(true);
  haptics.snap();
  expect(calls()).toBe(1);
});

it('fires nothing on the web', () => {
  Platform.OS = 'web';
  haptics.tap();
  haptics.snap();
  haptics.fitted();
  expect(calls()).toBe(0);
});

it('swallows a device without a haptic engine', async () => {
  jest.mocked(Haptics.impactAsync).mockRejectedValueOnce(new Error('Haptics unavailable'));
  expect(() => haptics.snap()).not.toThrow();
  await new Promise((resolve) => setImmediate(resolve)); // an unhandled rejection would fail the run
});
