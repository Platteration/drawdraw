import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

import { portraitExtension } from './filenames';
import { hasTraversal, sanitizeProjects } from './projectShape';

const INDEX_KEY = 'drawdraw.projects.v1';
const PORTRAIT_DIR = `${FileSystem.documentDirectory}portraits/`;
const MAX_PROJECTS = 30;

/**
 * Projects keep the portrait plus everything about how the guide was fitted
 * to it, so returning to a drawing picks up exactly where you left off.
 *
 * The picker hands back a URI in the app's cache, which the OS is free to
 * clear, so the image is copied into the documents directory on import and
 * the project references that durable copy.
 *
 * Every copy this module makes is owned by the index: a portrait leaves disk
 * when its record leaves the index, whether that is an explicit delete or the
 * oldest entry falling off the end of the list. Otherwise a heavy user
 * accumulates full-resolution copies of people's faces that nothing in the
 * app can reach and nothing but reinstalling can clear.
 */

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(PORTRAIT_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PORTRAIT_DIR, { intermediates: true });
  }
}

/**
 * Delete a portrait copy this module made. Ignores anything it did not.
 *
 * The prefix is necessary and not sufficient: `${PORTRAIT_DIR}../../databases/
 * RKStorage` starts with PORTRAIT_DIR and names a file two directories above
 * it, which deleteAsync will happily resolve and remove — the app's own
 * AsyncStorage database among the reachable targets. Nothing this module
 * writes contains a `..`, so the containment is the prefix *and* the absence
 * of one. sanitizeProject refuses such a URI on the way in as well; the two
 * are deliberately redundant, because this is the call that deletes.
 */
async function removePortrait(uri) {
  if (typeof uri !== 'string' || !uri.startsWith(PORTRAIT_DIR)) return;
  if (hasTraversal(uri)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

export async function listProjects() {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    // Written by this app, but not necessarily by this build of it, and not
    // necessarily completely. See projectShape.js.
    return sanitizeProjects(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

async function writeIndex(projects) {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(projects));
}

/**
 * Copy a freshly picked image somewhere durable and create its project.
 *
 * When the copy fails the project is still returned so the editor opens on
 * the picker's own URI, but it is flagged `ephemeral` and kept out of the
 * index: writing it there would leave a permanent Recent entry pointing into
 * a cache the OS is free to clear, with no way to repair it from inside the
 * app. The caller is expected to say so.
 */
export async function createProject(asset) {
  const id = `p${Date.now().toString(36)}`;
  let uri = asset.uri;
  let durable = false;
  try {
    await ensureDir();
    const dest = `${PORTRAIT_DIR}${id}.${portraitExtension(asset.uri)}`;
    await FileSystem.copyAsync({ from: asset.uri, to: dest });
    uri = dest;
    durable = true;
  } catch {
    // Fall back to the original URI; the project still works this session.
  }

  const project = {
    id,
    updatedAt: Date.now(),
    image: { uri, width: asset.width, height: asset.height },
    settings: null,
  };

  if (!durable) return { ...project, ephemeral: true };

  const projects = await listProjects();
  const all = [project, ...projects];
  // Truncation drops the record; the copy on disk has to go with it.
  await writeIndex(all.slice(0, MAX_PROJECTS));
  for (const dropped of all.slice(MAX_PROJECTS)) await removePortrait(dropped.image?.uri);
  return project;
}

export async function saveSettings(id, settings) {
  const projects = await listProjects();
  const next = projects.map((p) =>
    p.id === id ? { ...p, settings, updatedAt: Date.now() } : p
  );
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  await writeIndex(next);
}

export async function deleteProject(id) {
  const projects = await listProjects();
  const target = projects.find((p) => p.id === id);
  await writeIndex(projects.filter((p) => p.id !== id));
  await removePortrait(target?.image?.uri);
}
