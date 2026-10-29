/**
 * teamParser.ts — Parse `.squad/team.md` to extract the Members roster table.
 *
 * The expected table format under the `## Members` heading:
 *
 * | Name | Role | Charter | Status |
 * |------|------|---------|--------|
 * | Homer Simpson | 🏗️ Lead | `.squad/agents/homer-simpson/charter.md` | ✅ Active |
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SquadTeamMember } from './types.js';
import { resolveSquadDir } from './squadPaths.js';

/**
 * Derive an agent slug from the charter path.
 * Given `.squad/agents/homer-simpson/charter.md` → `"homer-simpson"`.
 * Falls back to lowercasing the name with spaces → hyphens.
 */
function deriveSlug(charterPath: string, name: string): string {
  // Strip surrounding backticks if present
  const cleaned = charterPath.replace(/`/g, '').trim();
  // Extract directory name: .squad/agents/<slug>/charter.md
  const match = /(?:^|[\\/])agents[\\/]([^\\/]+)[\\/]charter\.md$/i.exec(cleaned);
  if (match?.[1]) {
    return match[1];
  }
  // Fallback: name → slug
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Determine whether a roster row represents a non-visible member.
 * Scribe (📋 Silent/Scribe) and Ralph (🔄 Monitor) should be filtered out
 * of the visual character list.
 */
function isHiddenAgent(member: SquadTeamMember): boolean {
  const lowerRole = member.role.toLowerCase();
  const lowerStatus = member.status.toLowerCase();
  const lowerName = member.name.toLowerCase();

  // Scribe — role contains "scribe" or status contains "silent"
  if (lowerRole.includes('scribe') || lowerStatus.includes('silent')) {
    return true;
  }
  // Ralph — name is "ralph" and role contains "monitor"
  if (lowerName === 'ralph' && lowerRole.includes('monitor')) {
    return true;
  }
  return false;
}

/**
 * Split a markdown table row into cells, keeping empty interior cells so
 * column positions stay aligned with the header.
 */
function splitTableRow(row: string): string[] {
  const cells = row.split('|').map(c => c.trim());
  if (cells.length > 0 && cells[0] === '') {
    cells.shift();
  }
  if (cells.length > 0 && cells[cells.length - 1] === '') {
    cells.pop();
  }
  return cells;
}

/**
 * Parse the raw markdown content of a `team.md` file and return
 * all visible team members (Scribe and Ralph filtered out).
 */
export function parseTeamRoster(content: string): SquadTeamMember[] {
  return parseAllMembers(content).filter(member => !isHiddenAgent(member));
}

/**
 * Parse team.md content and return ALL members (including hidden ones like Scribe/Ralph).
 */
export function parseAllMembers(content: string): SquadTeamMember[] {
  const lines = content.split(/\r?\n/);
  const members: SquadTeamMember[] = [];

  let inMembersSection = false;
  let headerParsed = false;
  let columnIndices: { name: number; role: number; charter: number; status: number } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+Members/i.test(trimmed)) {
      inMembersSection = true;
      headerParsed = false;
      continue;
    }
    if (inMembersSection && /^##\s+/.test(trimmed) && !/^##\s+Members/i.test(trimmed)) {
      break;
    }
    if (!inMembersSection || !trimmed.startsWith('|')) {
      continue;
    }

    const cells = splitTableRow(trimmed);
    if (cells.filter(c => c.length > 0).length < 2) {
      continue;
    }
    const isSeparator = cells.every(c => c === '' || /^[-:]+$/.test(c));

    if (!headerParsed) {
      if (isSeparator) {
        continue;
      }
      const lowerCells = cells.map(c => c.toLowerCase());
      columnIndices = {
        name: Math.max(0, lowerCells.findIndex(c => c.includes('name'))),
        role: Math.max(0, lowerCells.findIndex(c => c.includes('role'))),
        charter: lowerCells.findIndex(c => c.includes('charter')),
        status: lowerCells.findIndex(c => c.includes('status')),
      };
      headerParsed = true;
      continue;
    }
    if (isSeparator || !columnIndices) {
      continue;
    }

    const name = cells[columnIndices.name] ?? '';
    const role = cells[columnIndices.role] ?? '';
    const charterRaw = columnIndices.charter >= 0 ? (cells[columnIndices.charter] ?? '') : '';
    const status = columnIndices.status >= 0 ? (cells[columnIndices.status] || '✅ Active') : '✅ Active';

    if (!name) {
      continue;
    }

    members.push({
      name,
      slug: deriveSlug(charterRaw, name),
      role,
      status,
      charterPath: charterRaw.replace(/`/g, '').trim(),
    });
  }
  return members;
}
/**
 * Extract the team name from team.md — typically the first # heading.
 */
export function parseTeamName(content: string): string | null {
  const match = /^#\s+(.+)/m.exec(content);
  return match ? match[1].trim() : null;
}

/**
 * Extract the project description from team.md — text between ## Project Context heading
 * and the next ## heading (or between # heading and ## Members).
 */
export function parseProjectContext(content: string): string | null {
  // Try ## Project Context first
  const ctxMatch = /^##\s+Project Context\s*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/mi.exec(content);
  if (ctxMatch) {
    const text = ctxMatch[1].trim();
    if (text) {return text;}
  }
  // Fall back: text between first # heading and first ## heading
  const introMatch = /^#\s+.+\n([\s\S]*?)(?=\n##\s)/m.exec(content);
  if (introMatch) {
    const text = introMatch[1].trim();
    if (text) {return text;}
  }
  return null;
}

/**
 * Read `.squad/team.md` from disk and parse it.
 * Returns an empty array if the file doesn't exist or can't be parsed.
 */
export function readTeamRoster(workspaceRoot: string): SquadTeamMember[] {
  const teamFile = path.join(resolveSquadDir(workspaceRoot), 'team.md');
  try {
    const content = fs.readFileSync(teamFile, 'utf-8');
    return parseTeamRoster(content);
  } catch {
    return [];
  }
}

/**
 * Read `.squad/team.md` raw content from disk.
 */
export function readTeamFile(workspaceRoot: string): string | null {
  const teamFile = path.join(resolveSquadDir(workspaceRoot), 'team.md');
  try {
    return fs.readFileSync(teamFile, 'utf-8');
  } catch {
    return null;
  }
}
