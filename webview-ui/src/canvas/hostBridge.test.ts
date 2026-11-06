import { describe, expect, it, vi } from 'vitest';
import { CANVAS_CHARTER_UNAVAILABLE, CANVAS_HOST_BUSY, createHostBridge, HOST_UNAVAILABLE } from './hostBridge.js';

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

describe('#232 busy refusals keep every capability', () => {
  const busy = { ok: false, reason: CANVAS_HOST_BUSY, failure: 'request' };
  const path = 'squad-pod-layout-00000000-0000-4000-8000-000000000000.json';
  const operations = [
    ['charter', 'charter', (b: ReturnType<typeof createHostBridge>) => b.openCharter('amber-a'), { ok: true }],
    ['usage', 'usage', (b: ReturnType<typeof createHostBridge>) => b.getUsage(), { ok: true, quantities: [] }],
    ['export', 'export', (b: ReturnType<typeof createHostBridge>) => b.exportLayout('{}'), { ok: true, path }],
    ['import', null, (b: ReturnType<typeof createHostBridge>) => b.importLayout('layout.json'), { ok: true, layout }],
  ] as const;
  const pendingResponse = () => {
    let resolve!: (value: Response) => void;
    return { promise: new Promise<Response>(done => { resolve = done; }), resolve: (body: unknown) => resolve(response(body)) };
  };

  it.each(operations)('keeps %s available after an exact server busy refusal and sends the next request', async (_name, flag, run, success) => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response(busy)).mockResolvedValueOnce(response(success));
    const failed = vi.fn();
    const bridge = createHostBridge(request, () => false, failed, capabilities);
    await expect(run(bridge)).rejects.toThrow(CANVAS_HOST_BUSY);
    if (flag) expect(bridge[flag]).toBe(true);
    expect(failed).toHaveBeenCalledExactlyOnceWith(CANVAS_HOST_BUSY);
    await expect(run(bridge)).resolves.not.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['forged reason', { ok: false, reason: 'Busy C:\\private', failure: 'request' }],
    ['unknown failure class', { ok: false, reason: CANVAS_HOST_BUSY, failure: 'host' }],
    ['extra keys', { ok: false, reason: CANVAS_HOST_BUSY, failure: 'request', detail: 'x' }],
    ['unclassified', { ok: false, reason: CANVAS_HOST_BUSY }],
  ])('treats a %s busy-shaped response as an uncertain host failure', async (_case, body) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(body));
    const failed = vi.fn();
    const bridge = createHostBridge(request, () => false, failed, capabilities);
    await expect(bridge.openCharter('amber-a')).rejects.toThrow(HOST_UNAVAILABLE);
    await expect(bridge.getUsage()).rejects.toThrow(HOST_UNAVAILABLE);
    await expect(bridge.exportLayout('{}')).rejects.toThrow(HOST_UNAVAILABLE);
    expect([bridge.charter, bridge.usage, bridge.export]).toEqual([false, false, false]);
    expect(failed.mock.calls).toEqual([[HOST_UNAVAILABLE], [HOST_UNAVAILABLE], [HOST_UNAVAILABLE]]);
  });
  it('rejects a busy refusal that arrives after disposal as a host failure', async () => {
    let disposed = false;
    let resolve!: (value: unknown) => void;
    const request = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, json: () => new Promise(done => { resolve = done; }) } as Response);
    const bridge = createHostBridge(request, () => disposed, vi.fn(), capabilities);
    const result = bridge.openCharter('amber-a');
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    disposed = true;
    resolve(busy);
    await expect(result).rejects.toThrow(HOST_UNAVAILABLE);
    expect(bridge.charter).toBe(false);
  });
  it('joins a duplicate click on the member already opening: one request, no status, charter kept', async () => {
    const pending = pendingResponse();
    const request = vi.fn<typeof fetch>().mockReturnValueOnce(pending.promise);
    const failed = vi.fn();
    const bridge = createHostBridge(request, () => false, failed, capabilities);
    const first = bridge.openCharter('amber-a');
    const second = bridge.openCharter('amber-a');
    pending.resolve({ ok: true });
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(request).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
    expect(bridge.charter).toBe(true);
  });
  it.each([
    ['host rejection', { ok: false, reason: 'rejected' }, false, HOST_UNAVAILABLE, false],
    ['malformed response', { ok: 'yes' }, false, HOST_UNAVAILABLE, false],
    ['disposal before the result', { ok: true }, true, HOST_UNAVAILABLE, false],
    ['local member refusal', { ok: false, reason: CANVAS_CHARTER_UNAVAILABLE, failure: 'request' }, false, CANVAS_CHARTER_UNAVAILABLE, true],
  ])('rejects every joined caller after a %s, with one request and one report', async (_case, body, dispose, reason, kept) => {
    let disposed = false;
    const pending = pendingResponse();
    const request = vi.fn<typeof fetch>().mockReturnValueOnce(pending.promise);
    const failed = vi.fn();
    const bridge = createHostBridge(request, () => disposed, failed, capabilities);
    const first = bridge.openCharter('amber-a');
    const second = bridge.openCharter('amber-a');
    const third = bridge.openCharter('amber-a');
    expect(second).toBe(first);
    if (dispose) disposed = true;
    pending.resolve(body);
    const results = await Promise.allSettled([first, second, third]);
    expect(results).toEqual(Array(3).fill({ status: 'rejected', reason: new Error(reason) }));
    expect(failed).toHaveBeenCalledExactlyOnceWith(reason);
    expect(request).toHaveBeenCalledOnce();
    expect(bridge.charter).toBe(kept);
  });  it('refuses other operations locally while a host request is in flight, sending nothing', async () => {
    const pending = pendingResponse();
    const request = vi.fn<typeof fetch>().mockReturnValueOnce(pending.promise).mockResolvedValue(response({ ok: true }));
    const failed = vi.fn();
    const bridge = createHostBridge(request, () => false, failed, capabilities);
    const usage = bridge.getUsage();
    await expect(bridge.openCharter('amber-a')).rejects.toThrow(CANVAS_HOST_BUSY);
    await expect(bridge.getUsage()).rejects.toThrow(CANVAS_HOST_BUSY);
    await expect(bridge.exportLayout('{}')).rejects.toThrow(CANVAS_HOST_BUSY);
    await expect(bridge.importLayout('layout.json')).rejects.toThrow(CANVAS_HOST_BUSY);
    expect(request).toHaveBeenCalledOnce();
    expect([bridge.charter, bridge.usage, bridge.export]).toEqual([true, true, true]);
    expect(failed.mock.calls).toEqual(Array(4).fill([CANVAS_HOST_BUSY]));
    pending.resolve({ ok: true, quantities: [] });
    await expect(usage).resolves.toEqual([]);
    await expect(bridge.openCharter('amber-a')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('fails an overlapping call closed after disposal instead of reporting busy', async () => {
    let disposed = false;
    const pending = pendingResponse();
    const request = vi.fn<typeof fetch>().mockReturnValueOnce(pending.promise);
    const failed = vi.fn();
    const bridge = createHostBridge(request, () => disposed, failed, capabilities);
    const usage = bridge.getUsage();
    disposed = true;
    await expect(bridge.openCharter('amber-a')).rejects.toThrow(HOST_UNAVAILABLE);
    expect(bridge.charter).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    pending.resolve({ ok: true, quantities: [] });
    await expect(usage).rejects.toThrow(HOST_UNAVAILABLE);
    expect(failed).not.toHaveBeenCalledWith(CANVAS_HOST_BUSY);
  });
});
