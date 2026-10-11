import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, radius } from '../theme';
import { buildHeadWireframe, HEAD_HEIGHT_UNITS } from '../lib/headModel';
import { FREE_FEATURES, PRO_FEATURES } from '../lib/pro';
import { PRODUCTS } from '../lib/purchases';
import { account, useAccount } from '../lib/account';

const ALL_ELEMENTS = {
  center: true,
  eyeLine: true,
  sidePlanes: true,
  jaw: true,
  ears: true,
  hairline: true,
  mouthLine: true,
  fifths: true,
};

function FullHead({ size = 150 }) {
  const wire = buildHeadWireframe(35, 6, 0, { elements: ALL_ELEMENTS });
  const ppu = (size * 0.82) / HEAD_HEIGHT_UNITS;
  const toPath = ({ points, closed }) =>
    points
      .map(
        (p, i) =>
          `${i ? 'L' : 'M'}${(size / 2 + p.x * ppu).toFixed(1)} ${(size / 2 - p.y * ppu).toFixed(1)}`
      )
      .join('') + (closed ? 'Z' : '');
  return (
    <Svg width={size} height={size}>
      {wire.back.map((p, i) => (
        <Path
          key={`b${i}`}
          d={toPath(p)}
          stroke={colors.accent}
          strokeOpacity={0.28}
          strokeWidth={1.3}
          strokeDasharray="4 4"
          fill="none"
        />
      ))}
      <Path d={toPath(wire.outline)} stroke={colors.accent} strokeWidth={1.8} fill="none" />
      {wire.front.map((p, i) => (
        <Path key={`f${i}`} d={toPath(p)} stroke={colors.accent} strokeWidth={1.8} fill="none" />
      ))}
    </Svg>
  );
}

export default function PaywallScreen({ onClose, onPurchase, onRestore }) {
  const [busy, setBusy] = useState(false);
  const product = PRODUCTS.pro;
  const acct = useAccount();

  const run = async (action, label) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onClose();
    } catch (err) {
      Alert.alert(
        err?.code === 'not_configured' ? 'Not available yet' : `${label} failed`,
        String(err?.message ?? err)
      );
    } finally {
      setBusy(false);
    }
  };

  // Sign in with the Google account used in the studio's shop on the web: a
  // Pro bought there unlocks here. Closes the paywall when it does.
  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await account.signIn();
      if (result?.cancelled) return;
      if (account.hasPro()) {
        onClose();
      } else {
        Alert.alert(
          'Signed in',
          `${result.user?.email || 'This account'} has no Pro purchase yet. Unlock Pro here, or sign in with the account you bought it with.`
        );
      }
    } catch (err) {
      Alert.alert('Sign-in failed', String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await account.signOut();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.art}>
          <FullHead />
        </View>
        <Text style={styles.title}>{product.title}</Text>
        <Text style={styles.blurb}>{product.blurb}</Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Pro adds</Text>
          {PRO_FEATURES.map((line) => (
            <View key={line} style={styles.line}>
              <Text style={styles.bullet}>✦</Text>
              <Text style={styles.lineText}>{line}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, styles.cardQuiet]}>
          <Text style={styles.cardLabel}>Always free</Text>
          {FREE_FEATURES.map((line) => (
            <View key={line} style={styles.line}>
              <Text style={[styles.bullet, styles.bulletQuiet]}>·</Text>
              <Text style={styles.lineText}>{line}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.fine}>
          One payment, not a subscription. Your drawings and exports are never watermarked.
        </Text>

        {acct.configured ? (
          <View style={styles.account}>
            {acct.status === 'signed-in' ? (
              <>
                <Text style={styles.accountText} numberOfLines={1}>
                  {`Signed in as ${acct.user?.email || acct.user?.name || 'your account'}`}
                </Text>
                <Pressable onPress={signOut} disabled={busy} hitSlop={10} accessibilityRole="button">
                  <Text style={styles.accountLink}>Sign out</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.accountText}>Already have Pro on your account?</Text>
                <Pressable onPress={signIn} disabled={busy || acct.status === 'loading'} hitSlop={10} accessibilityRole="button">
                  <Text style={styles.accountLink}>Sign in with Google</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.buy, busy && styles.buyDisabled]}
          disabled={busy}
          onPress={() => run(() => onPurchase(product.id), 'Purchase')}
        >
          <Text style={styles.buyText}>{`Unlock Pro · ${product.price}`}</Text>
        </Pressable>
        <Pressable onPress={() => run(onRestore, 'Restore')} disabled={busy} hitSlop={10}>
          <Text style={styles.restore}>Restore purchase</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    alignItems: 'flex-end',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  close: {
    color: colors.graphiteSoft,
    fontSize: 14,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  art: {
    alignItems: 'center',
  },
  title: {
    color: colors.graphite,
    fontSize: 27,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 6,
  },
  blurb: {
    color: colors.graphiteSoft,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 22,
  },
  card: {
    backgroundColor: colors.paperDeep,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.paperEdge,
    padding: 16,
    marginBottom: 12,
  },
  cardQuiet: {
    backgroundColor: 'transparent',
  },
  cardLabel: {
    color: colors.graphiteFaint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  line: {
    flexDirection: 'row',
    marginBottom: 8,
    gap: 9,
  },
  bullet: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 20,
  },
  bulletQuiet: {
    color: colors.graphiteFaint,
  },
  lineText: {
    flex: 1,
    color: colors.graphite,
    fontSize: 13,
    lineHeight: 20,
  },
  fine: {
    color: colors.graphiteFaint,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
  },
  account: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  accountText: {
    color: colors.graphiteSoft,
    fontSize: 12,
    lineHeight: 18,
    maxWidth: '70%',
  },
  accountLink: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 10,
    gap: 12,
    alignItems: 'center',
  },
  buy: {
    alignSelf: 'stretch',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buyDisabled: {
    opacity: 0.5,
  },
  buyText: {
    color: colors.paper,
    fontSize: 15,
    fontWeight: '700',
  },
  restore: {
    color: colors.graphiteSoft,
    fontSize: 13,
    fontWeight: '600',
  },
});
