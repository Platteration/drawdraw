/**
 * A two-button confirm through Alert.alert is a no-op on react-native-web:
 * `class Alert { static alert() {} }`, so the destructive action it guards can
 * never run there. The helper is what every confirmation in the app uses, so
 * this is where that stays fixed.
 */
import { Alert, Platform } from 'react-native';

import { confirmAction } from '../confirm';

const realOS = Platform.OS;
const hadWindow = typeof global.window !== 'undefined';
const realConfirm = hadWindow ? global.window.confirm : undefined;

const ask = (onConfirm) =>
  confirmAction({
    title: 'Remove drawing?',
    message: 'This removes the saved portrait and its guide setup.',
    cancelLabel: 'Cancel',
    confirmLabel: 'Remove',
    onConfirm,
  });

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  if (!hadWindow) global.window = {};
});

afterEach(() => {
  Platform.OS = realOS;
  jest.restoreAllMocks();
  if (hadWindow) global.window.confirm = realConfirm;
  else delete global.window;
});

describe('on the web', () => {
  beforeEach(() => {
    Platform.OS = 'web';
  });

  it('asks through the browser dialog and runs the action on OK', () => {
    global.window.confirm = jest.fn(() => true);
    const onConfirm = jest.fn();
    ask(onConfirm);
    expect(global.window.confirm).toHaveBeenCalledTimes(1);
    expect(global.window.confirm.mock.calls[0][0]).toMatch(/^Remove drawing\?\n\nThis removes/);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled(); // the stub would have shown nothing
  });

  it('does nothing on Cancel', () => {
    global.window.confirm = jest.fn(() => false);
    const onConfirm = jest.fn();
    ask(onConfirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('on a device', () => {
  it('shows two buttons: cancel first, the destructive one named with its verb', () => {
    Platform.OS = 'ios';
    const onConfirm = jest.fn();
    ask(onConfirm);

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = Alert.alert.mock.calls[0];
    expect(title).toBe('Remove drawing?');
    expect(message).toBe('This removes the saved portrait and its guide setup.');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toEqual({ text: 'Cancel', style: 'cancel' });
    expect(buttons[1]).toMatchObject({ text: 'Remove', style: 'destructive' });
    expect(onConfirm).not.toHaveBeenCalled(); // nothing runs until the button is pressed
    buttons[1].onPress();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
