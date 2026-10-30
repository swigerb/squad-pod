import { describe, expect, it } from 'vitest';
import { OfficeState } from './officeState.js';
import { reconcileAgents } from './agentSync.js';
import { updateCharacter } from './characters.js';
import type { ObservedTask, ObservedTaskSnapshot } from '../../../../src/observedTasks.js';

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
