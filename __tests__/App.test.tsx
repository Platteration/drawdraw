/**
 * What the very first frame shows. Two things have to be read out of storage
 * before the app knows what to render — the settings, which carry whether
 * onboarding has been seen, and whether Pro was bought — and both of them
 * default to the *wrong* answer while the read is in flight.
 */
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
}));
jest.mock('../src/lib/storage', () => ({
  listProjects: jest.fn(async () => []),
  createProject: jest.fn(async () => ({ id: 'p1' })),
  deleteProject: jest.fn(async () => {}),
  saveSettings: jest.fn(async () => {}),
}));

const mockReads = new Map<string, Promise<string | null>>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => mockReads.get(key)),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));
jest.mock('../src/lib/feedback', () => ({
  setHapticsEnabled: jest.fn(),
  haptics: { tap: jest.fn(), snap: jest.fn(), fitted: jest.fn() },
}));
// The provider waits for the native side to report the insets before it
// renders anything, and there is no native side here; the library's own mock
// reports zero insets at once and leaves SafeAreaView the real component.
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

import React, { type ElementType } from 'react';
import { Modal } from 'react-native';
import renderer, { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';

import App from '../App';
import { setHapticsEnabled } from '../src/lib/feedback';
import HomeScreen from '../src/screens/HomeScreen';
import OnboardingScreen from '../src/screens/OnboardingScreen';
import PaywallScreen from '../src/screens/PaywallScreen';
import SettingsScreen from '../src/screens/SettingsScreen';

const SETTINGS_KEY = 'drawdraw.settings.v1';
const ONBOARDED_KEY = 'drawdraw.onboarded.v1'; // what the build before settings wrote
const ENTITLEMENTS_KEY = 'drawdraw.entitlements.v1';
const SEEN = JSON.stringify({ seenIntro: true });

/** A stored value whose read this test resolves by hand. */
function deferred() {
  let resolve: (value: string | null) => void = () => {};
  const promise = new Promise<string | null>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let tree: ReactTestRenderer | null = null;

/** The app as last rendered. */
const root = () => {
  if (!tree) throw new Error('nothing is rendered');
  return tree.root;
};

afterEach(async () => {
  const rendered = tree;
  if (rendered) await act(async () => rendered.unmount());
  tree = null;
  mockReads.clear();
  jest.clearAllMocks();
});

it('shows a paying customer nothing at all rather than the free build', async () => {
  const entitlements = deferred();
  mockReads.set(SETTINGS_KEY, Promise.resolve(SEEN));
  mockReads.set(ENTITLEMENTS_KEY, entitlements.promise);

  await act(async () => {
    tree = renderer.create(<App />, { createNodeMock: () => ({ scrollTo: () => {} }) });
  });

  // Onboarding has already answered; the entitlement has not. `pro` is false
  // until it does, so rendering here would strip the Pro construction lines
  // out of the guide and offer to sell someone what they already own — then
  // silently change its mind a frame later.
  expect(root().findAllByType(HomeScreen)).toHaveLength(0);
  expect(root().findAllByType(OnboardingScreen)).toHaveLength(0);

  await act(async () => entitlements.resolve(JSON.stringify({ pro: true })));

  const home = root().findByType(HomeScreen);
  expect(home.props.pro).toBe(true); // and it was never rendered any other way
});

it('waits for the settings, which hold the onboarding flag, too', async () => {
  const settings = deferred();
  mockReads.set(SETTINGS_KEY, settings.promise);
  mockReads.set(ENTITLEMENTS_KEY, Promise.resolve(null));

  await act(async () => {
    tree = renderer.create(<App />, { createNodeMock: () => ({ scrollTo: () => {} }) });
  });
  expect(root().findAllByType(OnboardingScreen)).toHaveLength(0);

  await act(async () => settings.resolve(null));
  expect(root().findAllByType(OnboardingScreen)).toHaveLength(1);
});

it('honours the onboarding flag the previous build wrote, and moves it', async () => {
  // Someone who dismissed the intro before settings existed must not meet it
  // again: the flag is read from its old key, folded into the settings record
  // and the old key removed — see src/lib/settingsStore.ts.
  mockReads.set(ONBOARDED_KEY, Promise.resolve('1'));
  mockReads.set(ENTITLEMENTS_KEY, Promise.resolve(null));

  await act(async () => {
    tree = renderer.create(<App />, { createNodeMock: () => ({ scrollTo: () => {} }) });
  });

  expect(root().findAllByType(OnboardingScreen)).toHaveLength(0);
  expect(root().findAllByType(HomeScreen)).toHaveLength(1);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(SETTINGS_KEY, SEEN);
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(ONBOARDED_KEY);
});

it('writes the dismissal of the intro to the settings record', async () => {
  // A new user: no settings record and no old flag. Skipping the intro has to
  // reach storage, or it is back on every launch and nothing in the suite
  // says so — the migration promises the opposite for the old flag.
  mockReads.set(SETTINGS_KEY, Promise.resolve(null));
  mockReads.set(ENTITLEMENTS_KEY, Promise.resolve(null));

  await act(async () => {
    tree = renderer.create(<App />, { createNodeMock: () => ({ scrollTo: () => {} }) });
  });
  const intro = root().findByType(OnboardingScreen);
  await act(async () => intro.props.onDone());

  expect(root().findAllByType(OnboardingScreen)).toHaveLength(0);
  expect(root().findAllByType(HomeScreen)).toHaveLength(1);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    SETTINGS_KEY,
    JSON.stringify({ haptics: true, seenIntro: true })
  );
});

it('hands the stored Vibration setting to the haptics gate', async () => {
  // The gate (feedback.ts) and the switch (SettingsScreen) are each tested on
  // their own; this is the one line that connects them.
  mockReads.set(SETTINGS_KEY, Promise.resolve(JSON.stringify({ haptics: false, seenIntro: true })));
  mockReads.set(ENTITLEMENTS_KEY, Promise.resolve(null));

  await act(async () => {
    tree = renderer.create(<App />, { createNodeMock: () => ({ scrollTo: () => {} }) });
  });

  expect(setHapticsEnabled).toHaveBeenLastCalledWith(false);
});

it('renders the free build for someone who has not bought it', async () => {
  mockReads.set(SETTINGS_KEY, Promise.resolve(SEEN));
  mockReads.set(ENTITLEMENTS_KEY, Promise.resolve(null));

  await act(async () => {
    tree = renderer.create(<App />, { createNodeMock: () => ({ scrollTo: () => {} }) });
  });

  expect(root().findByType(HomeScreen).props.pro).toBe(false);
});

describe('the system bars', () => {
  // Android draws every app edge to edge from SDK 54 on, and a Modal is a
  // window of its own that is drawn edge to edge too, so each screen needs a
  // SafeAreaView between it and the window: the root one for the screens in
  // the main tree, and one inside each Modal, whose content inherits none of
  // the root's padding. React Native's own SafeAreaView would pass on iOS and
  // do nothing on Android, so the type is react-native-safe-area-context's.
  const nearest = (instance: ReactTestInstance, type: ElementType) => {
    for (let node = instance.parent; node; node = node.parent) {
      if (node.type === type) return node;
    }
    return null;
  };
  /** The screen's nearest SafeAreaView sits inside the Modal it is shown in. */
  const insetWithinItsModal = (screen: ReactTestInstance) => {
    const inset = nearest(screen, SafeAreaView);
    expect(inset).not.toBeNull();
    expect(inset && nearest(inset, Modal)).toBe(nearest(screen, Modal));
    expect(nearest(screen, Modal)).not.toBeNull();
  };

  beforeEach(async () => {
    mockReads.set(SETTINGS_KEY, Promise.resolve(SEEN));
    mockReads.set(ENTITLEMENTS_KEY, Promise.resolve(null));
    await act(async () => {
      tree = renderer.create(<App />, { createNodeMock: () => ({ scrollTo: () => {} }) });
    });
  });

  it('keeps the main screens clear of them', () => {
    const home = root().findByType(HomeScreen);
    expect(nearest(home, SafeAreaView)).not.toBeNull();
    expect(nearest(home, Modal)).toBeNull();
  });

  it('keeps Settings clear of them, inside its own Modal', async () => {
    await act(async () => root().findByType(HomeScreen).props.onOpenSettings());
    insetWithinItsModal(root().findByType(SettingsScreen));
  });

  it('keeps the paywall clear of them, inside its own Modal', async () => {
    await act(async () => root().findByType(HomeScreen).props.onRequestPro());
    insetWithinItsModal(root().findByType(PaywallScreen));
  });
});
