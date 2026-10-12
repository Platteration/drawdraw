/**
 * The project index owns the portrait copies on disk. Every path that removes
 * a record has to remove its file, no path may write a record whose file does
 * not exist, and nothing removes a record the user did not remove — otherwise
 * the app accumulates full-resolution copies of people's faces that nothing
 * can reach, Recent entries that go blank, or a library that loses drawings
 * behind the user's back. And an index that will not read is reported, never
 * taken for an empty one and written over.
 */
// What AsyncStorage holds, as a test reads and plants it. The factory below is
// hoisted above this line, which is fine: it only reads the map when called.
const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => (mockStore.has(key) ? mockStore.get(key) : null)),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
}));

// The legacy entry point is the one storage.ts imports: the package root has
// had the File/Directory API since SDK 54, and its functions of these names
// throw. A mock of the root would let this suite pass over that.
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  makeDirectoryAsync: jest.fn(async () => {}),
  copyAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
}));

// The delete guard has to hold on its own, so some tests below put a record
// past the sanitizer the way a build without the URI check would.
jest.mock('../projectShape', () => {
  const actual = jest.requireActual('../projectShape');
  return { ...actual, sanitizeProjects: jest.fn(actual.sanitizeProjects) };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import { sanitizeProjects, type Project } from '../projectShape';
import { createProject, deleteProject, listProjects, saveSettings } from '../storage';

const realSanitizeProjects = jest.requireActual<typeof import('../projectShape')>('../projectShape').sanitizeProjects;

/** What a build with no validator would hand back: the parsed index, unexamined. */
const unvalidated = (raw: unknown): Project[] => (Array.isArray(raw) ? raw : []);

const INDEX_KEY = 'drawdraw.projects.v1';
const PORTRAIT_DIR = 'file:///docs/portraits/';
const OLD_CEILING = 30; // the length the index used to be cut to

/** Plants an index, well-formed or not. */
const stored = (projects: unknown[]) => mockStore.set(INDEX_KEY, JSON.stringify(projects));
/** The index as it was last written; there has to be one. */
const readIndex = (): Project[] => {
  const raw = mockStore.get(INDEX_KEY);
  if (raw === undefined) throw new Error('no index was written');
  return JSON.parse(raw);
};

/** `count` durable projects, oldest last, the way the index is ordered, each owning the file createProject would name. */
const seed = (count: number): Project[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    updatedAt: count - i,
    image: { uri: `${PORTRAIT_DIR}p${i}.jpg`, width: 100, height: 200 },
    settings: null,
  }));

const ASSET = { uri: 'file:///cache/IMG_0001.jpg', width: 4032, height: 3024 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  jest.mocked(sanitizeProjects).mockImplementation(realSanitizeProjects);
  mockStore.clear();
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (key: string) => mockStore.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key: string, value: string) => {
    mockStore.set(key, value);
  });
  // storage.ts reads `exists` alone; the rest is what a directory's info carries.
  jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({
    exists: true,
    uri: PORTRAIT_DIR,
    size: 0,
    isDirectory: true,
    modificationTime: 0,
  });
  jest.mocked(FileSystem.copyAsync).mockResolvedValue(undefined);
  jest.mocked(FileSystem.deleteAsync).mockResolvedValue(undefined);
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

  it('keeps every drawing on the thirty-first import, and deletes nothing', async () => {
    // The index used to be cut to thirty, and the drawing that fell off the
    // end went with its portrait, without anyone asking: the user's own work,
    // gone behind their back. The library now grows until they remove one.
    stored(seed(OLD_CEILING));
    const project = await createProject(ASSET);

    const index = readIndex();
    expect(index).toHaveLength(OLD_CEILING + 1);
    expect(index[0]?.id).toBe(project.id);
    expect(index.some((p) => p.id === `p${OLD_CEILING - 1}`)).toBe(true); // the oldest is still there
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  });

  it('leaves everything on disk while the list still has room', async () => {
    stored(seed(OLD_CEILING - 1));
    await createProject(ASSET);
    expect(readIndex()).toHaveLength(OLD_CEILING);
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  });

  it('does not delete a file it never copied', async () => {
    // A project that fell back to the picker's URI owns nothing in the
    // portraits directory, and that URI is not ours to delete.
    const survivors = seed(OLD_CEILING);
    survivors[OLD_CEILING - 1]!.image.uri = 'file:///cache/someone-elses.jpg'; // seeded OLD_CEILING
    stored(survivors);
    await createProject(ASSET);
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  });

  it('keeps a project whose durable copy failed out of the index', async () => {
    jest.mocked(FileSystem.copyAsync).mockRejectedValue(new Error('no space left on device'));
    stored(seed(2));

    const project = await createProject(ASSET);

    // It still opens this session, on the picker's own URI...
    expect(project.image.uri).toBe(ASSET.uri);
    expect(project.ephemeral).toBe(true);
    // ...but it is not written to the index, because once the OS clears its
    // cache that entry is a Recent thumbnail pointing at a deleted file with
    // no way to repair it from inside the app.
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(readIndex().map((p) => p.id)).toEqual(['p0', 'p1']);
  });

  it('keeps concurrent imports, each with its own id and file, even in the same millisecond', async () => {
    // The id was the millisecond alone, and both imports read the index before
    // either wrote it: one file overwrote the other, and one record was lost.
    jest.spyOn(Date, 'now').mockReturnValue(12345);
    const [first, second] = await Promise.all([createProject(ASSET), createProject(ASSET)]);

    expect(first.id).not.toBe(second.id);
    expect(first.image.uri).not.toBe(second.image.uri);
    expect(readIndex().map((p) => p.id).sort()).toEqual([first.id, second.id].sort());
  });

  it.each([
    ['will not parse', '{broken'],
    ['is not a list', '{"p1":{}}'],
  ])('opens the portrait unsaved, and writes nothing, when the index %s', async (_, raw) => {
    // A failed read taken for an empty library is what the next write makes
    // permanent: the whole library replaced by this one portrait. Refusing the
    // import instead would leave the app's one way in dead for good, since
    // nothing in it can repair the index. So the portrait opens, unsaved, as
    // when its copy fails, and the index stays exactly as it was.
    mockStore.set(INDEX_KEY, raw);

    const project = await createProject(ASSET);

    expect(project.ephemeral).toBe(true);
    expect(project.image.uri).toBe(ASSET.uri);
    expect(mockStore.get(INDEX_KEY)).toBe(raw);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(FileSystem.copyAsync).not.toHaveBeenCalled(); // no copy for nothing to own
  });

  it('removes the copy it made when the index will not take the record', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValue(new Error('disk full'));

    await expect(createProject(ASSET)).rejects.toThrow('disk full');

    const [copied] = jest.mocked(FileSystem.copyAsync).mock.calls[0] ?? [];
    expect(copied?.to).toMatch(new RegExp(`^${PORTRAIT_DIR}p`));
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(copied?.to, { idempotent: true });
  });

  it('says so when that copy will not go either', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValue(new Error('disk full'));
    jest.mocked(FileSystem.deleteAsync).mockRejectedValue(new Error('read-only'));

    await expect(createProject(ASSET)).rejects.toThrow('its copied portrait could not be removed');
  });

  it.each([
    { ...ASSET, width: Infinity },
    { ...ASSET, width: Number.NaN },
    { ...ASSET, height: 0 },
    { ...ASSET, uri: '' },
  ])('refuses a portrait with no usable size or address, before copying anything: %o', async (asset) => {
    await expect(createProject(asset)).rejects.toThrow('Could not read that portrait');
    expect(FileSystem.copyAsync).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('saveSettings', () => {
  it('keeps both of two saves made at once', async () => {
    // Each read the index, changed its own record and wrote the list back, so
    // the second write put back the first record's old settings.
    stored(seed(2));
    await Promise.all([saveSettings('p0', { lineWeight: 3 }), saveSettings('p1', { lineWeight: 4 })]);

    const index = readIndex();
    expect(index.find((p) => p.id === 'p0')?.settings?.lineWeight).toBe(3);
    expect(index.find((p) => p.id === 'p1')?.settings?.lineWeight).toBe(4);
  });

  it('takes the next save after one that failed', async () => {
    stored(seed(1));
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));

    await expect(saveSettings('p0', { lineWeight: 3 })).rejects.toThrow('disk full');
    await saveSettings('p0', { lineWeight: 4 });
    expect(readIndex()[0]?.settings?.lineWeight).toBe(4);
  });

  it('refuses a drawing the index no longer holds, rather than reporting it saved', async () => {
    stored(seed(1));
    await expect(saveSettings('gone', { lineWeight: 3 })).rejects.toThrow('no longer in saved storage');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('writes nothing over an index that will not read', async () => {
    mockStore.set(INDEX_KEY, '{broken');
    await expect(saveSettings('p0', { lineWeight: 3 })).rejects.toThrow();
    expect(mockStore.get(INDEX_KEY)).toBe('{broken');
  });
});

describe('deleteProject', () => {
  it('removes the record and the copy together', async () => {
    stored(seed(3));
    await deleteProject('p1');
    expect(readIndex().map((p) => p.id)).toEqual(['p0', 'p2']);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(`${PORTRAIT_DIR}p1.jpg`, {
      idempotent: true,
    });
  });

  it('asks for a deletion that does not mind the file being gone already', async () => {
    // idempotent: true is what lets a portrait that has already gone from
    // disk be removed from the list like any other.
    stored(seed(2));
    await expect(deleteProject('p0')).resolves.toBeUndefined();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(`${PORTRAIT_DIR}p0.jpg`, { idempotent: true });
    expect(readIndex().map((p) => p.id)).toEqual(['p1']);
  });

  it('puts the record back when its portrait will not delete, so it can be removed again', async () => {
    // Dropping the record anyway would leave a copy of someone's face on disk
    // that nothing in the app can reach.
    stored(seed(2));
    jest.mocked(FileSystem.deleteAsync).mockRejectedValue(new Error('file locked'));

    await expect(deleteProject('p0')).rejects.toThrow('file locked');
    expect(readIndex().map((p) => p.id)).toEqual(['p0', 'p1']);
  });

  it('leaves the portrait alone when the removal cannot be written', async () => {
    stored(seed(1));
    jest.mocked(AsyncStorage.setItem).mockRejectedValue(new Error('disk full'));

    await expect(deleteProject('p0')).rejects.toThrow('disk full');
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
    expect(await listProjects()).toHaveLength(1);
  });
});

describe('the delete guard', () => {
  const record = (id: string, uri: string) => ({ id, updatedAt: 9, image: { uri, width: 1, height: 1 } });

  it('deletes only the file createProject names for that very project, whatever the index says', async () => {
    // A prefix test is satisfied by a path that climbs back out of the
    // directory it names, and deleteAsync resolves it: on Android that reaches
    // the app's own databases/ and shared_prefs/ — the AsyncStorage file
    // holding this very index among them — and by another project's portrait.
    // sanitizeProject refuses a traversing record too; this asserts the
    // deletion guard without it, because it is the call that deletes.
    jest.mocked(sanitizeProjects).mockImplementation(unvalidated); // as a laxer build would
    for (const uri of [
      `${PORTRAIT_DIR}../../databases/RKStorage`,
      `${PORTRAIT_DIR}..%2f..%2fdatabases/RKStorage`,
      `${PORTRAIT_DIR}%2e%2e/%2e%2e/shared_prefs/prefs.xml`,
      `${PORTRAIT_DIR}a/../../b.jpg`,
      `${PORTRAIT_DIR}p1.jpg/../private.json`,
      `${PORTRAIT_DIR}p2.jpg`, // someone else's portrait
      'file:///cache/portrait.jpg', // not a copy at all
    ]) {
      stored([record('p1', uri)]);
      await deleteProject('p1');
      expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
    }
    // Nor a record whose id is not one createProject makes.
    stored([record('../p1', `${PORTRAIT_DIR}../p1.jpg`)]);
    await deleteProject('../p1');
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();

    // The project's own copy is deleted.
    stored([record('p1', `${PORTRAIT_DIR}p1.jpg`)]);
    await deleteProject('p1');
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(`${PORTRAIT_DIR}p1.jpg`, {
      idempotent: true,
    });
  });

  it('is never reached by an import, whatever the index holds', async () => {
    // The thirty-item cap used to delete the dropped record's file with
    // nobody asking for a deletion at all; an import now removes nothing.
    jest.mocked(sanitizeProjects).mockImplementation(unvalidated);
    const survivors = seed(OLD_CEILING);
    survivors[OLD_CEILING - 1]!.image.uri = `${PORTRAIT_DIR}../../databases/RKStorage`; // seeded OLD_CEILING
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
    expect((await listProjects()).map((p) => p.id)).toEqual(['p0']);
  });

  it.each([
    ['will not parse', '{not json'],
    ['is not a list', '{"p1":{}}'],
  ])('reports an index that %s, rather than answering an empty library', async (_, raw) => {
    // An empty answer is what the next write then made permanent.
    mockStore.set(INDEX_KEY, raw);
    await expect(listProjects()).rejects.toThrow();
  });

  it('reports storage that cannot be read at all', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValue(new Error('storage unavailable'));
    await expect(listProjects()).rejects.toThrow('storage unavailable');
  });

  it('answers after a write in progress, not before it', async () => {
    const importing = createProject(ASSET);
    const listed = await listProjects();
    const project = await importing;
    expect(listed.map((p) => p.id)).toEqual([project.id]);
  });

  it('drops a broken record permanently on the next write', async () => {
    stored([seed(1)[0], { id: 'broken' }]);
    await saveSettings('p0', { showHead: false });
    expect(readIndex().map((p) => p.id)).toEqual(['p0']);
    expect(readIndex()[0]?.settings).toEqual({ showHead: false });
  });
});

describe('in a browser', () => {
  // expo-file-system has no documentDirectory there, so nothing can be copied
  // anywhere durable, and storage.ts reads that once, as it loads. The module
  // mock above is already in the registry, which an isolated registry falls
  // back to, so it is that mock that answers null while a fresh copy loads.
  const browserStorage = () => {
    const fileSystem = jest.requireMock<{ documentDirectory: string | null }>('expo-file-system/legacy');
    const device = fileSystem.documentDirectory;
    let storage: typeof import('../storage') | undefined;
    try {
      fileSystem.documentDirectory = null;
      jest.isolateModules(() => {
        storage = jest.requireActual<typeof import('../storage')>('../storage');
      });
    } finally {
      fileSystem.documentDirectory = device;
    }
    if (!storage) throw new Error('storage did not load');
    return storage;
  };

  it('opens every portrait unsaved, and never touches the index', async () => {
    stored(seed(1));
    const { createProject: create, listProjects: list } = browserStorage();

    const project = await create(ASSET);
    expect(project.ephemeral).toBe(true);
    expect(project.image.uri).toBe(ASSET.uri);
    // Nothing is kept there, so the list is empty without reading a key that,
    // on a shared origin, another app may have written.
    expect(await list()).toEqual([]);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});
