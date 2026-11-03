import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjectFiles } from './projectFiles.js';
import { SQUAD_DIR_NAMES } from './squadPaths.js';

/** Fixed team.md byte limit; oversize input is rejected, never truncated. */
export const MAX_TEAM_SOURCE_BYTES = 256 * 1024;

/** Source availability is independent of whether the content contains a roster. */
export type TeamSource = {
  directory: typeof SQUAD_DIR_NAMES[number];
  byteLength: number;
} & (
  | { status: 'available'; content: string }
  | { status: 'missing' | 'unreadable'; reason: string }
);

/**
 * Select the guarded roster directory using metadata only, without reading team.md.
 * Only an absent .squad permits legacy fallback; invalid or unsafe paths throw.
 * Selection alone does not establish that the roster content is available.
 */
export function selectTeamSourceDirectory(files: ProjectFiles): TeamSource['directory'] {
  try {
    if (!fs.statSync(files.resolve(SQUAD_DIR_NAMES[0])).isDirectory()) {
      throw new Error('Preferred roster path is not a directory.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {return SQUAD_DIR_NAMES[1];}
    throw error;
  }
  return SQUAD_DIR_NAMES[0];
}

/**
 * Read only the host-selected project's fixed team.md through ProjectFiles.
 * Only an absent .squad directory permits .ai-team fallback. Invalid directories,
 * internal links, changed identities, non-files, invalid UTF-8 and >256-KiB files
 * fail closed. No discovery, runtime membership or root/session authority is granted.
 */
export function readTeamSource(files: ProjectFiles): TeamSource {
  let directory: TeamSource['directory'] = SQUAD_DIR_NAMES[0];
  const unavailable = (status: 'missing' | 'unreadable', reason: string): TeamSource =>
    ({ status, directory, byteLength: 0, reason });
  try {
    directory = selectTeamSourceDirectory(files);
    const content = files.read(path.join(directory, 'team.md'), MAX_TEAM_SOURCE_BYTES, { preserveBOM: true });
    if (selectTeamSourceDirectory(files) !== directory) {throw new Error('Selected roster directory changed.');}
    if (content === null) {return unavailable('missing', 'No selected-project team.md found.');}
    return { status: 'available', directory, byteLength: Buffer.byteLength(content), content };
  } catch (error) {
    return unavailable('unreadable', `Cannot read selected-project roster: ${String(error)}`);
  }
}
