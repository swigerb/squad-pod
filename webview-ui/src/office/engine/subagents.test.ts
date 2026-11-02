import { describe, expect, it } from 'vitest';
import { OfficeState } from './officeState.js';
import { reconcileAgents } from './agentSync.js';
import { updateCharacter } from './characters.js';
import type { ObservedTask, ObservedTaskSnapshot } from '../../../../src/observedTasks.js';
import { ObservedTasks } from '../../../../src/observedTasks.js';
import { projectActivityEvent } from '../../../../src/activityProjection.js';
import { ActivityLifecycle } from '../../../../src/activityLifecycle.js';
import type { LiveEvent } from '../../../../src/activityProjection.js';

const parent: ObservedTask = {
  sessionId: 'session', toolCallId: 'member', parentToolCallId: null, name: 'ada',
  agentType: 'general-purpose', mode: 'background', description: '', agentId: 'ada',
  state: 'running', fieldsTruncated: false,
};
const child: ObservedTask = { ...parent, toolCallId: 'child', parentToolCallId: 'member',
  name: 'Research', agentType: 'explore', agentId: null };
const tasks = (...rows: ObservedTask[]): ObservedTaskSnapshot => ({ sessionId: 'session', tasks: rows, limited: false });
const member = { id: 'ada', name: 'Ada', role: 'Developer' };
const office = () => new OfficeState({ version: 2, cols: 5, rows: 5, tiles: Array(25).fill(1), furniture: [] });

describe('ephemeral office characters', () => {
  it('consumes normalized lifecycle projection without JSONL or promoting transient members', () => {
    const state = office();
    state.addAgent('ada', 'Ada', 'Developer');
    const projection = new ActivityLifecycle({
      source: () => ({ sessionId: 'session', limited: false }),
      roster: () => [{ id: 'ada' }],
      post: message => {
        if (message.type === 'observedTasks') {state.setObservedTasks(message.snapshot);}
      },
      lifecycle: () => {},
    });
    const event = (type: string, fields: Partial<LiveEvent> = {}): LiveEvent => ({
      type, toolName: '', toolCallId: '', parentToolCallId: '', squad: false,
      agentScoped: false, agentInstanceId: '', ...fields,
    });
    const dispatch = (id: string, name: string, parentToolCallId = '') => event('tool.execution_start', {
      toolName: 'task', toolCallId: id, parentToolCallId,
      task: { name, agent_type: id === 'member' ? 'general-purpose' : 'explore',
        mode: 'background', description: 'Inspect fixture' },
    });
    projection.seed([
      dispatch('member', 'ada'),
      event('subagent.started', { toolCallId: 'member', instanceId: 'member-instance' }),
      dispatch('child', 'Research', 'member'),
      event('subagent.started', { toolCallId: 'child', instanceId: 'child-instance' }),
      // An unknown-parent task has no authoritative roster ancestry.
      dispatch('unowned', 'Unknown', 'missing'),
      event('subagent.started', { toolCallId: 'unowned', instanceId: 'unowned-instance' }),
    ]);
    projection.publishTasks();
    const temporary = [...state.subagents.values()][0];
    expect(state.subagents.size).toBe(1);
    expect(temporary.parentAgentId).toBe('ada');
    expect(temporary.character.seatId).toBeNull();
    projection.accept(event('tool.execution_complete', { toolCallId: 'child' }));
    projection.accept(dispatch('alias', 'Another name', 'member'));
    projection.accept(event('subagent.started', { toolCallId: 'alias', instanceId: 'child-instance' }));
    projection.publishTasks();
    expect([...state.subagents.values()]).toEqual([temporary]);
    projection.accept(event('subagent.completed', { toolCallId: 'alias', instanceId: 'child-instance' }));
    projection.accept(event('subagent.started', { toolCallId: 'child', instanceId: 'child-instance' }));
    projection.publishTasks();
    expect(state.subagents.size).toBe(0);
    projection.clear();
    projection.replayActivity();
    projection.publishTasks();
    expect(state.subagents.size).toBe(0);
    expect([...state.characters.keys()]).toEqual(['ada']);
    expect(state.getSeatAssignments()).toEqual({});
  });

  it('consumes projected records with stable instance aliases and real completion, not dispatch completion', () => {
    const state = office();
    state.addAgent('ada', 'Ada', 'Developer');
    const inventory = new ObservedTasks();
    const accept = (type: string, data: object, agentId?: string, owner: string | null = null) => {
      const event = projectActivityEvent({ type, data, agentId });
      expect(event).not.toBeNull();
      inventory.accept(event!, 'session', owner);
      state.setObservedTasks(inventory.snapshot('session'));
    };
    const dispatch = (name: string, parentToolCallId?: string) => ({
      toolName: 'task', toolCallId: name, parentToolCallId,
      arguments: { name, agent_type: name === 'ada' ? 'general-purpose' : 'explore',
        mode: 'background', description: 'Inspect fixture', prompt: 'PRIVATE_PROMPT' },
    });
    accept('tool.execution_start', dispatch('ada'), undefined, 'ada');
    accept('subagent.started', { toolCallId: 'ada' }, 'member-instance');
    accept('tool.execution_start', dispatch('child', 'ada'));
    accept('subagent.started', { toolCallId: 'child' }, 'child-instance');
    const temporary = [...state.subagents.values()][0];
    expect(temporary.parentAgentId).toBe('ada');
    expect(temporary.character.seatId).toBeNull();
    accept('tool.execution_complete', { toolCallId: 'child', result: 'PRIVATE_RESULT' });
    accept('tool.execution_start', dispatch('child', 'ada'));
    accept('tool.execution_start', dispatch('alias', 'ada'));
    accept('subagent.started', { toolCallId: 'alias' }, 'child-instance');
    expect([...state.subagents.values()]).toEqual([temporary]);
    expect(JSON.stringify(inventory.snapshot('session'))).not.toMatch(/PRIVATE_PROMPT|PRIVATE_RESULT/);
    accept('subagent.completed', { toolCallId: 'alias' }, 'child-instance');
    expect(state.subagents.size).toBe(0);
    accept('subagent.started', { toolCallId: 'child' }, 'child-instance');
    expect(state.subagents.size).toBe(0);
    expect(state.characters.size).toBe(1);
    expect(state.getSeatAssignments()).toEqual({});
    inventory.clear();
    state.setObservedTasks(inventory.snapshot(null));
    expect(state.characters.size).toBe(1);
    expect(state.subagents.size).toBe(0);
  });

  it('waits for real start, preserves identity through roster/layout refresh and never persists a seat', () => {
    const state = office();
    state.setObservedTasks(tasks(parent, { ...child, state: 'observed' }));
    reconcileAgents(state, [member]);
    expect(state.subagents.size).toBe(0);
    state.setObservedTasks(tasks(parent, child));
    const temporary = [...state.subagents.values()][0];
    expect(temporary.parentAgentId).toBe('ada');
    expect(temporary.character.seatId).toBeNull();
    expect(state.characters.size).toBe(1);
    expect(state.getSeatAssignments()).toEqual({});
    const saved = structuredClone(state.getLayout());
    reconcileAgents(state, [{ ...member, name: 'Ada renamed' }]);
    state.rebuildFromLayout(state.layout, true);
    expect([...state.subagents.values()][0]).toBe(temporary);
    expect(state.getLayout()).toEqual(saved);
    const frame = temporary.character.frameIndex;
    updateCharacter(temporary.character, 0.4, state.walkableTiles, [], state.tileMap, state.blockedTiles);
    expect(temporary.character.frameIndex).not.toBe(frame);
    expect(state.walkableTiles.has(`${temporary.character.col},${temporary.character.row}`)).toBe(true);
    expect(temporary.character.col !== state.characters.get('ada')!.col
      || temporary.character.row !== state.characters.get('ada')!.row).toBe(true);
  });

  it('handles task-before-roster/layout ordering and selected identity promotion without duplicate characters', () => {
    const state = new OfficeState();
    state.setObservedTasks(tasks(parent, child));
    reconcileAgents(state, [member]);
    state.rebuildFromLayout(office().layout, true);
    expect(state.subagents.size).toBe(1);
    const original = state.characters.get('ada');
    state.setObservedTasks(tasks(parent, { ...child, selectedAgentName: 'ada' }));
    expect(state.subagents.size).toBe(0);
    expect(state.characters.get('ada')).toBe(original);
    state.setObservedTasks(tasks(parent, child));
    state.removeAgent('ada');
    expect(state.subagents.size).toBe(0);
  });

  it.each(['completed', 'failed', 'aborted'] as const)('despawns on %s and clears on stale/off snapshots', state => {
    const engine = office();
    engine.addAgent('ada', 'Ada', 'Developer');
    engine.setObservedTasks(tasks(parent, child));
    expect(engine.subagents.size).toBe(1);
    engine.setObservedTasks(tasks(parent, { ...child, state }));
    expect(engine.subagents.size).toBe(0);
    engine.setObservedTasks(tasks(parent, child));
    engine.setObservedTasks(null);
    expect(engine.subagents.size).toBe(0);
    expect(engine.characters.size).toBe(1);
  });
});
