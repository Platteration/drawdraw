const {
  AccountError,
  PRO_ENTITLEMENT,
  buildStartUrl,
  createAccountClient,
  hasEntitlement,
  normalizeBaseUrl,
  parseAuthRedirect,
} = require('../accountApi');

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('entitlements', () => {
  test('pro is one named key', () => {
    expect(PRO_ENTITLEMENT).toBe('drawdraw.pro');
    expect(hasEntitlement(['studio.supporter', 'drawdraw.pro'], PRO_ENTITLEMENT)).toBe(true);
    expect(hasEntitlement(['studio.supporter'], PRO_ENTITLEMENT)).toBe(false);
    expect(hasEntitlement(undefined, PRO_ENTITLEMENT)).toBe(false);
    expect(hasEntitlement('drawdraw.pro', PRO_ENTITLEMENT)).toBe(false);
  });
});

describe('normalizeBaseUrl', () => {
  test('empty or missing means not configured', () => {
    expect(normalizeBaseUrl(undefined)).toBe('');
    expect(normalizeBaseUrl('   ')).toBe('');
  });
  test('trailing slashes are dropped', () => {
    expect(normalizeBaseUrl('https://studio.example/api/')).toBe('https://studio.example/api');
    expect(normalizeBaseUrl(' https://studio.example/api ')).toBe('https://studio.example/api');
  });
});

describe('buildStartUrl', () => {
  test('asks for the app flow with the redirect and PKCE challenge', () => {
    const url = new URL(
      buildStartUrl({ baseUrl: 'https://studio.example/api', redirect: 'drawdraw://auth', codeChallenge: 'abc_-123' })
    );
    expect(url.origin + url.pathname).toBe('https://studio.example/api/auth/google/start');
    expect(url.searchParams.get('client')).toBe('app');
    expect(url.searchParams.get('redirect')).toBe('drawdraw://auth');
    expect(url.searchParams.get('code_challenge')).toBe('abc_-123');
    expect(url.searchParams.has('login_hint')).toBe(false);
  });
  test('passes a login hint when given', () => {
    const url = new URL(
      buildStartUrl({ baseUrl: 'https://s.example/api', redirect: 'drawdraw://auth', codeChallenge: 'c', loginHint: 'ada@example.com' })
    );
    expect(url.searchParams.get('login_hint')).toBe('ada@example.com');
  });
});

describe('parseAuthRedirect', () => {
  test('reads the code from a custom-scheme URL', () => {
    expect(parseAuthRedirect('drawdraw://auth?code=abc.def.ghi')).toEqual({ code: 'abc.def.ghi' });
  });
  test('reads the code from an Expo Go URL with a path', () => {
    expect(parseAuthRedirect('exp://192.168.1.4:8081/--/auth?code=xyz')).toEqual({ code: 'xyz' });
  });
  test('reports a refusal', () => {
    expect(parseAuthRedirect('drawdraw://auth?error=access_denied')).toEqual({ error: 'access_denied' });
  });
  test('null for anything else', () => {
    expect(parseAuthRedirect('drawdraw://auth')).toBeNull();
    expect(parseAuthRedirect('')).toBeNull();
    expect(parseAuthRedirect(undefined)).toBeNull();
    expect(parseAuthRedirect('drawdraw://auth#code=nope')).toBeNull();
  });
});

describe('createAccountClient', () => {
  test('is not configured without a base URL and says so', async () => {
    const client = createAccountClient({ baseUrl: '', fetch: jest.fn() });
    expect(client.configured).toBe(false);
    await expect(client.me('t')).rejects.toMatchObject({ code: 'not_configured' });
  });

  test('me sends the bearer token and returns the account', async () => {
    const fetch = jest.fn(async () => jsonResponse({ user: { id: 'google:1' }, entitlements: ['drawdraw.pro'] }));
    const client = createAccountClient({ baseUrl: 'https://s.example/api/', fetch });
    const me = await client.me('tok');
    expect(me.entitlements).toEqual(['drawdraw.pro']);
    expect(fetch).toHaveBeenCalledWith('https://s.example/api/me', {
      method: 'GET',
      headers: { accept: 'application/json', authorization: 'Bearer tok' },
      body: undefined,
    });
  });

  test('exchange posts the code and verifier as JSON', async () => {
    const fetch = jest.fn(async () => jsonResponse({ token: 'session', user: {}, entitlements: [] }));
    const client = createAccountClient({ baseUrl: 'https://s.example/api', fetch });
    const out = await client.exchange({ code: 'c', verifier: 'v' });
    expect(out.token).toBe('session');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://s.example/api/auth/exchange');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ code: 'c', code_verifier: 'v' });
  });

  test('service errors carry the service code; network failures are network', async () => {
    const refused = createAccountClient({
      baseUrl: 'https://s.example/api',
      fetch: async () => jsonResponse({ error: 'bad_verifier', message: 'nope' }, 401),
    });
    await expect(refused.exchange({ code: 'c', verifier: 'v' })).rejects.toMatchObject({ code: 'bad_verifier', status: 401, message: 'nope' });

    const down = createAccountClient({
      baseUrl: 'https://s.example/api',
      fetch: async () => {
        throw new Error('ECONNRESET');
      },
    });
    const err = await down.me('t').catch((e) => e);
    expect(err).toBeInstanceOf(AccountError);
    expect(err.code).toBe('network');

    const broken = createAccountClient({
      baseUrl: 'https://s.example/api',
      fetch: async () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } }),
    });
    await expect(broken.me('t')).rejects.toMatchObject({ code: 'http_502' });
  });
});
