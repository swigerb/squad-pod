import type { OwnedRun } from '../../../src/core/ownedTerminalProtocol.js';
import type { RunId } from '../../../src/core/terminalFrames.js';

// Navigation adapted from Pixel Agents v1.5.0 (b1bafd0), useMobileShell.ts.
// Roster identities never resolve to owned runs, even when their strings match.
export type MobileCard = { kind: 'observed'; agentId: string } | { kind: 'owned'; runId: RunId };
export type MobileView = 'office' | 'terminal';
export interface MobileShellState {
  view: MobileView;
  focused: MobileCard | null;
  selectedRunId: RunId | undefined;
  pendingLaunch: { requestId: string; acknowledgedRunId: RunId | null } | null;
}
export interface MobileTerminalAccess {
  authenticated: boolean;
  connected: boolean;
  available: boolean;
  ready: boolean;
  resync: boolean;
  runs: readonly OwnedRun[];
}
export type MobileShellEvent =
  | { type: 'card'; card: MobileCard }
  | { type: 'toggle' }
  | { type: 'showTerminal' }
  | { type: 'clearSelection' }
  | { type: 'launch'; requestId: string }
  // The adapter must supply a result from this viewer's correlated command,
  // not synthesize success from the globally broadcast run inventory.
  | { type: 'launchResult'; requestId: string; result: { ok: true; runId: RunId } | { ok: false; message: string } }
  | { type: 'runsChanged' }
  | { type: 'disconnect' };
export interface MobileShellStep {
  state: MobileShellState;
  effects: ({ type: 'launch'; requestId: string } | { type: 'select'; runId: RunId | undefined }
    | { type: 'launchUnavailable'; message: string })[];
}
export const initialMobileShellState: MobileShellState = {
  view: 'office', focused: null, selectedRunId: undefined, pendingLaunch: null,
};

export function terminalInputBlockReason(
  access: MobileTerminalAccess, selectedRunId: RunId | undefined,
): string | null {
  if (!access.authenticated) return 'Separate terminal authentication required.';
  if (!access.connected) return 'Terminal disconnected. The owned process was not terminated.';
  if (!access.available) return 'Terminals unavailable in this runtime.';
  if (access.resync) return 'Explicit terminal resync required.';
  if (!selectedRunId || !access.runs.some(run => run.runId === selectedRunId)) return 'Select an owned run.';
  if (access.runs.find(run => run.runId === selectedRunId)?.state !== 'running') return 'Owned run has exited.';
  if (!access.ready) return 'Waiting for terminal replay.';
  return null;
}

// Adapter contract: reduce inventories and correlated launch results in received
// order through a synchronous ref, never a lagged React render snapshot. Both
// success and failure must carry the requestId; generic error frames are not results.
export function reduceMobileShell(
  state: MobileShellState, event: MobileShellEvent, access: MobileTerminalAccess,
): MobileShellStep {
  const effects: MobileShellStep['effects'] = [];
  const canLaunch = access.authenticated && access.connected && access.available && !access.resync;
  const select = (runId: RunId | undefined) => {
    if (runId !== state.selectedRunId) effects.push({ type: 'select', runId });
    return runId;
  };
  const known = (card: MobileCard | null) =>
    card?.kind === 'owned' && access.runs.some(run => run.runId === card.runId) ? card.runId : undefined;
  const acknowledge = (pending: MobileShellState['pendingLaunch'], inventoryArrived = false): MobileShellStep => {
    const selected = access.runs.some(run => run.runId === state.selectedRunId) ? state.selectedRunId : undefined;
    const cleaned = { ...state, selectedRunId: selected };
    if (!canLaunch) return { state: { ...cleaned, selectedRunId: select(selected), pendingLaunch: null }, effects };
    const runId = pending?.acknowledgedRunId;
    if (!runId || !access.runs.some(run => run.runId === runId)) {
      select(selected);
      if (runId && inventoryArrived) effects.push({
        type: 'launchUnavailable', message: 'Launched run closed or is unavailable. Launch again to start a new run.',
      });
      return { state: { ...cleaned, pendingLaunch: runId && inventoryArrived ? null : pending }, effects };
    }
    return {
      state: { view: 'terminal', focused: { kind: 'owned', runId },
        selectedRunId: select(runId), pendingLaunch: null },
      effects,
    };
  };
  switch (event.type) {
    case 'launch':
      if (!canLaunch || state.pendingLaunch) return { state, effects };
      return {
        state: { ...state, pendingLaunch: { requestId: event.requestId, acknowledgedRunId: null } },
        effects: [{ type: 'launch', requestId: event.requestId }],
      };
    case 'launchResult':
      if (event.requestId !== state.pendingLaunch?.requestId) return { state, effects };
      if (!event.result.ok) {
        effects.push({ type: 'launchUnavailable', message: `Launch failed: ${event.result.message}` });
        const selected = access.runs.some(run => run.runId === state.selectedRunId)
          ? state.selectedRunId : undefined;
        return { state: { ...state, selectedRunId: select(selected), pendingLaunch: null }, effects };
      }
      return acknowledge({ requestId: event.requestId, acknowledgedRunId: event.result.runId });
    case 'runsChanged': {
      if (state.pendingLaunch?.acknowledgedRunId) return acknowledge(state.pendingLaunch, true);
      const selected = access.runs.some(run => run.runId === state.selectedRunId)
        ? state.selectedRunId : state.pendingLaunch ? undefined : access.runs[0]?.runId;
      return { state: { ...state, selectedRunId: select(selected),
        pendingLaunch: canLaunch ? state.pendingLaunch : null }, effects };
    }
    case 'disconnect':
      return { state: { ...state, pendingLaunch: null }, effects };
    case 'card': {
      if (access.resync) return { state, effects };
      const runId = known(event.card);
      const view = event.card.kind === 'owned' && runId ? 'terminal' : 'office';
      return { state: { ...state, view, focused: event.card, selectedRunId: select(runId) }, effects };
    }
    case 'toggle':
    case 'showTerminal':
      if (event.type === 'toggle' && state.view === 'terminal') return { state: { ...state, view: 'office' }, effects };
      return { state: { ...state, view: 'terminal',
        selectedRunId: state.focused && !access.resync ? select(known(state.focused)) : state.selectedRunId }, effects };
    case 'clearSelection':
      return { state: { ...state, selectedRunId: select(undefined) }, effects };
  }
}
