/**
 * The account on the device: Google sign-in through the account service, the
 * bearer session in secure storage, and the last known profile and
 * entitlements so a Pro bought on the web still shows while offline.
 *
 * The service's address comes from EXPO_PUBLIC_ACCOUNT_API_BASE at build
 * time (see docs/ACCOUNT_SETUP.md). Without it `account.configured` is false,
 * nothing is shown, and the app behaves exactly as before.
 */
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import {
  AccountError,
  PRO_ENTITLEMENT,
  buildStartUrl,
  createAccountClient,
  hasEntitlement,
  normalizeBaseUrl,
  parseAuthRedirect,
} from './accountApi';

// On web, the page the browser popup returns to must hand the result back to
// the opener; elsewhere this is a no-op.
WebBrowser.maybeCompleteAuthSession();

const BASE_URL = normalizeBaseUrl(process.env.EXPO_PUBLIC_ACCOUNT_API_BASE);
const TOKEN_KEY = 'drawdraw.account.token.v1';
const PROFILE_KEY = 'drawdraw.account.profile.v1';

const client = createAccountClient({ baseUrl: BASE_URL });

/* ---- the session token: the keychain / keystore on a device, local storage on web ---- */

const secureStoreUsable = Platform.OS !== 'web';

async function readToken() {
  try {
    if (secureStoreUsable) return await SecureStore.getItemAsync(TOKEN_KEY);
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function writeToken(token) {
  if (secureStoreUsable) {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
    return;
  }
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

async function readProfile() {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeProfile(profile) {
  try {
    if (profile) await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    else await AsyncStorage.removeItem(PROFILE_KEY);
  } catch {
    // The token is the source of truth; a stale or missing profile is refreshed on the next load.
  }
}

/* ---- state ---- */

let state = {
  configured: client.configured,
  status: client.configured ? 'loading' : 'off', // off | loading | signed-out | signed-in
  user: null,
  entitlements: [],
  ready: !client.configured,
};
const listeners = new Set();
let token = null;
let loading = null;

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getState = () => state;

async function applySession(session) {
  const profile = { user: session.user, entitlements: session.entitlements || [] };
  await writeProfile(profile);
  setState({ status: 'signed-in', ...profile, ready: true });
}

async function clearSession() {
  token = null;
  await writeToken(null).catch(() => {});
  await writeProfile(null);
  setState({ status: 'signed-out', user: null, entitlements: [], ready: true });
}

/** Loads the stored session and refreshes it from the service. Safe to call more than once. */
function load() {
  if (!client.configured) return Promise.resolve(state);
  if (!loading) {
    loading = (async () => {
      token = await readToken();
      if (!token) {
        setState({ status: 'signed-out', ready: true });
        return state;
      }
      const cached = await readProfile();
      if (cached?.user) setState({ status: 'signed-in', user: cached.user, entitlements: cached.entitlements || [], ready: true });
      await refresh();
      return state;
    })();
  }
  return loading;
}

/**
 * Asks the service who the token belongs to. A refused token signs out; a
 * network failure keeps what was cached, so an unlock survives a flight.
 */
async function refresh() {
  if (!token) return state;
  try {
    const me = await client.me(token);
    if (!me.user) {
      await clearSession();
      return state;
    }
    await applySession(me);
  } catch (err) {
    if (err instanceof AccountError && err.status === 401) await clearSession();
    else if (!state.ready) setState({ status: state.user ? 'signed-in' : 'signed-out', ready: true });
  }
  return state;
}

function base64UrlFromBase64(text) {
  return text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Hex is in PKCE's unreserved set, so 32 random bytes make a 64-character verifier without base64. */
function hexFromBytes(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Opens the system browser on Google, through the service, and turns the
 * code it comes back with into a session. Resolves to the account state;
 * `{ cancelled: true }` when the person closed the browser instead.
 */
async function signIn() {
  if (!client.configured) throw new AccountError('not_configured', 'The account service is not configured in this build.');
  const verifier = hexFromBytes(await Crypto.getRandomBytesAsync(32));
  const challenge = base64UrlFromBase64(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 })
  );
  const redirect = Linking.createURL('auth');
  const startUrl = buildStartUrl({ baseUrl: client.baseUrl, redirect, codeChallenge: challenge, loginHint: state.user?.email });

  const result = await WebBrowser.openAuthSessionAsync(startUrl, redirect);
  if (result.type !== 'success') return { cancelled: true };
  const parsed = parseAuthRedirect(result.url);
  if (!parsed) return { cancelled: true };
  if (parsed.error) throw new AccountError(parsed.error, parsed.error === 'access_denied' ? 'Sign-in was cancelled at Google.' : `Sign-in failed: ${parsed.error}`);

  const session = await client.exchange({ code: parsed.code, verifier });
  token = session.token;
  await writeToken(token);
  await applySession(session);
  return state;
}

async function signOut() {
  await clearSession();
}

export const account = {
  get configured() {
    return client.configured;
  },
  getState,
  subscribe,
  load,
  refresh,
  signIn,
  signOut,
  hasPro: () => hasEntitlement(state.entitlements, PRO_ENTITLEMENT),
};

/** The account as React state. Starts the load on first use. */
export function useAccount() {
  const snapshot = useSyncExternalStore(subscribe, getState, getState);
  if (client.configured && !loading) load();
  return snapshot;
}
