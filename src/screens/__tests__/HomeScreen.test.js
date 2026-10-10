import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import HomeScreen from '../HomeScreen';
import {
  createProject, deleteProject, hasRecoveryCopies, inspectRecoverableProjects, listProjects,
} from '../../lib/storage';

// Run Home's actual import, navigation and removal callbacks. Hooks, picker,
// storage and native views are mocked. These checks do not verify native camera,
// picker permissions, file copying, device accessibility or scrolling.
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: jest.fn(), useEffect: jest.fn(), useCallback: jest.fn((callback) => callback),
}));
jest.mock('react-native', () => ({
  Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Text: 'Text', View: 'View', Alert: { alert: jest.fn() },
  StyleSheet: { create: (value) => value },
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(), launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Path: 'Path' }));
jest.mock('../../lib/storage', () => ({
  clearRecoveryCopies: jest.fn(), createProject: jest.fn(), deleteProject: jest.fn(),
  hasRecoveryCopies: jest.fn(), inspectRecoverableProjects: jest.fn(),
  listProjects: jest.fn(), recoverProjects: jest.fn(),
}));

const projects = [
  { id: 'portrait-original-a', image: { uri: 'file:///a.jpg', width: 700, height: 900 }, settings: { showHead: true } },
  { id: 'portrait-original-b', image: { uri: 'file:///b.jpg', width: 800, height: 1000 }, settings: { showHead: false } },
];
let states;
let stateIndex;
let effects;
let collectEffects;

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!React.isValidElement(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}

function namedControl(tree, name) {
  const control = nodes(tree).find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === name);
  expect(control).toBeDefined();
  return control;
}

function textControl(tree, text) {
  const control = nodes(tree).find((node) => node.type === 'Pressable' &&
    nodes(node).some((child) => child.type === 'Text' && child.props.children === text));
  expect(control).toBeDefined();
  return control;
}

function expectOriginalRecents(tree) {
  expect(nodes(tree).filter((node) => node.type === 'Image').map((node) => node.props.source.uri)).toEqual(
    projects.map((project) => project.image.uri)
  );
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function mount() {
  const onOpenProject = jest.fn();
  const render = () => {
    stateIndex = 0;
    return HomeScreen({ onOpenProject });
  };
  collectEffects = true;
  render();
  collectEffects = false;
  for (const effect of effects) effect();
  await settle();
  return { render, onOpenProject };
}

beforeEach(() => {
  jest.clearAllMocks();
  states = [];
  effects = [];
  collectEffects = false;
  useState.mockImplementation((initial) => {
    const i = stateIndex++;
    if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
    return [states[i], (next) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
  });
  useEffect.mockImplementation((effect) => { if (collectEffects) effects.push(effect); });
  useCallback.mockImplementation((callback) => callback);
  listProjects.mockResolvedValue(projects);
  hasRecoveryCopies.mockResolvedValue(false);
  deleteProject.mockResolvedValue(undefined);
  createProject.mockResolvedValue(projects[0]);
  ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
  ImagePicker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: null });
  ImagePicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
});

it('names each portrait and opens its original project without changing its guide settings', async () => {
  const { render, onOpenProject } = await mount();
  const tree = render();
  for (let index = 0; index < projects.length; index += 1) {
    const portrait = namedControl(tree, `Open drawing ${index + 1}`);
    expect(portrait.props.accessibilityRole).toBe('button');
    expect(portrait.props.accessibilityHint).toBe('Reopen this portrait and its guides.');
    portrait.props.onPress();
    expect(onOpenProject).toHaveBeenLastCalledWith(projects[index]);
    const remove = namedControl(tree, `Remove drawing ${index + 1}`);
    expect(remove.props.accessibilityRole).toBe('button');
    expect(nodes(remove).some((node) => node.type === 'Text' && node.props.children === 'Remove')).toBe(true);
  }
  expect(deleteProject).not.toHaveBeenCalled();
});

it('leaves a drawing intact when its explicit removal confirmation is cancelled', async () => {
  const { render } = await mount();
  namedControl(render(), 'Remove drawing 2').props.onPress();
  const [title, , buttons] = Alert.alert.mock.calls[0];
  expect(title).toBe('Remove drawing?');
  expect(buttons.map(({ text, style }) => ({ text, style }))).toEqual([
    { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive' },
  ]);
  expect(deleteProject).not.toHaveBeenCalled();
  buttons[0].onPress?.();
  await settle();
  expect(deleteProject).not.toHaveBeenCalled();
  expect(listProjects).toHaveBeenCalledTimes(1);
});

it('removes only the confirmed project and refreshes after its deletion completes', async () => {
  let finishDeletion;
  deleteProject.mockReturnValue(new Promise((resolve) => { finishDeletion = resolve; }));
  const { render, onOpenProject } = await mount();
  namedControl(render(), 'Remove drawing 2').props.onPress();
  expect(deleteProject).not.toHaveBeenCalled();
  const pending = Alert.alert.mock.calls[0][2].find((button) => button.style === 'destructive').onPress();
  expect(deleteProject).toHaveBeenCalledTimes(1);
  expect(deleteProject).toHaveBeenCalledWith('portrait-original-b');
  expect(listProjects).toHaveBeenCalledTimes(1);
  listProjects.mockResolvedValue([projects[0]]);
  finishDeletion();
  await pending;
  await settle();
  expect(listProjects).toHaveBeenCalledTimes(2);
  expect(hasRecoveryCopies).toHaveBeenCalledTimes(2);
  expect(namedControl(render(), 'Open drawing 1')).toBeDefined();
  expect(nodes(render()).some((node) => node.props.accessibilityLabel === 'Open drawing 2')).toBe(false);
  expect(onOpenProject).not.toHaveBeenCalled();
});

it('keeps long-press removal behind the same destructive confirmation', async () => {
  const { render } = await mount();
  namedControl(render(), 'Open drawing 1').props.onLongPress();
  expect(Alert.alert.mock.calls[0][0]).toBe('Remove drawing?');
  expect(deleteProject).not.toHaveBeenCalled();
  await Alert.alert.mock.calls[0][2].find((button) => button.style === 'destructive').onPress();
  expect(deleteProject).toHaveBeenCalledWith('portrait-original-a');
});

it('keeps recovery portraits openable while disabling both removal paths', async () => {
  listProjects.mockRejectedValue(new Error('Damaged saved index'));
  inspectRecoverableProjects.mockResolvedValue({ projects, skippedCount: 1, resetSettingsCount: 0, renamedIdCount: 0 });
  const { render, onOpenProject } = await mount();
  const tree = render();
  for (let index = 0; index < projects.length; index += 1) {
    const portrait = namedControl(tree, `Open drawing ${index + 1}`);
    expect(portrait.props.disabled).not.toBe(true);
    portrait.props.onPress();
    expect(onOpenProject).toHaveBeenLastCalledWith({ ...projects[index], recoveryRequired: true });
    portrait.props.onLongPress?.();
    const remove = namedControl(tree, `Remove drawing ${index + 1}`);
    expect(remove.props.disabled).toBe(true);
    expect(remove.props.accessibilityState).toMatchObject({ disabled: true });
    // React Native suppresses disabled button presses. Calling the handler
    // directly also proves the destructive callback itself respects recovery.
    remove.props.onPress?.();
  }
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(deleteProject).not.toHaveBeenCalled();
});

it('imports only the selected image and opens the durable project after creation completes', async () => {
  const asset = { uri: 'file:///picker-cache/portrait.jpg', width: 1200, height: 1800, fileName: 'portrait.jpg' };
  const created = { id: 'created-library-project', image: { ...asset, uri: 'file:///drawdraw/library.jpg' }, settings: {} };
  let finishCreation;
  createProject.mockReturnValue(new Promise((resolve) => { finishCreation = resolve; }));
  ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [asset] });
  const { render, onOpenProject } = await mount();
  const pending = textControl(render(), 'Choose a portrait').props.onPress();
  await settle();
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({ mediaTypes: ['images'], quality: 1 });
  expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  expect(createProject).toHaveBeenCalledTimes(1);
  expect(createProject).toHaveBeenCalledWith(asset);
  expect(onOpenProject).not.toHaveBeenCalled();
  expect(textControl(render(), 'Choose a portrait').props.disabled).toBe(true);
  finishCreation(created);
  await pending;
  expect(onOpenProject).toHaveBeenCalledTimes(1);
  expect(onOpenProject).toHaveBeenCalledWith(created);
  expect(textControl(render(), 'Choose a portrait').props.disabled).toBe(false);
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('requests camera permission before taking a photo and creates the exact returned asset', async () => {
  const asset = { uri: 'file:///camera-cache/portrait.jpg', width: 1800, height: 1200 };
  const created = { id: 'created-camera-project', image: { ...asset, uri: 'file:///drawdraw/camera.jpg' }, settings: {} };
  ImagePicker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [asset] });
  createProject.mockResolvedValue(created);
  const { render, onOpenProject } = await mount();
  await textControl(render(), 'Take a photo').props.onPress();
  expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith({ quality: 1 });
  expect(ImagePicker.requestCameraPermissionsAsync.mock.invocationCallOrder[0]).toBeLessThan(
    ImagePicker.launchCameraAsync.mock.invocationCallOrder[0]
  );
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  expect(createProject).toHaveBeenCalledTimes(1);
  expect(createProject).toHaveBeenCalledWith(asset);
  expect(onOpenProject).toHaveBeenCalledWith(created);
  expect(Alert.alert).not.toHaveBeenCalled();
});

it.each([
  ['Choose a portrait', 'launchImageLibraryAsync', { canceled: true, assets: [{ uri: 'file:///cancelled.jpg', width: 20, height: 30 }] }],
  ['Choose a portrait', 'launchImageLibraryAsync', { canceled: false, assets: null }],
  ['Choose a portrait', 'launchImageLibraryAsync', { canceled: false, assets: [] }],
  ['Take a photo', 'launchCameraAsync', { canceled: true, assets: [{ uri: 'file:///cancelled.jpg', width: 20, height: 30 }] }],
  ['Take a photo', 'launchCameraAsync', { canceled: false, assets: null }],
  ['Take a photo', 'launchCameraAsync', { canceled: false, assets: [] }],
])('%s preserves recent drawings for a cancelled or empty picker result %#', async (label, method, result) => {
  ImagePicker[method].mockResolvedValue(result);
  const { render, onOpenProject } = await mount();
  await textControl(render(), label).props.onPress();
  expect(createProject).not.toHaveBeenCalled();
  expect(onOpenProject).not.toHaveBeenCalled();
  expect(deleteProject).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  expectOriginalRecents(render());
  expect(textControl(render(), label).props.disabled).toBe(false);
});

it.each([
  ['Choose a portrait', 'launchImageLibraryAsync', { width: 0, height: 1800 }],
  ['Choose a portrait', 'launchImageLibraryAsync', { width: 1200 }],
  ['Take a photo', 'launchCameraAsync', { width: 0, height: 1800 }],
  ['Take a photo', 'launchCameraAsync', { width: 1200 }],
])('%s warns when an asset has unreadable dimensions %#', async (label, method, dimensions) => {
  ImagePicker[method].mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///unreadable.jpg', ...dimensions }] });
  const { render, onOpenProject } = await mount();
  await textControl(render(), label).props.onPress();
  expect(Alert.alert).toHaveBeenCalledWith('Unsupported image', 'Could not read the dimensions of that image.');
  expect(createProject).not.toHaveBeenCalled();
  expect(onOpenProject).not.toHaveBeenCalled();
  expectOriginalRecents(render());
});

it.each([
  ['Choose a portrait', 'launchImageLibraryAsync', 'Could not import portrait'],
  ['Take a photo', 'launchCameraAsync', 'Could not take photo'],
])('%s keeps existing drawings when durable project creation fails', async (label, method, title) => {
  const asset = { uri: 'file:///temporary/portrait.jpg', width: 1200, height: 1800 };
  ImagePicker[method].mockResolvedValue({ canceled: false, assets: [asset] });
  createProject.mockRejectedValue(new Error('Could not copy portrait into durable storage'));
  const { render, onOpenProject } = await mount();
  await textControl(render(), label).props.onPress();
  expect(createProject).toHaveBeenCalledTimes(1);
  expect(createProject).toHaveBeenCalledWith(asset);
  expect(Alert.alert).toHaveBeenCalledWith(title, 'Could not copy portrait into durable storage');
  expect(onOpenProject).not.toHaveBeenCalled();
  expect(deleteProject).not.toHaveBeenCalled();
  expect(listProjects).toHaveBeenCalledTimes(1);
  expectOriginalRecents(render());
  expect(textControl(render(), label).props.disabled).toBe(false);
});

it('does not launch the camera or create a project when permission is denied', async () => {
  ImagePicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
  const { render, onOpenProject } = await mount();
  await textControl(render(), 'Take a photo').props.onPress();
  expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  expect(createProject).not.toHaveBeenCalled();
  expect(onOpenProject).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('Permission needed', 'Allow camera access to take a portrait.');
  expectOriginalRecents(render());
  expect(textControl(render(), 'Take a photo').props.disabled).toBe(false);
});

it('reports a camera permission error without launching the camera', async () => {
  ImagePicker.requestCameraPermissionsAsync.mockRejectedValue(new Error('Camera permission service unavailable'));
  const { render, onOpenProject } = await mount();
  await textControl(render(), 'Take a photo').props.onPress();
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  expect(createProject).not.toHaveBeenCalled();
  expect(onOpenProject).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('Could not take photo', 'Camera permission service unavailable');
  expectOriginalRecents(render());
});
