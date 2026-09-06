import React, { useRef } from 'react';
import { PanResponder, View } from 'react-native';

const HIT_SIZE = 32; // touch target height/width around each line

/**
 * Invisible drag handle sitting on top of one guide line, so the
 * automatically-placed thirds can be nudged to match the face
 * (hairline / brow / nose) before exporting.
 */
export default function DraggableGuide({ orientation, fraction, onChange, width, height }) {
  // The PanResponder is created once; it reads live props through this ref.
  const live = useRef({ orientation, fraction, onChange, width, height });
  live.current = { orientation, fraction, onChange, width, height };

  const startFraction = useRef(fraction);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startFraction.current = live.current.fraction;
      },
      onPanResponderMove: (_evt, gesture) => {
        const { orientation: dir, width: w, height: h, onChange: change } = live.current;
        const size = dir === 'horizontal' ? h : w;
        const delta = dir === 'horizontal' ? gesture.dy : gesture.dx;
        const next = Math.min(0.98, Math.max(0.02, startFraction.current + delta / size));
        change(next);
      },
    })
  ).current;

  const style =
    orientation === 'horizontal'
      ? {
          position: 'absolute',
          left: 0,
          right: 0,
          top: fraction * height - HIT_SIZE / 2,
          height: HIT_SIZE,
        }
      : {
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: fraction * width - HIT_SIZE / 2,
          width: HIT_SIZE,
        };

  return <View style={style} {...responder.panHandlers} />;
}
