import React, { useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import EditorScreen from '../EditorScreen';
import { colors } from '../../theme';

// Execute the actual Editor export callbacks. Layout, hooks and native modules
// are simulated here; these checks do not replace a device export/share test.
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: jest.fn(), useRef: jest.fn(),
  useMemo: (fn) => fn(), useEffect: () => {}, useLayoutEffect: () => {},
}));
jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable',
  ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  Alert: { alert: jest.fn() }, Platform: { OS: 'ios' },
  StyleSheet: { create: (value) => value, absoluteFill: {}, absoluteFillObject: {} },
}));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(), releaseCapture: jest.fn() }));
jest.mock('expo-media-library/legacy', () => ({ requestPermissionsAsync: jest.fn(), saveToLibraryAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-haptics', () => ({}));
jest.mock('../../lib/storage', () => ({ saveSettings: jest.fn(), recoverProjects: jest.fn() }));
jest.mock('../../components/GuideOverlay', () => 'GuideOverlay');
jest.mock('../../components/DraggableGuide', () => 'DraggableGuide');
jest.mock('../../components/HeadGuide', () => 'HeadGuide');
jest.mock('../../components/HeadGestureLayer', () => 'HeadGestureLayer');
jest.mock('../../components/FitOverlay', () => 'FitOverlay');

let states;
let refs;
let stateIndex;
let refIndex;
let renderMounted;

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!React.isValidElement(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}

function mount({ pro = false, width = 1200, height = 1800, settings = null } = {}) {
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return EditorScreen({ project: { id: 'test-project', settings, image: { uri: 'file:///portrait.png', width, height } }, pro });
  };
  renderMounted = render;
  const initial = render();
  nodes(initial).find((node) => node.props.onLayout).props.onLayout({ nativeEvent: { layout: { width: 390, height: 500 } } });
  return render();
}

async function chooseExport(tree, label, choice) {
  const pending = nodes(tree).find((node) => node.props.label === label).props.onPress();
  await Promise.resolve();
  const dialog = Alert.alert.mock.calls.findLast(([, message]) => message === 'Where do you want it?');
  if (choice) await dialog[2].find((button) => button.text === choice).onPress();
  return { pending, dialog };
}

beforeEach(() => {
  jest.clearAllMocks();
  states = [];
  refs = [];
  useState.mockImplementation((initial) => {
    const i = stateIndex++;
    if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
    return [states[i], (next) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
  });
  useRef.mockImplementation((initial) => {
    const i = refIndex++;
    if (!(i in refs)) refs[i] = { current: initial === null ? { nativeViewFixture: true } : initial };
    return refs[i];
  });
  Platform.OS = 'ios';
  captureRef.mockResolvedValue('file:///capture.png');
  releaseCapture.mockReturnValue(undefined);
  MediaLibrary.requestPermissionsAsync.mockResolvedValue({ granted: true });
  MediaLibrary.saveToLibraryAsync.mockResolvedValue(undefined);
  Sharing.isAvailableAsync.mockResolvedValue(true);
  Sharing.shareAsync.mockResolvedValue(undefined);
});

it('requests write-only saving without triggering Android Expo Go photo-read restriction', async () => {
  Platform.OS = 'android';
  // Installed SDK57 MediaLibraryModule.maybeThrowIfExpoGo runs before its
  // write-only permission filtering and rejects PHOTO/VIDEO granular requests.
  MediaLibrary.requestPermissionsAsync.mockImplementation(async (writeOnly, granular) => {
    if (granular.some((permission) => permission === 'photo' || permission === 'video')) throw new Error('Expo Go cannot request photo/video read permissions');
    return { granted: writeOnly };
  });
  const { pending } = await chooseExport(mount(), 'Photo\n+ guide', 'Save to Photos');
  await pending;
  expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(true, []);
  expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///capture.png');
  expect(Alert.alert).toHaveBeenCalledWith('Saved', 'Photo with guide was saved to your photo library.');
  expect(releaseCapture).toHaveBeenCalledWith('file:///capture.png');
});

it.each(['Photo\n+ guide', 'Guide only\ntransparent', 'Tracing\nlayer'])('captures %s as a source-resolution PNG and releases cancellation', async (label) => {
  const { pending } = await chooseExport(mount(), label, 'Cancel');
  await pending;
  expect(captureRef).toHaveBeenCalledWith(expect.anything(), { format: 'png', quality: 1, width: 1200, height: 1800 });
  expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});

it('caps a large portrait proportionally at 4096 pixels', async () => {
  const { pending } = await chooseExport(mount({ width: 6000, height: 8000 }), 'Photo\n+ guide', 'Cancel');
  await pending;
  expect(captureRef.mock.calls[0][1]).toMatchObject({ width: 3072, height: 4096 });
});

it('captures the Pro turnaround at the sheet resolution', async () => {
  const { pending } = await chooseExport(mount({ pro: true }), 'Turnaround\nsix views', 'Cancel');
  await pending;
  expect(captureRef.mock.calls[0][1]).toMatchObject({ width: 2160, height: 1680 });
});

it('mirrors the same head parameters into the visible and both guide export views', () => {
  const heads = nodes(mount()).filter((node) => node.type === 'HeadGuide');
  expect(heads).toHaveLength(3);
  for (const head of heads.slice(1)) {
    for (const key of ['transform', 'elements', 'proportions', 'color', 'thickness', 'width', 'height']) expect(head.props[key]).toEqual(heads[0].props[key]);
    expect(head.props.draft).toBe(false);
  }
});

it.each([['#f7f3ec', colors.canvasMat], ['#3f6fb0', colors.paper]])('keeps %s guides visible in Practice without changing their export color', (guideColor, backgroundColor) => {
  const tree = mount({ settings: { guideColor } });
  nodes(tree).find((node) => node.props.label === 'Practice').props.onPress();
  const active = nodes(renderMounted());
  const canvas = active.find((node) => node.type === 'View' && Array.isArray(node.props.style) && node.props.style.some((style) => style?.width > 0));
  expect(Object.assign({}, ...canvas.props.style).backgroundColor).toBe(backgroundColor);
  const heads = active.filter((node) => node.type === 'HeadGuide');
  expect(heads).toHaveLength(3);
  expect(heads.every((head) => head.props.color === guideColor)).toBe(true);
});

it('warns on denied write permission, releases the capture and does not save', async () => {
  MediaLibrary.requestPermissionsAsync.mockResolvedValue({ granted: false });
  const { pending } = await chooseExport(mount(), 'Photo\n+ guide', 'Save to Photos');
  await pending;
  expect(Alert.alert).toHaveBeenCalledWith('Permission needed', expect.any(String));
  expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});

it('warns and releases the capture after a photo library failure', async () => {
  MediaLibrary.saveToLibraryAsync.mockRejectedValue(new Error('Library full'));
  const { pending } = await chooseExport(mount(), 'Photo\n+ guide', 'Save to Photos');
  await pending;
  expect(Alert.alert).toHaveBeenCalledWith('Save failed', 'Library full');
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});

it.each(['ios', 'android'])('shares an image and preserves the platform capture lifetime on %s', async (platform) => {
  Platform.OS = platform;
  const { pending } = await chooseExport(mount(), 'Photo\n+ guide', 'Share…');
  await pending;
  expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///capture.png', { mimeType: 'image/png' });
  expect(releaseCapture).toHaveBeenCalledTimes(platform === 'android' ? 0 : 1);
});

it('warns and releases when sharing is unavailable', async () => {
  Sharing.isAvailableAsync.mockResolvedValue(false);
  const { pending } = await chooseExport(mount(), 'Photo\n+ guide', 'Share…');
  await pending;
  expect(Alert.alert).toHaveBeenCalledWith('Sharing unavailable', expect.any(String));
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});

it('warns and releases after a share error on Android', async () => {
  Platform.OS = 'android';
  Sharing.shareAsync.mockRejectedValue(new Error('No target'));
  const { pending } = await chooseExport(mount(), 'Photo\n+ guide', 'Share…');
  await pending;
  expect(Alert.alert).toHaveBeenCalledWith('Share failed', 'No target');
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});

it('allows a fresh export after capture fails without releasing a nonexistent capture', async () => {
  captureRef.mockRejectedValueOnce(new Error('Capture failed'));
  const tree = mount();
  await nodes(tree).find((node) => node.props.label === 'Photo\n+ guide').props.onPress();
  expect(Alert.alert).toHaveBeenCalledWith('Export failed', 'Capture failed');
  expect(releaseCapture).not.toHaveBeenCalled();
  const { pending } = await chooseExport(tree, 'Photo\n+ guide', 'Cancel');
  await pending;
  expect(captureRef).toHaveBeenCalledTimes(2);
  expect(releaseCapture).toHaveBeenCalledTimes(1);
});

it('keeps one export choice active and ignores another export until cancellation completes', async () => {
  const tree = mount();
  const { pending, dialog } = await chooseExport(tree, 'Photo\n+ guide');
  await nodes(tree).find((node) => node.props.label === 'Guide only\ntransparent').props.onPress();
  expect(captureRef).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(releaseCapture).not.toHaveBeenCalled();
  dialog[2].find((button) => button.text === 'Cancel').onPress();
  await pending;
  expect(releaseCapture).toHaveBeenCalledTimes(1);
  const next = await chooseExport(tree, 'Guide only\ntransparent', 'Cancel');
  await next.pending;
  expect(captureRef).toHaveBeenCalledTimes(2);
  expect(releaseCapture).toHaveBeenCalledTimes(2);
});
