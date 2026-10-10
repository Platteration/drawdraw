import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { createProject, deleteProject, listProjects, saveSettings } from '../storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  copyAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

let raw;
const asset = { uri: 'file:///cache/portrait.png', width: 600, height: 900 };
const project = (id) => ({
  id,
  updatedAt: 1,
  image: { ...asset, uri: `file:///documents/portraits/${id}.png` },
  settings: null,
});

beforeEach(() => {
  jest.restoreAllMocks();
  jest.resetAllMocks();
  raw = null;
  AsyncStorage.getItem.mockImplementation(async () => raw);
  AsyncStorage.setItem.mockImplementation(async (_key, value) => { raw = value; });
  FileSystem.getInfoAsync.mockResolvedValue({ exists: true });
  FileSystem.copyAsync.mockResolvedValue(undefined);
  FileSystem.deleteAsync.mockResolvedValue(undefined);
});

it('keeps concurrent imports and gives them distinct files even in the same millisecond', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(12345);
  const [first, second] = await Promise.all([createProject(asset), createProject(asset)]);
  expect(first.id).not.toBe(second.id);
  expect(first.image.uri).not.toBe(second.image.uri);
  expect(await listProjects()).toHaveLength(2);
});

it('serializes settings updates without losing another project', async () => {
  raw = JSON.stringify([project('p1'), project('p2')]);
  await Promise.all([saveSettings('p1', { lineWeight: 3 }), saveSettings('p2', { lineWeight: 4 })]);
  const projects = await listProjects();
  expect(projects.find((p) => p.id === 'p1').settings.lineWeight).toBe(3);
  expect(projects.find((p) => p.id === 'p2').settings.lineWeight).toBe(4);
});

it('does not silently discard an older drawing on the thirty-first import', async () => {
  raw = JSON.stringify(Array.from({ length: 30 }, (_, i) => project(`p${i}`)));
  await createProject(asset);
  expect(await listProjects()).toHaveLength(31);
  expect((await listProjects()).some((p) => p.id === 'p0')).toBe(true);
});

it('preserves a corrupt index instead of replacing it with a new project', async () => {
  raw = '{broken';
  await expect(createProject(asset)).rejects.toThrow();
  expect(raw).toBe('{broken');
  expect(FileSystem.copyAsync).not.toHaveBeenCalled();
});

it('reports an unreadable index instead of pretending the library is empty', async () => {
  AsyncStorage.getItem.mockRejectedValue(new Error('storage unavailable'));
  await expect(listProjects()).rejects.toThrow('storage unavailable');
});

it('warns when a portrait is only a temporary copy', async () => {
  FileSystem.copyAsync.mockRejectedValue(new Error('disk full'));
  const result = await createProject(asset);
  expect(result.image.uri).toBe(asset.uri);
  expect(result.persistenceWarning).toEqual(expect.any(String));
});

it('removes a newly copied portrait if its index cannot be saved', async () => {
  AsyncStorage.setItem.mockRejectedValue(new Error('disk full'));
  await expect(createProject(asset)).rejects.toThrow('disk full');
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
    expect.stringMatching(/^file:\/\/\/documents\/portraits\/p/), { idempotent: true }
  );
});

it('does not delete the photo when removal cannot be committed', async () => {
  raw = JSON.stringify([project('p1')]);
  AsyncStorage.setItem.mockRejectedValue(new Error('disk full'));
  await expect(deleteProject('p1')).rejects.toThrow('disk full');
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  expect(await listProjects()).toHaveLength(1);
});

it('restores the index if deleting a portrait fails so removal can be retried', async () => {
  raw = JSON.stringify([project('p1')]);
  FileSystem.deleteAsync.mockRejectedValue(new Error('file locked'));
  await expect(deleteProject('p1')).rejects.toThrow('file locked');
  expect(await listProjects()).toHaveLength(1);
});

it.each([
  'file:///documents/portraits/../private.json',
  'file:///documents/portraits/p1.png/../private.json',
  'file:///documents/portraits/p2.png',
  'file:///cache/portrait.png',
])('never deletes a file the project does not own: %s', async (uri) => {
  raw = JSON.stringify([{ ...project('p1'), image: { ...asset, uri } }]);
  await deleteProject('p1');
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
});

it('rejects invalid dimensions before storing an unusable project', async () => {
  await expect(createProject({ ...asset, width: Infinity })).rejects.toThrow();
  expect(FileSystem.copyAsync).not.toHaveBeenCalled();
});

it('continues accepting saves after a failed write', async () => {
  raw = JSON.stringify([project('p1')]);
  AsyncStorage.setItem.mockRejectedValueOnce(new Error('disk full'));
  await expect(saveSettings('p1', { lineWeight: 3 })).rejects.toThrow();
  await saveSettings('p1', { lineWeight: 4 });
  expect((await listProjects())[0].settings.lineWeight).toBe(4);
});
