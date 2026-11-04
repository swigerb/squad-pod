/** Fixed, local-only startup diagnostics; never interpolate transport or exception data. */
export const CANVAS_DIAGNOSTICS = {
  BOOTSTRAP_FAILED: 'Canvas startup failed. Reopen the canvas.',
  NETWORK_FAILED: 'Canvas startup request could not complete (network or browser policy). Reopen the canvas.',
  VIEWER_BOOTSTRAP_MISSING: 'Viewer bootstrap is missing. Reopen the canvas.',
  VIEWER_BOOTSTRAP_INVALID: 'Viewer bootstrap is invalid. Reopen the canvas.',
  AUTH_REJECTED: 'Viewer authentication was rejected. Reopen the canvas.',
  AUTH_UNAVAILABLE: 'Viewer authentication is unavailable. Reopen the canvas.',
  OFFICE_CONTEXT_UNAVAILABLE: 'Office context is unavailable. Reopen the canvas.',
  OFFICE_CONTEXT_INVALID: 'Office context is invalid. Reopen the canvas.',
  OFFICE_STARTING: 'Office context accepted; waiting for the office client.',
  OFFICE_START_FAILED: 'Office client startup failed. Reopen the canvas.',
  WS_CONNECTING: 'Connecting to the office WebSocket.',
  WS_CONNECTED: 'Office WebSocket connected; waiting for office data.',
  WS_FAILED: 'Office WebSocket connection failed; authentication status is unknown.',
  WS_DISCONNECTED: 'Office WebSocket disconnected; only observation may reconnect. Drafts are not retried.',
  OFFICE_READY: 'Office roster received.',
  OFFICE_PROTOCOL_FAILED: 'Office data could not be accepted.',
  OFFICE_STATUS: 'Office status changed. Inspect retained drafts before deliberately retrying changes.',
} as const;
export type CanvasDiagnosticCode = keyof typeof CANVAS_DIAGNOSTICS;

/** Render only an allowlisted code and its fixed message. */
export function canvasDiagnostic(code: CanvasDiagnosticCode): string {
  return `[${code}] ${CANVAS_DIAGNOSTICS[code]}`;
}

/** A startup failure carries no response, cause, credential or arbitrary exception text. */
export class CanvasBootstrapError extends Error {
  constructor(readonly code: CanvasDiagnosticCode) { super(canvasDiagnostic(code)); }
}

/** Unknown exceptions are intentionally not rendered, even when they have a message. */
export function canvasBootstrapFailure(error: unknown): string {
  return canvasDiagnostic(error instanceof CanvasBootstrapError
    && Object.hasOwn(CANVAS_DIAGNOSTICS, error.code) ? error.code : 'BOOTSTRAP_FAILED');
}

/** Browser transport strings are classified, never copied into the native panel. */
export function canvasTransportStatus(state: string): string {
  const code = state === 'Connecting' ? 'WS_CONNECTING'
    : state === 'Connected - read-only' || state === 'Connected - selected-project office control' ? 'WS_CONNECTED'
    : state === 'Connection failed - authenticate again if the credential was revoked' ? 'WS_FAILED'
    : state === 'Disconnected - retrying observation only; authenticate again after rotation'
      || state === 'Disconnected' || state === 'Disconnected - request not sent' ? 'WS_DISCONNECTED'
    : state === 'Invalid server frame - disconnected' || state.startsWith('Protocol error: ') ? 'OFFICE_PROTOCOL_FAILED'
    : 'OFFICE_STATUS';
  return canvasDiagnostic(code);
}
