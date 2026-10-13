/**
 * The website's account client, the one module of the app that makes a
 * request: to the site's own api/, relative to the page, and nowhere else.
 * Google and Stripe are top-level navigations, and Buy navigates only to an
 * address on Stripe's Checkout.
 *
 * @jest-environment node
 */
import { accountClient, apiUrl, isCheckoutUrl } from '../accountClient.web';

const PAGE = 'https://drawdraw.example/drawdraw/';

interface FakeWindow {
  location: { href: string; pathname: string; search: string; assign: jest.Mock };
  history: { state: unknown; replaceState: jest.Mock };
}

let win: FakeWindow;
let fetchMock: jest.Mock;
const realFetch = global.fetch;

/** The page at `href`, with a location the client can read and navigate. */
function at(href: string): FakeWindow {
  const url = new URL(href);
  return {
    location: { href, pathname: url.pathname, search: url.search, assign: jest.fn() },
    history: { state: { from: 'test' }, replaceState: jest.fn() },
  };
}

beforeEach(() => {
  win = at(PAGE);
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
  fetchMock = jest.fn();
  global.fetch = fetchMock;
});

afterEach(() => {
  global.fetch = realFetch;
  Reflect.deleteProperty(globalThis, 'window');
});

const answer = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), { status });

/** The one request the client made: its address and what it sent. */
const sent = () => {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers) };
};

describe('addresses', () => {
  it('asks the api/ beside the page, at the site\'s sub-path', () => {
    expect(apiUrl('config', PAGE)).toBe('https://drawdraw.example/drawdraw/api/config');
    expect(apiUrl('config', 'https://drawdraw.example/drawdraw/index.html?x=1')).toBe('https://drawdraw.example/drawdraw/api/config');
    expect(apiUrl('me', 'https://drawdraw.example/')).toBe('https://drawdraw.example/api/me');
  });

  it('sends Buy only to Stripe\'s Checkout', () => {
    expect(isCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_1')).toBe(true);
    for (const url of [
      'https://checkout.stripe.com.evil.example/c/pay/cs_1',
      'https://checkout.stripe.com@evil.example/',
      'http://checkout.stripe.com/c/pay/cs_1',
      'https://checkout.stripe.com',
      'javascript:alert(1)//https://checkout.stripe.com/',
      '//checkout.stripe.com/c/pay/cs_1',
      { toString: () => 'https://checkout.stripe.com/x' },
      undefined,
    ]) {
      expect(isCheckoutUrl(url)).toBe(false);
    }
  });
});

describe('config', () => {
  it('reads what the site\'s api/config says, from the same origin', async () => {
    fetchMock.mockResolvedValue(answer(200, { auth: { google: true }, shop: { products: [] } }));
    await expect(accountClient.config()).resolves.toEqual({ signIn: true, pro: null });
    const { url, init } = sent();
    expect(url).toBe('https://drawdraw.example/drawdraw/api/config');
    expect(init.credentials).toBe('same-origin');
    expect(init.method).toBeUndefined();
  });

  it('is null, and the feature absent, for a 404, an error, a page that is not JSON, or nothing on', async () => {
    for (const response of [
      // An error answer is not the API's, whatever its body looks like.
      () => answer(500, { auth: { google: true }, shop: { products: [] } }),
      () => answer(404, '<!doctype html><h1>That page isn’t here</h1>'),
      () => answer(502, 'Bad Gateway'),
      () => answer(200, '<!doctype html>'),
      () => answer(200, { auth: { google: false }, shop: { products: [] } }),
    ]) {
      fetchMock.mockResolvedValueOnce(response());
      await expect(accountClient.config()).resolves.toBeNull();
    }
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(accountClient.config()).resolves.toBeNull();
  });
});

describe('me', () => {
  it('asks past the HTTP cache, and reads the answer', async () => {
    fetchMock.mockResolvedValue(answer(200, { user: { email: 'ada@example.com' }, entitlements: ['pro'] }));
    await expect(accountClient.me()).resolves.toEqual({ user: { email: 'ada@example.com' }, entitlements: ['pro'] });
    const { url, init } = sent();
    expect(url).toBe('https://drawdraw.example/drawdraw/api/me');
    expect(init.cache).toBe('no-store');
  });

  it('is null when it cannot be read', async () => {
    fetchMock.mockResolvedValue(answer(404, { error: 'not_found' }));
    await expect(accountClient.me()).resolves.toBeNull();
  });
});

describe('signing in and out', () => {
  it('leaves for the kit\'s sign-in start, coming back to this page and query', () => {
    win = at('https://drawdraw.example/drawdraw/?x=1&y=2');
    Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
    accountClient.signIn();
    expect(win.location.assign).toHaveBeenCalledWith(
      'https://drawdraw.example/drawdraw/api/auth/google/start?return=%2Fdrawdraw%2F%3Fx%3D1%26y%3D2'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs out with a same-origin POST, and says whether the server did', async () => {
    fetchMock.mockResolvedValueOnce(answer(204));
    await expect(accountClient.signOut()).resolves.toBe(true);
    const { url, init, headers } = sent();
    expect([url, init.method, init.credentials]).toEqual(['https://drawdraw.example/drawdraw/api/auth/logout', 'POST', 'same-origin']);
    expect(init.body).toBeUndefined();
    expect(headers.has('content-type')).toBe(false);
    for (const response of [answer(403), answer(500)]) {
      fetchMock.mockResolvedValueOnce(response);
      await expect(accountClient.signOut()).resolves.toBe(false);
    }
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(accountClient.signOut()).resolves.toBe(false);
  });

  it('deletes the account with DELETE api/me', async () => {
    fetchMock.mockResolvedValueOnce(answer(204));
    await expect(accountClient.deleteAccount()).resolves.toBe(true);
    const { url, init } = sent();
    expect([url, init.method]).toEqual(['https://drawdraw.example/drawdraw/api/me', 'DELETE']);
    fetchMock.mockResolvedValueOnce(answer(409, { error: 'subscription_active' }));
    await expect(accountClient.deleteAccount()).resolves.toBe(false);
  });
});

describe('checkout', () => {
  it('asks for Pro as JSON and leaves for the Checkout address the server gave', async () => {
    fetchMock.mockResolvedValue(answer(200, { url: 'https://checkout.stripe.com/c/pay/cs_test_1' }));
    await expect(accountClient.checkout('pro')).resolves.toBe('redirecting');
    const { url, init, headers } = sent();
    expect([url, init.method]).toEqual(['https://drawdraw.example/drawdraw/api/checkout', 'POST']);
    expect(headers.get('content-type')).toBe('application/json'); // what an HTML form cannot send
    expect(init.body).toBe(JSON.stringify({ product: 'pro' }));
    expect(win.location.assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1');
  });

  it('goes nowhere but Checkout, whatever the server says', async () => {
    for (const body of [
      { url: 'https://checkout.stripe.com.evil.example/c/pay/cs_1' },
      { url: 'https://evil.example/' },
      { url: 'javascript:alert(1)' },
      { url: 7 },
      {},
      'not json',
    ]) {
      fetchMock.mockResolvedValueOnce(answer(200, body));
      await expect(accountClient.checkout('pro')).resolves.toBe('failed');
    }
    expect(win.location.assign).not.toHaveBeenCalled();
  });

  it('never leaves on an error answer, whatever its body says', async () => {
    fetchMock.mockResolvedValueOnce(answer(500, { url: 'https://checkout.stripe.com/c/pay/cs_test_1' }));
    await expect(accountClient.checkout('pro')).resolves.toBe('failed');
    expect(win.location.assign).not.toHaveBeenCalled();
  });

  it('reads each refusal the kit can give', async () => {
    const cases: [number, string][] = [
      [401, 'signin'],
      [409, 'owned'],
      [404, 'unavailable'],
      [429, 'busy'],
      [502, 'failed'],
      [403, 'failed'],
    ];
    for (const [status, result] of cases) {
      fetchMock.mockResolvedValueOnce(answer(status, { error: 'x' }));
      await expect(accountClient.checkout('pro')).resolves.toBe(result);
    }
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(accountClient.checkout('pro')).resolves.toBe('failed');
    expect(win.location.assign).not.toHaveBeenCalled();
  });
});

describe('takeLanding', () => {
  it('reads what the address said once, and takes it out of the address', () => {
    win = at('https://drawdraw.example/drawdraw/?purchase=success&x=1');
    Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
    expect(accountClient.takeLanding()).toEqual({ signIn: null, purchase: 'success' });
    expect(win.history.replaceState).toHaveBeenCalledWith({ from: 'test' }, '', '/drawdraw/?x=1');
  });

  it('leaves an address alone that says nothing of ours', () => {
    win = at('https://drawdraw.example/drawdraw/?x=1');
    Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
    expect(accountClient.takeLanding()).toEqual({ signIn: null, purchase: null });
    expect(win.history.replaceState).not.toHaveBeenCalled();
  });
});

it('is the web build\'s client', () => {
  expect(accountClient.web).toBe(true);
});
