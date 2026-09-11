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

import { DEFAULT_PROPORTIONS, ELEMENTS, PROPORTION_RANGES } from './headModel';
import { GUIDE_COLORS } from '../theme';

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
 * clamped to [0.1, 3] by the pinch gesture (HeadGestureLayer.js:93) and to
 * [0.05, 4] by the three-tap solver (fitSolver.js:127), so the solver's is the
 * wider of the two. Pitch is clamped to +/-90 by both. A head is `scale`
 * view-heights tall, so a centre further than MAX_SCALE outside the view could
 * not put a stroke on screen. Yaw and roll are the exception: they accumulate
 * across gestures without ever being normalised, so a full-turn range would
 * drop a legitimate pose — a hundred turns is past anything a hand winds up
 * and still far inside where the conversion above stays finite.
 */
const MAX_SCALE = 4;
const TRANSFORM_RANGES = {
  yaw: [-36000, 36000],
  pitch: [-90, 90],
  roll: [-36000, 36000],
  x: [-MAX_SCALE, 1 + MAX_SCALE],
  y: [-MAX_SCALE, 1 + MAX_SCALE],
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
const inRange = (v, [lo, hi]) => isFinite_(v) && v >= lo && v <= hi;

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
  keep(out, raw, 'lineWeight', (v) => isFinite_(v) && v > 0);
  keep(out, raw, 'tracingOpacity', (v) => isFinite_(v) && v > 0 && v <= 1);

  return out;
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
 */
const isLocalFileUri = (v) => isNonEmptyString(v) && v.startsWith('file://');

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
