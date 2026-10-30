import {
  decodeTerminalCommand, decodeTerminalEvent, runId, TERMINAL_LIMITS, utf8Bytes,
  type RunId, type TerminalCommand, type TerminalEvent,
} from './terminalFrames.js';

export const OWNED_TERMINAL_LIMITS = { runs: 128, messageCharacters: 1024 } as const;
export interface OwnedRun {
  runId: RunId;
  pid: number;
  state: 'running' | 'exited';
  exitCode: number | null;
}
export type OwnedTerminalCommand = TerminalCommand | { version: 1; type: 'list' | 'launch' };
export type OwnedTerminalEvent = TerminalEvent
  | { version: 1; type: 'runs'; available: boolean; reason: string | null; runs: OwnedRun[] }
  | { version: 1; type: 'error'; message: string };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new Error('Invalid terminal message'); }
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: string[]) {
  if (Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) {
    throw new Error('Invalid terminal message fields');
  }
}
function parse(json: string): Record<string, unknown> {
  if (json.length > TERMINAL_LIMITS.frameBytes || utf8Bytes(json) > TERMINAL_LIMITS.frameBytes) {
    throw new Error('Terminal frame exceeds byte limit');
  }
  const value = object(JSON.parse(json));
  if (value.version !== 1) { throw new Error('Unsupported terminal version'); }
  return value;
}
function message(value: unknown): value is string {
  return typeof value === 'string' && value.length <= OWNED_TERMINAL_LIMITS.messageCharacters;
}
export function decodeOwnedTerminalCommand(json: string): OwnedTerminalCommand {
  const value = parse(json);
  if (value.type === 'list' || value.type === 'launch') {
    exact(value, ['version', 'type']);
    return value as OwnedTerminalCommand;
  }
  return decodeTerminalCommand(json);
}
export function decodeOwnedTerminalEvent(json: string): OwnedTerminalEvent {
  const value = parse(json);
  if (value.type === 'error') {
    exact(value, ['version', 'type', 'message']);
    if (!message(value.message)) { throw new Error('Invalid terminal error'); }
    return value as OwnedTerminalEvent;
  }
  if (value.type === 'runs') {
    exact(value, ['version', 'type', 'available', 'reason', 'runs']);
    if (typeof value.available !== 'boolean' || !(value.reason === null || message(value.reason)) ||
        !Array.isArray(value.runs) || value.runs.length > OWNED_TERMINAL_LIMITS.runs) {
      throw new Error('Invalid terminal availability');
    }
    const identities = new Set<string>();
    for (const entry of value.runs) {
      const run = object(entry);
      exact(run, ['runId', 'pid', 'state', 'exitCode']);
      if (typeof run.runId !== 'string' || identities.has(run.runId) ||
          !Number.isSafeInteger(run.pid) || (run.pid as number) < 1 ||
          !['running', 'exited'].includes(run.state as string) ||
          !(run.exitCode === null || Number.isSafeInteger(run.exitCode)) ||
          (run.state === 'running' && run.exitCode !== null)) { throw new Error('Invalid owned run'); }
      runId(run.runId);
      identities.add(run.runId);
    }
    return value as OwnedTerminalEvent;
  }
  return decodeTerminalEvent(json);
}
