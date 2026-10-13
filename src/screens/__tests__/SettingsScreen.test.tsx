/**
 * What the settings screen does with a tap: the switch writes its field and
 * nothing else, Reset asks first and then resets, the source link is the one
 * URL the app hands out, and every control has a name a screen reader can say.
 */
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.2.3' } } }));
jest.mock('../../lib/confirm', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));

import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Linking, Platform, Switch, Text } from 'react-native';

import { ACCOUNT_OFF, type AccountState } from '../../lib/account';
import { confirmAction, notify } from '../../lib/confirm';
import { DEFAULTS } from '../../lib/settings';
import SettingsScreen, { APP_VERSION, SOURCE_URL, type SettingsScreenProps } from '../SettingsScreen';

let tree: ReactTestRenderer | null = null;

/** The screen as last mounted. */
const root = () => {
  if (!tree) throw new Error('nothing is mounted');
  return tree.root;
};
const props = () => ({
  settings: { ...DEFAULTS },
  onChange: jest.fn(),
  onReset: jest.fn(),
  onClose: jest.fn(),
});

async function mount(p: SettingsScreenProps) {
  await act(async () => {
    tree = renderer.create(<SettingsScreen {...p} />);
  });
  return tree;
}

const pressByText = async (label: string) => {
  const node = root()
    .findAll((n) => n.props && typeof n.props.onPress === 'function')
    .find((n) => n.findAllByType(Text).some((t) => [].concat(t.props.children).join('') === label));
  expect(node).toBeDefined();
  await act(async () => node?.props.onPress());
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(async () => {
  const mounted = tree;
  if (mounted) await act(async () => mounted.unmount());
  tree = null;
  jest.restoreAllMocks();
});

it('writes the Vibration switch as its own field, leaving the rest alone', async () => {
  const p = props();
  await mount(p);
  const toggle = root().findByType(Switch);
  expect(toggle.props.value).toBe(true);
  await act(async () => toggle.props.onValueChange(false));
  expect(p.onChange).toHaveBeenCalledWith({ haptics: false });
});

it('asks before resetting, and resets only when told to', async () => {
  const p = props();
  await mount(p);
  await pressByText('Reset to defaults');

  expect(confirmAction).toHaveBeenCalledTimes(1);
  const ask = jest.mocked(confirmAction).mock.calls[0]![0]; // called once, above
  expect(ask.title).toBe('Reset settings?');
  expect(ask.message).toMatch(/portraits.*Pro/i); // says what it does not touch
  expect(ask.cancelLabel).toBe('Cancel');
  expect(ask.confirmLabel).toBe('Reset');
  expect(p.onReset).not.toHaveBeenCalled();
  ask.onConfirm();
  expect(p.onReset).toHaveBeenCalledTimes(1);
});

it('hands the source link, and only that, to the operating system', async () => {
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await mount(props());
  await pressByText('MIT licence · source');
  expect(Linking.openURL).toHaveBeenCalledTimes(1);
  expect(Linking.openURL).toHaveBeenCalledWith(SOURCE_URL);
  expect(SOURCE_URL).toBe('https://github.com/Platteration/drawdraw');
});

it('shows the version the build carries', async () => {
  expect(APP_VERSION).toBe('1.2.3');
  await mount(props());
  expect(root().findAllByType(Text).some((t) => [].concat(t.props.children).join('') === 'DrawDraw 1.2.3')).toBe(true);
});

it('closes', async () => {
  const p = props();
  await mount(p);
  await pressByText('Close');
  expect(p.onClose).toHaveBeenCalledTimes(1);
});

it('gives every control a role, and the switch its label', async () => {
  await mount(props());
  const pressables = root().findAll((n) => n.props && typeof n.props.onPress === 'function' && typeof n.type !== 'string');
  expect(pressables.length).toBeGreaterThanOrEqual(3); // Close, Reset, the link
  for (const node of pressables) expect(node.props.accessibilityRole).toMatch(/^(button|link)$/);
  expect(root().findByType(Switch).props.accessibilityLabel).toBe('Vibration');
});

describe('the Vibration row in a browser', () => {
  const realOS = Platform.OS;
  afterEach(() => {
    Platform.OS = realOS;
  });

  it('is off and disabled, and says why, rather than a switch that changes nothing', async () => {
    Platform.OS = 'web';
    await mount(props()); // haptics on in the record
    const toggle = root().findByType(Switch);
    expect(toggle.props.disabled).toBe(true);
    expect(toggle.props.value).toBe(false);
    expect(root().findAllByType(Text).some((t) => String(t.props.children).startsWith('A browser cannot vibrate'))).toBe(true);
  });

  it('is a live switch on a device', async () => {
    Platform.OS = 'ios';
    await mount(props());
    const toggle = root().findByType(Switch);
    expect(toggle.props.disabled).toBe(false);
    expect(toggle.props.value).toBe(true);
  });
});

describe('the Account section, on a website that offers sign-in', () => {
  const realOS = Platform.OS;
  afterEach(() => {
    Platform.OS = realOS;
  });

  /** An account as useAccount builds it, with every action recorded. */
  const account = (over: Partial<AccountState> = {}): AccountState => ({
    ...ACCOUNT_OFF,
    signInOn: true,
    signIn: jest.fn(),
    signOut: jest.fn(async () => null),
    deleteAccount: jest.fn(async () => null),
    buyPro: jest.fn(async () => null),
    ...over,
  });
  const texts = () => root().findAllByType(Text).map((t) => [].concat(t.props.children).join(''));

  it('is not drawn in the phone app, or on a site with no account', async () => {
    await mount(props());
    expect(texts()).not.toContain('Account');
    expect(texts()).not.toContain('Sign in with Google');
    await mount({ ...props(), account: ACCOUNT_OFF });
    expect(texts()).not.toContain('Sign in with Google');
  });

  it('offers to sign in when no one is', async () => {
    const a = account();
    await mount({ ...props(), account: a });
    expect(texts()).toContain('Account');
    expect(texts()).not.toContain('Sign out');
    await pressByText('Sign in with Google');
    expect(a.signIn).toHaveBeenCalledTimes(1);
  });

  it('names who is signed in, and signs them out', async () => {
    const a = account({ user: { email: 'ada@example.com' } });
    await mount({ ...props(), account: a });
    expect(texts()).toContain('Signed in as ada@example.com');
    expect(texts()).not.toContain('Sign in with Google');
    await pressByText('Sign out');
    expect(a.signOut).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('says "Signed in with Google" when Google gave no verified address', async () => {
    await mount({ ...props(), account: account({ user: { email: null } }) });
    expect(texts()).toContain('Signed in with Google');
  });

  it('says so through the app\'s own message when signing out did not work', async () => {
    const a = account({ user: { email: null }, signOut: jest.fn(async () => 'Could not sign out. Try again.') });
    await mount({ ...props(), account: a });
    await pressByText('Sign out');
    expect(notify).toHaveBeenCalledWith('Sign out', 'Could not sign out. Try again.');
  });

  it('asks before deleting the account, says Pro goes with it, and deletes only when told to', async () => {
    const a = account({ user: { email: 'ada@example.com' } });
    await mount({ ...props(), account: a });
    await pressByText('Delete account');
    expect(confirmAction).toHaveBeenCalledTimes(1);
    const ask = jest.mocked(confirmAction).mock.calls[0]![0]; // called once, above
    expect(ask.title).toBe('Delete account?');
    expect(ask.message).toMatch(/Pro/);
    expect(ask.message).toMatch(/payment itself stays with Stripe/);
    expect(ask.confirmLabel).toBe('Delete account');
    expect(ask.cancelLabel).toBe('Keep my account');
    expect(a.deleteAccount).not.toHaveBeenCalled();
    await act(async () => ask.onConfirm());
    expect(a.deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('gives each of its controls a role', async () => {
    await mount({ ...props(), account: account({ user: { email: 'ada@example.com' } }) });
    const pressables = root().findAll((n) => n.props && typeof n.props.onPress === 'function' && typeof n.type !== 'string');
    for (const node of pressables) expect(node.props.accessibilityRole).toMatch(/^(button|link)$/);
  });

  it('says what leaves the device, exactly, for each build', async () => {
    Platform.OS = 'ios';
    await mount({ ...props(), account: account() });
    expect(texts()).toContain('Nothing leaves your device: the app has no network access.');
    Platform.OS = 'web';
    await mount(props());
    expect(texts()).toContain('Nothing leaves your device: the page sends nothing of yours, and your portraits are never uploaded.');
    await mount({ ...props(), account: account() });
    expect(texts().some((t) => t.startsWith('Nothing leaves your device unless you sign in or buy.'))).toBe(true);
  });
});
