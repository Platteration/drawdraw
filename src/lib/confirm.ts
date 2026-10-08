import { Alert, Platform } from 'react-native';

/**
 * react-native-web implements Alert as an empty stub, so a confirmation there
 * does nothing at all and the button it guards looks broken, and a message
 * shown through it is never seen. The browser's own dialogs stand in on that
 * platform.
 *
 * Two buttons, cancel first as the safe default, the destructive one named
 * with its verb.
 */
export interface Confirmation {
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export function confirmAction({ title, message, cancelLabel, confirmLabel, onConfirm }: Confirmation): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

/**
 * A message with one OK button: what went wrong, or what happened. Through
 * Alert.alert on the web it was never shown, so a failed export, a fit that
 * could not be read and a purchase this build cannot make all looked like a
 * button that did nothing.
 */
export function notify(title: string, message: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}
