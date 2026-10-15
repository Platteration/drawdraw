import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, radius } from '../theme';
import { ACCOUNT_OFF, PRO_ENTITLEMENT, WORDS, formatPrice, type AccountState } from '../lib/account';
import { notify } from '../lib/confirm';
import { errorCode, errorText } from '../lib/errors';
import { buildHeadWireframe, HEAD_HEIGHT_UNITS, type ElementSet, type Polyline } from '../lib/headModel';
import { FREE_FEATURES, PRO_FEATURES } from '../lib/pro';
import { PRODUCTS, purchases } from '../lib/purchases';

const ALL_ELEMENTS: ElementSet = {
  center: true,
  eyeLine: true,
  sidePlanes: true,
  jaw: true,
  ears: true,
  hairline: true,
  mouthLine: true,
  fifths: true,
};

function FullHead({ size = 150 }: { size?: number }) {
  const wire = buildHeadWireframe(35, 6, 0, { elements: ALL_ELEMENTS });
  const ppu = (size * 0.82) / HEAD_HEIGHT_UNITS;
  const toPath = ({ points, closed }: Polyline) =>
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
  const [storeProduct, setStoreProduct] = useState(null);
  const [loading, setLoading] = useState(purchases.configured);
  const product = PRODUCTS.pro;
  const configured = purchases.configured;

  useEffect(() => {
    let active = true;
    purchases.getProducts()
      .then((products) => {
        if (active) setStoreProduct(products.find((item) => item.id === product.id) ?? null);
      })
      .catch(() => {
        if (active) setStoreProduct(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [product.id]);

export default function PaywallScreen({ onClose, onPurchase, onRestore, account = ACCOUNT_OFF }: PaywallScreenProps) {
  const [busy, setBusy] = useState(false);
  const shop = account.shop;
  // The listing is the app's own copy; the product is the provider's, and its
  // price is the only one shown. Reading PRODUCTS.pro.price here put "$7.99"
  // on the public web build, whose provider cannot sell anything.
  const listing = PRODUCTS.pro;
  const [product, setProduct] = useState<Product | null>(null);

  useEffect(() => {
    let live = true;
    purchases
      .getProducts()
      .then((list) => {
        if (live) setProduct(list.find((p) => p.id === listing.id) ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [listing.id]);

  const run = async (action: () => Promise<unknown>, label: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      if (label === 'Restore' && result?.pro === false) {
        Alert.alert('No purchase found', 'The store did not find a Pro purchase for this account.');
        return;
      }
      onClose();
    } catch (err) {
      notify(errorCode(err) === 'not_configured' ? 'Not available yet' : `${label} failed`, errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // Checkout leaves the page; anything else that ends it says why, through
  // the app's own message, and the paywall stays where it is.
  const buy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const note = await account.buyPro();
      if (note) notify('Could not buy', note);
    } finally {
      setBusy(false);
    }
  };

  const owned = account.entitlements.includes(PRO_ENTITLEMENT);
  const price = shop?.price ? formatPrice(shop.price) : null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.art}>
          <FullHead />
        </View>
        <Text style={styles.title}>{shop?.name ?? product?.title ?? listing.title}</Text>
        <Text style={styles.blurb}>{shop?.description ?? product?.blurb ?? listing.blurb}</Text>

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
          {configured
            ? 'One payment, not a subscription. Your drawings and exports are never watermarked.'
            : 'Pro is not available in this build. Your free drawing tools and portrait exports remain available.'}
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        {storeProduct ? (
          <Pressable
            style={[styles.buy, busy && styles.buyDisabled]}
            disabled={busy}
            onPress={() => run(() => onPurchase(product.id), 'Purchase')}
          >
            <Text style={styles.buyText}>{`Unlock Pro · ${storeProduct.price}`}</Text>
          </Pressable>
        ) : (
          <Text style={styles.fine}>
            {loading ? 'Loading store price…' : configured ? 'The store price is unavailable. Please try again later.' : 'Purchases are not available yet.'}
          </Text>
        )}
        {configured && (
          <Pressable onPress={() => run(onRestore, 'Restore')} disabled={busy} hitSlop={10}>
            <Text style={styles.restore}>Restore purchase</Text>
          </Pressable>
        )}
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
    color: colors.graphiteSoft,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
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
  price: {
    color: colors.graphite,
    fontSize: 20,
    fontWeight: '800',
  },
  // Graphite, not the accent: accent on paper measures 4.29:1, under WCAG AA at this size.
  owned: {
    color: colors.graphite,
    fontSize: 15,
    fontWeight: '700',
    paddingVertical: 15,
  },
});
