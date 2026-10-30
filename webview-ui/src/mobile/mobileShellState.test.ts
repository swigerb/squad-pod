import { describe, expect, it } from 'vitest';
import { runId } from '../../../src/core/terminalFrames.js';
import {
  initialMobileShellState, reduceMobileShell, terminalInputBlockReason,
  type MobileShellState, type MobileTerminalAccess,
} from './mobileShellState.js';

const first = runId('owned-test-1');
const second = runId('owned-test-2');
const access: MobileTerminalAccess = {
  authenticated: true, connected: true, available: true, ready: true, resync: false,
  runs: [{ runId: first, pid: 1, state: 'running', exitCode: null }],
};
const card = { kind: 'owned', runId: first } as const;
const launch = { type: 'launch', requestId: 'viewer-a-request-1' } as const;
const launchedAccess: MobileTerminalAccess = {
  ...access, runs: [...access.runs, { runId: second, pid: 2, state: 'running', exitCode: null }],
};
describe('mobile navigation without process lifecycle side effects', () => {
  it('starts on office with live runs and opens only an explicitly acknowledged launch', () => {
    const initial = reduceMobileShell(initialMobileShellState, { type: 'runsChanged' }, access);
    expect(initial.state).toEqual({ ...initialMobileShellState, selectedRunId: first });
    expect(initial.effects).toEqual([{ type: 'select', runId: first }]);
    const requested = reduceMobileShell(initial.state, launch, access);
    expect(requested.effects).toEqual([launch]);
    expect(requested.state.view).toBe('office');
    expect(reduceMobileShell(requested.state, launch, access).effects).toEqual([]);
    const unchanged = reduceMobileShell(requested.state, { type: 'runsChanged' }, access);
    expect(unchanged.state.pendingLaunch).toEqual({ requestId: launch.requestId, acknowledgedRunId: null });
    expect(unchanged.effects).toEqual([]);
    const opened = reduceMobileShell(unchanged.state, {
      type: 'launchResult', requestId: launch.requestId, result: { ok: true, runId: second },
    }, launchedAccess);
    expect(opened.state).toEqual({
      view: 'terminal', focused: { kind: 'owned', runId: second }, selectedRunId: second, pendingLaunch: null,
    });
    expect(opened.effects).toEqual([{ type: 'select', runId: second }]);
  });
  it('opens the selected owned run from its card and keeps toggle navigation synchronized', () => {
    const focused = reduceMobileShell(initialMobileShellState, { type: 'card', card }, access);
    expect(focused.state.view).toBe('terminal');
    expect(focused.effects).toEqual([{ type: 'select', runId: first }]);
    const opened = reduceMobileShell(focused.state, { type: 'card', card }, access);
    expect(opened.state.view).toBe('terminal');
    expect(opened.effects).toEqual([]);
    const office = reduceMobileShell(opened.state, { type: 'toggle' }, access);
    const terminal = reduceMobileShell(office.state, { type: 'toggle' }, access);
    expect(terminal.state).toEqual(opened.state);
    expect([...office.effects, ...terminal.effects]).toEqual([]);
    expect(reduceMobileShell(office.state, { type: 'showTerminal' }, access).state).toEqual(opened.state);
  });
  it('never promotes an observed identity into authority, even with an identical run string', () => {
    const state: MobileShellState = { ...initialMobileShellState, view: 'terminal', selectedRunId: first };
    const observed = reduceMobileShell(state, { type: 'card', card: { kind: 'observed', agentId: first } }, access);
    expect(observed.state.view).toBe('office');
    expect(observed.state.selectedRunId).toBeUndefined();
    expect(observed.effects).toEqual([{ type: 'select', runId: undefined }]);
    expect(reduceMobileShell(observed.state, { type: 'toggle' }, access).effects).toEqual([]);
    expect(reduceMobileShell(observed.state, { type: 'toggle' }, access).state.selectedRunId).toBeUndefined();
  });
  it('clears a missing run without launching and cancels pending launch on failure/disconnect', () => {
    const selected = { ...initialMobileShellState, selectedRunId: first };
    const missing = reduceMobileShell(selected, { type: 'runsChanged' }, { ...access, runs: [] });
    expect(missing.effects).toEqual([{ type: 'select', runId: undefined }]);
    const pending = reduceMobileShell(initialMobileShellState, launch, access).state;
    for (const event of [
      { type: 'disconnect' } as const,
      { type: 'launchResult', requestId: launch.requestId, result: { ok: false, message: 'refused' } } as const,
    ]) {
      const cancelled = reduceMobileShell(pending, event, access);
      expect(cancelled.state.pendingLaunch).toBeNull();
      expect(cancelled.effects).toEqual(event.type === 'disconnect' ? [] : [
        { type: 'launchUnavailable', message: 'Launch failed: refused' },
      ]);
    }
  });
  it.each(['authenticated', 'connected', 'available'] as const)('blocks launch without %s', key => {
    expect(reduceMobileShell(initialMobileShellState, launch, { ...access, [key]: false }).effects).toEqual([]);
  });
  it('blocks launch and input during resync; disconnect/revocation retain process identity', () => {
    expect(reduceMobileShell(initialMobileShellState, launch, { ...access, resync: true }).effects).toEqual([]);
    const state = { ...initialMobileShellState, selectedRunId: first, view: 'terminal' as const };
    expect(terminalInputBlockReason(access, first)).toBeNull();
    expect(terminalInputBlockReason({ ...access, connected: false }, first)).toContain('disconnected');
    expect(terminalInputBlockReason({ ...access, authenticated: false }, first)).toContain('authentication');
    expect(terminalInputBlockReason({ ...access, resync: true }, first)).toContain('resync');
    expect(terminalInputBlockReason({ ...access, ready: false }, first)).toContain('replay');
    expect(terminalInputBlockReason({ ...access, available: false }, first)).toContain('unavailable');
    expect(terminalInputBlockReason(access, undefined)).toContain('owned');
    expect(terminalInputBlockReason({ ...access, runs: [{ ...access.runs[0], state: 'exited', exitCode: 0 }] }, first)).toContain('exited');
    expect(reduceMobileShell(state, { type: 'disconnect' }, access)).toEqual({ state, effects: [] });
  });
  it('does not let navigation bypass explicit replay resync by selecting another run', () => {
    const state: MobileShellState = {
      ...initialMobileShellState, selectedRunId: first, focused: { kind: 'owned', runId: second },
    };
    const blocked = { ...access, resync: true };
    expect(reduceMobileShell(state, { type: 'card', card }, blocked)).toEqual({ state, effects: [] });
    expect(reduceMobileShell(state, { type: 'toggle' }, blocked)).toEqual({
      state: { ...state, view: 'terminal' }, effects: [],
    });
  });
  it('cancels a launch intent when authority disappears before the new run announcement', () => {
    const pending = reduceMobileShell(initialMobileShellState, launch, access).state;
    const revoked = reduceMobileShell(pending, { type: 'runsChanged' }, {
      ...access, authenticated: false, runs: [...access.runs, { runId: second, pid: 2, state: 'running', exitCode: null }],
    });
    expect(revoked.state.view).toBe('office');
    expect(revoked.state.pendingLaunch).toBeNull();
    expect(revoked.effects).toEqual([]);
  });
  it('ignores viewer B inventory and acknowledgement before viewer A receives its own launch result', () => {
    const pendingA = reduceMobileShell(initialMobileShellState, launch, access).state;
    const requestB = { type: 'launch', requestId: 'viewer-b-request-1' } as const;
    const pendingB = reduceMobileShell(initialMobileShellState, requestB, access).state;
    const broadcastA = reduceMobileShell(pendingA, { type: 'runsChanged' }, launchedAccess);
    expect(broadcastA).toEqual({ state: pendingA, effects: [] });
    const bResult = { type: 'launchResult', requestId: requestB.requestId, result: { ok: true, runId: second } } as const;
    expect(reduceMobileShell(broadcastA.state, bResult, launchedAccess)).toEqual({ state: pendingA, effects: [] });
    expect(reduceMobileShell(pendingB, bResult, launchedAccess).state.selectedRunId).toBe(second);
    const third = runId('owned-test-3');
    const allRuns: MobileTerminalAccess = {
      ...launchedAccess, runs: [...launchedAccess.runs, { runId: third, pid: 3, state: 'running', exitCode: null }],
    };
    const nextBroadcast = reduceMobileShell(broadcastA.state, { type: 'runsChanged' }, allRuns);
    expect(nextBroadcast).toEqual({ state: pendingA, effects: [] });
    const ownResult = reduceMobileShell(nextBroadcast.state, {
      type: 'launchResult', requestId: launch.requestId, result: { ok: true, runId: third },
    }, allRuns);
    expect(ownResult.state.selectedRunId).toBe(third);
    expect(ownResult.state.view).toBe('terminal');
    expect(ownResult.effects).toEqual([{ type: 'select', runId: third }]);
  });
  it('waits for the exact acknowledged run if success precedes its inventory entry', () => {
    const pending = reduceMobileShell(initialMobileShellState, launch, access).state;
    const acknowledged = reduceMobileShell(pending, {
      type: 'launchResult', requestId: launch.requestId, result: { ok: true, runId: second },
    }, access);
    expect(acknowledged.state.view).toBe('office');
    expect(acknowledged.state.pendingLaunch?.acknowledgedRunId).toBe(second);
    expect(acknowledged.effects).toEqual([]);
    const opened = reduceMobileShell(acknowledged.state, { type: 'runsChanged' }, launchedAccess);
    expect(opened.state.selectedRunId).toBe(second);
    expect(opened.state.view).toBe('terminal');
    expect(opened.effects).toEqual([{ type: 'select', runId: second }]);
  });
  it('cancels an acknowledged run missing from the next inventory and allows another launch', () => {
    const pending = reduceMobileShell(initialMobileShellState, launch, access).state;
    const acknowledged = reduceMobileShell(pending, {
      type: 'launchResult', requestId: launch.requestId, result: { ok: true, runId: second },
    }, access).state;
    const missing = reduceMobileShell(acknowledged, { type: 'runsChanged' }, access);
    expect(missing.state).toEqual(initialMobileShellState);
    expect(missing.effects).toEqual([{
      type: 'launchUnavailable', message: 'Launched run closed or is unavailable. Launch again to start a new run.',
    }]);
    const retry = { type: 'launch', requestId: 'viewer-a-request-2' } as const;
    expect(reduceMobileShell(missing.state, retry, access).effects).toEqual([retry]);
    expect(reduceMobileShell(missing.state, { type: 'runsChanged' }, launchedAccess).effects)
      .toEqual([{ type: 'select', runId: first }]);
  });
  it('cleans a missing selected run while awaiting acknowledged inventory and on its cancellation', () => {
    const pending = reduceMobileShell({ ...initialMobileShellState, selectedRunId: first }, launch, access).state;
    const empty = { ...access, runs: [] };
    const acknowledged = reduceMobileShell(pending, {
      type: 'launchResult', requestId: launch.requestId, result: { ok: true, runId: second },
    }, empty);
    expect(acknowledged.state.selectedRunId).toBeUndefined();
    expect(acknowledged.state.pendingLaunch?.acknowledgedRunId).toBe(second);
    expect(acknowledged.effects).toEqual([{ type: 'select', runId: undefined }]);
    const staleSelected = { ...acknowledged.state, selectedRunId: first };
    const cancelled = reduceMobileShell(staleSelected, { type: 'runsChanged' }, empty);
    expect(cancelled.state).toEqual(initialMobileShellState);
    expect(cancelled.effects).toEqual([
      { type: 'select', runId: undefined },
      { type: 'launchUnavailable', message: 'Launched run closed or is unavailable. Launch again to start a new run.' },
    ]);
  });
  it('failed launch cannot select an unrelated run, and stale results cannot complete a later intent', () => {
    const pending = reduceMobileShell(initialMobileShellState, launch, access).state;
    const failed = reduceMobileShell(pending, {
      type: 'launchResult', requestId: launch.requestId, result: { ok: false, message: 'fixture failure' },
    }, launchedAccess);
    expect(failed).toEqual({ state: initialMobileShellState,
      effects: [{ type: 'launchUnavailable', message: 'Launch failed: fixture failure' }] });
    const laterInventory = reduceMobileShell(failed.state, { type: 'runsChanged' }, launchedAccess);
    expect(laterInventory.state.selectedRunId).toBe(first);
    expect(laterInventory.state.view).toBe('office');
    expect(laterInventory.effects).toEqual([{ type: 'select', runId: first }]);
    const retry = reduceMobileShell(failed.state, { type: 'launch', requestId: 'viewer-a-request-2' }, launchedAccess);
    for (const result of [{ ok: true, runId: second }, { ok: false, message: 'stale failure' }] as const) {
      expect(reduceMobileShell(retry.state, {
        type: 'launchResult', requestId: launch.requestId, result,
      }, launchedAccess)).toEqual({ state: retry.state, effects: [] });
    }
    const disconnected = reduceMobileShell(pending, { type: 'disconnect' }, access);
    expect(reduceMobileShell(disconnected.state, {
      type: 'launchResult', requestId: launch.requestId, result: { ok: true, runId: second },
    }, launchedAccess)).toEqual(disconnected);
  });
});
