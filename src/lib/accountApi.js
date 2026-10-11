/**
 * The account service, as the app talks to it. Pure: no React, no React
 * Native, no storage, so it is tested directly. `account.js` adds the browser
 * session, secure token storage and the hook.
 *
 * The service lives with Portrait Value Studio (art-project/server). One
 * Google account signs in there and here; what is bought in the studio's shop
 * shows up as entitlements, and `drawdraw.pro` is the one this app reads.
 */

export const PRO_ENTITLEMENT = 'drawdraw.pro';

export function hasEntitlement(entitlements, key) {
  return Array.isArray(entitlements) && entitlements.includes(key);
}

/** Trims a configured base URL, or returns '' when the service is not configured. */
export function normalizeBaseUrl(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.replace(/\/+$/, '');
}

/** The URL the system browser opens to start the server-side Google flow for this app. */
export function buildStartUrl({ baseUrl, redirect, codeChallenge, loginHint }) {
  const params = new URLSearchParams({ client: 'app', redirect, code_challenge: codeChallenge });
  if (loginHint) params.set('login_hint', loginHint);
  return `${baseUrl}/auth/google/start?${params}`;
}

/**
 * Reads the URL the browser session came back on. Returns `{ code }` on
 * success, `{ error }` when Google or the service refused, or null when the
 * URL carries neither (the user closed the browser, or the URL is foreign).
 */
export function parseAuthRedirect(url) {
  if (typeof url !== 'string' || !url) return null;
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  const params = new URLSearchParams(query);
  const code = params.get('code');
  if (code) return { code };
  const error = params.get('error');
  if (error) return { error };
  return null;
}

export class AccountError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * A minimal client over fetch. `token` is the bearer session the exchange
 * handed back. Network failures surface as AccountError('network').
 */
export function createAccountClient({ baseUrl, fetch: fetchImpl }) {
  const base = normalizeBaseUrl(baseUrl);
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);

  async function call(path, { method = 'GET', token, body } = {}) {
    if (!base) throw new AccountError('not_configured', 'The account service is not configured in this build.');
    if (!doFetch) throw new AccountError('network', 'No fetch available.');
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try {
      res = await doFetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (err) {
      throw new AccountError('network', `Could not reach the account service: ${err?.message ?? err}`);
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      throw new AccountError(data?.error || `http_${res.status}`, data?.message || `The account service answered ${res.status}.`, res.status);
    }
    return data;
  }

  return {
    get configured() {
      return base !== '';
    },
    baseUrl: base,
    /** Who the token belongs to and what they own. */
    me: (token) => call('/me', { token }),
    /** Turns the one-time code from the browser into a bearer session, proving the PKCE verifier. */
    exchange: ({ code, verifier }) => call('/auth/exchange', { method: 'POST', body: { code, code_verifier: verifier } }),
    products: () => call('/shop/products'),
  };
}
