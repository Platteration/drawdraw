import React from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Non-interactive rendering of the guide lines. Used both under the editor's
 * drag handles and inside the off-screen export views, so what you see is
 * exactly what gets exported.
 *
 * guides: { horizontal: number[], vertical: number[] } — fractions in [0, 1].
 */
export default function GuideOverlay({ width, height, guides, color, thickness }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]}>
      {guides.horizontal.map((fraction, i) => (
        <View
          key={`h-${i}`}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: fraction * height - thickness / 2,
            height: thickness,
            backgroundColor: color,
          }}
        />
      ))}
      {guides.vertical.map((fraction, i) => (
        <View
          key={`v-${i}`}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: fraction * width - thickness / 2,
            width: thickness,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
}
