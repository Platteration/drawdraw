import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { buildHeadWireframe, HEAD_HEIGHT_UNITS, MAX_RADIUS } from '../lib/headModel';

const DEPTH_BUCKETS = 4; // depth-tapered stroke width, quantized for performance

/**
 * Non-interactive SVG rendering of the 3D thirds head at a given
 * orientation/position/scale. Used both in the editor and inside the
 * off-screen export views, so the exported guide matches the screen exactly.
 *
 * transform: { yaw, pitch, roll (degrees), x, y (fractions of the view),
 *              scale (head height as a fraction of the view height) }
 */
export default function HeadGuide({
  width,
  height,
  transform,
  color,
  thickness,
  taper = true,
  elements,
  proportions,
}) {
  const { yaw, pitch, roll, x, y, scale } = transform;
  const wire = useMemo(
    () => buildHeadWireframe(yaw, pitch, roll, { elements, proportions }),
    [yaw, pitch, roll, elements, proportions]
  );

  const ppu = (scale * height) / HEAD_HEIGHT_UNITS; // pixels per model unit
  const cx = x * width;
  const cy = y * height;

  const sx = (p) => (cx + p.x * ppu).toFixed(2);
  const sy = (p) => (cy - p.y * ppu).toFixed(2);

  const toPath = (points, closed) => {
    let d = '';
    for (let i = 0; i < points.length; i++) d += `${i === 0 ? 'M' : 'L'}${sx(points[i])} ${sy(points[i])}`;
    return closed ? `${d}Z` : d;
  };

  // Near strokes read heavier than far ones, the way a construction drawing
  // is weighted. Points are grouped into a few depth buckets so each polyline
  // still renders as a handful of paths rather than one per segment.
  const bucketOf = (p) => {
    const t = (p.z / MAX_RADIUS + 1) / 2; // 0 = far, 1 = near
    return Math.max(0, Math.min(DEPTH_BUCKETS - 1, Math.floor(t * DEPTH_BUCKETS)));
  };
  const widthOf = (bucket) =>
    thickness * (0.7 + (0.55 * bucket) / Math.max(1, DEPTH_BUCKETS - 1));

  const renderPoly = (poly, key, { opacity, dash }) => {
    if (!taper) {
      return (
        <Path
          key={key}
          d={toPath(poly.points, poly.closed)}
          stroke={color}
          strokeWidth={thickness}
          strokeOpacity={opacity}
          strokeDasharray={dash}
          strokeLinecap="round"
          fill="none"
        />
      );
    }
    // Split into runs of equal depth bucket, repeating the boundary point so
    // consecutive runs stay visually joined.
    const pts = poly.closed ? [...poly.points, poly.points[0]] : poly.points;
    const out = [];
    let run = [pts[0]];
    let bucket = bucketOf(pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const b = bucketOf(pts[i]);
      run.push(pts[i]);
      if (b !== bucket) {
        out.push({ points: run, bucket });
        run = [pts[i]];
        bucket = b;
      }
    }
    if (run.length > 1) out.push({ points: run, bucket });

    return out.map((seg, i) => (
      <Path
        key={`${key}-${i}`}
        d={toPath(seg.points, false)}
        stroke={color}
        strokeWidth={widthOf(seg.bucket)}
        strokeOpacity={opacity}
        strokeDasharray={dash}
        strokeLinecap="round"
        fill="none"
      />
    ));
  };

  return (
    <Svg
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { width, height }]}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {wire.back.map((poly, i) => renderPoly(poly, `b-${i}`, { opacity: 0.32, dash: '5 5' }))}
      {renderPoly(wire.outline, 'outline', { opacity: 1 })}
      {wire.front.map((poly, i) => renderPoly(poly, `f-${i}`, { opacity: 1 }))}
    </Svg>
  );
}
