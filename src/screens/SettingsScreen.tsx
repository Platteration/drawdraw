import React, { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';

import { colors, radius, type } from '../theme';
import {
  ACCOUNT_NOTES,
  ACCOUNT_OFF,
  PRIVACY_NATIVE,
  PRIVACY_WEB,
  PRIVACY_WEB_ACCOUNT,
  WORDS,
  type AccountState,
} from '../lib/account';
import { confirmAction, notify } from '../lib/confirm';
import type { Settings } from '../lib/settings';

/**
 * The one URL the app hands to the operating system. `Linking.openURL` opens
 * it in the browser, a separate process with its own permissions; this app
 * still opens no socket and ships no INTERNET permission, and
 * __tests__/appConfig.test.ts pins it to this single call.
 */
export const SOURCE_URL = 'https://github.com/Platteration/drawdraw';

/** app.json's version, as the build carries it. `0.0.0` only where no manifest reaches the bundle. */
export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

/**
 * What the About card says leaves the device, exact for each build: the phone
 * app has no network access; the website asks its own api/ whether sign-in is
 * offered and sends nothing of the visitor's; and where it is offered, what
 * signing in and buying tell the site and Stripe.
 */
export function privacyLine(web: boolean, signInOn: boolean): string {
  if (!web) return PRIVACY_NATIVE;
  return signInOn ? PRIVACY_WEB_ACCOUNT : PRIVACY_WEB;
}

/**
 * Three rows: the one preference the app has, a way back to the defaults, and
 * what this is. There is no theme row on purpose — the app has one palette
 * (src/theme.ts), and __tests__/appearance.test.ts pins the native config to
 * it. On a website whose api/ offers sign-in (`account.signInOn`), an Account
 * section joins them; in the phone app and on any other site it is not drawn.
 */
export interface SettingsScreenProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onClose: () => void;
  /** The website's account (src/lib/useAccount.ts); ACCOUNT_OFF everywhere else. */
  account?: AccountState;
}

export default function SettingsScreen({ settings, onChange, onReset, onClose, account = ACCOUNT_OFF }: SettingsScreenProps) {
  const [accountBusy, setAccountBusy] = useState(false);
  // A browser has no haptic engine to drive (src/lib/feedback.ts does nothing
  // there), so on the web the Vibration row says so and its switch is off and
  // disabled rather than a control that changes nothing.
  const canVibrate = Platform.OS !== 'web';
  const reset = () =>
    confirmAction({
      title: 'Reset settings?',
      message: 'Every setting goes back to how it shipped. Your portraits, their guide setups and Pro are not touched.',
      cancelLabel: 'Cancel',
      confirmLabel: 'Reset',
      onConfirm: onReset,
    });

  /** One account action at a time; one that fails says so through the app's own message. */
  const runAccount = async (title: string, action: () => Promise<string | null>) => {
    if (accountBusy) return;
    setAccountBusy(true);
    try {
      const note = await action();
      if (note) notify(title, note);
    } finally {
      setAccountBusy(false);
    }
  };
  const deleteAccount = () =>
    confirmAction({
      title: ACCOUNT_NOTES.deleteTitle,
      message: ACCOUNT_NOTES.deleteBody,
      cancelLabel: ACCOUNT_NOTES.deleteCancel,
      confirmLabel: ACCOUNT_NOTES.deleteConfirm,
      onConfirm: () => void runAccount(WORDS.deleteAccount, account.deleteAccount),
    });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={type.title}>Settings</Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>Feedback</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Vibration</Text>
              <Text style={styles.rowHint}>
                {canVibrate
                  ? 'A tick when the guide snaps to a standard view, and when a three-tap fit lands.'
                  : 'A browser cannot vibrate, so this is off here. The iOS and Android app ticks when the guide snaps to a standard view, and when a three-tap fit lands.'}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Vibration"
              disabled={!canVibrate}
              value={canVibrate && settings.haptics}
              onValueChange={(haptics) => onChange({ haptics })}
              trackColor={{ false: colors.paperEdge, true: colors.accent }}
              thumbColor={colors.paper}
              ios_backgroundColor={colors.paperEdge}
            />
          </View>
        </View>

        <Text style={styles.sectionLabel}>Defaults</Text>
        <View style={styles.card}>
          <Pressable style={styles.row} onPress={reset} accessibilityRole="button">
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Reset to defaults</Text>
              <Text style={styles.rowHint}>
                Settings only. Portraits, guide setups and Pro stay as they are.
              </Text>
            </View>
          </Pressable>
        </View>

        {account.signInOn && (
          <>
            <Text style={styles.sectionLabel}>{WORDS.section}</Text>
            <View style={styles.card}>
              {account.user ? (
                <>
                  <Text style={styles.signedIn}>
                    {account.user.email ? WORDS.signedInAs(account.user.email) : WORDS.signedIn}
                  </Text>
                  <Pressable
                    style={styles.row}
                    onPress={() => runAccount(WORDS.signOut, account.signOut)}
                    disabled={accountBusy}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: accountBusy }}
                  >
                    <Text style={styles.rowTitle}>{WORDS.signOut}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.row}
                    onPress={deleteAccount}
                    disabled={accountBusy}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: accountBusy }}
                  >
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{WORDS.deleteAccount}</Text>
                      <Text style={styles.rowHint}>
                        Removes your account on this site, and Pro with it. The payment stays with Stripe.
                      </Text>
                    </View>
                  </Pressable>
                </>
              ) : (
                <Pressable style={styles.row} onPress={account.signIn} accessibilityRole="button">
                  <Text style={styles.rowTitle}>{WORDS.signIn}</Text>
                </Pressable>
              )}
            </View>
          </>
        )}

        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.card}>
          <Text style={styles.rowTitle}>{`DrawDraw ${APP_VERSION}`}</Text>
          <Text style={styles.rowHint}>
            A three-dimensional construction head laid over your portrait, so you can draw it in
            proportion from any angle.
          </Text>
          <Text style={styles.rowHint}>{privacyLine(Platform.OS === 'web', account.signInOn)}</Text>
          <Pressable
            onPress={() => Linking.openURL(SOURCE_URL).catch(() => {})}
            hitSlop={6}
            accessibilityRole="link"
          >
            <Text style={styles.link}>MIT licence · source</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  close: {
    color: colors.graphiteSoft,
    fontSize: 14,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: 18,
    paddingBottom: 24,
    gap: 8,
  },
  sectionLabel: {
    ...type.label,
    color: colors.graphiteFaint,
    textTransform: 'uppercase',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 10,
  },
  card: {
    backgroundColor: colors.paperDeep,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.paperEdge,
    padding: 14,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    color: colors.graphite,
    fontSize: 15,
    fontWeight: '700',
  },
  rowHint: {
    ...type.body,
  },
  // Who is signed in: a statement, so not bold like the controls under it, and in graphite.
  signedIn: {
    ...type.body,
    color: colors.graphite,
  },
  link: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
});
