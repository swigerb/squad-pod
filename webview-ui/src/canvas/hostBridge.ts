import { CANVAS_CHARTER_UNAVAILABLE, type CanvasHostBridge, type CanvasHostRequest, type CanvasHostResult } from '../../../src/core/canvasHost.js';
import { isObserverLayout } from '../../../standalone/src/events.js';

export const HOST_UNAVAILABLE = 'Host capability unavailable or rejected. Outcome unconfirmed; no automatic retry.';
export { CANVAS_CHARTER_UNAVAILABLE };

/** The server confirmed a local per-member charter refusal; the host capability is unaffected. */
class CharterRefusal extends Error {}

export function createHostBridge(request: typeof fetch, isDisposed: () => boolean,
  failure: (reason: string) => void, capabilities?: unknown): CanvasHostBridge {
  async function call(input: CanvasHostRequest): Promise<Extract<CanvasHostResult, { ok: true }>> {
    try {
      if (isDisposed()) throw new Error();
      const response = await request('/canvas-host', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok || isDisposed()) throw new Error();
      const value: CanvasHostResult = await response.json();
      if (isDisposed() || !value) throw new Error();
      // Exact known shape only; any other refusal stays an uncertain host failure.
      if (input.operation === 'charter' && value.ok === false && value.failure === 'request'
        && value.reason === CANVAS_CHARTER_UNAVAILABLE && Object.keys(value).length === 3) throw new CharterRefusal();
      if (value.ok !== true) throw new Error();
      return value;
    } catch (error) { throw error instanceof CharterRefusal ? error : new Error(HOST_UNAVAILABLE); }
  }
  const bridge: CanvasHostBridge = {
    charter: false, usage: false, export: false,
    async openCharter(slug) {
      try { await call({ operation: 'charter', slug }); }
      catch (error) {
        if (error instanceof CharterRefusal) { failure(CANVAS_CHARTER_UNAVAILABLE); throw new Error(CANVAS_CHARTER_UNAVAILABLE); }
        bridge.charter = false; failure(HOST_UNAVAILABLE); throw new Error(HOST_UNAVAILABLE);
      }
    },
    async getUsage() {
      try {
        const result = await call({ operation: 'usage' });
        if (!Array.isArray(result.quantities) || result.quantities.length > 4
          || result.quantities.some(q => !q || typeof q.label !== 'string' || typeof q.unit !== 'string'
            || q.label.length > 128 || q.unit.length > 64 || !Number.isFinite(q.value) || q.value < 0)) throw new Error();
        return result.quantities;
      } catch { bridge.usage = false; failure(HOST_UNAVAILABLE); throw new Error(HOST_UNAVAILABLE); }
    },
    async exportLayout(content) {
      try {
        const result = await call({ operation: 'export', content });
        if (typeof result.path !== 'string' || !/^squad-pod-layout-[a-f0-9-]{36}\.json$/.test(result.path)) throw new Error();
        return result.path;
      } catch { bridge.export = false; failure(HOST_UNAVAILABLE); throw new Error(HOST_UNAVAILABLE); }
    },
    async importLayout(path) {
      try {
        const result = await call({ operation: 'import', path });
        if (!isObserverLayout(result.layout)) throw new Error();
        return result.layout;
      } catch { failure(HOST_UNAVAILABLE); throw new Error(HOST_UNAVAILABLE); }
    },
  };
  if (capabilities && typeof capabilities === 'object') {
    bridge.charter = 'charter' in capabilities && capabilities.charter === true;
    bridge.usage = 'usage' in capabilities && capabilities.usage === true;
    bridge.export = 'export' in capabilities && capabilities.export === true;
  }
  return bridge;
}
