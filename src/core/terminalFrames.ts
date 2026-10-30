declare const runIdBrand: unique symbol;
/** An opaque runtime-issued identity, not an authorization credential. */
export type RunId = string & { readonly [runIdBrand]: true };

export const TERMINAL_VERSION = 1;
export const TERMINAL_LIMITS = {
  frameBytes: 64 * 1024,
  inputBytes: 16 * 1024,
  historyBytes: 1024 * 1024,
  historyFrames: 4096,
  pendingBytes: 1024 * 1024,
  pendingFrames: 4096,
} as const;

export type ResyncReason = 'history-gap' | 'cursor-ahead' | 'overflow' | 'source-error';
type Base = { version: 1; runId: RunId };
export type TerminalCommand = Base & (
  | { type: 'attach'; cursor: number }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'terminate' }
);
export type OutputFrame = Base & { type: 'output'; seq: number; data: string };
export type TerminalEvent = OutputFrame | (Base & (
  | { type: 'replayStart'; cursor: number; through: number }
  | { type: 'replayEnd'; through: number }
  | { type: 'resync'; reason: ResyncReason; earliest: number; latest: number }
));
export type TerminalFrame = TerminalCommand | TerminalEvent;

export function runId(value: string): RunId {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) { throw new Error('Invalid run identity'); }
  return value as RunId;
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function validUnicode(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) { return false; }
    } else if (code >= 0xdc00 && code <= 0xdfff) { return false; }
  }
  return true;
}

/** Strict JSON boundary: reject extra fields as well as unknown versions and kinds. */
export function decodeTerminalFrame(json: string): TerminalFrame {
  if (json.length > TERMINAL_LIMITS.frameBytes || utf8Bytes(json) > TERMINAL_LIMITS.frameBytes) {
    throw new Error('Terminal frame exceeds byte limit');
  }
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new Error('Invalid terminal frame'); }
  const frame = value as Record<string, unknown>;
  if (frame.version !== TERMINAL_VERSION || typeof frame.runId !== 'string') {
    throw new Error('Unsupported terminal version or identity');
  }
  runId(frame.runId);
  let fields: string[];
  let valid: boolean;
  switch (frame.type) {
    case 'attach':
      fields = ['cursor'];
      valid = integer(frame.cursor);
      break;
    case 'input':
      fields = ['data'];
      valid = typeof frame.data === 'string' && validUnicode(frame.data) &&
        utf8Bytes(frame.data) <= TERMINAL_LIMITS.inputBytes;
      break;
    case 'resize':
      fields = ['cols', 'rows'];
      valid = integer(frame.cols, 1, 1000) && integer(frame.rows, 1, 1000);
      break;
    case 'terminate':
      fields = [];
      valid = true;
      break;
    case 'output':
      fields = ['seq', 'data'];
      valid = integer(frame.seq, 1) && typeof frame.data === 'string' &&
        frame.data.length > 0 && validUnicode(frame.data);
      break;
    case 'replayStart':
      fields = ['cursor', 'through'];
      valid = integer(frame.cursor) && integer(frame.through) && frame.through >= frame.cursor;
      break;
    case 'replayEnd':
      fields = ['through'];
      valid = integer(frame.through);
      break;
    case 'resync':
      fields = ['reason', 'earliest', 'latest'];
      valid = typeof frame.reason === 'string' &&
        ['history-gap', 'cursor-ahead', 'overflow', 'source-error'].includes(frame.reason) &&
        integer(frame.earliest, 1) && integer(frame.latest) && frame.earliest <= frame.latest + 1;
      break;
    default:
      throw new Error('Unsupported terminal message');
  }
  const keys = ['version', 'runId', 'type', ...fields];
  if (!valid || Object.keys(frame).some(key => !keys.includes(key))) { throw new Error('Invalid terminal fields'); }
  return value as TerminalFrame;
}

export function encodeTerminalFrame(frame: TerminalFrame): string {
  const json = JSON.stringify(frame);
  decodeTerminalFrame(json);
  return json;
}

export function decodeTerminalCommand(json: string): TerminalCommand {
  const frame = decodeTerminalFrame(json);
  if (frame.type === 'attach' || frame.type === 'input' || frame.type === 'resize' || frame.type === 'terminate') {
    return frame;
  }
  throw new Error('Expected terminal command');
}

export function decodeTerminalEvent(json: string): TerminalEvent {
  const frame = decodeTerminalFrame(json);
  if (frame.type === 'output' || frame.type === 'replayStart' || frame.type === 'replayEnd' || frame.type === 'resync') {
    return frame;
  }
  throw new Error('Expected terminal event');
}

export type RunEntry =
  | { kind: 'owned'; runId: RunId }
  | { kind: 'observed'; observationId: string };

export function terminalCapabilities(entry: RunEntry) {
  const owned = entry.kind === 'owned';
  return { attach: owned, input: owned, resize: owned, terminate: owned };
}

/** Entries must come from the runtime's private registry, never a client-supplied descriptor. */
export function authorizeTerminal(entry: RunEntry, command: TerminalCommand): void {
  if (entry.kind !== 'owned' || entry.runId !== command.runId) {
    throw new Error('Terminal authority requires the matching owned run');
  }
}
