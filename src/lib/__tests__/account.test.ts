/**
 * The website's account model: what the page reads from the site's api/
 * (server/kit) and the words it says. Everything the server sends is read
 * field by field, as a stored record is, and what does not hold up is left
 * out rather than drawn.
 */
import {
  ACCOUNT_NOTES,
  ACCOUNT_OFF,
  formatPrice,
  landingOf,
  NO_LANDING,
  POLL,
  pollFor,
  PRIVACY_NATIVE,
  PRIVACY_WEB,
  PRIVACY_WEB_ACCOUNT,
  PRO_ENTITLEMENT,
  PRO_PRODUCT,
  readApiConfig,
  readMe,
  WORDS,
  type Me,
} from '../account';

/** `api/config` as server/kit writes it with the shop on. */
const configured = () => ({
  auth: { google: true },
  shop: {
    products: [
      {
        id: 'pro',
        name: 'DrawDraw Pro',
        description: 'The full construction head.',
        mode: 'payment',
        price: { unit_amount: 799, currency: 'usd' },
      },
    ],
  },
});

describe('readApiConfig', () => {
  it('reads sign-in and Pro, with its price, from the kit\'s answer', () => {
    expect(readApiConfig(configured())).toEqual({
      signIn: true,
      pro: { id: 'pro', name: 'DrawDraw Pro', description: 'The full construction head.', price: { unitAmount: 799, currency: 'usd' } },
    });
  });

  it('says the feature does not exist for anything but a sign-in that is on', () => {
    for (const raw of [
      undefined,
      null,
      'nothing',
      [],
      {},
      { auth: { google: false }, shop: { products: [] } }, // the kit with nothing configured
      { auth: { google: 'true' } },
      { auth: true },
      JSON.parse('{"auth":{"__proto__":{"google":true}}}'),
    ]) {
      expect(readApiConfig(raw)).toBeNull();
    }
  });

  it('has sign-in without a shop when Pro is not sold', () => {
    expect(readApiConfig({ auth: { google: true }, shop: { products: [] } })).toEqual({ signIn: true, pro: null });
    expect(readApiConfig({ auth: { google: true } })).toEqual({ signIn: true, pro: null });
    expect(readApiConfig({ auth: { google: true }, shop: { products: 'pro' } })).toEqual({ signIn: true, pro: null });
  });

  it('draws only Pro as this app sells it, once, and only labels it can show as text', () => {
    const with_ = (patch: Record<string, unknown>) => {
      const raw = configured();
      return readApiConfig({ ...raw, shop: { products: [{ ...raw.shop.products[0], ...patch }] } });
    };
    expect(with_({ id: 'supporter' })?.pro).toBeNull(); // another app's product
    expect(with_({ mode: 'subscription' })?.pro).toBeNull();
    expect(with_({ name: '' })?.pro).toBeNull();
    expect(with_({ name: 'Pro\u0000' })?.pro).toBeNull();
    expect(with_({ name: 'x'.repeat(101) })?.pro).toBeNull();
    expect(with_({ description: 7 })?.pro).toBeNull();
    expect(with_({ description: 'line\nbreak' })?.pro).toBeNull();
    // Markup is text here, and drawn as text: it is not refused, and it is not markup.
    expect(with_({ name: '<b>Pro</b>' })?.pro?.name).toBe('<b>Pro</b>');
  });

  it('lists Pro without a price it cannot read, and never with a wrong one', () => {
    const priceOf = (price: unknown) => {
      const raw = configured();
      return readApiConfig({ ...raw, shop: { products: [{ ...raw.shop.products[0], price }] } })?.pro?.price;
    };
    expect(priceOf(undefined)).toBeNull(); // the kit could not read it from Stripe
    expect(priceOf({ unit_amount: -1, currency: 'usd' })).toBeNull();
    expect(priceOf({ unit_amount: 7.99, currency: 'usd' })).toBeNull();
    expect(priceOf({ unit_amount: '799', currency: 'usd' })).toBeNull();
    expect(priceOf({ unit_amount: 799, currency: 'USD' })).toBeNull();
    expect(priceOf({ unit_amount: 799, currency: 'usdx' })).toBeNull();
    expect(priceOf({ unit_amount: 0, currency: 'eur' })).toEqual({ unitAmount: 0, currency: 'eur' });
  });
});

describe('readMe', () => {
  it('reads who is signed in and what they own', () => {
    expect(readMe({ user: { email: 'ada@example.com' }, entitlements: ['pro'] })).toEqual({
      user: { email: 'ada@example.com' },
      entitlements: ['pro'],
    });
    expect(readMe({ user: {}, entitlements: [] })).toEqual({ user: { email: null }, entitlements: [] });
    expect(readMe({ user: null, entitlements: [] })).toEqual({ user: null, entitlements: [] });
  });

  it('refuses a body that is not the kit\'s, and keeps only ids among the entitlements', () => {
    for (const raw of [null, {}, { user: null }, { user: 'ada', entitlements: [] }, { user: null, entitlements: 'pro' }]) {
      expect(readMe(raw)).toBeNull();
    }
    expect(readMe({ user: null, entitlements: ['pro', 'pro', 'Pro', '', 7, null, '__proto__', 'x'.repeat(40)] })?.entitlements).toEqual(['pro']);
    expect(readMe({ user: null, entitlements: Array.from({ length: 80 }, (_, i) => `e${i}`) })?.entitlements).toHaveLength(50);
    // An email that is not text, or holds a control character, is not shown.
    expect(readMe({ user: { email: { toString: () => 'x' } }, entitlements: [] })?.user).toEqual({ email: null });
    expect(readMe({ user: { email: 'a@b\r\nc' }, entitlements: [] })?.user).toEqual({ email: null });
  });
});

describe('formatPrice', () => {
  it('divides by what the currency counts in, as Stripe does', () => {
    expect(formatPrice({ unitAmount: 799, currency: 'usd' }, 'en-US')).toBe('$7.99');
    expect(formatPrice({ unitAmount: 499, currency: 'jpy' }, 'en-US')).toBe('¥499');
    // Intl puts a no-break space between an amount and a code or a trailing symbol.
    const spaced = (text: string | null) => text?.replace(/\s/g, ' ');
    expect(spaced(formatPrice({ unitAmount: 1500, currency: 'kwd' }, 'en-US'))).toBe('KWD 1.500');
    expect(spaced(formatPrice({ unitAmount: 799, currency: 'eur' }, 'de-DE'))).toBe('7,99 €');
  });

  it('is null for a currency the platform cannot format', () => {
    expect(formatPrice({ unitAmount: 799, currency: 'zz1' })).toBeNull();
  });
});

describe('landingOf', () => {
  it('reads the kit\'s and Checkout\'s words, and gives the address back without them', () => {
    expect(landingOf('https://drawdraw.example/drawdraw/?signin=failed')).toEqual({
      landing: { signIn: 'failed', purchase: null },
      without: '/drawdraw/',
    });
    expect(landingOf('https://drawdraw.example/?purchase=success&x=1#top')).toEqual({
      landing: { signIn: null, purchase: 'success' },
      without: '/?x=1#top',
    });
    expect(landingOf('https://drawdraw.example/?purchase=cancelled').landing).toEqual({ signIn: null, purchase: 'cancelled' });
  });

  it('leaves an address alone that says nothing of ours', () => {
    for (const href of ['https://drawdraw.example/', 'https://drawdraw.example/?signin=ok', 'https://drawdraw.example/?purchase=free', 'not a url']) {
      expect(landingOf(href)).toEqual({ landing: NO_LANDING, without: null });
    }
  });
});

describe('pollFor', () => {
  const me = (entitlements: string[]): Me => ({ user: { email: null }, entitlements });

  it('asks five times over fifteen seconds, and stops as soon as the purchase shows', async () => {
    expect(POLL.tries * POLL.everyMs).toBe(15000);
    const waits: number[] = [];
    const answers = [me([]), me([]), me(['pro'])];
    const read = jest.fn(async () => answers.shift() ?? null);
    const result = await pollFor(PRO_ENTITLEMENT, read, async (ms) => void waits.push(ms));
    expect(result).toEqual({ held: true, me: me(['pro']) });
    expect(read).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([3000, 3000, 3000]);
  });

  it('gives up after five, with the last answer', async () => {
    const read = jest.fn(async () => me([]));
    const result = await pollFor(PRO_ENTITLEMENT, read, async () => {});
    expect(result).toEqual({ held: false, me: me([]) });
    expect(read).toHaveBeenCalledTimes(5);
  });
});

describe('the words', () => {
  it('are the ones every app with the kit says', () => {
    expect(PRO_PRODUCT).toBe('pro');
    expect(PRO_ENTITLEMENT).toBe('pro');
    expect(WORDS.signIn).toBe('Sign in with Google');
    expect(WORDS.signedInAs('ada@example.com')).toBe('Signed in as ada@example.com');
    expect(WORDS.signedIn).toBe('Signed in with Google');
    expect(WORDS.signOut).toBe('Sign out');
    expect(WORDS.deleteAccount).toBe('Delete account');
    expect(WORDS.signInFailed).toBe("Sign-in didn't complete.");
    expect(WORDS.buy).toBe('Buy');
    expect(WORDS.signInToBuy).toBe('Sign in to buy');
    expect(WORDS.owned).toBe('Owned');
    expect(WORDS.thanks('DrawDraw Pro')).toBe('Thank you — DrawDraw Pro is unlocked.');
    expect(WORDS.paymentPending).toBe('Payment received. It can take a minute to appear — reload to check.');
  });

  it('say what leaves the device, exactly, for each build', () => {
    expect(PRIVACY_NATIVE).toBe('Nothing leaves your device: the app has no network access.');
    expect(PRIVACY_WEB).toMatch(/^Nothing leaves your device: /);
    expect(PRIVACY_WEB).not.toMatch(/no network access/); // the page asks its own site for api/config
    expect(PRIVACY_WEB_ACCOUNT).toMatch(/^Nothing leaves your device unless you sign in or buy\. /);
    for (const kept of ['an account id', 'your email address', 'Stripe', "Stripe's customer id", 'what was bought']) {
      expect(PRIVACY_WEB_ACCOUNT).toContain(kept);
    }
    // A Checkout tells Stripe the visitor's account id (server/api.test.mjs reads it off the
    // session the kit asks for), and deleting the account here does not take it back.
    expect(PRIVACY_WEB_ACCOUNT).toContain('Stripe, which handles the payment and is told that account id with it.');
    // The kit remembers the Checkout Session it last gave the account for a product, 30 days,
    // so that a second Buy before Stripe's webhook is given the same one (server/kit/README.md).
    expect(PRIVACY_WEB_ACCOUNT).toContain('for 30 days, the Checkout page it last sent you to');
    expect(ACCOUNT_NOTES.deleteBody).toContain('The payment itself stays with Stripe, with the account id it was made under.');
  });

  it('leave the phone app with nothing: ACCOUNT_OFF draws and does nothing', async () => {
    expect(ACCOUNT_OFF).toMatchObject({ settled: true, signInOn: false, shop: null, user: null, entitlements: [], notice: null });
    await expect(ACCOUNT_OFF.buyPro()).resolves.toBeNull();
  });
});
