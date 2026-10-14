/**
 * The paywall shows the provider's product, never the listing's own price:
 * the listing says what the store should charge, and only a provider knows
 * whether anything is for sale and what it costs where the user is.
 */
// PaywallScreen pulls in pro.ts for the feature lists, which pulls in AsyncStorage.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));
jest.mock('../../lib/confirm', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));

import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { ACCOUNT_OFF, type AccountState } from '../../lib/account';
import { notify } from '../../lib/confirm';
import { notConfiguredProvider, PRODUCTS, setPurchaseProvider } from '../../lib/purchases';
import PaywallScreen from '../PaywallScreen';

const CURRENCY = /[$£€¥]\s?\d|\d+[.,]\d\d/;
let tree: ReactTestRenderer | null = null;

/** The paywall as last mounted. */
const root = () => {
  if (!tree) throw new Error('nothing is mounted');
  return tree.root;
};

const buyLabel = () =>
  root()
    .findAllByType(Text)
    .map((t) => [].concat(t.props.children).join(''))
    .find((s) => s.startsWith('Unlock Pro'));

const onPurchase = jest.fn(async () => {});
const onRestore = jest.fn(async () => {});

async function mount(account?: AccountState) {
  await act(async () => {
    tree = renderer.create(<PaywallScreen onClose={() => {}} onPurchase={onPurchase} onRestore={onRestore} account={account} />);
  });
}

afterEach(async () => {
  const mounted = tree;
  if (mounted) await act(async () => mounted.unmount());
  tree = null;
});

it('shows no price when the bundled provider cannot sell', async () => {
  // The unconfigured provider is what a fresh checkout — and the public web
  // build — runs with.
  await mount();
  const label = buyLabel();
  expect(label).toBe('Unlock Pro · not available in this build');
  expect(label).not.toMatch(CURRENCY);
  // and the listing's own amount reaches no text on the screen
  expect(root().findAllByType(Text).some((t) => String(t.props.children).includes(PRODUCTS.pro.price))).toBe(false);
});

it("shows the provider's price, not the listing's, once a store is configured", async () => {
  const store = {
    configured: true,
    getProducts: async () => [{ ...PRODUCTS.pro, price: '€3,49' }],
    purchase: async () => ({ pro: true }),
    restore: async () => ({ pro: true }),
  };
  setPurchaseProvider(store);
  try {
    await mount();
    expect(buyLabel()).toBe('Unlock Pro · €3,49');
  } finally {
    setPurchaseProvider(notConfiguredProvider);
  }
});

describe('on a website whose api/ sells Pro', () => {
  const PRO = {
    id: 'pro',
    name: 'DrawDraw Pro',
    description: 'From the server, as text: <b>not markup</b>.',
    price: { unitAmount: 799, currency: 'usd' },
  };
  const account = (over: Partial<AccountState> = {}): AccountState => ({
    ...ACCOUNT_OFF,
    signInOn: true,
    shop: PRO,
    signIn: jest.fn(),
    buyPro: jest.fn(async () => null),
    ...over,
  });
  const texts = () => root().findAllByType(Text).map((t) => [].concat(t.props.children).join(''));
  const press = async (label: string) => {
    const node = root()
      .findAll((n) => n.props && typeof n.props.onPress === 'function' && typeof n.type !== 'string')
      .find((n) => n.findAllByType(Text).some((t) => [].concat(t.props.children).join('') === label));
    if (!node) throw new Error(`no control says ${label}`);
    await act(async () => node.props.onPress());
  };

  beforeEach(() => jest.clearAllMocks());

  it("shows the server's product and its price, formatted, and asks a signed-out visitor to sign in", async () => {
    const a = account();
    await mount(a);
    expect(texts()).toEqual(expect.arrayContaining(['DrawDraw Pro', 'From the server, as text: <b>not markup</b>.']));
    expect(texts().some((t) => /^\$7\.99$/.test(t))).toBe(true);
    // The store provider's button and Restore are the phone app's; here signing in is the restore.
    expect(texts().some((t) => t.startsWith('Unlock Pro'))).toBe(false);
    expect(texts()).not.toContain('Restore purchase');
    expect(texts()).not.toContain('Buy');
    await press('Sign in to buy');
    expect(a.signIn).toHaveBeenCalledTimes(1);
    expect(a.buyPro).not.toHaveBeenCalled();
  });

  it('buys through Checkout once signed in, and never through the store provider', async () => {
    const a = account({ user: { email: 'ada@example.com' } });
    await mount(a);
    await press('Buy');
    expect(a.buyPro).toHaveBeenCalledTimes(1);
    expect(onPurchase).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('sends one Buy at a time: drawn disabled while a press is out, and a second press asks nothing', async () => {
    // The kit's "For the page": a press that reaches Stripe while another's session is being
    // made is answered 502, so the page keeps Buy disabled until the first press has its answer.
    let answer: (note: string | null) => void = () => {};
    const a = account({
      user: { email: null },
      buyPro: jest.fn(() => new Promise<string | null>((resolve) => (answer = resolve))),
    });
    await mount(a);
    const buy = () => {
      const node = root()
        .findAll((n) => n.props && typeof n.props.onPress === 'function' && typeof n.type !== 'string')
        .find((n) => n.findAllByType(Text).some((t) => [].concat(t.props.children).join('') === 'Buy'));
      if (!node) throw new Error('no control says Buy');
      return node;
    };
    expect([buy().props.disabled, buy().props.accessibilityState]).toEqual([false, { disabled: false }]);
    // Not awaited: the press is out until `answer` is called.
    await act(async () => {
      void buy().props.onPress();
    });
    expect(a.buyPro).toHaveBeenCalledTimes(1);
    expect([buy().props.disabled, buy().props.accessibilityState]).toEqual([true, { disabled: true }]);
    // A press that gets through anyway (the handler called directly) is refused too.
    await act(async () => {
      void buy().props.onPress();
    });
    expect(a.buyPro).toHaveBeenCalledTimes(1);
    await act(async () => answer('The shop could not be reached. Try again.'));
    expect(notify).toHaveBeenCalledWith('Could not buy', 'The shop could not be reached. Try again.');
    expect(buy().props.disabled).toBe(false);
    await act(async () => {
      void buy().props.onPress();
    });
    expect(a.buyPro).toHaveBeenCalledTimes(2);
    await act(async () => answer(null));
  });

  it('says why when Checkout could not be opened', async () => {
    const a = account({ user: { email: null }, buyPro: jest.fn(async () => 'DrawDraw Pro is not on sale right now.') });
    await mount(a);
    await press('Buy');
    expect(notify).toHaveBeenCalledWith('Could not buy', 'DrawDraw Pro is not on sale right now.');
  });

  it('says Owned, and offers nothing, once the server says Pro is held', async () => {
    await mount(account({ user: { email: null }, entitlements: ['pro'] }));
    expect(texts()).toContain('Owned');
    expect(texts()).not.toContain('Buy');
    expect(texts()).not.toContain('Sign in to buy');
  });

  it('is sold without a price the server could not read', async () => {
    await mount(account({ user: { email: null }, shop: { ...PRO, price: null } }));
    expect(texts()).toContain('Buy');
    expect(texts().some((t) => CURRENCY.test(t))).toBe(false);
  });

  it("is the store provider's screen, as it always was, on a site that signs in but sells nothing", async () => {
    await mount(account({ shop: null, user: { email: null } }));
    expect(buyLabel()).toBe('Unlock Pro · not available in this build');
    expect(texts()).toContain('Restore purchase');
    expect(texts()).not.toContain('Buy');
  });
});
