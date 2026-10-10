import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { portraitExtension } from './filenames';
import { ELEMENTS } from './headModel';

const INDEX_KEY = 'drawdraw.projects.v1';
const RECOVERY_KEY = 'drawdraw.projects.recovery.v1';
const PORTRAIT_DIR = `${FileSystem.documentDirectory}portraits/`;
let pending = Promise.resolve();

// Every mutation reads and replaces the same index. Keep that entire operation,
// including file cleanup/rollback, ordered so no update can overwrite another.
function inOrder(operation) {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
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
  if (!FileSystem.documentDirectory) {
    throw new Error('Portrait storage is unavailable. The image has not been imported.');
  }
  const info = await FileSystem.getInfoAsync(PORTRAIT_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PORTRAIT_DIR, { intermediates: true });
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasReadableSettings(settings) {
  if (settings == null) return true;
  if (!isObject(settings)) return false;
  // Missing fields use Editor defaults. Defined structures must support the
  // maps, numeric formatting and geometry that the Editor actually performs.
  for (const key of ['showHead', 'showHorizontal', 'showVertical', 'showCenter']) {
    if (settings[key] != null && typeof settings[key] !== 'boolean') return false;
  }
  for (const key of ['hGuides', 'vGuides']) {
    if (settings[key] != null &&
      (!Array.isArray(settings[key]) || !settings[key].every(Number.isFinite))) return false;
  }
  for (const [key, fields] of [
    ['headTransform', ['yaw', 'pitch', 'roll', 'x', 'y', 'scale']],
    ['proportions', ['width', 'depth', 'noseY', 'browY']],
  ]) {
    if (settings[key] != null &&
      (!isObject(settings[key]) || !fields.every((field) => Number.isFinite(settings[key][field])))) return false;
  }
  if (settings.proportions != null &&
    (settings.proportions.width <= 0 || settings.proportions.depth <= 0)) return false;
  if (settings.elements != null &&
    (!isObject(settings.elements) || ELEMENTS.some(({ key }) =>
      settings.elements[key] !== undefined && typeof settings.elements[key] !== 'boolean'))) return false;
  if (settings.guideColor != null && typeof settings.guideColor !== 'string') return false;
  for (const key of ['lineWeight', 'tracingOpacity']) {
    if (settings[key] != null && !Number.isFinite(settings[key])) return false;
  }
  return true;
}

function hasReadablePortrait(project) {
  return typeof project?.id === 'string' && project.id.trim().length > 0 &&
    typeof project.image?.uri === 'string' && project.image.uri.trim().length > 0 &&
    Number.isFinite(project.image.width) && project.image.width > 0 &&
    Number.isFinite(project.image.height) && project.image.height > 0;
}

function isProjectRecord(project) {
  return hasReadablePortrait(project) && hasReadableSettings(project.settings);
}

function recoverableProjects(projects) {
  let resetSettingsCount = 0;
  let renamedIdCount = 0;
  const originalIds = new Set(projects.filter(hasReadablePortrait).map(({ id }) => id));
  const recoveredIds = new Set();
  const readable = projects.filter(hasReadablePortrait).map((project) => {
    let recovered = project;
    if (!hasReadableSettings(project.settings)) {
      resetSettingsCount += 1;
      recovered = { ...recovered, settings: null };
    }
    // Legacy imports used millisecond-only IDs. Choose the same separate IDs
    // for inspection and repair, leaving every portrait URI unchanged.
    if (recoveredIds.has(project.id)) {
      let suffix = 0;
      let id;
      do { id = `${project.id}-recovered-${++suffix}`; }
      while (originalIds.has(id) || recoveredIds.has(id));
      recovered = { ...recovered, id };
      renamedIdCount += 1;
    }
    recoveredIds.add(recovered.id);
    return recovered;
  });
  return {
    projects: readable, skippedCount: projects.length - readable.length,
    ...(resetSettingsCount > 0 ? { resetSettingsCount } : {}),
    ...(renamedIdCount > 0 ? { renamedIdCount } : {}),
  };
}

async function readIndexData() {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  if (raw === null) return { raw, projects: [] };
  let projects;
  try {
    projects = JSON.parse(raw);
  } catch {
    throw new Error('Saved drawings could not be read. Their stored data has been left unchanged.');
  }
  if (!Array.isArray(projects)) {
    throw new Error('Saved drawings could not be read. Their stored data has been left unchanged.');
  }
  return { raw, projects };
}

async function readIndex() {
  const { projects } = await readIndexData();
  if (!projects.every(isProjectRecord) || new Set(projects.map(({ id }) => id)).size !== projects.length) {
    throw new Error('Saved drawings could not be read. Their stored data has been left unchanged.');
  }
  return projects;
}

export function listProjects() {
  return inOrder(readIndex);
}

/** Read-only salvage: expose usable drawings for export without rewriting data. */
export function inspectRecoverableProjects() {
  return inOrder(async () => {
    const { projects } = await readIndexData();
    return recoverableProjects(projects);
  });
}

/** Explicit repair keeps the original bytes before removing unreadable entries. */
export function recoverProjects() {
  return inOrder(async () => {
    const { raw, projects } = await readIndexData();
    const recovered = recoverableProjects(projects);
    const { projects: readable, skippedCount, resetSettingsCount = 0, renamedIdCount = 0 } = recovered;
    if (readable.length === 0) {
      throw new Error('No readable drawings could be recovered. Your saved data has been left unchanged.');
    }
    if (skippedCount === 0 && resetSettingsCount === 0 && renamedIdCount === 0) return recovered;

    const rawBackups = await AsyncStorage.getItem(RECOVERY_KEY);
    let backups;
    try {
      backups = rawBackups === null ? [] : JSON.parse(rawBackups);
    } catch {
      throw new Error('Previous recovery backups could not be read. Your saved data has been left unchanged.');
    }
    if (!Array.isArray(backups) || !backups.every((entry) => typeof entry?.raw === 'string')) {
      throw new Error('Previous recovery backups could not be read. Your saved data has been left unchanged.');
    }
    // A failed index write may leave a successful backup. Reuse that exact
    // snapshot on retry rather than filling storage with duplicate copies.
    if (!backups.some((entry) => entry.raw === raw)) {
      await AsyncStorage.setItem(RECOVERY_KEY, JSON.stringify([
        ...backups, { raw, createdAt: Date.now() },
      ]));
    }
    await writeIndex(readable);
    return recovered;
  });
}

async function writeIndex(projects) {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(projects));
}

export function hasRecoveryCopies() {
  return inOrder(async () => (await AsyncStorage.getItem(RECOVERY_KEY)) !== null);
}

/** Explicit deletion affects recovery snapshots only, never active drawings. */
export function clearRecoveryCopies() {
  return inOrder(() => AsyncStorage.removeItem(RECOVERY_KEY));
}

/** Copy a freshly picked image somewhere durable and create its project. */
export function createProject(asset) {
  return inOrder(async () => {
    const projects = await readIndex();
    const baseId = `p${Date.now().toString(36)}`;
    const ids = new Set(projects.map((p) => p.id));
    let id = baseId;
    let suffix = 0;
    while (ids.has(id)) id = `${baseId}-${++suffix}`;

    let uri = asset.uri;
    // Expo's web picker supplies a data URI, already independent of its source
    // file. Native picker cache files must be copied before import succeeds.
    if (Platform.OS !== 'web') {
      await ensureDir();
      uri = `${PORTRAIT_DIR}${id}.${portraitExtension(asset.uri)}`;
      try {
        await FileSystem.copyAsync({ from: asset.uri, to: uri });
      } catch (error) {
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch {
          throw new Error(`${String(error?.message ?? error)} The partially copied portrait could not be deleted.`);
        }
        throw error;
      }
    }

    const project = {
      id,
      updatedAt: Date.now(),
      image: { uri, width: asset.width, height: asset.height },
      settings: null,
    };
    try {
      await writeIndex([project, ...projects]);
    } catch (error) {
      if (Platform.OS !== 'web') {
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch {
          throw new Error('The drawing could not be saved, and its copied portrait could not be deleted.');
        }
      }
      throw error;
    }
    return project;
  });
}

export function saveSettings(id, settings) {
  return inOrder(async () => {
    const projects = await readIndex();
    const next = projects.map((p) =>
      p.id === id ? { ...p, settings, updatedAt: Date.now() } : p
    );
    next.sort((a, b) => b.updatedAt - a.updatedAt);
    await writeIndex(next);
  });
}

export function deleteProject(id) {
  return inOrder(async () => {
    const projects = await readIndex();
    const target = projects.find((p) => p.id === id);
    const remaining = projects.filter((p) => p.id !== id);
    await writeIndex(remaining);
    if (target?.image?.uri?.startsWith(PORTRAIT_DIR) &&
      !remaining.some((project) => project.image.uri === target.image.uri)) {
      try {
        await FileSystem.deleteAsync(target.image.uri, { idempotent: true });
      } catch (error) {
        try {
          await writeIndex(projects);
        } catch {
          throw new Error('The drawing was removed, but its portrait could not be deleted or restored to the list.');
        }
        throw error;
      }
    }
  });
}
