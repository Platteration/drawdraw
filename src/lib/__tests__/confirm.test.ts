/**
 * A two-button confirm through Alert.alert is a no-op on react-native-web:
 * `class Alert { static alert() {} }`, so the destructive action it guards can
 * never run there. The helper is what every confirmation in the app uses, so
 * this is where that stays fixed.
 */
import { Alert, Platform } from 'react-native';

import { confirmAction } from '../confirm';

const realOS = Platform.OS;
const hadWindow = typeof window !== 'undefined';
const realConfirm = hadWindow ? window.confirm : undefined;

/**
 * Puts `value` where a page's confirm would be. The DOM types say a window
 * always has one; the test environment's has none, and that is what is put
 * back afterwards.
 */
const setConfirm = (value: unknown) =>
  Object.defineProperty(window, 'confirm', { value, configurable: true, writable: true });

/** A stand-in for the browser dialog that answers `answer`. */
const dialog = (answer: boolean) => {
  const confirm = jest.fn((_message?: string) => answer);
  setConfirm(confirm);
  return confirm;
};

const ask = (onConfirm: () => void) =>
  confirmAction({
    title: 'Remove drawing?',
    message: 'This removes the saved portrait and its guide setup.',
    cancelLabel: 'Cancel',
    confirmLabel: 'Remove',
    onConfirm,
  });

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  if (!hadWindow) Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true });
});

afterEach(() => {
  Platform.OS = realOS;
  jest.restoreAllMocks();
  if (hadWindow) setConfirm(realConfirm);
  else Reflect.deleteProperty(globalThis, 'window');
});

describe('on the web', () => {
  beforeEach(() => {
    Platform.OS = 'web';
  });

  it('asks through the browser dialog and runs the action on OK', () => {
    const confirm = dialog(true);
    const onConfirm = jest.fn();
    ask(onConfirm);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0]).toMatch(/^Remove drawing\?\n\nThis removes/); // called once, above
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled(); // the stub would have shown nothing
  });

  it('does nothing on Cancel', () => {
    dialog(false);
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
    const [title, message, buttons = []] = jest.mocked(Alert.alert).mock.calls[0]!; // called once, above
    expect(title).toBe('Remove drawing?');
    expect(message).toBe('This removes the saved portrait and its guide setup.');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toEqual({ text: 'Cancel', style: 'cancel' });
    expect(buttons[1]).toMatchObject({ text: 'Remove', style: 'destructive' });
    expect(onConfirm).not.toHaveBeenCalled(); // nothing runs until the button is pressed
    buttons[1]!.onPress?.(); // two buttons, above
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
