import {
  buildHeadWireframe,
  DRAFT_SAMPLES,
  DEFAULT_PROPORTIONS,
  ELEMENTS,
  HEAD_HEIGHT_UNITS,
  projectLandmarks,
  PROPORTION_PRESETS,
  rotationMatrix,
  type ElementSet,
  type ProjectedPoint,
  type Proportions,
  type Wireframe,
} from '../headModel';

const ALL_ELEMENTS: ElementSet = Object.fromEntries(ELEMENTS.map((el) => [el.key, true]));

const allPoints = (wire: Wireframe) =>
  [...wire.front, ...wire.back, wire.outline].flatMap((poly) => poly.points);

const extent = (points: ProjectedPoint[], axis: 'x' | 'y') => Math.max(...points.map((p) => Math.abs(p[axis])));

/** A proportion preset the app ships, by key. */
function preset(key: string): Proportions {
  const found = PROPORTION_PRESETS.find((p) => p.key === key);
  if (!found) throw new Error(`no preset ${key}`);
  return found.values;
}

describe('rotationMatrix', () => {
  it('is orthonormal for arbitrary angles', () => {
    const angles: [number, number, number][] = [
      [0, 0, 0],
      [37, -12, 88],
      [-155, 63, -41],
    ];
    for (const [y, p, r] of angles) {
      const m = rotationMatrix(y, p, r);
      for (let i = 0; i < 3; i++) {
        const row = m[i]!; // i < 3, and the matrix has three rows
        const rowNorm = Math.hypot(...row);
        expect(rowNorm).toBeCloseTo(1, 10);
        for (let j = i + 1; j < 3; j++) {
          const other = m[j]!; // j < 3
          const dot = row[0] * other[0] + row[1] * other[1] + row[2] * other[2];
          expect(dot).toBeCloseTo(0, 10);
        }
      }
    }
  });
});

describe('buildHeadWireframe', () => {
  it('produces finite geometry across the full sphere of orientations', () => {
    const bad = [];
    for (let yaw = -180; yaw <= 180; yaw += 15) {
      for (let pitch = -90; pitch <= 90; pitch += 15) {
        const points = allPoints(buildHeadWireframe(yaw, pitch, 30, { elements: ALL_ELEMENTS }));
        const ok =
          points.length > 0 &&
          points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
        if (!ok) bad.push(`${yaw}/${pitch}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('produces finite geometry for every proportion preset', () => {
    const bad = PROPORTION_PRESETS.filter((preset) =>
      !allPoints(
        buildHeadWireframe(35, 15, 0, { elements: ALL_ELEMENTS, proportions: preset.values })
      ).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    );
    expect(bad.map((p) => p.key)).toEqual([]);
  });

  it('keeps the head three units tall however it is turned', () => {
    // The silhouette of an ellipsoid always spans its true height about the
    // poles when rolled to upright, so the front view pins the scale.
    const front = buildHeadWireframe(0, 0, 0);
    expect(extent(front.outline.points, 'y') * 2).toBeCloseTo(HEAD_HEIGHT_UNITS, 6);
  });

  it('shows the head at its depth when turned to profile', () => {
    // Looking along the head's own left-right axis, the silhouette's width is
    // the head's depth rather than its width.
    const front = buildHeadWireframe(0, 0, 0);
    const profile = buildHeadWireframe(90, 0, 0);
    const width = extent(front.outline.points, 'x');
    const depth = extent(profile.outline.points, 'x');
    expect(depth).toBeGreaterThan(width);
    expect(depth).toBeCloseTo(1.25, 6);
    expect(width).toBeCloseTo(1.05, 6);
  });

  it('splits rings into visible and hidden runs', () => {
    // Head-on, each latitude ring wraps around the head: half toward the
    // viewer, half behind it.
    const wire = buildHeadWireframe(0, 0, 0, { elements: {} });
    expect(wire.front.length).toBeGreaterThan(0);
    expect(wire.back.length).toBeGreaterThan(0);
    expect(wire.front.every((poly) => poly.points.every((p) => p.visible))).toBe(true);
    expect(wire.back.every((poly) => poly.points.every((p) => !p.visible))).toBe(true);
  });

  it('splits each ear by its own normal, not the ellipsoid it sits on', () => {
    // An ear is a flat oval facing straight out along its side plane, so at
    // any pose it is wholly toward the viewer or wholly away: one closed loop
    // each, solid or dashed, and never both solid. The ellipsoid's normals
    // turn around the oval and would split it, which is what an ear that ran
    // out of normals of its own part-way did, with every other test green.
    const split: string[] = [];
    for (let yaw = -180; yaw < 180; yaw += 15) {
      for (let pitch = -30; pitch <= 30; pitch += 10) {
        for (const roll of [-20, 0, 20]) {
          const bare = buildHeadWireframe(yaw, pitch, roll, { elements: {} });
          const eared = buildHeadWireframe(yaw, pitch, roll, { elements: { ears: true } });
          // The ears are drawn after the two rings every wireframe carries.
          const front = eared.front.slice(bare.front.length);
          const back = eared.back.slice(bare.back.length);
          const whole = front.length + back.length === 2 && [...front, ...back].every((poly) => poly.closed);
          if (!whole || front.length === 2) split.push(`${yaw}/${pitch}/${roll}`);
        }
      }
    }
    expect(split).toEqual([]);
  });

  it('treats an omitted element as off rather than defaulting it back on', () => {
    // A caller that filters the element set down — as the free tier does —
    // must get exactly what it asked for.
    const withCenter = buildHeadWireframe(30, 0, 0, { elements: { center: true } });
    const without = buildHeadWireframe(30, 0, 0, { elements: {} });
    const count = (w: Wireframe) => w.front.length + w.back.length;
    expect(count(without)).toBeLessThan(count(withCenter));
  });

  it('draws more curves as construction elements are switched on', () => {
    const bare = buildHeadWireframe(30, 0, 0, { elements: {} });
    const some = buildHeadWireframe(30, 0, 0, { elements: { center: true, eyeLine: true } });
    const all = buildHeadWireframe(30, 0, 0, { elements: ALL_ELEMENTS });
    const count = (w: Wireframe) => w.front.length + w.back.length;
    expect(count(some)).toBeGreaterThan(count(bare));
    expect(count(all)).toBeGreaterThan(count(some));
  });

  it('draws a lighter wireframe in draft sampling without changing its shape', () => {
    const full = buildHeadWireframe(35, 12, 0, { elements: ALL_ELEMENTS });
    const draft = buildHeadWireframe(35, 12, 0, {
      elements: ALL_ELEMENTS,
      samples: DRAFT_SAMPLES,
    });
    expect(allPoints(draft).length).toBeLessThan(allPoints(full).length * 0.6);
    // Same head, just described with fewer points: the silhouette must agree.
    const axes: ('x' | 'y')[] = ['x', 'y'];
    for (const axis of axes) {
      expect(extent(draft.outline.points, axis)).toBeCloseTo(extent(full.outline.points, axis), 2);
    }
  });

  it('builds nothing, rather than throwing, from curves with no points', () => {
    // No caller in the app asks for fewer than one sample; this is what the
    // hidden-line split does with an empty closed curve, which used to throw.
    const wire = buildHeadWireframe(0, 0, 0, { samples: -1 });
    expect(wire.front).toEqual([]);
    expect(wire.back).toEqual([]);
    expect(wire.outline.points).toEqual([]);
  });

  it('scales with the width and depth proportions', () => {
    const narrow = buildHeadWireframe(0, 0, 0, { proportions: { ...DEFAULT_PROPORTIONS, width: 0.8 } });
    const wide = buildHeadWireframe(0, 0, 0, { proportions: { ...DEFAULT_PROPORTIONS, width: 1.2 } });
    expect(extent(wide.outline.points, 'x')).toBeGreaterThan(extent(narrow.outline.points, 'x'));
  });
});

describe('projectLandmarks', () => {
  it('divides the head into three equal segments seen head-on', () => {
    const [chin, nose, brow] = projectLandmarks(0, 0, 0);
    const lower = nose.y - chin.y; // chin to base of nose
    const middle = brow.y - nose.y; // nose to brow
    expect(lower).toBeCloseTo(middle, 10);
    // …and the brow sits two thirds of the way up from the chin.
    expect((brow.y - chin.y) / HEAD_HEIGHT_UNITS).toBeCloseTo(2 / 3, 10);
  });

  it('foreshortens the two segments unequally once the head tips', () => {
    // This inequality is precisely the signal the fit solver reads.
    const ratio = (pitch: number) => {
      const [chin, nose, brow] = projectLandmarks(0, pitch, 0);
      return (nose.y - chin.y) / (brow.y - nose.y);
    };
    expect(ratio(0)).toBeCloseTo(1, 10);
    expect(ratio(20)).toBeLessThan(1);
    expect(ratio(-20)).toBeGreaterThan(1);
    // and it is monotonic, so a measured ratio names one pitch
    const samples = [-40, -20, 0, 20, 40].map(ratio);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThan(samples[i - 1]!); // 0 <= i - 1
  });

  it('swings the nose and brow off the chin line once the head turns', () => {
    // The other half of the signal: they sit forward on the curve of the face.
    const straight = projectLandmarks(0, 0, 0);
    expect(Math.max(...straight.map((p) => Math.abs(p.x)))).toBeCloseTo(0, 10);
    const turned = projectLandmarks(40, 0, 0);
    expect(Math.abs(turned[1].x - turned[0].x)).toBeGreaterThan(0.1);
  });

  it('moves the landmarks when proportions change', () => {
    const child = preset('child');
    const [, adultNose] = projectLandmarks(0, 0, 0);
    const [, childNose] = projectLandmarks(0, 0, 0, child);
    expect(childNose.y).toBeLessThan(adultNose.y); // a child's features sit lower
  });
});
