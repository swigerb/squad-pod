import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import { createOfficeControl, decodeControl, type ControlRequest } from './officeControl.js';
import { startTransport } from './transport.js';
import type { OutboundMessage } from '../../src/types.js';

const owned: string[] = [];
const servers: Awaited<ReturnType<typeof startTransport>>[] = [];
const sockets: WebSocket[] = [];
const layout = { version: 2, cols: 2, rows: 2, tiles: [1, 1, 1, 1], furniture: [] };
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const server of servers.splice(0)) await server.dispose();
  for (const root of owned.splice(0)) fs.rmSync(root, { force: true, recursive: true });
});
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office control test ')));
  owned.push(root);
  fs.mkdirSync(path.join(root, '.squad'));
  fs.mkdirSync(path.join(root, 'bundle'));
  fs.writeFileSync(path.join(root, 'bundle', 'index.html'), '<html>fixture</html>');
  fs.writeFileSync(path.join(root, '.squad', 'team.md'), '## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n| TestBot | Developer | .squad/agents/test-agent-1/charter.md | Active |\n');
  return { root, control: createOfficeControl(root) };
}
async function server(enabled = true) {
  const { root, control } = fixture();
  const transport = await startTransport({
    staticRoot: path.join(root, 'bundle'), officeControl: enabled ? control : undefined,
    snapshot: async () => [{ type: 'layoutLoaded', layout, revision: control.store.readLayout().revision, workspaceRoot: root }],
    subscribe: () => () => {},
  });
  servers.push(transport);
  const origin = `http://127.0.0.1:${transport.port}`;
  const auth = async (endpoint: string, token: string) => {
    const response = await fetch(`${origin}${endpoint}`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
    });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  return { root, control, transport, origin, auth };
}
type Frame = { kind: string; code?: string; requestId?: number; preferencesRevision?: string | null;
  preferences?: { agents: Record<string, { seatId?: string }>; settings: { showAreas: boolean } };
  messages?: OutboundMessage[]; message?: OutboundMessage };
async function socket(origin: string, endpoint: string, cookie: string) {
  const ws = new WebSocket(`${origin.replace('http:', 'ws:')}${endpoint}`, { headers: { Origin: origin, Cookie: cookie } });
  sockets.push(ws);
  const frames: Frame[] = [];
  let wake: (() => void) | undefined;
  ws.on('message', data => { frames.push(JSON.parse(data.toString()) as Frame); wake?.(); });
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  async function next(predicate: (frame: Frame) => boolean): Promise<Frame> {
    for (;;) {
      const index = frames.findIndex(predicate);
      if (index >= 0) return frames.splice(index, 1)[0];
      await new Promise<void>(resolve => { wake = resolve; });
      wake = undefined;
    }
  }
  return { ws, next, send: (frame: unknown) => ws.send(JSON.stringify(frame)) };
}
const request = (root: string, revision: string | null = null, id = 1): ControlRequest => ({
  version: 1, kind: 'control', requestId: id, expectedRevision: revision,
  message: { type: 'saveLayout', layout, workspaceRoot: root, expectedRevision: revision },
});

describe('separate authenticated office control', () => {
  it('is disabled by default and viewer/terminal credentials cannot authenticate control', async () => {
    const disabled = await server(false);
    expect(disabled.transport.controlToken).toBeNull();
    expect((await disabled.auth('/control-auth', disabled.transport.token)).status).toBe(403);
    const active = await server();
    for (const token of [active.transport.token, active.transport.terminalToken]) {
      expect((await active.auth('/control-auth', token)).status).toBe(403);
    }
    expect((await active.auth('/auth', active.transport.controlToken!)).status).toBe(403);
    expect((await active.auth('/terminal-auth', active.transport.controlToken!)).status).toBe(403);
    expect(fs.existsSync(path.join(active.root, '.squad-pod'))).toBe(false);
    const wrongOrigin = await fetch(`${active.origin}/control-auth`, {
      method: 'POST', headers: { Origin: 'http://127.0.0.1:1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: active.transport.controlToken }),
    });
    expect(wrongOrigin.status).toBe(403);
  });

  it('rejects forged viewer mutations server-side and commits only explicitly authorized control', async () => {
    const f = await server();
    const viewer = await socket(f.origin, '/office', (await f.auth('/auth', f.transport.token)).cookie);
    viewer.send(request(f.root));
    expect(await viewer.next(frame => frame.kind === 'error')).toMatchObject({ code: 'READ_ONLY' });
    expect(f.control.store.readLayout().value).toBeNull();
    const editor = await socket(f.origin, '/control', (await f.auth('/control-auth', f.transport.controlToken!)).cookie);
    editor.send({ version: 1, kind: 'office', message: { type: 'webviewReady' } });
    await editor.next(frame => frame.message?.type === 'layoutLoaded');
    editor.send(request(f.root));
    expect(await editor.next(frame => frame.kind === 'controlResult')).toMatchObject({
      requestId: 1, messages: [{ type: 'layoutSaved', layout, revision: expect.stringMatching(/^[a-f0-9]{64}$/) }],
    });
    expect(fs.readFileSync(path.join(f.root, '.squad-pod', 'layout.json'), 'utf8')).toBe(JSON.stringify(layout, null, 2));
    editor.send({ version: 1, kind: 'control', requestId: 2, expectedRevision: null, message: { type: 'setShowAreas', enabled: true } });
    expect(await editor.next(frame => frame.kind === 'controlResult' && frame.requestId === 2)).toMatchObject({
      messages: [{ type: 'settingsLoaded', showAreas: true }],
    });
    expect(f.control.store.readPreferences().value?.settings.showAreas).toBe(true);
    const bytes = fs.readFileSync(path.join(f.root, '.squad-pod', 'office-preferences.json'), 'utf8');
    editor.send({ version: 1, kind: 'control', requestId: 2, expectedRevision: f.control.store.readPreferences().revision,
      message: { type: 'setShowAreas', enabled: false } });
    expect(await editor.next(frame => frame.kind === 'error')).toMatchObject({ code: 'INVALID_MESSAGE' });
    expect(fs.readFileSync(path.join(f.root, '.squad-pod', 'office-preferences.json'), 'utf8')).toBe(bytes);
  });

  it('revokes control cookies and open sockets on rotation and restart identities differ', async () => {
    const f = await server();
    const auth = await f.auth('/control-auth', f.transport.controlToken!);
    const editor = await socket(f.origin, '/control', auth.cookie);
    const closed = new Promise(resolve => editor.ws.once('close', resolve));
    const before = f.transport.controlToken;
    f.transport.rotate();
    await closed;
    expect(f.transport.controlToken).not.toBe(before);
    const context = await fetch(`${f.origin}/office-context`, { headers: { Cookie: auth.cookie } });
    expect(context.status).toBe(403);
    expect(f.control.store.readLayout().value).toBeNull();
    const newCookie = (await f.auth('/control-auth', f.transport.controlToken!)).cookie;
    const firstIdentity = await (await fetch(`${f.origin}/office-context`, { headers: { Cookie: newCookie } })).json() as { serverIdentity: string };
    const next = await server();
    const nextCookie = (await next.auth('/control-auth', next.transport.controlToken!)).cookie;
    const secondIdentity = await (await fetch(`${next.origin}/office-context`, { headers: { Cookie: nextCookie } })).json() as { serverIdentity: string };
    expect(firstIdentity.serverIdentity).not.toBe(secondIdentity.serverIdentity);
  });

  it('compares preferences revisions and rejects identity substitution and unknown agents', () => {
    const { control, root } = fixture();
    const allowed = () => {};
    const setting = { version: 1, kind: 'control', requestId: 1, expectedRevision: null, message: { type: 'setShowAreas', enabled: true } };
    control.mutate(decodeControl(setting), allowed);
    const winner = control.store.readPreferences();
    const stale = control.mutate(decodeControl({ ...setting, message: { type: 'setDebugEnabled', enabled: true } }), allowed);
    expect(stale).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'layoutError', error: expect.stringContaining('conflict') })]));
    expect(control.store.readPreferences()).toEqual(winner);
    expect(() => control.mutate(request(path.join(root, '..')), allowed)).toThrow('identity');
    expect(() => control.mutate(decodeControl({
      ...setting, expectedRevision: winner.revision, message: { type: 'saveAgentSeats', seats: { 'unknown-agent': 'seat-1' } },
    }), allowed)).toThrow('unknown');
  });

  it('keeps removed/renamed member history without blocking settings or authorizing unknown seat writes', () => {
    const { control, root } = fixture();
    const initial = control.store.savePreferences({
      version: 1, settings: { soundEnabled: false, debugEnabled: false, showAreas: false },
      agents: { 'test-agent-1': { palette: 7, seatId: 'original-seat' } },
    }, null, new Set(['test-agent-1']), () => {});
    const team = path.join(root, '.squad', 'team.md');
    fs.writeFileSync(team, fs.readFileSync(team, 'utf8').replaceAll('test-agent-1', 'test-agent-renamed'));
    const setting = decodeControl({ version: 1, kind: 'control', requestId: 1,
      expectedRevision: initial.revision, message: { type: 'setDebugEnabled', enabled: true } });
    expect(control.mutate(setting, () => {})).toContainEqual(expect.objectContaining({ type: 'settingsLoaded', debugEnabled: true }));
    let current = control.store.readPreferences();
    const seats = (map: Record<string, string>) => decodeControl({ version: 1, kind: 'control', requestId: 2,
      expectedRevision: current.revision, message: { type: 'saveAgentSeats', seats: map } });
    control.mutate(seats({ 'test-agent-renamed': 'new-seat' }), () => {});
    current = control.store.readPreferences();
    expect(current.value?.agents).toEqual({
      'test-agent-1': { palette: 7, seatId: 'original-seat' }, 'test-agent-renamed': { seatId: 'new-seat' },
    });
    expect(() => control.mutate(seats({ 'test-agent-1': 'forged-seat' }), () => {})).toThrow('unknown');
    expect(() => control.mutate(seats({ 'never-a-member': 'forged-seat' }), () => {})).toThrow('unknown');
    fs.writeFileSync(team, '## Members\n');
    control.mutate(decodeControl({ ...setting, expectedRevision: current.revision,
      message: { type: 'setShowAreas', enabled: true } }), () => {});
    expect(control.store.readPreferences().value?.agents).toEqual(current.value?.agents);
    fs.writeFileSync(team, '## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n| TestBot | Developer | .squad/agents/test-agent-1/charter.md | Active |\n');
    expect(control.store.readPreferences().value?.agents['test-agent-1']).toEqual({ palette: 7, seatId: 'original-seat' });
  });

  it('never falls back to legacy roster authorization when .squad exists but team.md is absent', () => {
    const { control, root } = fixture();
    fs.mkdirSync(path.join(root, '.ai-team'));
    fs.renameSync(path.join(root, '.squad', 'team.md'), path.join(root, '.ai-team', 'team.md'));
    const seats = decodeControl({ version: 1, kind: 'control', requestId: 1, expectedRevision: null,
      message: { type: 'saveAgentSeats', seats: { 'test-agent-1': 'legacy-seat' } } });
    expect(() => control.mutate(seats, () => {})).toThrow('unknown');
    expect(control.store.readPreferences().value).toBeNull();
    fs.rmdirSync(path.join(root, '.squad'));
    control.mutate(seats, () => {});
    expect(control.store.readPreferences().value?.agents['test-agent-1']).toEqual({ seatId: 'legacy-seat' });
  });

  it('checks connection generation again when control is revoked during dispatch', async () => {
    const f = await server();
    const original = f.control.mutate;
    f.control.mutate = (mutation, assertAuthority) => {
      assertAuthority();
      f.transport.rotate();
      return original(mutation, assertAuthority);
    };
    const editor = await socket(f.origin, '/control', (await f.auth('/control-auth', f.transport.controlToken!)).cookie);
    editor.send({ version: 1, kind: 'office', message: { type: 'webviewReady' } });
    await editor.next(frame => frame.message?.type === 'layoutLoaded');
    const closed = new Promise(resolve => editor.ws.once('close', resolve));
    editor.send(request(f.root));
    await closed;
    expect(f.control.store.readLayout().value).toBeNull();
    expect(fs.existsSync(path.join(f.root, '.squad-pod'))).toBe(false);
  });

  it('carries authoritative two-viewer seat/settings state with the revision on an interleaved detail reply', async () => {
    const f = await server();
    const team = path.join(f.root, '.squad', 'team.md');
    fs.appendFileSync(team, '| TestBot2 | Developer | .squad/agents/test-agent-2/charter.md | Active |\n');
    const cookie = (await f.auth('/control-auth', f.transport.controlToken!)).cookie;
    const a = await socket(f.origin, '/control', cookie);
    const b = await socket(f.origin, '/control', cookie);
    for (const client of [a, b]) {
      client.send({ version: 1, kind: 'office', message: { type: 'webviewReady' } });
      await client.next(frame => frame.message?.type === 'layoutLoaded');
      await client.next(frame => frame.kind === 'controlState');
    }
    b.send({ version: 1, kind: 'control', requestId: 1, expectedRevision: null,
      message: { type: 'saveAgentSeats', seats: { 'test-agent-2': 'viewer-b-seat' } } });
    await b.next(frame => frame.kind === 'controlResult');
    const bState = await b.next(frame => frame.kind === 'controlState');
    b.send({ version: 1, kind: 'control', requestId: 2, expectedRevision: bState.preferencesRevision,
      message: { type: 'setShowAreas', enabled: true } });
    await b.next(frame => frame.kind === 'controlResult' && frame.requestId === 2);
    a.send({ version: 1, kind: 'office', message: { type: 'requestAgentDetail', agentId: 'test-agent-1', requestId: 'detail-a' } });
    const authoritative = await a.next(frame => frame.kind === 'controlState');
    expect(authoritative).toMatchObject({ preferencesRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
      preferences: { agents: { 'test-agent-2': { seatId: 'viewer-b-seat' } }, settings: { showAreas: true } } });
    a.send({ version: 1, kind: 'control', requestId: 1, expectedRevision: authoritative.preferencesRevision,
      message: { type: 'saveAgentSeats', seats: { 'test-agent-1': 'viewer-a-seat', 'test-agent-2': 'viewer-b-seat' } } });
    await a.next(frame => frame.kind === 'controlResult');
    expect(f.control.store.readPreferences().value).toMatchObject({
      settings: { showAreas: true }, agents: { 'test-agent-1': { seatId: 'viewer-a-seat' }, 'test-agent-2': { seatId: 'viewer-b-seat' } },
    });
  });

  it('rejects unsupported directions, arbitrary paths/settings, malformed and oversized shapes', () => {
    const { root } = fixture();
    for (const message of [
      { type: 'setLiveActivity', enabled: true }, { type: 'launchDirectory', id: root, source: 'workspace' },
      { type: 'selectCliUsage' }, { type: 'refreshCliUsage' }, { type: 'clearCliUsage' },
      { type: 'saveAgentSeats', seats: { '../outside': 'seat' } }, { type: 'importLayout', path: root },
      { type: 'setShowAreas', enabled: 'yes' }, { type: 'setShowAreas', enabled: true, path: root },
      { type: 'saveLayout', layout: { ...layout, cols: 257 }, expectedRevision: null, workspaceRoot: root },
    ]) expect(() => decodeControl({ ...request(root), message })).toThrow();
    expect(() => decodeControl({ ...request(root), arbitraryTarget: root })).toThrow();
    expect(() => decodeControl({ ...request(root), requestId: -1 })).toThrow();
  });
});
