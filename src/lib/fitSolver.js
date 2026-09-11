import {
  DEFAULT_PROPORTIONS,
  HEAD_HEIGHT_UNITS,
  HEAD_OFFSET_RANGE,
  projectLandmarks,
} from './headModel';

/**
 * Fit the 3D head to a portrait from three taps on the face's midline:
 * the chin, the base of the nose, and the brow line — the two boundaries of
 * the three-segment method plus its bottom end.
 *
 * The insight that makes this work without any face detection: a head turned
 * or tilted away from the viewer foreshortens its segments *unequally*. Seen
 * straight on, chin→nose and nose→brow project to the same length; tip the
 * head and the ratio shifts, and the nose and brow (which sit forward on the
 * curve of the face) swing sideways relative to the chin. So the three taps
 * carry enough information to recover the pose.
 *
 * Method: search orientation on a grid; at each candidate, solve the
 * remaining unknowns — uniform scale, in-plane rotation and translation — in
 * closed form with a similarity Procrustes fit, and keep the orientation with
 * the smallest residual. Because roll is applied last in the rotation and the
 * projection is orthographic, the in-plane rotation the fit recovers *is* the
 * roll, exactly.
 */

/**
 * Closed-form similarity fit of model points onto target points.
 * Returns { scale, angle (radians), tx, ty, residual }.
 */
function procrustes(model, target) {
  const n = model.length;
  let mx = 0;
  let my = 0;
  let qx = 0;
  let qy = 0;
  for (let i = 0; i < n; i++) {
    mx += model[i].x;
    my += model[i].y;
    qx += target[i].x;
    qy += target[i].y;
  }
  mx /= n;
  my /= n;
  qx /= n;
  qy /= n;

  let dot = 0;
  let cross = 0;
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const ax = model[i].x - mx;
    const ay = model[i].y - my;
    const bx = target[i].x - qx;
    const by = target[i].y - qy;
    dot += ax * bx + ay * by;
    cross += ax * by - ay * bx;
    norm += ax * ax + ay * ay;
  }
  if (norm < 1e-9) return null;

  const angle = Math.atan2(cross, dot);
  const scale = Math.hypot(dot, cross) / norm;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tx = qx - scale * (cos * mx - sin * my);
  const ty = qy - scale * (sin * mx + cos * my);

  let residual = 0;
  for (let i = 0; i < n; i++) {
    const px = scale * (cos * model[i].x - sin * model[i].y) + tx;
    const py = scale * (sin * model[i].x + cos * model[i].y) + ty;
    residual += (px - target[i].x) ** 2 + (py - target[i].y) ** 2;
  }
  return { scale, angle, tx, ty, residual };
}

function evaluate(yaw, pitch, target, proportions) {
  const model = projectLandmarks(yaw, pitch, 0, proportions);
  const fit = procrustes(model, target);
  return fit ? { ...fit, yaw, pitch } : null;
}

/** Coarse-to-fine search over orientation. */
function searchOrientation(target, proportions) {
  let best = null;
  const consider = (yaw, pitch) => {
    const candidate = evaluate(yaw, pitch, target, proportions);
    if (candidate && (!best || candidate.residual < best.residual)) best = candidate;
  };

  for (let yaw = -90; yaw <= 90; yaw += 3) {
    for (let pitch = -70; pitch <= 70; pitch += 3) consider(yaw, pitch);
  }
  if (!best) return null;

  for (let pass = 0, span = 3, step = 0.75; pass < 3; pass++, span /= 4, step /= 4) {
    const { yaw: cy, pitch: cp } = best;
    for (let yaw = cy - span; yaw <= cy + span + 1e-9; yaw += step) {
      for (let pitch = cp - span; pitch <= cp + span + 1e-9; pitch += step) consider(yaw, pitch);
    }
  }
  return best;
}

/**
 * Solve a head transform from three taps.
 *
 * taps: [{ x, y }, …] in view pixels — chin, base of nose, brow.
 * view: { width, height } of the photo as displayed.
 *
 * Returns a transform in the same shape the renderer takes
 * ({ yaw, pitch, roll, x, y, scale }), or null if the taps are degenerate.
 */
export function solveHeadFromTaps(taps, view, proportions = DEFAULT_PROPORTIONS) {
  if (!taps || taps.length !== 3) return null;

  // Work in the model's frame — x right, y up — so the recovered in-plane
  // rotation is the roll directly.
  const target = taps.map((t) => ({ x: t.x, y: -t.y }));
  const best = searchOrientation(target, proportions);
  if (!best || !isFinite(best.scale) || best.scale <= 0) return null;

  const ppu = best.scale; // pixels per model unit
  // The position is clamped like the scale is. Three taps inside a very
  // elongated photo (past roughly 10:1) fit a centre several view-dimensions
  // outside it, which is a position no gesture can reach and the stored-record
  // sanitizer will not take back; clamping here keeps what is drawn, what is
  // saved and what reopens the same thing.
  return {
    yaw: normalizeAngle(best.yaw),
    pitch: clamp(best.pitch, -90, 90),
    roll: normalizeAngle((best.angle * 180) / Math.PI),
    x: clamp(best.tx / view.width, ...HEAD_OFFSET_RANGE),
    y: clamp(-best.ty / view.height, ...HEAD_OFFSET_RANGE),
    scale: clamp((ppu * HEAD_HEIGHT_UNITS) / view.height, 0.05, 4),
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function normalizeAngle(deg) {
  let d = deg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** Prompts shown while collecting the three taps, in order. */
export const FIT_STEPS = [
  { key: 'chin', prompt: 'Tap the bottom of the chin' },
  { key: 'nose', prompt: 'Tap the base of the nose' },
  { key: 'brow', prompt: 'Tap the brow line, between the eyebrows' },
];
