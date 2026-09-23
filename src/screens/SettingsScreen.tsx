import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';

import { colors, radius, type } from '../theme';
import { confirmAction } from '../lib/confirm';
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
 * Three rows: the one preference the app has, a way back to the defaults, and
 * what this is. There is no theme row on purpose — the app has one palette
 * (src/theme.ts), and __tests__/appearance.test.ts pins the native config to
 * it.
 */
export interface SettingsScreenProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onClose: () => void;
}

export default function SettingsScreen({ settings, onChange, onReset, onClose }: SettingsScreenProps) {
  const reset = () =>
    confirmAction({
      title: 'Reset settings?',
      message: 'Every setting goes back to how it shipped. Your portraits, their guide setups and Pro are not touched.',
      cancelLabel: 'Cancel',
      confirmLabel: 'Reset',
      onConfirm: onReset,
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
                A tick when the guide snaps to a standard view, and when a three-tap fit lands.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Vibration"
              value={settings.haptics}
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

        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.card}>
          <Text style={styles.rowTitle}>{`DrawDraw ${APP_VERSION}`}</Text>
          <Text style={styles.rowHint}>
            A three-dimensional construction head laid over your portrait, so you can draw it in
            proportion from any angle.
          </Text>
          <Text style={styles.rowHint}>Nothing leaves your device: the app has no network access.</Text>
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
  link: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
});
