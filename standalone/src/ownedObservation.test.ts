import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OwnedRuns } from './ownedRuns.js';
import { launchOwnedPty } from './ownedPtyProcess.js';
import { createObserver } from './observer.js';
import { fileURLToPath } from 'node:url';
import type { OutboundMessage } from '../../src/types.js';
import { LIVE_STALE_MS } from '../../src/copilotSessionActivity.js';

vi.mock('./ownedPtyProcess.js', () => ({ launchOwnedPty: vi.fn() }));
vi.mock('node:crypto', { spy: true });

const assets = fileURLToPath(new URL('../../webview-ui/public/assets', import.meta.url));
const id = '12345678-1234-4234-8234-123456789abc';
const secondId = '22345678-1234-4234-8234-123456789abc';
const line = (type: string, data: object) => JSON.stringify({ type, data }) + '\n';
const marker = line('subagent.selected', { agentName: 'Squad' });
const running = line('tool.execution_start', { toolCallId: 'run', toolName: 'task',
  arguments: { name: 'ada', agent_type: 'general-purpose', description: 'Exact owned task' } })
  + line('subagent.started', { toolCallId: 'run' })
  + line('tool.execution_start', { toolCallId: 'read', toolName: 'view', parentToolCallId: 'run',
    arguments: { path: '/private/fixture.ts' } });
let root: string;
let project: string;
let home: string;
const runtimes: OwnedRuns[] = [];
const observers: ReturnType<typeof createObserver>[] = [];
const exits: Array<(code: number) => void> = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(randomUUID).mockReturnValue(id);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad owned observation '));
  project = path.join(root, 'selected project');
  home = path.join(root, '.copilot');
  fs.mkdirSync(path.join(project, '.squad'), { recursive: true });
  fs.mkdirSync(path.join(home, 'session-state'), { recursive: true });
  fs.writeFileSync(path.join(project, '.squad', 'team.md'),
    '## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n| Ada | Developer | .squad/agents/ada/charter.md | Active |\n');
  const executable = path.join(root, process.platform === 'win32' ? 'copilot.exe' : 'copilot');
  fs.writeFileSync(executable, process.platform === 'win32' ? 'MZfixture only - never executed'
    : '#!/usr/bin/env node\n// fixture only - never executed\n');
  fs.chmodSync(executable, 0o755);
  vi.stubEnv('PATH', root);
  vi.stubEnv('HOME', root);
  vi.stubEnv('USERPROFILE', root);
  vi.stubEnv('COPILOT_HOME', home);
  vi.mocked(launchOwnedPty).mockImplementation(async (_broker, _launch, _cwd, _env, authorized, _data, exit) => {
    if (!authorized()) throw new Error('Authorization revoked');
    exits.push(exit);
    return { pid: 12345, action: async () => {}, kill: async () => { exit(0); }, exited: Promise.resolve() };
  });
});
afterEach(async () => {
  for (const observer of observers.splice(0)) observer.dispose();
  await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose()));
  exits.length = 0;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});
function runtime(liveActivity = true, fixture?: string) {
  const value = new OwnedRuns({ project, enabled: true, liveActivity, fixture });
  runtimes.push(value);
  return value;
}
function observer(runs: OwnedRuns) {
  const value = createObserver(project, assets, 1000, { liveActivity: true, copilotHome: home,
    sessionSelection: () => runs.observationSelection() });
  observers.push(value);
  return value;
}
function session(sessionId: string, content = marker + running, cwd = project, age = 0) {
  const dir = path.join(home, 'session-state', sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'workspace.yaml'), `cwd: ${JSON.stringify(cwd)}\n`);
  const file = path.join(dir, 'events.jsonl');
  fs.writeFileSync(file, content);
  const time = new Date(Date.now() - age);
  fs.utimesSync(file, time, time);
  fs.utimesSync(dir, time, time);
  return file;
}
const status = (messages: OutboundMessage[]) => messages.find(m => m.type === 'sourceStatus')?.status.liveActivity;
const agent = (messages: OutboundMessage[]) => messages.find(m => m.type === 'existingAgents')?.agents[0];
const models = (messages: OutboundMessage[]) => messages.filter(m => m.type === 'liveModels').at(-1)?.snapshot;

describe('server-generated owned-session binding (synthetic broker, never AI)', () => {
  it('only adds a fresh fixed UUID on live opt-in; IDs/binding stay out of terminal wire inventory', async () => {
    const plain = runtime(false);
    await plain.launch();
    expect(vi.mocked(launchOwnedPty).mock.calls[0][1].args.slice(-2)).toEqual(['--agent', 'squad']);
    const live = runtime();
    const info = await live.launch();
    const call = vi.mocked(launchOwnedPty).mock.calls[1];
    expect(call[1].args.slice(-4)).toEqual(['--agent', 'squad', '--session-id', id]);
    expect(call[2]).toBe(fs.realpathSync(project));
    expect(call[3]).not.toHaveProperty('COPILOT_HOME');
    expect(live.observationSelection().preferredId).toBe(id);
    expect(live.status().runs).toEqual([{ runId: info.runId, pid: 12345, state: 'running', exitCode: null }]);
    expect(JSON.stringify(live.status())).not.toContain(id);
  });

  it('does not resume collisions or accept path-shaped IDs, and a failed launch cannot leave a binding', async () => {
    session(id);
    const live = runtime();
    await expect(live.launch()).rejects.toThrow('fresh Copilot session UUID');
    expect(launchOwnedPty).not.toHaveBeenCalled();
    vi.mocked(randomUUID).mockReturnValueOnce('../../invalid-1234-4234-8234-123456789abc');
    await expect(live.launch()).rejects.toThrow('Invalid generated Copilot session UUID');
    expect(launchOwnedPty).not.toHaveBeenCalled();
    vi.mocked(randomUUID).mockReturnValue(secondId);
    await expect(live.launch(() => false)).rejects.toThrow('revoked');
    expect(live.observationSelection().preferredId).toBeUndefined();
    expect(live.status().runs).toEqual([]);
    expect(live.observationSelection().excludedIds).toContain(secondId);
  });

  it('refuses linked session roots before allocating a UUID or launching', async () => {
    fs.rmdirSync(path.join(home, 'session-state'));
    const target = path.join(root, 'fixture target');
    fs.mkdirSync(target);
    fs.symlinkSync(target, path.join(home, 'session-state'), 'junction');
    const live = runtime();
    await expect(live.launch()).rejects.toThrow('Unsupported Copilot session root');
    expect(launchOwnedPty).not.toHaveBeenCalled();
    expect(live.status().runs).toEqual([]);
  });

  it('blocks unrelated same-cwd fallback until the exact owned cwd and Squad marker are present', async () => {
    const live = runtime();
    const office = observer(live);
    session('unrelated', marker + running);
    expect(status(await office.snapshot())?.selection).toBe('matching-project');
    await live.launch();
    let messages = await office.snapshot();
    expect(status(messages)).toMatchObject({ state: 'searching', selection: 'owned-session' });
    expect(agent(messages)).toMatchObject({ status: 'idle' });
    session(id, marker + running, root);
    await vi.advanceTimersByTimeAsync(5000);
    expect(agent(await office.snapshot())).toMatchObject({ status: 'idle' });
    session(id, running);
    await vi.advanceTimersByTimeAsync(5000);
    expect(agent(await office.snapshot())).toMatchObject({ status: 'idle' });
    session(id);
    for (let index = 0; index < 40; index++) session(`newer-unrelated-${index}`);
    await vi.advanceTimersByTimeAsync(5000);
    messages = await office.snapshot();
    expect(status(messages)).toMatchObject({ state: 'following', selection: 'owned-session', sessionId: '12345678' });
    expect(agent(messages)).toMatchObject({ status: 'active', currentTask: 'Exact owned task' });
    expect(messages).toContainEqual({ type: 'agentToolStart', agentId: 'ada', toolId: 'read', tool: 'view', status: 'Reading fixture.ts' });
  });

  it('keeps exact correlation on reconnect, switches newest active owned runs, excludes exited/closed sessions and clears revocation', async () => {
    const live = runtime();
    const office = observer(live);
    const first = await live.launch();
    session(id, marker + JSON.stringify({ type: 'session.start', timestamp: new Date().toISOString(),
      data: { selectedModel: 'fixture-owned-model' } }) + '\n' + running);
    let unsubscribe = office.subscribe(() => {});
    expect(status(await office.snapshot())?.selection).toBe('owned-session');
    expect(models(await office.snapshot())?.session?.model).toBe('fixture-owned-model');
    unsubscribe();
    unsubscribe = office.subscribe(() => {});
    expect(agent(await office.snapshot())?.status).toBe('active');
    vi.mocked(randomUUID).mockReturnValue(secondId);
    const second = await live.launch();
    const waiting = await office.snapshot();
    expect(agent(waiting)?.status).toBe('idle');
    expect(models(waiting)).toEqual({ sessionId: null, session: null, members: {} });
    session(secondId);
    await vi.advanceTimersByTimeAsync(5000);
    expect(status(await office.snapshot())?.sessionId).toBe('22345678');
    exits[1](0);
    expect(status(await office.snapshot())?.sessionId).toBe('12345678');
    expect(models(await office.snapshot())?.session?.model).toBe('fixture-owned-model');
    await live.close(first.runId);
    expect(status(await office.snapshot())?.selection).toBe('matching-project');
    expect(agent(await office.snapshot())?.status).toBe('idle');
    expect(models(await office.snapshot())).toEqual({ sessionId: null, session: null, members: {} });
    session('external', marker + running);
    await vi.advanceTimersByTimeAsync(5000);
    expect(status(await office.snapshot())?.sessionId).toBe('external');
    await live.close(second.runId);
    vi.mocked(randomUUID).mockReturnValue('32345678-1234-4234-8234-123456789abc');
    await live.launch();
    live.revokeObservation();
    const revoked = await office.snapshot();
    expect(status(revoked)).toMatchObject({ state: 'searching', selection: 'unavailable', reason: expect.stringContaining('revoked') });
    expect(agent(revoked)?.status).toBe('idle');
    expect(models(revoked)).toEqual({ sessionId: null, session: null, members: {} });
    unsubscribe();
  });

  it('shows stale exact sessions unavailable without jumping to a fresh unrelated project session', async () => {
    const live = runtime();
    await live.launch();
    session(id, marker + running, project, LIVE_STALE_MS + 1000);
    session('fresh-unrelated');
    const office = observer(live);
    const messages = await office.snapshot();
    expect(status(messages)).toMatchObject({ state: 'searching', selection: 'owned-session' });
    expect(agent(messages)?.status).toBe('idle');
    expect(messages.some(m => m.type === 'agentToolStart')).toBe(false);
  });

  it('discloses sanitized-home mismatch and fixture terminals instead of forwarding private environment or guessing', async () => {
    vi.stubEnv('COPILOT_HOME', path.join(root, 'different approved home'));
    const live = runtime();
    await live.launch();
    expect(vi.mocked(launchOwnedPty).mock.calls[0][1].args.slice(-2)).toEqual(['--agent', 'squad']);
    expect(live.observationSelection()).toMatchObject({ preferredId: null, reason: expect.stringContaining('different Copilot homes') });
    const fixture = runtime(true, '/synthetic/fixture.mjs');
    await fixture.launch();
    expect(fixture.observationSelection()).toMatchObject({ preferredId: null, reason: expect.stringContaining('Synthetic terminals') });
  });
});
