import * as path from 'node:path';
import { parseCharterDetails, type CharterDetails } from './charterDetails.js';
import { ProjectFiles } from './projectFiles.js';
import { selectTeamSourceDirectory } from './teamSource.js';

/** Host-authorized project and live exact membership; neither is discovered here. */
export interface MemberCharterContext {
  workspaceRoot: string;
  /** Check current exact IDs, not aliases, task owners, or a copied roster snapshot. */
  isCurrentMember(id: string): boolean;
}

/** Unavailable means no authorized member; other states describe its fixed charter. */
export type MemberCharter = CharterDetails & (
  | { charterStatus: 'available'; charterContent: string }
  | { charterStatus: 'missing' | 'unreadable' | 'unavailable'; charterContent: null }
);

/**
 * Read only a current member's fixed charter, bounded to 64 KiB of strict UTF-8.
 * The host owns project/session authority and membership freshness. Canonicalizing
 * its explicit root does not authorize a Canvas session. IDs are never normalized;
 * preserve roster IDs while refusing path syntax rather than imposing new slugs.
 * Legacy charters are eligible only when the preferred .squad directory is absent.
 */
export function readMemberCharter(context: MemberCharterContext, id: string): MemberCharter {
  const empty = (charterStatus: Exclude<MemberCharter['charterStatus'], 'available'>): MemberCharter => ({
    charterStatus, charterContent: null, charterSummary: null,
    expertise: null, responsibilities: null, boundaries: null,
  });
  if (!id || id === '.' || id === '..' || /[\\/:\0]/.test(id)
    || !context.isCurrentMember(id)) {
    return empty('unavailable');
  }
  try {
    const files = new ProjectFiles(context.workspaceRoot);
    const directory = selectTeamSourceDirectory(files);
    const relative = path.join(directory, 'agents', id, 'charter.md');
    if (!context.isCurrentMember(id)) {return empty('unavailable');}
    const source = files.read(relative, 64 * 1024);
    if (!context.isCurrentMember(id)) {return empty('unavailable');}
    return source === null ? empty('missing') : {
      charterStatus: 'available', charterContent: source, ...parseCharterDetails(source),
    };
  } catch {
    return empty('unreadable');
  }
}
