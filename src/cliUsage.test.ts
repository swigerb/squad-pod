import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { syncBuiltinESMExports } from 'module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliUsageImport, MAX_CLI_USAGE_BYTES, parseCliUsage } from './cliUsage.js';

const fixture = fs.readFileSync(path.resolve('src', '__fixtures__', 'cli-usage-1.0.105.synthetic.json'), 'utf8');
const raw = () => JSON.parse(fixture);
const parse = (value: unknown) => parseCliUsage(JSON.stringify(value));

describe('CLI 1.0.105 declared projection (synthetic, not real-export evidence)', () => {
  it('projects native units without adding overlapping breakdowns or retaining private data', () => {
    const snapshot = parseCliUsage(fixture);
    expect(snapshot).toMatchObject({
      state: 'ready', report: {
        sessionStartTime: '2026-10-28T15:00:00.000Z', userRequests: 2, premiumRequests: 0.5,
        apiDurationMs: 1200, nanoAiu: 450000, modelCount: 1,
        models: [{ model: 'synthetic-model', requests: 3, premiumRequests: 0.5,
          inputTokens: 120, outputTokens: 30, cacheReadTokens: 40, cacheWriteTokens: 10,
          reasoningTokens: null, nanoAiu: 450000 }],
      },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/not-for-display|NOT FOR DISPLAY|agentDisplayName|currentModel|estimatedCost|unverified-agent/);
  });

  it('preserves omitted optional metrics, reported zero, and empty model maps', () => {
    const r = raw();
    delete r.totalNanoAiu;
    delete r.modelMetrics['synthetic-model'].totalNanoAiu;
    expect(parse(r).report).toMatchObject({ nanoAiu: null, models: [{ nanoAiu: null, reasoningTokens: null }] });
    r.totalNanoAiu = 0;
    r.modelMetrics = {};
    expect(parse(r).report).toMatchObject({ nanoAiu: 0, modelCount: 0, models: [] });
  });

  it.each([
    (r: ReturnType<typeof raw>) => { r.totalUserRequests = 0.5; },
    (r: ReturnType<typeof raw>) => { r.totalPremiumRequestCost = -1; },
    (r: ReturnType<typeof raw>) => { r.totalNanoAiu = null; },
    (r: ReturnType<typeof raw>) => { r.totalApiDurationMs = Number.MAX_SAFE_INTEGER + 1; },
    (r: ReturnType<typeof raw>) => { r.modelMetrics['synthetic-model'].usage.inputTokens = '120'; },
    (r: ReturnType<typeof raw>) => { r.modelMetrics['synthetic-model'].usage.reasoningTokens = null; },
    (r: ReturnType<typeof raw>) => { r.modelMetrics['synthetic-model'].requests = null; },
    (r: ReturnType<typeof raw>) => { r.modelMetrics['synthetic-model'] = null; },
    (r: ReturnType<typeof raw>) => { r.version = 2; },
    (r: ReturnType<typeof raw>) => { r.schemaVersion = 1; },
    (r: ReturnType<typeof raw>) => { delete r.lastCallInputTokens; },
    (r: ReturnType<typeof raw>) => { r.sessionStartTime = 'not a date'; },
    (r: ReturnType<typeof raw>) => { r.codeChanges = null; },
  ])('rejects invalid/unsupported quantities and shapes without success-shaped zero fallback (%#)', mutate => {
    const r = raw();
    mutate(r);
    expect(parse(r)).toMatchObject({ state: 'error', report: null, diagnostic: expect.any(String) });
  });

  it('requires one document and bounds bytes, depth, fields, labels and model rows', () => {
    for (const content of ['', fixture.slice(0, -3), `${fixture}\n${fixture}`, 'null', '[]',
      fixture.replace('"totalUserRequests": 2', '"totalUserRequests": 2, "totalUserRequests": 3'),
      fixture.replace('"totalUserRequests": 2', '"totalUserRequests": 2, "totalUserReque\\u0073ts": 3'),
      fixture.padEnd(MAX_CLI_USAGE_BYTES + 1, ' ')]) {
      expect(parseCliUsage(content)).toMatchObject({ state: 'error', report: null });
    }
    expect(parseCliUsage(fixture.padEnd(MAX_CLI_USAGE_BYTES, ' ')).state).toBe('ready');
    const r = raw();
    const metric = r.modelMetrics['synthetic-model'];
    r.modelMetrics = Object.fromEntries(Array.from({ length: 128 }, (_, i) => [`model-${i}`, metric]));
    expect(parse(r).report).toMatchObject({ modelCount: 128, models: expect.any(Array) });
    expect(parse(r).report?.models).toHaveLength(40);
    r.modelMetrics.extra = metric;
    expect(parse(r).state).toBe('error');
    r.modelMetrics = { ['x'.repeat(129)]: metric };
    expect(parse(r).state).toBe('error');
    r.modelMetrics = {};
    r.extra = [[[[[[[[[0]]]]]]]]];
    expect(parse(r).state).toBe('error');
    r.extra = Array(10_001).fill(0);
    expect(parse(r).state).toBe('error');
    r.extra = Array.from({ length: 100 }, () => Array(100).fill(0));
    expect(parse(r).state).toBe('error');
  });
});

describe('explicit in-memory file selection', () => {
  const roots: string[] = [];
  const setup = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-cli-usage-'));
    roots.push(root);
    const file = path.join(root, 'usage.json');
    fs.writeFileSync(file, fixture);
    return { root: fs.realpathSync(root), file: fs.realpathSync(file) };
  };
  afterEach(() => {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    for (const root of roots.splice(0)) {fs.rmSync(root, { recursive: true, force: true });}
  });

  it('does not read before consent and replaces, never accumulates, refresh snapshots', () => {
    const { root, file } = setup();
    const importer = new CliUsageImport();
    expect(importer.refresh(root)).toMatchObject({ state: 'unselected', report: null });
    expect(importer.select(root, file).report?.premiumRequests).toBe(0.5);
    expect(importer.refresh(root).report?.premiumRequests).toBe(0.5);
    const r = raw(); r.totalPremiumRequestCost = 0;
    fs.writeFileSync(file, JSON.stringify(r));
    expect(importer.refresh(root).report?.premiumRequests).toBe(0);
    fs.writeFileSync(file, '{');
    expect(importer.refresh(root)).toMatchObject({ state: 'error', report: null });
    fs.writeFileSync(file, fixture);
    expect(importer.refresh(root).state).toBe('ready');
    expect(importer.refresh(`${root}-other`)).toMatchObject({ state: 'unselected', sourcePath: null, report: null });
    expect(importer.refresh(root).state).toBe('unselected');
  });

  it('rejects escapes, directories, links, oversized and invalid UTF-8 files', () => {
    const { root, file } = setup();
    const other = setup();
    const importer = new CliUsageImport();
    expect(importer.select(root, other.file).state).toBe('error');
    expect(importer.select(root, root).state).toBe('error');
    const link = path.join(root, 'link.json');
    fs.linkSync(file, link);
    expect(importer.select(root, link).state).toBe('error');
    fs.unlinkSync(link);
    const junction = path.join(root, 'junction');
    fs.symlinkSync(other.root, junction, process.platform === 'win32' ? 'junction' : 'dir');
    expect(importer.select(root, path.join(junction, 'usage.json')).state).toBe('error');
    fs.writeFileSync(file, Buffer.from([0xff, 0xfe]));
    expect(importer.select(root, file)).toMatchObject({ state: 'error', report: null });
    fs.writeFileSync(file, ' '.repeat(MAX_CLI_USAGE_BYTES + 1));
    expect(importer.select(root, file)).toMatchObject({ state: 'error', report: null });
  });

  it('revokes consent for a replaced/deleted file, without retaining successful quantities', () => {
    const { root, file } = setup();
    const importer = new CliUsageImport();
    importer.select(root, file);
    const replacement = path.join(root, 'replacement.json');
    fs.writeFileSync(replacement, fixture);
    fs.unlinkSync(file);
    fs.renameSync(replacement, file);
    expect(importer.refresh(root)).toMatchObject({ state: 'error', report: null });
    expect(importer.refresh(root).state).toBe('unselected');
    expect(importer.select(root, file).state).toBe('ready');
    fs.unlinkSync(file);
    expect(importer.refresh(root)).toMatchObject({ state: 'error', report: null });
  });

  it('clears consent explicitly and rejects a replaced workspace root even at the same path', () => {
    const { root, file } = setup();
    const importer = new CliUsageImport();
    expect(importer.select(root, file).canRefresh).toBe(true);
    expect(importer.clear()).toMatchObject({ state: 'unselected', canRefresh: false, report: null });
    expect(importer.refresh(root).state).toBe('unselected');
    importer.select(root, file);
    const moved = `${root}-moved`;
    fs.renameSync(root, moved);
    roots.push(moved);
    fs.mkdirSync(root);
    fs.copyFileSync(path.join(moved, 'usage.json'), file);
    expect(importer.refresh(root)).toMatchObject({ state: 'error', canRefresh: false, report: null });
  });

  it('withholds a file that changes during the bounded descriptor read', () => {
    const { root, file } = setup();
    const importer = new CliUsageImport();
    importer.select(root, file);
    const read = fs.readSync;
    vi.spyOn(fs, 'readSync').mockImplementation((fd, buffer, offset, length, position) => {
      const count = read(fd, buffer, offset, length, position);
      fs.appendFileSync(file, ' ');
      return count;
    });
    syncBuiltinESMExports();
    expect(importer.refresh(root)).toMatchObject({ state: 'error', report: null, diagnostic: expect.stringContaining('changed while reading') });
  });
});
