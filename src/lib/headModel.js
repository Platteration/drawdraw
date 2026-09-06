/**
 * Parametric Loomis-style 3D head used for the thirds-segmentation guide.
 *
 * The head is an ellipsoid tall enough to carry the three equal facial
 * segments — chin→nose, nose→brow, brow→crown — each exactly one unit:
 * chin sits at the bottom tip (y = -1.5), the nose line and brow line are
 * latitude rings at y = -0.5 and y = +0.5, and the crown is the top tip
 * (y = +1.5). A longitude ring in the x = 0 plane gives the center
 * (symmetry) line over the face and back of the skull.
 *
 * Everything is projected orthographically (viewer on +z, y up) after an
 * arbitrary yaw/pitch/roll rotation, so the guide stays proportionally
 * correct through all 360°. Ring portions on the far side of the head are
 * returned separately so they can be drawn dashed/faded.
 */

const A = 1.05; // half-width
const B = 1.5; // half-height (head height = 3 units = the three segments)
const C = 1.25; // half-depth
const SAMPLES = 96;

const RING_HEIGHTS = [-0.5, 0.5]; // nose line, brow line

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

// Latitude ring (horizontal cross-section of the ellipsoid) at local height y0.
function latitudeRing(y0) {
  const s = Math.sqrt(Math.max(0, 1 - (y0 / B) ** 2));
  const pts = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = (2 * Math.PI * i) / SAMPLES;
    pts.push([A * s * Math.cos(t), y0, C * s * Math.sin(t)]);
  }
  return pts;
}

// Longitude ring in the x = 0 plane: the center line over face and skull.
function centerRing() {
  const pts = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = (2 * Math.PI * i) / SAMPLES;
    pts.push([0, B * Math.cos(t), C * Math.sin(t)]);
  }
  return pts;
}

// Rotate, project (drop z), and tag each point with whether the ellipsoid
// surface faces the viewer there (surface normal pointing toward +z).
function projectRing(pts, m) {
  return pts.map((p) => {
    const normal = [p[0] / (A * A), p[1] / (B * B), p[2] / (C * C)];
    const w = apply(m, p);
    const wn = apply(m, normal);
    return { x: w[0], y: w[1], visible: wn[2] > 0 };
  });
}

// Split a closed loop of projected points into runs of front-facing and
// back-facing polylines.
function splitClosedLoop(pts) {
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

// Orthographic silhouette of the rotated ellipsoid: project the world-frame
// quadric Q = R·diag(1/A², 1/B², 1/C²)·Rᵀ along z via its Schur complement,
// giving the 2D ellipse { u : uᵀSu = 1 }.
function silhouette(m) {
  const D = [
    [1 / (A * A), 0, 0],
    [0, 1 / (B * B), 0],
    [0, 0, 1 / (C * C)],
  ];
  const Q = matMul(m, matMul(D, transpose(m)));
  const s00 = Q[0][0] - (Q[0][2] * Q[0][2]) / Q[2][2];
  const s01 = Q[0][1] - (Q[0][2] * Q[1][2]) / Q[2][2];
  const s11 = Q[1][1] - (Q[1][2] * Q[1][2]) / Q[2][2];
  const pts = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = (2 * Math.PI * i) / SAMPLES;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const r = 1 / Math.sqrt(s00 * c * c + 2 * s01 * c * s + s11 * s * s);
    pts.push({ x: r * c, y: r * s });
  }
  return { points: pts, closed: true };
}

/**
 * Build the full wireframe for a given orientation, in local units
 * (head height = 3, y up, centered on the ellipsoid center).
 * Returns { front, back, outline } where front/back are arrays of
 * { points, closed } polylines and outline is the silhouette ellipse.
 */
export function buildHeadWireframe(yaw, pitch, roll) {
  const m = rotationMatrix(yaw, pitch, roll);
  const front = [];
  const back = [];
  const rings = [...RING_HEIGHTS.map(latitudeRing), centerRing()];
  for (const ring of rings) {
    const split = splitClosedLoop(projectRing(ring, m));
    front.push(...split.front);
    back.push(...split.back);
  }
  return { front, back, outline: silhouette(m) };
}

export const HEAD_HEIGHT_UNITS = 2 * B;
