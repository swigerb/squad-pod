import { describe, expect, it, vi } from 'vitest';
import { CANVAS_CHARTER_UNAVAILABLE, createHostBridge, HOST_UNAVAILABLE } from './hostBridge.js';

const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const capabilities = { charter: true, usage: true, export: true };
const layout = { version: 2, cols: 1, rows: 1, tiles: [1], furniture: [] };

describe('host bridge explicit-gesture RPC boundary', () => {
  it('does not call host methods while detecting advertised support', () => {
    const request = vi.fn<typeof fetch>();
    const bridge = createHostBridge(request, () => false, vi.fn(), capabilities);
    expect([bridge.charter, bridge.usage, bridge.export]).toEqual([true, true, true]);
    expect(request).not.toHaveBeenCalled();
    const absent = createHostBridge(request, () => false, vi.fn());
    expect([absent.charter, absent.usage, absent.export]).toEqual([false, false, false]);
  });
  it('sends only scoped operation inputs; no session, root, canvas or export path can be injected', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response({ ok: true, quantities: [{ label: 'API time', value: 12, unit: 'ms' }] }))
      .mockResolvedValueOnce(response({ ok: true, path: 'squad-pod-layout-11111111-1111-1111-1111-111111111111.json' }))
      .mockResolvedValueOnce(response({ ok: true, layout }));
    const bridge = createHostBridge(request, () => false, vi.fn(), capabilities);
    await bridge.openCharter('test-bot');
    expect(await bridge.getUsage()).toEqual([{ label: 'API time', value: 12, unit: 'ms' }]);
    expect(await bridge.exportLayout(JSON.stringify(layout))).toBe('squad-pod-layout-11111111-1111-1111-1111-111111111111.json');
    expect(await bridge.importLayout('office.json')).toEqual(layout);
    expect(request.mock.calls.map(([url, init]) => [url, JSON.parse(init!.body as string)])).toEqual([
      ['/canvas-host', { operation: 'charter', slug: 'test-bot' }],
      ['/canvas-host', { operation: 'usage' }],
      ['/canvas-host', { operation: 'export', content: JSON.stringify(layout) }],
      ['/canvas-host', { operation: 'import', path: 'office.json' }],
    ]);
    expect(request.mock.calls.every(([, init]) => init?.credentials === 'same-origin' && init.method === 'POST'
      && init.cache === 'no-store' && !!init.signal)).toBe(true);
  });
  it.each([
    response({ ok: false, reason: 'PRIVATE C:\\path prompt' }),
    response({ ok: true, quantities: [{ label: 'tokens', value: -1, unit: 'tokens' }] }),
    response({ ok: true, quantities: null }),
    response({ ok: true }, false),
  ])('sanitizes usage rejections and invalid responses and marks the method unavailable', async reply => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(reply);
    const failed = vi.fn();
    const bridge = createHostBridge(request, () => false, failed, capabilities);
    await expect(bridge.getUsage()).rejects.toThrow(HOST_UNAVAILABLE);
    expect(bridge.usage).toBe(false);
    expect(failed).toHaveBeenCalledExactlyOnceWith(HOST_UNAVAILABLE);
    expect(request).toHaveBeenCalledOnce();
  });
  it('refuses disposed instances before and after the request without exposing SDK or network errors', async () => {
    let disposed = true;
    const request = vi.fn<typeof fetch>().mockImplementation(async () => { disposed = true; return response({ ok: true }); });
    const bridge = createHostBridge(request, () => disposed, vi.fn(), capabilities);
    await expect(bridge.openCharter('test-bot')).rejects.toThrow(HOST_UNAVAILABLE);
    expect(request).not.toHaveBeenCalled();
    disposed = false;
    await expect(bridge.openCharter('test-bot')).rejects.toThrow(HOST_UNAVAILABLE);
    expect(request).toHaveBeenCalledOnce();
  });
  it('does not accept an invalid import or arbitrary returned export destination', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ ok: true, layout: { cols: 0 } }))
      .mockResolvedValueOnce(response({ ok: true, path: '../PRIVATE.json' }));
    const bridge = createHostBridge(request, () => false, vi.fn(), capabilities);
    await expect(bridge.importLayout('office.json')).rejects.toThrow(HOST_UNAVAILABLE);
    await expect(bridge.exportLayout(JSON.stringify(layout))).rejects.toThrow(HOST_UNAVAILABLE);
    expect(bridge.export).toBe(false);
  });
  it('rechecks disposal after asynchronous JSON decoding and rejects the late result', async () => {
    let disposed = false;
    let resolve!: (value: unknown) => void;
    const request = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true, json: () => new Promise(done => { resolve = done; }),
    } as Response);
    const bridge = createHostBridge(request, () => disposed, vi.fn(), capabilities);
    const result = bridge.getUsage();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    disposed = true;
    resolve({ ok: true, quantities: [] });
    await expect(result).rejects.toThrow(HOST_UNAVAILABLE);
    expect(bridge.usage).toBe(false);
  });
  it('keeps charter available after an exact per-member local refusal and reports it explicitly', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ok: false, reason: CANVAS_CHARTER_UNAVAILABLE, failure: 'request' }))
      .mockResolvedValueOnce(response({ ok: true }));
    const failed = vi.fn();
    const bridge = createHostBridge(request, () => false, failed, capabilities);
    await expect(bridge.openCharter('cedar-a')).rejects.toThrow(CANVAS_CHARTER_UNAVAILABLE);
    expect(bridge.charter).toBe(true);
    expect(failed).toHaveBeenCalledExactlyOnceWith(CANVAS_CHARTER_UNAVAILABLE);
    await expect(bridge.openCharter('amber-a')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['forged reason', { ok: false, reason: 'PRIVATE C:\\path', failure: 'request' }],
    ['unknown failure class', { ok: false, reason: CANVAS_CHARTER_UNAVAILABLE, failure: 'host' }],
    ['extra keys', { ok: false, reason: CANVAS_CHARTER_UNAVAILABLE, failure: 'request', detail: 'x' }],
    ['unclassified', { ok: false, reason: CANVAS_CHARTER_UNAVAILABLE }],
  ])('treats a %s charter failure as an uncertain host failure and disables charter', async (_case, body) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(body));
    const failed = vi.fn();
    const bridge = createHostBridge(request, () => false, failed, capabilities);
    await expect(bridge.openCharter('cedar-a')).rejects.toThrow(HOST_UNAVAILABLE);
    expect(bridge.charter).toBe(false);
    expect(failed).toHaveBeenCalledExactlyOnceWith(HOST_UNAVAILABLE);
  });
  it('does not honor a request-class refusal for other operations', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ ok: false, reason: CANVAS_CHARTER_UNAVAILABLE, failure: 'request' }));
    const bridge = createHostBridge(request, () => false, vi.fn(), capabilities);
    await expect(bridge.getUsage()).rejects.toThrow(HOST_UNAVAILABLE);
    expect(bridge.usage).toBe(false);
  });
  it('rejects a local refusal that arrives after disposal as a host failure', async () => {
    let disposed = false;
    let resolve!: (value: unknown) => void;
    const request = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true, json: () => new Promise(done => { resolve = done; }),
    } as Response);
    const bridge = createHostBridge(request, () => disposed, vi.fn(), capabilities);
    const result = bridge.openCharter('cedar-a');
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    disposed = true;
    resolve({ ok: false, reason: CANVAS_CHARTER_UNAVAILABLE, failure: 'request' });
    await expect(result).rejects.toThrow(HOST_UNAVAILABLE);
    expect(bridge.charter).toBe(false);
  });
});
