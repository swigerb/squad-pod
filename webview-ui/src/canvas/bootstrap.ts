import { CANVAS_CONTROL_CAPABILITIES, CANVAS_OBSERVER_CAPABILITIES } from '../../../src/core/hostCapabilities.js';
import { createBrowserClient, type BrowserHostClient } from '../standalone/browserClient.js';
import type { PreferenceMutation } from '../../../standalone/src/officePreferences.js';
import { CanvasBootstrapError, canvasDiagnostic, canvasTransportStatus, type CanvasDiagnosticCode } from './diagnostics.js';
import { CANVAS_CHARTER_UNAVAILABLE, createHostBridge, HOST_UNAVAILABLE } from './hostBridge.js';

export const CANVAS_EDIT_FAILED = 'Editing authority or recovery storage unavailable. No office changes were sent; existing drafts were kept. Reopen the canvas or recover its browser storage.';
export interface CanvasHostClient extends BrowserHostClient {
  enableEditing?: (onPreferenceDraft: (draft: PreferenceMutation | null) => void) => Promise<BrowserHostClient>;
}

/** A panel gets one exchange attempt, including concurrent callers and failures. */
export function createCanvasBootstrap(
  status: (state: string) => void,
  target: Pick<Window, 'location' | 'history'> = window,
  request: typeof fetch = fetch,
  createClient: typeof createBrowserClient = createBrowserClient,
): () => Promise<CanvasHostClient> {
  let pending: Promise<CanvasHostClient> | undefined;
  return () => pending ??= (async () => {
    let fragment = target.location.hash;
    let disposed = false;
    let failure: CanvasDiagnosticCode = 'BOOTSTRAP_FAILED';
    const fetchStartup: typeof fetch = async (...args) => {
      try { return await request(...args); }
      catch { throw new CanvasBootstrapError('NETWORK_FAILED'); }
    };
    const onStatus = (state: string) => status(state === HOST_UNAVAILABLE || state === CANVAS_CHARTER_UNAVAILABLE
      || /^Layout JSON exported to this session's workspace files: squad-pod-layout-[a-f0-9-]{36}\.json$/.test(state)
      ? state : canvasTransportStatus(state));
    const observe = (client: BrowserHostClient): BrowserHostClient => ({
      ...client,
      subscribe(listener) {
        try {
          return client.subscribe(message => {
            if (message.type === 'existingAgents') status(canvasDiagnostic('OFFICE_READY'));
            listener(message);
          });
        } catch {
          client.dispose();
          status(canvasDiagnostic('OFFICE_START_FAILED'));
          throw new CanvasBootstrapError('OFFICE_START_FAILED');
        }
      },
    });
    try {
      // Scrub before the first asynchronous operation, even with an existing cookie.
      target.history.replaceState(null, '', target.location.pathname + target.location.search);
      const values = new URLSearchParams(fragment.slice(1));
      fragment = '';
      let context = await fetchStartup('/office-context', { credentials: 'same-origin', cache: 'no-store' });
      if (context.status === 401 || context.status === 403) {
        const tokens = values.getAll('c');
        if (tokens.length === 0) throw new CanvasBootstrapError('VIEWER_BOOTSTRAP_MISSING');
        if (tokens.length !== 1 || !tokens[0] || tokens[0].length > 256) {
          throw new CanvasBootstrapError('VIEWER_BOOTSTRAP_INVALID');
        }
        const response = await fetchStartup('/auth', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tokens[0] }),
        });
        if (!response.ok) throw new CanvasBootstrapError(
          response.status === 401 || response.status === 403 ? 'AUTH_REJECTED' : 'AUTH_UNAVAILABLE');
        context = await fetchStartup('/office-context', { credentials: 'same-origin', cache: 'no-store' });
        if (context.status === 401 || context.status === 403) throw new CanvasBootstrapError('AUTH_REJECTED');
      }
      if (!context.ok) throw new CanvasBootstrapError('OFFICE_CONTEXT_UNAVAILABLE');
      failure = 'OFFICE_CONTEXT_INVALID';
      const identity: unknown = await context.json();
      if (!identity || typeof identity !== 'object' || !('serverIdentity' in identity)
        || typeof identity.serverIdentity !== 'string'
        || !/^[a-zA-Z0-9_-]{43}$/.test(identity.serverIdentity)) throw new Error();
      failure = 'OFFICE_START_FAILED';
      status(canvasDiagnostic('OFFICE_STARTING'));
      const bridge = createHostBridge(request, () => disposed, status,
        'hostCapabilities' in identity ? identity.hostCapabilities : undefined);
      const client = observe(createClient(onStatus, undefined, target.location.origin, undefined, true, bridge));
      let editing: Promise<BrowserHostClient> | undefined;
      return {
        ...client, capabilities: CANVAS_OBSERVER_CAPABILITIES,
        dispose() { disposed = true; client.dispose(); },
        enableEditing(onPreferenceDraft) {
          return editing ??= (async () => {
            try {
              if (disposed) throw new Error();
              let response = await request('/office-context', { credentials: 'same-origin', cache: 'no-store' });
              let context: unknown = response.ok ? await response.json() : null;
              if (!(context && typeof context === 'object' && 'controlAuthorized' in context && context.controlAuthorized === true)) {
                response = await request('/control-intent', {
                  method: 'POST', credentials: 'same-origin', cache: 'no-store',
                });
                const challenge: unknown = response.ok ? await response.json() : null;
                if (disposed || !challenge || typeof challenge !== 'object'
                  || !('nonce' in challenge) || typeof challenge.nonce !== 'string'
                  || !/^[a-zA-Z0-9_-]{43}$/.test(challenge.nonce)) throw new Error();
                response = await request('/control-auth', {
                  method: 'POST', credentials: 'same-origin', cache: 'no-store',
                  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: challenge.nonce }),
                });
                if (!response.ok) throw new Error();
                response = await request('/office-context', { credentials: 'same-origin', cache: 'no-store' });
                context = response.ok ? await response.json() : null;
              }
              if (disposed || !context || typeof context !== 'object'
                || !('serverIdentity' in context) || context.serverIdentity !== identity.serverIdentity
                || !('projectIdentity' in context) || typeof context.projectIdentity !== 'string'
                || !/^[a-f0-9]{64}$/.test(context.projectIdentity)
                || !('controlAuthorized' in context) || context.controlAuthorized !== true) throw new Error();
              let controlDisposed = false;
              const controlBridge = createHostBridge(request, () => controlDisposed, status,
                'hostCapabilities' in context ? context.hostCapabilities : undefined);
              const control = observe(createClient(onStatus,
                undefined, target.location.origin, {
                recoveryKey: `squad-office:${context.serverIdentity}:${context.projectIdentity}`, onPreferenceDraft,
              }, true, controlBridge));
              try { control.getState(); }
              catch (error) { control.dispose(); throw error; }
              return { ...control, capabilities: CANVAS_CONTROL_CAPABILITIES,
                dispose() { controlDisposed = true; control.dispose(); } };
            } catch { throw new Error(CANVAS_EDIT_FAILED); }
          })();
        },
      };
    } catch (error) {
      throw error instanceof CanvasBootstrapError ? error : new CanvasBootstrapError(failure);
    } finally {
      fragment = '';
    }
  })();
}
