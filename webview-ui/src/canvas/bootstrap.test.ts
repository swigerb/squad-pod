import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_CONTROL_CAPABILITIES, CANVAS_OBSERVER_CAPABILITIES } from '../../../src/core/hostCapabilities.js';
import { connectOffice } from '../../../src/core/officeChannel.js';
import { createBrowserClient } from '../standalone/browserClient.js';
import { createCanvasBootstrap, CANVAS_EDIT_FAILED } from './bootstrap.js';
import { CanvasBootstrapError, canvasDiagnostic } from './diagnostics.js';

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
    expect(f.createClient).toHaveBeenCalledWith(expect.any(Function), undefined, window.location.origin, undefined,
      expect.objectContaining({ charter: false, usage: false, export: false }));
    const reload = fixture([response(200)]);
    await reload.bootstrap();
    expect(reload.request).toHaveBeenCalledTimes(1);
    expect(Storage.prototype.getItem).not.toHaveBeenCalled();
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
  });

  it('keeps the opted-in host bridge alive when retiring the observer during editing handoff', async () => {
    const hostCapabilities = { charter: true, usage: true, export: true };
    const f = fixture([response(200, { ...identity, hostCapabilities }),
      response(200, { ...identity, hostCapabilities, projectIdentity: 'b'.repeat(64), controlAuthorized: true })]);
    f.createClient.mockImplementation((_status, _socket, _origin, _control, bridge) => ({
      capabilities: CANVAS_OBSERVER_CAPABILITIES, canvasHost: bridge,
      send: vi.fn(), subscribe: vi.fn(), getState: vi.fn(), setState: value => value,
      dispose: vi.fn(), discardPreferenceDraft: vi.fn(),
    }));
    const viewer = await f.bootstrap();
    const control = await viewer.enableEditing!(vi.fn());
    viewer.dispose();
    f.request.mockResolvedValueOnce(response(200, { ok: true, quantities: [] }));
    expect(await control.canvasHost!.getUsage()).toEqual([]);
    const count = f.request.mock.calls.length;
    control.dispose();
    await expect(control.canvasHost!.getUsage()).rejects.toThrow('Host capability unavailable or rejected');
    expect(f.request).toHaveBeenCalledTimes(count);
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
      const code = hash === '' || hash === '#wrong=secret' ? 'VIEWER_BOOTSTRAP_MISSING' : 'VIEWER_BOOTSTRAP_INVALID';
      await expect(f.bootstrap()).rejects.toMatchObject({
        code, message: canvasDiagnostic(code),
      });
      expect(window.location.hash).toBe('');
      expect(f.request).toHaveBeenCalledTimes(1);
      expect(f.createClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    { responses: [response(500)], code: 'OFFICE_CONTEXT_UNAVAILABLE' },
    { responses: [response(403), response(403)], code: 'AUTH_REJECTED' },
    { responses: [response(403), response(503)], code: 'AUTH_UNAVAILABLE' },
    { responses: [response(403), response(200), response(403)], code: 'AUTH_REJECTED' },
    { responses: [response(403), response(200), response(503)], code: 'OFFICE_CONTEXT_UNAVAILABLE' },
    { responses: [response(200, { serverIdentity: 'secret_credential' })], code: 'OFFICE_CONTEXT_INVALID' },
  ] as const)('fails closed with $code without retries or leaking response details', async ({ responses, code }) => {
    const f = fixture([...responses]);
    for (const value of responses) {
      if (!value.ok) value.json = vi.fn().mockRejectedValue(new Error(privateData));
    }
    const attempt = f.bootstrap();
    await expect(attempt).rejects.toMatchObject({ code, message: canvasDiagnostic(code) });
    expect(f.bootstrap()).toBe(attempt);
    expect(window.location.hash).toBe('');
    expect(f.createClient).not.toHaveBeenCalled();
    expect(f.request).toHaveBeenCalledTimes(responses.length);
    for (const value of responses) if (!value.ok) expect(value.json).not.toHaveBeenCalled();
  });

  const privateData = 'secret_credential Cookie=private_cookie http://private.test/private-path C:\\private prompt contents';
  it.each([[], [response(403)], [response(403), response(200)]])(
    'clears credentials on network failure at each request stage without retrying', async (...responses) => {
    const f = fixture(responses);
    f.request.mockRejectedValue(new Error(privateData));
    const attempt = f.bootstrap();
    await expect(attempt).rejects.toMatchObject({ code: 'NETWORK_FAILED', message: canvasDiagnostic('NETWORK_FAILED') });
    expect(String(await attempt.catch(error => error))).not.toContain(privateData);
    expect(window.location.hash).toBe('');
    expect(f.bootstrap()).toBe(attempt);
    expect(f.request).toHaveBeenCalledTimes(responses.length + 1);
  });

  it.each(['json', 'client'] as const)('sanitizes %s startup exceptions', async stage => {
    const context = response(200);
    const f = fixture([context]);
    if (stage === 'json') context.json = vi.fn().mockRejectedValue(new Error(privateData));
    else f.createClient.mockImplementation(() => { throw new Error(privateData); });
    const code = stage === 'json' ? 'OFFICE_CONTEXT_INVALID' : 'OFFICE_START_FAILED';
    await expect(f.bootstrap()).rejects.toEqual(new CanvasBootstrapError(code));
  });

  it('allowlists transport status without inferring expiry or forwarding arbitrary strings', async () => {
    const f = fixture([response(200)]);
    await f.bootstrap();
    const onStatus = f.createClient.mock.calls[0][0];
    onStatus('Connecting');
    onStatus('Connected - read-only');
    onStatus('Connection failed - authenticate again if the credential was revoked');
    onStatus('Disconnected - retrying observation only; authenticate again after rotation');
    onStatus(`Connected ${privateData}`);
    onStatus(`Protocol error: ${privateData}`);
    expect(f.status.mock.calls.flat()).toEqual([
      'OFFICE_STARTING', 'WS_CONNECTING', 'WS_CONNECTED', 'WS_FAILED', 'WS_DISCONNECTED', 'OFFICE_STATUS', 'OFFICE_PROTOCOL_FAILED',
    ].map(code => canvasDiagnostic(code as Parameters<typeof canvasDiagnostic>[0])));
    expect(JSON.stringify(f.status.mock.calls)).not.toContain(privateData);
  });

  it('reports office subscription startup failure safely and disposes without retrying', async () => {
    const f = fixture([response(200)]);
    const client = await f.bootstrap();
    f.createClient.mock.results[0].value.subscribe.mockImplementation(() => { throw new Error(privateData); });
    expect(() => connectOffice(client, vi.fn())).toThrow(new CanvasBootstrapError('OFFICE_START_FAILED'));
    expect(f.status).toHaveBeenLastCalledWith(canvasDiagnostic('OFFICE_START_FAILED'));
    expect(f.createClient.mock.results[0].value.send).not.toHaveBeenCalled();
    expect(f.createClient.mock.results[0].value.dispose).toHaveBeenCalledOnce();
    expect(f.createClient).toHaveBeenCalledOnce();
  });

  it('does not request control until opt-in, then uses a cookie-bound challenge, never a URL credential', async () => {
    window.history.replaceState(null, '', '/#c=viewer&e=ignored_legacy_secret');
    const viewer = { ...identity, projectIdentity: 'b'.repeat(64), controlAuthorized: false };
    const authorized = { ...viewer, controlAuthorized: true };
    const nonce = 'n'.repeat(43);
    const f = fixture([response(200, viewer), response(200, viewer), response(200, { nonce }),
      response(204), response(200, authorized)]);
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
      '/office-context', '/office-context', '/control-intent', '/control-auth', '/office-context',
    ]);
    expect(f.request.mock.calls[2][1]).toEqual({
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
    });
    expect(f.request.mock.calls[3][1]).toEqual({
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce }),
    });
    expect(JSON.stringify(f.request.mock.calls)).not.toContain('ignored_legacy_secret');
    expect(f.createClient.mock.calls[1][3]).toEqual({
      recoveryKey: `squad-office:${identity.serverIdentity}:${viewer.projectIdentity}`, onPreferenceDraft: draft,
    });
    expect(control.getState).toHaveBeenCalledOnce();
    const onStatus = f.createClient.mock.calls[1][0];
    onStatus('Disconnected before save acknowledgement. Draft retained');
    onStatus('Disconnected - retrying observation only; authenticate again after rotation');
    expect(f.status.mock.calls).toEqual([
      [canvasDiagnostic('OFFICE_STARTING')], [canvasDiagnostic('OFFICE_STATUS')], [canvasDiagnostic('WS_DISCONNECTED')],
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
    { ...identity, projectIdentity: 'invalid', controlAuthorized: true },
    { ...identity, serverIdentity: 'z'.repeat(43), projectIdentity: 'b'.repeat(64), controlAuthorized: true },
  ])('fails closed on invalid or substituted control identity without creating an editor', async context => {
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

  it('does not allow a disposed panel to request a control challenge', async () => {
    window.history.replaceState(null, '', '/#c=viewer');
    const f = fixture([response(200)]);
    const client = await f.bootstrap();
    client.dispose();
    await expect(client.enableEditing!(vi.fn())).rejects.toThrow(CANVAS_EDIT_FAILED);
    expect(f.request).toHaveBeenCalledOnce();
  });

  it('rejects a revoked one-time challenge without upgrading or retrying', async () => {
    window.history.replaceState(null, '', '/#c=viewer');
    const viewer = { ...identity, projectIdentity: 'b'.repeat(64), controlAuthorized: false };
    const f = fixture([response(200, viewer), response(200, viewer),
      response(200, { nonce: 'n'.repeat(43) }), response(403)]);
    const client = await f.bootstrap();
    const attempt = client.enableEditing!(vi.fn());
    await expect(attempt).rejects.toThrow(CANVAS_EDIT_FAILED);
    expect(client.enableEditing!(vi.fn())).toBe(attempt);
    expect(f.request.mock.calls.map(([url]) => url)).toEqual([
      '/office-context', '/office-context', '/control-intent', '/control-auth',
    ]);
    expect(f.createClient).toHaveBeenCalledOnce();
    expect(client.capabilities).toBe(CANVAS_OBSERVER_CAPABILITIES);
  });

  it.each([response(403), response(200, {}), response(200, { nonce: 'invalid' })])(
    'does not request control when the cookie-bound challenge is denied or malformed', async challenge => {
      const viewer = { ...identity, projectIdentity: 'b'.repeat(64), controlAuthorized: false };
      const f = fixture([response(200, viewer), response(200, viewer), challenge]);
      const client = await f.bootstrap();
      await expect(client.enableEditing!(vi.fn())).rejects.toThrow(CANVAS_EDIT_FAILED);
      expect(f.request.mock.calls.map(([url]) => url)).toEqual([
        '/office-context', '/office-context', '/control-intent',
      ]);
      expect(f.createClient).toHaveBeenCalledOnce();
    },
  );

  it('does not exchange a challenge received after the panel is disposed', async () => {
    const viewer = { ...identity, projectIdentity: 'b'.repeat(64), controlAuthorized: false };
    const f = fixture([response(200, viewer), response(200, viewer)]);
    let deliver!: (response: Response) => void;
    f.request.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
    const client = await f.bootstrap();
    const attempt = client.enableEditing!(vi.fn());
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(3));
    client.dispose();
    deliver(response(200, { nonce: 'n'.repeat(43) }));
    await expect(attempt).rejects.toThrow(CANVAS_EDIT_FAILED);
    expect(f.request.mock.calls.some(([url]) => url === '/control-auth')).toBe(false);
    expect(f.createClient).toHaveBeenCalledOnce();
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
    const status = vi.fn();
    const bootstrap = createCanvasBootstrap(status, window, request,
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
      socket.onopen?.(new Event('open'));
      expect(status).toHaveBeenLastCalledWith(canvasDiagnostic('WS_CONNECTED'));
      socket.onmessage?.(new MessageEvent('message', { data: JSON.stringify({
        version: 1, kind: 'office', message: { type: 'existingAgents', agents: [] },
      }) }));
      expect(status).toHaveBeenLastCalledWith(canvasDiagnostic('OFFICE_READY'));
      expect(client.getState()).toBeUndefined();
      expect(() => client.setState({ token: 'must-not-persist' })).toThrow();
    } finally { unsubscribe(); client.dispose(); }
  });
});
