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
 * GitHub Pages, a network error, a body that is not the kit's) leaves it off
 * for good, with nothing stored and nothing retried, and the page exactly as it
 * is without it. An answer that takes longer than LOAD_LIMIT_MS does not hold
 * the first frame past it: the page is drawn as one without an account, and the
 * answer is applied when it comes, so a paying visitor gets Pro then rather
 * than the free build for the rest of the visit.
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
  // Which visitor an answer is about: moves on whenever the page learns that
  // nobody is signed in any more (sign-out, deletion, a session that ended), so
  // an answer asked for before that is not applied after it.
  const visitor = useRef(0);

  useEffect(() => {
    alive.current = true;
    if (!client.web) return undefined;
    // The first frame waits for this, so it has an end: an API that does not
    // answer in time leaves the site drawn as it is without an account, not
    // blank. What answers after that is applied below all the same.
    const limit = setTimeout(() => {
      if (alive.current) setState((s) => (s.settled ? s : OFF_STATE));
    }, limitMs);
    void (async () => {
      const config = await client.config();
      if (!alive.current) return;
      if (!config) {
        clearTimeout(limit);
        setState(OFF_STATE);
        return;
      }
      const landing = client.takeLanding();
      const me = (await client.me()) ?? SIGNED_OUT;
      if (!alive.current) return;
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
      const asked = visitor.current;
      const { held, me: last } = await pollFor(PRO_ENTITLEMENT, () => client.me(), wait);
      // Signed out meanwhile: the page already says so, and neither line is theirs to see.
      if (!alive.current || visitor.current !== asked) return;
      setState((s) => ({ ...s, me: last ?? s.me, notice: held ? thanks : WORDS.paymentPending }));
    })();
    return () => {
      alive.current = false;
      clearTimeout(limit);
    };
  }, [client, wait, limitMs]);

  const refresh = useCallback(async () => {
    const me = (await client.me()) ?? SIGNED_OUT;
    if (!alive.current) return;
    if (me.user) {
      setState((s) => ({ ...s, me }));
      return;
    }
    // The line at the top speaks to the visitor who was signed in (thanks for
    // their purchase, their payment on its way): with nobody signed in it goes,
    // rather than thank a page that now offers Pro for sale.
    visitor.current += 1;
    setState((s) => ({ ...s, me, notice: null }));
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
