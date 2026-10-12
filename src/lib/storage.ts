import AsyncStorage from '@react-native-async-storage/async-storage';
// The function API this module was written against. Since SDK 54 the package
// root exports the File/Directory classes instead, and its functions of these
// names are stubs that throw — which createProject's catch would quietly turn
// into every import being ephemeral. The legacy entry point is the same native
// module and the same documentDirectory, so the copies already on disk and
// the URIs in the index stay valid.
import * as FileSystem from 'expo-file-system/legacy';

import { portraitExtension } from './filenames';
import { sanitizeProjects, type Project, type ProjectSettings } from './projectShape';
import { KEYS } from './settings';

const INDEX_KEY = KEYS.projects;
// A browser has no documentDirectory (expo-file-system answers null there), so
// nothing it opens can be made durable: every portrait there is ephemeral.
const PORTRAIT_DIR = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}portraits/` : null;

/** A new project; `ephemeral` when it could not be kept and was left out of the index. */
export type CreatedProject = Project & { ephemeral?: true };

/**
 * Projects keep the portrait plus everything about how the guide was fitted
 * to it, so returning to a drawing picks up exactly where you left off.
 *
 * The picker hands back a URI in the app's cache, which the OS is free to
 * clear, so the image is copied into the documents directory on import and
 * the project references that durable copy.
 *
 * Every copy this module makes is owned by the index: a portrait leaves disk
 * when its record leaves the index, and a record leaves the index only when
 * the user removes it. There is no ceiling on the list. A thirty-item cap used
 * to drop the oldest drawing on the thirty-first import, its portrait with it,
 * without anyone asking; the library is the user's own work, so it grows until
 * they remove something. Otherwise a heavy user accumulates either
 * full-resolution copies of people's faces that nothing in the app can reach,
 * or a library that loses drawings behind their back.
 *
 * Every read-modify-write of the index goes through `mutate`, one at a time:
 * two imports, or an autosave racing an import, each read the same list and
 * the second write silently dropped what the first had added.
 */

let mutations: Promise<unknown> = Promise.resolve();
let sequence = 0;

/** Run `operation` once every mutation queued before it has finished, whether or not it failed. */
function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutations.then(operation);
  mutations = result.catch(() => {});
  return result;
}

async function ensureDir(dir: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

/**
 * The file createProject copied for `project`, or null when the record names
 * anything else. Only that exact name is the project's to delete: an id of the
 * form createProject makes (`p`, then base-36 digits and a dash, nothing that
 * can spell a path) and the file named for it in PORTRAIT_DIR. A prefix test
 * is satisfied by `${PORTRAIT_DIR}../../databases/RKStorage`, which deleteAsync
 * resolves to the app's own AsyncStorage database, and by another project's
 * portrait (`p2.png` named in p1's record), which deleting p1 must not take
 * with it. sanitizeProject refuses a traversing URI on the way in as well; the
 * two are deliberately redundant, because this is the call that deletes.
 */
function ownedPortrait(project: Project): string | null {
  if (!PORTRAIT_DIR || !/^p[0-9a-z]+(?:-[0-9a-z]+)?$/.test(project.id)) return null;
  const uri = project.image.uri;
  return uri === `${PORTRAIT_DIR}${project.id}.${portraitExtension(uri)}` ? uri : null;
}

/**
 * The stored index. A missing one is an empty library; one that will not parse,
 * or is not a list, throws, because a failed read taken for an empty library
 * is what the next write then makes permanent. Within a readable list, a
 * record the app could not open is left out (see projectShape.ts).
 */
async function readIndex(): Promise<Project[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  const parsed: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed)) throw new Error('The saved drawing index could not be read.');
  return sanitizeProjects(parsed);
}

/**
 * Every saved drawing, newest first. Throws when the index cannot be read,
 * rather than answering empty. A browser keeps none (createProject indexes
 * nothing there), so its answer is empty without reading a key that, on a
 * shared origin, another app may have written.
 */
export async function listProjects(): Promise<Project[]> {
  if (!PORTRAIT_DIR) return [];
  await mutations;
  return readIndex();
}

async function writeIndex(projects: Project[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(projects));
}

/**
 * Copy a freshly picked image somewhere durable and create its project.
 *
 * When the portrait cannot be kept — no file system (a browser), a copy that
 * fails, or an index that cannot be read — the project is still returned so
 * the editor opens on the picker's own URI, but it is flagged `ephemeral` and
 * kept out of the index: writing a record that points into a cache the OS is
 * free to clear leaves a Recent entry that goes blank, and writing over an
 * index that would not read replaces the user's whole library. The caller is
 * expected to say so. An index that reads but will not take the new record is
 * an error, and the copy made for it is removed again.
 */
export async function createProject(asset: { uri: string; width: number; height: number }): Promise<CreatedProject> {
  if (
    typeof asset.uri !== 'string' ||
    !asset.uri ||
    !Number.isFinite(asset.width) ||
    asset.width <= 0 ||
    !Number.isFinite(asset.height) ||
    asset.height <= 0
  ) {
    throw new Error('Could not read that portrait or its dimensions.');
  }
  const image = { uri: asset.uri, width: asset.width, height: asset.height };
  return mutate(async () => {
    const opened = (id: string): CreatedProject => ({ id, updatedAt: Date.now(), image, settings: null, ephemeral: true });
    if (!PORTRAIT_DIR) return opened(`p${Date.now().toString(36)}-${(++sequence).toString(36)}`);

    let projects: Project[];
    try {
      projects = await readIndex();
    } catch {
      return opened(`p${Date.now().toString(36)}-${(++sequence).toString(36)}`);
    }

    // Two imports in the same millisecond must not share an id, or a file.
    let id: string;
    do {
      id = `p${Date.now().toString(36)}-${(++sequence).toString(36)}`;
    } while (projects.some((p) => p.id === id));

    const dest = `${PORTRAIT_DIR}${id}.${portraitExtension(asset.uri)}`;
    try {
      await ensureDir(PORTRAIT_DIR);
      await FileSystem.copyAsync({ from: asset.uri, to: dest });
    } catch {
      return opened(id);
    }

    const project: Project = { id, updatedAt: Date.now(), image: { ...image, uri: dest }, settings: null };
    try {
      await writeIndex([project, ...projects]);
    } catch (error) {
      try {
        await FileSystem.deleteAsync(dest, { idempotent: true });
      } catch {
        throw new Error(
          'The drawing could not be saved and its copied portrait could not be removed. Free some storage and try again.'
        );
      }
      throw error;
    }
    return project;
  });
}

/** Save one drawing's guide setup. Throws when the index cannot be read or written, or no longer holds the drawing. */
export async function saveSettings(id: string, settings: ProjectSettings): Promise<void> {
  return mutate(async () => {
    const projects = await readIndex();
    if (!projects.some((p) => p.id === id)) throw new Error('This drawing is no longer in saved storage.');
    const next = projects.map((p) => (p.id === id ? { ...p, settings, updatedAt: Date.now() } : p));
    next.sort((a, b) => b.updatedAt - a.updatedAt);
    await writeIndex(next);
  });
}

/**
 * Remove a drawing and the portrait copy it owns. The removal is written
 * first, so an index that will not take it leaves the photo where it was; a
 * photo that will not delete puts the record back, so the drawing can be
 * removed again rather than leaving a portrait nothing can reach.
 */
export async function deleteProject(id: string): Promise<void> {
  return mutate(async () => {
    const projects = await readIndex();
    const target = projects.find((p) => p.id === id);
    await writeIndex(projects.filter((p) => p.id !== id));
    const file = target ? ownedPortrait(target) : null;
    if (!file) return;
    try {
      // idempotent: a file that has already gone is not an error.
      await FileSystem.deleteAsync(file, { idempotent: true });
    } catch (error) {
      await writeIndex(projects);
      throw error;
    }
  });
}
