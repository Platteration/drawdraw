import { Alert, Platform } from 'react-native';

/**
 * react-native-web implements Alert as an empty stub, so a confirmation there
 * does nothing at all and the button it guards looks broken. The browser's own
 * dialog stands in on that platform.
 *
 * Two buttons, cancel first as the safe default, the destructive one named
 * with its verb.
 */
export function confirmAction({ title, message, cancelLabel, confirmLabel, onConfirm }) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
