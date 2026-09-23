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

import React, { useEffect } from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { purchases } from '../purchases';
import { useEntitlements, type EntitlementState } from '../pro';

let entitlements: EntitlementState | undefined;
const capture = (value: EntitlementState) => {
  entitlements = value;
};
/** The hook's value as of the latest render; there has to have been one. */
const current = (): EntitlementState => {
  if (!entitlements) throw new Error('the hook has not rendered');
  return entitlements;
};
/**
 * Hands the hook's value out from an effect, so nothing outside a component
 * is written during render (react-hooks/globals); `act` flushes effects, so
 * every read below still sees the value of the latest render.
 */
function Probe({ onValue }: { onValue: (value: EntitlementState) => void }) {
  const value = useEntitlements();
  useEffect(() => onValue(value), [value, onValue]);
  return null;
}

let trees: ReactTestRenderer[] = [];

async function mount() {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(<Probe onValue={capture} />);
  });
  if (!tree) throw new Error('nothing was rendered');
  trees.push(tree);
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  entitlements = undefined;
  trees = [];
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
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
      jest.mocked(purchases.purchase).mockResolvedValueOnce(result);
      await mount();
      await act(async () => {
        await current().purchase('com.platteration.drawdraw.pro');
      });
      expect(current().pro).toBe(false);
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    }
  });

  it('unlocks Pro on a result that says the entitlement was acquired', async () => {
    jest.mocked(purchases.purchase).mockResolvedValue({ pro: true, productId: 'x' });
    await mount();
    await act(async () => {
      await current().purchase('com.platteration.drawdraw.pro');
    });
    expect(current().pro).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'drawdraw.entitlements.v1',
      JSON.stringify({ pro: true })
    );
  });

  it('reads the same rule as restore', async () => {
    // The two used to disagree: restore checked result.pro, purchase did not.
    jest.mocked(purchases.restore).mockResolvedValue({ pro: false });
    await mount();
    await act(async () => {
      await current().restore();
    });
    expect(current().pro).toBe(false);

    jest.mocked(purchases.restore).mockResolvedValue({ pro: true });
    await act(async () => {
      await current().restore();
    });
    expect(current().pro).toBe(true);
  });

  it('lets a store error through to the paywall', async () => {
    const error = new Error('In-app purchases are not configured in this build.');
    jest.mocked(purchases.purchase).mockRejectedValue(error);
    await mount();
    await expect(current().purchase('x')).rejects.toThrow(error.message);
    expect(current().pro).toBe(false);
  });
});

describe('the stored record', () => {
  it('grants Pro on a stored true and on nothing that merely looks like one', async () => {
    // The read site, not only the validator: a stored record is plain
    // localStorage on the web build, and a truthiness check here would take
    // any of these as a purchase.
    for (const raw of ['{"pro":1}', '{"pro":"true"}', '{"pro":"constructor"}', '{"__proto__":{"pro":true}}', '"pro"']) {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue(raw);
      await mount();
      expect(current().ready).toBe(true);
      expect(current().pro).toBe(false);
    }
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('{"pro":true}');
    await mount();
    expect(current().pro).toBe(true);
  });

  it('writes back the flag alone, not whatever the stored record carried', async () => {
    // `grant` spreads the record it read; read raw, a stored extra field would
    // be persisted for good on the first purchase.
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('{"pro":false,"receipt":"x","__proto__":{"y":1}}');
    jest.mocked(purchases.purchase).mockResolvedValue({ pro: true });
    await mount();
    await act(async () => {
      await current().purchase('com.platteration.drawdraw.pro');
    });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('drawdraw.entitlements.v1', JSON.stringify({ pro: true }));
  });
});

describe('ready', () => {
  it('stays false until the stored entitlement has actually been read', async () => {
    // `pro` starts false, so a caller that renders before this is true shows
    // a paying customer the free build.
    let resolveRead: (raw: string | null) => void = () => {};
    jest.mocked(AsyncStorage.getItem).mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveRead = resolve;
      })
    );

    await mount();
    expect(current().ready).toBe(false);
    expect(current().pro).toBe(false);

    await act(async () => resolveRead(JSON.stringify({ pro: true })));
    expect(current().ready).toBe(true);
    expect(current().pro).toBe(true);
  });

  it('settles even when storage is unreadable', async () => {
    // Holding the first frame on this flag means it must never hang.
    jest.mocked(AsyncStorage.getItem).mockRejectedValue(new Error('storage unavailable'));
    await mount();
    expect(current().ready).toBe(true);
    expect(current().pro).toBe(false);
  });
});
