import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEntitlements } from '../pro';
import { PRODUCTS, setPurchaseProvider } from '../purchases';

jest.mock('react', () => ({ useState: jest.fn(), useEffect: jest.fn(), useCallback: (fn) => fn }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(),
}));

let state;
let effects;
let stored;

beforeEach(() => {
  state = [];
  effects = [];
  stored = '{}';
  useState.mockImplementation((initial) => {
    const i = state.length;
    state.push(initial);
    return [initial, (value) => { state[i] = value; }];
  });
  useEffect.mockImplementation((fn) => effects.push(fn));
  AsyncStorage.getItem.mockImplementation(async () => stored);
  AsyncStorage.setItem.mockImplementation(async (_key, value) => { stored = value; });
  setPurchaseProvider({
    configured: true,
    getProducts: async () => [],
    purchase: async () => ({ pro: true }),
    restore: async () => ({ pro: false }),
  });
});

afterEach(() => setPurchaseProvider(null));

async function mount() {
  const entitlements = useEntitlements();
  effects.forEach((effect) => effect());
  await new Promise((resolve) => setImmediate(resolve));
  return entitlements;
}

it.each(['null', '{"pro":"false"}', '{"pro":1}', 'not json'])(
  'does not grant Pro from malformed cached entitlement %s', async (value) => {
    stored = value;
    await mount();
    expect(state).toEqual([false, true]);
  }
);

it('keeps a confirmed boolean cache usable offline with a configured store', async () => {
  stored = '{"pro":true}';
  await mount();
  expect(state).toEqual([true, true]);
});

it('does not activate cached Pro when billing is unavailable', async () => {
  stored = '{"pro":true}';
  setPurchaseProvider(null);
  await mount();
  expect(state).toEqual([false, true]);
});

it('removes stale Pro when the store confirms no purchase to restore', async () => {
  stored = '{"pro":true}';
  const entitlements = await mount();
  await expect(entitlements.restore()).resolves.toEqual({ pro: false });
  expect(state[0]).toBe(false);
  expect(JSON.parse(stored)).toEqual({ pro: false });
});

it('only caches an explicitly confirmed purchase', async () => {
  const entitlements = await mount();
  await entitlements.purchase(PRODUCTS.pro.id);
  expect(state[0]).toBe(true);
  expect(JSON.parse(stored)).toEqual({ pro: true });
});

it('does not persist pending payments as paid entitlements', async () => {
  setPurchaseProvider({ configured: true, purchase: async () => ({ status: 'pending' }) });
  const entitlements = await mount();
  await expect(entitlements.purchase(PRODUCTS.pro.id)).rejects.toMatchObject({
    code: 'purchase_not_completed',
  });
  expect(state[0]).toBe(false);
  expect(JSON.parse(stored)).toEqual({});
});

it('keeps the offline cache when restoration fails rather than reporting a revocation', async () => {
  stored = '{"pro":true}';
  setPurchaseProvider({ configured: true, restore: async () => { throw new Error('Offline'); } });
  const entitlements = await mount();
  await expect(entitlements.restore()).rejects.toThrow('Offline');
  expect(state[0]).toBe(true);
  expect(JSON.parse(stored)).toEqual({ pro: true });
});
