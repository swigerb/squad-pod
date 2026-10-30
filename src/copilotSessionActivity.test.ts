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
import { MAX_OBSERVED_TASKS, MAX_RECENT_TASKS, TASK_ID_MAX_LENGTH } from './observedTasks.js';
import { TASK_DESCRIPTION_DISPLAY_MAX_LENGTH } from './constants.js';

vi.mock('node:fs', { spy: true });

const secret = 'SENTINEL_SECRET_NEVER_LEAVE_PARSER';
const line = (type: string, data: object, envelope = {}) => JSON.stringify({ type, data, ...envelope }) + '\n';
export const spawnLines = (name = 'ada', task = 'run') =>
  line('tool.execution_start', { toolName: 'task', toolCallId: task,
    arguments: { name, agent_type: 'general-purpose', mode: 'background', description: 'Build tests', prompt: secret } })
  + line('subagent.started', { toolCallId: task, agentName: 'general-purpose' }, { agentId: `internal-${task}` });

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
  const inventory = () => messages.filter(message => message.type === 'observedTasks').at(-1)!.snapshot;
  const taskCall = (id: unknown, name = 'unknown', agentType = 'explore', parent?: unknown) =>
    line('tool.execution_start', { toolCallId: id, parentToolCallId: parent, toolName: 'task',
      arguments: { name, agent_type: agentType, mode: 'background', description: 'Inspect fixture', prompt: secret },
      output: secret, credentials: secret });
  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.restoreAllMocks();
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

  it('lets a host snapshot clock drive bounded reads without creating an automatic timer', () => {
    const file = session('session', marked(spawnLines()));
    reader.start(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(lifecycle.mock.calls).toEqual([['ada', true, 'Build tests']]);
    fs.appendFileSync(file, toolStart());
    now += 1000;
    expect(messages.some(message => message.type === 'agentToolStart')).toBe(false);
    reader.replay();
    expect(messages).toContainEqual({
      type: 'agentToolStart', agentId: 'ada', toolId: 'tool', tool: 'view', status: 'Reading test.ts',
    });
    reader.stop();
    messages.length = 0;
    reader.poll();
    expect(messages).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
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

  it('restores a live activity timestamp from its source event without advancing it on replay', () => {
    const timestamp = new Date(now - 60_000).toISOString();
    const toolStartedAt = new Date(now - 50_000).toISOString();
    const toolCompletedAt = new Date(now - 45_000).toISOString();
    const taskCompletedAt = new Date(now - 40_000).toISOString();
    const file = session('dated', marked(
      taskCall('run', 'Ada', 'general-purpose')
      + line('subagent.started', { toolCallId: 'run' }, { agentId: 'internal-run', timestamp }),
    ));
    reader.start();
    expect(lifecycle.mock.calls).toEqual([['ada', true, 'Inspect fixture', Date.parse(timestamp)]]);

    reader.replay();
    expect(lifecycle.mock.calls).toEqual([
      ['ada', true, 'Inspect fixture', Date.parse(timestamp)],
      ['ada', true, 'Inspect fixture', Date.parse(timestamp)],
    ]);

    fs.appendFileSync(file,
      line('tool.execution_start', { toolCallId: 'tool', parentToolCallId: 'run', toolName: 'view' }, {
        timestamp: toolStartedAt,
      })
      + line('tool.execution_complete', { toolCallId: 'tool', parentToolCallId: 'run' }, {
        timestamp: toolCompletedAt,
      }));
    reader.poll();
    expect(lifecycle.mock.calls.at(-1)).toEqual([
      'ada', true, 'Inspect fixture', Date.parse(toolCompletedAt),
    ]);

    reader.replay();
    expect(lifecycle.mock.calls.at(-1)).toEqual([
      'ada', true, 'Inspect fixture', Date.parse(toolCompletedAt),
    ]);

    fs.appendFileSync(file, line('subagent.completed', { toolCallId: 'run' }, {
      agentId: 'internal-run', timestamp: taskCompletedAt,
    }));
    reader.poll();
    expect(lifecycle.mock.calls.at(-1)).toEqual([
      'ada', false, null, Date.parse(taskCompletedAt),
    ]);
  });

  it('ignores future source timestamps and accepts a later valid observation', () => {
    const previousTimestamp = new Date(now - 120_000).toISOString();
    const futureTimestamp = new Date(now + 60_000).toISOString();
    const validTimestamp = new Date(now - 1000).toISOString();
    const file = session('clock-skew', marked(
      taskCall('run', 'Ada', 'general-purpose')
      + line('subagent.started', { toolCallId: 'run' }, { agentId: 'internal-run', timestamp: previousTimestamp }),
    ));
    reader.start();
    expect(lifecycle.mock.calls).toEqual([['ada', true, 'Inspect fixture', Date.parse(previousTimestamp)]]);

    fs.appendFileSync(file, line('tool.execution_start', {
      toolCallId: 'tool', parentToolCallId: 'run', toolName: 'view',
    }, { timestamp: futureTimestamp }));
    reader.poll();
    expect(lifecycle.mock.calls.at(-1)).toEqual([
      'ada', true, 'Inspect fixture', Date.parse(previousTimestamp), true,
    ]);

    fs.appendFileSync(file, line('tool.execution_complete', {
      toolCallId: 'tool', parentToolCallId: 'run',
    }, { timestamp: validTimestamp }));
    reader.poll();
    expect(lifecycle.mock.calls.at(-1)).toEqual([
      'ada', true, 'Inspect fixture', Date.parse(validTimestamp),
    ]);

    reader.replay();
    expect(lifecycle.mock.calls.at(-1)).toEqual([
      'ada', true, 'Inspect fixture', Date.parse(validTimestamp),
    ]);
  });

  it('projects only authoritative model fields and excludes ephemeral or message content', () => {
    const timestamp = '2026-10-30T12:34:56.000Z';
    expect(parseLiveEvent(line('session.start', { selectedModel: 'selected-model' }, { timestamp })))
      .toMatchObject({ modelObservation: {
        model: 'selected-model', kind: 'session-selection', source: 'session.start.selectedModel', timestamp,
      }, identityOmitted: false });
    expect(parseLiveEvent(line('session.model_change', { newModel: 'changed-model' }, { timestamp })))
      .toMatchObject({ modelObservation: {
        model: 'changed-model', kind: 'session-selection', source: 'session.model_change.newModel', timestamp,
      } });
    expect(parseLiveEvent(line('session.resume', { selectedModel: 'resumed-model' }, { timestamp })))
      .toMatchObject({ modelObservation: {
        model: 'resumed-model', kind: 'session-selection', source: 'session.resume.selectedModel', timestamp,
      } });
    expect(parseLiveEvent(line('subagent.started', { model: 'member-model' }, { timestamp })))
      .toMatchObject({ modelObservation: {
        model: 'member-model', kind: 'subagent-model', source: 'subagent.started.model', timestamp,
      } });
    expect(parseLiveEvent(line('tool.execution_complete', { model: 'tool-model' }, { timestamp })))
      .toMatchObject({ modelObservation: {
        model: 'tool-model', kind: 'tool-call', source: 'tool.execution_complete.model', timestamp,
      } });
    const assistant = parseLiveEvent(line('assistant.message', {
      model: 'observed-model', content: secret, toolRequests: [{ arguments: { prompt: secret } }],
    }, { timestamp }));
    expect(assistant?.modelObservation).toMatchObject({
      model: 'observed-model', kind: 'assistant-message', source: 'assistant.message.model', timestamp,
    });
    expect(JSON.stringify(assistant)).not.toContain(secret);
    expect(parseLiveEvent(line('assistant.message', { model: 'ephemeral-model', content: secret },
      { timestamp, ephemeral: true }))?.modelObservation).toBeUndefined();
    expect(parseLiveEvent(line('assistant.usage', { model: 'ephemeral-model' }, { timestamp }))).toBeNull();
    expect(parseLiveEvent(line('assistant.message', { model: 'bad\nmodel' }, { timestamp }))?.modelObservation)
      .toBeUndefined();
    expect(parseLiveEvent(line('assistant.message', { model: 'missing-timestamp' } ) )?.modelObservation)
      .toBeUndefined();
    expect(parseLiveEvent(line('subagent.started', { toolCallId: 'untimed' }, { timestamp: 'not-a-timestamp' }))
      ?.activityAt).toBeUndefined();
  });

  it('uses session-start model metadata without replaying completed member lifecycle', () => {
    const timestamp = '2026-10-30T12:34:56.000Z';
    session('history', marked(
      line('session.start', { selectedModel: 'session-model' }, { timestamp })
      + taskCall('past', 'ada', 'general-purpose')
      + line('subagent.started', { toolCallId: 'past', model: 'member-model' },
        { agentId: 'instance-1', timestamp })
      + line('subagent.completed', { toolCallId: 'past' }, { agentId: 'instance-1', timestamp }),
    ));
    reader.start();
    expect(lifecycle).not.toHaveBeenCalled();
    expect(messages.filter(message => message.type === 'observedTasks').at(-1)?.snapshot.limited).toBe(false);
    expect(messages.filter(message => message.type === 'liveModels').at(-1)?.snapshot).toEqual({
      sessionId: 'history',
      session: {
        model: 'session-model', kind: 'session-selection', source: 'session.start.selectedModel', timestamp,
      },
      members: {},
    });
  });

  it('clears current model observations on session switch, staleness and disable', () => {
    const timestamp = '2026-10-30T12:34:56.000Z';
    const models = () => messages.filter(message => message.type === 'liveModels').at(-1)?.snapshot;
    session('first', marked(line('session.start', { selectedModel: 'first-model' }, { timestamp })
      + line('tool.execution_start', { toolCallId: 'old-root-tool', toolName: 'view' })));
    reader.start();
    expect(models()).toMatchObject({ sessionId: 'first', session: { model: 'first-model' } });

    now += 6000;
    const second = session('second', marked(line('session.resume', { selectedModel: 'second-model' }, { timestamp })));
    reader.poll();
    expect(models()).toMatchObject({ sessionId: 'second', session: {
      model: 'second-model', source: 'session.resume.selectedModel',
    } });
    fs.appendFileSync(second, line('tool.execution_complete', { toolCallId: 'old-root-tool', model: 'old-tool-model' },
      { timestamp }));
    reader.poll();
    expect(models()?.session?.model).toBe('second-model');

    now += LIVE_STALE_MS + 1;
    reader.poll();
    expect(models()).toEqual({ sessionId: null, session: null, members: {} });
    reader.stop();
    expect(models()).toEqual({ sessionId: null, session: null, members: {} });
  });

  it('attributes tool-call models to their known member and scopes subagent shutdown', () => {
    const timestamp = '2026-10-30T12:34:56.000Z';
    const file = session('scoped-models', marked(
      line('session.start', { selectedModel: 'root-model' }, { timestamp })
      + taskCall('ada-run', 'ada', 'general-purpose')
      + line('subagent.started', { toolCallId: 'ada-run' }, { agentId: 'ada-instance', timestamp })
      + taskCall('grace-run', 'grace', 'general-purpose')
      + line('subagent.started', { toolCallId: 'grace-run', model: 'grace-model' },
        { agentId: 'grace-instance', timestamp })
      + line('tool.execution_start', { toolCallId: 'ada-tool', parentToolCallId: 'ada-run',
        toolName: 'view', arguments: { path: 'C:\\private\\test.ts' } }),
    ));
    reader.start();
    const models = () => messages.filter(message => message.type === 'liveModels').at(-1)?.snapshot;
    expect(models()).toMatchObject({ session: { model: 'root-model' } });

    fs.appendFileSync(file, line('tool.execution_complete', { toolCallId: 'ada-tool', model: 'ada-tool-model' },
      { timestamp }));
    reader.poll();
    expect(models()).toMatchObject({
      session: { model: 'root-model' },
      members: { ada: { model: 'ada-tool-model', source: 'tool.execution_complete.model' } },
    });

    fs.appendFileSync(file, line('session.shutdown', { currentModel: 'ada-tool-model' },
      { agentId: 'ada-instance', timestamp }));
    reader.poll();
    expect(models()).toEqual({
      sessionId: 'scoped-m', session: { model: 'root-model', kind: 'session-selection',
        source: 'session.start.selectedModel', timestamp },
      members: { grace: { model: 'grace-model', kind: 'subagent-model',
        source: 'subagent.started.model', timestamp } },
    });

    fs.appendFileSync(file, line('assistant.message', { model: 'grace-next', content: secret },
      { agentId: 'grace-instance', timestamp }));
    reader.poll();
    expect(models()?.members.grace?.model).toBe('grace-next');
    expect(models()?.session?.model).toBe('root-model');

    fs.appendFileSync(file, line('tool.execution_start', { toolCallId: 'root-tool', toolName: 'view' })
      + line('tool.execution_complete', { toolCallId: 'root-tool', model: 'root-tool-model' }, { timestamp }));
    reader.poll();
    expect(models()?.session).toMatchObject({
      model: 'root-tool-model', source: 'tool.execution_complete.model',
    });
  });

  it('does not promote late or duplicate member-tool completions to the session model', () => {
    const timestamp = '2026-10-30T12:34:56.000Z';
    const file = session('late-tool', marked(
      line('session.start', { selectedModel: 'root-model' }, { timestamp })
      + taskCall('grace-run', 'grace', 'general-purpose')
      + line('subagent.started', { toolCallId: 'grace-run' }, { agentId: 'grace-instance', timestamp })
      + line('tool.execution_start', { toolCallId: 'grace-tool', parentToolCallId: 'grace-run', toolName: 'view' }),
    ));
    reader.start();
    fs.appendFileSync(file, line('subagent.completed', { toolCallId: 'grace-run' },
      { agentId: 'grace-instance', timestamp }));
    reader.poll();
    expect(messages.filter(message => message.type === 'liveModels').at(-1)?.snapshot).toMatchObject({
      session: { model: 'root-model' }, members: {},
    });

    fs.appendFileSync(file, line('tool.execution_complete', { toolCallId: 'grace-tool', model: 'late-grace-tool-model' },
      { timestamp }));
    reader.poll();
    expect(messages.filter(message => message.type === 'liveModels').at(-1)?.snapshot).toMatchObject({
      session: { model: 'root-model' }, members: {},
    });
    fs.appendFileSync(file, line('tool.execution_complete', { toolCallId: 'grace-tool', model: 'duplicate-model' },
      { timestamp }));
    reader.poll();
    expect(messages.filter(message => message.type === 'liveModels').at(-1)?.snapshot).toMatchObject({
      session: { model: 'root-model' }, members: {},
    });
  });

  it('joins delayed selected-agent ownership only through a retained running call instance', () => {
    const timestamp = '2026-10-30T12:34:56.000Z';
    const file = session('late-selection', marked(
      line('session.start', { selectedModel: 'root-model' }, { timestamp })
      + taskCall('child', 'unknown', 'explore', 'parent')
      + line('subagent.started', { toolCallId: 'child', model: 'child-model' },
        { agentId: 'child-instance', timestamp })
      + line('subagent.selected', { agentName: 'grace' }, { agentId: 'child-instance', timestamp })
      + line('assistant.message', { model: 'grace-actual', content: secret },
        { agentId: 'child-instance', timestamp }),
    ));
    reader.start();
    const models = () => messages.filter(message => message.type === 'liveModels').at(-1)?.snapshot;
    expect(models()).toMatchObject({
      session: { model: 'root-model' },
      members: { grace: { model: 'grace-actual', source: 'assistant.message.model' } },
    });
    expect(inventory().tasks).toContainEqual(expect.objectContaining({
      toolCallId: 'child', state: 'running', agentId: 'grace', instanceId: 'child-instance',
    }));
    expect(lifecycle).toHaveBeenCalledWith('grace', true, 'Inspect fixture');

    fs.appendFileSync(file, line('subagent.selected', { agentName: 'grace' },
      { agentId: 'unretained-instance', timestamp })
      + line('assistant.message', { model: 'unrelated-model', content: secret },
        { agentId: 'unretained-instance', timestamp }));
    reader.poll();
    expect(models()?.session?.model).toBe('root-model');
    expect(models()?.members.grace?.model).toBe('grace-actual');
    expect(models()?.members).not.toHaveProperty('unknown');
  });

  it('bounds root tool ownership and withholds model events after owner eviction', () => {
    const timestamp = '2026-10-30T12:34:56.000Z';
    const rootCalls = Array.from({ length: 2049 }, (_, index) => {
      const id = `root-${index}`;
      return line('tool.execution_start', { toolCallId: id, toolName: 'view' })
        + line('tool.execution_complete', { toolCallId: id, model: `root-model-${index}` }, { timestamp });
    }).join('');
    const file = session('bounded-owners', marked(
      line('session.start', { selectedModel: 'initial-root-model' }, { timestamp }) + rootCalls,
    ));
    reader.start();
    const models = () => messages.filter(message => message.type === 'liveModels').at(-1)?.snapshot;
    expect(models()?.session?.model).toBe('root-model-2048');

    fs.appendFileSync(file, line('tool.execution_complete', { toolCallId: 'root-0', model: 'evicted-owner-model' },
      { timestamp }));
    reader.poll();
    expect(models()?.session?.model).toBe('root-model-2048');
  });

  it('keeps session selections, actual root messages and exactly attributed member models separate', () => {
    const timestamp = '2026-10-30T12:34:56.000Z';
    const file = session('models', marked(
      line('session.start', { selectedModel: 'session-selection' }, { timestamp })
      + taskCall('run', 'ada', 'general-purpose')
      + line('subagent.started', { toolCallId: 'run', model: 'member-selection' },
        { agentId: 'instance-1', timestamp })
      + line('assistant.message', { model: 'member-message', content: secret }, { agentId: 'instance-1', timestamp })
      + line('assistant.message', { model: 'root-message', content: secret }, { timestamp }),
    ));
    reader.start();
    const models = () => messages.filter(message => message.type === 'liveModels').at(-1)?.snapshot;
    expect(models()).toEqual({
      sessionId: 'models',
      session: {
        model: 'root-message', kind: 'assistant-message', source: 'assistant.message.model', timestamp,
      },
      members: { ada: {
        model: 'member-message', kind: 'assistant-message', source: 'assistant.message.model', timestamp,
      } },
    });
    expect(JSON.stringify(messages)).not.toContain(secret);

    fs.appendFileSync(file, line('session.model_change', { newModel: 'member-changed' },
      { agentId: 'instance-1', timestamp }));
    reader.poll();
    expect(models()?.session?.model).toBe('root-message');
    expect(models()?.members.ada).toMatchObject({
      model: 'member-changed', kind: 'session-selection', source: 'session.model_change.newModel',
    });

    fs.appendFileSync(file, line('assistant.message', { model: 'unattributed-model', content: secret },
      { agentId: 'unknown-instance', timestamp }));
    reader.poll();
    expect(models()?.members.ada?.model).toBe('member-changed');
    expect(models()?.session?.model).toBe('root-message');

    fs.appendFileSync(file, line('subagent.completed', { toolCallId: 'run' }, { agentId: 'instance-1', timestamp }));
    reader.poll();
    expect(models()?.members).toEqual({});
    expect(models()?.session?.model).toBe('root-message');

    fs.appendFileSync(file, line('session.model_deselected', { previousModel: 'root-message' }, { timestamp }));
    reader.poll();
    expect(models()?.session).toBeNull();
    fs.appendFileSync(file, line('session.start', { selectedModel: 'shutting-down-model' }, { timestamp })
      + line('session.shutdown', { currentModel: 'shutting-down-model' }, { timestamp }));
    reader.poll();
    expect(models()?.session).toBeNull();
    reader.stop();
    expect(models()).toEqual({ sessionId: null, session: null, members: {} });
  });

  it('does not attribute a session model to a member and clears models when the followed session changes', () => {
    const file = session('old-session', marked(line('session.start', { selectedModel: 'old-model' },
      { timestamp: '2026-10-30T12:34:56.000Z' })));
    reader.start();
    expect(messages.filter(message => message.type === 'liveModels').at(-1)?.snapshot.session?.model)
      .toBe('old-model');
    now += 6000;
    session('new-session', marked(''));
    reader.poll();
    expect(messages.filter(message => message.type === 'liveModels').at(-1)?.snapshot).toEqual({
      sessionId: 'new-sess', session: null, members: {},
    });
    expect(file).toContain('old-session');
    reader.stop();
  });

  it('clears the current model after the matched source becomes stale', () => {
    const timestamp = '2026-10-30T12:34:56.000Z';
    session('stale-model', marked(line('session.start', { selectedModel: 'stale-model' }, { timestamp })));
    reader.start();
    expect(messages.filter(message => message.type === 'liveModels').at(-1)?.snapshot.session?.model)
      .toBe('stale-model');
    now += LIVE_STALE_MS + 1;
    reader.poll();
    expect(statuses.at(-1)?.state).toBe('searching');
    expect(messages.filter(message => message.type === 'liveModels').at(-1)?.snapshot)
      .toEqual({ sessionId: null, session: null, members: {} });
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
    const file = session('session', marked(''));
    reader.start();
    fs.appendFileSync(file, spawnLines() + done('run') + toolStart('one') + toolStart('two') + done('one'));
    reader.poll();
    expect(lifecycle.mock.calls).toEqual([['ada', true, 'Build tests']]);
    expect(messages.filter(m => m.type === 'agentToolDone')).toEqual([
      { type: 'agentToolDone', agentId: 'ada', toolId: 'one', tool: 'view' },
    ]);
    fs.appendFileSync(file, done('two') + line('subagent.completed', { toolCallId: 'run', agentName: 'general-purpose' }));
    reader.poll();
    expect(messages.filter(m => m.type === 'agentToolDone')).toHaveLength(2);
    expect(lifecycle.mock.calls).toEqual([['ada', true, 'Build tests'], ['ada', false, null]]);
    expect(messages.filter(m => m.type === 'agentContextUsage').at(-1))
      .toMatchObject({ contextTokens: null, maxContextTokens: null });
  });

  it('links custom selection to a running instance, never its display name, and routes lifecycle to the existing roster', () => {
    const file = session('session', marked(spawnLines()));
    reader.start();
    lifecycle.mockClear();
    fs.appendFileSync(file, taskCall('child', 'grace', 'explore', 'run')
      + line('subagent.started', { toolCallId: 'child', agentName: 'explore' }, { agentId: 'instance' }));
    reader.poll();
    expect(inventory().tasks.find(row => row.toolCallId === 'child')?.agentId).toBeNull();
    expect(lifecycle).not.toHaveBeenCalled();
    fs.appendFileSync(file, line('subagent.selected', { agentName: 'grace', agentDisplayName: 'Ada' }, { agentId: 'instance' }));
    reader.poll();
    expect(inventory().tasks.find(row => row.toolCallId === 'child')).toMatchObject({
      instanceId: 'instance', selectedAgentName: 'grace', agentId: 'grace',
    });

    expect(lifecycle.mock.calls).toEqual([['grace', true, 'Inspect fixture']]);
    fs.appendFileSync(file, line('subagent.completed', { toolCallId: 'child', cancelled: true }, { agentId: 'instance' }));
    reader.poll();
    expect(lifecycle.mock.calls.at(-1)).toEqual(['grace', false, null]);
    expect(inventory().tasks.find(row => row.toolCallId === 'child')?.state).toBe('aborted');
  });

  it('does not count identity reassignment as new activity for the former member', () => {
    const firstObservedAt = new Date(now - 120_000).toISOString();
    const toolObservedAt = new Date(now - 60_000).toISOString();
    const reassignedAt = new Date(now - 30_000).toISOString();
    const file = session('reassigned', marked(
      taskCall('run', 'Ada', 'general-purpose')
      + line('subagent.started', { toolCallId: 'run' }, { agentId: 'internal-run', timestamp: firstObservedAt }),
    ));
    reader.start();
    fs.appendFileSync(file, line('tool.execution_start', {
      toolCallId: 'tool', parentToolCallId: 'run', toolName: 'view',
    }, { timestamp: toolObservedAt }));
    reader.poll();
    expect(lifecycle.mock.calls.at(-1)).toEqual([
      'ada', true, 'Inspect fixture', Date.parse(toolObservedAt),
    ]);

    fs.appendFileSync(file, line('subagent.selected', { agentName: 'Grace' }, {
      agentId: 'internal-run', timestamp: reassignedAt,
    }));
    reader.poll();

    expect(lifecycle.mock.calls.slice(-2)).toEqual([
      ['ada', false, null],
      ['grace', true, 'Inspect fixture', Date.parse(reassignedAt)],
    ]);
  });

  it('ends a roster run when another call for the same authoritative instance completes', () => {
    const file = session('session', marked(''));
    reader.start();
    fs.appendFileSync(file, taskCall('one', 'ada', 'general-purpose')
      + line('subagent.started', { toolCallId: 'one' }, { agentId: 'same-instance' })
      + taskCall('alias', 'ada', 'general-purpose')
      + line('subagent.started', { toolCallId: 'alias' }, { agentId: 'same-instance' }));
    reader.poll();
    fs.appendFileSync(file, line('subagent.completed', { toolCallId: 'one' }));
    reader.poll();
    expect(lifecycle.mock.calls.at(-1)).toEqual(['ada', false, null]);
    expect(inventory().tasks.every(row => row.state === 'completed')).toBe(true);
    lifecycle.mockClear();
    reader.replay();
    expect(lifecycle).not.toHaveBeenCalled();
  });

  it('silently seeds only in-flight state, never replaying completed history on enable, reload or rotation', () => {
    const completed = spawnLines('grace', 'past') + line('subagent.completed', { toolCallId: 'past' });
    const file = session('session', marked(completed + spawnLines()) + toolStart() + done());
    reader.start();
    expect(lifecycle.mock.calls).toEqual([['ada', true, 'Build tests']]);
    expect(messages.filter(m => m.type === 'telemetryEvent' || m.type === 'agentToolDone')).toEqual([]);
    expect(messages.filter(m => m.type === 'agentContextUsage')).toEqual([
      { type: 'agentContextUsage', agentId: 'ada', contextTokens: 800, maxContextTokens: 1000 },
    ]);
    reader.replay();
    fs.renameSync(file, file + '.old');
    fs.writeFileSync(file, marked(completed + spawnLines()) + toolStart('running'));
    reader.poll();
    expect(lifecycle.mock.calls.every(call => call[0] === 'ada' && call[1] === true)).toBe(true);
    expect(messages.filter(m => m.type === 'telemetryEvent')).toEqual([]);
    expect(messages.filter(m => m.type === 'agentToolStart').at(-1)).toMatchObject({ toolId: 'running' });
  });

  it('rejects symlinks, directory junctions and non-regular event paths before opening or reading targets', () => {
    const file = session('session', marked(spawnLines()));
    const target = file + '.target';
    fs.renameSync(file, target);
    // Junctions need no Windows symlink privilege; the regular-file gate rejects them identically.
    fs.symlinkSync(path.dirname(target), file, process.platform === 'win32' ? 'junction' : 'dir');
    const open = vi.mocked(fs.openSync);
    open.mockClear();
    reader.start();
    expect(open.mock.calls.filter(call => call[0] === file)).toEqual([]);
    expect(lifecycle).not.toHaveBeenCalled();
    expect(statuses.at(-1)?.state).toBe('error');
    expect(() => new EventTail().read(file, () => {})).toThrow('Unsupported live event file');
    fs.unlinkSync(file);
    fs.mkdirSync(file);
    open.mockClear();
    expect(() => new EventTail().read(file, () => {})).toThrow('Unsupported live event file');
    expect(open).not.toHaveBeenCalled();
    fs.rmdirSync(file);
    if (process.platform !== 'win32') {
      fs.symlinkSync(target, file);
      expect(() => new EventTail().read(file, () => {})).toThrow('Unsupported live event file');
      expect(open).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['powershell', `$env:API_KEY='${secret}'`], ['powershell', `Write-Output('${secret}')`],
    ['powershell', `'${secret}'`], ['powershell', `"${secret}"`],
    ['bash', `API_KEY='${secret}' npm test`],
  ])('does not expose assignments or expressions from %s', (toolName, command) => {
    const file = session('session', marked(spawnLines()));
    reader.start();
    fs.appendFileSync(file, line('tool.execution_start', {
      toolCallId: 'shell', toolName, parentToolCallId: 'run', arguments: { command, prompt: secret },
    }));
    reader.poll();
    reader.replay();
    expect(messages.filter(m => m.type === 'agentToolStart').at(-1)).toMatchObject({ status: 'Running: shell' });
    expect(JSON.stringify({ messages, lifecycle: lifecycle.mock.calls })).not.toContain(secret);
  });

  it('rejects a non-regular descriptor after open without reading any content', () => {
    const file = session('session', marked(spawnLines()));
    const invalid: fs.Stats = Object.create(fs.statSync(file));
    Object.defineProperty(invalid, 'isFile', { value: () => false });
    vi.mocked(fs.fstatSync).mockReturnValueOnce(invalid);
    const reads = vi.mocked(fs.readSync);
    const close = vi.mocked(fs.closeSync);
    reads.mockClear();
    close.mockClear();
    expect(() => new EventTail().read(file, () => {})).toThrow('Live event file changed during open');
    expect(reads).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps unknown, fuzzy, non-general-purpose and coordinator activity unattributed', () => {
    session('session', marked(spawnLines('ada-review') + spawnLines('a', 'other')
      + spawnLines('unknown', 'unknown') + spawnLines('ada', 'explore').replace('general-purpose', 'explore')
      + line('tool.execution_start', { toolCallId: 'root', toolName: 'view' }) + done('root')));
    reader.start();
    expect(lifecycle).not.toHaveBeenCalled();
    expect(messages.filter(m => !['observedTasks', 'liveModels'].includes(m.type))).toEqual([]);
    expect(inventory().tasks).toHaveLength(4);
    expect(inventory().tasks.every(task => task.agentId === null)).toBe(true);
    expect(exactLiveAgent('ADA', roster)).toBe('ada');
    expect(exactLiveAgent('ada-review', roster)).toBeNull();
    expect(exactLiveAgent(' ada ', roster)).toBeNull();
    expect(exactLiveAgent('ada', [{ id: 'ada' }, { id: 'ADA' }])).toBeNull();
    expect(exactLiveAgent('folder', [{ id: 'member', folder: 'folder' }])).toBe('member');
    expect(exactLiveAgent('folder', [{ id: 'folder' }, { id: 'member', folder: 'folder' }])).toBeNull();
  });

  it('keeps same-name concurrent tasks distinct, including non-general-purpose exact names and ambiguous matches', () => {
    const file = session('session', marked(''));
    reader.start();
    fs.appendFileSync(file, taskCall('one', 'ada') + taskCall('two', 'ada')
      + taskCall('three', 'unknown', 'general-purpose')
      + taskCall('four', 'ada-review', 'general-purpose')
      + line('subagent.started', { toolCallId: 'one' }));
    reader.poll();
    expect(inventory().tasks.map(task => [task.toolCallId, task.name, task.agentId, task.state])).toEqual([
      ['one', 'ada', null, 'running'], ['two', 'ada', null, 'observed'],
      ['three', 'unknown', null, 'observed'], ['four', 'ada-review', null, 'observed'],
    ]);
    expect(lifecycle).not.toHaveBeenCalled();
    roster.push({ id: 'ADA' });
    try {
      fs.appendFileSync(file, taskCall('ambiguous', 'ada', 'general-purpose'));
      reader.poll();
      expect(inventory().tasks.at(-1)?.agentId).toBeNull();
      expect(lifecycle).not.toHaveBeenCalled();
    } finally { roster.pop(); }
  });

  it('rejects missing and oversized opaque IDs without aliasing, and repeated starts cannot change metadata', () => {
    const file = session('session', marked(''));
    reader.start();
    const id = 'x'.repeat(TASK_ID_MAX_LENGTH);
    fs.appendFileSync(file, taskCall(id, 'first') + taskCall(id, 'ada', 'general-purpose')
      + taskCall(id + 'extra') + taskCall(undefined) + taskCall('') + taskCall(' padded ')
      + taskCall('control\nid') + taskCall(123));
    reader.poll();
    expect(inventory().tasks).toHaveLength(1);
    expect(inventory().tasks[0]).toMatchObject({ toolCallId: id, name: 'first', agentId: null });
    expect(inventory().limited).toBe(true);
    expect(lifecycle).not.toHaveBeenCalled();
    expect(parseLiveEvent(taskCall(id + 'extra'))?.toolCallId).toBe('');
  });

  it('uses only explicit observed same-session parent IDs, rejects self/cyclic links and resolves late parents', () => {
    const file = session('session', marked(''));
    reader.start();
    fs.appendFileSync(file, taskCall('child', 'unknown', 'explore', 'parent')
      + taskCall('missing', 'parent', 'task', 'absent')
      + taskCall('self', 'self', 'task', 'self')
      + taskCall('a', 'a', 'task', 'b') + taskCall('b', 'b', 'task', 'a')
      + taskCall('bad-parent', 'p', 'task', 'x'.repeat(TASK_ID_MAX_LENGTH + 1)));
    reader.poll();
    expect(inventory().tasks.every(task => task.parentToolCallId === null)).toBe(true);
    fs.appendFileSync(file, taskCall('parent') + taskCall('grandchild', 'x', 'explore', 'child'));
    reader.poll();
    expect(inventory().tasks.find(task => task.toolCallId === 'child')?.parentToolCallId).toBe('parent');
    expect(inventory().tasks.find(task => task.toolCallId === 'grandchild')?.parentToolCallId).toBe('child');
  });

  it.each(['completed', 'failed', 'aborted'] as const)('uses actual subagent.%s lifecycle, not task dispatch completion', state => {
    const file = session('session', marked(''));
    reader.start();
    fs.appendFileSync(file, taskCall('task') + done('task'));
    reader.poll();
    expect(inventory().tasks[0].state).toBe('observed');
    fs.appendFileSync(file, line('subagent.started', { toolCallId: 'task' }));
    reader.poll();
    expect(inventory().tasks[0].state).toBe('running');
    fs.appendFileSync(file, line(`subagent.${state}`, { toolCallId: 'task', output: secret })
      + line('subagent.started', { toolCallId: 'task' }) + taskCall('task', 'changed'));
    reader.poll();
    expect(inventory().tasks[0]).toMatchObject({ state, name: 'unknown' });
    reader.replay();
    expect(inventory().tasks[0].state).toBe(state);
    expect(JSON.stringify(messages)).not.toContain(secret);
  });

  it('bounds active retention, completed history and projected display fields with explicit coverage', () => {
    const file = session('session', marked(''));
    reader.start();
    fs.appendFileSync(file, Array.from({ length: MAX_OBSERVED_TASKS + 10 }, (_, i) => taskCall(`active-${i}`)).join(''));
    reader.poll();
    expect(inventory().tasks).toHaveLength(MAX_OBSERVED_TASKS);
    expect(inventory().limited).toBe(true);
    fs.appendFileSync(file, Array.from({ length: MAX_OBSERVED_TASKS }, (_, i) =>
      line('subagent.completed', { toolCallId: `active-${i}` })).join(''));
    reader.poll();
    expect(inventory().tasks).toHaveLength(MAX_RECENT_TASKS);
    fs.appendFileSync(file, line('tool.execution_start', { toolCallId: 'bounded', toolName: 'task',
      arguments: { name: 'n'.repeat(161), agent_type: 't'.repeat(1000), mode: 'm'.repeat(1000),
        description: 'd'.repeat(1000), prompt: secret, extra: secret } }));
    reader.poll();
    expect(inventory().tasks.at(-1)).toMatchObject({
      name: '', agentType: 't'.repeat(160), mode: 'm'.repeat(160),
      description: 'd'.repeat(TASK_DESCRIPTION_DISPLAY_MAX_LENGTH), fieldsTruncated: true, agentId: null,
    });
    expect(JSON.stringify(messages)).not.toContain(secret);
  });

  it('seeds only in-flight inventory and isolates reused IDs, parents, reset, reconnect, consent and disposal', () => {
    const file = session('abcdefgh-old', marked(taskCall('parent') + taskCall('reuse', 'old')
      + taskCall('past') + line('subagent.completed', { toolCallId: 'past' })));
    reader.start();
    expect(inventory().tasks.map(task => task.toolCallId)).toEqual(['parent', 'reuse']);
    reader.replay();
    expect(inventory().tasks.map(task => task.toolCallId)).toEqual(['parent', 'reuse']);
    now += 6000;
    const next = session('abcdefgh-new', marked(taskCall('reuse', 'new', 'explore', 'parent')));
    reader.poll();
    expect(statuses.at(-1)?.sessionId).toBe('abcdefgh');
    expect(inventory().tasks).toHaveLength(1);
    expect(inventory().tasks[0]).toMatchObject({ sessionId: 'abcdefgh-new', toolCallId: 'reuse', name: 'new', parentToolCallId: null });
    fs.writeFileSync(next, marked(taskCall('reset')));
    reader.replay();
    expect(inventory().tasks.map(task => task.toolCallId)).toEqual(['reset']);
    now += LIVE_STALE_MS + 1;
    reader.replay();
    expect(inventory().tasks).toEqual([]);
    fs.appendFileSync(next, taskCall('resumed'));
    fs.utimesSync(next, new Date(now), new Date(now));
    reader.replay();
    expect(inventory().tasks.map(task => task.toolCallId)).toEqual(['reset', 'resumed']);
    fs.unlinkSync(next);
    reader.replay();
    expect(inventory().tasks).toEqual([]);
    reader.stop();
    expect(inventory()).toEqual({ sessionId: null, tasks: [], limited: false });
    fs.unlinkSync(file);
    reader.replay();
    expect(inventory().tasks).toEqual([]);
  });

  it('reports partial source coverage for oversized lines and a bounded seed', () => {
    session('session', marked('') + 'x'.repeat(SEED_BYTES + 100) + '\n' + taskCall('visible'));
    reader.start();
    expect(inventory()).toMatchObject({ limited: true, tasks: [expect.objectContaining({ toolCallId: 'visible' })] });
  });

  it('evicts completed history before in-flight calls at capacity and retains completions in completion order', () => {
    const file = session('session', marked(''));
    reader.start();
    fs.appendFileSync(file, Array.from({ length: MAX_OBSERVED_TASKS }, (_, i) => taskCall(`call-${i}`)).join('')
      + line('subagent.completed', { toolCallId: 'call-20' }));
    reader.poll();
    fs.appendFileSync(file, taskCall('new'));
    reader.poll();
    expect(inventory().tasks).toHaveLength(MAX_OBSERVED_TASKS);
    expect(inventory().tasks.some(task => task.toolCallId === 'call-20')).toBe(false);
    expect(inventory().tasks.some(task => task.toolCallId === 'call-0')).toBe(true);
    expect(inventory().limited).toBe(true);
    fs.appendFileSync(file, Array.from({ length: MAX_RECENT_TASKS }, (_, i) =>
      line('subagent.completed', { toolCallId: `call-${i + 1}` })).join('')
      + line('subagent.completed', { toolCallId: 'call-0' }));
    reader.poll();
    expect(inventory().tasks.find(task => task.toolCallId === 'call-0')?.state).toBe('completed');
    expect(inventory().tasks.some(task => task.toolCallId === 'call-1')).toBe(false);
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

  it('silently reconstructs in-flight members once when the same stale session resumes growing', () => {
    const history = spawnLines('grace', 'past') + line('subagent.completed', { toolCallId: 'past' });
    const file = session('session', marked(history + spawnLines()));
    reader.start();
    now += LIVE_STALE_MS + 1;
    reader.poll();
    expect(lifecycle).toHaveBeenLastCalledWith('ada', false, null);
    const reads = vi.mocked(fs.readSync);
    reads.mockClear();
    reader.poll();
    reader.poll();
    expect(reads).not.toHaveBeenCalled();
    fs.appendFileSync(file, toolStart('resumed'));
    const stamp = new Date(now);
    fs.utimesSync(file, stamp, stamp);
    reader.poll();
    expect(statuses.at(-1)?.state).toBe('following');
    expect(lifecycle).toHaveBeenLastCalledWith('ada', true, 'Build tests');
    expect(messages.filter(m => m.type === 'agentToolStart').at(-1)).toMatchObject({
      toolId: 'resumed', status: 'Reading test.ts',
    });
    expect(messages.filter(m => m.type === 'telemetryEvent')).toHaveLength(1);
    expect(messages.filter(m => m.type === 'telemetryEvent')).toEqual([
      expect.objectContaining({ event: expect.objectContaining({ summary: 'Live member finished', agentId: 'ada' }) }),
    ]);
    fs.appendFileSync(file, done('resumed'));
    fs.utimesSync(file, stamp, stamp);
    reader.poll();
    expect(messages.filter(m => m.type === 'agentContextUsage').at(-1)).toMatchObject({ contextTokens: 800, maxContextTokens: 1000 });
    const activations = lifecycle.mock.calls.filter(call => call[1]).length;
    reader.poll();
    expect(lifecycle.mock.calls.filter(call => call[1])).toHaveLength(activations);
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

  it('keeps each member context independent from coordinator and other member tools', () => {
    session('session', marked(spawnLines() + spawnLines('grace', 'grace-run'))
      + toolStart('ada-tool')
      + line('tool.execution_start', { toolCallId: 'grace-tool', parentToolCallId: 'grace-run', toolName: 'edit' })
      + done('root-coordinator') + done('ada-tool')
      + line('tool.execution_complete', { toolCallId: 'grace-tool', toolTelemetry: { metrics: {
        context_current_tokens: 9500, context_token_limit: 10_000,
      } } }));
    reader.start();
    expect(messages.filter(m => m.type === 'agentContextUsage')).toEqual([
      { type: 'agentContextUsage', agentId: 'ada', contextTokens: 800, maxContextTokens: 1000 },
      { type: 'agentContextUsage', agentId: 'grace', contextTokens: 9500, maxContextTokens: 10_000 },
    ]);
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
