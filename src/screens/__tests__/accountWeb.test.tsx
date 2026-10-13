/**
 * The website's account and shop end to end inside the page: the real web
 * client (accountClient.web.ts) under useAccount, drawn by Settings and the
 * paywall, with the site's api/ answered by a fake `fetch`. A site that runs
 * no API (GitHub Pages, Netlify) answers api/config with its 404 page, and
 * then nothing is drawn and nothing more is asked; a site whose API is
 * configured draws Sign in with Google and sells Pro at its price.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.2.3' } } }));

import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Platform, Text } from 'react-native';

import { accountClient } from '../../lib/accountClient.web';
import { DEFAULTS } from '../../lib/settings';
import { useAccount } from '../../lib/useAccount';
import PaywallScreen from '../PaywallScreen';
import SettingsScreen from '../SettingsScreen';

const PAGE = 'https://drawdraw.example/drawdraw/';
const realOS = Platform.OS;
const realFetch = global.fetch;
const realLocation = Object.getOwnPropertyDescriptor(window, 'location');
let fetchMock: jest.Mock;
let tree: ReactTestRenderer | undefined;

/** The page as App.tsx draws it: the account from the platform's client, handed to both screens. */
function Page() {
  const account = useAccount({ client: accountClient });
  if (!account.settled) return null;
  return (
    <>
      <SettingsScreen settings={DEFAULTS} onChange={() => {}} onReset={() => {}} onClose={() => {}} account={account} />
      <PaywallScreen onClose={() => {}} onPurchase={async () => {}} onRestore={async () => {}} account={account} />
    </>
  );
}

const texts = () => {
  if (!tree) throw new Error('nothing is mounted');
  return tree.root.findAllByType(Text).map((t) => [].concat(t.props.children).join(''));
};

beforeEach(() => {
  Platform.OS = 'web';
  Object.defineProperty(window, 'location', {
    value: { href: PAGE, pathname: '/drawdraw/', search: '', assign: jest.fn() },
    configurable: true,
  });
  fetchMock = jest.fn();
  global.fetch = fetchMock;
});

afterEach(async () => {
  const mounted = tree;
  if (mounted) await act(async () => mounted.unmount());
  tree = undefined;
  Platform.OS = realOS;
  global.fetch = realFetch;
  if (realLocation) Object.defineProperty(window, 'location', realLocation);
  else Reflect.deleteProperty(window, 'location');
});

async function mount() {
  await act(async () => {
    tree = renderer.create(<Page />);
  });
  await act(async () => {});
}

const asked = () => fetchMock.mock.calls.map(([url]) => String(url));

it('draws no sign-in and no shop where api/config is the site\'s 404, and asks nothing more', async () => {
  fetchMock.mockResolvedValue(new Response('<!doctype html><h1>That page isn’t here</h1>', { status: 404 }));
  await mount();
  expect(asked()).toEqual(['https://drawdraw.example/drawdraw/api/config']);
  expect(texts()).not.toContain('Account');
  expect(texts()).not.toContain('Sign in with Google');
  expect(texts()).not.toContain('Sign in to buy');
  expect(texts()).not.toContain('Buy');
  // The paywall is the store provider's, as on any site without the API.
  expect(texts()).toContain('Unlock Pro · not available in this build');
  expect(texts()).toContain('Nothing leaves your device: the page sends nothing of yours, and your portraits are never uploaded.');
});

it('draws sign-in, and sells Pro at its price, where the API is configured', async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/config')) {
      return Response.json({
        auth: { google: true },
        shop: {
          products: [{ id: 'pro', name: 'DrawDraw Pro', description: 'Everything.', mode: 'payment', price: { unit_amount: 799, currency: 'usd' } }],
        },
      });
    }
    if (url.endsWith('/api/me')) return Response.json({ user: null, entitlements: [] });
    return new Response(null, { status: 404 });
  });
  await mount();
  expect(asked()).toEqual(['https://drawdraw.example/drawdraw/api/config', 'https://drawdraw.example/drawdraw/api/me']);
  expect(texts()).toContain('Account');
  expect(texts()).toContain('Sign in with Google');
  expect(texts()).toContain('Sign in to buy');
  expect(texts()).toContain('$7.99');
  expect(texts().some((t) => t.startsWith('Unlock Pro'))).toBe(false);
  expect(texts().some((t) => t.startsWith('Nothing leaves your device unless you sign in or buy.'))).toBe(true);
});
