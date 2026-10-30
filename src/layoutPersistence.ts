/**
 * layoutPersistence.ts — Persist and watch office layout state on disk.
 *
 * The layout (room positions, furniture placement, seat assignments) is saved
 * to `{workspaceRoot}/.squad-pod/layout.json`.  The file is watched so that
 * external edits (or edits from another VS Code window) are picked up.
 *
 * Ported from pixel-agents with path constants updated.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { LayoutData } from './types.js';
import { isValidLayout } from './layoutValidation.js';
export { isValidLayout } from './layoutValidation.js';
import {
  LAYOUT_FILE_DIR,
  LAYOUT_FILE_NAME,
  LAYOUT_FILE_POLL_INTERVAL_MS,
} from './constants.js';

// ─── Helpers ────────────────────────────────────────────────────────

function layoutDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, LAYOUT_FILE_DIR);
}

function layoutFilePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, LAYOUT_FILE_DIR, LAYOUT_FILE_NAME);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Validation ─────────────────────────────────────────────────────

/** Parse layout JSON text; returns null when it is not a valid layout. */
export function parseLayoutJson(content: string): LayoutData | null {
  try {
    const data: unknown = JSON.parse(content.replace(/^\uFEFF/, ''));
    if (!isValidLayout(data)) {return null;}
    if (!data.furniture) {data.furniture = [];}
    return migrateLayout(data);
  } catch {
    return null;
  }
}

// ─── Read / Write ───────────────────────────────────────────────────

/**
 * Read the persisted layout from disk. Returns null if it doesn't exist
 * or is malformed.
 */
export function readPersistedLayout(workspaceRoot: string): LayoutData | null {
  const filePath = layoutFilePath(workspaceRoot);
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return parseLayoutJson(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Write a layout to disk, creating the `.squad-pod/` directory if needed.
 */
export function writePersistedLayout(workspaceRoot: string, layout: LayoutData): void {
  const dir = layoutDir(workspaceRoot);
  ensureDir(dir);

  const filePath = layoutFilePath(workspaceRoot);
  // Write then rename so an interrupted save never leaves a truncated layout.
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(layout, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/** Raw disk content is the revision, including formatting and unknown metadata. */
export function readLayoutRevision(workspaceRoot: string): string | null {
  try {
    return fs.readFileSync(layoutFilePath(workspaceRoot), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {return null;}
    throw error;
  }
}

export function saveLayoutIfUnchanged(
  workspaceRoot: string, layout: LayoutData, expectedRevision: string | null,
): { saved: boolean; revision: string | null; layout: LayoutData | null } {
  if (!isValidLayout(layout)) {throw new Error('Invalid layout; saved office was not changed.');}
  ensureDir(layoutDir(workspaceRoot));
  const lock = `${layoutFilePath(workspaceRoot)}.lock`;
  // Cooperating Squad Pod windows serialize revision checks and writes.
  const fd = fs.openSync(lock, 'wx');
  try {
    const revision = readLayoutRevision(workspaceRoot);
    if (revision !== expectedRevision) {
      return { saved: false, revision, layout: revision === null ? null : parseLayoutJson(revision) };
    }
    if (revision !== null && !parseLayoutJson(revision)) {
      throw new Error('The saved layout is malformed. Recover the file before saving; it was not overwritten.');
    }
    if (revision !== null) {
      const recoveryDir = path.join(layoutDir(workspaceRoot), 'recovery');
      ensureDir(recoveryDir);
      fs.writeFileSync(path.join(recoveryDir, `${randomUUID()}.json`), revision, 'utf-8');
    }
    const beforeWrite = readLayoutRevision(workspaceRoot);
    if (beforeWrite !== revision) {
      return { saved: false, revision: beforeWrite, layout: beforeWrite === null ? null : parseLayoutJson(beforeWrite) };
    }
    writePersistedLayout(workspaceRoot, layout);
    const written = readLayoutRevision(workspaceRoot);
    if (written !== JSON.stringify(layout, null, 2)) {
      return { saved: false, revision: written, layout: written === null ? null : parseLayoutJson(written) };
    }
    return { saved: true, revision: written, layout };
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

/**
 * Delete the persisted layout (used when resetting to defaults).
 */
export function deletePersistedLayout(workspaceRoot: string): void {
  const filePath = layoutFilePath(workspaceRoot);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Silently ignore
  }
}

// ─── Migration ──────────────────────────────────────────────────────

const _CURRENT_LAYOUT_VERSION = 2;

/**
 * Migrate older layout formats to the current version.
 * v1 → v2: Retain user colors and metadata; never reset saved content.
 */
function migrateLayout(data: LayoutData): LayoutData {
  if (!data.version) {
    data.version = 1;
  }
  if (data.version < 2) {
    data.version = 2;
  }
  return data;
}

// ─── File Watcher ───────────────────────────────────────────────────

interface LayoutWatcher {
  dispose: () => void;
}

/**
 * Watch the layout file for external changes. Calls `onChange` whenever
 * the file is modified.  Uses polling for cross-platform reliability.
 */
export function watchLayoutFile(
  workspaceRoot: string,
  onChange: (layout: LayoutData, revision: string) => void,
  onInvalid: (error: string) => void = console.error,
): LayoutWatcher {
  const filePath = layoutFilePath(workspaceRoot);
  let lastMtimeMs = 0;
  let lastSize = 0;
  let lastError = '';
  let disposed = false;

  // Seed initial state
  try {
    const stat = fs.statSync(filePath);
    lastMtimeMs = stat.mtimeMs;
    lastSize = stat.size;
  } catch {
    // File doesn't exist yet — that's fine
  }

  // Try native watcher first
  let fsWatcher: fs.FSWatcher | null = null;
  try {
    const dir = layoutDir(workspaceRoot);
    if (fs.existsSync(dir)) {
      fsWatcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
        if (disposed) {return;}
        if (filename === LAYOUT_FILE_NAME) {
          checkForChanges();
        }
      });
      fsWatcher.on('error', () => {});
    }
  } catch {
    // Fall through to polling
  }

  // Polling fallback
  const pollTimer = setInterval(() => {
    if (!disposed) {
      checkForChanges();
    }
  }, LAYOUT_FILE_POLL_INTERVAL_MS);

  function checkForChanges(): void {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {throw new Error('Layout path is not a regular file.');}
      if (stat.mtimeMs !== lastMtimeMs || stat.size !== lastSize) {
        lastMtimeMs = stat.mtimeMs;
        lastSize = stat.size;

        const content = fs.readFileSync(filePath, 'utf-8');
        const layout = parseLayoutJson(content);
        if (layout) {
          lastError = '';
          onChange(layout, content);
        } else {
          reportInvalid('Squad Pod: external layout is malformed; current draft and saved cache were not changed.');
        }
      }
    } catch (error) {
      lastMtimeMs = 0;
      lastSize = 0;
      // Absence is normal, including deletion or a rename between stat and read.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {return;}
      reportInvalid(`Squad Pod: could not reload external layout; current draft was kept. ${String(error)}`);
    }
  }

  function reportInvalid(error: string): void {
    if (error === lastError) {return;}
    lastError = error;
    onInvalid(error);
  }

  return {
    dispose() {
      disposed = true;
      fsWatcher?.close();
      clearInterval(pollTimer);
    },
  };
}

/**
 * Export the given layout to a user-chosen file via the VS Code save dialog.
 * Returns true if the export succeeded, or false on cancellation or reported failure.
 */
export async function exportLayoutToFile(
  layout: LayoutData,
  vscode: typeof import('vscode'),
): Promise<boolean> {
  try {
    const uri = await vscode.window.showSaveDialog({
      filters: { 'JSON files': ['json'] },
      defaultUri: vscode.Uri.file('squad-pod-layout.json'),
      saveLabel: 'Export Layout',
    });

    if (!uri) {
      return false;
    }

    const content = Buffer.from(JSON.stringify(layout, null, 2), 'utf-8');
    await vscode.workspace.fs.writeFile(uri, content);
    return true;
  } catch (error) {
    void vscode.window.showErrorMessage(`Squad Pod: Could not export layout: ${String(error)}. Check the destination and permissions, then try exporting again.`);
    return false;
  }
}

/**
 * Import a layout from a user-chosen JSON file.
 * Returns the parsed layout, or null if cancelled or invalid (invalid files
 * are reported to the user and leave the current layout untouched).
 */
export async function importLayoutFromFile(
  vscode: typeof import('vscode'),
): Promise<LayoutData | null> {
  const uris = await vscode.window.showOpenDialog({
    filters: { 'JSON files': ['json'] },
    canSelectMany: false,
    openLabel: 'Import Layout',
  });

  if (!uris || uris.length === 0) {
    return null;
  }

  try {
    const bytes = await vscode.workspace.fs.readFile(uris[0]);
    const layout = parseLayoutJson(Buffer.from(bytes).toString('utf-8'));
    if (!layout) {
      vscode.window.showErrorMessage('Squad Pod: that file is not a valid office layout. Your current layout was not changed.');
    }
    return layout;
  } catch {
    vscode.window.showErrorMessage('Squad Pod: could not read that layout file. Your current layout was not changed.');
    return null;
  }
}
