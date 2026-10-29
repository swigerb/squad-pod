import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { syncBuiltinESMExports } from 'module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_USAGE_BYTES, MAX_USAGE_HISTORY, MAX_USAGE_LINES, parseRecordedUsage, readRecordedUsage,
} from './recordedUsage.js';
import type { SquadTeamMember } from './types.js';
import { SquadWatcher } from './squadWatcher.js';

const usage = {
  version: 1, kind: 'usage', sessionId: 's1', turnId: 't1', agentName: 'Ada',
  model: 'reported-model', inputTokens: 10, outputTokens: 5, estimatedCost: 0.02,
  timestamp: '2026-10-29T10:00:00Z',
};
const start = { version: 1, kind: 'turn-start', sessionId: 's1', turnId: 't1', timestamp: usage.timestamp };
const jsonl = (...records: unknown[]) => records.map(r => JSON.stringify(r)).join('\n') + '\n';
const member = (name = 'Ada', slug = 'ada'): SquadTeamMember => ({ name, slug, role: 'Dev', status: 'Active', charterPath: '' });

describe('recorded usage version-1 contract', () => {
  it('reports exact values, historical identity, turn-ID coverage and repeated events without invented deduplication', () => {
    const snapshot = parseRecordedUsage(jsonl(
      start, start, { ...start, sessionId: 's2', turnId: 't2' }, usage, usage,
      { ...usage, turnId: undefined, agentName: undefined, model: 'unknown', inputTokens: 0, outputTokens: 0 },
    ), [member()]);
    expect(snapshot).toMatchObject({
      state: 'ready', usageRecords: 3, attemptedTurns: 2, coveredTurns: 1, unlinkedUsageRecords: 1,
      normalizedValueRecords: 1, invalidLines: 0, unsupportedLines: 0, pendingFinalLine: false,
      totals: { inputTokens: 20, outputTokens: 10, estimatedCost: 0.06 },
      lastUsageAt: '2026-10-29T10:00:00.000Z',
    });

    expect(snapshot.history[0]).toMatchObject({ agentName: 'Ada', rosterName: 'Ada', attribution: 'roster-match', model: 'reported-model' });
    expect(snapshot.history[2]).toMatchObject({ agentName: null, rosterName: null, attribution: 'unattributed' });
  });

  it('matches the source-executed Squad stable fixture without agent/time filters or event deduplication', () => {
    // Pinned UsageLedger/runCost contract: c24da2aad2ab7576f6b68dec2bc50b2fe2dc7a8a.
    const content = fs.readFileSync(path.resolve('src', '__fixtures__', 'recorded-usage-v1.jsonl'), 'utf8');
    const snapshot = parseRecordedUsage(content);
    expect(snapshot).toMatchObject({
      state: 'partial', usageRecords: 4, attemptedTurns: 2, coveredTurns: 1,
      invalidLines: 2, unsupportedLines: 0, unlinkedUsageRecords: 2,
      totals: { inputTokens: 2000, outputTokens: 350 },
    });
    expect(snapshot.totals?.estimatedCost).toBeCloseTo(0.018, 12);
    expect(new Set(snapshot.history.map(entry => entry.sessionId)).size).toBe(2);
    expect(snapshot.history.filter(entry => entry.agentName === 'Flight')).toHaveLength(2);
    expect(parseRecordedUsage(jsonl(start, { ...start, sessionId: 'another-session' }, { ...usage, sessionId: 'third-session' })))
      .toMatchObject({ attemptedTurns: 1, coveredTurns: 1, unlinkedUsageRecords: 0 });
  });

  it('keeps unknown, duplicate names, name-vs-slug collisions, and duplicate slugs unattributed', () => {
    for (const members of [
      [member('Ada', 'a'), member('Ada', 'b')],
      [member('Ada', 'a'), member('Someone else', 'ada')],
      [member('Ada', 'same'), member('Other', 'same')],
    ]) {
      expect(parseRecordedUsage(jsonl(usage), members).history[0]).toMatchObject({
        agentName: 'Ada', rosterName: null, attribution: 'ambiguous',
      });
    }
    expect(parseRecordedUsage(jsonl({ ...usage, agentName: 'ada-ish' }), [member()]).history[0].attribution).toBe('unattributed');
    expect(parseRecordedUsage(jsonl({ ...usage, agentName: ' ADA ' }), [member()]).history[0].attribution).toBe('roster-match');
    expect(parseRecordedUsage(jsonl(usage), Array.from({ length: 1001 }, () => member()))).toMatchObject({
      state: 'partial', history: [expect.objectContaining({ attribution: 'unattributed' })],
    });
  });

  it.each([
    { inputTokens: -1 }, { inputTokens: 1.5 }, { inputTokens: '10' },
    { outputTokens: Number.MAX_SAFE_INTEGER + 1 }, { estimatedCost: -0.1 },
    { estimatedCost: null }, { model: '' }, { model: 'x'.repeat(129) },
    { sessionId: '' }, { turnId: '' }, { agentName: 42 }, { agentName: null }, { timestamp: 'invalid' },
    { agentName: 'x'.repeat(129) }, { timestamp: 'x'.repeat(65) },
    { turnId: null }, { sessionId: undefined }, { sessionId: null },
    { inputTokens: undefined }, { outputTokens: undefined }, { model: undefined },
    { estimatedCost: undefined }, { estimatedCost: '0.02' },
  ])('rejects invalid reported fields %j without zero-shaped fallbacks', patch => {
    const snapshot = parseRecordedUsage(jsonl({ ...usage, ...patch }));
    expect(snapshot).toMatchObject({ state: 'partial', invalidLines: 1, usageRecords: 0, totals: null, history: [] });
  });

  it('accepts empty optional names, extra fields and noncanonical Date.parse-able timestamps without shell defaults', () => {
    const snapshot = parseRecordedUsage(jsonl({
      ...usage, agentName: '', turnId: undefined, timestamp: 'Oct 29 2026 10:00:00 GMT',
      ignoredExtraField: 'not rendered',
    }));
    expect(snapshot).toMatchObject({
      state: 'ready', attemptedTurns: 0, coveredTurns: 0, unlinkedUsageRecords: 1,
      history: [expect.objectContaining({ agentName: '', attribution: 'unattributed', timestamp: '2026-10-29T10:00:00.000Z' })],
    });
    expect(JSON.stringify(snapshot)).not.toContain('ignoredExtraField');
  });

  it('separates malformed, unsupported and pending lines, retaining only labeled partial sums', () => {
    const snapshot = parseRecordedUsage(jsonl(usage, { ...usage, version: 2 }, { ...usage, kind: 'context' }, null, { ...start, turnId: undefined })
      + 'not-json\n{"version":1');
    expect(snapshot).toMatchObject({
      state: 'partial', invalidLines: 3, unsupportedLines: 2, pendingFinalLine: true,
      usageRecords: 1, totals: { inputTokens: 10, outputTokens: 5, estimatedCost: 0.02 },
    });
    expect(parseRecordedUsage(JSON.stringify(usage))).toMatchObject({ state: 'partial', totals: null, pendingFinalLine: true });
  });

  it('distinguishes recorded zero, no usage, and turn starts without coverage', () => {
    expect(parseRecordedUsage('')).toMatchObject({ state: 'ready', totals: null, usageRecords: 0 });
    expect(parseRecordedUsage(jsonl(start))).toMatchObject({ totals: null, attemptedTurns: 1, coveredTurns: 0 });
    expect(parseRecordedUsage(jsonl({ ...usage, inputTokens: 0, outputTokens: 0, estimatedCost: 0 }))).toMatchObject({
      totals: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 }, usageRecords: 1,
    });
  });

  it('withholds unsafe sums and bounds byte, line, and emitted history volume', () => {
    expect(parseRecordedUsage(jsonl({ ...usage, inputTokens: Number.MAX_SAFE_INTEGER }, usage))).toMatchObject({
      state: 'partial', totals: null, diagnostic: expect.stringContaining('safe numeric limits'),
    });
    expect(parseRecordedUsage('x'.repeat(MAX_USAGE_BYTES + 1))).toMatchObject({ state: 'partial', totals: null, history: [] });
    expect(parseRecordedUsage('\n'.repeat(MAX_USAGE_LINES + 1))).toMatchObject({ state: 'partial', totals: null });
    expect(parseRecordedUsage('\n'.repeat(MAX_USAGE_LINES - 1) + jsonl(usage))).toMatchObject({ state: 'ready', usageRecords: 1 });
    expect(parseRecordedUsage(jsonl(usage).padEnd(MAX_USAGE_BYTES, ' '))).toMatchObject({ state: 'ready', usageRecords: 1 });
    const snapshot = parseRecordedUsage(jsonl(...Array.from({ length: 100 }, (_, i) => ({
      ...usage, timestamp: new Date(Date.parse(usage.timestamp) + i * 1000).toISOString(),
    }))));
    expect(snapshot.usageRecords).toBe(100);
    expect(snapshot.history).toHaveLength(MAX_USAGE_HISTORY);
    expect(snapshot.history[0].timestamp).toBe('2026-10-29T10:01:39.000Z');
    expect(snapshot.totals?.inputTokens).toBe(1000);
    expect(JSON.stringify(snapshot).length).toBeLessThan(30_000);
  });
});

describe('local usage source and generic activity isolation', () => {
  let root: string;
  let ledger: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-usage-'));
    ledger = path.join(root, '.ai-team', 'log', 'usage.jsonl');
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('uses the resolved state path and replaces totals across append, partial append, rewrite, truncation and deletion', () => {
    expect(readRecordedUsage(undefined).state).toBe('unavailable');
    expect(readRecordedUsage(root)).toMatchObject({ state: 'missing', sourcePath: ledger, totals: null });
    fs.writeFileSync(ledger, jsonl(start, usage));
    expect(readRecordedUsage(root, [member()])).toMatchObject({ state: 'ready', usageRecords: 1, coveredTurns: 1 });
    fs.appendFileSync(ledger, JSON.stringify({ ...usage, outputTokens: 7 }).slice(0, -1));
    expect(readRecordedUsage(root)).toMatchObject({ state: 'partial', pendingFinalLine: true, usageRecords: 1 });
    fs.appendFileSync(ledger, '}\n');
    expect(readRecordedUsage(root)).toMatchObject({ state: 'ready', usageRecords: 2, totals: { inputTokens: 20, outputTokens: 12 } });
    fs.writeFileSync(ledger, jsonl({ ...usage, outputTokens: 9 }));
    expect(readRecordedUsage(root)).toMatchObject({ state: 'ready', usageRecords: 1, totals: { inputTokens: 10, outputTokens: 9 } });
    fs.truncateSync(ledger, 0);
    expect(readRecordedUsage(root)).toMatchObject({ state: 'ready', totals: null, history: [] });
    fs.unlinkSync(ledger);
    expect(readRecordedUsage(root)).toMatchObject({ state: 'missing', totals: null });
    fs.mkdirSync(path.join(root, '.squad', 'log'), { recursive: true });
    expect(readRecordedUsage(root).sourcePath).toBe(path.join(root, '.squad', 'log', 'usage.jsonl'));
  });

  it('does not read oversized sources and reports source errors explicitly', () => {
    fs.writeFileSync(ledger, 'x');
    fs.truncateSync(ledger, MAX_USAGE_BYTES + 1);
    const read = vi.spyOn(fs, 'readSync');
    syncBuiltinESMExports();
    expect(readRecordedUsage(root)).toMatchObject({ state: 'partial', totals: null, diagnostic: expect.stringContaining('2 MiB') });
    expect(read).not.toHaveBeenCalled();
    fs.writeFileSync(ledger, jsonl(usage).padEnd(MAX_USAGE_BYTES, ' '));
    expect(readRecordedUsage(root).state).toBe('ready');
    expect(read).toHaveBeenCalledOnce();
    fs.unlinkSync(ledger);
    fs.mkdirSync(ledger);
    expect(readRecordedUsage(root)).toMatchObject({ state: 'error', totals: null, diagnostic: expect.stringContaining('regular file') });
  });

  it('withholds changing reads and rejects invalid UTF-8 rather than altering reported identities', () => {
    fs.writeFileSync(ledger, jsonl(usage));
    const originalRead = fs.readSync;
    const read = vi.spyOn(fs, 'readSync').mockImplementationOnce((fd, buffer, offset, length, position) => {
      const bytes = originalRead(fd, buffer, offset, length, position);
      fs.appendFileSync(ledger, jsonl(usage));
      return bytes;
    });
    syncBuiltinESMExports();
    expect(readRecordedUsage(root)).toMatchObject({
      state: 'partial', totals: null, diagnostic: expect.stringContaining('changed while reading'),
    });
    read.mockRestore();
    syncBuiltinESMExports();
    fs.writeFileSync(ledger, Buffer.from([0xff, 0x0a]));
    expect(readRecordedUsage(root)).toMatchObject({
      state: 'error', totals: null, diagnostic: expect.stringContaining('Cannot read usage ledger'),
    });
  });

  it('never sends ledger startup/appends through the activity watcher, even with misleading markdown', () => {
    fs.writeFileSync(ledger, jsonl(usage));
    const onAgentActivity = vi.fn();
    const watcher = new SquadWatcher(root, { onRosterChanged: () => {}, onAgentActivity }, { useFsWatch: false });
    try {
      watcher.scan();
      fs.appendFileSync(ledger, '**Agent:** Ada (Dev)\nhistorical report\n');
      watcher.scan();
      expect(onAgentActivity).not.toHaveBeenCalled();
      fs.writeFileSync(path.join(path.dirname(ledger), 'real-log.md'), '**Agent:** Ada (Dev)\nreal activity\n');
      watcher.scan();
      expect(onAgentActivity).toHaveBeenCalledOnce();
    } finally {
      watcher.dispose();
    }
  });
});
