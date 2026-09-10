/**
 * Everything in the project index was written by some build of this app, and
 * the next schema change is the one that ships a crash to existing users. The
 * three failures these guard against are all real dereferences in the app:
 * `project.image.uri` on the home screen, `NaN` in the SVG path data when a
 * head pose is missing `scale`, and `undefined.toFixed(2)` in the proportion
 * sliders.
 */
import { sanitizeProject, sanitizeProjects, sanitizeSettings } from '../projectShape';
import { DEFAULT_PROPORTIONS, ELEMENTS } from '../headModel';
import { GUIDE_COLORS } from '../../theme';

const IMAGE = { uri: 'file:///docs/portraits/p1.jpg', width: 4032, height: 3024 };
const project = (over = {}) => ({ id: 'p1', updatedAt: 5, image: IMAGE, ...over });

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
