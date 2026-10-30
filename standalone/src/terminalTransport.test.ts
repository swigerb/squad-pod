import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { OwnedRuns } from './ownedRuns.js';
import { startTransport } from './transport.js';

const transports: Awaited<ReturnType<typeof startTransport>>[] = [];
const folders: string[] = [];
const clients: WebSocket[] = [];
afterEach(async () => {
  for (const ws of clients.splice(0)) ws.terminate();
  await Promise.all(transports.splice(0).map(server => server.dispose()));
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});
async function fixture(withTerminals = false) {
  const root = await mkdtemp(join(tmpdir(), 'terminal transport '));
  folders.push(root);
  const bundle = join(root, 'bundle');
  await mkdir(bundle);
  await writeFile(join(bundle, 'index.html'), 'synthetic');
  let terminals: OwnedRuns;
  if (withTerminals) {
    const brokerFolder = await mkdtemp(resolve('.native-broker-'));
    folders.push(brokerFolder);
    const script = join(root, 'synthetic fixture.mjs');
    const broker = join(brokerFolder, 'ptyHost.mjs');
    expect(createRequire(broker).resolve('node-pty')).toBe(createRequire(import.meta.url).resolve('node-pty'));
    await build({ entryPoints: [resolve('src/fixture.ts')], outfile: script, platform: 'node', bundle: true, format: 'esm' });
    await build({ entryPoints: [resolve('src/ptyHost.ts')], outfile: broker, platform: 'node', bundle: true, packages: 'external', format: 'esm' });
    terminals = new OwnedRuns({ project: root, enabled: true, fixture: script, broker });
  } else terminals = new OwnedRuns({ project: root, enabled: false });
  const server = await startTransport({ staticRoot: bundle, terminals,
    snapshot: async () => [], subscribe: () => () => {} });
  transports.push(server);
  const origin = `http://127.0.0.1:${server.port}`;
  const auth = async (terminal: boolean, token: string, extra = {}) => {
    return new Promise<{ status: number; cookie: string }>((resolve, reject) => {
      const req = request(`${origin}/${terminal ? 'terminal-auth' : 'auth'}`, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...extra },
      }, response => {
        response.resume();
        response.on('end', () => resolve({ status: response.statusCode!,
          cookie: response.headers['set-cookie']?.[0].split(';')[0] ?? '' }));
      });
      req.on('error', reject);
      req.end(JSON.stringify({ token }));
    });
  };
  return { server, origin, auth, terminals };
}
function socket(origin: string, channel: string, cookie: string, extra = {}) {
  const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/${channel}`, {
    headers: { Origin: origin, Cookie: cookie, ...extra },
  });
  clients.push(ws);
  ws.on('error', () => {});
  return ws;
}
function nextJson(ws: WebSocket, matches: (frame: Record<string, unknown>) => boolean) {
  return new Promise<Record<string, unknown>>((resolveFrame, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      if (!matches(frame)) return;
      ws.off('message', onMessage);
      ws.off('close', onClose);
      resolveFrame(frame);
    };
    const onClose = () => {
      ws.off('message', onMessage);
      reject(new Error('Terminal socket closed before the expected message.'));
    };
    ws.on('message', onMessage);
    ws.once('close', onClose);
  });
}

it('requires separate terminal credentials and Host/Origin checks on both channels', async () => {
  const { server, origin, auth } = await fixture();
  expect((await auth(true, server.token)).status).toBe(403);
  expect((await auth(false, server.terminalToken)).status).toBe(403);
  expect((await auth(true, server.terminalToken, { Origin: 'https://evil.invalid' })).status).toBe(403);
  expect((await auth(true, server.terminalToken, { Host: 'localhost' })).status).toBe(403);
  const office = await auth(false, server.token);
  const terminal = await auth(true, server.terminalToken);
  expect(terminal.status).toBe(204);
  for (const channel of ['terminal', 'office']) {
    const cookie = channel === 'terminal' ? terminal.cookie : office.cookie;
    for (const headers of [{ Origin: 'https://evil.invalid' }, { Host: 'localhost' }]) {
      const ws = socket(origin, channel, cookie, headers);
      await expect(once(ws, 'open')).rejects.toThrow('403');
    }
    const ws = socket(origin, channel, channel === 'terminal' ? office.cookie : terminal.cookie);
    await expect(once(ws, 'open')).rejects.toThrow('403');
  }
});

it('reports explicit no-terminal mode, rejects browser launch arguments and observed identities, revokes all sockets', async () => {
  const { server, origin, auth, terminals } = await fixture();
  const revoke = vi.spyOn(terminals, 'revokeObservation');
  const oldToken = server.terminalToken;
  const terminal = await auth(true, oldToken);
  const ws = socket(origin, 'terminal', terminal.cookie);
  const first = once(ws, 'message');
  await once(ws, 'open');
  expect(JSON.parse(String((await first)[0]))).toMatchObject({
    type: 'runs', available: false, reason: expect.stringContaining('disabled'), runs: [],
  });

  for (const command of [
    { version: 1, type: 'launch', executable: 'evil' },
    { version: 1, type: 'launch', requestId: 'forged-id', sessionId: '12345678-1234-4234-8234-123456789abc' },
    { version: 1, type: 'launch' },
    { version: 1, type: 'attach', runId: 'observed-agent', cursor: 0 },
    { version: 1, type: 'input', runId: 'forged', data: 'evil' },
  ]) {
    const reply = once(ws, 'message');
    ws.send(JSON.stringify(command));
    expect(JSON.parse(String((await reply)[0]))).toMatchObject({ type: 'error' });
  }
  const launchResult = once(ws, 'message');
  ws.send(JSON.stringify({ version: 1, type: 'launch', requestId: 'viewer-a-1' }));
  expect(JSON.parse(String((await launchResult)[0]))).toMatchObject({
    type: 'launchResult', requestId: 'viewer-a-1', result: { ok: false, message: expect.stringContaining('disabled') },
  });
  const officeCookie = (await auth(false, server.token)).cookie;
  const office = socket(origin, 'office', officeCookie);
  await once(office, 'open');
  const closed = Promise.all([once(ws, 'close'), once(office, 'close')]);
  server.rotate();
  expect(revoke).toHaveBeenCalledOnce();
  await closed;
  expect(server.terminalToken).not.toBe(oldToken);
  expect((await auth(true, oldToken)).status).toBe(403);
  await expect(once(socket(origin, 'terminal', terminal.cookie), 'open')).rejects.toThrow('403');
  const renewed = await auth(true, server.terminalToken);
  const fresh = socket(origin, 'terminal', renewed.cookie);
  await once(fresh, 'open');
  expect(fresh.readyState).toBe(WebSocket.OPEN);
});

it('closes command floods with an explicit input-loss/policy warning', async () => {
  const { server, origin, auth } = await fixture();
  const terminal = await auth(true, server.terminalToken);
  const ws = socket(origin, 'terminal', terminal.cookie);
  const messages: { type: string; message?: string }[] = [];
  ws.on('message', data => messages.push(JSON.parse(String(data))));
  const closed = once(ws, 'close');
  await once(ws, 'open');
  for (let count = 0; count < 65; count++) ws.send(JSON.stringify({ version: 1, type: 'list' }));
  expect((await closed)[0]).toBe(1008);
  expect(messages.some(message => message.type === 'error' && message.message?.includes('Some input'))).toBe(true);
});

it('correlates a busy launch rejection and allows a later deliberate launch', async () => {
  const { server, origin, auth, terminals } = await fixture(true);
  const terminal = await auth(true, server.terminalToken);
  const ws = socket(origin, 'terminal', terminal.cookie);
  const initialStatus = once(ws, 'message');
  await once(ws, 'open');
  expect(JSON.parse(String((await initialStatus)[0]))).toMatchObject({ type: 'runs', available: true, runs: [] });

  const firstResult = nextJson(ws, frame => frame.type === 'launchResult' && frame.requestId === 'open-first');
  ws.send(JSON.stringify({ version: 1, type: 'launch', requestId: 'open-first' }));
  const first = await firstResult;
  expect(first, JSON.stringify(first)).toMatchObject({ result: { ok: true } });
  const firstRunId = ((first.result as Record<string, unknown>).runId);
  expect(typeof firstRunId).toBe('string');

  let releaseClose!: () => void;
  let markCloseStarted!: () => void;
  const closeStarted = new Promise<void>(resolveStarted => { markCloseStarted = resolveStarted; });
  const closeGate = new Promise<void>(resolveGate => { releaseClose = resolveGate; });
  const originalClose = terminals.close.bind(terminals);
  const closeSpy = vi.spyOn(terminals, 'close').mockImplementation(async id => {
    markCloseStarted();
    await closeGate;
    await originalClose(id);
  });
  const closedInventory = nextJson(ws, frame => frame.type === 'runs' &&
    Array.isArray(frame.runs) && !frame.runs.some(run =>
      (run as { runId?: unknown }).runId === firstRunId));
  try {
    ws.send(JSON.stringify({ version: 1, type: 'terminate', runId: firstRunId }));
    await closeStarted;
    const busyResult = nextJson(ws, frame => frame.type === 'launchResult' && frame.requestId === 'during-close');
    ws.send(JSON.stringify({ version: 1, type: 'launch', requestId: 'during-close' }));
    expect(await busyResult).toMatchObject({
      result: { ok: false, message: 'Owned action in progress.' },
    });
    releaseClose();
    await closedInventory;
    await new Promise(resolveTick => setTimeout(resolveTick, 0));
  } finally {
    releaseClose();
    closeSpy.mockRestore();
  }
  const retryResult = nextJson(ws, frame => frame.type === 'launchResult' && frame.requestId === 'open-after-close');
  ws.send(JSON.stringify({ version: 1, type: 'launch', requestId: 'open-after-close' }));
  expect(await retryResult).toMatchObject({ result: { ok: true } });
});
