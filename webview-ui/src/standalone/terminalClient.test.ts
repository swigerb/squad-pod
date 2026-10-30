import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTerminalClient, type TerminalClientCallbacks } from './terminalClient.js';
import { decodeOwnedTerminalCommand, decodeOwnedTerminalEvent } from '../../../src/core/ownedTerminalProtocol.js';
import { runId, TERMINAL_LIMITS, utf8Bytes } from '../../../src/core/terminalFrames.js';

class Socket {
  readyState = 0;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  open() { this.readyState = 1; this.onopen?.(); }
  event(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  commands() { return this.send.mock.calls.map(([json]) => JSON.parse(json as string)); }
}
const id = runId('owned-fixture');
const base = { version: 1, runId: id } as const;
const runs = { version: 1, type: 'runs', available: true, reason: null,
  runs: [{ runId: id, pid: 123, state: 'running', exitCode: null }] };
const start = (cursor: number, through: number) => ({ ...base, type: 'replayStart', cursor, through });
const end = (through: number) => ({ ...base, type: 'replayEnd', through });
const output = (seq: number, data = `chunk${seq}`) => ({ ...base, type: 'output', seq, data });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function fixture(write = vi.fn(async (_data: string) => {})) {
  const sockets: Socket[] = [];
  const callbacks: TerminalClientCallbacks = {
    status: vi.fn(), runs: vi.fn(), launchResult: vi.fn(), ready: vi.fn(), resync: vi.fn(),
  };
  const display = { write, reset: vi.fn() };
  const client = createTerminalClient(display, callbacks, url => {
    expect(url).toBe('ws://127.0.0.1:1234/terminal');
    const socket = new Socket(); sockets.push(socket);
    return socket as unknown as WebSocket;
  }, 'http://127.0.0.1:1234');
  return { client, sockets, callbacks, display };
}
async function selected(write?: ReturnType<typeof vi.fn<(data: string) => Promise<void>>>) {
  const fixtureValue = fixture(write);
  fixtureValue.sockets[0].open();
  fixtureValue.client.select(id);
  const socket = fixtureValue.sockets.at(-1)!;
  socket.open();
  return { ...fixtureValue, socket };
}
afterEach(() => vi.useRealTimers());

describe('owned terminal strict wire boundary', () => {
  it('accepts only fixed list/launch controls and bounded runtime-issued run records', () => {
    expect(decodeOwnedTerminalCommand('{"version":1,"type":"launch","requestId":"viewer-a-1"}')).toEqual({
      version: 1, type: 'launch', requestId: 'viewer-a-1',
    });
    expect(() => decodeOwnedTerminalCommand('{"version":1,"type":"launch"}')).toThrow();
    expect(() => decodeOwnedTerminalCommand('{"version":1,"type":"launch","requestId":"../bad"}')).toThrow();
    expect(() => decodeOwnedTerminalCommand('{"version":1,"type":"launch","cwd":"private"}')).toThrow();
    expect(() => decodeOwnedTerminalCommand('{"version":2,"type":"list"}')).toThrow();
    expect(decodeOwnedTerminalEvent(JSON.stringify(runs))).toEqual(runs);
    expect(decodeOwnedTerminalEvent(JSON.stringify({
      version: 1, type: 'launchResult', requestId: 'viewer-a-1', result: { ok: true, runId: id },
    }))).toEqual({ version: 1, type: 'launchResult', requestId: 'viewer-a-1', result: { ok: true, runId: id } });
    expect(decodeOwnedTerminalEvent(JSON.stringify({
      version: 1, type: 'launchResult', requestId: 'viewer-a-1', result: { ok: false, message: 'unavailable' },
    })).type).toBe('launchResult');
    for (const invalid of [
      { ...runs, extra: true }, { ...runs, available: 'yes' },
      { version: 1, type: 'launchResult', requestId: 'bad/request', result: { ok: true, runId: id } },
      { version: 1, type: 'launchResult', requestId: 'ok', result: { ok: false, message: 'x'.repeat(1025) } },
      { version: 1, type: 'launchResult', requestId: 'ok', result: { ok: true, runId: 'bad run id' } },
      { ...runs, runs: [runs.runs[0], runs.runs[0]] },
      { ...runs, runs: [{ ...runs.runs[0], pid: 0 }] },
      { ...runs, runs: [{ ...runs.runs[0], state: 'observed' }] },
      { ...runs, runs: Array.from({ length: 129 }, () => runs.runs[0]) },
      { version: 1, type: 'error', message: 'x'.repeat(1025) },
      { ...output(1), unsafe: true },
    ]) expect(() => decodeOwnedTerminalEvent(JSON.stringify(invalid))).toThrow();
  });
});

describe('production owned terminal client', () => {
  it('lists only on connect; selecting, input, Unicode paste, resize and explicit terminate use raw frames', async () => {
    const { client, socket, sockets, display, callbacks } = await selected();
    expect(sockets[0].commands()).toEqual([{ version: 1, type: 'list' }]);
    expect(socket.commands()).toEqual([{ version: 1, type: 'list' }, { ...base, type: 'attach', cursor: 0 }]);
    expect(client.input('blocked before replay')).toEqual({ status: 'not-sent' });
    socket.event(runs);
    socket.event(start(0, 1)); socket.event(output(1, '\u001b[31mé中🚀')); socket.event(end(1));
    await flush();
    expect(callbacks.runs).toHaveBeenCalledWith(runs.runs, true, null);
    expect(display.write).toHaveBeenCalledExactlyOnceWith('\u001b[31mé中🚀');
    expect(client.input('🚀'.repeat(5000))).toEqual({ status: 'queued' });
    const inputs = socket.commands().filter(command => command.type === 'input');
    expect(inputs.map(command => command.data).join('')).toBe('🚀'.repeat(5000));
    expect(inputs.every(command => utf8Bytes(command.data) <= TERMINAL_LIMITS.inputBytes)).toBe(true);
    expect(client.input('\0'.repeat(20_000))).toEqual({ status: 'queued' });
    const controls = socket.commands().filter(command => command.type === 'input' && command.data.includes('\0'));
    expect(controls.map(command => command.data).join('')).toBe('\0'.repeat(20_000));
    expect(controls.every(command => utf8Bytes(JSON.stringify(command)) <= TERMINAL_LIMITS.frameBytes)).toBe(true);
    client.resize(80, 24); client.terminate(); client.launch('viewer-a-1');
    expect(socket.commands().slice(-3)).toEqual([
      { ...base, type: 'resize', cols: 80, rows: 24 }, { ...base, type: 'terminate' },
      { version: 1, type: 'launch', requestId: 'viewer-a-1' },
    ]);
    expect(client.launch('../bad')).toBe(false);
    client.dispose();
    expect(socket.commands().filter(command => command.type === 'terminate')).toHaveLength(1);
  });

  it('reports blocked and partial input without retrying already queued chunks', async () => {
    const { client, socket, callbacks } = await selected();
    socket.event(start(0, 0)); socket.event(end(0)); await flush();
    const chunkBytes = Math.min(TERMINAL_LIMITS.inputBytes, Math.floor((TERMINAL_LIMITS.frameBytes - 512) / 6));
    Object.defineProperty(socket, 'bufferedAmount', {
      configurable: true, get: () => socket.send.mock.calls.length ? TERMINAL_LIMITS.pendingBytes + 1 : 0,
    });
    expect(client.input('x'.repeat(chunkBytes + 1))).toEqual({ status: 'partial', sentCodeUnits: chunkBytes });
    expect(socket.commands().filter(command => command.type === 'input')).toHaveLength(1);
    expect(callbacks.status).toHaveBeenCalledWith(expect.stringContaining('backpressured'));
    client.dispose();
  });

  it('delivers ordered inventory then viewer-correlated success/failure results synchronously', async () => {
    const { client, socket, callbacks } = await selected();
    const order: string[] = [];
    vi.mocked(callbacks.runs).mockImplementation(() => { order.push('runs'); });
    vi.mocked(callbacks.launchResult!).mockImplementation(requestId => { order.push(`launch:${requestId}`); });
    socket.event(runs);
    socket.event({ version: 1, type: 'launchResult', requestId: 'viewer-a-1',
      result: { ok: true, runId: id } });
    socket.event({ version: 1, type: 'launchResult', requestId: 'viewer-b-1',
      result: { ok: false, message: 'Owned action in progress.' } });
    await flush();
    expect(order).toEqual(['runs', 'launch:viewer-a-1', 'launch:viewer-b-1']);
    client.dispose();
  });

  it('retains the same-page screen and reconnects only from the last applied write callback', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const write = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { client, socket, sockets, display } = await selected(write);
    socket.event(start(0, 1)); socket.event(output(1)); socket.event(end(1));
    await flush();
    socket.onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(2);
    finish(); await flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets).toHaveLength(3);
    sockets[2].open();
    expect(sockets[2].commands()).toContainEqual({ ...base, type: 'attach', cursor: 1 });
    expect(display.reset).toHaveBeenCalledOnce();
    expect(sockets.flatMap(item => item.commands()).some(command => command.type === 'launch')).toBe(false);
    client.dispose();
  });

  it('never restores a cursor without its screen on a new page', async () => {
    const first = await selected();
    first.socket.event(start(0, 1)); first.socket.event(output(1)); first.socket.event(end(1));
    await flush(); first.client.dispose();
    const second = await selected();
    expect(second.socket.commands()).toContainEqual({ ...base, type: 'attach', cursor: 0 });
    second.client.dispose();
  });

  it.each([1008, 1009, 4009])('requires explicit recovery when the server closes with policy/resync code %s', async code => {
    vi.useFakeTimers();
    const { client, socket, sockets, callbacks } = await selected();
    socket.onclose?.({ code });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(2);
    expect(callbacks.resync).toHaveBeenLastCalledWith(true);
    expect(callbacks.status).toHaveBeenLastCalledWith(expect.stringContaining('Some input may not have been applied'));
    client.dispose();
  });

  it('invalidates a pending renderer callback when switching runs, and clears only after it settles', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const write = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { client, socket, sockets, display, callbacks } = await selected(write);
    socket.event(start(0, 1)); socket.event(output(1)); await flush();
    const another = runId('another-owned');
    client.select(another);
    expect(display.reset).toHaveBeenCalledOnce();
    finish(); await flush();
    await vi.advanceTimersByTimeAsync(10);
    expect(display.reset).toHaveBeenCalledTimes(2);
    sockets[2].open();
    expect(sockets[2].commands()).toContainEqual({ version: 1, type: 'attach', runId: another, cursor: 0 });
    expect(callbacks.resync).not.toHaveBeenCalledWith(true);
    expect(callbacks.ready).not.toHaveBeenCalledWith(true);
    client.dispose();
  });

  it('never publishes a stale renderer acknowledgement after disposing its screen', async () => {
    let finish!: () => void;
    const write = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { client, socket, callbacks } = await selected(write);
    socket.event(start(0, 1)); socket.event(output(1)); socket.event(end(1)); await flush();
    client.dispose();
    vi.mocked(callbacks.ready).mockClear(); vi.mocked(callbacks.resync).mockClear();
    finish(); await flush();
    expect(callbacks.ready).not.toHaveBeenCalled();
    expect(callbacks.resync).not.toHaveBeenCalled();
  });

  it('stops on an explicit gap and requires visible reset from the supplied earliest minus one', async () => {
    const { client, socket, sockets, display, callbacks } = await selected();
    socket.event({ ...base, type: 'resync', reason: 'history-gap', earliest: 20, latest: 30 });
    await flush();
    expect(callbacks.resync).toHaveBeenLastCalledWith(true);
    expect(socket.close).toHaveBeenCalledOnce();
    client.reconnect(); client.input('blocked'); client.resize(80, 24);
    expect(sockets).toHaveLength(2);
    expect(display.reset).toHaveBeenCalledOnce();
    client.resync();
    expect(display.reset).toHaveBeenCalledTimes(2);
    expect(callbacks.status).toHaveBeenCalledWith(expect.stringContaining('may be lost'));
    sockets[2].open();
    expect(sockets[2].commands()).toContainEqual({ ...base, type: 'attach', cursor: 19 });
    client.dispose();
  });

  it.each(['gap', 'render', 'malformed', 'binary'])('closes and blocks unsafe %s processing', async kind => {
    const write = vi.fn(async (_data: string) => { if (kind === 'render') throw new Error('write failed'); });
    const { client, socket, callbacks } = await selected(write);
    socket.event(start(0, 0)); socket.event(end(0)); await flush();
    if (kind === 'gap') socket.event(output(2));
    if (kind === 'render') socket.event(output(1));
    if (kind === 'malformed') socket.event({ version: 2, type: 'runs' });
    if (kind === 'binary') socket.onmessage?.({ data: new ArrayBuffer(4) });
    await flush();
    expect(callbacks.resync).toHaveBeenLastCalledWith(true);
    expect(socket.close).toHaveBeenCalledOnce();
    client.dispose();
  });

  it.each(['frames', 'bytes'])('bounds queued %s including an in-flight browser write', async limit => {
    let finish!: () => void;
    const write = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { client, socket, callbacks, sockets } = await selected(write);
    socket.event(start(0, 1)); socket.event(output(1)); await flush();
    const count = limit === 'frames' ? TERMINAL_LIMITS.pendingFrames : 20;
    for (let i = 0; i < count; i++) socket.event(output(i + 2, limit === 'bytes' ? 'x'.repeat(60_000) : 'x'));
    expect(callbacks.resync).toHaveBeenLastCalledWith(true);
    expect(socket.close).toHaveBeenCalledOnce();
    finish(); await flush();
    expect(write).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(2);
    client.dispose();
  });
});
