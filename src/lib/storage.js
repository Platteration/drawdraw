import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import { portraitExtension } from './filenames';

const INDEX_KEY = 'drawdraw.projects.v1';
const PORTRAIT_DIR = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}portraits/` : null;
let mutations = Promise.resolve();
let sequence = 0;

// Each read/modify/write must finish before the next mutation reads the index.
function mutate(operation) {
  const result = mutations.then(operation);
  mutations = result.catch(() => {});
  return result;
}

function ownsPortrait(project) {
  if (!PORTRAIT_DIR || !/^p[0-9a-z]+(?:-[0-9a-z]+)?$/.test(project.id)) return false;
  const uri = project.image?.uri;
  return typeof uri === 'string' &&
    uri === `${PORTRAIT_DIR}${project.id}.${portraitExtension(uri)}`;
}

/**
 * Projects keep the portrait plus everything about how the guide was fitted
 * to it, so returning to a drawing picks up exactly where you left off.
 *
 * The picker hands back a URI in the app's cache, which the OS is free to
 * clear, so the image is copied into the documents directory on import and
 * the project references that durable copy.
 *
 * SDK 57's main expo-file-system entry point uses the new File/Directory API;
 * the async URI helpers below intentionally use the compatibility entry point
 * until project storage is migrated as a unit.
 */

async function ensureDir() {
  if (!PORTRAIT_DIR) throw new Error('Durable portrait storage is unavailable.');
  const info = await FileSystem.getInfoAsync(PORTRAIT_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PORTRAIT_DIR, { intermediates: true });
  }
}

async function readIndex() {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  const projects = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(projects)) throw new Error('The saved drawing index could not be read.');
  return projects;
}

export async function listProjects() {
  await mutations;
  return readIndex();
}

async function writeIndex(projects) {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(projects));
}

/** Copy a freshly picked image somewhere durable and create its project. */
export async function createProject(asset) {
  if (typeof asset?.uri !== 'string' || !asset.uri ||
      !Number.isFinite(asset.width) || asset.width <= 0 ||
      !Number.isFinite(asset.height) || asset.height <= 0) {
    throw new Error('Could not read that portrait or its dimensions.');
  }
  return mutate(async () => {
    // A failed read must never be mistaken for an empty library and overwritten.
    const projects = await readIndex();
    let id;
    do {
      id = `p${Date.now().toString(36)}-${(++sequence).toString(36)}`;
    } while (projects.some((p) => p.id === id));
    let uri = asset.uri;
    let persistenceWarning;
    try {
      await ensureDir();
      const dest = `${PORTRAIT_DIR}${id}.${portraitExtension(asset.uri)}`;
      await FileSystem.copyAsync({ from: asset.uri, to: dest });
      uri = dest;
    } catch {
      persistenceWarning = 'This portrait could not be copied into saved storage. You can edit and export it now, but it may not reopen after the app or system clears its temporary files.';
    }
    const project = {
      id,
      updatedAt: Date.now(),
      image: { uri, width: asset.width, height: asset.height },
      settings: null,
      ...(persistenceWarning ? { persistenceWarning } : {}),
    };
    try {
      // Keep older drawings accessible until the owner explicitly removes them.
      await writeIndex([project, ...projects]);
    } catch (error) {
      if (ownsPortrait(project)) {
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch {
          throw new Error('The drawing could not be saved and its copied portrait could not be removed. Free some storage and try again.');
        }
      }
      throw error;
    }
    return project;
  });
}

export async function saveSettings(id, settings) {
  return mutate(async () => {
    const projects = await readIndex();
    if (!projects.some((p) => p.id === id)) throw new Error('This drawing is no longer in saved storage.');
    const next = projects.map((p) =>
      p.id === id ? { ...p, settings, updatedAt: Date.now() } : p
    );
    next.sort((a, b) => b.updatedAt - a.updatedAt);
    await writeIndex(next);
  });
}

export async function deleteProject(id) {
  return mutate(async () => {
    const projects = await readIndex();
    const target = projects.find((p) => p.id === id);
    // Commit the removal first: a failed index write must not destroy the photo.
    await writeIndex(projects.filter((p) => p.id !== id));
    if (target && ownsPortrait(target)) {
      try {
        await FileSystem.deleteAsync(target.image.uri, { idempotent: true });
      } catch (error) {
        // Keep the entry available for retry if the file is still on disk.
        await writeIndex(projects);
        throw error;
      }
    }
  });
}
