import React, { useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import { haptics } from '../lib/feedback';
import { HEAD_OFFSET_RANGE, type HeadTransform } from '../lib/headModel';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A drag moves the head's centre, which nothing else bounds — it re-anchors on
 * every gesture, so the offsets accumulate and the head can be pushed
 * arbitrarily far from the photo and lost. Holding it to the range the stored
 * pose is allowed (headModel.ts) is both what keeps it reachable and what
 * makes the sanitizer's bound the writer's own.
 */
const place = (start: HeadTransform, dx: number, dy: number, w: number, h: number) => ({
  x: clamp(start.x + dx / w, ...HEAD_OFFSET_RANGE),
  y: clamp(start.y + dy / h, ...HEAD_OFFSET_RANGE),
});

const SNAP_STEP = 45; // yaw snaps to the standard views
const SNAP_WINDOW = 2.5; // degrees

/**
 * Pull yaw onto the nearest standard view when it lands close, and tick the
 * haptic engine once on arrival so the snap is felt as well as seen.
 */
function snapYaw(yaw: number, lastSnap: { current: number | null }): number {
  const nearest = Math.round(yaw / SNAP_STEP) * SNAP_STEP;
  if (Math.abs(yaw - nearest) <= SNAP_WINDOW) {
    if (lastSnap.current !== nearest) {
      lastSnap.current = nearest;
      haptics.snap();
    }
    return nearest;
  }
  if (lastSnap.current !== null && Math.abs(yaw - lastSnap.current) > SNAP_WINDOW) {
    lastSnap.current = null;
  }
  return yaw;
}

interface TouchGeometry {
  count: number;
  x: number;
  y: number;
  dist: number;
  angle: number;
}

/** Where a finger is on the page, which is all the layer reads of one. */
interface TouchPoint {
  pageX: number;
  pageY: number;
}

/** The part of a responder event the layer reads; a GestureResponderEvent is one. */
export interface TouchesEvent {
  nativeEvent: { touches: readonly TouchPoint[] };
}

/** Where the fingers are, or null when none is down: there is nothing to measure then. */
function touchGeometry(touches: readonly TouchPoint[]): TouchGeometry | null {
  const t1 = touches[0];
  const t2 = touches[1];
  if (!t1) return null;
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

/** The props the gestures read, kept current by the component on every render. */
interface Live {
  mode: string;
  transform: HeadTransform;
  onChange: (next: HeadTransform) => void;
  width: number;
  height: number;
  onInteractingChange: (interacting: boolean) => void;
}

/** The pose and the finger geometry a gesture started from. */
interface Anchor {
  transform: HeadTransform;
  geo: TouchGeometry;
}

/**
 * The layer's pan-responder callbacks. The component makes its PanResponder
 * once, from the first set, so they read the props through `live`; the
 * gesture's anchor and the yaw last snapped to are theirs alone, kept beside
 * them. Their events are typed by what they read (the fingers), which a
 * GestureResponderEvent satisfies and a test can make without a touch history.
 */
export function gestureCallbacks(live: { current: Live }) {
  const base: { current: Anchor | null } = { current: null }; // { transform, geo } snapshot at gesture start
  const lastSnap: { current: number | null } = { current: null }; // yaw value most recently snapped to
  return {
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt: TouchesEvent) => {
      live.current.onInteractingChange(true);
      // A grant comes with a finger down; without one there is nothing to
      // anchor to, and the moves that follow wait for the next grant.
      const geo = touchGeometry(evt.nativeEvent.touches);
      base.current = geo && { transform: live.current.transform, geo };
    },
    onPanResponderMove: (evt: TouchesEvent) => {
      const geo = touchGeometry(evt.nativeEvent.touches);
      if (!geo || !base.current) return;

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
        change({ ...start, scale, roll, ...place(start, dx, dy, w, h) });
      } else if (m === 'move') {
        change({ ...start, ...place(start, dx, dy, w, h) });
      } else {
        change({
          ...start,
          yaw: snapYaw(start.yaw + dx * 0.4, lastSnap),
          pitch: clamp(start.pitch + dy * 0.4, -90, 90),
        });
      }
    },
    onPanResponderRelease: () => {
      base.current = null;
      lastSnap.current = null;
      live.current.onInteractingChange(false);
    },
    onPanResponderTerminate: () => {
      base.current = null;
      lastSnap.current = null;
      live.current.onInteractingChange(false);
    },
  };
}

export interface HeadGestureLayerProps {
  /** 'move' repositions with one finger; any other mode rotates. */
  mode: string;
  transform: HeadTransform;
  onChange: (next: HeadTransform) => void;
  width: number;
  height: number;
  onInteractingChange?: (interacting: boolean) => void;
}

/**
 * Full-canvas touch layer driving the 3D head:
 *  - one finger: rotate (yaw/pitch) in "rotate" mode, or reposition in "move" mode
 *  - two fingers: pinch to scale, twist to roll, drag to reposition (any mode)
 */
export default function HeadGestureLayer({
  mode,
  transform,
  onChange,
  width,
  height,
  onInteractingChange = () => {},
}: HeadGestureLayerProps) {
  const live = useRef({ mode, transform, onChange, width, height, onInteractingChange });
  live.current = { mode, transform, onChange, width, height, onInteractingChange };

  const responder = useRef(PanResponder.create(gestureCallbacks(live))).current;

  return <View style={StyleSheet.absoluteFill} {...responder.panHandlers} />;
}
