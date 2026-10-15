import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEntitlements } from '../pro';
import { PRODUCTS, setPurchaseProvider } from '../purchases';

jest.mock('react', () => ({ useState: jest.fn(), useEffect: jest.fn(), useCallback: (fn) => fn, useRef: (initial) => ({ current: initial }) }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(),
}));

let state;
let effects;
let stored;

beforeEach(() => {
  jest.clearAllMocks();
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
  AsyncStorage.removeItem.mockImplementation(async () => { stored = null; });
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

it('ignores a delayed entitlement cache read after the hook unmounts', async () => {
  let finishRead;
  AsyncStorage.getItem.mockReturnValueOnce(new Promise((resolve) => { finishRead = resolve; }));
  useEntitlements();
  const cleanup = effects[0]();
  cleanup?.();
  finishRead('{"pro":true}');
  await new Promise((resolve) => setImmediate(resolve));
  expect(state).toEqual([false, false]);
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

it('clears a revoked offline cache when writing its negative entitlement fails', async () => {
  stored = '{"pro":true}';
  const entitlements = await mount();
  AsyncStorage.setItem.mockRejectedValueOnce(new Error('Storage full'));
  await expect(entitlements.restore()).resolves.toEqual({ pro: false });
  expect(state[0]).toBe(false);
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith('drawdraw.entitlements.v1');
  expect(stored).toBeNull();
});

it('revokes live access and reports failure when neither cache replacement nor removal succeeds', async () => {
  stored = '{"pro":true}';
  const entitlements = await mount();
  AsyncStorage.setItem.mockRejectedValueOnce(new Error('Cache is read-only'));
  AsyncStorage.removeItem.mockRejectedValueOnce(new Error('Cache removal failed'));
  await expect(entitlements.restore()).rejects.toThrow('Cache is read-only');
  expect(state[0]).toBe(false);
  expect(stored).toBe('{"pro":true}');
});

it.each([
  ['restore', '{"pro":true}', false],
  ['purchase', '{"pro":false}', true],
])('does not let a delayed cache read overwrite a confirmed %s result', async (action, oldCache, active) => {
  let finishRead;
  AsyncStorage.getItem.mockReturnValueOnce(new Promise((resolve) => { finishRead = resolve; }));
  const entitlements = useEntitlements();
  effects.forEach((effect) => effect());
  if (action === 'restore') await entitlements.restore();
  else await entitlements.purchase(PRODUCTS.pro.id);
  expect(state[0]).toBe(active);
  finishRead(oldCache);
  await new Promise((resolve) => setImmediate(resolve));
  expect(state).toEqual([active, true]);
  expect(JSON.parse(stored)).toEqual({ pro: active });
});

it('revokes live access before a slow cache write finishes', async () => {
  stored = '{"pro":true}';
  const entitlements = await mount();
  let finishWrite;
  AsyncStorage.setItem.mockImplementationOnce((_key, value) => new Promise((resolve) => {
    finishWrite = () => { stored = value; resolve(); };
  }));
  const pending = entitlements.restore();
  await new Promise((resolve) => setImmediate(resolve));
  expect(state[0]).toBe(false);
  expect(stored).toBe('{"pro":true}');
  finishWrite();
  await pending;
  expect(JSON.parse(stored)).toEqual({ pro: false });
});

it('serializes cache writes and prevents an older purchase write from reactivating revoked access', async () => {
  const entitlements = await mount();
  let finishPurchaseWrite;
  AsyncStorage.setItem.mockImplementationOnce((_key, value) => new Promise((resolve) => {
    finishPurchaseWrite = () => { stored = value; resolve(); };
  }));
  const purchase = entitlements.purchase(PRODUCTS.pro.id);
  await new Promise((resolve) => setImmediate(resolve));
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  const restore = entitlements.restore();
  await new Promise((resolve) => setImmediate(resolve));
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  expect(state[0]).toBe(false);
  finishPurchaseWrite();
  await Promise.all([purchase, restore]);
  expect(state[0]).toBe(false);
  expect(JSON.parse(stored)).toEqual({ pro: false });
  expect(AsyncStorage.setItem.mock.calls.map(([, value]) => JSON.parse(value))).toEqual([{ pro: true }, { pro: false }]);
});

it('does not clear cached access or grant new access when a confirmed purchase cannot be persisted', async () => {
  const entitlements = await mount();
  AsyncStorage.setItem.mockRejectedValueOnce(new Error('Cache unavailable'));
  await expect(entitlements.purchase(PRODUCTS.pro.id)).rejects.toThrow('Cache unavailable');
  expect(state[0]).toBe(false);
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  expect(stored).toBe('{}');
});

it('does not reactivate a superseded grant while the newer revocation cache write is pending', async () => {
  const entitlements = await mount();
  let finishGrant;
  let finishRevocation;
  AsyncStorage.setItem
    .mockImplementationOnce((_key, value) => new Promise((resolve) => {
      finishGrant = () => { stored = value; resolve(); };
    }))
    .mockImplementationOnce((_key, value) => new Promise((resolve) => {
      finishRevocation = () => { stored = value; resolve(); };
    }));
  const grant = entitlements.purchase(PRODUCTS.pro.id);
  await new Promise((resolve) => setImmediate(resolve));
  const revocation = entitlements.restore();
  await new Promise((resolve) => setImmediate(resolve));
  expect(state[0]).toBe(false);
  finishGrant();
  await new Promise((resolve) => setImmediate(resolve));
  const accessWhileRevocationPending = state[0];
  finishRevocation();
  await Promise.all([grant, revocation]);
  expect(accessWhileRevocationPending).toBe(false);
  expect(state[0]).toBe(false);
  expect(JSON.parse(stored)).toEqual({ pro: false });
});

it('processes a revocation after an earlier queued grant cache write rejects', async () => {
  const entitlements = await mount();
  let rejectGrant;
  AsyncStorage.setItem.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectGrant = reject; }));
  const grant = entitlements.purchase(PRODUCTS.pro.id).catch(error => error);
  await new Promise((resolve) => setImmediate(resolve));
  const revocation = entitlements.restore();
  const revokedResult = revocation.catch(error => error);
  await new Promise((resolve) => setImmediate(resolve));
  rejectGrant(new Error('Prior grant cache failed'));
  expect(await grant).toBeInstanceOf(Error);
  expect(await revokedResult).toEqual({ pro: false });
  expect(state[0]).toBe(false);
  expect(JSON.parse(stored)).toEqual({ pro: false });
});
