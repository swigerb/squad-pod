/**
 * squadPaths.ts — Locate the Squad state directory for a workspace.
 *
 * Squad stores team state in `.squad/`. Projects created before the rename
 * use `.ai-team/`, which Squad still reads, so Squad Pod accepts both.
 */

import * as fs from 'fs';
import * as path from 'path';

export const SQUAD_DIR_NAMES = ['.squad', '.ai-team'] as const;

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Absolute path of the Squad state directory, preferring `.squad/`. */
export function resolveSquadDir(workspaceRoot: string): string {
  for (const name of SQUAD_DIR_NAMES) {
    const candidate = path.join(workspaceRoot, name);
    if (isDirectory(candidate)) {
      return candidate;
    }
  }
  return path.join(workspaceRoot, SQUAD_DIR_NAMES[0]);
}

/** True when the folder contains a Squad state directory. */
export function hasSquadDir(workspaceRoot: string): boolean {
  return SQUAD_DIR_NAMES.some(name => isDirectory(path.join(workspaceRoot, name)));
}

/** Choose the first workspace folder that contains Squad state, else the first folder. */
export function pickSquadWorkspace(folders: readonly string[]): string | undefined {
  return folders.find(hasSquadDir) ?? folders[0];
}
