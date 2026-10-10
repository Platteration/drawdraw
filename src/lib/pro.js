import { useCallback, useEffect, useRef, useState } from 'react';
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
    const cached = raw ? JSON.parse(raw) : null;
    return { pro: cached?.pro === true };
  } catch {
    return {};
  }
}

async function write(entitlements) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(entitlements));
  } catch (error) {
    // Removing a stale grant is a safe fallback when replacing it fails.
    if (entitlements.pro === false) {
      try {
        await AsyncStorage.removeItem(KEY);
        return;
      } catch {
        // Preserve the persistence error for the caller to report.
      }
    }
    throw error;
  }
}

/**
 * Entitlement state. `pro` gates the paid surface; `purchase` and `restore`
 * go through the store provider and only grant on explicit confirmation.
 * The local boolean is an offline cache, not receipt verification; a shipping
 * billing provider must validate and refresh entitlements with the store.
 */
export function useEntitlements() {
  const [pro, setPro] = useState(false);
  const [ready, setReady] = useState(false);
  const revision = useRef(0);
  const cacheWrites = useRef(Promise.resolve());

  useEffect(() => {
    let mounted = true;
    const initialRevision = revision.current;
    read().then((e) => {
      if (!mounted) return;
      if (revision.current === initialRevision) {
        setPro(purchases.configured && e.pro === true);
      }
      setReady(true);
    });
    return () => { mounted = false; };
  }, []);

  const updateEntitlement = useCallback(async (active) => {
    const currentRevision = ++revision.current;
    // Store-confirmed revocation applies even if the local cache is unavailable.
    if (!active) setPro(false);
    const pending = cacheWrites.current.then(() => write({ pro: active }));
    cacheWrites.current = pending.catch(() => {});
    await pending;
    if (revision.current === currentRevision) setPro(active);
  }, []);

  const purchase = useCallback(
    async (productId) => {
      const result = await purchases.purchase(productId);
      await updateEntitlement(true);
      return result;
    },
    [updateEntitlement]
  );

  const restore = useCallback(async () => {
    const result = await purchases.restore();
    await updateEntitlement(result.pro);
    return result;
  }, [updateEntitlement]);

  return { pro, ready, purchase, restore };
}
