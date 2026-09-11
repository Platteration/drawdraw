/**
 * Shapes for the records that come back out of storage.
 *
 * Everything in the project index was written by this app — but by *some*
 * build of it, possibly older or newer than the one reading, and possibly
 * only half-written if the process died mid-save. Mostly a record that does
 * not hold up is a crash rather than a security problem: a project with no
 * `image` takes the home screen down on `project.image.uri`, a
 * `headTransform` missing `scale` fills the SVG path data with `NaN`, and a
 * `proportions` missing `browY` reaches the slider's formatter as
 * `undefined.toFixed(2)`. The exception is `image.uri` itself — see below.
 *
 * So values are checked rather than trusted, and anything that does not hold
 * up is dropped so the caller's own default applies (`saved.x ?? DEFAULT`).
 * Nothing is invented and nothing is clamped: a value is either legitimate or
 * it is not there.
 *
 * Pure and dependency-free on purpose — this is the one place a future schema
 * change can be absorbed, and it is testable without a device.
 */

import {
  DEFAULT_PROPORTIONS,
  ELEMENTS,
  HEAD_OFFSET_RANGE,
  PROPORTION_RANGES,
} from './headModel';
import { GUIDE_COLORS, LINE_WEIGHT_RANGE, TRACING_OPACITY_RANGE } from '../theme';

const ELEMENT_KEYS = ELEMENTS.map((el) => el.key);
const PROPORTION_KEYS = Object.keys(DEFAULT_PROPORTIONS);
const COLOR_VALUES = GUIDE_COLORS.map((c) => c.value);

/**
 * A pose is six numbers, and being a number is not enough: `scale: 1e308` is
 * finite, and `scale * height` in HeadGuide (:38) is then Infinity; `yaw:
 * 1e308` is finite, and `deg * Math.PI` in the model's degrees-to-radians
 * (headModel.js:100) overflows before the divide, so every projected point
 * comes back NaN. Either fills the path data with `NaN`, which is the failure
 * this module exists to stop — react-native-svg's PathParser throws on it.
 *
 * So each value is held to the range the code that writes it keeps. Scale is
 * clamped to [0.1, 3] by the pinch gesture (HeadGestureLayer.js) and to
 * [0.05, 4] by the three-tap solver (fitSolver.js), so the solver's is the
 * wider of the two. Pitch is clamped to +/-90 by both. x and y are positions,
 * and no geometry bounds them — a fit on a very elongated photo really does
 * solve a centre several view-widths outside the view, with the head still
 * crossing the screen — so both writers clamp them to HEAD_OFFSET_RANGE and
 * this reads that same constant rather than reasoning about what could be
 * visible. Yaw and roll are the exception: they accumulate across gestures
 * without ever being normalised, so a full-turn range would drop a legitimate
 * pose — a hundred turns is past anything a hand winds up and still far inside
 * where the conversion above stays finite.
 */
const MAX_SCALE = 4;
const TRANSFORM_RANGES = {
  yaw: [-36000, 36000],
  pitch: [-90, 90],
  roll: [-36000, 36000],
  x: HEAD_OFFSET_RANGE,
  y: HEAD_OFFSET_RANGE,
  scale: [0.05, MAX_SCALE],
};
const TRANSFORM_KEYS = Object.keys(TRANSFORM_RANGES);

/**
 * The editor writes two guides of each orientation and never adds one, so a
 * longer list is not something it wrote — and every entry becomes a drag
 * handle laid over the photo.
 */
const MAX_GUIDES = 16;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFinite_ = (v) => typeof v === 'number' && Number.isFinite(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
/**
 * A range is `[lo, hi]`, and a key that has none is not in range. Destructuring
 * the second argument instead would throw a TypeError for a missing table
 * entry, which listProjects' `catch { return [] }` (storage.js) turns into an
 * empty library that the next write makes permanent — the one failure this
 * module exists to absorb, reached by the most ordinary schema change there is
 * (a new proportion added to DEFAULT_PROPORTIONS before its range).
 */
const inRange = (v, range) =>
  Array.isArray(range) && isFinite_(v) && v >= range[0] && v <= range[1];

/** Copy `key` from `from` to `into` only when `ok(value)` holds. */
function keep(into, from, key, ok) {
  const value = from[key];
  if (ok(value)) into[key] = value;
}

/** A head pose is all-or-nothing: a partial one produces NaN geometry. */
function sanitizeHeadTransform(raw) {
  if (!isObject(raw)) return undefined;
  for (const key of TRANSFORM_KEYS) if (!inRange(raw[key], TRANSFORM_RANGES[key])) return undefined;
  const out = {};
  for (const key of TRANSFORM_KEYS) out[key] = raw[key];
  return out;
}

/**
 * Proportions are completed from the defaults rather than dropped, because
 * `buildHeadWireframe` already merges them that way and the sliders read the
 * individual keys. Each one is held to the range its own slider writes from:
 * `width: 0` is finite and collapses the ellipsoid's semi-axis to zero, which
 * the ear and jaw curves then divide by.
 */
function sanitizeProportions(raw) {
  if (!isObject(raw)) return undefined;
  const out = { ...DEFAULT_PROPORTIONS };
  let sawOne = false;
  for (const key of PROPORTION_KEYS) {
    if (inRange(raw[key], PROPORTION_RANGES[key])) {
      out[key] = raw[key];
      sawOne = true;
    }
  }
  return sawOne ? out : undefined;
}

/**
 * The element set is authoritative: an element left out is off, so this only
 * ever removes keys. Merging the defaults back in would hand a free user the
 * Pro construction lines.
 */
function sanitizeElements(raw) {
  if (!isObject(raw)) return undefined;
  const out = {};
  for (const key of ELEMENT_KEYS) if (raw[key] === true) out[key] = true;
  return out;
}

/** Guide positions are fractions of the image; anything else is not one. */
function sanitizeFractions(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_GUIDES) return undefined;
  return raw.every((v) => inRange(v, [0, 1])) ? raw.slice() : undefined;
}

/**
 * Editor settings as stored. Returns `null` for the legitimately empty case —
 * `createProject` writes `settings: null` for every fresh import.
 */
export function sanitizeSettings(raw) {
  if (!isObject(raw)) return null;
  const out = {};

  const transform = sanitizeHeadTransform(raw.headTransform);
  if (transform) out.headTransform = transform;
  const proportions = sanitizeProportions(raw.proportions);
  if (proportions) out.proportions = proportions;
  const elements = sanitizeElements(raw.elements);
  if (elements) out.elements = elements;
  const hGuides = sanitizeFractions(raw.hGuides);
  if (hGuides) out.hGuides = hGuides;
  const vGuides = sanitizeFractions(raw.vGuides);
  if (vGuides) out.vGuides = vGuides;

  const isBool = (v) => typeof v === 'boolean';
  for (const key of ['showHead', 'showHorizontal', 'showVertical', 'showCenter']) {
    keep(out, raw, key, isBool);
  }
  keep(out, raw, 'guideColor', (v) => COLOR_VALUES.includes(v));
  // Both are slider values, and both are held to their own slider's range for
  // the same reason the pose is: `lineWeight: 1.7e308` is finite and positive,
  // and HeadGuide's depth taper multiplies it into Infinity, which neither
  // renderer rejects and neither draws.
  keep(out, raw, 'lineWeight', (v) => inRange(v, LINE_WEIGHT_RANGE));
  keep(out, raw, 'tracingOpacity', (v) => inRange(v, TRACING_OPACITY_RANGE));

  return out;
}

/**
 * A `..` path segment, in either spelling, in a URI or in a query string that
 * gets decoded on the way to a file API. A URI that will not decode at all
 * (`%` with nothing after it) counts as one: it is not something this app
 * wrote, and what a native URI parser does with it is not worth finding out.
 *
 * Exported because the deletion guard in storage.js needs the same test — a
 * prefix check alone is satisfied by a path that then climbs back out of the
 * directory the prefix names.
 */
export function hasTraversal(uri) {
  let decoded;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    return true;
  }
  return [uri, decoded].some((form) => form.split('/').some((seg) => seg === '..'));
}

/**
 * The only URI `createProject` ever indexes is a `file://` path to the app's
 * own copy (storage.js:69), and `removePortrait` already holds a deletion to
 * that same directory (:35) — so reading was laxer than writing, and the gap
 * was a live one rather than a stale-record one: the home screen renders
 * `image.uri` straight into `<Image source={{ uri }}>` on every paint, so an
 * `https:` URI in the index makes an app that has no network code of its own
 * fetch a remote server once per launch. Dropping the record instead also
 * makes a portrait whose copy is gone self-healing.
 *
 * The scheme is not the whole of it. `removePortrait`'s guard is a prefix
 * test, so `file:///…/portraits/../../databases/RKStorage` passes it while
 * naming a file two directories above the one it checked; `deleteAsync`
 * resolves the `..` and deletes what it finds, and the MAX_PROJECTS truncation
 * fires that without anyone asking for a deletion at all. And an authority is
 * a host, not a local file: `file://attacker.example/x.png` is no more ours
 * than `https:` is. Both are refused here. The directory half of the invariant
 * stays in storage.js, which is the module that knows where documentDirectory
 * is; this one is pure on purpose.
 */
const isLocalFileUri = (v) =>
  isNonEmptyString(v) && v.startsWith('file:///') && !hasTraversal(v);

/**
 * One record from the project index, or `null` if it cannot be opened at all.
 * A project is only useful with an image to draw over, so that is the bar.
 */
export function sanitizeProject(raw) {
  if (!isObject(raw)) return null;
  if (!isNonEmptyString(raw.id)) return null;
  const image = raw.image;
  if (!isObject(image) || !isLocalFileUri(image.uri)) return null;
  if (!isFinite_(image.width) || !isFinite_(image.height)) return null;
  if (image.width <= 0 || image.height <= 0) return null;

  return {
    id: raw.id,
    updatedAt: isFinite_(raw.updatedAt) ? raw.updatedAt : 0,
    image: { uri: image.uri, width: image.width, height: image.height },
    settings: sanitizeSettings(raw.settings),
  };
}

/** The stored index, with anything unopenable left out. */
export function sanitizeProjects(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    const project = sanitizeProject(entry);
    if (project) out.push(project);
  }
  return out;
}
