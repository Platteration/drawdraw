/**
 * The drag gestures are one of the two things that write the head's position,
 * and the only one a user drives directly. They re-anchor on every gesture, so
 * the offsets accumulate: without a bound the head can be pushed arbitrarily
 * far from the photo, and a stored pose out past the sanitizer's range is then
 * a pose the app wrote and refuses to read back.
 *
 * PanResponder's own wrappers need a touch history the renderer builds, so the
 * config it was created with is driven directly — which is the component's own
 * arithmetic, and all this is about.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { PanResponder } from 'react-native';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light' },
}));

import { HEAD_OFFSET_RANGE } from '../../lib/headModel';
import HeadGestureLayer from '../HeadGestureLayer';

const VIEW = { width: 390, height: 700 };
const POSE = { yaw: 0, pitch: 0, roll: 0, x: 0.5, y: 0.45, scale: 0.6 };

const touch = (x, y) => ({ pageX: x, pageY: y });
const ev = (touches) => ({ nativeEvent: { touches } });

/** Mount the layer and hand back the PanResponder config it registered. */
function driver(mode, transform, onChange) {
  const create = jest.spyOn(PanResponder, 'create');
  let tree;
  act(() => {
    tree = renderer.create(
      <HeadGestureLayer
        mode={mode}
        transform={transform}
        onChange={onChange}
        width={VIEW.width}
        height={VIEW.height}
      />
    );
  });
  const config = create.mock.calls[0][0];
  create.mockRestore();
  return { config, unmount: () => act(() => tree.unmount()) };
}

afterEach(() => jest.restoreAllMocks());

describe('dragging the head', () => {
  it('cannot push the centre past the range a stored pose is allowed', () => {
    const written = [];
    const { config, unmount } = driver('move', POSE, (t) => written.push(t));

    // One finger, dragged thousands of pixels off the canvas — further than
    // the screen, which a flung drag on a long canvas reaches.
    config.onPanResponderGrant(ev([touch(200, 350)]));
    config.onPanResponderMove(ev([touch(200 + 9000, 350 + 9000)]));
    config.onPanResponderMove(ev([touch(200 - 9000, 350 - 9000)]));

    // Two fingers: pinch, twist and drag at once, the other path that moves it.
    config.onPanResponderRelease();
    config.onPanResponderGrant(ev([touch(100, 300), touch(200, 400)]));
    config.onPanResponderMove(ev([touch(100 + 5000, 300 + 5000), touch(260 + 5000, 460 + 5000)]));
    unmount();

    expect(written.length).toBe(3);
    const [lo, hi] = HEAD_OFFSET_RANGE;
    for (const t of written) {
      expect(t.x).toBeGreaterThanOrEqual(lo);
      expect(t.x).toBeLessThanOrEqual(hi);
      expect(t.y).toBeGreaterThanOrEqual(lo);
      expect(t.y).toBeLessThanOrEqual(hi);
    }
    // ...and the drags really were big enough to leave it: each one lands on
    // the bound it was heading for.
    expect(written[0]).toMatchObject({ x: hi, y: hi });
    expect(written[1]).toMatchObject({ x: lo, y: lo });
    expect(written[2]).toMatchObject({ x: hi, y: hi });
  });

  it('still moves the head by the distance dragged inside the range', () => {
    const written = [];
    const { config, unmount } = driver('move', POSE, (t) => written.push(t));
    config.onPanResponderGrant(ev([touch(200, 350)]));
    config.onPanResponderMove(ev([touch(200 + 39, 350 + 70)]));
    unmount();

    expect(written[0].x).toBeCloseTo(POSE.x + 39 / VIEW.width, 10);
    expect(written[0].y).toBeCloseTo(POSE.y + 70 / VIEW.height, 10);
  });
});
