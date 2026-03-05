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
import type { LayoutData } from './types.js';
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
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as LayoutData;
    return migrateLayout(data);
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
  fs.writeFileSync(filePath, JSON.stringify(layout, null, 2), 'utf-8');
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

const CURRENT_LAYOUT_VERSION = 1;

/**
 * Migrate older layout formats to the current version.
 * Currently a passthrough — bump the version when the schema changes.
 */
function migrateLayout(data: LayoutData): LayoutData {
  if (!data.version) {
    data.version = CURRENT_LAYOUT_VERSION;
  }
  // Future migrations go here:
  // if (data.version < 2) { ... data.version = 2; }
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
  onChange: (layout: LayoutData) => void,
): LayoutWatcher {
  const filePath = layoutFilePath(workspaceRoot);
  let lastMtimeMs = 0;
  let lastSize = 0;
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
      if (stat.mtimeMs !== lastMtimeMs || stat.size !== lastSize) {
        lastMtimeMs = stat.mtimeMs;
        lastSize = stat.size;

        const content = fs.readFileSync(filePath, 'utf-8');
        const layout = migrateLayout(JSON.parse(content) as LayoutData);
        onChange(layout);
      }
    } catch {
      // File may have been deleted — ignore
    }
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
 * Returns true if the export succeeded.
 */
export async function exportLayoutToFile(
  layout: LayoutData,
  vscode: typeof import('vscode'),
): Promise<boolean> {
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
}

/**
 * Import a layout from a user-chosen JSON file.
 * Returns the parsed layout or null if cancelled/invalid.
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
    const content = Buffer.from(bytes).toString('utf-8');
    const data = JSON.parse(content) as LayoutData;
    return migrateLayout(data);
  } catch {
    return null;
  }
}
