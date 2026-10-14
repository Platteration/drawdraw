/**
 * Sign in with Google and DrawDraw Pro, on the website: what the page reads
 * from the site's own `api/` (server/kit, on the same origin), checked before
 * anything is drawn from it, and the words the page says. Pure: no React, no
 * React Native, no network and no address, so a plain test loads it.
 *
 * The network lives in `accountClient.web.ts`, which Metro bundles into the
 * web build alone. Its native twin, `accountClient.ts`, reports "not
 * configured" and opens nothing: the phone apps keep their no-network posture
 * (INTERNET stays blocked in the shipped manifest) and their own store seam in
 * purchases.ts, since the App Store and Google Play want their own in-app
 * purchase for a digital unlock. `useAccount.ts` builds the screens' state from
 * whichever of the two the platform resolves.
 *
 * Everything the server says is untrusted here, the way a stored record is
 * (settings.ts): it is read field by field, and what does not hold up is left
 * out rather than drawn. It is drawn as text, never as markup. And what it
 * unlocks is drawing aids in a page the visitor runs: someone who edits the
 * page can turn Pro's guide lines on without paying. The server's record of a
 * purchase is what a sale is; the unlock is not protection, and the docs say so.
 */

/** The one product the website sells, as server/catalogue.js names it. */
export const PRO_PRODUCT = 'pro';
/** The entitlement a paid Pro grants, as `GET api/me` reports it. */
export const PRO_ENTITLEMENT = 'pro';

/** An id as the kit writes one: a product, an entitlement. */
const ID = /^[a-z][a-z0-9-]{0,31}$/;

/** A price as Stripe states it: in the currency's smallest unit. */
export interface Price {
  unitAmount: number;
  /** ISO 4217, lowercase, as Stripe writes it. */
  currency: string;
}

export interface ShopProduct {
  id: string;
  name: string;
  description: string;
  /** Null when the server could not read it from Stripe: the product is still sold. */
  price: Price | null;
}

/** What `GET api/config` says is on. Null, wherever it is read, means the feature does not exist. */
export interface ApiConfig {
  /** Sign in with Google: true whenever this exists, since the kit sells nothing without it. */
  signIn: true;
  /** DrawDraw Pro when the shop sells it; null when the shop is off. */
  pro: ShopProduct | null;
}

export interface Account {
  /** Null when Google did not say the address is verified. */
  email: string | null;
}

/** What `GET api/me` says: who is signed in, and what they own. */
export interface Me {
  user: Account | null;
  entitlements: readonly string[];
}

export const SIGNED_OUT: Me = { user: null, entitlements: [] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Text of at most `max` characters with no control character: what a label may hold. */
function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

function readPrice(raw: unknown): Price | null {
  if (!isRecord(raw)) return null;
  const amount = raw.unit_amount;
  const currency = raw.currency;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return null;
  if (typeof currency !== 'string' || !/^[a-z]{3}$/.test(currency)) return null;
  return { unitAmount: amount, currency };
}

/**
 * `GET api/config`'s body, or null when the feature does not exist: anything
 * that is not the kit's shape, and a body that turns sign-in off (the kit
 * sells nothing without it, and a Buy that can never sign in is a button that
 * does nothing). Pro is read from the product list when it is there as this
 * app sells it (once, `payment`); any other product is not this build's to draw.
 */
export function readApiConfig(raw: unknown): ApiConfig | null {
  if (!isRecord(raw) || !isRecord(raw.auth) || raw.auth.google !== true) return null;
  const listed = isRecord(raw.shop) && Array.isArray(raw.shop.products) ? raw.shop.products : [];
  let pro: ShopProduct | null = null;
  for (const item of listed) {
    if (!isRecord(item) || item.id !== PRO_PRODUCT || item.mode !== 'payment') continue;
    const name = text(item.name, 100);
    const description = text(item.description, 500);
    if (!name || description === null) continue;
    pro = { id: PRO_PRODUCT, name, description, price: readPrice(item.price) };
    break;
  }
  return { signIn: true, pro };
}

/** `GET api/me`'s body, or null when it is not the kit's shape. */
export function readMe(raw: unknown): Me | null {
  if (!isRecord(raw) || !Array.isArray(raw.entitlements)) return null;
  let user: Account | null = null;
  if (raw.user !== null) {
    if (!isRecord(raw.user)) return null;
    user = { email: text(raw.user.email, 320) || null };
  }
  const entitlements = [
    ...new Set(raw.entitlements.filter((e): e is string => typeof e === 'string' && ID.test(e))),
  ].slice(0, 50);
  return { user, entitlements };
}

/** Stripe's zero-decimal currencies: an amount of 499 JPY is ¥499. */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
/** Stripe's three-decimal currencies: an amount of 1500 KWD is 1.500 KWD. */
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

/**
 * A price for people to read, in the visitor's locale (`undefined`: the
 * browser's own). Null when the platform cannot format the currency, in which
 * case the product is shown without one.
 */
export function formatPrice(price: Price, locale?: string): string | null {
  const divisor = ZERO_DECIMAL.has(price.currency) ? 1 : THREE_DECIMAL.has(price.currency) ? 1000 : 100;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: price.currency.toUpperCase() }).format(
      price.unitAmount / divisor
    );
  } catch {
    return null;
  }
}

/** What the address said on arrival: the kit's `?signin=failed`, and Checkout's return. */
export interface Landing {
  signIn: 'failed' | null;
  purchase: 'success' | 'cancelled' | null;
}

export const NO_LANDING: Landing = { signIn: null, purchase: null };

/**
 * What an address says on arrival, and the same address without it (null when
 * there was nothing of ours to take out). Only the values the kit writes are
 * read and removed; a `?purchase=` of any other value is not ours and stays.
 */
export function landingOf(href: string): { landing: Landing; without: string | null } {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { landing: NO_LANDING, without: null };
  }
  const signin = url.searchParams.get('signin');
  const purchase = url.searchParams.get('purchase');
  const landing: Landing = {
    signIn: signin === 'failed' ? 'failed' : null,
    purchase: purchase === 'success' || purchase === 'cancelled' ? purchase : null,
  };
  if (landing.signIn) url.searchParams.delete('signin');
  if (landing.purchase) url.searchParams.delete('purchase');
  if (!landing.signIn && !landing.purchase) return { landing, without: null };
  return { landing, without: `${url.pathname}${url.search}${url.hash}` };
}

/** How often, and how many times, `api/me` is asked after Checkout sends the visitor back. */
export const POLL = { tries: 5, everyMs: 3000 } as const;

/**
 * Asks `readMe` up to POLL.tries times, POLL.everyMs apart, until it reports
 * `entitlement`: a purchase is granted by Stripe's webhook, which may land
 * after the visitor is back. Returns the last answer and whether it held the
 * entitlement.
 */
export async function pollFor(
  entitlement: string,
  readMe: () => Promise<Me | null>,
  wait: (ms: number) => Promise<void>
): Promise<{ held: boolean; me: Me | null }> {
  let me: Me | null = null;
  for (let i = 0; i < POLL.tries; i += 1) {
    await wait(POLL.everyMs);
    me = await readMe();
    if (me?.entitlements.includes(entitlement)) return { held: true, me };
  }
  return { held: false, me };
}

/**
 * How long the web build waits for `api/config` and `api/me` before it draws
 * the app as a site without an account. The first frame waits for them, so a
 * paying visitor is not shown the free build and then Pro; an API that does
 * not answer must not leave the page blank. An answer that comes after it is
 * still applied (useAccount.ts): a slow API costs the visitor a few seconds of
 * the free build, never Pro for the rest of the visit.
 */
export const LOAD_LIMIT_MS = 5000;

/** How `POST api/checkout` ended, as the page reads it. */
export type CheckoutResult = 'redirecting' | 'signin' | 'owned' | 'unavailable' | 'busy' | 'failed';

/**
 * The website's account and shop, as a platform provides them. The web
 * build's talks to the site's api/; the native twin answers "not configured"
 * to everything and opens nothing.
 */
export interface AccountClient {
  /** Whether this build can ask for api/ at all: false in the native twin. */
  readonly web: boolean;
  /** `GET api/config`; null for a 404, a network error, a body that is not JSON or nothing on. */
  config(): Promise<ApiConfig | null>;
  /** `GET api/me`; null when it cannot be read. */
  me(): Promise<Me | null>;
  /** A top-level navigation to `api/auth/google/start`, returning here. */
  signIn(): void;
  /** `POST api/auth/logout`: whether the server ended the session. */
  signOut(): Promise<boolean>;
  /** `DELETE api/me`: whether the server deleted the account. */
  deleteAccount(): Promise<boolean>;
  /** `POST api/checkout`, and on success a navigation to Stripe's Checkout. */
  checkout(product: string): Promise<CheckoutResult>;
  /** What the address said on arrival, read once and taken out of it. */
  takeLanding(): Landing;
}

/**
 * The account and the shop as the screens see them (useAccount.ts builds it).
 * `ACCOUNT_OFF` is the phone app, and a website with no account: settled from
 * the first frame, nothing drawn, every action a no-op.
 */
export interface AccountState {
  /**
   * Whether the first frame may draw: at once in the phone app; on the web once
   * `api/config` (and, when it is on, `api/me`) has answered, failed, or taken
   * longer than LOAD_LIMIT_MS, in which case what they say later is applied then.
   */
  settled: boolean;
  /** Whether the site offers sign-in: Settings draws its Account rows only then. */
  signInOn: boolean;
  /** DrawDraw Pro when the site sells it. While it does, Pro is what `api/me` says and nothing else. */
  shop: ShopProduct | null;
  /** Who is signed in, when someone is. */
  user: Account | null;
  /** What the server says the visitor owns: the only record of a purchase on the web. */
  entitlements: readonly string[];
  /** One line for the screen: sign-in failed, Pro unlocked, or the payment still on its way. */
  notice: string | null;
  dismissNotice: () => void;
  /** Leaves for Google, and comes back here. */
  signIn: () => void;
  /** Each returns what to tell the visitor when it did not work, or null. */
  signOut: () => Promise<string | null>;
  deleteAccount: () => Promise<string | null>;
  /** Leaves for Stripe's Checkout when it can; otherwise says why it did not. */
  buyPro: () => Promise<string | null>;
}

export const ACCOUNT_OFF: AccountState = {
  settled: true,
  signInOn: false,
  shop: null,
  user: null,
  entitlements: [],
  notice: null,
  dismissNotice: () => {},
  signIn: () => {},
  signOut: async () => null,
  deleteAccount: async () => null,
  buyPro: async () => null,
};

/** The words the account and the shop say, the same in every app that carries the kit. */
export const WORDS = {
  section: 'Account',
  signIn: 'Sign in with Google',
  signedInAs: (email: string) => `Signed in as ${email}`,
  signedIn: 'Signed in with Google',
  signOut: 'Sign out',
  deleteAccount: 'Delete account',
  signInFailed: "Sign-in didn't complete.",
  buy: 'Buy',
  signInToBuy: 'Sign in to buy',
  owned: 'Owned',
  thanks: (name: string) => `Thank you — ${name} is unlocked.`,
  paymentPending: 'Payment received. It can take a minute to appear — reload to check.',
  dismiss: 'Dismiss',
} as const;

/** What the page asks before it deletes an account, and what it says when something fails. */
export const ACCOUNT_NOTES = {
  deleteTitle: 'Delete account?',
  deleteBody:
    'This deletes your account on this site, and DrawDraw Pro with it: Pro stops being unlocked here. The payment itself stays with Stripe, with the account id it was made under. Your portraits are not touched. This cannot be undone.',
  deleteConfirm: 'Delete account',
  deleteCancel: 'Keep my account',
  deleteFailed: 'The account could not be deleted. Try again.',
  signOutFailed: 'Could not sign out. Try again.',
  unavailable: 'DrawDraw Pro is not on sale right now.',
  busy: 'Too many tries for now. Try again in a while.',
  failed: 'The shop could not be reached. Try again.',
} as const;

/** What the About card says leaves the device: in the phone app, which has no network access. */
export const PRIVACY_NATIVE = 'Nothing leaves your device: the app has no network access.';
/** ...on a website with no account: the page asks its own site whether sign-in is offered, and sends nothing else. */
export const PRIVACY_WEB = 'Nothing leaves your device: the page sends nothing of yours, and your portraits are never uploaded.';
/** ...and on a website whose api/ offers sign-in. */
export const PRIVACY_WEB_ACCOUNT =
  "Nothing leaves your device unless you sign in or buy. Signing in with Google tells this site an account id and your email address; a purchase is paid through Stripe, which handles the payment and is told that account id with it. The site keeps the account id, what was bought, Stripe's customer id and, for 30 days, the Checkout page it last sent you to, and your email address only while you are signed in. Your portraits are never uploaded.";
