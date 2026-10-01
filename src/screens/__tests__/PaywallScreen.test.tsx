/**
 * The paywall shows the provider's product, never the listing's own price:
 * the listing says what the store should charge, and only a provider knows
 * whether anything is for sale and what it costs where the user is.
 */
// PaywallScreen pulls in pro.ts for the feature lists, which pulls in AsyncStorage.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));

import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { notConfiguredProvider, PRODUCTS, setPurchaseProvider } from '../../lib/purchases';
import PaywallScreen from '../PaywallScreen';

const CURRENCY = /[$£€¥]\s?\d|\d+[.,]\d\d/;
let tree: ReactTestRenderer | null = null;

/** The paywall as last mounted. */
const root = () => {
  if (!tree) throw new Error('nothing is mounted');
  return tree.root;
};

const buyLabel = () =>
  root()
    .findAllByType(Text)
    .map((t) => [].concat(t.props.children).join(''))
    .find((s) => s.startsWith('Unlock Pro'));

async function mount() {
  await act(async () => {
    tree = renderer.create(<PaywallScreen onClose={() => {}} onPurchase={async () => {}} onRestore={async () => {}} />);
  });
}

afterEach(async () => {
  const mounted = tree;
  if (mounted) await act(async () => mounted.unmount());
  tree = null;
});

it('shows no price when the bundled provider cannot sell', async () => {
  // The unconfigured provider is what a fresh checkout — and the public web
  // build — runs with.
  await mount();
  const label = buyLabel();
  expect(label).toBe('Unlock Pro · not available in this build');
  expect(label).not.toMatch(CURRENCY);
  // and the listing's own amount reaches no text on the screen
  expect(root().findAllByType(Text).some((t) => String(t.props.children).includes(PRODUCTS.pro.price))).toBe(false);
});

it("shows the provider's price, not the listing's, once a store is configured", async () => {
  const store = {
    configured: true,
    getProducts: async () => [{ ...PRODUCTS.pro, price: '€3,49' }],
    purchase: async () => ({ pro: true }),
    restore: async () => ({ pro: true }),
  };
  setPurchaseProvider(store);
  try {
    await mount();
    expect(buyLabel()).toBe('Unlock Pro · €3,49');
  } finally {
    setPurchaseProvider(notConfiguredProvider);
  }
});
