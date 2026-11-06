import {
  CANVAS_CHARTER_UNAVAILABLE, CANVAS_HOST_BUSY,
  type CanvasHostBridge, type CanvasHostRequest, type CanvasHostResult,
} from '../../../src/core/canvasHost.js';
import { isObserverLayout } from '../../../standalone/src/events.js';

export const HOST_UNAVAILABLE = 'Host capability unavailable or rejected. Outcome unconfirmed; no automatic retry.';
export { CANVAS_CHARTER_UNAVAILABLE, CANVAS_HOST_BUSY };

/** A confirmed request refusal with no host call; the capability is unaffected. `message` is the exact reason. */
class RequestRefusal extends Error {}

export function createHostBridge(request: typeof fetch, isDisposed: () => boolean,
  failure: (reason: string) => void, capabilities?: unknown): CanvasHostBridge {
  // Single flight per bridge; the server's typed busy refusal covers other bridges and viewers.
  let pending: { slug?: string; settled: Promise<void> } | undefined;
  function track<T>(slug: string | undefined, run: () => Promise<T>): Promise<T> {
    const promise = run();
    const settled = promise.then(() => undefined, () => undefined);
    const entry = { slug, settled };
    pending = entry;
    void settled.then(() => { if (pending === entry) pending = undefined; });
    return promise;
  }
  /** Overlap refused before sending anything. After disposal, fall through so the call fails closed. */
  function overlapping(slug?: string): Promise<void> | undefined {
    if (!pending || isDisposed()) return undefined;
    if (slug !== undefined && pending.slug === slug) return pending.settled;
    throw new RequestRefusal(CANVAS_HOST_BUSY);
  }
  function refused(error: unknown): never {
    if (error instanceof RequestRefusal) { failure(error.message); throw new Error(error.message); }
    throw error;
  }
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
      // Exact known shapes only; any other refusal stays an uncertain host failure.
      if (value.ok === false && value.failure === 'request' && Object.keys(value).length === 3
        && (value.reason === CANVAS_HOST_BUSY || (input.operation === 'charter' && value.reason === CANVAS_CHARTER_UNAVAILABLE))) {
        throw new RequestRefusal(value.reason);
      }
      if (value.ok !== true) throw new Error();
      return value;
    } catch (error) { throw error instanceof RequestRefusal ? error : new Error(HOST_UNAVAILABLE); }
  }
  const bridge: CanvasHostBridge = {
    charter: false, usage: false, export: false,
    async openCharter(slug) {
      try {
        // A duplicate click on the member already opening joins that request; its outcome is reported once.
        const joined = overlapping(slug);
        if (joined) return await joined;
        await track(slug, () => call({ operation: 'charter', slug }));
      } catch (error) {
        if (error instanceof RequestRefusal) refused(error);
        bridge.charter = false; failure(HOST_UNAVAILABLE); throw new Error(HOST_UNAVAILABLE);
      }
    },
    async getUsage() {
      try {
        overlapping();
        const result = await track(undefined, () => call({ operation: 'usage' }));
        if (!Array.isArray(result.quantities) || result.quantities.length > 4
          || result.quantities.some(q => !q || typeof q.label !== 'string' || typeof q.unit !== 'string'
            || q.label.length > 128 || q.unit.length > 64 || !Number.isFinite(q.value) || q.value < 0)) throw new Error();
        return result.quantities;
      } catch (error) {
        if (error instanceof RequestRefusal) refused(error);
        bridge.usage = false; failure(HOST_UNAVAILABLE); throw new Error(HOST_UNAVAILABLE);
      }
    },
    async exportLayout(content) {
      try {
        overlapping();
        const result = await track(undefined, () => call({ operation: 'export', content }));
        if (typeof result.path !== 'string' || !/^squad-pod-layout-[a-f0-9-]{36}\.json$/.test(result.path)) throw new Error();
        return result.path;
      } catch (error) {
        if (error instanceof RequestRefusal) refused(error);
        bridge.export = false; failure(HOST_UNAVAILABLE); throw new Error(HOST_UNAVAILABLE);
      }
    },
    async importLayout(path) {
      try {
        overlapping();
        const result = await track(undefined, () => call({ operation: 'import', path }));
        if (!isObserverLayout(result.layout)) throw new Error();
        return result.layout;
      } catch (error) {
        if (error instanceof RequestRefusal) refused(error);
        failure(HOST_UNAVAILABLE); throw new Error(HOST_UNAVAILABLE);
      }
    },
  };
  if (capabilities && typeof capabilities === 'object') {
    bridge.charter = 'charter' in capabilities && capabilities.charter === true;
    bridge.usage = 'usage' in capabilities && capabilities.usage === true;
    bridge.export = 'export' in capabilities && capabilities.export === true;
  }
  return bridge;
}