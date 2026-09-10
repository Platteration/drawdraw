/**
 * Shapes for the records that come back out of storage.
 *
 * Everything in the project index was written by this app — but by *some*
 * build of it, possibly older or newer than the one reading, and possibly
 * only half-written if the process died mid-save. A record that does not
 * hold up is not a security problem here, it is a crash: a project with no
 * `image` takes the home screen down on `project.image.uri`, a
 * `headTransform` missing `scale` fills the SVG path data with `NaN`, and a
 * `proportions` missing `browY` reaches the slider's formatter as
 * `undefined.toFixed(2)`.
 *
 * So values are checked rather than trusted, and anything that does not hold
 * up is dropped so the caller's own default applies (`saved.x ?? DEFAULT`).
 * Nothing is invented and nothing is clamped: a value is either legitimate or
 * it is not there.
 *
 * Pure and dependency-free on purpose — this is the one place a future schema
 * change can be absorbed, and it is testable without a device.
 */

import { DEFAULT_PROPORTIONS, ELEMENTS } from './headModel';
import { GUIDE_COLORS } from '../theme';

const ELEMENT_KEYS = ELEMENTS.map((el) => el.key);
const PROPORTION_KEYS = Object.keys(DEFAULT_PROPORTIONS);
const COLOR_VALUES = GUIDE_COLORS.map((c) => c.value);
const TRANSFORM_KEYS = ['yaw', 'pitch', 'roll', 'x', 'y', 'scale'];

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFinite_ = (v) => typeof v === 'number' && Number.isFinite(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/** Copy `key` from `from` to `into` only when `ok(value)` holds. */
function keep(into, from, key, ok) {
  const value = from[key];
  if (ok(value)) into[key] = value;
}

/** A head pose is all-or-nothing: a partial one produces NaN geometry. */
function sanitizeHeadTransform(raw) {
  if (!isObject(raw)) return undefined;
  for (const key of TRANSFORM_KEYS) if (!isFinite_(raw[key])) return undefined;
  if (raw.scale <= 0) return undefined;
  const out = {};
  for (const key of TRANSFORM_KEYS) out[key] = raw[key];
  return out;
}

/**
 * Proportions are completed from the defaults rather than dropped, because
 * `buildHeadWireframe` already merges them that way and the sliders read the
 * individual keys.
 */
function sanitizeProportions(raw) {
  if (!isObject(raw)) return undefined;
  const out = { ...DEFAULT_PROPORTIONS };
  let sawOne = false;
  for (const key of PROPORTION_KEYS) {
    if (isFinite_(raw[key])) {
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
  if (!Array.isArray(raw)) return undefined;
  return raw.every(isFinite_) ? raw.slice() : undefined;
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
 * One record from the project index, or `null` if it cannot be opened at all.
 * A project is only useful with an image to draw over, so that is the bar.
 */
export function sanitizeProject(raw) {
  if (!isObject(raw)) return null;
  if (!isNonEmptyString(raw.id)) return null;
  const image = raw.image;
  if (!isObject(image) || !isNonEmptyString(image.uri)) return null;
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
