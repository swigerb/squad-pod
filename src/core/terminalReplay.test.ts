import { describe, expect, it, vi } from 'vitest';
import {
  encodeTerminalFrame, runId, TERMINAL_LIMITS, utf8Bytes,
  type OutputFrame, type TerminalEvent,
} from './terminalFrames.js';
import {
  attachTerminal, TerminalHistory, TerminalReceiver,
  type ReplaySnapshot, type TerminalSink, type TerminalSource,
} from './terminalReplay.js';

const id = runId('fixture-run');
const base = { version: 1, runId: id } as const;
const output = (seq: number, data = `chunk-${seq}`): OutputFrame => ({ ...base, type: 'output', seq, data });
const sizedOutput = (seq: number, bytes: number) => {
  const overhead = utf8Bytes(encodeTerminalFrame(output(seq, 'x'))) - 1;
  return output(seq, 'x'.repeat(bytes - overhead));
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const history = new TerminalHistory(id);
  const events: TerminalEvent[] = [];
  const sink: TerminalSink = {
    send: vi.fn(async frame => { events.push(frame); }),
    abort: vi.fn(frame => { encodeTerminalFrame(frame); events.push(frame); }),
  };
  return { history, events, sink };
}
function delayedSource(history: TerminalHistory) {
  const snapshot = deferred<ReplaySnapshot>();
  const source: TerminalSource = {
    runId: id,
    subscribe: vi.fn(listener => history.subscribe(listener)),
    snapshot: vi.fn(() => snapshot.promise),
  };
  return { source, snapshot };
}

describe('terminal replay and reconnect', () => {
  it('explicitly resyncs live and reconnecting viewers after native output failure', async () => {
    const { history, sink, events } = fixture();
    const attachment = attachTerminal(history, 0, sink);
    await attachment.ready;
    history.fail();
    expect(events.at(-1)).toMatchObject({ type: 'resync', reason: 'source-error' });
    expect(() => history.append('cannot mask lost output')).toThrow('failed');
    const reconnect = fixture();
    await attachTerminal(history, 0, reconnect.sink).ready;
    expect(reconnect.events.at(-1)).toMatchObject({ type: 'resync', reason: 'source-error' });
  });
  it('subscribes before taking a snapshot and serializes replay before interleaved live output', async () => {
    const { history, events, sink } = fixture();
    history.append('before');
    const { source, snapshot } = delayedSource(history);
    const attach = attachTerminal(source, 0, sink);
    expect(vi.mocked(source.subscribe).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(source.snapshot).mock.invocationCallOrder[0]);
    history.append('included-in-snapshot');
    const captured = await history.snapshot(0);
    history.append('\u00e9\u4e2d\ud83d\ude80-live');
    expect(events).toEqual([]);
    snapshot.resolve(captured);
    await attach.ready;
    expect(events.map(frame => frame.type)).toEqual(['replayStart', 'output', 'output', 'replayEnd', 'output']);
    expect(events.filter(frame => frame.type === 'output').map(frame => frame.seq)).toEqual([1, 2, 3]);
    const receiver = new TerminalReceiver(id);
    const text = events.filter(frame => receiver.accept(frame) === 'output')
      .map(frame => frame.type === 'output' ? frame.data : '').join('');
    expect(text).toBe('beforeincluded-in-snapshot\u00e9\u4e2d\ud83d\ude80-live');
    expect(receiver.cursor).toBe(3);
    attach.dispose();
    history.append('after-disconnect');
    expect(events).toHaveLength(5);
  });

  it('reattaches to the same owned run with a cursor and never spawns or terminates a process', async () => {
    const { history, events, sink } = fixture();
    const process = { spawn: vi.fn(() => history), terminate: vi.fn() };
    const existing = process.spawn();
    existing.append('first');
    const first = attachTerminal(existing, 0, sink);
    await first.ready;
    first.dispose();
    existing.append('while-disconnected');
    events.length = 0;
    const second = attachTerminal(existing, 1, sink);
    await second.ready;
    expect(events).toEqual([
      { ...base, type: 'replayStart', cursor: 1, through: 2 },
      output(2, 'while-disconnected'), { ...base, type: 'replayEnd', through: 2 },
    ]);
    expect(process.spawn).toHaveBeenCalledOnce();
    expect(process.terminate).not.toHaveBeenCalled();
    second.dispose();
  });

  it('allows an empty replay, reports cursor-ahead and detaches during snapshot resolution', async () => {
    const { history, events, sink } = fixture();
    await attachTerminal(history, 0, sink).ready;
    expect(events.map(frame => frame.type)).toEqual(['replayStart', 'replayEnd']);
    events.length = 0;
    await attachTerminal(history, 1, sink).ready;
    expect(events).toEqual([{ ...base, type: 'resync', reason: 'cursor-ahead', earliest: 1, latest: 0 }]);
    const { source, snapshot } = delayedSource(history);
    const pending = attachTerminal(source, 0, sink);
    pending.dispose();
    snapshot.resolve(await history.snapshot(0));
    await pending.ready;
    expect(events).toHaveLength(1);
    expect(() => attachTerminal(history, -1, sink)).toThrow('cursor');
  });

  it('buffers reentrant live output during transport sends and never sends concurrently', async () => {
    const { history, events, sink } = fixture();
    history.append('replay');
    let active = false;
    sink.send = vi.fn(async frame => {
      expect(active).toBe(false);
      active = true;
      events.push(frame);
      if (frame.type === 'replayStart') {history.append('during-send');}
      await Promise.resolve();
      active = false;
    });
    const attach = attachTerminal(history, 0, sink);
    await attach.ready;
    expect(events.map(frame => frame.type)).toEqual(['replayStart', 'output', 'replayEnd', 'output']);
    expect(events.at(-1)).toEqual(output(2, 'during-send'));
    attach.dispose();
  });

  it('detaches an overflowing synchronous subscription before requesting a snapshot', async () => {
    const { sink } = fixture();
    const unsubscribe = vi.fn();
    const source: TerminalSource = {
      runId: id,
      subscribe(listener) {
        for (let seq = 1; seq <= TERMINAL_LIMITS.pendingFrames + 1; seq++) { listener(output(seq, 'x')); }
        return unsubscribe;
      },
      snapshot: vi.fn(async () => ({ earliest: 1, through: 0, frames: [] })),
    };
    await attachTerminal(source, 0, sink).ready;
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(source.snapshot).not.toHaveBeenCalled();
    expect(sink.abort).toHaveBeenCalledOnce();
  });

  it('reports source/sink failures and malformed snapshots explicitly', async () => {
    for (const invalid of [
      { earliest: 0, through: 0, frames: [] },
      { earliest: 1, through: 2, frames: [output(2)] },
      { earliest: 1, through: 2, frames: [output(1)] },
    ]) {
      const { history, sink } = fixture();
      const { source, snapshot } = delayedSource(history);
      const attach = attachTerminal(source, 0, sink);
      snapshot.resolve(invalid);
      await attach.ready;
      expect(sink.abort).toHaveBeenCalledWith(expect.objectContaining({ reason: 'source-error' }));
    }
    const { history, sink } = fixture();
    const delayed = delayedSource(history);
    const attach = attachTerminal(delayed.source, 0, sink);
    delayed.snapshot.reject(new Error('snapshot failed'));
    await attach.ready;
    expect(sink.abort).toHaveBeenCalledOnce();
    const failed = fixture();
    failed.sink.send = vi.fn(async () => { throw new Error('transport failed'); });
    await attachTerminal(failed.history, 0, failed.sink).ready;
    expect(failed.sink.abort).toHaveBeenCalledOnce();
  });
});

describe('bounded retained history and per-connection replay/live queues', () => {
  it.each(['bytes', 'frames'] as const)('rejects source snapshots beyond the captured-history %s bound', async limit => {
    const { history, sink } = fixture();
    const { source, snapshot } = delayedSource(history);
    const count = limit === 'bytes' ? 17 : TERMINAL_LIMITS.historyFrames + 1;
    const frames = Array.from({ length: count }, (_, index) =>
      limit === 'bytes' ? sizedOutput(index + 1, TERMINAL_LIMITS.frameBytes) : output(index + 1));
    const attach = attachTerminal(source, 0, sink);
    snapshot.resolve({ earliest: 1, through: count, frames });
    await attach.ready;
    expect(sink.abort).toHaveBeenCalledWith(expect.objectContaining({ reason: 'source-error' }));
    expect(sink.send).not.toHaveBeenCalled();
  });

  it('retains the exact history frame count and explicitly requires resync for an evicted cursor', async () => {
    const { history, sink, events } = fixture();
    for (let i = 0; i < TERMINAL_LIMITS.historyFrames; i++) {history.append('x');}
    expect((await history.snapshot(0)).frames).toHaveLength(TERMINAL_LIMITS.historyFrames);
    history.append('x');
    const snapshot = await history.snapshot(0);
    expect(snapshot.earliest).toBe(2);
    expect(snapshot.frames).toHaveLength(TERMINAL_LIMITS.historyFrames);
    await attachTerminal(history, 0, sink).ready;
    expect(events).toEqual([{
      ...base, type: 'resync', reason: 'history-gap', earliest: 2, latest: TERMINAL_LIMITS.historyFrames + 1,
    }]);
    events.length = 0;
    vi.mocked(sink.abort).mockClear();
    const oldest = attachTerminal(history, 1, sink);
    await oldest.ready;
    expect(sink.abort).not.toHaveBeenCalled();
    expect(events).toHaveLength(TERMINAL_LIMITS.historyFrames + 2);
    const receiver = new TerminalReceiver(id, 1);
    for (const frame of events) { receiver.accept(frame); }
    expect(receiver.cursor).toBe(TERMINAL_LIMITS.historyFrames + 1);
    oldest.dispose();
  });

  it('bounds history by serialized UTF-8 bytes and rejects oversized output atomically', async () => {
    const history = new TerminalHistory(id);
    for (let seq = 1; seq <= 16; seq++) {history.append(sizedOutput(seq, TERMINAL_LIMITS.frameBytes).data);}
    const full = await history.snapshot(0);
    expect(full.frames.reduce((sum, frame) => sum + utf8Bytes(encodeTerminalFrame(frame)), 0))
      .toBe(TERMINAL_LIMITS.historyBytes);
    history.append('next');
    expect((await history.snapshot(0)).earliest).toBe(2);
    expect(() => history.append('x'.repeat(TERMINAL_LIMITS.frameBytes))).toThrow('byte limit');
    expect((await history.snapshot(0)).through).toBe(17);
  });

  it('replays from the exact retained-history boundary without changing immutable payloads', async () => {
    const { history, sink, events } = fixture();
    for (let seq = 1; seq <= 17; seq++) { history.append(sizedOutput(seq, TERMINAL_LIMITS.frameBytes).data); }
    const snapshot = await history.snapshot(16);
    expect(snapshot.earliest).toBe(2);
    expect(Object.isFrozen(snapshot.frames[0])).toBe(true);
    await attachTerminal(history, 16, sink).ready;
    expect(sink.abort).not.toHaveBeenCalled();
    expect(events.map(frame => frame.type)).toEqual(['replayStart', 'output', 'replayEnd']);
    expect(events[1]).toEqual(snapshot.frames[0]);
    const full = fixture();
    const source: TerminalSource = {
      runId: id, subscribe: listener => history.subscribe(listener),
      snapshot: cursor => history.snapshot(cursor),
    };
    await attachTerminal(source, 1, full.sink).ready;
    expect(full.sink.abort).not.toHaveBeenCalled();
    expect(full.events).toHaveLength(18);
    expect(full.events.filter(frame => frame.type === 'output').map(frame => frame.seq))
      .toEqual(Array.from({ length: 16 }, (_, index) => index + 2));
    const receiver = new TerminalReceiver(id, 1);
    for (const frame of full.events) { receiver.accept(frame); }
    expect(receiver.cursor).toBe(17);
  });

  it.each(['bytes', 'frames'] as const)('caps pending live %s during delayed replay at the exact limit', async limit => {
    const { history, sink, events } = fixture();
    const { source, snapshot } = delayedSource(history);
    const attach = attachTerminal(source, 0, sink);
    const count = limit === 'bytes' ? 16 : TERMINAL_LIMITS.pendingFrames;
    for (let seq = 1; seq <= count; seq++) {
      history.append(limit === 'bytes' ? sizedOutput(seq, TERMINAL_LIMITS.frameBytes).data : 'x');
    }
    expect(sink.abort).not.toHaveBeenCalled();
    history.append('one-over');
    expect(sink.abort).toHaveBeenCalledOnce();
    expect(events).toEqual([expect.objectContaining({ type: 'resync', reason: 'overflow' })]);
    history.append('must-not-queue');
    snapshot.resolve(await history.snapshot(0));
    await attach.ready;
    expect(sink.send).not.toHaveBeenCalled();
    expect(sink.abort).toHaveBeenCalledOnce();
  });

  it('includes replay boundaries and the in-flight send in the pending frame budget', async () => {
    const { history, sink } = fixture();
    const blocked = deferred<void>();
    sink.send = vi.fn(() => blocked.promise);
    const attach = attachTerminal(history, 0, sink);
    await Promise.resolve();
    expect(sink.send).toHaveBeenCalledOnce();
    for (let seq = 1; seq <= TERMINAL_LIMITS.pendingFrames - 1; seq++) {history.append('x');}
    expect(sink.abort).not.toHaveBeenCalled();
    history.append('overflow');
    expect(sink.abort).toHaveBeenCalledWith(expect.objectContaining({ reason: 'overflow' }));
    blocked.resolve();
    await attach.ready;
    expect(sink.send).toHaveBeenCalledOnce();
  });

  it('slow-client overflow does not interrupt another attachment or the owned source', async () => {
    const { history, sink, events } = fixture();
    const stalled = deferred<void>();
    const slow: TerminalSink = { send: vi.fn(() => stalled.promise), abort: vi.fn() };
    const slowAttach = attachTerminal(history, 0, slow);
    const fastAttach = attachTerminal(history, 0, sink);
    await fastAttach.ready;
    for (let seq = 1; seq <= TERMINAL_LIMITS.pendingFrames; seq++) {
      history.append('live');
      await Promise.resolve();
    }
    expect(slow.abort).toHaveBeenCalledOnce();
    expect(sink.abort).not.toHaveBeenCalled();
    expect(events.filter(frame => frame.type === 'output')).toHaveLength(TERMINAL_LIMITS.pendingFrames);
    history.append('still-owned');
    await Promise.resolve();
    expect(events.at(-1)).toEqual(output(TERMINAL_LIMITS.pendingFrames + 1, 'still-owned'));
    stalled.resolve();
    await slowAttach.ready;
    fastAttach.dispose();
  });

  it('includes replay boundaries and the in-flight send in the pending byte budget', async () => {
    const { history, sink } = fixture();
    const blocked = deferred<void>();
    sink.send = vi.fn(() => blocked.promise);
    const attach = attachTerminal(history, 0, sink);
    await Promise.resolve();
    let remaining = TERMINAL_LIMITS.pendingBytes -
      utf8Bytes(encodeTerminalFrame({ ...base, type: 'replayStart', cursor: 0, through: 0 }));
    let seq = 1;
    while (remaining > 0) {
      const bytes = Math.min(remaining, TERMINAL_LIMITS.frameBytes);
      history.append(sizedOutput(seq++, bytes).data);
      remaining -= bytes;
    }
    expect(sink.abort).not.toHaveBeenCalled();
    history.append('\ud83d\ude80');
    expect(sink.abort).toHaveBeenCalledWith(expect.objectContaining({ reason: 'overflow' }));
    blocked.resolve();
    await attach.ready;
  });

  it.each([4094, 4095, TERMINAL_LIMITS.historyFrames])(
    'incrementally replays all %i retained records to a promptly draining sink',
    async count => {
      const { history, sink, events } = fixture();
      for (let i = 0; i < count; i++) { history.append('x'); }
      const attach = attachTerminal(history, 0, sink);
      await attach.ready;
      expect(sink.abort).not.toHaveBeenCalled();
      expect(events).toHaveLength(count + 2);
      expect(events[0]).toEqual({ ...base, type: 'replayStart', cursor: 0, through: count });
      expect(events.at(-1)).toEqual({ ...base, type: 'replayEnd', through: count });
      const receiver = new TerminalReceiver(id);
      expect(events.filter(frame => receiver.accept(frame) === 'output')).toHaveLength(count);
      expect(receiver.cursor).toBe(count);
      attach.dispose();
    },
  );

  it('incrementally replays an exact full 1 MiB history without discarding any bytes', async () => {
    const { history, sink, events } = fixture();
    for (let seq = 1; seq <= 16; seq++) { history.append(sizedOutput(seq, TERMINAL_LIMITS.frameBytes).data); }
    const attach = attachTerminal(history, 0, sink);
    await attach.ready;
    expect(sink.abort).not.toHaveBeenCalled();
    expect(events).toHaveLength(18);
    const frames = events.filter(frame => frame.type === 'output');
    expect(frames.reduce((sum, frame) => sum + utf8Bytes(encodeTerminalFrame(frame)), 0))
      .toBe(TERMINAL_LIMITS.historyBytes);
    expect(frames).toEqual((await history.snapshot(0)).frames);
    attach.dispose();
  });

  it('counts an in-flight replay output alongside live data while unstaged history stays separately bounded', async () => {
    const { history, sink } = fixture();
    for (let seq = 1; seq <= 16; seq++) { history.append(sizedOutput(seq, TERMINAL_LIMITS.frameBytes).data); }
    const blocked = deferred<void>();
    sink.send = vi.fn(async frame => {
      if (frame.type === 'output') { await blocked.promise; }
    });
    const attach = attachTerminal(history, 0, sink);
    await Promise.resolve();
    await Promise.resolve();
    expect(sink.send).toHaveBeenCalledTimes(2);
    for (let seq = 17; seq <= 31; seq++) { history.append(sizedOutput(seq, TERMINAL_LIMITS.frameBytes).data); }
    expect(sink.abort).not.toHaveBeenCalled();
    history.append('one-over');
    expect(sink.abort).toHaveBeenCalledWith(expect.objectContaining({ reason: 'overflow' }));
    blocked.resolve();
    await attach.ready;
    expect(sink.send).toHaveBeenCalledTimes(2);
  });
});

describe('terminal receiver continuity', () => {
  it('acknowledges async output only after application and rejects concurrent acceptance', async () => {
    const receiver = new TerminalReceiver(id);
    await receiver.apply({ ...base, type: 'replayStart', cursor: 0, through: 1 }, vi.fn());
    const written = deferred<void>();
    const write = vi.fn(() => written.promise);
    const pending = receiver.apply(output(1, 'é中🚀'), write);
    expect(write).toHaveBeenCalledExactlyOnceWith('é中🚀');
    expect(receiver.cursor).toBe(0);
    expect(() => receiver.accept(output(1))).toThrow('in progress');
    await expect(receiver.apply(output(1), write)).rejects.toThrow('in progress');
    written.resolve();
    expect(await pending).toBe('output');
    expect(receiver.cursor).toBe(1);
    expect(await receiver.apply(output(1), write)).toBe('duplicate');
    expect(write).toHaveBeenCalledOnce();
    await receiver.apply({ ...base, type: 'replayEnd', through: 1 }, write);
    expect(await receiver.apply(output(3), write)).toBe('resync');
    expect(receiver.cursor).toBe(1);
    expect(write).toHaveBeenCalledOnce();
  });

  it('does not acknowledge failed application and requires explicit resync', async () => {
    const receiver = new TerminalReceiver(id);
    await receiver.apply({ ...base, type: 'replayStart', cursor: 0, through: 1 }, vi.fn());
    await expect(receiver.apply(output(1), async () => { throw new Error('render failed'); }))
      .rejects.toThrow('render failed');
    expect(receiver.cursor).toBe(0);
    await expect(receiver.apply(output(1), vi.fn())).rejects.toThrow('requires resync');
  });

  it('does not acknowledge a late renderer callback from an invalidated screen', async () => {
    const receiver = new TerminalReceiver(id);
    receiver.accept({ ...base, type: 'replayStart', cursor: 0, through: 1 });
    const write = deferred<void>();
    let active = true;
    const pending = receiver.apply(output(1), () => write.promise, () => active);
    active = false;
    write.resolve();
    await expect(pending).rejects.toThrow('invalidated');
    expect(receiver.cursor).toBe(0);
    expect(() => receiver.accept(output(1))).toThrow('requires resync');
  });

  it('suppresses duplicates and returns explicit resync on a gap without advancing the cursor', () => {
    const receiver = new TerminalReceiver(id, 1);
    expect(receiver.accept({ ...base, type: 'replayStart', cursor: 1, through: 2 })).toBe('boundary');
    expect(receiver.accept(output(1))).toBe('duplicate');
    expect(receiver.accept(output(2, '\ud83d\ude80'))).toBe('output');
    expect(receiver.accept(output(2))).toBe('duplicate');
    expect(receiver.accept({ ...base, type: 'replayEnd', through: 2 })).toBe('boundary');
    expect(receiver.accept(output(3))).toBe('output');
    expect(receiver.accept(output(5))).toBe('resync');
    expect(receiver.cursor).toBe(3);
    expect(() => receiver.accept(output(4))).toThrow('requires resync');
  });

  it('rejects premature live data, wrong runs, incomplete boundaries and duplicate starts', () => {
    const receiver = new TerminalReceiver(id);
    expect(() => receiver.accept(output(1))).toThrow('before replay');
    expect(() => receiver.accept({ ...base, type: 'replayStart', cursor: 1, through: 1 })).toThrow('start');
    receiver.accept({ ...base, type: 'replayStart', cursor: 0, through: 1 });
    expect(() => receiver.accept({ ...base, type: 'replayStart', cursor: 0, through: 1 })).toThrow('start');
    expect(() => receiver.accept(output(2))).toThrow('before replay end');
    expect(() => receiver.accept({ ...base, type: 'replayEnd', through: 1 })).toThrow('Incomplete');
    expect(() => receiver.accept({ ...output(1), runId: runId('another') })).toThrow('Wrong');
    expect(() => new TerminalReceiver(id, NaN)).toThrow('cursor');
    expect(receiver.accept({ ...base, type: 'resync', reason: 'history-gap', earliest: 2, latest: 3 })).toBe('resync');
    expect(() => receiver.accept(output(1))).toThrow('requires resync');
  });
});
