import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CopilotSessionActivity, EventTail, LIVE_STALE_MS, MAX_LINE_BYTES, SEED_BYTES,
  exactLiveAgent, liveToolLabel, parseLiveEvent,
} from './copilotSessionActivity.js';
import type { LiveEvent } from './copilotSessionActivity.js';
import type { LiveSourceStatus, OutboundMessage } from './types.js';

const secret = 'SENTINEL_SECRET_NEVER_LEAVE_PARSER';
const line = (type: string, data: object, envelope = {}) => JSON.stringify({ type, data, ...envelope }) + '\n';
export const spawnLines = (name = 'ada', task = 'run') =>
  line('tool.execution_start', { toolName: 'task', toolCallId: task,
    arguments: { name, agent_type: 'general-purpose', mode: 'background', description: 'Build tests', prompt: secret } })
  + line('subagent.started', { toolCallId: task, agentName: 'general-purpose' }, { agentId: 'internal-id' });

describe('read-only Copilot live activity with synthetic homes', () => {
  let home: string;
  let workspace: string;
  let messages: OutboundMessage[];
  let lifecycle: ReturnType<typeof vi.fn>;
  let statuses: LiveSourceStatus[];
  let reader: CopilotSessionActivity;
  let now: number;
  const roster = [{ id: 'ada' }, { id: 'grace' }];
  const toolStart = (id = 'tool', name = 'view') => line('tool.execution_start', {
    toolCallId: id, parentToolCallId: 'run', toolName: name,
    arguments: { path: `C:\\private\\${secret}\\test.ts`, command: `npm test ${secret}`, prompt: secret },
  });
  const done = (id = 'tool') => line('tool.execution_complete', { toolCallId: id,
    result: { content: secret }, toolTelemetry: { metrics: {
      context_current_tokens: 800, context_token_limit: 1000, other: secret,
    } } });

  function session(id: string, content: string, cwd = workspace, age = 0): string {
    const dir = path.join(home, 'session-state', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'workspace.yaml'), `cwd: ${JSON.stringify(cwd)}\nsecret: ${secret}\n`);
    fs.writeFileSync(path.join(dir, 'events.jsonl'), content);
    const stamp = new Date(now - age);
    fs.utimesSync(path.join(dir, 'events.jsonl'), stamp, stamp);
    fs.utimesSync(dir, stamp, stamp);
    return path.join(dir, 'events.jsonl');
  }
  const marked = (body: string) => line('subagent.selected', { agentName: 'Squad' }) + body;
  beforeEach(() => {
    vi.useFakeTimers();
    now = Date.now();
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-live-test-'));
    workspace = path.join(home, 'workspace');
    fs.mkdirSync(workspace);
    messages = [];
    lifecycle = vi.fn();
    statuses = [];
    reader = new CopilotSessionActivity({
      workspaceRoot: workspace, copilotHome: home, roster: () => roster,
      post: m => messages.push(m), lifecycle, status: s => statuses.push(s), now: () => now,
    });
  });
  afterEach(() => {
    reader.stop();
    vi.useRealTimers();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('does not open, list or stat anything before opt-in or after stop', () => {
    const open = vi.spyOn(fs, 'openSync');
    const list = vi.spyOn(fs, 'opendirSync');
    const stat = vi.spyOn(fs, 'statSync');
    reader.poll();
    reader.stop();
    reader.poll();
    expect(open).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('requires workspace equality and a root Squad marker, including one in the head only', () => {
    session('wrong-cwd', marked(spawnLines()), home);
    session('no-marker', spawnLines());
    session('child-marker', line('subagent.selected', { agentName: 'Squad' }, { agentId: 'child' }) + spawnLines());
    const file = session('matching', marked(line('ignored', { padding: 'x'.repeat(MAX_LINE_BYTES) }) + spawnLines()));
    reader.start();
    expect(statuses.at(-1)).toEqual({ state: 'following', sessionId: 'matching' });
    expect(lifecycle.mock.calls).toEqual([['ada', true, 'Build tests']]);
    fs.appendFileSync(file, toolStart() + done());
    reader.poll();
    expect(messages).toContainEqual({ type: 'agentContextUsage', agentId: 'ada', contextTokens: 800, maxContextTokens: 1000 });
  });

  it('switches to a newer matching session and clears the previous run', () => {
    session('old', marked(spawnLines()), workspace, 1000);
    reader.start();
    now += 6000;
    session('new', marked(spawnLines('grace', 'next')));
    reader.poll();
    expect(lifecycle.mock.calls).toEqual([
      ['ada', true, 'Build tests'], ['ada', false, null], ['grace', true, 'Build tests'],
    ]);
    expect(statuses.at(-1)?.sessionId).toBe('new');
  });

  it('pairs same-name tools by ID and never treats the background task tool completion as member completion', () => {
    const file = session('session', marked(spawnLines()) + done('run') + toolStart('one') + toolStart('two') + done('one'));
    reader.start();
    expect(lifecycle.mock.calls).toEqual([['ada', true, 'Build tests']]);
    expect(messages.filter(m => m.type === 'agentToolDone')).toEqual([
      { type: 'agentToolDone', agentId: 'ada', toolId: 'one', tool: 'view' },
    ]);
    fs.appendFileSync(file, done('two') + line('subagent.completed', { toolCallId: 'run', agentName: 'general-purpose' }));
    reader.poll();
    expect(messages.filter(m => m.type === 'agentToolDone')).toHaveLength(2);
    expect(lifecycle.mock.calls).toEqual([['ada', true, 'Build tests'], ['ada', false, null]]);
    expect(messages.at(-2)).toMatchObject({ type: 'agentContextUsage', contextTokens: null, maxContextTokens: null });
  });

  it('keeps unknown, fuzzy, non-general-purpose and coordinator activity unattributed', () => {
    session('session', marked(spawnLines('ada-review') + spawnLines('a', 'other')
      + spawnLines('unknown', 'unknown') + spawnLines().replace('general-purpose', 'explore')
      + line('tool.execution_start', { toolCallId: 'root', toolName: 'view' }) + done('root')));
    reader.start();
    expect(lifecycle).not.toHaveBeenCalled();
    expect(messages).toEqual([]);
    expect(exactLiveAgent('ADA', roster)).toBe('ada');
    expect(exactLiveAgent('ada-review', roster)).toBeNull();
    expect(exactLiveAgent(' ada ', roster)).toBeNull();
    expect(exactLiveAgent('ada', [{ id: 'ada' }, { id: 'ADA' }])).toBeNull();
    expect(exactLiveAgent('folder', [{ id: 'member', folder: 'folder' }])).toBe('member');
    expect(exactLiveAgent('folder', [{ id: 'folder' }, { id: 'member', folder: 'folder' }])).toBeNull();
  });

  it.each(['subagent.completed', 'subagent.failed', 'subagent.aborted'])('clears only once for %s and on disabling', (type) => {
    const file = session('session', marked(spawnLines()) + toolStart() + done());
    reader.start();
    fs.appendFileSync(file, line(type, { toolCallId: 'run' }) + line(type, { toolCallId: 'run' }));
    reader.poll();
    reader.stop();
    expect(lifecycle.mock.calls.filter(call => call[1] === false)).toEqual([['ada', false, null]]);
    expect(messages.filter(m => m.type === 'agentToolsClear')).toHaveLength(1);
  });

  it('ignores repeated starts and late completions of a superseded member run', () => {
    const file = session('session', marked(spawnLines()) + line('subagent.started', { toolCallId: 'run' }));
    reader.start();
    expect(lifecycle.mock.calls).toEqual([['ada', true, 'Build tests']]);
    fs.appendFileSync(file, spawnLines('ada', 'second').replace('Build tests', 'New task')
      + line('subagent.completed', { toolCallId: 'run' }));
    reader.poll();
    reader.replay();
    expect(lifecycle.mock.calls).toEqual([
      ['ada', true, 'Build tests'], ['ada', true, 'New task'], ['ada', true, 'New task'],
    ]);
  });

  it('falls back on stale sessions and deletion; can discover a later session', () => {
    const file = session('session', marked(spawnLines()));
    reader.start();
    now += LIVE_STALE_MS + 1;
    reader.poll();
    expect(statuses.at(-1)?.state).toBe('searching');
    expect(lifecycle).toHaveBeenLastCalledWith('ada', false, null);
    fs.unlinkSync(file);
    reader.poll();
    now += 6000;
    session('next', marked(spawnLines('grace')));
    reader.poll();
    expect(lifecycle).toHaveBeenLastCalledWith('grace', true, 'Build tests');
  });

  it('resets the live lifecycle when a followed file is truncated or replaced, and deletion clears immediately', () => {
    const file = session('session', marked(spawnLines()) + toolStart() + done());
    reader.start();
    fs.writeFileSync(file, marked(spawnLines('grace', 'new')));
    reader.poll();
    expect(lifecycle.mock.calls).toEqual([
      ['ada', true, 'Build tests'], ['ada', false, null], ['grace', true, 'Build tests'],
    ]);
    fs.renameSync(file, file + '.old');
    fs.writeFileSync(file, marked(spawnLines()));
    reader.poll();
    expect(lifecycle).toHaveBeenLastCalledWith('ada', true, 'Build tests');
    fs.unlinkSync(file);
    reader.poll();
    expect(lifecycle).toHaveBeenLastCalledWith('ada', false, null);
    expect(statuses.at(-1)?.state).toBe('searching');
  });

  it('never applies coordinator or invalid context metrics to a member', () => {
    session('session', marked(spawnLines()) + toolStart()
      + done('root-coordinator') + done('run')
      + line('tool.execution_complete', { toolCallId: 'tool', toolTelemetry: { metrics: {
        context_current_tokens: -1, context_token_limit: 1000,
      } } }));
    reader.start();
    expect(messages.filter(m => m.type === 'agentContextUsage')).toEqual([]);
    expect(parseLiveEvent(line('tool.execution_complete', { toolCallId: 'x', toolTelemetry: { metrics: {
      context_current_tokens: 10, context_token_limit: 0,
    } } }))?.context).toBeUndefined();
  });

  it('handles partial UTF-8 lines, malformed data, oversized lines, truncation and rotation', () => {
    const file = session('session', '');
    const tail = new EventTail();
    const events: LiveEvent[] = [];
    const input = marked(spawnLines()) + toolStart() + done();
    const bytes = Buffer.from(input);
    fs.appendFileSync(file, bytes.subarray(0, 17));
    tail.read(file, event => events.push(event));
    expect(events).toHaveLength(0);
    fs.appendFileSync(file, bytes.subarray(17));
    tail.read(file, event => events.push(event));
    expect(events.map(e => e.type)).toEqual(['subagent.selected', 'tool.execution_start', 'subagent.started', 'tool.execution_start', 'tool.execution_complete']);
    fs.appendFileSync(file, 'invalid\n' + 'x'.repeat(MAX_LINE_BYTES * 3) + '\n' + line('unknown', { prompt: secret }) + done('after'));
    tail.read(file, event => events.push(event));
    expect(events.at(-1)?.toolCallId).toBe('after');
    fs.writeFileSync(file, done('truncated'));
    tail.read(file, event => events.push(event));
    expect(tail.reset).toBe(true);
    expect(events.at(-1)?.toolCallId).toBe('truncated');
    fs.renameSync(file, file + '.old');
    fs.writeFileSync(file, done('rotated'));
    tail.read(file, event => events.push(event));
    expect(tail.reset).toBe(true);
    expect(events.at(-1)?.toolCallId).toBe('rotated');
  });

  it('bounds seed and ignores a leading partial line', () => {
    const file = session('session', 'x'.repeat(SEED_BYTES + 100) + '\n' + marked(spawnLines()));
    const events: LiveEvent[] = [];
    const tail = new EventTail();
    const read = vi.spyOn(fs, 'readSync');
    tail.read(file, e => events.push(e));
    expect(read.mock.calls.reduce((sum, args) => sum + Number(args[3]), 0)).toBeLessThanOrEqual(SEED_BYTES);
    expect(events).toHaveLength(3);
    read.mockRestore();
  });

  it('projects only whitelisted fields, including across replay and telemetry sinks', () => {
    const file = session('session', marked(spawnLines()) + toolStart() + done());
    reader.start();
    reader.replay();
    fs.appendFileSync(file, toolStart('shell', 'powershell') + done('shell')
      + line('assistant.message', { content: secret }));
    reader.poll();
    expect(messages.filter(m => m.type === 'telemetryEvent')).toContainEqual(expect.objectContaining({
      event: expect.objectContaining({ summary: 'Running: npm', detail: null }),
    }));
    expect(JSON.stringify({ messages, lifecycle: lifecycle.mock.calls, statuses })).not.toContain(secret);
    expect(parseLiveEvent(line('tool.execution_start', { toolName: 'task', toolCallId: 'x',
      arguments: { description: 'd'.repeat(1000), prompt: secret } }))?.task?.description.length).toBeLessThan(1000);
  });

  it.each([
    ['view', 'Reading test.ts'], ['edit', 'Editing test.ts'], ['create', 'Writing test.ts'],
    ['bash', 'Running: npm'], ['grep', 'Searching'], ['glob', 'Searching'],
    ['web_fetch', 'Fetching'], ['task', 'Subtask'], ['server-tool', 'server-tool'],
  ])('labels %s without content', (name, label) => {
    const event = parseLiveEvent(toolStart('tool', name))!;
    expect(liveToolLabel(event)).toBe(label);
    expect(liveToolLabel({ ...event, file: 'a'.repeat(100) }).length).toBeLessThanOrEqual(30);
  });
});
