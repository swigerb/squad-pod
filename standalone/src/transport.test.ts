import { randomUUID } from 'node:crypto';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { connect as connectTcp } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { OutboundMessage, WebviewMessage } from '../../src/types.js';
import { startTransport, type TransportOptions } from './transport.js';

type Running = Awaited<ReturnType<typeof startTransport>>;
type Envelope = { version: number; kind: string; code?: string; message?: OutboundMessage };
const settings: OutboundMessage = {
  type: 'settingsLoaded', soundEnabled: false, debugEnabled: false, showAreas: true,
};
const fixtures: string[] = [];
const transports: Running[] = [];
const clients: WebSocket[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const client of clients.splice(0)) { client.terminate(); }
  await Promise.all(transports.splice(0).map(transport => transport.dispose()));
  await Promise.all(fixtures.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = join(process.cwd(), `.transport-test-${randomUUID()}`);
  fixtures.push(root);
  const bundle = join(root, 'bundle');
  await mkdir(join(bundle, 'assets'), { recursive: true });
  await writeFile(join(bundle, 'index.html'), '<html><script src="/assets/app.js"></script></html>');
  await writeFile(join(bundle, 'assets', 'app.js'), 'console.log("bundle")');
  await writeFile(join(bundle, 'assets', 'app.css'), 'body { color: white; }');
  await writeFile(join(root, 'private.js'), 'PROJECT_SECRET');
  return { root, bundle };
}

async function launch(overrides: Partial<TransportOptions> = {}) {
  const { root, bundle } = await fixture();
  const listeners = new Set<(messages: OutboundMessage[]) => void>();
  const unsubscribe = vi.fn();
  const snapshot = vi.fn(async () => [settings]);
  const onRead = vi.fn(async (_message: WebviewMessage) => [settings]);
  const transport = await startTransport({
    staticRoot: bundle, snapshot, onRead,
    subscribe: listener => {
      listeners.add(listener);
      return () => { unsubscribe(); listeners.delete(listener); };
    },
    ...overrides,
  });
  transports.push(transport);
  return {
    transport, root, bundle, listeners, snapshot, onRead, unsubscribe,
    emit: (messages: OutboundMessage[]) => { for (const listener of listeners) { listener(messages); } },
  };
}

function http(transport: Running, path: string, options: {
  method?: string; body?: string; headers?: Record<string, string>;
} = {}): Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }> {
  return new Promise((accept, reject) => {
    const req = request({
      host: '127.0.0.1', port: transport.port, path, method: options.method ?? 'GET',
      agent: false, headers: options.headers,
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => accept({ status: response.statusCode!, headers: response.headers, body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

function auth(transport: Running, token = transport.token, headers: Record<string, string> = {}) {
  return http(transport, '/auth', {
    method: 'POST', body: JSON.stringify({ token }),
    headers: {
      Origin: `http://127.0.0.1:${transport.port}`, 'Content-Type': 'application/json', ...headers,
    },
  });
}

async function cookie(transport: Running) {
  const response = await auth(transport);
  expect(response.status).toBe(204);
  return response.headers['set-cookie']![0].split(';')[0];
}

async function office(
  transport: Running, session: string, overrides: Record<string, string> = {}, autoPong = true,
) {
  const ws = new WebSocket(`ws://127.0.0.1:${transport.port}/office`, {
    headers: { Origin: `http://127.0.0.1:${transport.port}`, Cookie: session, ...overrides },
    autoPong,
  });
  clients.push(ws);
  const messages: Envelope[] = [];
  const waiters: Array<(message: Envelope) => void> = [];
  ws.on('message', data => {
    const message = JSON.parse(data.toString()) as Envelope;
    const waiter = waiters.shift();
    if (waiter) { waiter(message); } else { messages.push(message); }
  });
  const closed = new Promise<number>(accept => ws.once('close', code => accept(code)));
  ws.on('error', () => undefined);
  await new Promise<void>((accept, reject) => { ws.once('open', accept); ws.once('error', reject); });
  return {
    ws, closed,
    next: () => messages.length
      ? Promise.resolve(messages.shift()!)
      : new Promise<Envelope>(accept => waiters.push(accept)),
    send: (message: unknown) => ws.send(JSON.stringify({ version: 1, kind: 'office', message })),
  };
}

async function refused(transport: Running, headers: Record<string, string>, path = '/office') {
  return new Promise<number>((accept, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${transport.port}${path}`, { headers });
    clients.push(ws);
    ws.on('error', () => undefined);
    ws.once('open', () => { ws.terminate(); reject(new Error('Unexpected successful upgrade')); });
    ws.once('unexpected-response', (_request, response) => {
      response.resume();
      ws.terminate();
      accept(response.statusCode!);
    });
  });
}

describe('loopback transport HTTP boundary', () => {
  it('serves the indexed bundle with bundled-only scripts and renderer-compatible inline styles', async () => {
    const { transport } = await launch();
    const page = await http(transport, '/');
    expect(page.status).toBe(200);
    expect(page.body).toContain('/assets/app.js');
    expect(page.headers['set-cookie']).toBeUndefined();
    const directives = String(page.headers['content-security-policy']).split('; ');
    expect(directives).toContain("script-src 'self'");
    expect(directives).toContain("style-src 'self' 'unsafe-inline'");
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(page.headers['content-security-policy']).not.toContain('unsafe-eval');
    expect(page.headers['content-security-policy']).toContain(`ws://127.0.0.1:${transport.port}`);
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['cache-control']).toBe('no-store');
    expect((await http(transport, '/assets/app.js')).headers['content-type']).toContain('text/javascript');
    const head = await http(transport, '/', { method: 'HEAD' });
    expect(head.body).toBe('');
    expect(Number(head.headers['content-length'])).toBe(Buffer.byteLength(page.body));
  });

  it('does not expose project files, traversal, query credentials, or unindexed new files', async () => {
    const { transport, bundle } = await launch();
    await writeFile(join(bundle, 'new.js'), 'not indexed');
    for (const path of [
      '/private.js', '/../private.js', '/%2e%2e/private.js', '/assets/%2e%2e/%2e%2e/private.js',
      '/%2e%2e%5cprivate.js', '/%252e%252e/private.js', '//private.js',
      '/%00', '/%ZZ', '/new.js', `/?token=${transport.token}`, '/assets/app.js?token=SECRET',
    ]) {
      const response = await http(transport, path);
      expect(response.status, path).toBe(404);
      expect(response.body).not.toContain('PROJECT_SECRET');
      expect(response.body).not.toContain(transport.token);
    }
  });

  it('skips directory symlinks and caches indexed files against later replacement', async () => {
    const { root, bundle } = await fixture();
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.js'), 'PROJECT_SECRET');
    await symlink(outside, join(bundle, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const transport = await startTransport({
      staticRoot: bundle, snapshot: async () => [], subscribe: () => () => undefined,
    });
    transports.push(transport);
    await writeFile(join(bundle, 'assets', 'app.js'), 'PROJECT_SECRET');
    expect((await http(transport, '/linked/secret.js')).status).toBe(404);
    expect((await http(transport, '/assets/app.js')).body).toBe('console.log("bundle")');
  });

  it('rejects binding noncanonical or non-loopback hosts and invalid ports', async () => {
    const { bundle } = await fixture();
    const options = { staticRoot: bundle, snapshot: async () => [], subscribe: () => () => undefined };
    for (const host of ['0.0.0.0', '::', '::1', 'localhost', 'example.com']) {
      await expect(startTransport({ ...options, host })).rejects.toThrow('loopback');
    }
    for (const port of [-1, 65536, 1.5, NaN]) {
      await expect(startTransport({ ...options, port })).rejects.toThrow('port');
    }
  });

  it('rejects alternate Host names, numeric aliases, userinfo, and duplicate Host headers', async () => {
    const { transport } = await launch();
    for (const host of [
      'evil.example', `localhost:${transport.port}`, `127.0.0.1:${transport.port + 1}`,
      `2130706433:${transport.port}`, `127.1:${transport.port}`, `user@127.0.0.1:${transport.port}`,
      '127.0.0.1', `127.0.0.1:${String(transport.port).padStart(6, '0')}`,
    ]) {
      expect((await http(transport, '/', { headers: { Host: host } })).status, host).toBe(403);
    }
    const raw = await new Promise<string>((accept, reject) => {
      const socket = connectTcp(transport.port, '127.0.0.1', () => {
        socket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${transport.port}\r\nHost: evil.example\r\nConnection: close\r\n\r\n`);
      });
      let data = '';
      socket.on('data', chunk => { data += chunk.toString(); });
      socket.on('end', () => accept(data));
      socket.on('error', reject);
    });
    expect(raw).not.toContain('200 OK');
  });

  it('authenticates exact Origin plus token and issues only an HttpOnly Strict cookie', async () => {
    const { transport } = await launch();
    const response = await auth(transport);
    expect(response.status).toBe(204);
    const value = response.headers['set-cookie']![0];
    expect(value).toMatch(/^squad_office_\d+=[A-Za-z0-9_-]+; HttpOnly; SameSite=Strict; Path=\/$/);
    expect(value).not.toContain(transport.token);
    expect(response.body).toBe('');
    for (const origin of ['null', 'https://evil.example', `http://localhost:${transport.port}`,
      `http://127.0.0.1:${transport.port}/`, 'http://127.0.0.1:1']) {
      expect((await auth(transport, transport.token, { Origin: origin })).status).toBe(403);
    }
    expect((await http(transport, '/auth', {
      method: 'POST', body: JSON.stringify({ token: transport.token }),
      headers: { 'Content-Type': 'application/json' },
    })).status).toBe(403);
    expect((await auth(transport, 'incorrect')).status).toBe(403);
    expect((await auth(transport, transport.token, { Host: 'evil.example' })).status).toBe(403);
  });

  it('bounds and validates authentication bodies without echoing input', async () => {
    const { transport } = await launch();
    for (const body of ['{', 'null', '[]', '{"token":"SECRET","extra":true}', '{"token":4}']) {
      const response = await http(transport, '/auth', {
        method: 'POST', body,
        headers: { Origin: `http://127.0.0.1:${transport.port}`, 'Content-Type': 'application/json' },
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toContain('SECRET');
    }
    expect((await auth(transport, transport.token, { 'Content-Type': 'text/plain' })).status).toBe(415);
    const oversized = await auth(transport, 'x'.repeat(5000));
    expect(oversized.status).toBe(413);
    expect((await http(transport, '/', { method: 'POST' })).status).toBe(405);
  });
});

describe('office WebSocket protocol', () => {
  it('requires exact Origin, Host, path and cookie, never a URL token', async () => {
    const { transport } = await launch();
    const session = await cookie(transport);
    const valid = { Origin: `http://127.0.0.1:${transport.port}`, Cookie: session };
    const invalidHeaders: Record<string, string>[] = [
      {}, { Cookie: session }, { ...valid, Origin: 'null' },
      { ...valid, Origin: `http://localhost:${transport.port}` },
      { ...valid, Host: 'evil.example' }, { ...valid, Cookie: 'squad_office=bad' },
      { ...valid, Cookie: `${session}; ${session}` },
    ];
    for (const headers of invalidHeaders) {
      expect(await refused(transport, headers)).toBe(403);
    }
    expect(await refused(transport, valid, `/office?token=${transport.token}`)).toBe(403);
    expect(await refused(transport, valid, '/other')).toBe(403);
    const client = await office(transport, session);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('subscribes before webviewReady snapshot and replays bounded concurrent events after snapshot', async () => {
    let finish!: (messages: OutboundMessage[]) => void;
    const snapshot = vi.fn(() => new Promise<OutboundMessage[]>(accept => { finish = accept; }));
    const context = await launch({ snapshot });
    const client = await office(context.transport, await cookie(context.transport));
    expect(context.listeners.size).toBe(1);
    expect(snapshot).not.toHaveBeenCalled();
    context.emit([{ type: 'noWorkspace' }]);
    client.send({ type: 'webviewReady' });
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledOnce());
    context.emit([{ type: 'agentClosed', agentId: 'test-agent-1' }]);
    finish([settings]);
    expect(await client.next()).toEqual({ version: 1, kind: 'office', message: settings });
    expect(await client.next()).toEqual({
      version: 1, kind: 'office', message: { type: 'agentClosed', agentId: 'test-agent-1' },
    });
    context.emit([{ type: 'noWorkspace' }]);
    expect((await client.next()).message).toEqual({ type: 'noWorkspace' });
    client.ws.terminate();
    await client.closed;
    await vi.waitFor(() => expect(context.listeners.size).toBe(0));
    expect(context.unsubscribe).toHaveBeenCalledOnce();
  });

  it('dispatches only validated reads and never reinitializes an initialized socket', async () => {
    const { transport, onRead, snapshot } = await launch();
    const client = await office(transport, await cookie(transport));
    client.send({ type: 'getSettings' });
    expect((await client.next()).code).toBe('NOT_READY');
    client.send({ type: 'webviewReady' });
    await client.next();
    client.send({ type: 'getSettings' });
    expect((await client.next()).message).toEqual(settings);
    client.send({ type: 'requestAgentDetail', agentId: 'test-agent_1', requestId: 'detail-42' });
    await client.next();
    expect(onRead.mock.calls.map(([message]) => message)).toEqual([
      { type: 'getSettings' }, { type: 'requestAgentDetail', agentId: 'test-agent_1', requestId: 'detail-42' },
    ]);
    client.send({ type: 'webviewReady' });
    expect((await client.next()).code).toBe('ALREADY_READY');
    expect(snapshot).toHaveBeenCalledOnce();
  });

  it.each([
    'saveLayout', 'saveAgentSeats', 'exportLayout', 'importLayout', 'launchDirectory',
    'addDirectory', 'openSquadAgent', 'focusAgent', 'setLiveActivity', 'diagnosticReport', 'unknown',
  ])('returns READ_ONLY for %s without forwarding or reflecting secrets', async type => {
    const { transport, onRead, snapshot } = await launch();
    const client = await office(transport, await cookie(transport));
    client.send({ type, path: 'SECRET', token: transport.token });
    expect(await client.next()).toEqual({ version: 1, kind: 'error', code: 'READ_ONLY' });
    expect(onRead).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it.each([
    { version: 2, kind: 'office', message: { type: 'webviewReady' } },
    { version: 1, kind: 'other', message: { type: 'webviewReady' } },
    { version: 1, kind: 'office', extra: 'SECRET', message: { type: 'webviewReady' } },
    { version: 1, kind: 'office', message: { type: 'webviewReady', extra: true } },
    { version: 1, kind: 'office', message: { type: 'getSettings', enabled: true } },
    { version: 1, kind: 'office', message: { type: 'requestAgentDetail', agentId: '../private' } },
    { version: 1, kind: 'office', message: { type: 'requestAgentDetail', agentId: 'a'.repeat(129) } },
    { version: 1, kind: 'office', message: { type: 'requestAgentDetail', agentId: '' } },
    { version: 1, kind: 'office', message: { type: 'requestAgentDetail', agentId: 42 } },
    { version: 1, kind: 'office', message: { type: 'requestAgentDetail', agentId: 'test-agent_1', requestId: 'x'.repeat(129) } },
    { version: 1, kind: 'office', message: null }, null, [],
  ])('rejects invalid envelopes and unexpected fields %#', async envelope => {
    const { transport, onRead, snapshot } = await launch();
    const client = await office(transport, await cookie(transport));
    client.ws.send(JSON.stringify(envelope));
    expect(await client.next()).toEqual({ version: 1, kind: 'error', code: 'INVALID_MESSAGE' });
    expect(onRead).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and binary messages; closes malformed floods', async () => {
    const { transport, onRead } = await launch();
    const client = await office(transport, await cookie(transport));
    client.ws.send('{SECRET');
    expect((await client.next()).code).toBe('INVALID_MESSAGE');
    client.ws.send(Buffer.from('SECRET'));
    expect((await client.next()).code).toBe('INVALID_MESSAGE');
    for (let i = 0; i < 10; i++) { client.ws.send('{'); }
    await client.closed;
    expect(onRead).not.toHaveBeenCalled();
  });

  it('caps inbound frames at 4096 bytes', async () => {
    const { transport } = await launch();
    const client = await office(transport, await cookie(transport));
    const ready = JSON.stringify({ version: 1, kind: 'office', message: { type: 'webviewReady' } });
    client.ws.send(ready.padEnd(4096, ' '));
    expect((await client.next()).message).toEqual(settings);
    client.ws.send('x'.repeat(4097));
    expect(await client.closed).toBe(1009);
  });

  it('allows exactly 8 MiB outbound frames and disconnects on larger frames', async () => {
    const { transport, emit } = await launch();
    const client = await office(transport, await cookie(transport));
    client.send({ type: 'webviewReady' });
    await client.next();
    const overhead = Buffer.byteLength(JSON.stringify({
      version: 1, kind: 'office', message: { type: 'directoryError', error: '' },
    }));
    const error = 'x'.repeat(8 * 1024 * 1024 - overhead);
    emit([{ type: 'directoryError', error }]);
    expect((await client.next()).message).toEqual({ type: 'directoryError', error });
    emit([{ type: 'directoryError', error: 'x'.repeat(8 * 1024 * 1024) }]);
    await client.closed;
  });

  it('bounds events queued behind an asynchronous snapshot', async () => {
    let finish!: (messages: OutboundMessage[]) => void;
    const snapshot = vi.fn(() => new Promise<OutboundMessage[]>(accept => { finish = accept; }));
    const context = await launch({ snapshot });
    const client = await office(context.transport, await cookie(context.transport));
    client.send({ type: 'webviewReady' });
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledOnce());
    const event: OutboundMessage = { type: 'directoryError', error: 'x'.repeat(6 * 1024 * 1024) };
    context.emit([event, event, event]);
    await client.closed;
    expect(context.listeners.size).toBe(0);
    finish([]);
  });

  it('bounds simultaneous and flooded reads without forwarding mutations', async () => {
    const snapshot = vi.fn(() => new Promise<OutboundMessage[]>(() => undefined));
    const { transport, onRead } = await launch({ snapshot });
    const client = await office(transport, await cookie(transport));
    client.send({ type: 'webviewReady' });
    client.send({ type: 'getSettings' });
    expect((await client.next()).code).toBe('BUSY');
    for (let i = 0; i < 40; i++) { client.send({ type: 'getSettings' }); }
    await client.closed;
    expect(onRead).not.toHaveBeenCalled();
    expect(snapshot).toHaveBeenCalledOnce();
  });

  it('rate limits a flood even when every individual read finishes promptly', async () => {
    const { transport, onRead } = await launch();
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const client = await office(transport, await cookie(transport));
    client.send({ type: 'webviewReady' });
    await client.next();
    for (let i = 0; i < 31; i++) {
      client.send({ type: 'getSettings' });
      expect((await client.next()).message).toEqual(settings);
    }
    client.send({ type: 'getSettings' });
    await client.closed;
    expect(onRead).toHaveBeenCalledTimes(31);
  });

  it('revokes cookies/tokens and disconnects all subscribers on rotation', async () => {
    const context = await launch();
    const session = await cookie(context.transport);
    const first = await office(context.transport, session);
    const second = await office(context.transport, session);
    const oldToken = context.transport.token;
    const newToken = context.transport.rotate();
    expect(newToken).not.toBe(oldToken);
    expect(newToken).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    await Promise.all([first.closed, second.closed]);
    expect(context.listeners.size).toBe(0);
    expect(context.unsubscribe).toHaveBeenCalledTimes(2);
    expect((await auth(context.transport, oldToken)).status).toBe(403);
    expect(await refused(context.transport, {
      Origin: `http://127.0.0.1:${context.transport.port}`, Cookie: session,
    })).toBe(403);
    const current = await auth(context.transport, newToken);
    expect(current.status).toBe(204);
    expect(current.headers['set-cookie']![0]).not.toContain(session);
  });

  it('caps connections at eight', async () => {
    const context = await launch();
    const session = await cookie(context.transport);
    for (let i = 0; i < 8; i++) { await office(context.transport, session); }
    const ninth = new WebSocket(`ws://127.0.0.1:${context.transport.port}/office`, {
      headers: { Origin: `http://127.0.0.1:${context.transport.port}`, Cookie: session },
    });
    clients.push(ninth);
    const rejected = new Promise<void>((accept, reject) => {
      ninth.once('open', () => reject(new Error('Ninth client accepted')));
      ninth.once('error', () => accept());
    });
    await rejected;
    expect(context.listeners.size).toBe(8);
  });

  it('closes stalled snapshots and unsubscribes within the read timeout', async () => {
    const snapshot = vi.fn(() => new Promise<OutboundMessage[]>(() => undefined));
    const context = await launch({ snapshot });
    const client = await office(context.transport, await cookie(context.transport));
    vi.useFakeTimers();
    client.send({ type: 'webviewReady' });
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(5001);
    vi.useRealTimers();
    await client.closed;
    expect(context.listeners.size).toBe(0);
  });

  it('cleans up connections that do not answer heartbeats', async () => {
    const context = await launch();
    const session = await cookie(context.transport);
    vi.useFakeTimers();
    const client = await office(context.transport, session, {}, false);
    await vi.advanceTimersByTimeAsync(30_001);
    vi.useRealTimers();
    await client.closed;
    expect(context.listeners.size).toBe(0);
  });

  it('terminates slow outbound consumers instead of retaining a send indefinitely', async () => {
    const context = await launch();
    const client = await office(context.transport, await cookie(context.transport));
    client.send({ type: 'webviewReady' });
    await client.next();
    vi.useFakeTimers();
    vi.spyOn(WebSocket.prototype, 'send').mockImplementation(() => undefined);
    context.emit([settings]);
    await vi.advanceTimersByTimeAsync(10_001);
    vi.useRealTimers();
    await client.closed;
    expect(context.listeners.size).toBe(0);
  });

  it('bounds outstanding sends even when the network never completes write callbacks', async () => {
    const context = await launch();
    const client = await office(context.transport, await cookie(context.transport));
    client.send({ type: 'webviewReady' });
    await client.next();
    vi.spyOn(WebSocket.prototype, 'send').mockImplementation(() => undefined);
    const event: OutboundMessage = { type: 'directoryError', error: 'x'.repeat(6 * 1024 * 1024) };
    context.emit([event, event, event]);
    await client.closed;
    expect(context.listeners.size).toBe(0);
  });

  it('disposes sockets and subscriptions idempotently and releases the listening port', async () => {
    const context = await launch();
    const client = await office(context.transport, await cookie(context.transport));
    await Promise.all([context.transport.dispose(), context.transport.dispose(), client.closed]);
    expect(context.listeners.size).toBe(0);
    expect(context.unsubscribe).toHaveBeenCalledOnce();
    await expect(http(context.transport, '/')).rejects.toThrow();
    const replacement = await startTransport({
      port: context.transport.port, staticRoot: context.bundle,
      snapshot: async () => [], subscribe: () => () => undefined,
    });
    transports.push(replacement);
    expect((await http(replacement, '/')).status).toBe(200);
  });
});
