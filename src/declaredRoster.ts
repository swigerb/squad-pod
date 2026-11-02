import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProjectFiles } from './projectFiles.js';
import { SQUAD_DIR_NAMES } from './squadPaths.js';
import { parseAllMembers, parseTeamRoster } from './teamParser.js';
import type { SquadTeamMember } from './types.js';

/** Existing observer team.md byte limit; oversize input is rejected, never truncated. */
export const MAX_DECLARED_ROSTER_BYTES = 256 * 1024;

/** The host supplies its already-authorized selected project, retaining root identity. */
export interface DeclaredRosterContext {
  files: ProjectFiles;
}

/** Declared metadata only: no runtime membership, tasks, model observations or usage. */
export type DeclaredRoster = {
  directory: typeof SQUAD_DIR_NAMES[number];
  byteLength: number;
} & (
  | { status: 'available'; members: SquadTeamMember[]; allMembers: SquadTeamMember[] }
  | { status: 'missing' | 'invalid' | 'unreadable'; members: []; allMembers: []; reason: string }
);

/**
 * Read the fixed selected-project roster through the shared identity/link guards.
 * Only an absent preferred directory permits legacy fallback. Parsing and visual
 * filtering remain owned by teamParser; charter paths are metadata, never read.
 * Availability is not authority to launch, write, or adopt runtime agents.
 */
export function readDeclaredRoster({ files }: DeclaredRosterContext): DeclaredRoster {
  let directory: DeclaredRoster['directory'] = SQUAD_DIR_NAMES[0];
  let byteLength = 0;
  const unavailable = (status: 'missing' | 'invalid' | 'unreadable', reason: string): DeclaredRoster =>
    ({ status, directory, byteLength, members: [], allMembers: [], reason });
  function selectDirectory(): DeclaredRoster['directory'] {
    try {
      if (!fs.statSync(files.resolve(SQUAD_DIR_NAMES[0])).isDirectory()) {
        throw new Error('Preferred roster path is not a directory.');
      }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {return SQUAD_DIR_NAMES[1];}
      throw error;
    }
    return SQUAD_DIR_NAMES[0];
  }
  try {
    directory = selectDirectory();
    const source = files.read(path.join(directory, 'team.md'), MAX_DECLARED_ROSTER_BYTES);
    if (selectDirectory() !== directory) {throw new Error('Selected roster directory changed.');}
    if (source === null) {return unavailable('missing', 'No selected-project team.md found.');}
    byteLength = Buffer.byteLength(source);
    const allMembers = parseAllMembers(source);
    if (!allMembers.length) {return unavailable('invalid', 'Roster is empty or has no usable Members table.');}
    return { status: 'available', directory, byteLength, allMembers, members: parseTeamRoster(source) };
  } catch (error) {
    return unavailable('unreadable', `Cannot read selected-project roster: ${String(error)}`);
  }
}
