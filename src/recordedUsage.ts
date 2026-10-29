import * as fs from 'fs';
import * as path from 'path';
import { resolveSquadDir } from './squadPaths.js';
import type { SquadTeamMember } from './types.js';

export const MAX_USAGE_BYTES = 2 * 1024 * 1024;
export const MAX_USAGE_LINES = 10_000;
export const MAX_USAGE_HISTORY = 40;

export interface RecordedUsageEntry {
  sessionId: string;
  turnId: string | null;
  agentName: string | null;
  rosterName: string | null;
  attribution: 'roster-match' | 'unattributed' | 'ambiguous';
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  timestamp: string;
}

export interface RecordedUsageSnapshot {
  state: 'unavailable' | 'missing' | 'ready' | 'partial' | 'error';
  sourcePath: string | null;
  diagnostic: string | null;
  checkedAt: string;
  lastRecordAt: string | null;
  lastUsageAt: string | null;
  invalidLines: number;
  unsupportedLines: number;
  pendingFinalLine: boolean;
  usageRecords: number;
  attemptedTurns: number;
  coveredTurns: number;
  unlinkedUsageRecords: number;
  normalizedValueRecords: number;
  totals: { inputTokens: number; outputTokens: number; estimatedCost: number } | null;
  history: RecordedUsageEntry[];
}

export function unavailableUsage(diagnostic = 'No workspace selected.'): RecordedUsageSnapshot {
  return {
    state: 'unavailable', sourcePath: null, diagnostic, checkedAt: new Date().toISOString(),
    lastRecordAt: null, lastUsageAt: null, invalidLines: 0, unsupportedLines: 0,
    pendingFinalLine: false, usageRecords: 0, attemptedTurns: 0, coveredTurns: 0,
    unlinkedUsageRecords: 0, normalizedValueRecords: 0, totals: null, history: [],
  };
}

function text(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function tokens(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function cost(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function rosterMatcher(members: readonly SquadTeamMember[]) {
  const aliases = new Map<string, Set<SquadTeamMember>>();
  const slugs = new Map<string, number>();
  // An excessive roster must not hide a collision beyond an arbitrary slice.
  if (members.length <= 1000) {
    for (const member of members) {
      const slug = member.slug.trim().toLowerCase();
      slugs.set(slug, (slugs.get(slug) ?? 0) + 1);
      for (const key of [member.name.trim().toLowerCase(), slug]) {
        const candidates = aliases.get(key) ?? new Set<SquadTeamMember>();
        candidates.add(member);
        aliases.set(key, candidates);
      }
    }
  }
  return (name: string | null): Pick<RecordedUsageEntry, 'rosterName' | 'attribution'> => {
    const candidates = aliases.get(name?.trim().toLowerCase() ?? '');
    const member = candidates?.values().next().value;
    if ((candidates?.size ?? 0) > 1 || (member && (slugs.get(member.slug.trim().toLowerCase()) ?? 0) > 1)) {
      return { rosterName: null, attribution: 'ambiguous' };
    }
    return member?.slug
      ? { rosterName: member.name, attribution: 'roster-match' }
      : { rosterName: null, attribution: 'unattributed' };
  };
}

/** Rebuild a bounded snapshot, rather than retaining stale totals across rewrites. */
export function parseRecordedUsage(content: string, members: readonly SquadTeamMember[] = []): RecordedUsageSnapshot {
  const snapshot = unavailableUsage();
  snapshot.state = 'ready';
  snapshot.diagnostic = null;
  if (Buffer.byteLength(content, 'utf8') > MAX_USAGE_BYTES) {
    return { ...snapshot, state: 'partial', diagnostic: 'Ledger exceeds 2 MiB; no totals read.' };
  }
  const lines = content.split('\n', MAX_USAGE_LINES + 2);
  if (lines.length > MAX_USAGE_LINES + 1) {
    return { ...snapshot, state: 'partial', diagnostic: 'Ledger exceeds 10,000 complete lines; no totals read.' };
  }
  const finalLine = lines.pop() ?? '';
  snapshot.pendingFinalLine = finalLine.trim().length > 0;
  const starts = new Set<string>();
  const matchRoster = rosterMatcher(members);
  const usages: RecordedUsageEntry[] = [];
  let overflow = false;
  const totals = { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
  for (const line of lines) {
    if (!line.trim()) {continue;}
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      snapshot.invalidLines++;
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      snapshot.invalidLines++;
      continue;
    }
    const r = value as Record<string, unknown>;
    if (r.version !== 1 || (r.kind !== 'usage' && r.kind !== 'turn-start')) {
      snapshot.unsupportedLines++;
      continue;
    }
    if (!text(r.sessionId) || !text(r.timestamp, 64) || !Number.isFinite(Date.parse(r.timestamp))
      || (r.agentName !== undefined && (typeof r.agentName !== 'string' || r.agentName.length > 128))
      || (r.turnId !== undefined && !text(r.turnId))) {
      snapshot.invalidLines++;
      continue;
    }
    if (r.kind === 'turn-start') {
      if (!text(r.turnId)) {
        snapshot.invalidLines++;
        continue;
      }
      starts.add(r.turnId);
    } else {
      if (!text(r.model, 128) || !tokens(r.inputTokens) || !tokens(r.outputTokens) || !cost(r.estimatedCost)) {
        snapshot.invalidLines++;
        continue;
      }
      const agentName = typeof r.agentName === 'string' ? r.agentName : null;
      const entry: RecordedUsageEntry = {
        sessionId: r.sessionId, turnId: typeof r.turnId === 'string' ? r.turnId : null,
        agentName, ...matchRoster(agentName), model: r.model,
        inputTokens: r.inputTokens, outputTokens: r.outputTokens,
        estimatedCost: r.estimatedCost, timestamp: new Date(r.timestamp).toISOString(),
      };
      usages.push(entry);
      totals.inputTokens += entry.inputTokens;
      totals.outputTokens += entry.outputTokens;
      totals.estimatedCost += entry.estimatedCost;
      overflow ||= !tokens(totals.inputTokens) || !tokens(totals.outputTokens) || !cost(totals.estimatedCost);
      if (entry.model.trim().toLowerCase() === 'unknown' || entry.inputTokens === 0 || entry.outputTokens === 0) {
        snapshot.normalizedValueRecords++;
      }
    }
    const timestamp = new Date(r.timestamp).toISOString();
    if (!snapshot.lastRecordAt || Date.parse(timestamp) > Date.parse(snapshot.lastRecordAt)) {snapshot.lastRecordAt = timestamp;}
  }
  const covered = new Set<string>();
  for (const entry of usages) {
    const key = entry.turnId;
    if (key && starts.has(key)) {covered.add(key);}
    else {snapshot.unlinkedUsageRecords++;}
  }
  snapshot.usageRecords = usages.length;
  snapshot.attemptedTurns = starts.size;
  snapshot.coveredTurns = covered.size;
  usages.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  snapshot.history = usages.slice(0, MAX_USAGE_HISTORY);
  snapshot.lastUsageAt = usages[0]?.timestamp ?? null;
  snapshot.totals = usages.length && !overflow ? totals : null;
  if (snapshot.invalidLines || snapshot.unsupportedLines || snapshot.pendingFinalLine || overflow) {
    snapshot.state = 'partial';
    snapshot.diagnostic = overflow
      ? 'Reported sums exceed safe numeric limits; totals withheld.'
      : 'Only valid complete version-1 records are included; this is a partial ledger snapshot.';
  }
  if (members.length > 1000) {
    snapshot.state = 'partial';
    snapshot.diagnostic = `${snapshot.diagnostic ?? ''} Roster exceeds 1,000 members; all usage is unattributed.`.trim();
  }
  return snapshot;
}

export function readRecordedUsage(workspaceRoot: string | undefined, members: readonly SquadTeamMember[] = []): RecordedUsageSnapshot {
  if (!workspaceRoot) {return unavailableUsage();}
  const sourcePath = path.join(resolveSquadDir(workspaceRoot), 'log', 'usage.jsonl');
  let fd: number | undefined;
  try {
    if (!fs.statSync(sourcePath).isFile()) {throw new Error('Usage source is not a regular file.');}
    fd = fs.openSync(sourcePath, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {throw new Error('Usage source is not a regular file.');}
    if (stat.size > MAX_USAGE_BYTES) {
      return { ...unavailableUsage(), state: 'partial', sourcePath, diagnostic: 'Ledger exceeds 2 MiB; no totals read.' };
    }
    const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_USAGE_BYTES + 1));
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const after = fs.fstatSync(fd);
    if (bytes !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
      return { ...unavailableUsage(), state: 'partial', sourcePath, diagnostic: 'Ledger changed while reading; retrying on next poll. No totals read.' };
    }
    const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));
    return { ...parseRecordedUsage(content, members), sourcePath };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return {
      ...unavailableUsage(), state: missing ? 'missing' : 'error', sourcePath,
      diagnostic: missing ? 'No local usage ledger. This runtime/backend may not produce one.' : `Cannot read usage ledger: ${String(error)}`,
    };
  } finally {
    if (fd !== undefined) {fs.closeSync(fd);}
  }
}
