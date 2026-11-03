import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs';
import { request, type IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import type { CanvasDefinition } from '@github/copilot-sdk/extension';
import * as observers from '../observer.js';
import { startCanvasOfficeHost, type CanvasOfficeHost } from './officeHost.js';
import { startOfficeExtension } from './provider.js';
import type { OutboundMessage } from '../../../src/types.js';
import { parseLayoutJson } from '../../../src/layoutPersistence.js';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const pty = vi.hoisted(() => ({ imported: vi.fn() }));
vi.mock('node-pty', () => { pty.imported(); throw new Error('PTY must never load'); });

const assets = fileURLToPath(new URL('../../../webview-ui/public/assets', import.meta.url));
const roots: string[] = [];
const hosts: CanvasOfficeHost[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(hosts.splice(0).map(host => host.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

async function fixture(id = 'lisa', marker = '.squad', cols = 2) {
  const root = join(process.cwd(), `.canvas-test-${randomUUID()}`);
  roots.push(root);
  await mkdir(join(root, marker), { recursive: true });
  await mkdir(join(root, '.squad-pod'));
  await mkdir(join(root, 'bundle'));
  await writeFile(join(root, 'bundle', 'index.html'), '<html><head></head><body>office</body></html>');
  await writeFile(join(root, marker, 'team.md'), `# Team\n## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n| ${id} | Developer | ${marker}/agents/${id}/charter.md | Active |\n`);
  await writeFile(join(root, '.squad-pod', 'layout.json'),
    JSON.stringify({ version: 2, cols, rows: 1, tiles: Array(cols).fill(1), furniture: [] }));
  return { projectRoot: root, bundledAssetsRoot: assets, staticRoot: join(root, 'bundle') };
}
async function launch(id?: string, marker?: string, cols?: number) {
  const options = await fixture(id, marker, cols);
  const host = await startCanvasOfficeHost(options);
  hosts.push(host);
  return { host, options };
}
function http(host: Pick<CanvasOfficeHost, 'url'>, path: string, method = 'GET', body?: string,
  headers: Record<string, string> = {}): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const url = new URL(host.url);
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port: url.port, path, method, agent: false, headers,
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
function auth(host: CanvasOfficeHost, headers: Record<string, string> = {}) {
  const url = new URL(host.url);
  return http(host, '/auth', 'POST', JSON.stringify({ token: new URLSearchParams(url.hash.slice(1)).get('c') }), {
    Origin: url.origin, 'Content-Type': 'application/json', ...headers,
  });
}
async function connect(host: CanvasOfficeHost, cookie: string, control = false) {
  const url = new URL(host.url);
  const socket = new WebSocket(`ws://127.0.0.1:${url.port}/${control ? 'control' : 'office'}`, {
    headers: { Origin: url.origin, Cookie: cookie },
  });
  sockets.push(socket);
  const messages: OutboundMessage[] = [];
  const results: Array<{ requestId: number; messages: OutboundMessage[] }> = [];
  const states: Array<{ preferencesRevision: string | null }> = [];
  socket.on('message', data => {
    const frame = JSON.parse(data.toString());
    if (frame.message) messages.push(frame.message);
    if (frame.kind === 'controlResult') results.push(frame);
    if (frame.kind === 'controlState') states.push(frame);
  });
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ version: 1, kind: 'office', message: { type: 'webviewReady' } }));
  await vi.waitFor(() => expect(messages.some(message => message.type === 'recordedUsage')).toBe(true));
  return { socket, messages, results, states };
}
async function controlCookie(host: CanvasOfficeHost) {
  const url = new URL(host.url);
  const result = await http(host, '/control-auth', 'POST',
    JSON.stringify({ token: new URLSearchParams(url.hash.slice(1)).get('e') }),
    { Origin: url.origin, 'Content-Type': 'application/json' });
  expect(result.status).toBe(204);
  return result.headers['set-cookie']![0].split(';')[0];
}
function waitForSocketClose(socket: WebSocket, label: string) {
  return new Promise<void>((resolve, reject) => {
    const onClose = () => { clearTimeout(timeout); resolve(); };
    const timeout = setTimeout(() => {
      socket.off('close', onClose);
      reject(new Error(`${label} did not close within 2000ms after host disposal`));
    }, 2000);
    socket.once('close', onClose);
  });
}
async function save(client: Awaited<ReturnType<typeof connect>>, message: unknown, expectedRevision: string | null) {
  const requestId = client.results.length + 1;
  client.socket.send(JSON.stringify({ version: 1, kind: 'control', requestId, expectedRevision, message }));
  await vi.waitFor(() => expect(client.results.some(result => result.requestId === requestId)).toBe(true));
  return client.results.find(result => result.requestId === requestId)!.messages;
}
async function refused(host: CanvasOfficeHost, headers: Record<string, string>, path = '/office') {
  const url = new URL(host.url);
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${url.port}${path}`, { headers });
    sockets.push(socket);
    socket.on('error', () => undefined);
    socket.once('open', () => { socket.terminate(); reject(new Error('Unexpected upgrade')); });
    socket.once('unexpected-response', (_request, response) => {
      response.resume(); socket.terminate(); resolve(response.statusCode!);
    });
  });
}

describe('isolated default read-only Canvas office host', () => {
  it('connects SDK-double open/actions/close to the real host and guarded project services', async () => {
    const options = await fixture();
    await mkdir(join(options.projectRoot, '.squad', 'agents', 'lisa'), { recursive: true });
    await writeFile(join(options.projectRoot, '.squad', 'agents', 'lisa', 'charter.md'),
      '# Lisa\n\nBuilds guarded integrations.\n\n## Identity\n- **Expertise:** TypeScript\n\n## Model\n- **Preferred:** auto\n');
    const unsubscribe = vi.fn();
    const sdk = {
      CanvasError: class extends Error { constructor(readonly code: string, message: string) { super(message); } },
      createCanvas: vi.fn((definition: CanvasDefinition) => definition),
      joinSession: vi.fn(async () => ({
        sessionId: 'exact-session', on: () => unsubscribe,
        rpc: { metadata: { snapshot: async () => ({ sessionId: 'exact-session', workingDirectory: options.projectRoot }) } },
      })),
    };
    const provider = await startOfficeExtension(sdk, options);
    const ctx = { sessionId: 'exact-session', extensionId: 'test-provider', canvasId: 'squad-pod', instanceId: 'office' };
    try {
      const opened = await provider.canvas.open(ctx);
      expect((await http(opened, '/')).body).toBe('<html><head></head><body>office</body></html>');
      const state = await provider.canvas.actions[0].handler({ ...ctx, actionName: 'get_office_state' });
      expect(state).toMatchObject({
        members: [{ slug: 'lisa', status: 'idle' }], layout: { cols: 2, rows: 1, furnitureCount: 0 },
        source: { teamFound: true, observer: 'watching', liveActivity: 'unavailable' },
      });
      const detail = await provider.canvas.actions[1].handler({
        ...ctx, actionName: 'get_member_details', input: { slug: 'lisa' },
      });
      expect(detail).toMatchObject({ status: 'available', charterSummary: 'Builds guarded integrations.',
        expertise: 'TypeScript', model: { provenance: 'declared-only', runtime: null,
          sources: expect.arrayContaining([
            { source: 'charter.md', state: 'ready', diagnostic: expect.any(String),
              values: [{ key: 'Preferred', value: 'auto' }] },
          ]) } });
      await provider.canvas.onClose(ctx);
      await expect(http(opened, '/')).rejects.toThrow();
    } finally { await provider.dispose(); }
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('serves a protected, usable bootstrap and consumes its fragment credential exactly once', async () => {
    const { host } = await launch();
    const url = new URL(host.url);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.pathname).toBe('/');
    expect(url.search).toBe('');
    expect(url.hash).toMatch(/^#c=[A-Za-z0-9_-]{43}&e=[A-Za-z0-9_-]{43}$/);
    const page = await http(host, '/');
    expect(page.body).toBe('<html><head></head><body>office</body></html>');
    expect(page.body).not.toContain('squad-canvas');
    expect(page.body).not.toContain(url.hash.slice(3));
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    const results = await Promise.all([auth(host), auth(host)]);
    expect(results.map(result => result.status).sort()).toEqual([204, 403]);
    const cookie = results.find(result => result.status === 204)!.headers['set-cookie']![0];
    expect(cookie).toContain('; HttpOnly; SameSite=Strict; Path=/');
    expect(cookie).not.toContain(url.hash.slice(3));
    const { messages } = await connect(host, cookie.split(';')[0]);
    expect(messages.find(message => message.type === 'existingAgents')).toMatchObject({ agents: [{ id: 'lisa' }] });
    expect((await auth(host)).status).toBe(403);
    expect((await http(host, '/office-context', 'GET', undefined, { Cookie: cookie.split(';')[0] })).status).toBe(200);
  });

  it('rejects missing credentials, wrong exact Host/Origin, writes and terminal/control authority', async () => {
    const { host } = await launch();
    const url = new URL(host.url);
    expect((await http(host, '/office-context')).status).toBe(403);
    expect(await refused(host, { Origin: url.origin })).toBe(403);
    const invalidHeaders: Record<string, string>[] = [
      { Host: 'evil.example' }, { Origin: 'null' }, { Origin: `${url.origin}/` },
    ];
    for (const headers of invalidHeaders) {
      expect((await auth(host, headers)).status).toBe(403);
    }
    expect((await http(host, '/', 'GET', undefined, { Host: 'localhost:' + url.port })).status).toBe(403);
    const result = await auth(host);
    const headers = { Cookie: result.headers['set-cookie']![0].split(';')[0], Origin: url.origin };
    expect(await refused(host, { ...headers, Origin: 'http://evil.example' })).toBe(403);
    expect(await refused(host, { ...headers, Host: 'evil.example' })).toBe(403);
    expect(await refused(host, headers, '/terminal')).toBe(403);
    expect(await refused(host, headers, '/control')).toBe(403);
    for (const path of ['/terminal-auth', '/control-auth']) {
      expect((await http(host, path, 'POST', '{}', { ...headers, 'Content-Type': 'application/json' })).status).toBe(403);
    }
    const { socket } = await connect(host, headers.Cookie);
    const error = new Promise<string>(resolve => socket.once('message', data => resolve(data.toString())));
    socket.send(JSON.stringify({ version: 1, kind: 'office', message: { type: 'saveLayout' } }));
    expect(JSON.parse(await error)).toMatchObject({ kind: 'error', code: 'READ_ONLY' });
  });

  it('keeps viewer/control exchanges independent and single-use; reloads the unchanged VS Code layout format', async () => {
    const upgrades = vi.spyOn(WebSocketServer.prototype, 'handleUpgrade');
    const { host, options } = await launch();
    const url = new URL(host.url);
    const viewer = new URLSearchParams(url.hash.slice(1)).get('c');
    expect((await http(host, '/control-auth', 'POST', JSON.stringify({ token: viewer }),
      { Origin: url.origin, 'Content-Type': 'application/json' })).status).toBe(403);
    const cookie = await controlCookie(host);
    const replay = await http(host, '/control-auth', 'POST',
      JSON.stringify({ token: new URLSearchParams(url.hash.slice(1)).get('e') }),
      { Origin: url.origin, 'Content-Type': 'application/json' });
    expect(replay.status).toBe(403);
    const readCookie = (await auth(host)).headers['set-cookie']![0].split(';')[0];
    expect((await http(host, '/office-context', 'GET', undefined, { Cookie: readCookie })).body)
      .toContain('"controlAuthorized":false');
    expect(await refused(host, { Origin: url.origin, Cookie: readCookie }, '/control')).toBe(403);
    const viewerClient = await connect(host, readCookie);
    const control = await connect(host, cookie, true);
    const initial = control.messages.find(message => message.type === 'layoutLoaded')!;
    if (initial.type !== 'layoutLoaded') throw new Error('Missing layout');
    const layout = { ...initial.layout, carpetTiles: [{ variant: 0, order: 1 }, null],
      pets: [{ id: 'pet-1', petType: 0 }], areas: [{ label: 'Canvas', color: '#123456' }],
      areaTiles: ['Canvas', null], areaMappings: { project: ['Canvas'] } };
    const saved = await save(control, { type: 'saveLayout', layout,
      expectedRevision: initial.revision, workspaceRoot: options.projectRoot }, initial.revision!);
    expect(saved).toEqual([{ type: 'layoutSaved', layout, revision: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    const raw = await readFile(join(options.projectRoot, '.squad-pod', 'layout.json'), 'utf8');
    expect(raw).toBe(JSON.stringify(layout, null, 2));
    expect(parseLayoutJson(raw)).toEqual(layout);
    const reloaded = await connect(host, cookie, true);
    expect(reloaded.messages.find(message => message.type === 'layoutLoaded')).toMatchObject({ layout });
    expect((await http(host, '/office-context', 'GET', undefined, { Cookie: cookie })).body)
      .toContain('"controlAuthorized":true');
    await save(reloaded, { type: 'saveAgentSeats', seats: { lisa: 'seat-1' } }, null);
    const preferences = JSON.parse(await readFile(join(options.projectRoot, '.squad-pod', 'office-preferences.json'), 'utf8'));
    expect(preferences.agents).toEqual({ lisa: { seatId: 'seat-1' } });
    await vi.waitFor(() => expect(reloaded.states.at(-1)?.preferencesRevision).toMatch(/^[a-f0-9]{64}$/));
    await save(reloaded, { type: 'setShowAreas', enabled: true }, reloaded.states.at(-1)!.preferencesRevision);
    const snapshot = await host.snapshot();
    expect(snapshot.find(message => message.type === 'settingsLoaded')).toMatchObject({ showAreas: true });
    expect(snapshot.find(message => message.type === 'existingAgents')).toMatchObject({ agents: [{ id: 'lisa', seatId: 'seat-1' }] });
    expect(await refused(host, { Origin: url.origin, Cookie: cookie }, '/terminal')).toBe(403);
    const servers = [...new Set(upgrades.mock.contexts as WebSocketServer[])];
    expect(servers.map(server => server.clients.size).sort()).toEqual([1, 2]);
    const serverSockets = servers.flatMap(server => [...server.clients]);
    const clients = [
      { socket: viewerClient.socket, label: 'viewer' },
      { socket: control.socket, label: 'control' },
      { socket: reloaded.socket, label: 'reloaded control' },
    ];
    for (const { socket } of clients) expect(socket.readyState).toBe(WebSocket.OPEN);
    const closed = clients.map(({ socket, label }) => waitForSocketClose(socket, label));
    await Promise.all([
      host.dispose().then(() => {
        // Server disposal must finish locally; peer close notifications may arrive later.
        for (const socket of serverSockets) expect(socket.readyState).toBe(WebSocket.CLOSED);
        for (const server of servers) expect(server.clients.size).toBe(0);
      }),
      ...closed,
    ]);
    for (const { socket } of clients) expect(socket.readyState).toBe(WebSocket.CLOSED);
    await expect(http(host, '/office-context', 'GET', undefined, { Cookie: cookie })).rejects.toThrow();
    const restarted = await startCanvasOfficeHost(options);
    hosts.push(restarted);
    expect((await http(restarted, '/office-context', 'GET', undefined, { Cookie: cookie })).status).toBe(403);
  });

  it('rejects a stale second Canvas instance without overwriting the first; recovers interrupted atomic writes', async () => {
    const { host, options } = await launch();
    const second = await startCanvasOfficeHost(options);
    hosts.push(second);
    const first = await connect(host, await controlCookie(host), true);
    const other = await connect(second, await controlCookie(second), true);
    const initial = first.messages.find(message => message.type === 'layoutLoaded')!;
    if (initial.type !== 'layoutLoaded') throw new Error('Missing layout');
    const winner = { ...initial.layout, pets: [{ id: 'winner', petType: 1 }] };
    const loser = { ...initial.layout, pets: [{ id: 'loser', petType: 2 }] };
    const mutation = (layout: unknown, revision = initial.revision) => ({
      type: 'saveLayout', layout, expectedRevision: revision, workspaceRoot: options.projectRoot,
    });
    const written = await save(first, mutation(winner), initial.revision!);
    const conflict = await save(other, mutation(loser), initial.revision!);
    expect(conflict).toMatchObject([
      { type: 'layoutLoaded', layout: winner }, { type: 'layoutError', error: expect.stringContaining('draft was kept') },
    ]);
    const file = join(options.projectRoot, '.squad-pod', 'layout.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(winner);
    const ack = written[0];
    if (ack.type !== 'layoutSaved') throw new Error('Missing save acknowledgement');
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('interrupted rename'); });
    other.socket.send(JSON.stringify({ version: 1, kind: 'control', requestId: 2,
      expectedRevision: ack.revision, message: mutation(loser, ack.revision) }));
    await vi.waitFor(() => expect(other.messages.some(message => message.type === 'layoutError'
      && message.error.includes('Draft retained'))).toBe(true));
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(winner);
    const recovery = join(options.projectRoot, '.squad-pod', 'recovery');
    const backups = await Promise.all((await readdir(recovery)).map(name => readFile(join(recovery, name), 'utf8')));
    expect(backups).toContain(JSON.stringify(winner, null, 2));
    expect((await readdir(join(options.projectRoot, '.squad-pod'))).some(name => /\.(tmp|lock)$/.test(name))).toBe(false);
    const retry = await save(first, mutation(loser, ack.revision), ack.revision!);
    expect(retry[0]).toMatchObject({ type: 'layoutSaved', layout: loser });
  });

  it('keeps simultaneous roots, rosters, layouts and shutdown independent', async () => {
    const first = await launch('lisa', '.squad', 2);
    const second = await launch('bart', '.ai-team', 3);
    expect(first.host.url).not.toBe(second.host.url);
    const oneCookie = (await auth(first.host)).headers['set-cookie']![0].split(';')[0];
    expect((await http(second.host, '/office-context', 'GET', undefined, { Cookie: oneCookie })).status).toBe(403);
    const twoCookie = (await auth(second.host)).headers['set-cookie']![0].split(';')[0];
    const one = await connect(first.host, oneCookie);
    const two = await connect(second.host, twoCookie);
    expect(one.messages.find(message => message.type === 'existingAgents')).toMatchObject({ agents: [{ id: 'lisa' }] });
    expect(two.messages.find(message => message.type === 'existingAgents')).toMatchObject({ agents: [{ id: 'bart' }] });
    expect(one.messages.find(message => message.type === 'layoutLoaded')).toMatchObject({ layout: { cols: 2 } });
    expect(two.messages.find(message => message.type === 'layoutLoaded')).toMatchObject({ layout: { cols: 3 } });
    expect(two.messages.find(message => message.type === 'sourceStatus')).toMatchObject({
      status: { workspaceRoot: second.options.projectRoot, liveActivity: { state: 'off', sessionId: null } },
    });
    await first.host.dispose();
    await expect(http(first.host, '/')).rejects.toThrow();
    expect((await http(second.host, '/office-context', 'GET', undefined, { Cookie: twoCookie })).status).toBe(200);
    await writeFile(join(second.options.projectRoot, '.ai-team', 'team.md'),
      (await readFile(join(second.options.projectRoot, '.ai-team', 'team.md'), 'utf8')).replaceAll('bart', 'marge'));
    await vi.waitFor(() => expect(two.messages.some(message => message.type === 'existingAgents'
      && message.agents[0]?.id === 'marge')).toBe(true), { timeout: 3000 });
  });

  it('disposes sockets, observer polling and subscriptions once, including double dispose', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const { host } = await launch();
    const cookie = (await auth(host)).headers['set-cookie']![0].split(';')[0];
    const { socket } = await connect(host, cookie);
    const closed = new Promise(resolve => socket.once('close', resolve));
    const first = host.dispose();
    expect(host.dispose()).toBe(first);
    await first;
    await closed;
    for (const result of interval.mock.results) expect(clear).toHaveBeenCalledWith(result.value);
    await expect(http(host, '/')).rejects.toThrow();
  });

  it('cleans the observer after a partial start failure and exposes only sanitized codes', async () => {
    const original = observers.createObserver;
    const dispose = vi.fn();
    vi.spyOn(observers, 'createObserver').mockImplementation((...args) => {
      const observer = original(...args);
      return { ...observer, dispose() { dispose(); observer.dispose(); } };
    });
    const options = await fixture();
    await expect(startCanvasOfficeHost({ ...options, staticRoot: join(options.projectRoot, 'missing-private-path') }))
      .rejects.toThrow(/^CANVAS_START_FAILED$/);
    expect(dispose).toHaveBeenCalledTimes(1);
    const host = await startCanvasOfficeHost(options);
    hosts.push(host);
    expect((await http(host, '/')).status).toBe(200);
  });

  it.each(['relative', '\\\\server\\share', '\\\\wsl.localhost\\Ubuntu\\home', '//server/share', '/mnt/c/work'])(
    'refuses nonlocal or relative root %s', async projectRoot => {
      await expect(startCanvasOfficeHost({ projectRoot, bundledAssetsRoot: assets, staticRoot: '.' }))
        .rejects.toThrow(/^CANVAS_INVALID_ROOT$/);
    },
  );

  it('requires an existing directory and a regular local team marker', async () => {
    const options = await fixture();
    await expect(startCanvasOfficeHost({ ...options, projectRoot: join(options.projectRoot, 'missing') }))
      .rejects.toThrow(/^CANVAS_INVALID_ROOT$/);
    await expect(startCanvasOfficeHost({ ...options, projectRoot: join(options.projectRoot, '.squad', 'team.md') }))
      .rejects.toThrow(/^CANVAS_INVALID_ROOT$/);
    await rm(join(options.projectRoot, '.squad'), { recursive: true });
    await expect(startCanvasOfficeHost(options)).rejects.toThrow(/^CANVAS_TEAM_REQUIRED$/);
    await mkdir(join(options.projectRoot, '.ai-team'));
    await symlink(join(options.projectRoot, '.ai-team'), join(options.projectRoot, '.squad'), 'junction');
    await expect(startCanvasOfficeHost(options)).rejects.toThrow(/^CANVAS_TEAM_REQUIRED$/);
  });

  it('never writes stdout or imports node-pty across success, reads, malformed data and failed startup', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { host, options } = await launch();
    const cookie = (await auth(host)).headers['set-cookie']![0].split(';')[0];
    await writeFile(join(options.projectRoot, '.squad-pod', 'layout.json'), '{malformed');
    const { messages } = await connect(host, cookie);
    expect(messages.find(message => message.type === 'sourceStatus')).toMatchObject({
      status: { error: expect.stringContaining('malformed') },
    });
    await host.dispose();
    await expect(startCanvasOfficeHost({ ...options, staticRoot: 'missing' })).rejects.toThrow('CANVAS_START_FAILED');
    expect(stdout).not.toHaveBeenCalled();
    expect(pty.imported).not.toHaveBeenCalled();
  });
});
