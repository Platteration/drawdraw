/**
 * The editor's platform-facing behaviour: what size an export is actually
 * delivered at, what permission a save asks for, and what Android's Back
 * button does. None of it is visible from the pure modules, and none of it is
 * reachable from the web e2e, so it is driven here through the real component.
 */
import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { ActivityIndicator, Alert, BackHandler, PixelRatio, Platform, StyleSheet } from 'react-native';

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(async () => 'file:///tmp/export.png'),
  releaseCapture: jest.fn(),
}));
jest.mock('expo-media-library/legacy', () => ({
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

import { captureRef, releaseCapture } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library/legacy';
import { saveSettings } from '../../lib/storage';
import HeadGuide from '../../components/HeadGuide';
import type { ProjectImage } from '../../lib/projectShape';
import EditorScreen from '../EditorScreen';

const MAX_EXPORT_DIMENSION = 4096; // EditorScreen's own cap
const PHOTO = { uri: 'file:///portrait.jpg', width: 4032, height: 3024 }; // a 12MP phone photo

const realOS = Platform.OS;
/** What Android hands a back handler; the editor's reads none of it. */
const BACK_PRESS = { type: 'hardwareBackPress', timeStamp: 0 };
let backHandlers: {
  event: string;
  handler: (event: typeof BACK_PRESS) => boolean | null | undefined;
}[] = [];
let mounted: ReactTestRenderer[] = [];

/** `value`, which the test needs to be there: a missing one fails the test here, by name. */
function found<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`${what} is missing`);
  return value;
}

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
async function mountEditor({
  platform = 'ios',
  pixelRatio = 3,
  image = PHOTO,
  pro = true,
}: { platform?: typeof Platform.OS; pixelRatio?: number; image?: ProjectImage; pro?: boolean } = {}) {
  Platform.OS = platform;
  jest.spyOn(PixelRatio, 'get').mockReturnValue(pixelRatio);
  const onClose = jest.fn();
  let rendered: ReactTestRenderer | undefined;
  await act(async () => {
    rendered = renderer.create(
      <EditorScreen project={{ id: 'p1', updatedAt: 0, image, settings: {} }} onClose={onClose} pro={pro} />,
      { createNodeMock: () => ({}) } // give the off-screen views a ref to capture
    );
  });
  const tree = found(rendered, 'the rendered editor');
  mounted.push(tree);
  const area = found(
    tree.root.findAll((n) => n.props && typeof n.props.onLayout === 'function')[0],
    'the measured canvas area'
  );
  await act(async () => {
    area.props.onLayout({ nativeEvent: { layout: { width: 400, height: 700 } } });
  });
  return { tree, onClose };
}

/** Press a Chip or PrimaryButton by its label, checking it is not disabled. */
async function press(tree: ReactTestRenderer, label: string) {
  const [first] = tree.root.findAll((n) => n.props && n.props.label === label);
  expect(first).toBeDefined();
  const node = found(first, label);
  expect(node.props.disabled).toBeFalsy();
  await act(async () => {
    await node.props.onPress();
  });
}

/** The pixel size the last capture will actually produce on this platform. */
function deliveredPixels({ platform, pixelRatio }: { platform: string; pixelRatio: number }) {
  const [, options] = found(jest.mocked(captureRef).mock.calls.at(-1), 'a capture');
  // iOS reads width/height as points and rasterises at the screen scale
  // (a UIGraphicsImageRenderer with format scale 0, in RNViewShot.mm).
  const scale = platform === 'ios' ? pixelRatio : 1;
  // A size that was not passed is NaN here, and fails every comparison made with it.
  return { width: (options?.width ?? NaN) * scale, height: (options?.height ?? NaN) * scale };
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
    expect(found(jest.mocked(captureRef).mock.calls[0], 'a capture')[1]).toMatchObject({
      format: 'png',
      quality: 1,
      width: PHOTO.width,
      height: PHOTO.height,
    });
  });

  it('renders the turnaround sheet at the same size on every device', async () => {
    const sizes: { width: number; height: number }[] = [];
    for (const pixelRatio of [2, 3]) {
      jest.clearAllMocks();
      const { tree } = await mountEditor({ platform: 'ios', pixelRatio });
      await press(tree, 'Turnaround\nsix views');
      sizes.push(deliveredPixels({ platform: 'ios', pixelRatio }));
    }
    expect(sizes[0]).toEqual(sizes[1]);
  });
});

describe('while an export is being captured', () => {
  it('dims the whole editor rather than taking a place in its layout', async () => {
    // React Native 0.86 has no StyleSheet.absoluteFillObject (0.79 did), and
    // spreading the undefined it reads as leaves the overlay an ordinary flex
    // child: a band under the export buttons, with the spinner in it, and the
    // editor above it neither dimmed nor covered. The web build still has the
    // name, so only a device ever showed it.
    let finish: (uri: string) => void = () => {};
    jest.mocked(captureRef).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        })
    );
    const { tree } = await mountEditor();
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);

    const button = found(
      tree.root.findAll((n) => n.props && n.props.label === 'Photo\n+ guide')[0],
      'the photo export button'
    );
    let pressed: unknown;
    await act(async () => {
      pressed = button.props.onPress(); // held open until the capture resolves
    });

    const overlay = found(tree.root.findByType(ActivityIndicator).parent, "the spinner's container");
    expect(StyleSheet.flatten(overlay.props.style)).toMatchObject({
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });

    await act(async () => {
      finish('file:///tmp/export.png');
      await pressed;
    });
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  });
});

describe('saving to the photo library', () => {
  it('asks for write access only', async () => {
    const { tree } = await mountEditor();
    await press(tree, 'Photo\n+ guide');

    const [, , buttons = []] = found(jest.mocked(Alert.alert).mock.calls[0], 'the export alert');
    const save = found(buttons.find((b) => b.text === 'Save to Photos'), 'Save to Photos');
    await act(async () => {
      await save.onPress?.();
    });

    // The app never reads or enumerates the library, so it must not ask for
    // the read scope: `true` here is expo-media-library's writeOnly flag.
    expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(true);
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///tmp/export.png');
  });
});

describe('Android hardware back', () => {
  const latest = () => found(backHandlers.at(-1), 'a back handler');

  it('leaves the editor instead of closing the app', async () => {
    const { onClose } = await mountEditor({ platform: 'android' });
    expect(latest().event).toBe('hardwareBackPress');

    let handled: boolean | null | undefined;
    await act(async () => {
      handled = latest().handler(BACK_PRESS);
    });
    expect(handled).toBe(true); // swallowed, so the activity is not finished
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('backs out of a half-finished fit before it leaves the editor', async () => {
    const { tree, onClose } = await mountEditor({ platform: 'android' });
    await press(tree, 'Fit to face');

    let handled: boolean | null | undefined;
    await act(async () => {
      handled = latest().handler(BACK_PRESS);
    });
    expect(handled).toBe(true);
    expect(onClose).not.toHaveBeenCalled(); // the fit was cancelled, not the editor
    expect(found(tree.root.findAll((n) => n.props && n.props.label === 'Fit to face')[0], 'Fit to face').props.active)
      .toBe(false);

    await act(async () => {
      latest().handler(BACK_PRESS);
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

describe('the captured temp file', () => {
  /** The alert captureRef's result is offered through, and its options. */
  const exportAlert = () => {
    const [, , buttons = [], options] = found(jest.mocked(Alert.alert).mock.calls[0], 'the export alert');
    return { buttons, options, button: (text: string) => found(buttons.find((b) => b.text === text), text) };
  };

  it.each(['Save to Photos', 'Share…', 'Cancel'])(
    'is released after %s',
    async (text) => {
      const { tree } = await mountEditor();
      await press(tree, 'Photo\n+ guide');
      const uri = await found(jest.mocked(captureRef).mock.results[0], 'a capture').value;

      await act(async () => {
        await exportAlert().button(text).onPress?.();
      });

      // captureRef writes a full-resolution PNG to the temp directory and
      // hands over the only reference to it; on iOS nothing else ever
      // deletes it, so an export that is not released is an export leaked.
      expect(releaseCapture).toHaveBeenCalledWith(uri);
      expect(releaseCapture).toHaveBeenCalledTimes(1);
    }
  );

  it('is released when Android dismisses the dialog with no button at all', async () => {
    const { tree } = await mountEditor({ platform: 'android' });
    await press(tree, 'Photo\n+ guide');

    const { options } = exportAlert();
    expect(typeof options?.onDismiss).toBe('function');
    await act(async () => options?.onDismiss?.());
    expect(releaseCapture).toHaveBeenCalledWith('file:///tmp/export.png');
  });

  it('is released exactly once even if the alert reports twice', async () => {
    const { tree } = await mountEditor({ platform: 'android' });
    await press(tree, 'Photo\n+ guide');
    const { button, options } = exportAlert();

    await act(async () => {
      await button('Cancel').onPress?.();
      options?.onDismiss?.();
    });
    expect(releaseCapture).toHaveBeenCalledTimes(1);
  });

  it('is still released when saving to the library fails', async () => {
    jest.mocked(MediaLibrary.saveToLibraryAsync).mockRejectedValueOnce(new Error('disk full'));
    const { tree } = await mountEditor();
    await press(tree, 'Photo\n+ guide');
    await act(async () => {
      await exportAlert().button('Save to Photos').onPress?.();
    });
    expect(releaseCapture).toHaveBeenCalledTimes(1);
  });
});

describe('the off-screen export views', () => {
  /** Every guide currently being rendered at full quality, anywhere. */
  const fullQuality = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(HeadGuide).filter((n) => !n.props.draft);
  const gesture = (tree: ReactTestRenderer) =>
    found(
      tree.root.findAll((n) => n.props && typeof n.props.onInteractingChange === 'function')[0],
      'the gesture layer'
    );
  const exportButton = (tree: ReactTestRenderer) =>
    found(tree.root.findAll((n) => n.props && n.props.label === 'Photo\n+ guide')[0], 'the photo export button');

  it('sit out the gesture, so draft mode is not paid for three times over', async () => {
    // Free tier, so the only guides in the tree are the on-screen one and the
    // two off-screen capture views (the turnaround sheet is Pro-only).
    const { tree } = await mountEditor({ pro: false });
    expect(fullQuality(tree)).toHaveLength(3);

    await act(async () => gesture(tree).props.onInteractingChange(true));
    // Nothing is rebuilt at 96 samples with the depth-taper split while a
    // finger is down: the on-screen guide goes to draft and the two capture
    // views, which cannot be captured mid-gesture anyway, stop rendering.
    expect(fullQuality(tree)).toHaveLength(0);
    const onScreen = tree.root.findAllByType(HeadGuide);
    expect(onScreen).toHaveLength(1);
    expect(onScreen[0]?.props.draft).toBe(true); // one guide, above

    await act(async () => gesture(tree).props.onInteractingChange(false));
    expect(fullQuality(tree)).toHaveLength(3);
  });

  it('cannot be captured while their guides are missing', async () => {
    const { tree } = await mountEditor({ pro: false });
    expect(exportButton(tree).props.disabled).toBe(false);

    await act(async () => gesture(tree).props.onInteractingChange(true));
    // Exports always render at full quality; the way that stays true is that
    // there is no way to ask for one while the guides are on their way back.
    expect(exportButton(tree).props.disabled).toBe(true);

    await act(async () => gesture(tree).props.onInteractingChange(false));
    expect(exportButton(tree).props.disabled).toBe(false);
  });
});

describe('the debounced autosave', () => {
  it('is flushed when the editor is closed inside the debounce window', async () => {
    const { tree } = await mountEditor();
    await press(tree, 'Center'); // shows the center guide line
    expect(saveSettings).not.toHaveBeenCalled(); // still inside the 600 ms wait

    await act(async () => tree.unmount());
    mounted.length = 0; // already unmounted; afterEach must not do it again

    // 'Pick up where you left off' has to include the last thing you did
    // before tapping '‹ Portraits'.
    expect(saveSettings).toHaveBeenCalledTimes(1);
    const [id, settings] = jest.mocked(saveSettings).mock.calls[0]!; // called once, above
    expect(id).toBe('p1');
    expect(settings.showCenter).toBe(true);
  });

  it('writes nothing on the way out when nothing changed', async () => {
    const { tree } = await mountEditor();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700)); // let it settle
    });
    expect(saveSettings).toHaveBeenCalledTimes(1);

    await act(async () => tree.unmount());
    mounted.length = 0;
    expect(saveSettings).toHaveBeenCalledTimes(1); // no second, duplicate write
  });
});
