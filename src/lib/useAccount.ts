import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ACCOUNT_NOTES,
  ACCOUNT_OFF,
  LOAD_LIMIT_MS,
  PRO_ENTITLEMENT,
  PRO_PRODUCT,
  SIGNED_OUT,
  WORDS,
  pollFor,
  type AccountClient,
  type AccountState,
  type Me,
  type ShopProduct,
} from './account';
import { accountClient } from './accountClient';

/**
 * The website's account and shop, for App.tsx. In the phone app the
 * platform's client is the inert twin, so this is ACCOUNT_OFF from the first
 * frame and stays so: nothing is asked and nothing is drawn. On the web it asks
 * the site's `api/config` once; anything but a sign-in that is on (a 404 on
 * GitHub Pages, a network error, a body that is not the kit's, no answer within
 * LOAD_LIMIT_MS) leaves it off for good, with nothing stored and nothing
 * retried, and the page exactly as it is without it.
 */
interface State {
  settled: boolean;
  on: boolean;
  shop: ShopProduct | null;
  me: Me;
  notice: string | null;
}

const OFF_STATE: State = { settled: true, on: false, shop: null, me: SIGNED_OUT, notice: null };
const LOADING: State = { ...OFF_STATE, settled: false };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface UseAccountOptions {
  /** The tests' client, clock and limit; the app passes none. */
  client?: AccountClient;
  wait?: (ms: number) => Promise<void>;
  limitMs?: number;
}

export function useAccount({ client = accountClient, wait = sleep, limitMs = LOAD_LIMIT_MS }: UseAccountOptions = {}): AccountState {
  const [state, setState] = useState<State>(() => (client.web ? LOADING : OFF_STATE));
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!client.web) return undefined;
    let late = false;
    // The first frame waits for this, so it has an end: an API that never
    // answers leaves the site as it is without an account, not blank.
    const limit = setTimeout(() => {
      late = true;
      if (alive.current) setState((s) => (s.settled ? s : OFF_STATE));
    }, limitMs);
    void (async () => {
      const config = await client.config();
      if (!alive.current || late) return;
      if (!config) {
        clearTimeout(limit);
        setState(OFF_STATE);
        return;
      }
      const landing = client.takeLanding();
      const me = (await client.me()) ?? SIGNED_OUT;
      if (!alive.current || late) return;
      clearTimeout(limit);
      const shop = config.pro;
      const bought = landing.purchase === 'success' && shop !== null;
      const holds = (m: Me) => m.entitlements.includes(PRO_ENTITLEMENT);
      const thanks = shop ? WORDS.thanks(shop.name) : null;
      setState({
        settled: true,
        on: true,
        shop,
        me,
        notice: landing.signIn === 'failed' ? WORDS.signInFailed : bought && holds(me) ? thanks : null,
      });
      if (!bought || holds(me)) return;
      // Stripe's webhook grants the purchase, and may land after the visitor is back.
      const { held, me: last } = await pollFor(PRO_ENTITLEMENT, () => client.me(), wait);
      if (!alive.current) return;
      setState((s) => ({ ...s, me: last ?? s.me, notice: held ? thanks : WORDS.paymentPending }));
    })();
    return () => {
      alive.current = false;
      clearTimeout(limit);
    };
  }, [client, wait, limitMs]);

  const refresh = useCallback(async () => {
    const me = await client.me();
    if (alive.current) setState((s) => ({ ...s, me: me ?? SIGNED_OUT }));
  }, [client]);

  const signOut = useCallback(async () => {
    if (!(await client.signOut())) return ACCOUNT_NOTES.signOutFailed;
    await refresh();
    return null;
  }, [client, refresh]);

  const deleteAccount = useCallback(async () => {
    if (!(await client.deleteAccount())) return ACCOUNT_NOTES.deleteFailed;
    await refresh();
    return null;
  }, [client, refresh]);

  const buyPro = useCallback(async () => {
    const result = await client.checkout(PRO_PRODUCT);
    if (result === 'redirecting') return null;
    if (result === 'signin' || result === 'owned') {
      // The session ended, or the purchase is already on record: what the page shows is stale.
      await refresh();
      return null;
    }
    return ACCOUNT_NOTES[result];
  }, [client, refresh]);

  return useMemo<AccountState>(
    () =>
      state.on
        ? {
            settled: true,
            signInOn: true,
            shop: state.shop,
            user: state.me.user,
            entitlements: state.me.entitlements,
            notice: state.notice,
            dismissNotice: () => setState((s) => ({ ...s, notice: null })),
            signIn: () => client.signIn(),
            signOut,
            deleteAccount,
            buyPro,
          }
        : state.settled
          ? ACCOUNT_OFF
          : { ...ACCOUNT_OFF, settled: false },
    [state, client, signOut, deleteAccount, buyPro]
  );
}
