import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { buildHeadWireframe, HEAD_HEIGHT_UNITS } from '../lib/headModel';

/**
 * Non-interactive SVG rendering of the 3D thirds head at a given
 * orientation/position/scale. Used both in the editor and inside the
 * off-screen export views, so the exported guide matches the screen exactly.
 *
 * transform: { yaw, pitch, roll (degrees), x, y (fractions of the view),
 *              scale (head height as a fraction of the view height) }
 */
export default function HeadGuide({ width, height, transform, color, thickness }) {
  const { yaw, pitch, roll, x, y, scale } = transform;
  const wire = buildHeadWireframe(yaw, pitch, roll);

  const ppu = (scale * height) / HEAD_HEIGHT_UNITS; // pixels per model unit
  const cx = x * width;
  const cy = y * height;

  const toPath = ({ points, closed }) => {
    let d = '';
    for (let i = 0; i < points.length; i++) {
      const px = (cx + points[i].x * ppu).toFixed(2);
      const py = (cy - points[i].y * ppu).toFixed(2);
      d += `${i === 0 ? 'M' : 'L'}${px} ${py}`;
    }
    return closed ? `${d}Z` : d;
  };

  return (
    <Svg
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { width, height }]}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {wire.back.map((poly, i) => (
        <Path
          key={`b-${i}`}
          d={toPath(poly)}
          stroke={color}
          strokeWidth={thickness}
          strokeOpacity={0.35}
          strokeDasharray="5 5"
          fill="none"
        />
      ))}
      <Path d={toPath(wire.outline)} stroke={color} strokeWidth={thickness} fill="none" />
      {wire.front.map((poly, i) => (
        <Path
          key={`f-${i}`}
          d={toPath(poly)}
          stroke={color}
          strokeWidth={thickness}
          fill="none"
        />
      ))}
    </Svg>
  );
}
