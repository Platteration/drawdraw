/**
 * Parametric Loomis-style 3D head used for the thirds-segmentation guide.
 *
 * The head is an ellipsoid tall enough to carry the three facial segments —
 * chin→nose, nose→brow, brow→crown. Chin sits at the bottom tip (y = -1.5),
 * the nose line and brow line are latitude rings (at -0.5 and +0.5 by
 * default, i.e. exact thirds), and the crown is the top tip (y = +1.5).
 * Moving those two rings is what distinguishes an adult head from a child's,
 * so they are parameters rather than constants.
 *
 * Everything is projected orthographically (viewer on +z, y up) after an
 * arbitrary yaw/pitch/roll rotation, so the guide stays proportionally
 * correct through all 360°. Curve portions on the far side of the head are
 * returned separately so they can be drawn dashed and faded.
 */

/** A point or direction in model space: x right, y up, z toward the viewer. */
export type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

/** A closed interval, `[lo, hi]`. */
export type Range = readonly [number, number];

export interface Proportions {
  width: number;
  depth: number;
  noseY: number;
  browY: number;
}

/**
 * A head pose, in the shape the renderer takes: yaw, pitch and roll in
 * degrees; x and y the centre as fractions of the view; scale the head's
 * height as a fraction of the view's.
 */
export interface HeadTransform {
  yaw: number;
  pitch: number;
  roll: number;
  x: number;
  y: number;
  scale: number;
}

export type ElementKey =
  | 'segments'
  | 'center'
  | 'eyeLine'
  | 'sidePlanes'
  | 'jaw'
  | 'ears'
  | 'hairline'
  | 'mouthLine'
  | 'fifths';

/** Which construction elements are drawn. A key left out is off. */
export type ElementSet = Partial<Record<ElementKey, boolean>>;

export interface ElementSpec {
  key: ElementKey;
  label: string;
  pro: boolean;
  always?: boolean;
}

export interface ProportionPreset {
  key: string;
  label: string;
  pro: boolean;
  values: Proportions;
}

/** A projected point: x and y on the view plane, z its depth toward the viewer. */
export interface ProjectedPoint {
  x: number;
  y: number;
  z: number;
  visible: boolean;
}

export interface Polyline {
  points: ProjectedPoint[];
  closed: boolean;
}

export interface Wireframe {
  front: Polyline[];
  back: Polyline[];
  outline: Polyline;
}

export interface WireframeOptions {
  elements?: ElementSet;
  proportions?: Partial<Proportions>;
  samples?: number;
}

export interface Point2 {
  x: number;
  y: number;
}

/**
 * A curve in model space. Where the ellipsoid's normal is wrong for it, it
 * carries its own, as a function of the point: there is one for every point by
 * construction, so no curve can run out of normals part-way and quietly take
 * the ellipsoid's for the rest (which would swap its solid and dashed runs).
 */
interface Curve {
  points: Vec3[];
  normal?: (p: Vec3) => Vec3;
  closed: boolean;
}

interface Axes {
  A: number;
  C: number;
  samples: number;
}

const B = 1.5; // half-height; head height = 3 units = the three segments
const BASE_A = 1.05; // half-width at proportion 1.0
const BASE_C = 1.25; // half-depth at proportion 1.0
const SAMPLES = 96; // points per closed curve at full quality

/** Coarser sampling, used while a gesture is in flight. */
export const DRAFT_SAMPLES = 40;

export const HEAD_HEIGHT_UNITS = 2 * B;

/** Largest distance any model point can sit from the center, for depth cues. */
export const MAX_RADIUS = 1.6;

export const DEFAULT_PROPORTIONS: Proportions = {
  width: 1,
  depth: 1,
  noseY: -0.5,
  browY: 0.5,
};

/**
 * What each proportion may be. The editor's sliders are built from these and
 * the stored-record sanitizer holds a restored value to them, so a value that
 * comes back out of storage cannot be one the app could never have written.
 */
export const PROPORTION_RANGES: Record<keyof Proportions, Range> = {
  width: [0.8, 1.25],
  depth: [0.8, 1.25],
  noseY: [-0.9, -0.1],
  browY: [0, 0.9],
};

/**
 * How far the head's centre may sit from the view, in view widths (x) and view
 * heights (y); the view's top-left corner is 0 and its bottom-right is 1.
 *
 * Nothing about the geometry bounds these: a three-tap fit on a very elongated
 * photo genuinely solves a centre several view-widths outside the view, with
 * the head still crossing the screen. So this is the app's own limit rather
 * than a measurement, and both writers hold to it — the solver's return
 * (fitSolver.ts) and the drag gestures (HeadGestureLayer.tsx) — which is what
 * lets the stored-record sanitizer reject a restored position outside it
 * without discarding a pose the app itself produced. The number itself is a
 * choice, not a derivation — far past anywhere a head is usefully placed, near
 * enough that a lost head can be dragged back, and small enough that every
 * multiply the renderer does with it stays finite.
 */
export const HEAD_OFFSET_RANGE: Range = [-4, 5];

/**
 * Proportion packs. The default adult head is exact thirds; children and
 * stylized heads carry a proportionally larger cranium, which pushes the
 * brow and nose lines down.
 */
export const PROPORTION_PRESETS: readonly ProportionPreset[] = [
  { key: 'adult', label: 'Adult', pro: false, values: DEFAULT_PROPORTIONS },
  {
    key: 'adultSlim',
    label: 'Slim',
    pro: false,
    values: { width: 0.94, depth: 0.98, noseY: -0.5, browY: 0.5 },
  },
  {
    key: 'child',
    label: 'Child',
    pro: true,
    values: { width: 1.05, depth: 1.0, noseY: -0.62, browY: 0.28 },
  },
  {
    key: 'infant',
    label: 'Infant',
    pro: true,
    values: { width: 1.12, depth: 1.02, noseY: -0.72, browY: 0.12 },
  },
  {
    key: 'stylized',
    label: 'Stylized',
    pro: true,
    values: { width: 1.06, depth: 0.95, noseY: -0.75, browY: 0.15 },
  },
];

/**
 * Construction elements, in the order a portrait is actually built up.
 * `segments` is the method itself and is always drawn.
 */
export const ELEMENTS: readonly ElementSpec[] = [
  { key: 'segments', label: 'Thirds', pro: false, always: true },
  { key: 'center', label: 'Center', pro: false },
  { key: 'eyeLine', label: 'Eye line', pro: false },
  { key: 'sidePlanes', label: 'Side planes', pro: true },
  { key: 'jaw', label: 'Jaw', pro: true },
  { key: 'ears', label: 'Ears', pro: true },
  { key: 'hairline', label: 'Hairline', pro: true },
  { key: 'mouthLine', label: 'Mouth', pro: true },
  { key: 'fifths', label: 'Fifths', pro: true },
];

export const DEFAULT_ELEMENTS: ElementSet = { segments: true, center: true, eyeLine: true };

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * out[i][j] = a[i][0]·b[0][j] + a[i][1]·b[1][j] + a[i][2]·b[2][j], term for
 * term in that order, one row of `a` at a time: the fixed indices are what let
 * the checker see every one of them is in range.
 */
function matMul(a: Mat3, b: Mat3): Mat3 {
  const row = (r: Vec3): Vec3 => [
    r[0] * b[0][0] + r[1] * b[1][0] + r[2] * b[2][0],
    r[0] * b[0][1] + r[1] * b[1][1] + r[2] * b[2][1],
    r[0] * b[0][2] + r[1] * b[1][2] + r[2] * b[2][2],
  ];
  return [row(a[0]), row(a[1]), row(a[2])];
}

function transpose(a: Mat3): Mat3 {
  return [
    [a[0][0], a[1][0], a[2][0]],
    [a[0][1], a[1][1], a[2][1]],
    [a[0][2], a[1][2], a[2][2]],
  ];
}

function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

export function rotationMatrix(yawDeg: number, pitchDeg: number, rollDeg: number): Mat3 {
  const cy = Math.cos(rad(yawDeg));
  const sy = Math.sin(rad(yawDeg));
  const cp = Math.cos(rad(pitchDeg));
  const sp = Math.sin(rad(pitchDeg));
  const cr = Math.cos(rad(rollDeg));
  const sr = Math.sin(rad(rollDeg));
  const ry: Mat3 = [
    [cy, 0, sy],
    [0, 1, 0],
    [-sy, 0, cy],
  ];
  const rx: Mat3 = [
    [1, 0, 0],
    [0, cp, -sp],
    [0, sp, cp],
  ];
  const rz: Mat3 = [
    [cr, -sr, 0],
    [sr, cr, 0],
    [0, 0, 1],
  ];
  return matMul(rz, matMul(rx, ry));
}

const axes = (proportions: Proportions, samples: number): Axes => ({
  A: BASE_A * proportions.width,
  C: BASE_C * proportions.depth,
  samples,
});

// --- curve builders -------------------------------------------------------
// Each returns { points: [[x,y,z]…], closed } in model space. Normals are
// derived from the ellipsoid unless a curve supplies its own `normal`.

/** Horizontal cross-section of the ellipsoid at local height y0. */
function latitudeRing(y0: number, { A, C, samples }: Axes): Curve {
  const s = Math.sqrt(Math.max(0, 1 - (y0 / B) ** 2));
  const points: Vec3[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (2 * Math.PI * i) / samples;
    points.push([A * s * Math.cos(t), y0, C * s * Math.sin(t)]);
  }
  return { points, closed: true };
}

/**
 * Longitude ring through the poles, in the vertical plane whose outward
 * direction is phi degrees off the facing (+z) axis. phi = 0 is the center
 * line down the face and over the skull.
 */
function longitudeRing(phiDeg: number, { A, C, samples }: Axes): Curve {
  const sp = Math.sin(rad(phiDeg));
  const cp = Math.cos(rad(phiDeg));
  const points: Vec3[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (2 * Math.PI * i) / samples;
    points.push([A * sp * Math.sin(t), B * Math.cos(t), C * cp * Math.sin(t)]);
  }
  return { points, closed: true };
}

/** Vertical cross-section at x = x0 — the flat side plane of the Loomis ball. */
function sagittalRing(x0: number, { A, C, samples }: Axes): Curve {
  const s = Math.sqrt(Math.max(0, 1 - (x0 / A) ** 2));
  const points: Vec3[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (2 * Math.PI * i) / samples;
    points.push([x0, B * s * Math.cos(t), C * s * Math.sin(t)]);
  }
  return { points, closed: true };
}

/**
 * Ear: an upright oval on the side plane, spanning brow line to nose line —
 * which is exactly where an ear sits on a real head, and one of the most
 * useful checks the method gives you.
 */
function ear(side: number, { A, C, samples }: Axes, { noseY, browY }: Proportions): Curve {
  const x0 = side * A * 0.62;
  const s = Math.sqrt(Math.max(0, 1 - 0.62 ** 2));
  const cyMid = (noseY + browY) / 2;
  const ry = (browY - noseY) / 2;
  const rz = C * s * 0.3;
  const cz = -C * s * 0.12; // set slightly behind the side plane's center
  const points: Vec3[] = [];
  const half = Math.round(samples / 2);
  for (let i = 0; i < half; i++) {
    const t = (2 * Math.PI * i) / half;
    points.push([x0, cyMid + ry * Math.cos(t), cz + rz * Math.sin(t)]);
  }
  // The ear faces outward along the side plane.
  return { points, normal: () => [side, 0, 0], closed: true };
}

/**
 * Jaw line: from the base of the ear, down and forward to the chin. A
 * quadratic Bezier in 3D, so it stays a believable jaw from any angle.
 */
function jaw(side: number, { A, C }: Axes, { noseY }: Proportions): Curve {
  const s = Math.sqrt(Math.max(0, 1 - 0.62 ** 2));
  const start: Vec3 = [side * A * 0.62, noseY, -C * s * 0.12];
  const control: Vec3 = [side * A * 0.72, -B * 0.82, C * 0.42];
  const end: Vec3 = [0, -B * 0.94, C * 0.26]; // the chin, forward of the bottom tip
  const points: Vec3[] = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const p: Vec3 = [
      u * u * start[0] + 2 * u * t * control[0] + t * t * end[0],
      u * u * start[1] + 2 * u * t * control[1] + t * t * end[1],
      u * u * start[2] + 2 * u * t * control[2] + t * t * end[2],
    ];
    points.push(p);
  }
  // Roughly outward from the form.
  return { points, normal: (p) => [p[0], p[1] * 0.3, p[2]], closed: false };
}

/**
 * Fifths: the face is five eyes wide. These meridians cut the head into
 * fifths measured across its widest point, giving the eye and nose widths.
 */
function fifths(ax: Axes): Curve[] {
  const out: Curve[] = [];
  for (const frac of [0.2, 0.6]) {
    const phi = (Math.asin(frac) * 180) / Math.PI;
    out.push(longitudeRing(phi, ax), longitudeRing(-phi, ax));
  }
  return out;
}

// --- projection & hidden-line splitting -----------------------------------

/**
 * Rotate, project (drop z), and tag each point with whether the surface
 * faces the viewer there.
 */
function projectCurve(curve: Curve, m: Mat3, { A, C }: Axes): ProjectedPoint[] {
  const { points, normal } = curve;
  return points.map((p) => {
    const n: Vec3 = normal ? normal(p) : [p[0] / (A * A), p[1] / (B * B), p[2] / (C * C)];
    const w = apply(m, p);
    const wn = apply(m, n);
    return { x: w[0], y: w[1], z: w[2], visible: wn[2] > 0 };
  });
}

/**
 * Split a polyline into runs of front-facing and back-facing points. A curve
 * with no points has no runs: every builder above makes at least one, and an
 * open curve of none always came back empty, but a closed one used to throw.
 */
function splitByVisibility(pts: ProjectedPoint[], closed: boolean): { front: Polyline[]; back: Polyline[] } {
  const first = pts[0];
  if (!first) return { front: [], back: [] };

  if (!closed) {
    const front: Polyline[] = [];
    const back: Polyline[] = [];
    let run = [first];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]!; // i < pts.length
      const before = pts[i - 1]!; // 0 <= i - 1 < i
      run.push(p);
      if (p.visible !== before.visible) {
        (before.visible ? front : back).push({ points: run, closed: false });
        run = [p];
      }
    }
    if (run.length > 1) (run[0]!.visible ? front : back).push({ points: run, closed: false });
    return { front, back };
  }

  const n = pts.length;
  let startIdx = -1;
  for (let i = 0; i < n; i++) {
    // i and (i - 1 + n) % n both lie in [0, n).
    if (pts[i]!.visible !== pts[(i - 1 + n) % n]!.visible) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    const whole = [{ points: pts, closed: true }];
    return first.visible ? { front: whole, back: [] } : { front: [], back: whole };
  }
  const front: Polyline[] = [];
  const back: Polyline[] = [];
  let run = [pts[startIdx]!]; // the loop above found it in [0, n)
  for (let k = 1; k <= n; k++) {
    const p = pts[(startIdx + k) % n]!; // a remainder of n
    const prev = run[run.length - 1]!; // run always holds the point it was started with
    if (k < n && p.visible === prev.visible) {
      run.push(p);
    } else {
      (prev.visible ? front : back).push({ points: run, closed: false });
      if (k < n) run = [p];
    }
  }
  return { front, back };
}

/**
 * Orthographic silhouette of the rotated ellipsoid: project the world-frame
 * quadric Q = R·diag(1/A², 1/B², 1/C²)·Rᵀ along z via its Schur complement,
 * giving the 2D ellipse { u : uᵀSu = 1 }.
 */
function silhouette(m: Mat3, { A, C, samples }: Axes): Polyline {
  const D: Mat3 = [
    [1 / (A * A), 0, 0],
    [0, 1 / (B * B), 0],
    [0, 0, 1 / (C * C)],
  ];
  const Q = matMul(m, matMul(D, transpose(m)));
  const s00 = Q[0][0] - (Q[0][2] * Q[0][2]) / Q[2][2];
  const s01 = Q[0][1] - (Q[0][2] * Q[1][2]) / Q[2][2];
  const s11 = Q[1][1] - (Q[1][2] * Q[1][2]) / Q[2][2];
  const points: ProjectedPoint[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (2 * Math.PI * i) / samples;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const r = 1 / Math.sqrt(s00 * c * c + 2 * s01 * c * s + s11 * s * s);
    // The silhouette is the rim of the form: neither near nor far.
    points.push({ x: r * c, y: r * s, z: 0, visible: true });
  }
  return { points, closed: true };
}

/**
 * Build the wireframe for a given orientation, in local units (head height
 * = 3, y up, centered on the ellipsoid center).
 *
 * Returns { front, back, outline }, where front/back are arrays of
 * { points, closed } polylines and outline is the silhouette ellipse.
 */
export function buildHeadWireframe(
  yaw: number,
  pitch: number,
  roll: number,
  options: WireframeOptions = {}
): Wireframe {
  const proportions = { ...DEFAULT_PROPORTIONS, ...(options.proportions || {}) };
  // The caller's element set is authoritative — an element left out is off, not
  // defaulted back on. Defaults apply only when no set is supplied at all.
  const elements = options.elements || DEFAULT_ELEMENTS;
  const ax = axes(proportions, options.samples || SAMPLES);
  const { noseY, browY } = proportions;

  const curves: Curve[] = [latitudeRing(noseY, ax), latitudeRing(browY, ax)];
  if (elements.center) curves.push(longitudeRing(0, ax));
  if (elements.eyeLine) curves.push(latitudeRing(0, ax));
  if (elements.hairline) curves.push(latitudeRing(browY + (B - browY) * 0.5, ax));
  if (elements.mouthLine) curves.push(latitudeRing(noseY - (noseY + B) / 3, ax));
  if (elements.sidePlanes) curves.push(sagittalRing(ax.A * 0.62, ax), sagittalRing(-ax.A * 0.62, ax));
  if (elements.ears) curves.push(ear(1, ax, proportions), ear(-1, ax, proportions));
  if (elements.jaw) curves.push(jaw(1, ax, proportions), jaw(-1, ax, proportions));
  if (elements.fifths) curves.push(...fifths(ax));

  const m = rotationMatrix(yaw, pitch, roll);
  const front: Polyline[] = [];
  const back: Polyline[] = [];
  for (const curve of curves) {
    const split = splitByVisibility(projectCurve(curve, m, ax), curve.closed);
    front.push(...split.front);
    back.push(...split.back);
  }
  return { front, back, outline: silhouette(m, ax) };
}

/**
 * Project the three midline landmarks the fit solver works from — chin,
 * base of nose, brow — for a given orientation. Returns model-space 2D
 * points (before scale and translation).
 */
export function projectLandmarks(
  yaw: number,
  pitch: number,
  roll: number,
  proportions: Partial<Proportions> = DEFAULT_PROPORTIONS
): [Point2, Point2, Point2] {
  const p = { ...DEFAULT_PROPORTIONS, ...proportions };
  const ax = axes(p, SAMPLES);
  const onFace = (y: number): Vec3 => {
    const s = Math.sqrt(Math.max(0, 1 - (y / B) ** 2));
    return [0, y, ax.C * s];
  };
  const m = rotationMatrix(yaw, pitch, roll);
  const project = (v: Vec3): Point2 => {
    const w = apply(m, v);
    return { x: w[0], y: w[1] };
  };
  return [project([0, -B, 0]), project(onFace(p.noseY)), project(onFace(p.browY))];
}
