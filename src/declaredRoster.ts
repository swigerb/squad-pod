import type { ProjectFiles } from './projectFiles.js';
import { SQUAD_DIR_NAMES } from './squadPaths.js';
import { readTeamSource } from './teamSource.js';
import { parseAllMembers, parseTeamRoster } from './teamParser.js';
import type { SquadTeamMember } from './types.js';

/** Existing observer team.md byte limit; oversize input is rejected, never truncated. */
export { MAX_TEAM_SOURCE_BYTES as MAX_DECLARED_ROSTER_BYTES } from './teamSource.js';

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
  const source = readTeamSource(files);
  const { directory, byteLength } = source;
  if (source.status !== 'available') {
    return { ...source, members: [], allMembers: [] };
  }
  const allMembers = parseAllMembers(source.content);
  if (!allMembers.length) {
    return { status: 'invalid', directory, byteLength, members: [], allMembers: [],
      reason: 'Roster is empty or has no usable Members table.' };
  }
  return { status: 'available', directory, byteLength, allMembers, members: parseTeamRoster(source.content) };
}
