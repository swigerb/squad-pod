import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasContext, CanvasDefinition, JoinedSession } from '@github/copilot-sdk/extension';
import type { OutboundMessage } from '../../../src/types.js';
import { startCanvasOfficeHost, type CanvasOfficeHost } from './officeHost.js';
import { startOfficeExtension } from './provider.js';
import { officeState } from './readActions.js';
import { CanvasReadiness } from './readiness.js';

vi.mock('./officeHost.js', () => ({ startCanvasOfficeHost: vi.fn() }));
class CanvasError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
const paths = { staticRoot: 'fixed-canvas-bundle', bundledAssetsRoot: 'fixed-assets' };
const ctx = (input?: unknown, instanceId = 'office'): CanvasContext => ({
  sessionId: 'joined-session', extensionId: 'provider', canvasId: 'squad-pod', instanceId, input,
});
const roots: string[] = [];
const providers: Array<Awaited<ReturnType<typeof startOfficeExtension>>> = [];
let root: string;
let other: string;
let hosts: Array<CanvasOfficeHost & { dispose: ReturnType<typeof vi.fn> }>;
function messages(): OutboundMessage[] {
  return [
    { type: 'existingAgents', agents: [{ id: 'lisa', name: 'Lisa', role: 'Developer',
      status: 'idle', paletteIndex: 0, seatId: null, currentTask: null }] },
    { type: 'sourceStatus', status: { workspaceRoot: root, squadDir: join(root, '.squad'),
      teamFound: true, observer: 'watching', nativeWatch: false, error: 'private-path-and-diagnostic' } },
    { type: 'layoutLoaded', layout: { version: 2, cols: 2, rows: 1, tiles: [1, 1], furniture: [] } },
  ];
}
async function fixture(rpc: JoinedSession['rpc'] = {
  metadata: { snapshot: vi.fn(async () => ({ sessionId: 'joined-session', workingDirectory: root })) },
}) {
  const lifecycle = new EventEmitter();
  let event: Parameters<JoinedSession['on']>[0] | undefined;
  const unsubscribe = vi.fn();
  const session: JoinedSession = {
    sessionId: 'joined-session', rpc, on: vi.fn(callback => { event = callback; return unsubscribe; }),
  };
  const sdk = {
    CanvasError, createCanvas: vi.fn((definition: CanvasDefinition) => definition),
    joinSession: vi.fn(async () => session),
  };
  const provider = await startOfficeExtension(sdk, paths, lifecycle as unknown as NodeJS.Process);
  providers.push(provider);
  return { ...provider, sdk, session, lifecycle, unsubscribe,
    event: (type: string, data?: unknown) => event!({ type, data }) };
}
function action(canvas: CanvasDefinition, name: string, input?: unknown, context = ctx()) {
  return canvas.actions.find(candidate => candidate.name === name)!.handler({
    ...context, actionName: name, input,
  });
}
beforeEach(async () => {
  root = join(process.cwd(), `.canvas-provider-test-${randomUUID()}`);
  other = join(root, 'other');
  roots.push(root);
  await mkdir(join(root, '.squad', 'agents', 'lisa'), { recursive: true });
  await mkdir(other);
  await writeFile(join(root, '.squad', 'team.md'),
    '# Team\n## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n| Lisa | Developer | .squad/agents/lisa/charter.md | Active |\n');
  hosts = [];
  vi.mocked(startCanvasOfficeHost).mockImplementation(async () => {
    const host = { url: `http://127.0.0.1:${10000 + hosts.length}/#c=secret`, snapshot: vi.fn(async () => messages()),
      dispose: vi.fn(async () => undefined), acceptActivity: vi.fn(), clearActivity: vi.fn() };
    hosts.push(host);
    return host;
  });
});
afterEach(async () => {
  await Promise.all(providers.splice(0).map(provider => provider.dispose().catch(() => undefined)));
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(startCanvasOfficeHost).mockReset();
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('host-injected Canvas provider', () => {
  it('returns unknown drawing until reported and projects evidence only for the authorized instance', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    await f.canvas.open(ctx(undefined, 'second'));
    const paint = { firstPaintTime: 123, frameCount: 1, width: 800, height: 600,
      visibilityState: 'visible' as const, onScreen: true };
    hosts[0].rendered = vi.fn(() => paint);
    expect(await action(f.canvas, 'get_office_state')).toMatchObject({ rendering: { firstFrame: paint } });
    expect(await action(f.canvas, 'get_office_state', {}, ctx(undefined, 'second')))
      .toMatchObject({ rendering: { firstFrame: null } });
  });

  it('returns SDK image results from only the exact authorized instance without granting write/control access', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    await f.canvas.open(ctx(undefined, 'second'));
    const first = vi.fn(async () => 'first-png'), second = vi.fn(async () => 'second-png');
    hosts[0].capture = first; hosts[1].capture = second;
    for (const context of [{ ...ctx(), sessionId: 'foreign' }, { ...ctx(), extensionId: 'foreign' },
      { ...ctx(), canvasId: 'foreign' }, ctx(undefined, 'absent')]) {
      await expect(action(f.canvas, 'get_office_snapshot', {}, context)).rejects.toThrow();
    }
    await expect(action(f.canvas, 'get_office_snapshot', { projectRoot: other })).rejects.toThrow();
    await expect(action(f.canvas, 'get_office_snapshot', { enableEditing: true })).rejects.toThrow();
    expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
    expect(await action(f.canvas, 'get_office_snapshot')).toEqual({
      resultType: 'success',
      textResultForLlm: expect.stringContaining('not compositor visibility or native acceptance'),
      binaryResultsForLlm: [{ type: 'image', mimeType: 'image/png', data: 'first-png' }],
    });
    expect(await action(f.canvas, 'get_office_snapshot', {}, ctx(undefined, 'second')))
      .toMatchObject({ binaryResultsForLlm: [{ data: 'second-png' }] });
    expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
    await f.canvas.onClose(ctx());
    await expect(action(f.canvas, 'get_office_snapshot')).rejects.toThrow();
    expect(first).toHaveBeenCalledOnce();
  });

  it('sanitizes capture errors and withholds results after close, reopen or context revocation', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    hosts[0].capture = vi.fn(async () => { throw new Error('private-path credential raw PNG'); });
    await expect(action(f.canvas, 'get_office_snapshot')).rejects.toMatchObject({
      code: 'canvas_snapshot_unavailable', message: 'Squad Pod Canvas authority or resource unavailable',
    });
    for (const revoke of [
      () => f.canvas.onClose(ctx()), () => f.canvas.open(ctx()),
      () => { f.event('session.context_changed'); },
    ]) {
      await f.canvas.open(ctx());
      let resolve!: (value: string) => void;
      hosts[hosts.length - 1].capture = () => new Promise(accept => { resolve = accept; });
      const read = action(f.canvas, 'get_office_snapshot');
      await revoke();
      resolve('private-stale-image');
      await expect(read).rejects.toThrow();
    }
  });

  it('reads readiness only after state-action authority and input validation, never for member details', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    const snapshot = new CanvasReadiness().snapshot();
    const readiness = vi.fn(() => snapshot);
    hosts[0].readiness = readiness;
    for (const context of [{ ...ctx(), sessionId: 'foreign' }, { ...ctx(), extensionId: 'foreign' },
      ctx(undefined, 'absent')]) await expect(action(f.canvas, 'get_office_state', {}, context)).rejects.toThrow();
    await expect(action(f.canvas, 'get_office_state', { extra: 'SECRET' })).rejects.toThrow();
    await action(f.canvas, 'get_member_details', { slug: 'lisa' });
    expect(readiness).not.toHaveBeenCalled();
    expect(await action(f.canvas, 'get_office_state')).toEqual(officeState(messages(), snapshot));
    expect(readiness).toHaveBeenCalledOnce();
    readiness.mockClear();
    await f.canvas.onClose(ctx());
    await expect(action(f.canvas, 'get_office_state')).rejects.toThrow();
    expect(readiness).not.toHaveBeenCalled();
  });

  it('joins once, declares exactly three read-only actions, and starts only the authoritative root', async () => {
    const f = await fixture();
    expect(f.sdk.joinSession).toHaveBeenCalledExactlyOnceWith({ canvases: [f.canvas] });
    expect(f.sdk.createCanvas).toHaveBeenCalledOnce();
    expect(f.canvas).toMatchObject({ id: 'squad-pod', displayName: 'Squad Pod',
      inputSchema: { additionalProperties: false, properties: { projectRoot: { maxLength: 4096 } } } });
    expect(f.canvas.actions.map(value => value.name)).toEqual(['get_office_state', 'get_member_details', 'get_office_snapshot']);
    expect(f.canvas.actions[1].inputSchema).toMatchObject({ required: ['slug'], additionalProperties: false });
    expect(startCanvasOfficeHost).not.toHaveBeenCalled();
    const opened = await f.canvas.open(ctx());
    expect(opened).toEqual({ title: 'Squad Pod', url: hosts[0].url });
    expect(startCanvasOfficeHost).toHaveBeenCalledExactlyOnceWith({ ...paths, projectRoot: root, sessionId: 'joined-session' });
  });

  it('accepts a canonical alias but rejects an arbitrary projectRoot before startup', async () => {
    const alias = join(root, 'alias');
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const f = await fixture();
    await f.canvas.open(ctx({ projectRoot: alias }));
    await expect(f.canvas.open(ctx({ projectRoot: other }, 'other'))).rejects.toMatchObject({
      code: 'canvas_root_mismatch',
    });
    expect(startCanvasOfficeHost).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing', {}, 'canvas_metadata_missing'],
    ['malformed', { metadata: { snapshot: async () => null } }, 'canvas_metadata_mismatch'],
    ['session mismatch', { metadata: { snapshot: async () => ({ sessionId: 'other', workingDirectory: root }) } }, 'canvas_metadata_mismatch'],
    ['workspace fallback', { metadata: { snapshot: async () => ({ sessionId: 'joined-session', cwd: root, workspacePath: root }) } }, 'canvas_root_unavailable'],
    ['relative', { metadata: { snapshot: async () => ({ sessionId: 'joined-session', workingDirectory: '.' }) } }, 'canvas_root_unavailable'],
    ['remote', { metadata: { snapshot: async () => ({ sessionId: 'joined-session', workingDirectory: '\\\\server\\share' }) } }, 'canvas_root_unavailable'],
    ['rejection', { metadata: { snapshot: async () => { throw new Error('private data'); } } }, 'canvas_metadata_rejected'],
    ['throw', { metadata: { snapshot: () => { throw new Error('private data'); } } }, 'canvas_metadata_rejected'],
  ])('fails closed with sanitized diagnostics for %s metadata', async (_label, rpc, code) => {
    const f = await fixture(rpc as JoinedSession['rpc']);
    await expect(f.canvas.open(ctx())).rejects.toMatchObject({
      code, message: 'Squad Pod Canvas authority or resource unavailable',
    });
    expect(startCanvasOfficeHost).not.toHaveBeenCalled();
  });

  it('does not trust caller session/root hints and rejects invalid context/input', async () => {
    const f = await fixture();
    for (const context of [
      { ...ctx(), sessionId: 'other' }, { ...ctx(), canvasId: 'other' },
      { ...ctx(), instanceId: undefined }, { ...ctx(), instanceId: '../office' },
      { ...ctx(), extensionId: '' }, ctx(null), ctx({ root }), ctx({ projectRoot: null }),
    ]) await expect(f.canvas.open(context as CanvasContext)).rejects.toBeInstanceOf(CanvasError);
    expect(startCanvasOfficeHost).not.toHaveBeenCalled();
  });

  it('times out at one second and holds four outstanding slots until actual settlement', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const resolves: Array<(value: unknown) => void> = [];
    const snapshot = vi.fn(() => new Promise<unknown>(resolve => { resolves.push(resolve); }));
    const f = await fixture({ metadata: { snapshot } });
    for (let i = 0; i < 4; i++) {
      const rejected = expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_metadata_deadline' });
      await vi.advanceTimersByTimeAsync(1000);
      await rejected;
    }
    await expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_metadata_limit' });
    expect(snapshot).toHaveBeenCalledTimes(4);
    resolves[0]({ sessionId: 'joined-session', workingDirectory: root });
    await vi.advanceTimersByTimeAsync(0);
    expect(startCanvasOfficeHost).not.toHaveBeenCalled();
    const opened = f.canvas.open(ctx());
    await vi.advanceTimersByTimeAsync(0);
    resolves[4]({ sessionId: 'joined-session', workingDirectory: root });
    await opened;
    for (const resolve of resolves.slice(1, 4)) resolve({ sessionId: 'wrong', workingDirectory: other });
    expect(startCanvasOfficeHost).toHaveBeenCalledTimes(1);
  });

  it('focuses an existing instance with the same URL and fresh independent authority', async () => {
    const f = await fixture();
    const first = await f.canvas.open(ctx());
    expect(await f.canvas.open(ctx({ projectRoot: root }))).toEqual(first);
    expect(startCanvasOfficeHost).toHaveBeenCalledTimes(1);
    expect(f.session.rpc!.metadata!.snapshot).toHaveBeenCalledTimes(2);
    await expect(f.canvas.open({ ...ctx(), extensionId: 'another-provider' }))
      .rejects.toMatchObject({ code: 'canvas_provider_mismatch' });
    expect(hosts[0].dispose).not.toHaveBeenCalled();
  });

  it('revokes an existing office when reopen metadata changes root', async () => {
    const snapshot = vi.fn(async () => ({ sessionId: 'joined-session', workingDirectory: root }));
    const f = await fixture({ metadata: { snapshot } });
    await f.canvas.open(ctx());
    snapshot.mockResolvedValue({ sessionId: 'joined-session', workingDirectory: other });
    await expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_root_changed' });
    expect(hosts[0].dispose).toHaveBeenCalledOnce();
    await expect(action(f.canvas, 'get_office_state')).rejects.toMatchObject({ code: 'canvas_instance_unavailable' });
  });

  it('blocks actions during renewed metadata authority and disposes on rejection', async () => {
    let reject!: (error: Error) => void;
    const snapshot = vi.fn().mockResolvedValueOnce({ sessionId: 'joined-session', workingDirectory: root })
      .mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const f = await fixture({ metadata: { snapshot } });
    await f.canvas.open(ctx());
    const reopened = expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_metadata_rejected' });
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(2));
    await expect(action(f.canvas, 'get_office_state')).rejects.toMatchObject({ code: 'canvas_instance_unavailable' });
    expect(hosts[0].snapshot).not.toHaveBeenCalled();
    reject(new Error('private authority failure'));
    await reopened;
    expect(hosts[0].dispose).toHaveBeenCalledOnce();
  });

  it.each(['reject', 'changed root', 'same root'])(
    'does not revoke or block a replacement when stale reopen metadata settles: %s', async settlement => {
      let resolve!: (value: unknown) => void;
      let reject!: (error: Error) => void;
      const snapshot = vi.fn().mockResolvedValueOnce({ sessionId: 'joined-session', workingDirectory: root })
        .mockImplementationOnce(() => new Promise((ok, fail) => { resolve = ok; reject = fail; }))
        .mockResolvedValue({ sessionId: 'joined-session', workingDirectory: root });
      const f = await fixture({ metadata: { snapshot } });
      const first = await f.canvas.open(ctx());
      const stale = expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_closed' });
      await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(2));
      expect(await f.canvas.open(ctx())).toEqual(first);
      expect(await action(f.canvas, 'get_office_state')).toEqual(officeState(messages()));
      expect(hosts[0].dispose).not.toHaveBeenCalled();
      if (settlement === 'reject') reject(new Error('private authority failure'));
      else resolve({ sessionId: 'joined-session', workingDirectory: settlement === 'same root' ? root : other });
      await stale;
      expect(await action(f.canvas, 'get_office_state')).toEqual(officeState(messages()));
      expect(hosts[0].dispose).not.toHaveBeenCalled();
      expect(startCanvasOfficeHost).toHaveBeenCalledTimes(1);
      expect(snapshot).toHaveBeenCalledTimes(3);
      await f.canvas.onClose(ctx());
      expect(hosts[0].dispose).toHaveBeenCalledOnce();
    },
  );

  it('does not make the newest initial open wait for stale metadata or revoke it on stale rejection', async () => {
    let reject!: (error: Error) => void;
    const snapshot = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }))
      .mockResolvedValue({ sessionId: 'joined-session', workingDirectory: root });
    const f = await fixture({ metadata: { snapshot } });
    const stale = expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_closed' });
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledOnce());
    const replacement = await f.canvas.open(ctx());
    expect(replacement.url).toBe(hosts[0].url);
    expect(await action(f.canvas, 'get_office_state')).toEqual(officeState(messages()));
    reject(new Error('private stale metadata'));
    await stale;
    expect(await action(f.canvas, 'get_office_state')).toEqual(officeState(messages()));
    expect(hosts[0].dispose).not.toHaveBeenCalled();
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(startCanvasOfficeHost).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'])('keeps the newest reopen blocked when older authority settles first: %s', async mode => {
    const pending: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = [];
    const snapshot = vi.fn().mockResolvedValueOnce({ sessionId: 'joined-session', workingDirectory: root })
      .mockImplementation(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }); }));
    const f = await fixture({ metadata: { snapshot } });
    const first = await f.canvas.open(ctx());
    const stale = expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_closed' });
    const latest = f.canvas.open(ctx());
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(3));
    if (mode === 'resolve') pending[0].resolve({ sessionId: 'joined-session', workingDirectory: root });
    else pending[0].reject(new Error('private stale authority'));
    await stale;
    await expect(action(f.canvas, 'get_office_state')).rejects.toMatchObject({ code: 'canvas_instance_unavailable' });
    expect(hosts[0].dispose).not.toHaveBeenCalled();
    expect(hosts[0].snapshot).not.toHaveBeenCalled();
    pending[1].resolve({ sessionId: 'joined-session', workingDirectory: root });
    expect(await latest).toEqual(first);
    expect(await action(f.canvas, 'get_office_state')).toEqual(officeState(messages()));
    expect(hosts[0].dispose).not.toHaveBeenCalled();
    expect(startCanvasOfficeHost).toHaveBeenCalledOnce();
  });

  it('keeps the newest failure closed when older reopen authority later succeeds', async () => {
    let resolve!: (value: unknown) => void;
    const snapshot = vi.fn().mockResolvedValueOnce({ sessionId: 'joined-session', workingDirectory: root })
      .mockImplementationOnce(() => new Promise(ok => { resolve = ok; }))
      .mockRejectedValueOnce(new Error('private newest failure'));
    const f = await fixture({ metadata: { snapshot } });
    await f.canvas.open(ctx());
    const stale = expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_closed' });
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(2));
    await expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_metadata_rejected' });
    expect(hosts[0].dispose).toHaveBeenCalledOnce();
    resolve({ sessionId: 'joined-session', workingDirectory: root });
    await stale;
    await expect(action(f.canvas, 'get_office_state')).rejects.toMatchObject({ code: 'canvas_instance_unavailable' });
    expect(hosts[0].snapshot).not.toHaveBeenCalled();
    expect(hosts[0].dispose).toHaveBeenCalledOnce();
    expect(startCanvasOfficeHost).toHaveBeenCalledOnce();
  });

  it('shares pending host startup without giving stale opens authority over the latest generation', async () => {
    let finish!: (host: CanvasOfficeHost) => void;
    vi.mocked(startCanvasOfficeHost).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const f = await fixture();
    const stale = expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_closed' });
    await vi.waitFor(() => expect(startCanvasOfficeHost).toHaveBeenCalledOnce());
    const latest = f.canvas.open(ctx());
    await vi.waitFor(() => expect(f.session.rpc!.metadata!.snapshot).toHaveBeenCalledTimes(2));
    const host = { url: 'http://127.0.0.1/', snapshot: vi.fn(async () => messages()),
      dispose: vi.fn(async () => undefined) };
    finish(host);
    await stale;
    expect(await latest).toEqual({ title: 'Squad Pod', url: host.url });
    expect(await action(f.canvas, 'get_office_state')).toEqual(officeState(messages()));
    expect(host.dispose).not.toHaveBeenCalled();
    expect(startCanvasOfficeHost).toHaveBeenCalledOnce();
    await f.dispose();
    expect(host.dispose).toHaveBeenCalledOnce();
  });

  it.each(['close', 'shutdown'])('cancels overlapping reopen ownership on %s', async mode => {
    const resolves: Array<(value: unknown) => void> = [];
    const snapshot = vi.fn().mockResolvedValueOnce({ sessionId: 'joined-session', workingDirectory: root })
      .mockImplementation(() => new Promise(resolve => { resolves.push(resolve); }));
    const f = await fixture({ metadata: { snapshot } });
    await f.canvas.open(ctx());
    const code = mode === 'close' ? 'canvas_closed' : 'canvas_unavailable';
    const stale = expect(f.canvas.open(ctx())).rejects.toMatchObject({ code });
    const latest = expect(f.canvas.open(ctx())).rejects.toMatchObject({ code });
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(3));
    if (mode === 'close') await f.canvas.onClose(ctx());
    else await f.dispose();
    expect(hosts[0].dispose).toHaveBeenCalledOnce();
    for (const resolve of resolves) resolve({ sessionId: 'joined-session', workingDirectory: root });
    await stale; await latest;
    await expect(action(f.canvas, 'get_office_state')).rejects.toBeInstanceOf(CanvasError);
    expect(hosts[0].snapshot).not.toHaveBeenCalled();
    expect(hosts[0].dispose).toHaveBeenCalledOnce();
    expect(startCanvasOfficeHost).toHaveBeenCalledOnce();
  });

  it('does not return an action snapshot authorized by a superseded generation', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    let finish!: (value: OutboundMessage[]) => void;
    vi.mocked(hosts[0].snapshot).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = expect(action(f.canvas, 'get_office_state')).rejects.toMatchObject({ code: 'canvas_closed' });
    await f.canvas.open(ctx());
    finish(messages());
    await old;
    expect(await action(f.canvas, 'get_office_state')).toEqual(officeState(messages()));
    expect(hosts[0].dispose).not.toHaveBeenCalled();
  });

  it('bounds retained instances to four and frees a closed slot', async () => {
    const f = await fixture();
    for (let i = 0; i < 4; i++) await f.canvas.open(ctx(undefined, `office-${i}`));
    await expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_instance_limit' });
    expect(startCanvasOfficeHost).toHaveBeenCalledTimes(4);
    await f.canvas.onClose(ctx(undefined, 'office-0'));
    await f.canvas.open(ctx());
    expect(startCanvasOfficeHost).toHaveBeenCalledTimes(5);
  });

  it('isolates instances and disposes close exactly once without touching joined session', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    await f.canvas.open(ctx(undefined, 'second'));
    await f.canvas.onClose(ctx());
    await f.canvas.onClose(ctx());
    expect(hosts[0].dispose).toHaveBeenCalledOnce();
    expect(hosts[1].dispose).not.toHaveBeenCalled();
    await expect(action(f.canvas, 'get_office_state')).rejects.toMatchObject({ code: 'canvas_instance_unavailable' });
    await f.dispose();
    await f.dispose();
    expect(hosts[1].dispose).toHaveBeenCalledOnce();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    expect(Object.keys(f.session).sort()).toEqual(['on', 'rpc', 'sessionId']);
  });

  it.each(['disconnect', 'SIGTERM', 'SIGINT'])('cleans all owned resources on %s', async signal => {
    const f = await fixture();
    await f.canvas.open(ctx());
    f.lifecycle.emit(signal);
    await f.dispose();
    expect(hosts[0].dispose).toHaveBeenCalledOnce();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    expect(f.lifecycle.eventNames()).toEqual([]);
    await expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_unavailable' });
  });

  it('subscribes once, fans out only to open offices, and baselines each reopen', async () => {
    const f = await fixture();
    f.event('assistant.turn_start');
    await f.canvas.open(ctx());
    await f.canvas.open(ctx(undefined, 'second'));
    expect(f.session.on).toHaveBeenCalledOnce();
    const event = { type: 'tool.execution_start', data: { toolCallId: 'call', toolName: 'view' } };
    f.event(event.type, event.data);
    for (const host of hosts) expect(host.acceptActivity).toHaveBeenCalledExactlyOnceWith(event);
    await f.canvas.open(ctx());
    expect(hosts[0].clearActivity).toHaveBeenCalledOnce();
    const closed = hosts[0];
    await f.canvas.onClose(ctx());
    f.event('session.idle');
    expect(closed.acceptActivity).toHaveBeenCalledTimes(1);
    expect(hosts[1].acceptActivity).toHaveBeenCalledTimes(2);
  });

  it('revokes context immediately but keeps the subscription for a newly authorized project', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    await f.canvas.open(ctx(undefined, 'second'));
    f.event('session.context_changed');
    for (const host of hosts) {
      expect(host.clearActivity).toHaveBeenCalledOnce();
      expect(host.dispose).toHaveBeenCalledOnce();
    }
    await expect(action(f.canvas, 'get_office_state')).rejects.toMatchObject({ code: 'canvas_instance_unavailable' });
    expect(f.unsubscribe).not.toHaveBeenCalled();
    vi.mocked(f.session.rpc!.metadata!.snapshot).mockResolvedValue({
      sessionId: 'joined-session', workingDirectory: other,
    });
    await f.canvas.open(ctx());
    expect(startCanvasOfficeHost).toHaveBeenLastCalledWith({
      ...paths, projectRoot: other, sessionId: 'joined-session',
    });
    expect(f.session.on).toHaveBeenCalledOnce();
  });

  it('clears immediately on joined session identity replacement and rejects stale authority', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    f.session.sessionId = 'replacement';
    f.event('assistant.turn_start');
    expect(hosts[0].clearActivity).toHaveBeenCalledOnce();
    expect(hosts[0].dispose).toHaveBeenCalledOnce();
    await expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_session_mismatch' });
  });

  it('revokes replaced identity on validation even before another SDK event arrives', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    f.session.sessionId = 'replacement';
    await expect(action(f.canvas, 'get_office_state')).rejects.toMatchObject({ code: 'canvas_session_mismatch' });
    expect(hosts[0].clearActivity).toHaveBeenCalledOnce();
    expect(hosts[0].dispose).toHaveBeenCalledOnce();
  });

  it('clears root session shutdown immediately and never reuses a terminal session', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    f.event('session.shutdown');
    expect(hosts[0].clearActivity).toHaveBeenCalledOnce();
    expect(hosts[0].dispose).toHaveBeenCalledOnce();
    await expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_unavailable' });
  });

  it('does not start a closed pending open or erase a replacement when late metadata settles', async () => {
    let resolve!: (value: unknown) => void;
    const snapshot = vi.fn().mockImplementationOnce(() => new Promise(value => { resolve = value; }))
      .mockResolvedValue({ sessionId: 'joined-session', workingDirectory: root });
    const f = await fixture({ metadata: { snapshot } });
    const old = expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_closed' });
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(1));
    const closing = f.canvas.onClose(ctx());
    const replacement = await f.canvas.open(ctx());
    resolve({ sessionId: 'joined-session', workingDirectory: root });
    await old; await closing;
    expect((await f.canvas.open(ctx())).url).toBe(replacement.url);
    expect(startCanvasOfficeHost).toHaveBeenCalledTimes(1);
    expect(hosts[0].dispose).not.toHaveBeenCalled();
  });

  it('cleans a host created after close while startup was pending', async () => {
    let finish!: (host: CanvasOfficeHost) => void;
    vi.mocked(startCanvasOfficeHost).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const f = await fixture();
    const opened = expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_closed' });
    await vi.waitFor(() => expect(startCanvasOfficeHost).toHaveBeenCalledOnce());
    const closing = f.canvas.onClose(ctx());
    const dispose = vi.fn(async () => undefined);
    finish({ url: 'http://127.0.0.1/', snapshot: async () => [], dispose });
    await opened; await closing;
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('does not start an office after disposal while metadata was pending', async () => {
    let resolve!: (value: unknown) => void;
    const snapshot = vi.fn(() => new Promise<unknown>(value => { resolve = value; }));
    const f = await fixture({ metadata: { snapshot } });
    const opened = expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_unavailable' });
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledOnce());
    const disposal = f.dispose();
    resolve({ sessionId: 'joined-session', workingDirectory: root });
    await opened; await disposal;
    expect(startCanvasOfficeHost).not.toHaveBeenCalled();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
  });

  it('revokes pending action results on close and refuses root replacement before reading', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    let finish!: (messages: OutboundMessage[]) => void;
    vi.mocked(hosts[0].snapshot).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = expect(action(f.canvas, 'get_office_state')).rejects.toMatchObject({ code: 'canvas_closed' });
    await f.canvas.onClose(ctx());
    finish(messages());
    await pending;
    await f.canvas.open(ctx());
    const displaced = root + '-displaced';
    roots.push(displaced);
    await rename(root, displaced);
    await mkdir(root);
    await expect(action(f.canvas, 'get_office_state')).rejects.toMatchObject({ code: 'canvas_root_changed' });
    expect(hosts[1].snapshot).not.toHaveBeenCalled();
  });

  it('sanitizes startup and cleanup failures and releases failed-open slots', async () => {
    vi.mocked(startCanvasOfficeHost).mockRejectedValueOnce(new Error(`private ${root}`));
    const f = await fixture();
    await expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_open_failed' });
    await f.canvas.open(ctx());
    hosts[0].dispose.mockRejectedValueOnce(new Error(`private ${root}`));
    await expect(f.canvas.onClose(ctx())).rejects.toMatchObject({
      code: 'canvas_disposal_failed', message: 'Squad Pod Canvas authority or resource unavailable',
    });
    await expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_unavailable' });
  });

  it('handles reentrant unsubscribe once and continues cleanup after an unsubscribe failure', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    f.unsubscribe.mockImplementation(() => {
      f.event('session.context_changed');
      throw new Error('private unsubscribe failure');
    });
    await expect(f.dispose()).rejects.toMatchObject({ code: 'canvas_disposal_failed' });
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    expect(hosts[0].dispose).toHaveBeenCalledOnce();
    expect(f.lifecycle.eventNames()).toEqual([]);
    await expect(f.canvas.open(ctx())).rejects.toMatchObject({ code: 'canvas_unavailable' });
  });

  it('returns bounded sanitized office data and never coerces unavailable layout/source to zero', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    expect(await action(f.canvas, 'get_office_state')).toEqual({
      members: [{ slug: 'lisa', name: 'Lisa', role: 'Developer', status: 'idle', statusSource: 'local-file-observation' }],
      rendering: { semantics: 'application-reported-drawing-not-compositor-visibility', firstFrame: null },
      layout: { cols: 2, rows: 1, furnitureCount: 0 },
      source: { teamFound: true, observer: 'watching', liveActivity: 'unavailable', diagnostics: 'unavailable' },
    });
    const agents = messages()[0];
    if (agents.type !== 'existingAgents') throw new Error('fixture');
    agents.agents = Array.from({ length: 150 }, () => ({
      ...agents.agents[0], id: 'lisa', name: '\0' + 'x'.repeat(1000), role: '\n' + 'x'.repeat(1000),
    }));
    const bounded = officeState([agents]);
    expect(bounded.members).toHaveLength(128);
    expect(bounded.members[0].name).toHaveLength(256);
    expect(bounded.members[0].role).toHaveLength(256);
    expect(JSON.stringify(bounded)).not.toMatch(/\\u0000|\\n|private-path/);
    expect(bounded.layout).toBeNull();
    expect(bounded.source).toBeNull();
  });

  it('returns exact-member charter summaries and declared-only model provenance from guarded services', async () => {
    await writeFile(join(root, '.squad', 'agents', 'lisa', 'charter.md'),
      '# Lisa\n\nBuilds tools. Reviews tools.\n\n## Identity\n- **Expertise:** TypeScript\n\n## Model\n- **Preferred:** auto\n- **Rationale:** Quality\n- **Fallback:** default\n');
    await writeFile(join(root, '.squad', 'config.json'), JSON.stringify({ defaultModel: 'auto',
      agentModelOverrides: { Lisa: 'declared-model' } }));
    const f = await fixture();
    await f.canvas.open(ctx());
    const result = await action(f.canvas, 'get_member_details', { slug: 'lisa' });
    expect(result).toMatchObject({
      status: 'available', slug: 'lisa', charterStatus: 'available',
      charterSummary: 'Builds tools. Reviews tools.', expertise: 'TypeScript',
      model: { provenance: 'declared-only', runtime: null, sources: [
        { source: 'charter.md', state: 'ready', values: [{ key: 'Preferred', value: 'auto' },
          { key: 'Rationale', value: 'Quality' }, { key: 'Fallback', value: 'default' }] },
        { state: 'ready', values: [{ key: 'defaultModel', value: 'auto' },
          { key: 'agentModelOverrides["Lisa"]', value: 'declared-model' }] },
        { state: 'missing' }, { state: 'missing' },
      ] },
    });
    expect(JSON.stringify(result)).not.toContain(root);
    expect(JSON.stringify(result)).not.toContain('charterContent');
    expect(await action(f.canvas, 'get_member_details', { slug: 'unknown' })).toEqual({ status: 'unavailable' });
    expect(await action(f.canvas, 'get_member_details', { slug: 'Lisa' })).toEqual({ status: 'unavailable' });
  });

  it('keeps missing charter/model data unavailable and bounds charter summaries and expertise', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    expect(await action(f.canvas, 'get_member_details', { slug: 'lisa' })).toMatchObject({
      charterStatus: 'missing', charterSummary: null, expertise: null, model: { runtime: null },
    });
    await writeFile(join(root, '.squad', 'agents', 'lisa', 'charter.md'),
      `# Lisa\n\n${'x'.repeat(4000)}.\n\n## Identity\n- **Expertise:** ${'y'.repeat(4000)}\n`);
    const details = await action(f.canvas, 'get_member_details', { slug: 'lisa' }) as {
      charterSummary: string; expertise: string;
    };
    expect(details.charterSummary).toHaveLength(2048);
    expect(details.expertise).toHaveLength(2048);
  });

  it('validates read-only action shapes, exact instance authority, and sanitized failures', async () => {
    const f = await fixture();
    await f.canvas.open(ctx());
    for (const input of [null, [], { extra: true }]) {
      await expect(action(f.canvas, 'get_office_state', input)).rejects.toMatchObject({ code: 'canvas_input_invalid' });
    }
    for (const input of [null, {}, { slug: '../lisa' }, { slug: 'lisa', extra: true }, { slug: 'a'.repeat(129) }]) {
      await expect(action(f.canvas, 'get_member_details', input)).rejects.toMatchObject({ code: 'canvas_input_invalid' });
    }
    await expect(action(f.canvas, 'get_office_state', {}, { ...ctx(), sessionId: 'other' }))
      .rejects.toMatchObject({ code: 'canvas_session_mismatch' });
    vi.mocked(hosts[0].snapshot).mockRejectedValueOnce(new Error('private snapshot failure'));
    await expect(action(f.canvas, 'get_office_state')).rejects.toMatchObject({
      code: 'canvas_action_unavailable', message: 'Squad Pod Canvas authority or resource unavailable',
    });
  });

  it('does not write stdout on open, action, rejection, close or disposal', async () => {
    const stdout = vi.spyOn(process.stdout, 'write');
    const f = await fixture();
    await f.canvas.open(ctx());
    await action(f.canvas, 'get_office_state');
    await action(f.canvas, 'get_member_details', { slug: 'lisa' });
    await expect(f.canvas.open(ctx({ projectRoot: other }, 'bad'))).rejects.toBeInstanceOf(CanvasError);
    await f.canvas.onClose(ctx());
    await f.dispose();
    expect(stdout).not.toHaveBeenCalled();
  });
});
