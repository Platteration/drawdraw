/**
 * The project index owns the portrait copies on disk. Every path that removes
 * a record has to remove its file, and no path may write a record whose file
 * does not exist — otherwise the app accumulates full-resolution copies of
 * people's faces that nothing can reach, or Recent entries that go blank.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __store: store,
    getItem: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItem: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
  };
});

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  makeDirectoryAsync: jest.fn(async () => {}),
  copyAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

import { createProject, deleteProject, listProjects, saveSettings } from '../storage';

const INDEX_KEY = 'drawdraw.projects.v1';
const PORTRAIT_DIR = 'file:///docs/portraits/';
const MAX_PROJECTS = 30; // storage.js's own ceiling

const stored = (projects) => AsyncStorage.__store.set(INDEX_KEY, JSON.stringify(projects));
const readIndex = () => JSON.parse(AsyncStorage.__store.get(INDEX_KEY));

/** `count` durable projects, oldest last, the way the index is ordered. */
const seed = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `old${i}`,
    updatedAt: count - i,
    image: { uri: `${PORTRAIT_DIR}old${i}.jpg`, width: 100, height: 200 },
    settings: null,
  }));

const ASSET = { uri: 'file:///cache/IMG_0001.jpg', width: 4032, height: 3024 };

beforeEach(() => {
  jest.clearAllMocks();
  AsyncStorage.__store.clear();
  FileSystem.getInfoAsync.mockResolvedValue({ exists: true });
  FileSystem.copyAsync.mockResolvedValue(undefined);
  FileSystem.deleteAsync.mockResolvedValue(undefined);
});

describe('createProject', () => {
  it('copies the picked image somewhere durable and indexes that copy', async () => {
    const project = await createProject(ASSET);

    expect(FileSystem.copyAsync).toHaveBeenCalledWith({
      from: ASSET.uri,
      to: `${PORTRAIT_DIR}${project.id}.jpg`,
    });
    expect(project.image.uri).toBe(`${PORTRAIT_DIR}${project.id}.jpg`);
    expect(project.ephemeral).toBeUndefined();
    expect(readIndex().map((p) => p.id)).toEqual([project.id]);
  });

  it('deletes the portrait of the project that falls off the end of the list', async () => {
    stored(seed(MAX_PROJECTS));
    const project = await createProject(ASSET);

    const index = readIndex();
    expect(index).toHaveLength(MAX_PROJECTS);
    expect(index[0].id).toBe(project.id);
    // The oldest record is gone from the index; its copy has to go with it,
    // or every import past the thirtieth orphans a full-resolution portrait.
    const oldest = `old${MAX_PROJECTS - 1}`;
    expect(index.some((p) => p.id === oldest)).toBe(false);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(`${PORTRAIT_DIR}${oldest}.jpg`, {
      idempotent: true,
    });
    expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
  });

  it('leaves everything on disk while the list still has room', async () => {
    stored(seed(MAX_PROJECTS - 1));
    await createProject(ASSET);
    expect(readIndex()).toHaveLength(MAX_PROJECTS);
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  });

  it('does not delete a file it never copied', async () => {
    // A project that fell back to the picker's URI owns nothing in the
    // portraits directory, and that URI is not ours to delete.
    const survivors = seed(MAX_PROJECTS);
    survivors[MAX_PROJECTS - 1].image.uri = 'file:///cache/someone-elses.jpg';
    stored(survivors);
    await createProject(ASSET);
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  });

  it('keeps a project whose durable copy failed out of the index', async () => {
    FileSystem.copyAsync.mockRejectedValue(new Error('no space left on device'));
    stored(seed(2));

    const project = await createProject(ASSET);

    // It still opens this session, on the picker's own URI...
    expect(project.image.uri).toBe(ASSET.uri);
    expect(project.ephemeral).toBe(true);
    // ...but it is not written to the index, because once the OS clears its
    // cache that entry is a Recent thumbnail pointing at a deleted file with
    // no way to repair it from inside the app.
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(readIndex().map((p) => p.id)).toEqual(['old0', 'old1']);
  });
});

describe('deleteProject', () => {
  it('removes the record and the copy together', async () => {
    stored(seed(3));
    await deleteProject('old1');
    expect(readIndex().map((p) => p.id)).toEqual(['old0', 'old2']);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(`${PORTRAIT_DIR}old1.jpg`, {
      idempotent: true,
    });
  });

  it('survives a file that has already gone', async () => {
    stored(seed(2));
    FileSystem.deleteAsync.mockRejectedValue(new Error('ENOENT'));
    await expect(deleteProject('old0')).resolves.toBeUndefined();
    expect(readIndex().map((p) => p.id)).toEqual(['old1']);
  });
});

describe('listProjects', () => {
  it('leaves out a record the app could not open', async () => {
    stored([
      seed(1)[0],
      { id: 'broken', updatedAt: 1 }, // no image at all
      { id: 'alsoBroken', image: { uri: 'file:///x.jpg' } }, // no dimensions
    ]);
    expect((await listProjects()).map((p) => p.id)).toEqual(['old0']);
  });

  it('is empty rather than throwing on an index that is not JSON', async () => {
    AsyncStorage.__store.set(INDEX_KEY, '{not json');
    expect(await listProjects()).toEqual([]);
  });

  it('drops a broken record permanently on the next write', async () => {
    stored([seed(1)[0], { id: 'broken' }]);
    await saveSettings('old0', { showHead: false });
    expect(readIndex().map((p) => p.id)).toEqual(['old0']);
    expect(readIndex()[0].settings).toEqual({ showHead: false });
  });
});
