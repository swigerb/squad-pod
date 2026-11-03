import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_CONTROL_CAPABILITIES, CANVAS_OBSERVER_CAPABILITIES } from '../../../src/core/hostCapabilities.js';
import { createBrowserClient } from '../standalone/browserClient.js';
import { createCanvasBootstrap, CANVAS_EDIT_FAILED, CANVAS_EXPIRED } from './bootstrap.js';

const identity = { serverIdentity: 'a'.repeat(43), projectIdentity: null };
const response = (status: number, body: unknown = identity) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

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

  it('does not exchange control authority until opt-in, then uses a separate single-use credential and instance recovery key', async () => {
    window.history.replaceState(null, '', '/#c=viewer&e=control%5Fsecret');
    const viewer = { ...identity, projectIdentity: 'b'.repeat(64), controlAuthorized: false };
    const authorized = { ...viewer, controlAuthorized: true };
    const f = fixture([response(200, viewer), response(200, viewer), response(204), response(200, authorized)]);
    const client = await f.bootstrap();
    expect(f.request).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe('');
    expect(Storage.prototype.getItem).not.toHaveBeenCalled();
    const draft = vi.fn();
    const pending = client.enableEditing!(draft);
    expect(client.enableEditing!(draft)).toBe(pending);
    const control = await pending;
    expect(control.capabilities).toBe(CANVAS_CONTROL_CAPABILITIES);
    expect(f.request.mock.calls.map(([url]) => url)).toEqual([
      '/office-context', '/office-context', '/control-auth', '/office-context',
    ]);
    expect(f.request.mock.calls[2][1]).toEqual({
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'control_secret' }),
    });
    expect(f.createClient.mock.calls[1][3]).toEqual({
      recoveryKey: `squad-office:${identity.serverIdentity}:${viewer.projectIdentity}`, onPreferenceDraft: draft,
    });
    expect(control.getState).toHaveBeenCalledOnce();
    const onStatus = f.createClient.mock.calls[1][0];
    onStatus('Disconnected before save acknowledgement. Draft retained');
    onStatus('Disconnected - retrying observation only; authenticate again after rotation');
    expect(f.status.mock.calls).toEqual([
      ['Disconnected before save acknowledgement. Draft retained'], [CANVAS_EXPIRED],
    ]);
  });

  it('requires an explicit opt-in again on reload even with a control cookie; reuses only that instance’s recovery identity', async () => {
    window.history.replaceState(null, '', '/');
    const authorized = { ...identity, projectIdentity: 'b'.repeat(64), controlAuthorized: true };
    const f = fixture([response(200, authorized), response(200, authorized)]);
    const client = await f.bootstrap();
    expect(client.capabilities).toBe(CANVAS_OBSERVER_CAPABILITIES);
    expect(f.createClient).toHaveBeenCalledOnce();
    expect(f.createClient.mock.calls[0][3]).toBeUndefined();
    await client.enableEditing!(vi.fn());
    expect(f.request.mock.calls.map(([url]) => url)).toEqual(['/office-context', '/office-context']);
    expect(f.createClient.mock.calls[1][3]?.recoveryKey).toBe(
      `squad-office:${identity.serverIdentity}:${authorized.projectIdentity}`);
  });

  it.each([
    { ...identity, projectIdentity: 'b'.repeat(64), controlAuthorized: false },
    { ...identity, projectIdentity: 'invalid', controlAuthorized: true },
    { ...identity, serverIdentity: 'z'.repeat(43), projectIdentity: 'b'.repeat(64), controlAuthorized: true },
  ])('fails closed on absent, revoked or substituted control authority without creating an editor', async context => {
    window.history.replaceState(null, '', '/');
    const f = fixture([response(200), response(200, context)]);
    const client = await f.bootstrap();
    await expect(client.enableEditing!(vi.fn())).rejects.toThrow(CANVAS_EDIT_FAILED);
    expect(f.createClient).toHaveBeenCalledOnce();
    expect(client.capabilities).toBe(CANVAS_OBSERVER_CAPABILITIES);
  });

  it('retains the viewer and disposes the unused editor when recovery storage cannot be read', async () => {
    const authorized = { ...identity, projectIdentity: 'b'.repeat(64), controlAuthorized: true };
    const f = fixture([response(200, authorized), response(200, authorized)]);
    const client = await f.bootstrap();
    const failed = { ...f.createClient.mock.results[0].value, dispose: vi.fn(),
      getState: vi.fn(() => { throw new Error('private storage bytes'); }) };
    f.createClient.mockReturnValueOnce(failed);
    await expect(client.enableEditing!(vi.fn())).rejects.toThrow(CANVAS_EDIT_FAILED);
    expect(f.createClient).toHaveBeenCalledTimes(2);
    expect(failed.dispose).toHaveBeenCalledOnce();
    expect(f.createClient.mock.results[0].value.dispose).not.toHaveBeenCalled();
    expect(client.capabilities).toBe(CANVAS_OBSERVER_CAPABILITIES);
  });

  it('does not allow a disposed panel to exchange its retained control credential', async () => {
    window.history.replaceState(null, '', '/#c=viewer&e=control');
    const f = fixture([response(200)]);
    const client = await f.bootstrap();
    client.dispose();
    await expect(client.enableEditing!(vi.fn())).rejects.toThrow(CANVAS_EDIT_FAILED);
    expect(f.request).toHaveBeenCalledOnce();
  });

  it('rejects a revoked single-use control credential without upgrading or retrying', async () => {
    window.history.replaceState(null, '', '/#c=viewer&e=revoked');
    const viewer = { ...identity, projectIdentity: 'b'.repeat(64), controlAuthorized: false };
    const f = fixture([response(200, viewer), response(200, viewer), response(403)]);
    const client = await f.bootstrap();
    const attempt = client.enableEditing!(vi.fn());
    await expect(attempt).rejects.toThrow(CANVAS_EDIT_FAILED);
    expect(client.enableEditing!(vi.fn())).toBe(attempt);
    expect(f.request.mock.calls.map(([url]) => url)).toEqual(['/office-context', '/office-context', '/control-auth']);
    expect(f.createClient).toHaveBeenCalledOnce();
    expect(client.capabilities).toBe(CANVAS_OBSERVER_CAPABILITIES);
  });

  it('uses different recovery storage for concurrent instances of the same selected project', async () => {
    const projectIdentity = 'b'.repeat(64);
    const one = { ...identity, projectIdentity, controlAuthorized: true };
    const two = { ...one, serverIdentity: 'z'.repeat(43) };
    const first = fixture([response(200, one), response(200, one)]);
    const second = fixture([response(200, two), response(200, two)]);
    await (await first.bootstrap()).enableEditing!(vi.fn());
    await (await second.bootstrap()).enableEditing!(vi.fn());
    expect(first.createClient.mock.calls[1][3]?.recoveryKey).not.toBe(second.createClient.mock.calls[1][3]?.recoveryKey);
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
