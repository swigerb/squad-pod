import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  GLOBAL_KEY_DIRECTORIES,
  GLOBAL_KEY_DIRECTORY_LAUNCH_HISTORY,
} from './constants.js';
import type { DirectoryEntry } from './types.js';
import { listCopilotSessions, readSessionCwd, resolveCopilotHome } from './copilotSessionState.js';

const MAX_SAVED_DIRECTORIES = 100;
const MAX_RECENT_LAUNCHES = 10;

export class SquadDirectorySuggestions {
  private cache = new Map<string, { mtimeMs: number; metadataMtimeMs: number; cwd: string | null }>();

  async list(
    enabled: boolean,
    excluded: readonly Pick<DirectoryEntry, 'path'>[],
    copilotHome?: string,
    isEnabled = () => enabled,
  ): Promise<DirectoryEntry[]> {
    if (!enabled || !isEnabled()) {
      this.cache.clear();
      return [];
    }
    // Yield before the bounded synchronous shared reader; roster checks use async I/O.
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!isEnabled()) { return []; }
    const sessions = listCopilotSessions(copilotHome ?? resolveCopilotHome());
    const nextCache = new Map<string, { mtimeMs: number; metadataMtimeMs: number; cwd: string | null }>();
    const suggestions: DirectoryEntry[] = [];
    for (const session of sessions) {
      if (!isEnabled()) { return []; }
      if (suggestions.length >= 10) { break; }
      let metadataMtimeMs: number;
      try {
        metadataMtimeMs = (await fs.promises.lstat(path.join(session.dir, 'workspace.yaml'))).mtimeMs;
      } catch { continue; }
      if (!isEnabled()) { return []; }
      const cached = this.cache.get(session.dir);
      const cwd = cached?.mtimeMs === session.mtimeMs && cached.metadataMtimeMs === metadataMtimeMs
        ? cached.cwd : readSessionCwd(session.dir);
      nextCache.set(session.dir, { mtimeMs: session.mtimeMs, metadataMtimeMs, cwd });
      if (!cwd) { continue; }
      try {
        const directoryPath = await fs.promises.realpath(cwd);
        if (!(await fs.promises.stat(directoryPath)).isDirectory()) { continue; }
        if ([...excluded, ...suggestions].some((entry) => sameDirectoryPath(entry.path, directoryPath))) { continue; }
        let teamFound = false;
        for (const teamDir of ['.squad', '.ai-team']) {
          try {
            if ((await fs.promises.stat(path.join(directoryPath, teamDir, 'team.md'))).isFile()) {
              teamFound = true;
              break;
            }
          } catch { /* Missing or inaccessible rosters are not suggestions. */ }
        }
        if (!teamFound) { continue; }
        suggestions.push({
          id: `session:${session.id}`,
          name: path.basename(directoryPath) || directoryPath,
          path: directoryPath,
          valid: true,
          lastLaunchedAt: new Date(session.mtimeMs).toISOString(),
        });
      } catch { /* A historical working directory may no longer be accessible. */ }
    }
    this.cache = nextCache;
    return suggestions;
  }
}

export interface SavedDirectory {
  id: string;
  name: string;
  path: string;
}

export interface DirectoryLaunchRecord extends SavedDirectory {
  lastLaunchedAt: string;
}

export interface DirectoryStorage {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

export function validateDirectoryName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Directory name must be text.');
  }
  const name = value.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Directory name must be 1–80 characters and contain no control characters.');
  }
  return name;
}

export function validateDirectoryPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) {
    throw new Error('Directory path must be an absolute path.');
  }
  let resolved: string;
  try {
    resolved = fs.realpathSync.native(value);
  } catch {
    throw new Error(`Directory does not exist or cannot be accessed: ${value}`);
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`Directory cannot be accessed: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved}`);
  }
  return resolved;
}

export function createSavedDirectory(name: unknown, directoryPath: unknown): SavedDirectory {
  return {
    id: randomUUID(),
    name: validateDirectoryName(name),
    path: validateDirectoryPath(directoryPath),
  };
}

export function ensureUniqueDirectoryName(
  name: unknown,
  directories: SavedDirectory[],
  excludeId?: string,
): string {
  const validated = validateDirectoryName(name);
  const duplicate = directories.some((directory) =>
    directory.id !== excludeId && directory.name.toLocaleLowerCase() === validated.toLocaleLowerCase(),
  );
  if (duplicate) {
    throw new Error(`A saved directory named "${validated}" already exists.`);
  }
  return validated;
}

export function sameDirectoryPath(left: string, right: string, platform = process.platform): boolean {
  const a = resolveDirectoryIdentity(left);
  const b = resolveDirectoryIdentity(right);
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function resolveDirectoryMappingIds(
  observedRoot: string,
  workspaceDirectories: readonly Pick<SavedDirectory, 'id' | 'path'>[],
  savedDirectories: readonly SavedDirectory[],
): string[] {
  const workspaceIds = workspaceDirectories
    .filter((directory) => sameDirectoryPath(directory.path, observedRoot))
    .map((directory) => directory.id);
  const savedIds = savedDirectories
    .filter((directory) => sameDirectoryPath(directory.path, observedRoot))
    .map((directory) => directory.id);
  return [...new Set([...workspaceIds, ...savedIds])];
}

function resolveDirectoryIdentity(directoryPath: string): string {
  try {
    return fs.realpathSync.native(directoryPath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return path.resolve(directoryPath);
    }
    throw error;
  }
}

function storedRecords<T>(value: unknown, label: string, isRecord: (item: unknown) => item is T): T[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`Saved ${label} are malformed; stored data was left unchanged.`);
  }
  return value;
}

function isSavedDirectory(value: unknown): value is SavedDirectory {
  if (!value || typeof value !== 'object') { return false; }
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.name === 'string' && typeof record.path === 'string';
}

function isLaunchRecord(value: unknown): value is DirectoryLaunchRecord {
  return isSavedDirectory(value)
    && 'lastLaunchedAt' in value
    && typeof value.lastLaunchedAt === 'string';
}

export function readSavedDirectories(storage: DirectoryStorage): SavedDirectory[] {
  const value = storage.get<unknown>(GLOBAL_KEY_DIRECTORIES, []);
  return storedRecords(value, 'directories', isSavedDirectory);
}

export function readLaunchHistory(storage: DirectoryStorage): DirectoryLaunchRecord[] {
  const value = storage.get<unknown>(GLOBAL_KEY_DIRECTORY_LAUNCH_HISTORY, []);
  return storedRecords(value, 'directory launch history', isLaunchRecord);
}

export async function writeSavedDirectories(storage: DirectoryStorage, directories: SavedDirectory[]): Promise<void> {
  if (directories.length > MAX_SAVED_DIRECTORIES) {
    throw new Error(`At most ${MAX_SAVED_DIRECTORIES} saved directories are supported.`);
  }
  await storage.update(GLOBAL_KEY_DIRECTORIES, directories);
}

export async function recordDirectoryLaunch(
  storage: DirectoryStorage,
  directory: SavedDirectory,
  launchedAt = new Date().toISOString(),
): Promise<void> {
  const recent = readLaunchHistory(storage).filter((entry) => !sameDirectoryPath(entry.path, directory.path));
  recent.unshift({ ...directory, id: randomUUID(), lastLaunchedAt: launchedAt });
  await storage.update(GLOBAL_KEY_DIRECTORY_LAUNCH_HISTORY, recent.slice(0, MAX_RECENT_LAUNCHES));
}

export async function forgetDirectoryLaunch(storage: DirectoryStorage, id: string): Promise<void> {
  const recent = readLaunchHistory(storage).filter((entry) => entry.id !== id);
  await storage.update(GLOBAL_KEY_DIRECTORY_LAUNCH_HISTORY, recent);
}

export function asDirectoryEntry(directory: SavedDirectory, lastLaunchedAt?: string): DirectoryEntry {
  const entry: DirectoryEntry = { ...directory, valid: true };
  if (lastLaunchedAt !== undefined) { entry.lastLaunchedAt = lastLaunchedAt; }
  const errors: string[] = [];
  try {
    entry.name = validateDirectoryName(entry.name);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  try {
    entry.path = validateDirectoryPath(entry.path);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (errors.length) {
    entry.valid = false;
    entry.error = errors.join(' ');
  }
  return entry;
}
