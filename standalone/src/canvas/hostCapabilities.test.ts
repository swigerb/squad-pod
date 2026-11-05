import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JoinedSession } from '@github/copilot-sdk/extension';
import type { OutboundMessage } from '../../../src/types.js';
import { createHostCapabilities } from './hostCapabilities.js';

const layout = { version: 2, cols: 1, rows: 1, tiles: [1], furniture: [] };
const content = JSON.stringify(layout, null, 2);
const denied = { ok: false, reason: 'Host capability unavailable or rejected. Outcome unconfirmed; no automatic retry.' };
let repo: string;
let root: string;
const team = (path = '.squad/agents/test-bot/charter.md') =>
  `# Team\n## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n| TestBot | Dev | ${path} | Active |\n`;
const schema = { type: 'object', properties: { scope: { enum: ['workspace', 'repo'] }, path: { type: 'string' } }, required: ['scope'] };
function fixture(rpc?: JoinedSession['rpc']) {
  const open = vi.fn<NonNullable<NonNullable<JoinedSession['rpc']>['canvas']>['open']>(
    async params => ({ canvasId: params.canvasId, instanceId: params.instanceId, extensionId: params.extensionId }));
  const list = vi.fn(async () => ({ canvases: [{ canvasId: 'editor', extensionId: 'builtin', inputSchema: schema }] }));
  const getMetrics = vi.fn(async () => ({ totalUserRequests: 7, totalPremiumRequestCost: 0.5,
    totalApiDurationMs: 120, totalNanoAiu: 0, currentModel: 'PRIVATE', codeChanges: { path: 'PRIVATE' } }));
  const createFile = vi.fn<NonNullable<NonNullable<JoinedSession['rpc']>['workspaces']>['createFile']>(async () => undefined);
  const session: JoinedSession = { sessionId: 'joined', on: () => () => {},
    rpc: rpc ?? { canvas: { open, list }, usage: { getMetrics }, workspaces: { createFile } } };
  const active = vi.fn(() => 0);
  const snapshot = vi.fn(async (): Promise<OutboundMessage[]> => [{
    type: 'existingAgents', agents: [{ id: 'test-bot', name: 'TestBot', role: 'Dev', status: 'idle',
      paletteIndex: 0, seatId: null, currentTask: null }],
  }]);
  return { open, list, getMetrics, createFile, active, snapshot, session,
    handle: createHostCapabilities(session, root, 'office', active, snapshot) };
}
beforeEach(async () => {
  repo = join(process.cwd(), `.canvas-capabilities-${randomUUID()}`);
  root = join(repo, 'nested project');
  await mkdir(join(root, '.squad', 'agents', 'test-bot'), { recursive: true });
  execFileSync('git', ['init', '--quiet', repo], { windowsHide: true });
  await writeFile(join(root, '.squad', 'team.md'), team());
  await writeFile(join(root, '.squad', 'agents', 'test-bot', 'charter.md'), '# TestBot\nDeclared charter.');
  await writeFile(join(root, 'layout.json'), content);
});
afterEach(async () => { vi.useRealTimers(); await rm(repo, { recursive: true, force: true }); });

describe('instance-owned host capabilities', () => {
  it('translates nested joined-project paths to editor repo scope only after discovering its schema', async () => {
    const f = fixture();
    expect(await f.handle({ operation: 'charter', slug: 'test-bot' }, false)).toEqual({ ok: true });
    expect(f.open).toHaveBeenCalledExactlyOnceWith({ canvasId: 'editor', extensionId: 'builtin',
      instanceId: 'squad-charter-office-test-bot', input: { scope: 'repo', path: 'nested project/.squad/agents/test-bot/charter.md' } });
    expect(f.list).toHaveBeenCalledOnce();
  });
  it.each(['../test-bot', 'test-bot/../../x', 'unknown', 'TEST-BOT', 'test-bot\\x'])('refuses non-member/path slug %s', async slug => {
    const f = fixture();
    expect(await f.handle({ operation: 'charter', slug }, false)).toEqual(denied);
    expect(f.open).not.toHaveBeenCalled();
  });
  it('requires the roster-declared charter, not just a matching directory', async () => {
    await writeFile(join(root, '.squad', 'team.md'), team('../../outside/agents/test-bot/charter.md'));
    const f = fixture();
    expect(await f.handle({ operation: 'charter', slug: 'test-bot' }, false)).toEqual(denied);
    expect(f.open).not.toHaveBeenCalled();
  });
  it('rejects changed editor schemas and ambiguous providers without opening', async () => {
    const f = fixture();
    f.list.mockResolvedValue({ canvases: [{ canvasId: 'editor', extensionId: 'builtin',
      inputSchema: { ...schema, required: ['dangerous'] } }] });
    expect(await f.handle({ operation: 'charter', slug: 'test-bot' }, false)).toEqual(denied);
    expect(f.open).not.toHaveBeenCalled();
    const second = fixture();
    second.list.mockResolvedValue({ canvases: [1, 2].map(n => ({
      canvasId: 'editor', extensionId: `provider-${n}`, inputSchema: schema,
    })) });
    expect(await second.handle({ operation: 'charter', slug: 'test-bot' }, false)).toEqual(denied);
    expect(second.open).not.toHaveBeenCalled();
  });
  it('rejects symlink escapes for charters and JSON without reading the target', async () => {
    const outside = join(repo, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'charter.md'), '# Private');
    await writeFile(join(outside, 'layout.json'), content);
    await rm(join(root, '.squad', 'agents', 'test-bot'), { recursive: true });
    await symlink(outside, join(root, '.squad', 'agents', 'test-bot'), process.platform === 'win32' ? 'junction' : 'dir');
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const f = fixture();
    expect(await f.handle({ operation: 'charter', slug: 'test-bot' }, false)).toEqual(denied);
    expect(await f.handle({ operation: 'import', path: 'linked/layout.json' }, true)).toEqual(denied);
    expect(f.open).not.toHaveBeenCalled();
  });
  it('supports .ai-team only when .squad is absent', async () => {
    await rm(join(root, '.squad'), { recursive: true });
    await mkdir(join(root, '.ai-team', 'agents', 'test-bot'), { recursive: true });
    await writeFile(join(root, '.ai-team', 'team.md'), team('.ai-team/agents/test-bot/charter.md'));
    await writeFile(join(root, '.ai-team', 'agents', 'test-bot', 'charter.md'), '# TestBot');
    const f = fixture();
    expect(await f.handle({ operation: 'charter', slug: 'test-bot' }, false)).toEqual({ ok: true });
    expect(f.open.mock.calls[0][0].input.path).toBe('nested project/.ai-team/agents/test-bot/charter.md');
  });
  it('projects only supplied finite nonnegative session quantities with units, never missing as zero', async () => {
    const f = fixture();
    expect(await f.handle({ operation: 'usage' }, false)).toEqual({ ok: true, quantities: [
      { label: 'User-initiated API requests', value: 7, unit: 'requests' },
      { label: 'Premium-request cost (multiplier applied)', value: 0.5, unit: 'premium requests' },
      { label: 'API time', value: 120, unit: 'ms' },
      { label: 'AI usage', value: 0, unit: 'nano-AI units' },
    ] });
    const partial = fixture({ usage: { getMetrics: async () => ({ totalUserRequests: 0,
      totalApiDurationMs: -1, totalNanoAiu: NaN, totalPremiumRequestCost: '5' }) } });
    expect(await partial.handle({ operation: 'usage' }, false)).toEqual({ ok: true, quantities: [
      { label: 'User-initiated API requests', value: 0, unit: 'requests' },
    ] });
    expect(await fixture({ usage: { getMetrics: async () => ({}) } }).handle({ operation: 'usage' }, false))
      .toEqual({ ok: true, quantities: [] });
  });
  it('detects missing methods and sanitizes rejected RPCs, disabling the path without automatic retry', async () => {
    const absent = fixture({});
    expect(absent.handle.available!()).toEqual({ charter: false, usage: false, export: false });
    expect(await absent.handle({ operation: 'usage' }, false)).toEqual(denied);
    const f = fixture();
    f.getMetrics.mockRejectedValue(new Error('SECRET C:\\private'));
    expect(await f.handle({ operation: 'usage' }, false)).toEqual(denied);
    expect(await f.handle({ operation: 'usage' }, false)).toEqual(denied);
    expect(f.getMetrics).toHaveBeenCalledOnce();
    expect(f.handle.available!().usage).toBe(false);
  });
  it('bounds a never-settling usage RPC, releases unrelated import and ignores late metrics', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let resolve!: (value: Awaited<ReturnType<typeof f.getMetrics>>) => void;
    f.getMetrics.mockImplementation(() => new Promise(done => { resolve = done; }));
    const result = f.handle({ operation: 'usage' }, false);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toEqual(denied);
    expect(f.handle.available!().usage).toBe(false);
    expect(await f.handle({ operation: 'import', path: 'layout.json' }, true)).toEqual({ ok: true, layout });
    resolve({ totalUserRequests: 7, totalPremiumRequestCost: 0.5, totalApiDurationMs: 120, totalNanoAiu: 0,
      currentModel: 'PRIVATE', codeChanges: { path: 'PRIVATE' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toEqual(denied);
    expect(await f.handle({ operation: 'usage' }, false)).toEqual(denied);
    expect(f.getMetrics).toHaveBeenCalledOnce();
  });
  it('quarantines a timed-out export without claiming cancellation, retrying or blocking imports', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let settle!: () => void;
    f.createFile.mockImplementation(() => new Promise<void>(resolve => { settle = resolve; }));
    const result = f.handle({ operation: 'export', content }, true);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toEqual(denied);
    expect((await result).ok).toBe(false);
    expect(f.handle.available!().export).toBe(false);
    expect(await f.handle({ operation: 'import', path: 'layout.json' }, true)).toEqual({ ok: true, layout });
    settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toEqual(denied);
    expect(await f.handle({ operation: 'export', content }, true)).toEqual(denied);
    expect(f.createFile).toHaveBeenCalledOnce();
  });
  it('exports exact validated JSON to a generated session-workspace filename only after editing opt-in', async () => {
    const f = fixture();
    const result = await f.handle({ operation: 'export', content }, true);
    expect(result).toEqual({ ok: true, path: expect.stringMatching(/^squad-pod-layout-[a-f0-9-]{36}\.json$/) });
    expect(f.createFile).toHaveBeenCalledExactlyOnceWith({ path: result.ok ? result.path : '', content });
    const readOnly = fixture();
    expect(await readOnly.handle({ operation: 'export', content }, false)).toEqual(denied);
    expect(readOnly.createFile).not.toHaveBeenCalled();
  });
  it('keeps 2 MiB and layout-schema limits on imports and exports, with no writes or draft save', async () => {
    for (const invalid of ['{"cols":0}', 'not JSON', ' '.repeat(2 * 1024 * 1024 + 1)]) {
      const f = fixture();
      expect(await f.handle({ operation: 'export', content: invalid }, true)).toEqual(denied);
      expect(f.createFile).not.toHaveBeenCalled();
      await writeFile(join(root, 'invalid.json'), invalid);
      expect(await f.handle({ operation: 'import', path: 'invalid.json' }, true)).toEqual(denied);
    }
    expect(await fixture().handle({ operation: 'import', path: 'layout.json' }, true)).toEqual({ ok: true, layout });
    expect(await fixture().handle({ operation: 'import', path: 'layout.json' }, false)).toEqual(denied);
    const boundary = content.padEnd(2 * 1024 * 1024, ' ');
    const f = fixture();
    expect((await f.handle({ operation: 'export', content: boundary }, true)).ok).toBe(true);
    expect(f.createFile).toHaveBeenCalledWith({ path: expect.any(String), content: boundary });
    await writeFile(join(root, 'boundary.json'), boundary);
    expect(await f.handle({ operation: 'import', path: 'boundary.json' }, true)).toEqual({ ok: true, layout });
  });
  it('requires a matching open result and revalidates authority after awaited host calls', async () => {
    const f = fixture();
    f.open.mockResolvedValue({ canvasId: 'editor', extensionId: 'foreign', instanceId: 'foreign' });
    expect(await f.handle({ operation: 'charter', slug: 'test-bot' }, false)).toEqual(denied);
    expect(f.handle.available!().charter).toBe(false);
    const revoked = fixture();
    revoked.getMetrics.mockImplementation(async () => {
      revoked.active.mockImplementation(() => { throw new Error('revoked'); });
      return { totalUserRequests: 7, totalPremiumRequestCost: 0.5, totalApiDurationMs: 120, totalNanoAiu: 0, currentModel: 'PRIVATE', codeChanges: { path: 'PRIVATE' } };
    });
    expect(await revoked.handle({ operation: 'usage' }, false)).toEqual(denied);
    const reopened = fixture();
    reopened.getMetrics.mockImplementation(async () => {
      reopened.active.mockReturnValue(1);
      return { totalUserRequests: 7, totalPremiumRequestCost: 0.5, totalApiDurationMs: 120, totalNanoAiu: 0, currentModel: 'PRIVATE', codeChanges: { path: 'PRIVATE' } };
    });
    expect(await reopened.handle({ operation: 'usage' }, false)).toEqual(denied);
  });
  it.each(['../layout.json', '/layout.json', 'C:/layout.json', 'nested/../layout.json',
    '\\\\host\\share\\layout.json', '.git/config', 'layout.json:stream', './layout.json'])('rejects import path %s', async path => {
    expect(await fixture().handle({ operation: 'import', path }, true)).toEqual(denied);
  });
  it('rejects extra authority and revoked instances before invoking RPCs', async () => {
    const f = fixture();
    expect(await f.handle({ operation: 'usage', sessionId: 'foreign' }, false)).toEqual(denied);
    f.active.mockImplementation(() => { throw new Error('revoked'); });
    expect(await f.handle({ operation: 'export', content }, true)).toEqual(denied);
    expect(f.getMetrics).not.toHaveBeenCalled();
    expect(f.createFile).not.toHaveBeenCalled();
  });
});
