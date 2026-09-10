/**
 * The entitlement seam. Billing is not wired up in this repo, so these are
 * the rules the next person to wire it up inherits: what counts as a sale,
 * and how a caller tells "not Pro" from "not read yet".
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
}));
jest.mock('../purchases', () => ({
  purchases: { purchase: jest.fn(), restore: jest.fn() },
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { purchases } from '../purchases';
import { useEntitlements } from '../pro';

let entitlements;
function Probe() {
  entitlements = useEntitlements();
  return null;
}

let trees = [];

async function mount() {
  let tree;
  await act(async () => {
    tree = renderer.create(<Probe />);
  });
  trees.push(tree);
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  entitlements = undefined;
  trees = [];
  AsyncStorage.getItem.mockResolvedValue(null);
});

afterEach(async () => {
  for (const tree of trees) await act(async () => tree.unmount());
});

describe('purchase', () => {
  it('does not unlock Pro when the store resolves without granting it', async () => {
    // StoreKit 2, Play Billing and RevenueCat all report a user backing out
    // of the payment sheet as a *resolved* result, not a rejection. Granting
    // on resolution alone gives Pro away to anyone who opens the sheet and
    // changes their mind.
    for (const result of [{ userCancelled: true }, { pending: true }, {}, undefined, null]) {
      purchases.purchase.mockResolvedValueOnce(result);
      await mount();
      await act(async () => {
        await entitlements.purchase('com.platteration.drawdraw.pro');
      });
      expect(entitlements.pro).toBe(false);
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    }
  });

  it('unlocks Pro on a result that says the entitlement was acquired', async () => {
    purchases.purchase.mockResolvedValue({ pro: true, productId: 'x' });
    await mount();
    await act(async () => {
      await entitlements.purchase('com.platteration.drawdraw.pro');
    });
    expect(entitlements.pro).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'drawdraw.entitlements.v1',
      JSON.stringify({ pro: true })
    );
  });

  it('reads the same rule as restore', async () => {
    // The two used to disagree: restore checked result.pro, purchase did not.
    purchases.restore.mockResolvedValue({ pro: false });
    await mount();
    await act(async () => {
      await entitlements.restore();
    });
    expect(entitlements.pro).toBe(false);

    purchases.restore.mockResolvedValue({ pro: true });
    await act(async () => {
      await entitlements.restore();
    });
    expect(entitlements.pro).toBe(true);
  });

  it('lets a store error through to the paywall', async () => {
    const error = new Error('In-app purchases are not configured in this build.');
    purchases.purchase.mockRejectedValue(error);
    await mount();
    await expect(entitlements.purchase('x')).rejects.toThrow(error.message);
    expect(entitlements.pro).toBe(false);
  });
});

describe('ready', () => {
  it('stays false until the stored entitlement has actually been read', async () => {
    // `pro` starts false, so a caller that renders before this is true shows
    // a paying customer the free build.
    let resolveRead;
    AsyncStorage.getItem.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      })
    );

    await mount();
    expect(entitlements.ready).toBe(false);
    expect(entitlements.pro).toBe(false);

    await act(async () => resolveRead(JSON.stringify({ pro: true })));
    expect(entitlements.ready).toBe(true);
    expect(entitlements.pro).toBe(true);
  });

  it('settles even when storage is unreadable', async () => {
    // Holding the first frame on this flag means it must never hang.
    AsyncStorage.getItem.mockRejectedValue(new Error('storage unavailable'));
    await mount();
    expect(entitlements.ready).toBe(true);
    expect(entitlements.pro).toBe(false);
  });
});
