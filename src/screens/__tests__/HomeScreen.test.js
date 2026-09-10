/**
 * Importing a portrait is the app's main entry point, so what it asks the OS
 * for matters: the system picker hands back the one chosen image out of
 * process, and requesting library access on top of that both over-asks and
 * gives a user who declines no way into the app at all.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: false })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
}));
jest.mock('../../lib/storage', () => ({
  listProjects: jest.fn(async () => []),
  createProject: jest.fn(async (asset) => ({ id: 'p1', image: asset, settings: {} })),
  deleteProject: jest.fn(async () => {}),
}));

import * as ImagePicker from 'expo-image-picker';
import { createProject } from '../../lib/storage';
import HomeScreen from '../HomeScreen';

async function mount() {
  const onOpenProject = jest.fn();
  let tree;
  await act(async () => {
    tree = renderer.create(<HomeScreen onOpenProject={onOpenProject} />);
  });
  const pressByLabel = async (label) => {
    const button = tree.root
      .findAll((n) => n.props && typeof n.props.onPress === 'function')
      .find((n) => n.findAllByType('Text').some((t) => t.props.children === label));
    expect(button).toBeDefined();
    await act(async () => {
      await button.props.onPress();
    });
  };
  return { tree, onOpenProject, pressByLabel };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('choosing a portrait', () => {
  it('opens the picker without asking for library access', async () => {
    const { pressByLabel } = await mount();
    await pressByLabel('Choose a portrait');

    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
    // The picker runs out of process and returns only the chosen image, so a
    // library grant buys nothing — and refusing it used to lock the user out.
    expect(ImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('still asks before opening the camera', async () => {
    ImagePicker.requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: false });
    const { pressByLabel } = await mount();
    await pressByLabel('Take a photo');

    // The camera has no out-of-process picker to fall back on.
    expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalled();
  });
});

describe('a portrait that could not be copied anywhere durable', () => {
  it('is opened, but the user is told it will not be in Recent', async () => {
    const asset = { uri: 'file:///cache/IMG_1.jpg', width: 100, height: 200 };
    ImagePicker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [asset] });
    // storage refuses to index a project whose durable copy failed, because a
    // Recent entry pointing into the OS cache goes blank and cannot be fixed.
    createProject.mockResolvedValueOnce({ id: 'p1', image: asset, settings: null, ephemeral: true });

    const { onOpenProject, pressByLabel } = await mount();
    await pressByLabel('Choose a portrait');

    expect(onOpenProject).toHaveBeenCalledTimes(1); // it still opens this session
    expect(Alert.alert).toHaveBeenCalledTimes(1); // and it says so, rather than failing silently
  });

  it('says nothing at all when the copy worked', async () => {
    const asset = { uri: 'file:///cache/IMG_2.jpg', width: 100, height: 200 };
    ImagePicker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [asset] });

    const { onOpenProject, pressByLabel } = await mount();
    await pressByLabel('Choose a portrait');

    expect(onOpenProject).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
