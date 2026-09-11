/**
 * Everything in the project index was written by some build of this app, and
 * the next schema change is the one that ships a crash to existing users. The
 * three failures these guard against are all real dereferences in the app:
 * `project.image.uri` on the home screen, `NaN` in the SVG path data when a
 * head pose is missing `scale`, and `undefined.toFixed(2)` in the proportion
 * sliders.
 */
import { sanitizeProject, sanitizeProjects, sanitizeSettings } from '../projectShape';
import {
  buildHeadWireframe,
  DEFAULT_PROPORTIONS,
  ELEMENTS,
  HEAD_HEIGHT_UNITS,
  PROPORTION_PRESETS,
} from '../headModel';
import { solveHeadFromTaps } from '../fitSolver';
import { GUIDE_COLORS } from '../../theme';

const IMAGE = { uri: 'file:///docs/portraits/p1.jpg', width: 4032, height: 3024 };
const project = (over = {}) => ({ id: 'p1', updatedAt: 5, image: IMAGE, ...over });

const VIEW = { width: 390, height: 500 }; // the photo as the editor displays it
const POSE = { yaw: 0, pitch: 0, roll: 0, x: 0.5, y: 0.45, scale: 0.6 };

/**
 * The arithmetic a restored pose actually reaches — HeadGuide.js:38-48, which
 * writes `scale`, `x` and `y` straight into the `d` attribute. Repeated here
 * rather than imported because HeadGuide renders react-native-svg; it is what
 * makes the expectation below independent of the sanitizer's own constants.
 */
const pathData = (transform, proportions) => {
  const { yaw, pitch, roll, x, y, scale } = transform;
  const wire = buildHeadWireframe(yaw, pitch, roll, { proportions });
  const ppu = (scale * VIEW.height) / HEAD_HEIGHT_UNITS;
  const cx = x * VIEW.width;
  const cy = y * VIEW.height;
  return [...wire.front, ...wire.back, wire.outline]
    .flatMap((poly) => poly.points)
    .map((p) => `${(cx + p.x * ppu).toFixed(2)} ${(cy - p.y * ppu).toFixed(2)}`)
    .join('L');
};

describe('sanitizeProject', () => {
  it('passes a well-formed record through unchanged', () => {
    expect(sanitizeProject(project())).toEqual({
      id: 'p1',
      updatedAt: 5,
      image: IMAGE,
      settings: null,
    });
  });

  it('rejects a record with nothing to draw over', () => {
    // The home screen renders project.image.uri without a guard, so a record
    // this incomplete is a crash rather than a blank thumbnail.
    for (const bad of [
      project({ image: undefined }),
      project({ image: null }),
      project({ image: {} }),
      project({ image: { uri: '', width: 10, height: 10 } }),
      project({ image: { uri: 7, width: 10, height: 10 } }),
      project({ image: { uri: 'file:///a.jpg', width: 0, height: 10 } }),
      project({ image: { uri: 'file:///a.jpg', width: 'wide', height: 10 } }),
      project({ image: { uri: 'file:///a.jpg', width: NaN, height: 10 } }),
      project({ id: '' }),
      project({ id: 7 }),
      null,
      'a project',
      [],
    ]) {
      expect(sanitizeProject(bad)).toBeNull();
    }
  });

  it('keeps the openable records and drops the rest', () => {
    const kept = sanitizeProjects([project({ id: 'a' }), { id: 'b' }, project({ id: 'c' }), 3]);
    expect(kept.map((p) => p.id)).toEqual(['a', 'c']);
    expect(sanitizeProjects('not an index')).toEqual([]);
    expect(sanitizeProjects(undefined)).toEqual([]);
  });

  it('opens nothing but a local file', () => {
    // createProject only ever indexes a file:// path to the app's own copy, so
    // anything else came from somewhere else. The home screen puts image.uri
    // into <Image source={{ uri }}> on every paint, which turns a stored
    // https: URI into a request from an app that has no network code at all.
    for (const uri of [
      'https://attacker.example/beacon.png?id=p1',
      'http://127.0.0.1:8080/beacon.png',
      '//attacker.example/beacon.png',
      'data:image/png;base64,iVBORw0KGgo=',
      'javascript:alert(1)',
      'FILE:///docs/portraits/p1.jpg',
      '/docs/portraits/p1.jpg',
    ]) {
      expect(sanitizeProject(project({ image: { ...IMAGE, uri } }))).toBeNull();
    }
    expect(sanitizeProject(project()).image.uri).toBe(IMAGE.uri);
  });

  it('gives an unreadable timestamp a value that still sorts', () => {
    // saveSettings sorts on updatedAt; undefined would poison the comparison.
    expect(sanitizeProject(project({ updatedAt: undefined })).updatedAt).toBe(0);
    expect(sanitizeProject(project({ updatedAt: 'yesterday' })).updatedAt).toBe(0);
  });
});

describe('sanitizeSettings', () => {
  it('accepts the null a fresh import is written with', () => {
    // createProject writes settings: null for every new project, so a
    // sanitizer that insisted on an object would break every import.
    expect(sanitizeSettings(null)).toBeNull();
    expect(sanitizeSettings(undefined)).toBeNull();
    expect(sanitizeSettings('{}')).toBeNull();
    expect(sanitizeSettings([])).toBeNull();
  });

  it('keeps a complete, legitimate settings blob', () => {
    const saved = {
      showHead: false,
      headTransform: { yaw: 40, pitch: -12, roll: 3, x: 0.5, y: 0.45, scale: 0.6 },
      elements: { segments: true, center: true },
      proportions: { width: 1.05, depth: 1, noseY: -0.62, browY: 0.28 },
      hGuides: [0.25, 0.75],
      vGuides: [0.5],
      showHorizontal: true,
      showVertical: false,
      showCenter: true,
      guideColor: GUIDE_COLORS[2].value,
      lineWeight: 3.5,
      tracingOpacity: 0.3,
    };
    expect(sanitizeSettings(saved)).toEqual(saved);
  });

  it('drops a half-written head pose rather than emitting NaN geometry', () => {
    // HeadGuide computes ppu from scale and writes the result straight into
    // the path data; one missing key fills every path with 'NaN'.
    const full = { yaw: 0, pitch: 0, roll: 0, x: 0.5, y: 0.45, scale: 0.6 };
    for (const key of Object.keys(full)) {
      const partial = { ...full };
      delete partial[key];
      expect(sanitizeSettings({ headTransform: partial }).headTransform).toBeUndefined();
    }
    expect(sanitizeSettings({ headTransform: { ...full, scale: 0 } }).headTransform).toBeUndefined();
    expect(sanitizeSettings({ headTransform: { ...full, yaw: NaN } }).headTransform).toBeUndefined();
    expect(sanitizeSettings({ headTransform: full }).headTransform).toEqual(full);
  });

  it('drops a pose whose numbers are finite but not a pose', () => {
    // Every one of these passes a type check. 1e308 is a number right up until
    // the renderer multiplies it by the view height, or the model turns it
    // into radians; a pitch past vertical and a scale under the one the fit
    // solver will produce are simply not values this app ever wrote.
    for (const over of [
      { scale: 1e308 },
      { scale: 0 },
      { scale: 0.001 },
      { scale: 5 },
      { pitch: 400 },
      { pitch: -91 },
      { yaw: 1e308 },
      { roll: -1e308 },
      { x: 1e308 },
      { y: -1e308 },
      { x: 6 },
    ]) {
      expect(sanitizeSettings({ headTransform: { ...POSE, ...over } }).headTransform).toBeUndefined();
    }
  });

  it('lets no stored number reach the path data as NaN or Infinity', () => {
    // What BUG-8's fix was written to prevent, and what react-native-svg's
    // PathParser throws on. Each fixture is checked to be live first: this is
    // what the renderer does with it when the sanitizer lets it through.
    const hostile = [
      { headTransform: { ...POSE, scale: 1e308 } },
      { headTransform: { ...POSE, yaw: 1e308 } },
      { headTransform: { ...POSE, roll: -1e308 } },
      { headTransform: { ...POSE, x: 1e308 } },
      { headTransform: { ...POSE, y: -1e308 } },
      { headTransform: POSE, proportions: { ...DEFAULT_PROPORTIONS, width: 0 } },
    ];
    for (const raw of hostile) {
      expect(pathData(raw.headTransform, raw.proportions)).toMatch(/NaN|Infinity/);
      const clean = sanitizeSettings(raw);
      // ...and the caller's own default applies to whatever was dropped.
      expect(pathData(clean.headTransform ?? POSE, clean.proportions)).not.toMatch(/NaN|Infinity/);
    }
  });

  it('keeps the poses the app itself produces', () => {
    // The bound has to be the writers', not a tighter one of the sanitizer's
    // own: the three-tap solver clamps scale to a wider range than the pinch
    // gesture does, so a fitted pose is the widest legitimate one there is.
    const taps = (chin, nose, brow) => [
      { x: VIEW.width / 2, y: chin },
      { x: VIEW.width / 2, y: nose },
      { x: VIEW.width / 2, y: brow },
    ];
    for (const spread of [taps(430, 330, 280), taps(495, 120, 20), taps(300, 290, 285)]) {
      const solved = solveHeadFromTaps(spread, VIEW);
      expect(solved).not.toBeNull();
      expect(sanitizeSettings({ headTransform: solved }).headTransform).toEqual(solved);
    }
  });

  it('keeps every proportion preset the app offers', () => {
    for (const preset of PROPORTION_PRESETS) {
      expect(sanitizeSettings({ proportions: preset.values }).proportions).toEqual({
        ...DEFAULT_PROPORTIONS,
        ...preset.values,
      });
    }
  });

  it('completes proportions from the defaults, the way the model does', () => {
    // Every proportion is read by name — by a slider's formatter, which has
    // no guard — so a partial one has to come back whole.
    const out = sanitizeSettings({ proportions: { browY: 0.28 } }).proportions;
    expect(out).toEqual({ ...DEFAULT_PROPORTIONS, browY: 0.28 });
    for (const key of Object.keys(DEFAULT_PROPORTIONS)) {
      expect(typeof out[key]).toBe('number');
      expect(Number.isFinite(out[key])).toBe(true);
    }
    expect(sanitizeSettings({ proportions: { browY: 'low' } }).proportions).toBeUndefined();
    expect(sanitizeSettings({ proportions: 4 }).proportions).toBeUndefined();
    // A proportion outside its own slider's range is dropped the same way, so
    // the default comes back rather than a collapsed ellipsoid.
    expect(sanitizeSettings({ proportions: { width: 0 } }).proportions).toBeUndefined();
    expect(sanitizeSettings({ proportions: { width: 2, browY: 0.3 } }).proportions).toEqual({
      ...DEFAULT_PROPORTIONS,
      browY: 0.3,
    });
  });

  it('never adds an element back in', () => {
    // The free tier is enforced by omission: buildHeadWireframe treats the
    // element set as authoritative, so completing it would hand out Pro.
    const proKeys = ELEMENTS.filter((el) => el.pro).map((el) => el.key);
    const out = sanitizeSettings({ elements: { segments: true } }).elements;
    expect(out).toEqual({ segments: true });
    for (const key of proKeys) expect(out[key]).toBeUndefined();

    // An all-off set is a legitimate thing to have saved.
    expect(sanitizeSettings({ elements: {} }).elements).toEqual({});
    // ...and only a real `true` counts.
    expect(sanitizeSettings({ elements: { jaw: 'yes', ears: 1, mouthLine: true } }).elements).toEqual(
      { mouthLine: true }
    );
    expect(sanitizeSettings({ elements: { notAnElement: true } }).elements).toEqual({});
    expect(sanitizeSettings({ elements: null }).elements).toBeUndefined();
  });

  it('drops values outside their own domain instead of inventing one', () => {
    const bad = sanitizeSettings({
      showHead: 'true',
      showCenter: 1,
      guideColor: 'javascript:alert(1)',
      lineWeight: 0,
      tracingOpacity: 4,
      hGuides: [0.3, 'half'],
      vGuides: 0.5,
    });
    expect(bad).toEqual({});
    // A guide is a fraction of the image, and the editor writes two of them.
    expect(sanitizeSettings({ hGuides: [0.3, 1.5] }).hGuides).toBeUndefined();
    expect(sanitizeSettings({ hGuides: [-0.2] }).hGuides).toBeUndefined();
    expect(sanitizeSettings({ vGuides: new Array(1000).fill(0.5) }).vGuides).toBeUndefined();
    expect(sanitizeSettings({ hGuides: [1 / 3, 2 / 3] }).hGuides).toEqual([1 / 3, 2 / 3]);
    // ...so every caller's own default applies.
    expect(bad.showHead ?? true).toBe(true);
    expect(bad.lineWeight ?? 2).toBe(2);
  });

  it('only takes a guide colour the app actually offers', () => {
    for (const c of GUIDE_COLORS) {
      expect(sanitizeSettings({ guideColor: c.value }).guideColor).toBe(c.value);
    }
    expect(sanitizeSettings({ guideColor: '#ff0000' }).guideColor).toBeUndefined();
  });
});
