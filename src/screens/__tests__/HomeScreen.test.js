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
