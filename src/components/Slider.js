import React, { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import { colors } from '../theme';

const TRACK_HEIGHT = 4;
const THUMB_SIZE = 22;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * A slider drawn the same way as everything else in the app, rather than the
 * platform's. Beyond matching the sketchbook look, this keeps one behaviour
 * across iOS, Android and web — the community slider's web build calls
 * ReactDOM.findDOMNode, which React 19 removed.
 *
 * Dragging is anchored by deriving the track's page origin at press time
 * (pageX minus locationX), so movement stays correct wherever the row sits.
 */
export default function Slider({ value, min, max, step, onChange, accessibilityLabel }) {
  const [width, setWidth] = useState(0);

  const live = useRef({ value, min, max, step, onChange, width });
  live.current = { value, min, max, step, onChange, width };
  const trackX = useRef(0);

  const quantize = (raw) => {
    const { min: lo, max: hi, step: s } = live.current;
    const snapped = s ? Math.round(raw / s) * s : raw;
    // Re-round to kill floating point dust from the division above.
    return Number(clamp(snapped, lo, hi).toFixed(6));
  };

  const emit = (pageX) => {
    const { min: lo, max: hi, width: w, onChange: change } = live.current;
    if (!w) return;
    const fraction = clamp((pageX - trackX.current) / w, 0, 1);
    const next = quantize(lo + fraction * (hi - lo));
    if (next !== live.current.value) change(next);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        // pageX is where the finger is; locationX is where it is within the
        // track — the difference is the track's left edge.
        trackX.current = evt.nativeEvent.pageX - evt.nativeEvent.locationX;
        emit(evt.nativeEvent.pageX);
      },
      onPanResponderMove: (_evt, gesture) => emit(gesture.moveX),
    })
  ).current;

  const fraction = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;
  const thumbLeft = fraction * width - THUMB_SIZE / 2;

  const nudge = (direction) => {
    const { value: v, step: s, max: hi, min: lo } = live.current;
    onChange(quantize(v + direction * (s || (hi - lo) / 20)));
  };

  return (
    <View
      style={styles.container}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      {...responder.panHandlers}
    >
      <View style={styles.track} />
      <View style={[styles.fill, { width: Math.max(0, fraction * width) }]} />
      <View style={[styles.thumb, { left: thumbLeft }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    height: 34,
    justifyContent: 'center',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.paperEdge,
  },
  fill: {
    position: 'absolute',
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.paper,
    borderWidth: 2,
    borderColor: colors.accent,
  },
});
