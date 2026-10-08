/**
 * What the settings screen does with a tap: the switch writes its field and
 * nothing else, Reset asks first and then resets, the source link is the one
 * URL the app hands out, and every control has a name a screen reader can say.
 */
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.2.3' } } }));
jest.mock('../../lib/confirm', () => ({ confirmAction: jest.fn() }));

import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Linking, Platform, Switch, Text } from 'react-native';

import { confirmAction } from '../../lib/confirm';
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
