import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';

import { colors, radius, type } from '../theme';

export function Chip({ label, active, onPress, disabled, locked }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      accessibilityLabel={locked ? `${label}, requires Pro` : label}
      style={[
        styles.chip,
        active && styles.chipActive,
        disabled && styles.chipDisabled,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {locked ? `${label} ✦` : label}
      </Text>
    </Pressable>
  );
}

export function SliderRow({ label, value, min, max, step, onChange, format }) {
  return (
    <View style={styles.sliderRow}>
      <Text style={styles.sliderLabel}>{label}</Text>
      <Slider
        accessibilityLabel={label}
        accessibilityValue={{ now: value, min, max }}
        style={styles.slider}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.paperEdge}
        thumbTintColor={colors.accent}
      />
      <Text style={styles.sliderValue}>{format ? format(value) : value.toFixed(2)}</Text>
    </View>
  );
}

export function SectionLabel({ children }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function PrimaryButton({ label, onPress, disabled, tone = 'accent' }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={label.replace(/\n/g, ' ')}
      style={[
        styles.primary,
        tone === 'quiet' && styles.primaryQuiet,
        disabled && styles.primaryDisabled,
      ]}
    >
      <Text style={[styles.primaryText, tone === 'quiet' && styles.primaryTextQuiet]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.lg,
    paddingHorizontal: 13,
    paddingVertical: 7,
    backgroundColor: colors.paperDeep,
    borderWidth: 1,
    borderColor: colors.paperEdge,
  },
  chipActive: {
    backgroundColor: colors.graphite,
    borderColor: colors.graphite,
  },
  chipDisabled: {
    opacity: 0.45,
  },
  chipText: {
    ...type.label,
    color: colors.graphiteSoft,
  },
  chipTextActive: {
    color: colors.paper,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sliderLabel: {
    ...type.label,
    color: colors.graphiteSoft,
    width: 74,
  },
  slider: {
    flex: 1,
    height: 32,
  },
  sliderValue: {
    ...type.label,
    color: colors.graphiteFaint,
    width: 44,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  sectionLabel: {
    ...type.label,
    color: colors.graphiteFaint,
    textTransform: 'uppercase',
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 6,
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: colors.paperEdge,
    marginHorizontal: 3,
  },
  primary: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryQuiet: {
    backgroundColor: colors.paperDeep,
    borderWidth: 1,
    borderColor: colors.paperEdge,
  },
  primaryDisabled: {
    opacity: 0.45,
  },
  primaryText: {
    color: colors.paper,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 18,
  },
  primaryTextQuiet: {
    color: colors.graphite,
  },
});
