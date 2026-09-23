/**
 * Importing a portrait is the app's main entry point, so what it asks the OS
 * for matters: the system picker hands back the one chosen image out of
 * process, and requesting library access on top of that both over-asks and
 * gives a user who declines no way into the app at all.
 */
import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Platform, Text } from 'react-native';

jest.mock('expo-image-picker', () => ({
  // The real enums, so the call below is checked against the value it carries.
  UIImagePickerPreferredAssetRepresentationMode: jest.requireActual('expo-image-picker')
    .UIImagePickerPreferredAssetRepresentationMode,
  PermissionStatus: jest.requireActual('expo-image-picker').PermissionStatus,
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: false })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
}));
jest.mock('../../lib/storage', () => ({
  listProjects: jest.fn(async () => []),
  createProject: jest.fn(async (asset: unknown) => ({ id: 'p1', image: asset, settings: {} })),
  deleteProject: jest.fn(async () => {}),
}));

import * as ImagePicker from 'expo-image-picker';
import type { Project } from '../../lib/projectShape';
import { createProject, deleteProject, listProjects } from '../../lib/storage';
import HomeScreen from '../HomeScreen';

/** `value`, which the test needs to be there: a missing one fails the test here, by name. */
function found<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`${what} is missing`);
  return value;
}

async function mount() {
  const onOpenProject = jest.fn();
  let rendered: ReactTestRenderer | undefined;
  await act(async () => {
    rendered = renderer.create(<HomeScreen onOpenProject={onOpenProject} />);
  });
  const tree = found(rendered, 'the rendered home screen');
  const pressByLabel = async (label: string) => {
    const button = tree.root
      .findAll((n) => n.props && typeof n.props.onPress === 'function')
      .find((n) => n.findAllByType(Text).some((t) => t.props.children === label));
    expect(button).toBeDefined();
    await act(async () => {
      await found(button, label).props.onPress();
    });
  };
  return { tree, onOpenProject, pressByLabel };
}

const realOS = Platform.OS;
const hadWindow = typeof window !== 'undefined';
const realConfirm = hadWindow ? window.confirm : undefined;

/**
 * Puts `value` where a page's confirm would be. The DOM types say a window
 * always has one; the test environment's has none, and that is what is put
 * back afterwards.
 */
const setConfirm = (value: unknown) =>
  Object.defineProperty(window, 'confirm', { value, configurable: true, writable: true });

/** A page to run on: the test environment's window, or one made for the test. */
const onAPage = () => {
  if (!hadWindow) Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true });
};

/** A stand-in for the browser dialog that answers `answer`. */
const dialog = (answer: boolean) => {
  const confirm = jest.fn((_message?: string) => answer);
  setConfirm(confirm);
  return confirm;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  Platform.OS = realOS;
  if (hadWindow) setConfirm(realConfirm);
  else Reflect.deleteProperty(globalThis, 'window');
});

describe('choosing a portrait', () => {
  it('opens the picker without asking for library access', async () => {
    const { pressByLabel } = await mount();
    await pressByLabel('Choose a portrait');

    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
    // Stills only, full quality, and on iOS the representation the import was
    // built on: SDK 54 moved the picker's default from `automatic` to
    // `current`, which hands over the library's original container instead.
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      quality: 1,
      preferredAssetRepresentationMode: 'automatic',
    });
    // The picker runs out of process and returns only the chosen image, so a
    // library grant buys nothing — and refusing it used to lock the user out.
    expect(ImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('still asks before opening the camera', async () => {
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce({
      granted: false,
      status: ImagePicker.PermissionStatus.DENIED,
      expires: 'never',
      canAskAgain: true,
    });
    const { pressByLabel } = await mount();
    await pressByLabel('Take a photo');

    // The camera has no out-of-process picker to fall back on.
    expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalled();
  });
});

describe('removing a recent portrait', () => {
  const RECENT: Project = {
    id: 'p9',
    updatedAt: 1,
    image: { uri: 'file:///docs/portraits/p9.jpg', width: 10, height: 20 },
    settings: null,
  };

  /** Mount with one recent and hand back its long-press. */
  async function mountWithRecent() {
    jest.mocked(listProjects).mockResolvedValueOnce([RECENT]);
    const { tree } = await mount();
    const thumb = tree.root.findAll((n) => n.props && typeof n.props.onLongPress === 'function')[0];
    expect(thumb).toBeDefined();
    return () => act(async () => found(thumb, 'the recent thumbnail').props.onLongPress());
  }

  it('asks through the browser dialog on the web, where Alert.alert is an empty stub', async () => {
    // react-native-web's Alert is `class Alert { static alert() {} }`: the
    // confirm used to go through it, so on the web build a long-press showed
    // nothing and removed nothing, with no error to notice.
    Platform.OS = 'web';
    onAPage();
    const confirm = dialog(true);

    const longPress = await mountWithRecent();
    await longPress();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deleteProject).toHaveBeenCalledWith('p9');
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('removes nothing when the dialog is cancelled', async () => {
    Platform.OS = 'web';
    onAPage();
    dialog(false);

    const longPress = await mountWithRecent();
    await longPress();

    expect(deleteProject).not.toHaveBeenCalled();
  });

  it('asks through a two-button alert on a device, and removes only on Remove', async () => {
    Platform.OS = 'ios';
    const longPress = await mountWithRecent();
    await longPress();

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [, , buttons = []] = jest.mocked(Alert.alert).mock.calls[0]!; // called once, above
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Remove']);
    expect(deleteProject).not.toHaveBeenCalled();
    await act(async () => buttons[1]?.onPress?.());
    expect(deleteProject).toHaveBeenCalledWith('p9');
  });
});

describe('a portrait that could not be copied anywhere durable', () => {
  it('is opened, but the user is told it will not be in Recent', async () => {
    const asset = { uri: 'file:///cache/IMG_1.jpg', width: 100, height: 200 };
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: false, assets: [asset] });
    // storage refuses to index a project whose durable copy failed, because a
    // Recent entry pointing into the OS cache goes blank and cannot be fixed.
    jest
      .mocked(createProject)
      .mockResolvedValueOnce({ id: 'p1', updatedAt: 0, image: asset, settings: null, ephemeral: true });

    const { onOpenProject, pressByLabel } = await mount();
    await pressByLabel('Choose a portrait');

    expect(onOpenProject).toHaveBeenCalledTimes(1); // it still opens this session
    expect(Alert.alert).toHaveBeenCalledTimes(1); // and it says so, rather than failing silently
  });

  it('says nothing at all when the copy worked', async () => {
    const asset = { uri: 'file:///cache/IMG_2.jpg', width: 100, height: 200 };
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: false, assets: [asset] });

    const { onOpenProject, pressByLabel } = await mount();
    await pressByLabel('Choose a portrait');

    expect(onOpenProject).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
