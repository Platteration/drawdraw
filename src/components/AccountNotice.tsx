import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '../theme';
import { WORDS } from '../lib/account';

/**
 * The one line the website's account has to say on arrival: a sign-in that
 * did not complete, Pro unlocked after Checkout, or a payment still on its
 * way (src/lib/useAccount.ts). Drawn above whatever screen is showing, as
 * text, until it is dismissed. In the phone app, and on a site with no
 * account, there is never one.
 */
export default function AccountNotice({ notice, onDismiss }: { notice: string | null; onDismiss: () => void }) {
  if (notice === null) return null;
  return (
    <View style={styles.notice} accessibilityRole="alert">
      <Text style={styles.text}>{notice}</Text>
      <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button">
        <Text style={styles.dismiss}>{WORDS.dismiss}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 18,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.paperDeep,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  text: {
    flex: 1,
    color: colors.graphite,
    fontSize: 13,
    lineHeight: 19,
  },
  // Graphite, not the accent: 15px of accent on paperDeep measures 3.75:1, under WCAG AA.
  dismiss: {
    color: colors.graphite,
    fontSize: 13,
    fontWeight: '700',
  },
});
