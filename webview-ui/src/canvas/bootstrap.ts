import { CANVAS_OBSERVER_CAPABILITIES } from '../../../src/core/hostCapabilities.js';
import { createBrowserClient, type BrowserHostClient } from '../standalone/browserClient.js';

export const CANVAS_EXPIRED = 'This Squad Pod canvas session expired. Reopen the canvas.';

/** A panel gets one exchange attempt, including concurrent callers and failures. */
export function createCanvasBootstrap(
  status: (state: string) => void,
  target: Pick<Window, 'location' | 'history'> = window,
  request: typeof fetch = fetch,
  createClient: typeof createBrowserClient = createBrowserClient,
): () => Promise<BrowserHostClient> {
  let pending: Promise<BrowserHostClient> | undefined;
  return () => pending ??= (async () => {
    let fragment = target.location.hash;
    try {
      // Scrub before the first asynchronous operation, even with an existing cookie.
      target.history.replaceState(null, '', target.location.pathname + target.location.search);
      let context = await request('/office-context', { credentials: 'same-origin', cache: 'no-store' });
      if (context.status === 401 || context.status === 403) {
        const values = new URLSearchParams(fragment.slice(1));
        fragment = '';
        const tokens = values.getAll('c');
        if (tokens.length !== 1 || !tokens[0] || tokens[0].length > 256) throw new Error();
        const response = await request('/auth', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: tokens[0] }),
        });
        if (!response.ok) throw new Error();
        context = await request('/office-context', { credentials: 'same-origin', cache: 'no-store' });
      }
      if (!context.ok) throw new Error();
      const identity: unknown = await context.json();
      if (!identity || typeof identity !== 'object' || !('serverIdentity' in identity)
        || typeof identity.serverIdentity !== 'string'
        || !/^[a-zA-Z0-9_-]{43}$/.test(identity.serverIdentity)) throw new Error();
      const client = createClient(state => status(
        state === 'Connecting' || state.startsWith('Connected') ? state : CANVAS_EXPIRED,
      ), undefined, target.location.origin);
      return { ...client, capabilities: CANVAS_OBSERVER_CAPABILITIES };
    } catch {
      throw new Error(CANVAS_EXPIRED);
    } finally {
      fragment = '';
    }
  })();
}
