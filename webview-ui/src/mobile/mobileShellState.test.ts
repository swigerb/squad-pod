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
describe('mobile navigation without process lifecycle side effects', () => {
  it('starts on office even with live runs, and opens only a new run after deliberate launch', () => {
    const initial = reduceMobileShell(initialMobileShellState, { type: 'runsChanged' }, access);
    expect(initial.state).toEqual(initialMobileShellState);
    expect(initial.effects).toEqual([]);
    const requested = reduceMobileShell(initial.state, { type: 'launch' }, access);
    expect(requested.effects).toEqual([{ type: 'launch' }]);
    expect(requested.state.view).toBe('office');
    expect(reduceMobileShell(requested.state, { type: 'launch' }, access).effects).toEqual([]);
    const unchanged = reduceMobileShell(requested.state, { type: 'runsChanged' }, access);
    expect(unchanged.state.pendingLaunch).toEqual([first]);
    const opened = reduceMobileShell(unchanged.state, { type: 'runsChanged' }, {
      ...access, runs: [...access.runs, { runId: second, pid: 2, state: 'running', exitCode: null }],
    });
    expect(opened.state).toEqual({
      view: 'terminal', focused: { kind: 'owned', runId: second }, selectedRunId: second, pendingLaunch: null,
    });
    expect(opened.effects).toEqual([{ type: 'select', runId: second }]);
  });
  it('keeps card focus, repeat tap, toggle and swipe navigation on one selected owned run', () => {
    const focused = reduceMobileShell(initialMobileShellState, { type: 'card', card }, access);
    expect(focused.state.view).toBe('office');
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
    const pending = reduceMobileShell(initialMobileShellState, { type: 'launch' }, access).state;
    for (const type of ['disconnect', 'launchFailed'] as const) {
      const cancelled = reduceMobileShell(pending, { type }, access);
      expect(cancelled.state.pendingLaunch).toBeNull();
      expect(cancelled.effects).toEqual([]);
    }
  });
  it.each(['authenticated', 'connected', 'available'] as const)('blocks launch without %s', key => {
    expect(reduceMobileShell(initialMobileShellState, { type: 'launch' }, { ...access, [key]: false }).effects).toEqual([]);
  });
  it('blocks launch and input during resync; disconnect/revocation retain process identity', () => {
    expect(reduceMobileShell(initialMobileShellState, { type: 'launch' }, { ...access, resync: true }).effects).toEqual([]);
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
    const pending = reduceMobileShell(initialMobileShellState, { type: 'launch' }, access).state;
    const revoked = reduceMobileShell(pending, { type: 'runsChanged' }, {
      ...access, authenticated: false, runs: [...access.runs, { runId: second, pid: 2, state: 'running', exitCode: null }],
    });
    expect(revoked.state.view).toBe('office');
    expect(revoked.state.pendingLaunch).toBeNull();
    expect(revoked.effects).toEqual([]);
  });
});
