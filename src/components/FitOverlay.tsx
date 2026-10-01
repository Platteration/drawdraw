import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';

import { colors } from '../theme';
import { FIT_STEPS } from '../lib/fitSolver';
import type { Point2 } from '../lib/headModel';

export interface FitOverlayProps {
  width: number;
  height: number;
  taps: readonly Point2[];
  onTap: (point: Point2) => void;
  color: string;
}

/**
 * Collects the three midline taps — chin, base of nose, brow — that the fit
 * solver turns into a head pose. Marks each tap as it lands and connects
 * them, so it reads as measuring the face rather than poking at it.
 */
export default function FitOverlay({ width, height, taps, onTap, color }: FitOverlayProps) {
  const stepIndex = Math.min(taps.length, FIT_STEPS.length - 1);
  const step = FIT_STEPS[stepIndex]!; // 0 <= stepIndex < FIT_STEPS.length

  return (
    <View style={[StyleSheet.absoluteFill, { width, height }]}>
      <View
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={() => true}
        onResponderRelease={(e) => {
          const { locationX, locationY } = e.nativeEvent;
          if (locationX >= 0 && locationY >= 0 && locationX <= width && locationY <= height) {
            onTap({ x: locationX, y: locationY });
          }
        }}
      />
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={height}>
        {taps.length > 1 &&
          taps.slice(1).map((tap, i) => {
            const prev = taps[i]!; // the tap before this one: i + 1 < taps.length
            return (
              <Line
                key={`l-${i}`}
                x1={prev.x}
                y1={prev.y}
                x2={tap.x}
                y2={tap.y}
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                strokeOpacity={0.7}
              />
            );
          })}
        {taps.map((tap, i) => (
          <React.Fragment key={`m-${i}`}>
            <Circle cx={tap.x} cy={tap.y} r={11} stroke={color} strokeWidth={2} fill="none" />
            <Circle cx={tap.x} cy={tap.y} r={2.5} fill={color} />
          </React.Fragment>
        ))}
      </Svg>
      <View pointerEvents="none" style={styles.banner}>
        <Text style={styles.step}>{`${taps.length + 1} of ${FIT_STEPS.length}`}</Text>
        <Text style={styles.prompt}>{step.prompt}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12,
    backgroundColor: 'rgba(31, 28, 25, 0.82)',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  step: {
    color: colors.paperEdge,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  prompt: {
    color: colors.paper,
    fontSize: 14,
    fontWeight: '600',
  },
});
