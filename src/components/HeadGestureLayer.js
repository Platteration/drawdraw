import React, { useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function touchGeometry(touches) {
  const t1 = touches[0];
  const t2 = touches[1];
  if (!t2) {
    return { count: 1, x: t1.pageX, y: t1.pageY, dist: 0, angle: 0 };
  }
  return {
    count: touches.length,
    x: (t1.pageX + t2.pageX) / 2,
    y: (t1.pageY + t2.pageY) / 2,
    dist: Math.hypot(t2.pageX - t1.pageX, t2.pageY - t1.pageY),
    angle: Math.atan2(t2.pageY - t1.pageY, t2.pageX - t1.pageX),
  };
}

/**
 * Full-canvas touch layer driving the 3D head:
 *  - one finger: rotate (yaw/pitch) in "rotate" mode, or reposition in "move" mode
 *  - two fingers: pinch to scale, twist to roll, drag to reposition (any mode)
 */
export default function HeadGestureLayer({ mode, transform, onChange, width, height }) {
  const live = useRef({ mode, transform, onChange, width, height });
  live.current = { mode, transform, onChange, width, height };

  const base = useRef(null); // { transform, geo } snapshot at gesture start

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        base.current = {
          transform: live.current.transform,
          geo: touchGeometry(evt.nativeEvent.touches),
        };
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 0 || !base.current) return;
        const geo = touchGeometry(touches);

        // Finger count changed mid-gesture: re-anchor so nothing jumps.
        if (geo.count !== base.current.geo.count) {
          base.current = { transform: live.current.transform, geo };
          return;
        }

        const { mode: m, onChange: change, width: w, height: h } = live.current;
        const start = base.current.transform;
        const startGeo = base.current.geo;
        const dx = geo.x - startGeo.x;
        const dy = geo.y - startGeo.y;

        if (geo.count >= 2) {
          const scale =
            startGeo.dist > 0 ? clamp(start.scale * (geo.dist / startGeo.dist), 0.1, 3) : start.scale;
          const roll = start.roll - ((geo.angle - startGeo.angle) * 180) / Math.PI;
          change({
            ...start,
            scale,
            roll,
            x: start.x + dx / w,
            y: start.y + dy / h,
          });
        } else if (m === 'move') {
          change({ ...start, x: start.x + dx / w, y: start.y + dy / h });
        } else {
          change({
            ...start,
            yaw: start.yaw + dx * 0.4,
            pitch: clamp(start.pitch + dy * 0.4, -90, 90),
          });
        }
      },
      onPanResponderRelease: () => {
        base.current = null;
      },
    })
  ).current;

  return <View style={StyleSheet.absoluteFill} {...responder.panHandlers} />;
}
