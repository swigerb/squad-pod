import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createObserver } from './observer.js';
import { startTransport } from './transport.js';
import { decodeEvent } from './events.js';
import { LIVE_STALE_MS, MAX_LINE_BYTES } from '../../src/copilotSessionActivity.js';
import type { OutboundMessage } from '../../src/types.js';

vi.mock('node:fs', { spy: true });

const assets = fileURLToPath(new URL('../../webview-ui/public/assets', import.meta.url));
const roots: string[] = [];
const secret = 'PRIVATE_PROMPT_OUTPUT_SENTINEL';
const line = (type: string, data: object) => JSON.stringify({ type, data }) + '\n';
const marker = line('subagent.selected', { agentName: 'Squad' });
const running = (name = 'ada', task = 'run') =>
  line('tool.execution_start', { toolCallId: task, toolName: 'task',
    arguments: { name, agent_type: 'general-purpose', description: 'Fixture live task', prompt: secret } })
  + line('subagent.started', { toolCallId: task });
const tool = (id = 'read') => line('tool.execution_start', {
  toolCallId: id, parentToolCallId: 'run', toolName: 'view', arguments: { path: `/private/${secret}/fixture.ts` },
});
const done = (id = 'read') => line('tool.execution_complete', { toolCallId: id, output: secret,
  toolTelemetry: { metrics: { context_current_tokens: 800, context_token_limit: 1000 } } });

function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'squad live observer ')));
  roots.push(root);
  const project = path.join(root, 'selected project');
  const home = path.join(root, 'synthetic home');
  fs.mkdirSync(path.join(project, '.squad', 'log'), { recursive: true });
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(project, '.squad', 'team.md'),
    '## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n| Ada | Developer | .squad/agents/ada/charter.md | Active |\n');
  function session(id: string, content = marker + running(), cwd = project, age = 0) {
    const dir = path.join(home, 'session-state', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'workspace.yaml'), `cwd: ${JSON.stringify(cwd)}\n`);
    const file = path.join(dir, 'events.jsonl');
    fs.writeFileSync(file, content);
    const time = new Date(Date.now() - age);
    fs.utimesSync(file, time, time);
    fs.utimesSync(dir, time, time);
    return file;
  }
  return { root, project, home, session };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const agent = (messages: OutboundMessage[]) => messages.find(m => m.type === 'existingAgents')?.agents[0];
const source = (messages: OutboundMessage[]) => messages.find(m => m.type === 'sourceStatus')?.status.liveActivity;
function validate(messages: OutboundMessage[]) {
  for (const message of messages) {
    expect(() => decodeEvent(JSON.stringify({ version: 1, kind: 'office', message })), message.type).not.toThrow();
    expect(decodeEvent(JSON.stringify({ version: 1, kind: 'office', message }))).toEqual(message);
  }
  expect(JSON.stringify(messages)).not.toContain(secret);
}

describe('standalone opted-in live observation', () => {
  it('preserves bounded authoritative transient identities from the shared adapter wire projection', () => {
    const message = { type: 'observedTasks', snapshot: { sessionId: 'fixture', limited: false, tasks: [{
      sessionId: 'fixture', toolCallId: 'call', parentToolCallId: null, name: 'TestBot',
      agentType: 'general-purpose', mode: 'background', description: 'Fixture',
      agentId: 'test-agent-1', instanceId: 'instance', selectedAgentName: 'test-agent-1',
      state: 'running', fieldsTruncated: false,
    }] } };
    expect(decodeEvent(JSON.stringify({ version: 1, kind: 'office', message }))).toEqual(message);
    for (const field of ['instanceId', 'selectedAgentName']) {
      expect(() => decodeEvent(JSON.stringify({ version: 1, kind: 'office', message: {
        ...message, snapshot: { ...message.snapshot, tasks: [{ ...message.snapshot.tasks[0], [field]: 'x'.repeat(161) }] },
      } }))).toThrow('Invalid server office frame');
    }
  });

  it.each([
    { type: 'agentToolStart', agentId: 'ada', tool: 'view', toolId: 'id', status: 'Reading', arguments: { prompt: secret } },
    { type: 'agentToolDone', agentId: 'ada', tool: 'view', toolId: 'id', output: secret },
    { type: 'agentToolStart', agentId: 'ada', tool: 'view', toolId: '', status: 'Reading' },
    { type: 'agentContextUsage', agentId: 'ada', contextTokens: -1, maxContextTokens: 1000 },
    { type: 'agentContextUsage', agentId: 'ada', contextTokens: 100, maxContextTokens: 0 },
    { type: 'observedTasks', snapshot: { sessionId: 'fixture', tasks: Array(65).fill({}), limited: false } },
    { type: 'observedTasks', snapshot: { sessionId: 'fixture', tasks: [], limited: false, prompt: secret } },
    { type: 'telemetryEvent', event: { id: 'id', timestamp: 0, category: 'status',
      agentId: 'ada', agentName: null, summary: 'Reading', detail: secret } },
  ])('rejects private, invalid or unbounded live wire fields %#', message => {
    expect(() => decodeEvent(JSON.stringify({ version: 1, kind: 'office', message }))).toThrow('Invalid server office frame');
  });

  it('does not discover or read home sessions without the explicit host opt-in', async () => {
    const { project, home, session } = fixture();
    session('matching');
    const list = vi.spyOn(fs, 'opendirSync');
    const observer = createObserver(project, assets, 1000, { copilotHome: home });
    try {
      const snapshot = await observer.snapshot();
      expect(source(snapshot)).toEqual({ state: 'off', sessionId: null });
      expect(agent(snapshot)).toMatchObject({ status: 'idle', currentTaskSource: null });
      expect(list.mock.calls.filter(([file]) => String(file).startsWith(home))).toEqual([]);
      expect(snapshot.some(m => m.type === 'observedTasks')).toBe(false);
    } finally { observer.dispose(); }
  });

  it('stops private reads with the last viewer and resumes only through a new opted-in subscription', async () => {
    vi.useFakeTimers();
    const { project, home, session } = fixture();
    session('matching', marker + running() + tool());
    const observer = createObserver(project, assets, 1000, { liveActivity: true, copilotHome: home });
    const list = vi.spyOn(fs, 'opendirSync');
    const open = vi.spyOn(fs, 'openSync');
    const unsubscribe = observer.subscribe(() => {});
    await observer.snapshot();
    expect(open.mock.calls.some(([file]) => String(file).startsWith(home))).toBe(true);
    unsubscribe();
    open.mockClear();
    list.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(open).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const resume = observer.subscribe(() => {});
    try {
      expect(agent(await observer.snapshot())).toMatchObject({ status: 'active', currentTaskSource: 'live' });
      expect(open.mock.calls.some(([file]) => String(file).startsWith(home))).toBe(true);
    } finally { resume(); observer.dispose(); }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('selects only the newest exact-workspace Squad source and preserves live/file precedence, detail and expiry', async () => {
    vi.useFakeTimers();
    const { project, home, session } = fixture();
    session('old', marker + running(), project, 10_000);
    const file = session('matching', marker + running() + tool());
    session('wrong-cwd', marker + running(), path.dirname(project));
    session('not-squad', running());
    const observer = createObserver(project, assets, 1000, { liveActivity: true, copilotHome: home });
    const received: OutboundMessage[] = [];
    const unsubscribe = observer.subscribe(messages => received.push(...messages));
    try {
      const initial = await observer.snapshot();
      validate(initial);
      expect(source(initial)).toMatchObject({ state: 'following', sessionId: 'matching', selection: 'matching-project' });
      expect(agent(initial)).toMatchObject({ status: 'active', currentTask: 'Fixture live task', currentTaskSource: 'live' });
      expect(initial).toContainEqual({ type: 'agentToolStart', agentId: 'ada', toolId: 'read', tool: 'view', status: 'Reading fixture.ts' });
      expect(initial.find(m => m.type === 'observedTasks')).toMatchObject({ snapshot: { tasks: [{ agentId: 'ada', state: 'running' }] } });
      fs.writeFileSync(path.join(project, '.squad', 'log', 'ada.md'), '**Agent:** ada\nFile hint while live');
      fs.appendFileSync(file, done() + tool('next'));
      await vi.advanceTimersByTimeAsync(1000);
      validate(received);
      expect(received).toContainEqual({ type: 'agentContextUsage', agentId: 'ada', contextTokens: 800, maxContextTokens: 1000 });
      await vi.advanceTimersByTimeAsync(31_000);
      expect(agent(await observer.snapshot())).toMatchObject({ status: 'active', currentTaskSource: 'live' });
      const detail = await observer.onRead({ type: 'requestAgentDetail', agentId: 'ada', requestId: 'live-detail' });
      expect(detail).toMatchObject([{ detail: { status: 'active', currentTaskSource: 'live' } }]);
      await vi.advanceTimersByTimeAsync(LIVE_STALE_MS);
      const stale = await observer.snapshot();
      validate(stale);
      expect(source(stale)?.state).toBe('searching');
      expect(agent(stale)).toMatchObject({ status: 'idle', currentTask: null, currentTaskSource: null });
      expect(received).toContainEqual({ type: 'agentToolsClear', agentId: 'ada' });
      expect(received).toContainEqual({ type: 'agentContextUsage', agentId: 'ada', contextTokens: null, maxContextTokens: null });
      expect(stale.find(m => m.type === 'observedTasks')).toMatchObject({ snapshot: { tasks: [] } });
    } finally { unsubscribe(); observer.dispose(); }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replays current tools after roster snapshots and reconnect, not completed history or paused file hints', async () => {
    vi.useFakeTimers();
    const { project, home, session } = fixture();
    const file = session('matching', marker + running() + tool() + done() + tool('open'));
    const observer = createObserver(project, assets, 1000, { liveActivity: true, copilotHome: home });
    let unsubscribe = observer.subscribe(() => {});
    try {
      const current = await observer.snapshot();
      expect(current.filter(m => m.type === 'agentToolStart').map(m => m.toolId)).toEqual(['open']);
      expect(current.some(m => m.type === 'agentToolDone' || m.type === 'telemetryEvent')).toBe(false);
      const received: OutboundMessage[] = [];
      const second = observer.subscribe(messages => received.push(...messages));
      fs.appendFileSync(path.join(project, '.squad', 'team.md'),
        '| Grace | Tester | .squad/agents/grace/charter.md | Active |\n');
      await vi.advanceTimersByTimeAsync(1000);
      expect(received.find(m => m.type === 'existingAgents')?.agents).toHaveLength(2);
      const rosterIndex = received.findIndex(m => m.type === 'existingAgents');
      const toolIndex = received.findIndex(m => m.type === 'agentToolStart' && m.toolId === 'open');
      expect(toolIndex).toBeGreaterThan(rosterIndex);
      second();
      unsubscribe();
      expect(vi.getTimerCount()).toBe(0);
      fs.writeFileSync(path.join(project, '.squad', 'log', 'ada.md'), '**Agent:** ada\nPaused hint');
      unsubscribe = observer.subscribe(() => {});
      validate(await observer.snapshot());
      fs.appendFileSync(file, line('subagent.completed', { toolCallId: 'run' }));
      await vi.advanceTimersByTimeAsync(1000);
      expect(agent(await observer.snapshot())).toMatchObject({ status: 'idle', currentTask: null });
      fs.appendFileSync(path.join(project, '.squad', 'log', 'ada.md'), '\nFresh hint');
      await vi.advanceTimersByTimeAsync(1000);
      expect(agent(await observer.snapshot())).toMatchObject({ status: 'active', currentTaskSource: 'file' });
    } finally { unsubscribe(); observer.dispose(); }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears tools/context on source replacement and errors, and exposes bounded coverage', async () => {
    vi.useFakeTimers();
    const { project, home, session } = fixture();
    const file = session('matching', marker + running() + tool() + done());
    const observer = createObserver(project, assets, 1000, { liveActivity: true, copilotHome: home });
    const received: OutboundMessage[] = [];
    const unsubscribe = observer.subscribe(messages => received.push(...messages));
    try {
      await observer.snapshot();
      fs.renameSync(file, file + '.old');
      fs.writeFileSync(file, marker + line('ignored', { padding: 'x'.repeat(MAX_LINE_BYTES) }));
      await vi.advanceTimersByTimeAsync(1000);
      const replacement = await observer.snapshot();
      expect(agent(replacement)).toMatchObject({ status: 'idle' });
      expect(replacement.find(m => m.type === 'observedTasks')).toMatchObject({ snapshot: { limited: true, tasks: [] } });
      expect(received).toContainEqual({ type: 'agentContextUsage', agentId: 'ada', contextTokens: null, maxContextTokens: null });
      fs.unlinkSync(file);
      fs.mkdirSync(file);
      await vi.advanceTimersByTimeAsync(1000);
      const error = await observer.snapshot();
      expect(source(error)?.state).toBe('error');
      validate(error);
      expect(agent(error)).toMatchObject({ status: 'idle' });
    } finally { unsubscribe(); observer.dispose(); }
  });

  it('carries live tool/context snapshots over authenticated /office without enabling any mutation', async () => {
    const { root, project, home, session } = fixture();
    const file = session('matching', marker + running() + tool());
    const bundle = path.join(root, 'bundle');
    fs.mkdirSync(bundle);
    fs.writeFileSync(path.join(bundle, 'index.html'), '<html>Fixture</html>');
    const observer = createObserver(project, assets, 50, { liveActivity: true, copilotHome: home });
    const transport = await startTransport({ port: 0, staticRoot: bundle, ...observer });
    const origin = `http://127.0.0.1:${transport.port}`;
    let ws: WebSocket | undefined;
    try {
      const auth = await fetch(`${origin}/auth`, { method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: transport.token }) });
      expect(auth.status).toBe(204);
      const cookie = auth.headers.get('set-cookie')!.split(';')[0];
      ws = new WebSocket(`${origin.replace('http:', 'ws:')}/office`, { origin, headers: { Cookie: cookie } });
      const frames: { kind: string; message?: OutboundMessage; code?: string }[] = [];
      ws.on('message', data => frames.push(JSON.parse(String(data))));
      await once(ws, 'open');
      ws.send(JSON.stringify({ version: 1, kind: 'office', message: { type: 'webviewReady' } }));
      await vi.waitFor(() => expect(frames.some(f => f.message?.type === 'agentToolStart')).toBe(true));
      fs.appendFileSync(file, done());
      await vi.waitFor(() => expect(frames.some(f => f.message?.type === 'agentContextUsage'
        && f.message.contextTokens === 800)).toBe(true));
      validate(frames.flatMap(frame => frame.message ? [frame.message] : []));
      for (const message of [{ type: 'setLiveActivity', enabled: false }, { type: 'launch' },
        { type: 'saveLayout', layout: {} }]) {
        ws.send(JSON.stringify({ version: 1, kind: 'office', message }));
      }
      await vi.waitFor(() => expect(frames.filter(frame => frame.code === 'READ_ONLY')).toHaveLength(3));
      expect(transport.controlToken).toBeNull();
      expect(fs.readdirSync(project)).toEqual(['.squad']);
    } finally {
      ws?.terminate();
      await transport.dispose();
      observer.dispose();
    }
  });
});
