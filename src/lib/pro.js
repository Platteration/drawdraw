import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { purchases } from './purchases';
import { account, useAccount } from './account';
import { PRO_ENTITLEMENT, hasEntitlement } from './accountApi';

const KEY = 'drawdraw.entitlements.v1';

/**
 * What Pro unlocks — and, just as importantly, what it does not. The method
 * itself, fitting it to a photo, and all three portrait exports stay free and
 * unwatermarked, because the free tier is what makes people recommend this.
 */
export const PRO_FEATURES = [
  'The full construction head — side planes, jaw, ears, hairline, mouth, fifths',
  'Proportion packs for child, infant and stylized heads',
  'Turnaround sheets: the same head at six angles, as one layer',
  'Step-by-step construction lessons',
];

export const FREE_FEATURES = [
  'The three-segment head, in 3D, through the full 360°',
  'Fit it to any portrait from three taps',
  'Photo, transparent guide and tracing exports at full resolution',
  'No watermark, no ads, ever',
];

async function read() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function write(entitlements) {
  await AsyncStorage.setItem(KEY, JSON.stringify(entitlements));
}

/**
 * Entitlement state. `pro` gates the paid surface. It is true when the store
 * unlocked it on this device (`purchase` / `restore`, which only grant on a
 * resolved transaction) or when the signed-in account owns `drawdraw.pro`,
 * bought in the studio's shop on the web.
 */
export function useEntitlements() {
  const [localPro, setLocalPro] = useState(false);
  const [ready, setReady] = useState(false);
  const acct = useAccount();
  const accountPro = hasEntitlement(acct.entitlements, PRO_ENTITLEMENT);

  useEffect(() => {
    read().then((e) => {
      setLocalPro(!!e.pro);
      setReady(true);
    });
  }, []);

  const grant = useCallback(async () => {
    const entitlements = { ...(await read()), pro: true };
    await write(entitlements);
    setLocalPro(true);
  }, []);

  const purchase = useCallback(
    async (productId) => {
      const result = await purchases.purchase(productId);
      await grant();
      return result;
    },
    [grant]
  );

  const restore = useCallback(async () => {
    // A signed-in account that owns Pro restores without a store round trip.
    if (account.configured && account.getState().status === 'signed-in') {
      const refreshed = await account.refresh();
      if (hasEntitlement(refreshed.entitlements, PRO_ENTITLEMENT)) return { pro: true, source: 'account' };
      if (!purchases.configured) {
        const error = new Error(
          `No Pro purchase is attached to ${refreshed.user?.email || 'this account'}. If you bought it on the web, sign in here with that same Google account.`
        );
        error.code = 'no_purchase';
        throw error;
      }
    }
    const result = await purchases.restore();
    if (result?.pro) await grant();
    return result;
  }, [grant]);

  return { pro: localPro || accountPro, ready: ready && acct.ready, purchase, restore };
}
