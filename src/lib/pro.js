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
 * go through the store provider and only grant on a resolved transaction.
 */
export function useEntitlements() {
  const [pro, setPro] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    read().then((e) => {
      setPro(!!e.pro);
      setReady(true);
    });
  }, []);

  const grant = useCallback(async () => {
    const entitlements = { ...(await read()), pro: true };
    await write(entitlements);
    setPro(true);
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
    const result = await purchases.restore();
    if (result?.pro) await grant();
    return result;
  }, [grant]);

  return { pro, ready, purchase, restore };
}
