import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { purchases } from './purchases';

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
 * Entitlement state. `pro` gates the paid surface; `purchase` and `restore`
 * go through the store provider and grant only on a result that says the
 * entitlement was actually acquired — see src/lib/purchases.js for the
 * contract a real provider has to meet.
 *
 * `ready` is how a caller tells "not Pro" from "not read yet": `pro` starts
 * false and the stored entitlement only arrives a tick later, so anything
 * that gates on `pro` has to wait for this or it shows a paying customer the
 * free build for a frame.
 */
export function useEntitlements() {
  const [pro, setPro] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    read()
      .then((e) => setPro(!!e.pro))
      // The app holds its first frame until `ready`, so this must settle even
      // if storage is unavailable — better a free build than a blank screen.
      .finally(() => setReady(true));
  }, []);

  const grant = useCallback(async () => {
    const entitlements = { ...(await read()), pro: true };
    await write(entitlements);
    setPro(true);
  }, []);

  const purchase = useCallback(
    async (productId) => {
      const result = await purchases.purchase(productId);
      // A resolved promise is not a sale. Store SDKs routinely resolve with
      // `userCancelled`, or with a deferred/pending transaction, rather than
      // rejecting — granting on resolution alone would unlock Pro when the
      // user backs out of the sheet.
      if (result?.pro) await grant();
      return result;
    },
    [grant]
  );

  const restore = useCallback(async () => {
    const result = await purchases.restore();
    if (result?.pro) await grant();
    return result;
  }, [grant]);

  return { pro, ready, purchase, restore };
}
