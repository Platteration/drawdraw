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

// The delete guard has to hold on its own, so one test below puts a record
// past the sanitizer the way a build without the URI check would.
jest.mock('../projectShape', () => {
  const actual = jest.requireActual('../projectShape');
  return { ...actual, sanitizeProjects: jest.fn(actual.sanitizeProjects) };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

import { sanitizeProjects } from '../projectShape';
import { createProject, deleteProject, listProjects, saveSettings } from '../storage';

const realSanitizeProjects = jest.requireActual('../projectShape').sanitizeProjects;

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
  sanitizeProjects.mockImplementation(realSanitizeProjects);
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

describe('removePortrait', () => {
  const record = (uri) => ({ id: 'tampered', updatedAt: 9, image: { uri, width: 1, height: 1 } });

  it('will not delete above the portraits directory, whatever the index says', async () => {
    // The prefix guard alone is satisfied by a path that climbs back out of
    // the directory it names, and deleteAsync resolves it: on Android that
    // reaches the app's own databases/ and shared_prefs/ — the AsyncStorage
    // file holding this very index among them. sanitizeProject refuses such a
    // record too; this asserts the deletion guard without it, because a
    // long-press delete and the MAX_PROJECTS truncation both call it.
    sanitizeProjects.mockImplementation((raw) => raw); // as a laxer build would
    for (const uri of [
      `${PORTRAIT_DIR}../../databases/RKStorage`,
      `${PORTRAIT_DIR}..%2f..%2fdatabases/RKStorage`,
      `${PORTRAIT_DIR}%2e%2e/%2e%2e/shared_prefs/prefs.xml`,
      `${PORTRAIT_DIR}a/../../b.jpg`,
    ]) {
      stored([record(uri)]);
      await deleteProject('tampered');
      expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
    }

    // The same path with no `..` in it is a portrait, and is deleted.
    stored([record(`${PORTRAIT_DIR}p1.jpg`)]);
    await deleteProject('tampered');
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(`${PORTRAIT_DIR}p1.jpg`, {
      idempotent: true,
    });
  });

  it('will not delete above it when the truncation is what fired', async () => {
    // MAX_PROJECTS drops the oldest record and removes its file with nobody
    // asking for a deletion at all.
    sanitizeProjects.mockImplementation((raw) => raw);
    const survivors = seed(MAX_PROJECTS);
    survivors[MAX_PROJECTS - 1].image.uri = `${PORTRAIT_DIR}../../databases/RKStorage`;
    stored(survivors);
    await createProject(ASSET);
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
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
