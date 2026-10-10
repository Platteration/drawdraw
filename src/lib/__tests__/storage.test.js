import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import {
  clearRecoveryCopies, createProject, deleteProject, hasRecoveryCopies, inspectRecoverableProjects, listProjects, recoverProjects, saveSettings,
} from '../storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  copyAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const INDEX_KEY = 'drawdraw.projects.v1';
const RECOVERY_KEY = 'drawdraw.projects.recovery.v1';
const asset = { uri: 'file:///cache/portrait.jpg', width: 400, height: 600 };
const project = (id) => ({
  id,
  updatedAt: 1,
  image: { uri: `file:///documents/portraits/${id}.jpg`, width: 400, height: 600 },
  settings: { yaw: 0 },
});

let stored;
let backups;
beforeEach(() => {
  jest.resetAllMocks();
  stored = JSON.stringify([project('first'), project('second')]);
  backups = null;
  Platform.OS = 'ios';
  FileSystem.documentDirectory = 'file:///documents/';
  AsyncStorage.getItem.mockImplementation(async (key) => key === RECOVERY_KEY ? backups : stored);
  AsyncStorage.setItem.mockImplementation(async (key, value) => {
    if (key === RECOVERY_KEY) backups = value;
    else stored = value;
  });
  AsyncStorage.removeItem.mockImplementation(async (key) => {
    if (key === RECOVERY_KEY) backups = null;
  });
  FileSystem.getInfoAsync.mockResolvedValue({ exists: true });
  FileSystem.makeDirectoryAsync.mockResolvedValue(undefined);
  FileSystem.copyAsync.mockResolvedValue(undefined);
  FileSystem.deleteAsync.mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

it('keeps all earlier drawings when importing beyond thirty projects', async () => {
  stored = JSON.stringify(Array.from({ length: 30 }, (_, i) => project(`existing-${i}`)));
  const added = await createProject(asset);
  const projects = await listProjects();
  expect(projects).toHaveLength(31);
  expect(projects[0].id).toBe(added.id);
  expect(projects[30].id).toBe('existing-29');
  expect(FileSystem.copyAsync).toHaveBeenCalledWith({
    from: asset.uri,
    to: added.image.uri,
  });
  expect(added.image.uri).toMatch(/^file:\/\/\/documents\/portraits\/.+\.jpg$/);
});

it.each([
  ['import', () => createProject(asset)],
  ['autosave', () => saveSettings('first', { yaw: 20 })],
  ['delete', () => deleteProject('first')],
])('does not overwrite or unlink anything when %s cannot read the index', async (_name, mutate) => {
  const original = stored;
  AsyncStorage.getItem.mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(mutate()).rejects.toThrow('Storage unavailable');
  expect(stored).toBe(original);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(FileSystem.copyAsync).not.toHaveBeenCalled();
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
});

it.each(['{broken', '{"unexpected":"object"}'])('preserves unreadable index data: %s', async (raw) => {
  stored = raw;
  await expect(saveSettings('first', { yaw: 20 })).rejects.toThrow();
  expect(stored).toBe(raw);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it.each([
  null,
  { id: 'damaged' },
  { ...project('damaged'), id: '' },
  { ...project('damaged'), image: { uri: '', width: 400, height: 600 } },
  { ...project('damaged'), image: { uri: 'file:///portrait.jpg', width: 0, height: 600 } },
  { ...project('damaged'), image: { uri: 'file:///portrait.jpg', width: '400', height: 600 } },
  { ...project('damaged'), image: { uri: 'file:///portrait.jpg', width: 400, height: -1 } },
  { ...project('damaged'), settings: [] },
  { ...project('damaged'), settings: 'damaged' },
])('reports malformed project %p without overwriting or unlinking its stored data', async (entry) => {
  const raw = JSON.stringify([project('first'), entry]);
  stored = raw;
  await expect(listProjects()).rejects.toThrow('Saved drawings could not be read');
  await expect(createProject(asset)).rejects.toThrow('Saved drawings could not be read');
  await expect(saveSettings('first', { yaw: 20 })).rejects.toThrow('Saved drawings could not be read');
  await expect(deleteProject('first')).rejects.toThrow('Saved drawings could not be read');
  expect(stored).toBe(raw);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(FileSystem.copyAsync).not.toHaveBeenCalled();
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
});

it('serializes updates so saves to different projects both survive', async () => {
  await Promise.all([
    saveSettings('first', { yaw: 20 }),
    saveSettings('second', { yaw: 30 }),
  ]);
  const projects = await listProjects();
  expect(projects.find((p) => p.id === 'first').settings).toEqual({ yaw: 20 });
  expect(projects.find((p) => p.id === 'second').settings).toEqual({ yaw: 30 });
});

it('preserves deletion and another project save when both are in flight', async () => {
  await Promise.all([deleteProject('first'), saveSettings('second', { yaw: 30 })]);
  expect(await listProjects()).toEqual([expect.objectContaining({ id: 'second', settings: { yaw: 30 } })]);
});

it('gives simultaneous imports unique ids and portrait paths', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(12345);
  const [first, second] = await Promise.all([createProject(asset), createProject(asset)]);
  expect(first.id).not.toBe(second.id);
  expect(first.image.uri).not.toBe(second.image.uri);
  expect((await listProjects()).map((p) => p.id)).toEqual([
    second.id, first.id, 'first', 'second',
  ]);
});

it('reports failed durable copies without saving a temporary native URI', async () => {
  const original = stored;
  FileSystem.copyAsync.mockRejectedValueOnce(new Error('No space left'));
  await expect(createProject(asset)).rejects.toThrow('No space left');
  expect(stored).toBe(original);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it('reports unavailable native document storage before writing anything', async () => {
  FileSystem.documentDirectory = null;
  await expect(createProject(asset)).rejects.toThrow('Portrait storage is unavailable');
  expect(FileSystem.copyAsync).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it('keeps the web picker data URI without calling native filesystem helpers', async () => {
  Platform.OS = 'web';
  const webAsset = { ...asset, uri: 'data:image/png;base64,cG9ydHJhaXQ=' };
  const added = await createProject(webAsset);
  expect(added.image.uri).toBe(webAsset.uri);
  expect((await listProjects())[0]).toEqual(added);
  expect(FileSystem.getInfoAsync).not.toHaveBeenCalled();
  expect(FileSystem.copyAsync).not.toHaveBeenCalled();
});

it('preserves a portrait if removing its index entry fails', async () => {
  const original = stored;
  AsyncStorage.setItem.mockRejectedValueOnce(new Error('Write failed'));
  await expect(deleteProject('first')).rejects.toThrow('Write failed');
  expect(stored).toBe(original);
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
});

it('restores the project for a later retry if deleting its portrait fails', async () => {
  const original = stored;
  FileSystem.deleteAsync.mockRejectedValueOnce(new Error('Unlink failed'));
  await expect(deleteProject('first')).rejects.toThrow('Unlink failed');
  expect(stored).toBe(original);
  await deleteProject('first');
  expect((await listProjects()).map((p) => p.id)).toEqual(['second']);
});

it('reports both failures if portrait deletion and index rollback fail', async () => {
  FileSystem.deleteAsync.mockRejectedValueOnce(new Error('Unlink failed'));
  AsyncStorage.setItem
    .mockImplementationOnce(async (_key, value) => { stored = value; })
    .mockRejectedValueOnce(new Error('Rollback failed'));
  await expect(deleteProject('first')).rejects.toThrow(/portrait.*could not be deleted/i);
  expect((await listProjects()).map((p) => p.id)).toEqual(['second']);
});

it('removes a newly copied portrait if saving the new index fails', async () => {
  AsyncStorage.setItem.mockRejectedValueOnce(new Error('Write failed'));
  await expect(createProject(asset)).rejects.toThrow('Write failed');
  const destination = FileSystem.copyAsync.mock.calls[0][0].to;
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(destination, { idempotent: true });
  expect((await listProjects()).map((p) => p.id)).toEqual(['first', 'second']);
});

it('reports an import cleanup failure while preserving the previous index', async () => {
  const original = stored;
  AsyncStorage.setItem.mockRejectedValueOnce(new Error('Write failed'));
  FileSystem.deleteAsync.mockRejectedValueOnce(new Error('Unlink failed'));
  await expect(createProject(asset)).rejects.toThrow(/copied portrait could not be deleted/i);
  expect(stored).toBe(original);
});

it('allows later operations to proceed after a failed mutation', async () => {
  AsyncStorage.getItem.mockRejectedValueOnce(new Error('Temporary read failure'));
  await expect(saveSettings('first', { yaw: 10 })).rejects.toThrow('Temporary read failure');
  await saveSettings('first', { yaw: 20 });
  expect((await listProjects()).find((p) => p.id === 'first').settings).toEqual({ yaw: 20 });
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(INDEX_KEY, expect.any(String));
});

it('inspects readable drawings without changing a damaged index', async () => {
  const raw = JSON.stringify([project('first'), null, { id: 'damaged' }]);
  stored = raw;
  await expect(inspectRecoverableProjects()).resolves.toEqual({
    projects: [project('first')], skippedCount: 2,
  });
  await expect(listProjects()).rejects.toThrow('Saved drawings could not be read');
  expect(stored).toBe(raw);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it('preserves the exact original index before explicitly recovering readable drawings', async () => {
  const raw = ` [ ${JSON.stringify(project('first'))}, null ]\n`;
  stored = raw;
  const recovered = await recoverProjects();
  expect(recovered).toEqual({ projects: [project('first')], skippedCount: 1 });
  expect(JSON.parse(backups)).toEqual([{ raw, createdAt: expect.any(Number) }]);
  expect(AsyncStorage.setItem.mock.calls.map(([key]) => key)).toEqual([RECOVERY_KEY, INDEX_KEY]);
  expect(await listProjects()).toEqual([project('first')]);
  await saveSettings('first', { yaw: 20 });
  expect((await listProjects())[0].settings).toEqual({ yaw: 20 });
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
});

it('preserves previous recovery backups when another damaged index is repaired', async () => {
  const earlier = { raw: '["earlier damaged index"]', createdAt: 1 };
  backups = JSON.stringify([earlier]);
  const raw = JSON.stringify([project('first'), null]);
  stored = raw;
  await recoverProjects();
  expect(JSON.parse(backups)).toEqual([earlier, { raw, createdAt: expect.any(Number) }]);
});

it.each(['not json', '{}', '[null]', '[{"raw":123}]'])(
  'does not overwrite an unreadable existing recovery archive: %s', async (rawBackup) => {
    backups = rawBackup;
    const raw = JSON.stringify([project('first'), null]);
    stored = raw;
    await expect(recoverProjects()).rejects.toThrow('Previous recovery backups could not be read');
    expect(backups).toBe(rawBackup);
    expect(stored).toBe(raw);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  }
);

it('does not change the damaged index if preserving its backup fails', async () => {
  const raw = JSON.stringify([project('first'), null]);
  stored = raw;
  AsyncStorage.setItem.mockRejectedValueOnce(new Error('Backup storage full'));
  await expect(recoverProjects()).rejects.toThrow('Backup storage full');
  expect(stored).toBe(raw);
  expect(backups).toBeNull();
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(RECOVERY_KEY, expect.any(String));
});

it('keeps the recovery backup when repairing the index fails and can retry without duplicating it', async () => {
  const raw = JSON.stringify([project('first'), null]);
  stored = raw;
  AsyncStorage.setItem.mockImplementation(async (key, value) => {
    if (key === INDEX_KEY) throw new Error('Index write failed');
    backups = value;
  });
  await expect(recoverProjects()).rejects.toThrow('Index write failed');
  expect(stored).toBe(raw);
  const preserved = backups;
  expect(JSON.parse(backups)[0].raw).toBe(raw);
  AsyncStorage.setItem.mockImplementation(async (key, value) => {
    if (key === INDEX_KEY) stored = value;
    else backups = value;
  });
  await recoverProjects();
  expect(backups).toBe(preserved);
  expect(await listProjects()).toEqual([project('first')]);
});

it.each(['not json', '{}', '[null]', '[]'])(
  'leaves an index with no recoverable drawings unchanged: %s', async (raw) => {
    stored = raw;
    await expect(recoverProjects()).rejects.toThrow();
    expect(stored).toBe(raw);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  }
);

it('serializes recovery and a following save without losing the saved settings', async () => {
  stored = JSON.stringify([project('first'), null]);
  await Promise.all([recoverProjects(), saveSettings('first', { yaw: 20 })]);
  expect((await listProjects())[0].settings).toEqual({ yaw: 20 });
  expect(JSON.parse(backups)[0].raw).toContain('null');
});

it('deletes a partially copied portrait after the native copy fails', async () => {
  const partialFiles = new Set();
  FileSystem.copyAsync.mockImplementationOnce(async ({ to }) => {
    partialFiles.add(to);
    throw new Error('Copy ran out of space');
  });
  FileSystem.deleteAsync.mockImplementationOnce(async (uri) => { partialFiles.delete(uri); });
  await expect(createProject(asset)).rejects.toThrow('Copy ran out of space');
  expect(partialFiles.size).toBe(0);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it('reports both native copy and cleanup failure without changing the project index', async () => {
  const original = stored;
  FileSystem.copyAsync.mockRejectedValueOnce(new Error('Copy ran out of space'));
  FileSystem.deleteAsync.mockRejectedValueOnce(new Error('Cleanup failed'));
  await expect(createProject(asset)).rejects.toThrow(/Copy ran out of space.*partially copied portrait could not be deleted/);
  expect(stored).toBe(original);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it('allows recovery copies, including unreadable archives, to be removed without touching drawings', async () => {
  const active = stored;
  expect(await hasRecoveryCopies()).toBe(false);
  backups = 'unreadable recovery copy';
  expect(await hasRecoveryCopies()).toBe(true);
  await clearRecoveryCopies();
  expect(await hasRecoveryCopies()).toBe(false);
  expect(stored).toBe(active);
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(RECOVERY_KEY);
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
});

it('reports failed recovery copy removal and preserves its data for retry', async () => {
  backups = JSON.stringify([{ raw: '[null]', createdAt: 1 }]);
  const savedCopy = backups;
  AsyncStorage.removeItem.mockRejectedValueOnce(new Error('Removal failed'));
  await expect(clearRecoveryCopies()).rejects.toThrow('Removal failed');
  expect(backups).toBe(savedCopy);
  await clearRecoveryCopies();
  expect(backups).toBeNull();
});

const readableHead = { yaw: 0, pitch: 0, roll: 0, x: 0.5, y: 0.45, scale: 0.6 };
const readableProportions = { width: 1, depth: 1, noseY: -0.5, browY: 0.5 };

it.each([
  'damaged',
  [],
  { hGuides: 'damaged', showHorizontal: true },
  { vGuides: {}, showVertical: true },
  { hGuides: [0.5, 'damaged'] },
  { vGuides: [null] },
  { headTransform: 'damaged' },
  { headTransform: [] },
  { headTransform: {} },
  { headTransform: { ...readableHead, yaw: 'damaged' } },
  { headTransform: { ...readableHead, yaw: Infinity } },
  { headTransform: { ...readableHead, scale: null } },
  { proportions: 'damaged' },
  { proportions: [] },
  { proportions: {} },
  { proportions: { ...readableProportions, browY: 'damaged' } },
  { proportions: { ...readableProportions, browY: NaN } },
  { proportions: { ...readableProportions, width: 0 } },
  { elements: [] },
  { elements: { segments: 'damaged' } },
  { guideColor: {} },
  { lineWeight: 'damaged' },
  { tracingOpacity: {} },
  { showHead: {} },
  { showHorizontal: 'damaged' },
])('preserves malformed guide settings and exposes the portrait with safe defaults: %p', async (settings) => {
  const damaged = { ...project('damaged-settings'), settings };
  const raw = JSON.stringify([project('first'), damaged]);
  stored = raw;
  await expect(listProjects()).rejects.toThrow('Saved drawings could not be read');
  await expect(saveSettings('first', { yaw: 20 })).rejects.toThrow('Saved drawings could not be read');
  expect(stored).toBe(raw);
  await expect(inspectRecoverableProjects()).resolves.toEqual({
    projects: [project('first'), { ...damaged, settings: null }],
    skippedCount: 0, resetSettingsCount: 1,
  });
  expect(stored).toBe(raw);
  expect(backups).toBeNull();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it('keeps valid and unknown guide settings unchanged during read-only inspection', async () => {
  const settings = {
    headTransform: readableHead, proportions: readableProportions,
    elements: { segments: true, center: false, futureElement: { retained: true } },
    hGuides: [0.2, 0.8], vGuides: [], showHead: false,
    showHorizontal: true, showVertical: false, showCenter: true,
    guideColor: '#ffffff', lineWeight: 2, tracingOpacity: 0.3,
    futureSetting: { retained: true },
  };
  const saved = { ...project('first'), settings };
  stored = JSON.stringify([saved]);
  expect(await listProjects()).toEqual([saved]);
  expect(await inspectRecoverableProjects()).toEqual({ projects: [saved], skippedCount: 0 });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it('backs up the exact original before repairing guide settings without dropping its portrait', async () => {
  const damaged = { ...project('first'), settings: { vGuides: 'damaged', showVertical: true } };
  const raw = ` [ ${JSON.stringify(damaged)} ]\n`;
  stored = raw;
  expect(await recoverProjects()).toEqual({
    projects: [{ ...damaged, settings: null }], skippedCount: 0, resetSettingsCount: 1,
  });
  expect(JSON.parse(backups)).toEqual([{ raw, createdAt: expect.any(Number) }]);
  expect(AsyncStorage.setItem.mock.calls.map(([key]) => key)).toEqual([RECOVERY_KEY, INDEX_KEY]);
  expect(await listProjects()).toEqual([{ ...damaged, settings: null }]);
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
});

it('keeps original malformed settings when its recovery copy cannot be written', async () => {
  const raw = JSON.stringify([{ ...project('first'), settings: { headTransform: [] } }]);
  stored = raw;
  AsyncStorage.setItem.mockRejectedValueOnce(new Error('Backup storage full'));
  await expect(recoverProjects()).rejects.toThrow('Backup storage full');
  expect(stored).toBe(raw);
  expect(backups).toBeNull();
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
});

function collidingProjects() {
  return [project('same'), { ...project('same'), image: project('different-photo').image, settings: { yaw: 20 } }];
}

it('rejects duplicate project ids before a save, deletion or import can change either drawing', async () => {
  const raw = JSON.stringify(collidingProjects());
  stored = raw;
  await expect(listProjects()).rejects.toThrow('Saved drawings could not be read');
  await expect(saveSettings('same', { yaw: 90 })).rejects.toThrow('Saved drawings could not be read');
  await expect(deleteProject('same')).rejects.toThrow('Saved drawings could not be read');
  await expect(createProject(asset)).rejects.toThrow('Saved drawings could not be read');
  expect(stored).toBe(raw);
  expect(backups).toBeNull();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(FileSystem.copyAsync).not.toHaveBeenCalled();
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
});

it('exposes both colliding drawings with distinct stable ids without rewriting their data', async () => {
  const [first, second] = collidingProjects();
  const raw = JSON.stringify([first, second]);
  stored = raw;
  const expected = {
    projects: [first, { ...second, id: 'same-recovered-1' }], skippedCount: 0, renamedIdCount: 1,
  };
  expect(await inspectRecoverableProjects()).toEqual(expected);
  expect(await inspectRecoverableProjects()).toEqual(expected);
  expect(stored).toBe(raw);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it('chooses recovery ids that do not collide with any later original drawing', async () => {
  stored = JSON.stringify([...collidingProjects(), project('same-recovered-1'), project('same')]);
  const recovered = await inspectRecoverableProjects();
  expect(recovered.projects.map(({ id }) => id)).toEqual([
    'same', 'same-recovered-2', 'same-recovered-1', 'same-recovered-3',
  ]);
  expect(recovered.renamedIdCount).toBe(2);
  expect(await recoverProjects()).toEqual(recovered);
  expect(await listProjects()).toEqual(recovered.projects);
});

it('archives colliding ids before repair so saving and deleting one drawing preserves the other', async () => {
  const [first, second] = collidingProjects();
  const raw = ` [ ${JSON.stringify(first)}, ${JSON.stringify(second)} ]\n`;
  stored = raw;
  const recovered = await recoverProjects();
  expect(JSON.parse(backups)).toEqual([{ raw, createdAt: expect.any(Number) }]);
  expect(AsyncStorage.setItem.mock.calls.map(([key]) => key)).toEqual([RECOVERY_KEY, INDEX_KEY]);
  expect(recovered.projects[1].id).toBe('same-recovered-1');
  await saveSettings(recovered.projects[1].id, { yaw: 90 });
  expect((await listProjects()).find(({ id }) => id === first.id)).toEqual(first);
  expect((await listProjects()).find(({ id }) => id === recovered.projects[1].id).settings).toEqual({ yaw: 90 });
  await deleteProject(recovered.projects[1].id);
  expect(await listProjects()).toEqual([first]);
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(second.image.uri, { idempotent: true });
});

it('leaves colliding ids and both portraits untouched if their recovery copy cannot be saved', async () => {
  const raw = JSON.stringify(collidingProjects());
  stored = raw;
  AsyncStorage.setItem.mockRejectedValueOnce(new Error('Backup storage full'));
  await expect(recoverProjects()).rejects.toThrow('Backup storage full');
  expect(stored).toBe(raw);
  expect(backups).toBeNull();
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
});

it('retains a shared legacy portrait until its last recovered drawing is removed', async () => {
  stored = JSON.stringify([project('same'), { ...project('same'), settings: { yaw: 20 } }]);
  const recovered = await recoverProjects();
  await deleteProject(recovered.projects[0].id);
  expect(await listProjects()).toEqual([recovered.projects[1]]);
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  await deleteProject(recovered.projects[1].id);
  expect(await listProjects()).toEqual([]);
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(project('same').image.uri, { idempotent: true });
});
