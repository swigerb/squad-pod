import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_OBSERVER_CAPABILITIES } from '../../../src/core/hostCapabilities.js';
import { createBrowserClient } from '../standalone/browserClient.js';
import { createCanvasBootstrap, CANVAS_EXPIRED } from './bootstrap.js';

const identity = { serverIdentity: 'a'.repeat(43), projectIdentity: null };
const response = (status: number, body: unknown = identity) =>
  ({ ok: status === 200, status, json: async () => body }) as Response;

describe('Canvas cookie-first single-use bootstrap', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/?panel=one#c=secret_credential');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('No storage'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('No storage'); });
  });
  afterEach(() => { window.history.replaceState(null, '', '/'); vi.restoreAllMocks(); });

  function fixture(responses: Response[]) {
    const request = vi.fn<typeof fetch>();
    for (const value of responses) request.mockResolvedValueOnce(value);
    const createClient = vi.fn<typeof createBrowserClient>();
    createClient.mockReturnValue({
      capabilities: CANVAS_OBSERVER_CAPABILITIES, send: vi.fn(), subscribe: vi.fn(),
      getState: vi.fn(), setState: <T>(value: T) => value, dispose: vi.fn(), discardPreferenceDraft: vi.fn(),
    });
    const status = vi.fn();
    return { request, createClient, status,
      bootstrap: createCanvasBootstrap(status, window, request, createClient) };
  }

  it('uses the cookie first, strips stale fragments immediately, and never exchanges on reload', async () => {
    const f = fixture([response(200)]);
    const pending = f.bootstrap();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname + window.location.search).toBe('/?panel=one');
    const client = await pending;
    expect(f.request.mock.calls).toEqual([['/office-context', { credentials: 'same-origin', cache: 'no-store' }]]);
    expect(client.capabilities).toBe(CANVAS_OBSERVER_CAPABILITIES);
    expect(f.createClient).toHaveBeenCalledWith(expect.any(Function), undefined, window.location.origin);
    const reload = fixture([response(200)]);
    await reload.bootstrap();
    expect(reload.request).toHaveBeenCalledTimes(1);
    expect(Storage.prototype.getItem).not.toHaveBeenCalled();
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
  });

  it.each([401, 403])('exchanges the decoded fragment once after unauthenticated %s, then validates context', async status => {
    window.history.replaceState(null, '', '/#c=encoded%5Fcredential');
    const f = fixture([response(status), response(200), response(200)]);
    const first = f.bootstrap();
    expect(f.bootstrap()).toBe(first);
    expect(window.location.hash).toBe('');
    await first;
    await f.bootstrap();
    expect(f.request.mock.calls.map(([url]) => url)).toEqual(['/office-context', '/auth', '/office-context']);
    expect(f.request.mock.calls[1][1]).toEqual({
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'encoded_credential' }),
    });
    expect(f.createClient).toHaveBeenCalledOnce();
  });

  it.each(['', '#c=', '#wrong=secret', '#c=one&c=two', `#c=${'a'.repeat(257)}`])(
    'rejects missing/ambiguous/oversized fragments %s without auth or client creation', async hash => {
      window.history.replaceState(null, '', '/' + hash);
      const f = fixture([response(403)]);
      await expect(f.bootstrap()).rejects.toThrow(CANVAS_EXPIRED);
      expect(window.location.hash).toBe('');
      expect(f.request).toHaveBeenCalledTimes(1);
      expect(f.createClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    [response(500)],
    [response(403), response(403)],
    [response(403), response(200), response(403)],
    [response(200, { serverIdentity: 'invalid' })],
  ])('fails closed without retries or leaking response details', async (...responses) => {
    const f = fixture(responses);
    const attempt = f.bootstrap();
    await expect(attempt).rejects.toThrow(CANVAS_EXPIRED);
    expect(f.bootstrap()).toBe(attempt);
    expect(window.location.hash).toBe('');
    expect(f.createClient).not.toHaveBeenCalled();
  });

  it('clears credentials on a network failure and reports a neutral error', async () => {
    const f = fixture([]);
    f.request.mockRejectedValue(new Error('secret_credential'));
    await expect(f.bootstrap()).rejects.toThrow(CANVAS_EXPIRED);
    expect(window.location.hash).toBe('');
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it('maps transport failures to Canvas recovery wording rather than console authentication', async () => {
    const f = fixture([response(200)]);
    await f.bootstrap();
    const onStatus = f.createClient.mock.calls[0][0];
    onStatus('Connecting');
    onStatus('Connected - read-only');
    onStatus('Connection failed - authenticate again if the credential was revoked');
    expect(f.status.mock.calls).toEqual([['Connecting'], ['Connected - read-only'], [CANVAS_EXPIRED]]);
  });

  it('reuses the real /office client and frame codec without credentials or recovery in its transport', async () => {
    const send = vi.fn();
    const socket = { readyState: WebSocket.OPEN, send, close: vi.fn(), onopen: null } as unknown as WebSocket;
    const createSocket = vi.fn(() => socket);
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(200));
    const bootstrap = createCanvasBootstrap(vi.fn(), window, request,
      (status, _, origin) => createBrowserClient(status, createSocket, origin));
    const client = await bootstrap();
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    try {
      expect(createSocket).toHaveBeenCalledWith(new URL('/office', window.location.origin).href.replace(/^http/, 'ws'));
      client.send({ type: 'webviewReady' });
      expect(send).toHaveBeenCalledWith(JSON.stringify({ version: 1, kind: 'office', message: { type: 'webviewReady' } }));
      socket.onmessage?.(new MessageEvent('message', { data: JSON.stringify({
        version: 1, kind: 'office', message: { type: 'settingsLoaded', soundEnabled: false, debugEnabled: false, showAreas: true },
      }) }));
      expect(listener).toHaveBeenCalledWith({ type: 'settingsLoaded', soundEnabled: false, debugEnabled: false, showAreas: true });
      expect(client.getState()).toBeUndefined();
      expect(() => client.setState({ token: 'must-not-persist' })).toThrow();
    } finally { unsubscribe(); client.dispose(); }
  });
});
