import { solveHeadFromTaps } from '../fitSolver';
import { DEFAULT_PROPORTIONS, HEAD_HEIGHT_UNITS, projectLandmarks, PROPORTION_PRESETS } from '../headModel';

const VIEW = { width: 900, height: 1200 };

/** Synthesize the three taps a user would make for a known ground-truth pose. */
function tapsFor(pose, proportions = DEFAULT_PROPORTIONS, noise = () => 0) {
  const ppu = (pose.scale * VIEW.height) / HEAD_HEIGHT_UNITS;
  return projectLandmarks(pose.yaw, pose.pitch, pose.roll, proportions).map((p) => ({
    x: pose.x * VIEW.width + p.x * ppu + noise(),
    y: pose.y * VIEW.height - p.y * ppu + noise(),
  }));
}

/** Deterministic pseudo-random jitter, so the noise test cannot flake. */
function jitter(amplitude, seed = 7) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return ((state / 2147483648) * 2 - 1) * amplitude;
  };
}

const POSES = [
  { yaw: 0, pitch: 0, roll: 0, x: 0.5, y: 0.45, scale: 0.6 },
  { yaw: 35, pitch: 0, roll: 0, x: 0.5, y: 0.45, scale: 0.6 },
  { yaw: -50, pitch: 12, roll: 8, x: 0.44, y: 0.5, scale: 0.7 },
  { yaw: 20, pitch: -25, roll: -12, x: 0.55, y: 0.4, scale: 0.5 },
  { yaw: 70, pitch: 18, roll: 3, x: 0.5, y: 0.45, scale: 0.65 },
  { yaw: 5, pitch: 40, roll: 20, x: 0.48, y: 0.52, scale: 0.55 },
];

describe('solveHeadFromTaps', () => {
  it.each(POSES)('recovers the pose exactly from clean taps (yaw $yaw, pitch $pitch)', (pose) => {
    const solved = solveHeadFromTaps(tapsFor(pose), VIEW);
    expect(solved.yaw).toBeCloseTo(pose.yaw, 0);
    expect(solved.pitch).toBeCloseTo(pose.pitch, 0);
    expect(solved.roll).toBeCloseTo(pose.roll, 0);
    expect(solved.scale).toBeCloseTo(pose.scale, 2);
    expect(solved.x).toBeCloseTo(pose.x, 2);
    expect(solved.y).toBeCloseTo(pose.y, 2);
  });

  it('stays close under fingertip-scale tap error', () => {
    const noise = jitter(6);
    for (const pose of POSES.slice(0, 4)) {
      const solved = solveHeadFromTaps(tapsFor(pose, DEFAULT_PROPORTIONS, noise), VIEW);
      expect(Math.abs(solved.yaw - pose.yaw)).toBeLessThan(8);
      expect(Math.abs(solved.pitch - pose.pitch)).toBeLessThan(8);
      expect(Math.abs(solved.roll - pose.roll)).toBeLessThan(8);
      expect(Math.abs(solved.scale - pose.scale)).toBeLessThan(0.1);
    }
  });

  it('solves against non-default proportions', () => {
    const child = PROPORTION_PRESETS.find((p) => p.key === 'child').values;
    const pose = { yaw: 25, pitch: -10, roll: 5, x: 0.5, y: 0.45, scale: 0.6 };
    const solved = solveHeadFromTaps(tapsFor(pose, child), VIEW, child);
    expect(solved.yaw).toBeCloseTo(pose.yaw, 0);
    expect(solved.pitch).toBeCloseTo(pose.pitch, 0);
    expect(solved.scale).toBeCloseTo(pose.scale, 2);
  });

  it('refuses degenerate input rather than returning a bad fit', () => {
    expect(solveHeadFromTaps([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }], VIEW)).toBeNull();
    expect(solveHeadFromTaps([{ x: 10, y: 10 }, { x: 20, y: 40 }], VIEW)).toBeNull();
    expect(solveHeadFromTaps([], VIEW)).toBeNull();
    expect(solveHeadFromTaps(null, VIEW)).toBeNull();
  });

  it('returns angles in a canonical range and a usable scale', () => {
    for (const pose of POSES) {
      const solved = solveHeadFromTaps(tapsFor(pose), VIEW);
      expect(solved.roll).toBeGreaterThanOrEqual(-180);
      expect(solved.roll).toBeLessThanOrEqual(180);
      expect(solved.pitch).toBeGreaterThanOrEqual(-90);
      expect(solved.pitch).toBeLessThanOrEqual(90);
      expect(solved.scale).toBeGreaterThan(0);
    }
  });

  it('tracks a head drawn larger or smaller in the frame', () => {
    for (const scale of [0.25, 0.5, 0.9, 1.4]) {
      const pose = { yaw: 15, pitch: 5, roll: 0, x: 0.5, y: 0.45, scale };
      expect(solveHeadFromTaps(tapsFor(pose), VIEW).scale).toBeCloseTo(scale, 2);
    }
  });
});
