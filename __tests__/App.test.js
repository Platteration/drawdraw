/**
 * What the very first frame shows. Two things have to be read out of storage
 * before the app knows what to render — whether onboarding has been seen, and
 * whether Pro was bought — and both of them default to the *wrong* answer
 * while the read is in flight.
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

const mockReads = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key) => mockReads.get(key)),
  setItem: jest.fn(async () => {}),
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import App from '../App';
import HomeScreen from '../src/screens/HomeScreen';
import OnboardingScreen from '../src/screens/OnboardingScreen';

const ONBOARDED_KEY = 'drawdraw.onboarded.v1';
const ENTITLEMENTS_KEY = 'drawdraw.entitlements.v1';

/** A stored value whose read this test resolves by hand. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let tree;

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  mockReads.clear();
  jest.clearAllMocks();
});

it('shows a paying customer nothing at all rather than the free build', async () => {
  const entitlements = deferred();
  mockReads.set(ONBOARDED_KEY, Promise.resolve('1'));
  mockReads.set(ENTITLEMENTS_KEY, entitlements.promise);

  await act(async () => {
    tree = renderer.create(<App />, { createNodeMock: () => ({ scrollTo: () => {} }) });
  });

  // Onboarding has already answered; the entitlement has not. `pro` is false
  // until it does, so rendering here would strip the Pro construction lines
  // out of the guide and offer to sell someone what they already own — then
  // silently change its mind a frame later.
  expect(tree.root.findAllByType(HomeScreen)).toHaveLength(0);
  expect(tree.root.findAllByType(OnboardingScreen)).toHaveLength(0);

  await act(async () => entitlements.resolve(JSON.stringify({ pro: true })));

  const home = tree.root.findByType(HomeScreen);
  expect(home.props.pro).toBe(true); // and it was never rendered any other way
});

it('waits for the onboarding flag too', async () => {
  const onboarded = deferred();
  mockReads.set(ONBOARDED_KEY, onboarded.promise);
  mockReads.set(ENTITLEMENTS_KEY, Promise.resolve(null));

  await act(async () => {
    tree = renderer.create(<App />, { createNodeMock: () => ({ scrollTo: () => {} }) });
  });
  expect(tree.root.findAllByType(OnboardingScreen)).toHaveLength(0);

  await act(async () => onboarded.resolve(null));
  expect(tree.root.findAllByType(OnboardingScreen)).toHaveLength(1);
});

it('renders the free build for someone who has not bought it', async () => {
  mockReads.set(ONBOARDED_KEY, Promise.resolve('1'));
  mockReads.set(ENTITLEMENTS_KEY, Promise.resolve(null));

  await act(async () => {
    tree = renderer.create(<App />, { createNodeMock: () => ({ scrollTo: () => {} }) });
  });

  expect(tree.root.findByType(HomeScreen).props.pro).toBe(false);
});
