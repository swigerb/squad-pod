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

/**
 * Derive an agent slug from the charter path.
 * Given `.squad/agents/homer-simpson/charter.md` → `"homer-simpson"`.
 * Falls back to lowercasing the name with spaces → hyphens.
 */
function deriveSlug(charterPath: string, name: string): string {
  // Strip surrounding backticks if present
  const cleaned = charterPath.replace(/`/g, '').trim();
  // Extract directory name: .squad/agents/<slug>/charter.md
  const match = /\.squad\/agents\/([^/]+)\/charter\.md/i.exec(cleaned);
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
 * Parse the raw markdown content of a `team.md` file and return
 * all visible team members (Scribe and Ralph filtered out).
 */
export function parseTeamRoster(content: string): SquadTeamMember[] {
  const lines = content.split('\n');
  const members: SquadTeamMember[] = [];

  // Find the ## Members section
  let inMembersSection = false;
  let headerParsed = false;
  let columnIndices: { name: number; role: number; charter: number; status: number } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect start of Members section
    if (/^##\s+Members/i.test(trimmed)) {
      inMembersSection = true;
      headerParsed = false;
      continue;
    }

    // If we hit another ## heading, we've left the section
    if (inMembersSection && /^##\s+/.test(trimmed) && !/^##\s+Members/i.test(trimmed)) {
      break;
    }

    if (!inMembersSection) {
      continue;
    }

    // Skip non-table lines
    if (!trimmed.startsWith('|')) {
      continue;
    }

    // Split table row into cells
    const cells = trimmed
      .split('|')
      .map(c => c.trim())
      .filter(c => c.length > 0);

    if (cells.length < 2) {
      continue;
    }

    // First table row with '|' is the header — parse column positions
    if (!headerParsed) {
      // Check if this is a separator row (all dashes)
      if (cells.every(c => /^[-:]+$/.test(c))) {
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

    // Skip separator rows
    if (cells.every(c => /^[-:]+$/.test(c))) {
      continue;
    }

    if (!columnIndices) {
      continue;
    }

    const name = cells[columnIndices.name] ?? '';
    const role = cells[columnIndices.role] ?? '';
    const charterRaw = columnIndices.charter >= 0 ? (cells[columnIndices.charter] ?? '') : '';
    const status = columnIndices.status >= 0 ? (cells[columnIndices.status] ?? '') : '✅ Active';

    if (!name) {
      continue;
    }

    const member: SquadTeamMember = {
      name,
      slug: deriveSlug(charterRaw, name),
      role,
      status,
      charterPath: charterRaw.replace(/`/g, '').trim(),
    };

    // Filter out Scribe and Ralph
    if (!isHiddenAgent(member)) {
      members.push(member);
    }
  }

  return members;
}

/**
 * Read `.squad/team.md` from disk and parse it.
 * Returns an empty array if the file doesn't exist or can't be parsed.
 */
export function readTeamRoster(workspaceRoot: string): SquadTeamMember[] {
  const teamFile = path.join(workspaceRoot, '.squad', 'team.md');
  try {
    const content = fs.readFileSync(teamFile, 'utf-8');
    return parseTeamRoster(content);
  } catch {
    return [];
  }
}
