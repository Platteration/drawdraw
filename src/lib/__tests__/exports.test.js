import { Alert } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { releaseCapture } from 'react-native-view-shot';
import { offerExport } from '../exports';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('expo-media-library/legacy', () => ({
  requestPermissionsAsync: jest.fn(), saveToLibraryAsync: jest.fn(),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('react-native-view-shot', () => ({ releaseCapture: jest.fn() }));

const uri = 'file:///cache/export.png';
const dialog = () => Alert.alert.mock.calls[0];

beforeEach(() => {
  jest.resetAllMocks();
  MediaLibrary.requestPermissionsAsync.mockResolvedValue({ granted: true });
  MediaLibrary.saveToLibraryAsync.mockResolvedValue(undefined);
  Sharing.isAvailableAsync.mockResolvedValue(true);
  Sharing.shareAsync.mockResolvedValue(undefined);
});

it('asks for write-only photo permission and releases the image after saving', async () => {
  const done = offerExport(uri, 'Portrait');
  await dialog()[2][0].onPress();
  await done;
  expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(true, ['photo']);
  expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith(uri);
  expect(releaseCapture).toHaveBeenCalledWith(uri);
});

it('releases canceled and dismissed exports without requesting permissions', async () => {
  const done = offerExport(uri, 'Portrait');
  await dialog()[2][2].onPress();
  dialog()[3].onDismiss();
  await done;
  expect(releaseCapture).toHaveBeenCalledTimes(1);
  expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled();
});

it('cleans up after permission denial and reports the failure', async () => {
  MediaLibrary.requestPermissionsAsync.mockResolvedValue({ granted: false });
  const done = offerExport(uri, 'Portrait');
  await dialog()[2][0].onPress();
  await done;
  expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('Permission needed', expect.any(String));
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});

it('retains the temporary file until an asynchronous share finishes', async () => {
  let finishShare;
  Sharing.shareAsync.mockImplementation(() => new Promise((resolve) => { finishShare = resolve; }));
  const done = offerExport(uri, 'Portrait');
  const selected = dialog()[2][1].onPress();
  await Promise.resolve();
  dialog()[3].onDismiss();
  expect(releaseCapture).not.toHaveBeenCalled();
  finishShare();
  await selected;
  await done;
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});

it('cleans up when saving throws', async () => {
  MediaLibrary.saveToLibraryAsync.mockRejectedValue(new Error('disk full'));
  const done = offerExport(uri, 'Portrait');
  await dialog()[2][0].onPress();
  await done;
  expect(Alert.alert).toHaveBeenLastCalledWith('Save failed', 'disk full');
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});
