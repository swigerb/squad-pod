import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { request, type IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { CanvasDefinition } from '@github/copilot-sdk/extension';
import * as observers from '../observer.js';
import { startCanvasOfficeHost, type CanvasOfficeHost } from './officeHost.js';
import { startOfficeExtension } from './provider.js';
import type { OutboundMessage } from '../../../src/types.js';

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
  return http(host, '/auth', 'POST', JSON.stringify({ token: url.hash.slice(3) }), {
    Origin: url.origin, 'Content-Type': 'application/json', ...headers,
  });
}
async function connect(host: CanvasOfficeHost, cookie: string) {
  const url = new URL(host.url);
  const socket = new WebSocket(`ws://127.0.0.1:${url.port}/office`, {
    headers: { Origin: url.origin, Cookie: cookie },
  });
  sockets.push(socket);
  const messages: OutboundMessage[] = [];
  socket.on('message', data => {
    const frame = JSON.parse(data.toString()) as { message?: OutboundMessage };
    if (frame.message) messages.push(frame.message);
  });
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ version: 1, kind: 'office', message: { type: 'webviewReady' } }));
  await vi.waitFor(() => expect(messages.some(message => message.type === 'recordedUsage')).toBe(true));
  return { socket, messages };
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

describe('isolated read-only Canvas office host', () => {
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
    expect(url.hash).toMatch(/^#c=[A-Za-z0-9_-]{43}$/);
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
      expect((await http(host, path, 'POST', '{}', headers)).status).toBe(403);
    }
    const { socket } = await connect(host, headers.Cookie);
    const error = new Promise<string>(resolve => socket.once('message', data => resolve(data.toString())));
    socket.send(JSON.stringify({ version: 1, kind: 'office', message: { type: 'saveLayout' } }));
    expect(JSON.parse(await error)).toMatchObject({ kind: 'error', code: 'READ_ONLY' });
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
