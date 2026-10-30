import { describe, expect, it } from 'vitest';
import { ObservedTasks, transientSubagents, type ObservedTask, type ObservedTaskSnapshot } from './observedTasks.js';
import { parseLiveEvent } from './copilotSessionActivity.js';

const row = (toolCallId: string, extra: Partial<ObservedTask> = {}): ObservedTask => ({
  sessionId: 'session', toolCallId, parentToolCallId: null, name: 'Same name',
  agentType: 'explore', mode: 'background', description: '', state: 'running',
  fieldsTruncated: false, agentId: null, ...extra,
});
const snapshot = (...tasks: ObservedTask[]): ObservedTaskSnapshot => ({ sessionId: 'session', tasks, limited: false });
const parent = row('parent', { agentId: 'ada' });

describe('authoritative instance identity and transient hierarchy', () => {
  it('uses explicit parent calls only and distinguishes duplicate names by call identity', () => {
    const calls = snapshot(parent, row('one', { parentToolCallId: 'parent' }),
      row('two', { parentToolCallId: 'parent' }), row('unknown'), row('fake-parent', { parentToolCallId: 'ada' }));
    const children = transientSubagents(calls, ['ada']);
    expect(children).toHaveLength(2);
    expect(new Set(children.map(child => child.id)).size).toBe(2);
    expect(children.map(child => child.parentAgentId)).toEqual(['ada', 'ada']);
  });

  it('deduplicates authoritative instance aliases, never display names, and a terminal alias wins', () => {
    const one = row('one', { parentToolCallId: 'parent', instanceId: 'opaque-instance' });
    const two = row('two', { parentToolCallId: 'parent', instanceId: 'opaque-instance' });
    expect(transientSubagents(snapshot(parent, one, two), ['ada'])).toHaveLength(1);
    for (const state of ['completed', 'failed', 'aborted'] as const) {
      expect(transientSubagents(snapshot(parent, one, { ...two, state }), ['ada'])).toEqual([]);
    }
    expect(transientSubagents({ ...snapshot(parent, one), sessionId: 'different' }, ['ada'])).toEqual([]);
  });

  it('reconciles only selected custom identities to the roster, including later roster arrival', () => {
    const child = row('child', { parentToolCallId: 'parent', name: 'grace', selectedAgentName: 'grace' });
    expect(transientSubagents(snapshot(parent, child), ['ada'])).toHaveLength(1);
    expect(transientSubagents(snapshot(parent, child), ['ada', 'grace'])).toEqual([]);
    expect(transientSubagents(snapshot(parent, { ...child, selectedAgentName: undefined }), ['ada', 'grace']))
      .toHaveLength(1);
    expect(transientSubagents(snapshot(parent, { ...child, selectedAgentName: 'grace-ish' }), ['ada', 'grace']))
      .toHaveLength(1);
  });

  it('rejects cycles, missing parents, ended parents and cross-session links', () => {
    const child = row('child', { parentToolCallId: 'parent' });
    for (const badParent of [
      { ...parent, state: 'completed' as const }, { ...parent, sessionId: 'other' },
      { ...parent, agentId: null, parentToolCallId: 'child' },
    ]) { expect(transientSubagents(snapshot(badParent, child), ['ada'])).toEqual([]); }
    expect(transientSubagents(snapshot(child), ['ada'])).toEqual([]);
  });

  it.each([true, false])('correlates selected custom agents by envelope instance ID (selection first: %s)', first => {
    const inventory = new ObservedTasks();
    const accept = (type: string, data: object, agentId?: string, rosterId: string | null = null) => {
      const event = parseLiveEvent(JSON.stringify({ type, data, agentId }))!;
      inventory.accept(event, 'session', rosterId);
    };
    const select = () => accept('subagent.selected', { agentName: 'grace', agentDisplayName: 'Not identity' }, 'instance', 'grace');
    accept('tool.execution_start', { toolCallId: 'call', toolName: 'task',
      arguments: { name: 'Untrusted display', agent_type: 'explore' } });
    if (first) { select(); }
    accept('subagent.started', { toolCallId: 'call', agentName: 'explore' }, 'instance');
    if (!first) { select(); }
    expect(inventory.snapshot('session').tasks[0]).toMatchObject({
      instanceId: 'instance', selectedAgentName: 'grace', agentId: 'grace', state: 'running',
    });
    accept('subagent.selected', { agentName: 'ada' }, 'unrelated', 'ada');
    expect(inventory.snapshot('session').tasks[0].agentId).toBe('grace');
    accept('subagent.completed', { toolCallId: 'call', cancelled: true }, 'instance');
    expect(inventory.snapshot('session').tasks[0].state).toBe('aborted');
    accept('subagent.started', { toolCallId: 'call' }, 'different-instance');
    expect(inventory.snapshot('session').tasks[0].instanceId).toBe('instance');
    inventory.clear();
    expect(inventory.snapshot(null).tasks).toEqual([]);
  });

  it('omits invalid/overlong producer identities rather than truncating them into roster aliases', () => {
    for (const [agentId, agentName] of [[' instance', 'ada'], ['instance', 'ada\n'], ['instance', 'x'.repeat(161)]]) {
      const event = parseLiveEvent(JSON.stringify({ type: 'subagent.selected', agentId, data: { agentName } }))!;
      expect(event.identityOmitted).toBe(true);
      expect(event.selectedAgentName).toBeUndefined();
    }
    const root = parseLiveEvent(JSON.stringify({ type: 'subagent.selected', data: { agentName: 'ada' } }))!;
    expect(root.selectedAgentName).toBeUndefined();
  });
});
