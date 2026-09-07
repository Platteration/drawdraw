import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

import { portraitExtension } from './filenames';

const INDEX_KEY = 'drawdraw.projects.v1';
const PORTRAIT_DIR = `${FileSystem.documentDirectory}portraits/`;

/**
 * Projects keep the portrait plus everything about how the guide was fitted
 * to it, so returning to a drawing picks up exactly where you left off.
 *
 * The picker hands back a URI in the app's cache, which the OS is free to
 * clear, so the image is copied into the documents directory on import and
 * the project references that durable copy.
 */

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(PORTRAIT_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PORTRAIT_DIR, { intermediates: true });
  }
}

export async function listProjects() {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const projects = raw ? JSON.parse(raw) : [];
    return Array.isArray(projects) ? projects : [];
  } catch {
    return [];
  }
}

async function writeIndex(projects) {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(projects));
}

/** Copy a freshly picked image somewhere durable and create its project. */
export async function createProject(asset) {
  const id = `p${Date.now().toString(36)}`;
  let uri = asset.uri;
  try {
    await ensureDir();
    const dest = `${PORTRAIT_DIR}${id}.${portraitExtension(asset.uri)}`;
    await FileSystem.copyAsync({ from: asset.uri, to: dest });
    uri = dest;
  } catch {
    // Fall back to the original URI; the project still works this session.
  }

  const project = {
    id,
    updatedAt: Date.now(),
    image: { uri, width: asset.width, height: asset.height },
    settings: null,
  };
  const projects = await listProjects();
  await writeIndex([project, ...projects].slice(0, 30));
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
  if (target?.image?.uri?.startsWith(PORTRAIT_DIR)) {
    await FileSystem.deleteAsync(target.image.uri, { idempotent: true }).catch(() => {});
  }
  await writeIndex(projects.filter((p) => p.id !== id));
}
