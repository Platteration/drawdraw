/**
 * What becomes of a captured export on a device: the photo library or the
 * share sheet, through one dialog, and the temporary PNG captureRef wrote is
 * released exactly once, after whatever was chosen has finished with it.
 */
jest.mock('expo-media-library/legacy', () => ({
  // The real enum, so a permission answer below is the shape the module gives.
  PermissionStatus: jest.requireActual('expo-media-library/legacy').PermissionStatus,
  requestPermissionsAsync: jest.fn(),
  saveToLibraryAsync: jest.fn(),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('react-native-view-shot', () => ({ releaseCapture: jest.fn() }));

import { Alert } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import type { PermissionResponse } from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { releaseCapture } from 'react-native-view-shot';

import { offerExport } from '../exports';

const URI = 'file:///cache/export.png';
const GRANTED: PermissionResponse = {
  granted: true,
  status: MediaLibrary.PermissionStatus.GRANTED,
  expires: 'never',
  canAskAgain: true,
};

/** `value`, which the test needs to be there: a missing one fails the test here, by name. */
function found<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`${what} is missing`);
  return value;
}

/** The export dialog: its buttons by text, and its options. */
function dialog() {
  const [title, , buttons = [], options] = found(jest.mocked(Alert.alert).mock.calls[0], 'the export dialog');
  const press = async (text: string) => found(buttons.find((b) => b.text === text), text).onPress?.();
  const dismiss = () => found(options?.onDismiss, 'onDismiss')();
  return { title, buttons, options, press, dismiss };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(MediaLibrary.requestPermissionsAsync).mockResolvedValue(GRANTED);
  jest.mocked(MediaLibrary.saveToLibraryAsync).mockResolvedValue(undefined);
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
  jest.mocked(releaseCapture).mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

it('offers the library, the share sheet and Cancel, and lets Android dismiss it with a tap outside', () => {
  void offerExport(URI, 'Portrait');
  const { title, buttons, options } = dialog();
  expect(title).toBe('Portrait');
  expect(buttons.map((b) => b.text)).toEqual(['Save to Photos', 'Share…', 'Cancel']);
  // Without cancelable, Android holds the dialog against a tap outside it.
  expect(options?.cancelable).toBe(true);
  expect(typeof options?.onDismiss).toBe('function');
});

it('asks for write access alone, saves, and then releases the file', async () => {
  const done = offerExport(URI, 'Portrait');
  await dialog().press('Save to Photos');
  await done;

  // `true` is expo-media-library's writeOnly flag, and nothing follows it: a
  // granular list buys nothing with writeOnly, and on Android inside Expo Go
  // a list naming 'photo' throws.
  expect(jest.mocked(MediaLibrary.requestPermissionsAsync).mock.calls).toEqual([[true]]);
  expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith(URI);
  expect(releaseCapture).toHaveBeenCalledWith(URI);
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});

it('releases a cancelled export once, however many ways the cancel is reported, and asks for nothing', async () => {
  const done = offerExport(URI, 'Portrait');
  await dialog().press('Cancel');
  dialog().dismiss();
  await done;

  expect(releaseCapture).toHaveBeenCalledTimes(1);
  expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled();
});

it('releases a dismissed export, the dialog gone with no button pressed', async () => {
  const done = offerExport(URI, 'Portrait');
  dialog().dismiss();
  await done;
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});

it('says what is needed when the permission is refused, and still releases the file', async () => {
  jest.mocked(MediaLibrary.requestPermissionsAsync).mockResolvedValue({ ...GRANTED, granted: false });
  const done = offerExport(URI, 'Portrait');
  await dialog().press('Save to Photos');
  await done;

  expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('Permission needed', expect.any(String));
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});

it('says why a save failed, and still releases the file', async () => {
  jest.mocked(MediaLibrary.saveToLibraryAsync).mockRejectedValue(new Error('disk full'));
  const done = offerExport(URI, 'Portrait');
  await dialog().press('Save to Photos');
  await done;

  expect(Alert.alert).toHaveBeenLastCalledWith('Save failed', 'disk full');
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});

it('keeps the file while the share sheet is still reading it, whatever reports in the meantime', async () => {
  // Android can report the dialog dismissed while the share it started is
  // still under way; releasing then takes the file from under the share.
  let finishShare: () => void = () => {};
  jest.mocked(Sharing.shareAsync).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishShare = resolve;
      })
  );
  const done = offerExport(URI, 'Portrait');
  const sharing = dialog().press('Share…');
  await Promise.resolve();
  await Promise.resolve();
  dialog().dismiss();
  expect(Sharing.shareAsync).toHaveBeenCalledWith(URI, { mimeType: 'image/png' });
  expect(releaseCapture).not.toHaveBeenCalled();

  finishShare();
  await sharing;
  await done;
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});

it('says when this device cannot share, and releases the file', async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
  const done = offerExport(URI, 'Portrait');
  await dialog().press('Share…');
  await done;

  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('Sharing unavailable', expect.any(String));
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});

it('finishes even when the release itself throws: the export was saved by then', async () => {
  jest.mocked(releaseCapture).mockImplementation(() => {
    throw new Error('already gone');
  });
  const done = offerExport(URI, 'Portrait');
  await dialog().press('Save to Photos');
  await expect(done).resolves.toBeUndefined();
  expect(Alert.alert).toHaveBeenLastCalledWith('Saved', 'Portrait was saved to your photo library.');
});

it('releases the file and fails when the dialog cannot be shown at all', async () => {
  jest.mocked(Alert.alert).mockImplementation(() => {
    throw new Error('no window');
  });
  await expect(offerExport(URI, 'Portrait')).rejects.toThrow('no window');
  expect(releaseCapture).toHaveBeenCalledWith(URI);
});
