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

const B = 1.5; // half-height; head height = 3 units = the three segments
const BASE_A = 1.05; // half-width at proportion 1.0
const BASE_C = 1.25; // half-depth at proportion 1.0
const SAMPLES = 96;

export const HEAD_HEIGHT_UNITS = 2 * B;

/** Largest distance any model point can sit from the center, for depth cues. */
export const MAX_RADIUS = 1.6;

export const DEFAULT_PROPORTIONS = {
  width: 1,
  depth: 1,
  noseY: -0.5,
  browY: 0.5,
};

/**
 * Proportion packs. The default adult head is exact thirds; children and
 * stylized heads carry a proportionally larger cranium, which pushes the
 * brow and nose lines down.
 */
export const PROPORTION_PRESETS = [
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
export const ELEMENTS = [
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

export const DEFAULT_ELEMENTS = { segments: true, center: true, eyeLine: true };

const rad = (deg) => (deg * Math.PI) / 180;

function matMul(a, b) {
  const out = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out;
}

function transpose(a) {
  return [
    [a[0][0], a[1][0], a[2][0]],
    [a[0][1], a[1][1], a[2][1]],
    [a[0][2], a[1][2], a[2][2]],
  ];
}

function apply(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

export function rotationMatrix(yawDeg, pitchDeg, rollDeg) {
  const cy = Math.cos(rad(yawDeg));
  const sy = Math.sin(rad(yawDeg));
  const cp = Math.cos(rad(pitchDeg));
  const sp = Math.sin(rad(pitchDeg));
  const cr = Math.cos(rad(rollDeg));
  const sr = Math.sin(rad(rollDeg));
  const ry = [
    [cy, 0, sy],
    [0, 1, 0],
    [-sy, 0, cy],
  ];
  const rx = [
    [1, 0, 0],
    [0, cp, -sp],
    [0, sp, cp],
  ];
  const rz = [
    [cr, -sr, 0],
    [sr, cr, 0],
    [0, 0, 1],
  ];
  return matMul(rz, matMul(rx, ry));
}

const axes = (proportions) => ({
  A: BASE_A * proportions.width,
  C: BASE_C * proportions.depth,
});

// --- curve builders -------------------------------------------------------
// Each returns { points: [[x,y,z]…], closed } in model space. Normals are
// derived from the ellipsoid unless a curve supplies its own.

/** Horizontal cross-section of the ellipsoid at local height y0. */
function latitudeRing(y0, { A, C }) {
  const s = Math.sqrt(Math.max(0, 1 - (y0 / B) ** 2));
  const points = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = (2 * Math.PI * i) / SAMPLES;
    points.push([A * s * Math.cos(t), y0, C * s * Math.sin(t)]);
  }
  return { points, closed: true };
}

/**
 * Longitude ring through the poles, in the vertical plane whose outward
 * direction is phi degrees off the facing (+z) axis. phi = 0 is the center
 * line down the face and over the skull.
 */
function longitudeRing(phiDeg, { A, C }) {
  const sp = Math.sin(rad(phiDeg));
  const cp = Math.cos(rad(phiDeg));
  const points = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = (2 * Math.PI * i) / SAMPLES;
    points.push([A * sp * Math.sin(t), B * Math.cos(t), C * cp * Math.sin(t)]);
  }
  return { points, closed: true };
}

/** Vertical cross-section at x = x0 — the flat side plane of the Loomis ball. */
function sagittalRing(x0, { A, C }) {
  const s = Math.sqrt(Math.max(0, 1 - (x0 / A) ** 2));
  const points = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = (2 * Math.PI * i) / SAMPLES;
    points.push([x0, B * s * Math.cos(t), C * s * Math.sin(t)]);
  }
  return { points, closed: true };
}

/**
 * Ear: an upright oval on the side plane, spanning brow line to nose line —
 * which is exactly where an ear sits on a real head, and one of the most
 * useful checks the method gives you.
 */
function ear(side, { A, C }, { noseY, browY }) {
  const x0 = side * A * 0.62;
  const s = Math.sqrt(Math.max(0, 1 - 0.62 ** 2));
  const cyMid = (noseY + browY) / 2;
  const ry = (browY - noseY) / 2;
  const rz = C * s * 0.3;
  const cz = -C * s * 0.12; // set slightly behind the side plane's center
  const points = [];
  const normals = [];
  for (let i = 0; i < SAMPLES / 2; i++) {
    const t = (2 * Math.PI * i) / (SAMPLES / 2);
    points.push([x0, cyMid + ry * Math.cos(t), cz + rz * Math.sin(t)]);
    normals.push([side, 0, 0]); // the ear faces outward along the side plane
  }
  return { points, normals, closed: true };
}

/**
 * Jaw line: from the base of the ear, down and forward to the chin. A
 * quadratic Bezier in 3D, so it stays a believable jaw from any angle.
 */
function jaw(side, { A, C }, { noseY }) {
  const s = Math.sqrt(Math.max(0, 1 - 0.62 ** 2));
  const start = [side * A * 0.62, noseY, -C * s * 0.12];
  const control = [side * A * 0.72, -B * 0.82, C * 0.42];
  const end = [0, -B * 0.94, C * 0.26]; // the chin, forward of the bottom tip
  const points = [];
  const normals = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const p = [
      u * u * start[0] + 2 * u * t * control[0] + t * t * end[0],
      u * u * start[1] + 2 * u * t * control[1] + t * t * end[1],
      u * u * start[2] + 2 * u * t * control[2] + t * t * end[2],
    ];
    points.push(p);
    normals.push([p[0], p[1] * 0.3, p[2]]); // roughly outward from the form
  }
  return { points, normals, closed: false };
}

/**
 * Fifths: the face is five eyes wide. These meridians cut the head into
 * fifths measured across its widest point, giving the eye and nose widths.
 */
function fifths(ax) {
  const out = [];
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
function projectCurve(curve, m, { A, C }) {
  const { points, normals } = curve;
  return points.map((p, i) => {
    const n = normals ? normals[i] : [p[0] / (A * A), p[1] / (B * B), p[2] / (C * C)];
    const w = apply(m, p);
    const wn = apply(m, n);
    return { x: w[0], y: w[1], z: w[2], visible: wn[2] > 0 };
  });
}

/** Split a polyline into runs of front-facing and back-facing points. */
function splitByVisibility(pts, closed) {
  if (!closed) {
    const front = [];
    const back = [];
    let run = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      run.push(pts[i]);
      if (pts[i].visible !== pts[i - 1].visible) {
        (pts[i - 1].visible ? front : back).push({ points: run, closed: false });
        run = [pts[i]];
      }
    }
    if (run.length > 1) (run[0].visible ? front : back).push({ points: run, closed: false });
    return { front, back };
  }

  const n = pts.length;
  let startIdx = -1;
  for (let i = 0; i < n; i++) {
    if (pts[i].visible !== pts[(i - 1 + n) % n].visible) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    const whole = [{ points: pts, closed: true }];
    return pts[0].visible ? { front: whole, back: [] } : { front: [], back: whole };
  }
  const front = [];
  const back = [];
  let run = [pts[startIdx]];
  for (let k = 1; k <= n; k++) {
    const p = pts[(startIdx + k) % n];
    const prev = run[run.length - 1];
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
function silhouette(m, { A, C }) {
  const D = [
    [1 / (A * A), 0, 0],
    [0, 1 / (B * B), 0],
    [0, 0, 1 / (C * C)],
  ];
  const Q = matMul(m, matMul(D, transpose(m)));
  const s00 = Q[0][0] - (Q[0][2] * Q[0][2]) / Q[2][2];
  const s01 = Q[0][1] - (Q[0][2] * Q[1][2]) / Q[2][2];
  const s11 = Q[1][1] - (Q[1][2] * Q[1][2]) / Q[2][2];
  const points = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = (2 * Math.PI * i) / SAMPLES;
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
export function buildHeadWireframe(yaw, pitch, roll, options = {}) {
  const proportions = { ...DEFAULT_PROPORTIONS, ...(options.proportions || {}) };
  // The caller's element set is authoritative — an element left out is off, not
  // defaulted back on. Defaults apply only when no set is supplied at all.
  const elements = options.elements || DEFAULT_ELEMENTS;
  const ax = axes(proportions);
  const { noseY, browY } = proportions;

  const curves = [latitudeRing(noseY, ax), latitudeRing(browY, ax)];
  if (elements.center) curves.push(longitudeRing(0, ax));
  if (elements.eyeLine) curves.push(latitudeRing(0, ax));
  if (elements.hairline) curves.push(latitudeRing(browY + (B - browY) * 0.5, ax));
  if (elements.mouthLine) curves.push(latitudeRing(noseY - (noseY + B) / 3, ax));
  if (elements.sidePlanes) curves.push(sagittalRing(ax.A * 0.62, ax), sagittalRing(-ax.A * 0.62, ax));
  if (elements.ears) curves.push(ear(1, ax, proportions), ear(-1, ax, proportions));
  if (elements.jaw) curves.push(jaw(1, ax, proportions), jaw(-1, ax, proportions));
  if (elements.fifths) curves.push(...fifths(ax));

  const m = rotationMatrix(yaw, pitch, roll);
  const front = [];
  const back = [];
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
export function projectLandmarks(yaw, pitch, roll, proportions = DEFAULT_PROPORTIONS) {
  const p = { ...DEFAULT_PROPORTIONS, ...proportions };
  const ax = axes(p);
  const onFace = (y) => {
    const s = Math.sqrt(Math.max(0, 1 - (y / B) ** 2));
    return [0, y, ax.C * s];
  };
  const m = rotationMatrix(yaw, pitch, roll);
  return [[0, -B, 0], onFace(p.noseY), onFace(p.browY)].map((v) => {
    const w = apply(m, v);
    return { x: w[0], y: w[1] };
  });
}
