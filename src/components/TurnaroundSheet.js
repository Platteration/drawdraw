import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import HeadGuide from './HeadGuide';

export const TURNAROUND_VIEWS = [
  { label: 'Front', yaw: 0, pitch: 0 },
  { label: 'Three-quarter', yaw: 40, pitch: 0 },
  { label: 'Profile', yaw: 90, pitch: 0 },
  { label: 'Back three-quarter', yaw: 140, pitch: 0 },
  { label: 'From above', yaw: 25, pitch: 25 },
  { label: 'From below', yaw: 25, pitch: -25 },
];

export const SHEET_CELL = { width: 240, height: 280 };
export const SHEET_COLS = 3;
export const SHEET_SIZE = {
  width: SHEET_CELL.width * SHEET_COLS,
  height: SHEET_CELL.height * Math.ceil(TURNAROUND_VIEWS.length / SHEET_COLS),
};

/**
 * A contact sheet of the current head at six standard angles — the thing a
 * flat overlay can never give you: the same head, in the same proportions,
 * from views the photo doesn't contain.
 *
 * Rendered on a transparent ground so it drops into a drawing app as a
 * reference layer.
 */
export default function TurnaroundSheet({ elements, proportions, color, thickness, roll = 0 }) {
  return (
    <View style={[styles.sheet, SHEET_SIZE]}>
      {TURNAROUND_VIEWS.map((view) => (
        <View key={view.label} style={[styles.cell, SHEET_CELL]}>
          <HeadGuide
            width={SHEET_CELL.width}
            height={SHEET_CELL.height}
            transform={{ yaw: view.yaw, pitch: view.pitch, roll, x: 0.5, y: 0.46, scale: 0.66 }}
            elements={elements}
            proportions={proportions}
            color={color}
            thickness={thickness}
          />
          <Text style={[styles.label, { color }]}>{view.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: 'transparent',
  },
  cell: {
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    opacity: 0.75,
  },
});
