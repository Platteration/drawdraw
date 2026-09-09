/**
 * The editor's platform-facing behaviour: what size an export is actually
 * delivered at, what permission a save asks for, and what Android's Back
 * button does. None of it is visible from the pure modules, and none of it is
 * reachable from the web e2e, so it is driven here through the real component.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert, BackHandler, PixelRatio, Platform } from 'react-native';

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(async () => 'file:///tmp/export.png'),
}));
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  saveToLibraryAsync: jest.fn(async () => {}),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('../../lib/storage', () => ({ saveSettings: jest.fn(async () => {}) }));

import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import EditorScreen from '../EditorScreen';

const MAX_EXPORT_DIMENSION = 4096; // EditorScreen's own cap
const PHOTO = { uri: 'file:///portrait.jpg', width: 4032, height: 3024 }; // a 12MP phone photo

const realOS = Platform.OS;
let backHandlers = [];
let mounted = [];

beforeEach(() => {
  jest.clearAllMocks();
  backHandlers = [];
  mounted = [];
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((event, handler) => {
    backHandlers.push({ event, handler });
    return { remove: () => {} };
  });
});

afterEach(async () => {
  // The editor holds a debounced autosave timer; leaving trees mounted keeps
  // the jest worker alive past the run.
  for (const tree of mounted) await act(async () => tree.unmount());
  Platform.OS = realOS;
  jest.restoreAllMocks();
});

/** Mount the editor on a given platform and screen scale, canvas measured. */
async function mountEditor({ platform = 'ios', pixelRatio = 3, image = PHOTO } = {}) {
  Platform.OS = platform;
  jest.spyOn(PixelRatio, 'get').mockReturnValue(pixelRatio);
  const onClose = jest.fn();
  let tree;
  await act(async () => {
    tree = renderer.create(
      <EditorScreen project={{ id: 'p1', image, settings: {} }} onClose={onClose} pro />,
      { createNodeMock: () => ({}) } // give the off-screen views a ref to capture
    );
  });
  mounted.push(tree);
  const area = tree.root.findAll((n) => n.props && typeof n.props.onLayout === 'function')[0];
  await act(async () => {
    area.props.onLayout({ nativeEvent: { layout: { width: 400, height: 700 } } });
  });
  return { tree, onClose };
}

/** Press a Chip or PrimaryButton by its label, checking it is not disabled. */
async function press(tree, label) {
  const [node] = tree.root.findAll((n) => n.props && n.props.label === label);
  expect(node).toBeDefined();
  expect(node.props.disabled).toBeFalsy();
  await act(async () => {
    await node.props.onPress();
  });
}

/** The pixel size the last capture will actually produce on this platform. */
function deliveredPixels({ platform, pixelRatio }) {
  const options = captureRef.mock.calls[captureRef.mock.calls.length - 1][1];
  // iOS reads width/height as points and rasterises at the screen scale
  // (UIGraphicsBeginImageContextWithOptions(size, NO, 0) in RNViewShot.mm).
  const scale = platform === 'ios' ? pixelRatio : 1;
  return { width: options.width * scale, height: options.height * scale };
}

describe('export resolution', () => {
  it('does not multiply the export by the screen scale on iOS', async () => {
    const { tree } = await mountEditor({ platform: 'ios', pixelRatio: 3 });
    await press(tree, 'Photo\n+ guide');

    expect(captureRef).toHaveBeenCalledTimes(1);
    const out = deliveredPixels({ platform: 'ios', pixelRatio: 3 });
    // The source photo is inside the cap, so it is exported at its own size —
    // not at 12096 x 9072, which is what asking for pixels used to produce.
    expect(out).toEqual({ width: PHOTO.width, height: PHOTO.height });
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(MAX_EXPORT_DIMENSION);
  });

  it('keeps a huge photo inside the cap whatever the screen scale', async () => {
    const huge = { uri: 'file:///huge.jpg', width: 8000, height: 6000 };
    for (const pixelRatio of [1, 2, 3]) {
      jest.clearAllMocks();
      const { tree } = await mountEditor({ platform: 'ios', pixelRatio, image: huge });
      await press(tree, 'Photo\n+ guide');
      const out = deliveredPixels({ platform: 'ios', pixelRatio });
      expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(MAX_EXPORT_DIMENSION);
      expect(out.width / out.height).toBeCloseTo(huge.width / huge.height, 2);
    }
  });

  it('still asks Android for the size in pixels', async () => {
    const { tree } = await mountEditor({ platform: 'android', pixelRatio: 3 });
    await press(tree, 'Photo\n+ guide');
    // Android scales the bitmap to exactly what was asked for, so the
    // conversion must not touch it.
    expect(captureRef.mock.calls[0][1]).toMatchObject({
      format: 'png',
      quality: 1,
      width: PHOTO.width,
      height: PHOTO.height,
    });
  });

  it('renders the turnaround sheet at the same size on every device', async () => {
    const sizes = [];
    for (const pixelRatio of [2, 3]) {
      jest.clearAllMocks();
      const { tree } = await mountEditor({ platform: 'ios', pixelRatio });
      await press(tree, 'Turnaround\nsix views');
      sizes.push(deliveredPixels({ platform: 'ios', pixelRatio }));
    }
    expect(sizes[0]).toEqual(sizes[1]);
  });
});

describe('saving to the photo library', () => {
  it('asks for write access only', async () => {
    const { tree } = await mountEditor();
    await press(tree, 'Photo\n+ guide');

    const [, , buttons] = Alert.alert.mock.calls[0];
    const save = buttons.find((b) => b.text === 'Save to Photos');
    await act(async () => {
      await save.onPress();
    });

    // The app never reads or enumerates the library, so it must not ask for
    // the read scope: `true` here is expo-media-library's writeOnly flag.
    expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(true);
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///tmp/export.png');
  });
});

describe('Android hardware back', () => {
  const latest = () => backHandlers[backHandlers.length - 1];

  it('leaves the editor instead of closing the app', async () => {
    const { onClose } = await mountEditor({ platform: 'android' });
    expect(latest().event).toBe('hardwareBackPress');

    let handled;
    await act(async () => {
      handled = latest().handler();
    });
    expect(handled).toBe(true); // swallowed, so the activity is not finished
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('backs out of a half-finished fit before it leaves the editor', async () => {
    const { tree, onClose } = await mountEditor({ platform: 'android' });
    await press(tree, 'Fit to face');

    let handled;
    await act(async () => {
      handled = latest().handler();
    });
    expect(handled).toBe(true);
    expect(onClose).not.toHaveBeenCalled(); // the fit was cancelled, not the editor
    expect(tree.root.findAll((n) => n.props && n.props.label === 'Fit to face')[0].props.active)
      .toBe(false);

    await act(async () => {
      latest().handler();
    });
    expect(onClose).toHaveBeenCalledTimes(1); // a second press does leave
  });

  it('subscribes on Android only', async () => {
    await mountEditor({ platform: 'ios' });
    // The iOS handler is a no-op stub and the web one logs an error, which
    // the smoke test counts as a failure.
    expect(BackHandler.addEventListener).not.toHaveBeenCalled();
  });
});
