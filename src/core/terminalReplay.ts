import {
  encodeTerminalFrame, TERMINAL_LIMITS, utf8Bytes,
  type OutputFrame, type ResyncReason, type RunId, type TerminalEvent,
} from './terminalFrames.js';

export interface ReplaySnapshot {
  earliest: number;
  through: number;
  frames: readonly OutputFrame[];
}

export interface TerminalSource {
  readonly runId: RunId;
  subscribe(listener: (frame: OutputFrame) => void): () => void;
  snapshot(cursor: number): Promise<ReplaySnapshot>;
}

/** UTF-8 chunks are supplied by the eventual process adapter after streaming decoding. */
export class TerminalHistory implements TerminalSource {
  private frames: OutputFrame[] = [];
  private bytes = 0;
  private sequence = 0;
  private listeners = new Set<(frame: OutputFrame) => void>();

  constructor(readonly runId: RunId) {}

  append(data: string): OutputFrame {
    if (this.sequence === Number.MAX_SAFE_INTEGER) { throw new Error('Terminal sequence exhausted'); }
    const frame: OutputFrame = {
      version: 1, type: 'output', runId: this.runId, seq: this.sequence + 1, data,
    };
    const size = utf8Bytes(encodeTerminalFrame(frame));
    this.sequence = frame.seq;
    this.frames.push(frame);
    this.bytes += size;
    while (this.bytes > TERMINAL_LIMITS.historyBytes || this.frames.length > TERMINAL_LIMITS.historyFrames) {
      this.bytes -= utf8Bytes(encodeTerminalFrame(this.frames.shift()!));
    }
    // Frozen records keep a consumer from changing retained history or other subscribers' output.
    Object.freeze(frame);
    for (const listener of this.listeners) { listener(frame); }
    return frame;
  }

  subscribe(listener: (frame: OutputFrame) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  snapshot(cursor: number): Promise<ReplaySnapshot> {
    return Promise.resolve({
      earliest: this.frames[0]?.seq ?? this.sequence + 1,
      through: this.sequence,
      frames: this.frames.filter(frame => frame.seq > cursor),
    });
  }
}

export interface TerminalSink {
  /** Resolves only after transport backpressure drains; at most one call is in flight. */
  send(frame: TerminalEvent): Promise<void>;
  /** Must signal resync and close the channel, even if send is stalled. */
  abort(frame: Extract<TerminalEvent, { type: 'resync' }>): void;
}

/** Attaching only subscribes to an existing source. It never creates or terminates a run. */
export function attachTerminal(source: TerminalSource, cursor: number, sink: TerminalSink) {
  if (!Number.isSafeInteger(cursor) || cursor < 0) { throw new Error('Invalid reconnect cursor'); }
  let stopped = false;
  let replaying = true;
  let draining = false;
  let pending: TerminalEvent[] = [];
  let replay: Iterator<TerminalEvent> | undefined;
  let inFlight: TerminalEvent | undefined;
  let bytes = 0;
  let latest = 0;
  let earliest = 1;
  const subscription: { unsubscribe?: () => void } = {};
  const dispose = () => {
    stopped = true;
    pending = [];
    replay = undefined;
    inFlight = undefined;
    bytes = 0;
    subscription.unsubscribe?.();
  };
  const fail = (reason: ResyncReason) => {
    if (stopped) { return; }
    dispose();
    sink.abort({ version: 1, type: 'resync', runId: source.runId, reason, earliest, latest });
  };
  const reserve = (frames: TerminalEvent[]) => {
    const size = frames.reduce((total, frame) => total + utf8Bytes(encodeTerminalFrame(frame)), 0);
    if (bytes + size > TERMINAL_LIMITS.pendingBytes ||
        pending.length + (inFlight ? 1 : 0) + frames.length > TERMINAL_LIMITS.pendingFrames) {
      fail('overflow');
      return false;
    }
    bytes += size;
    return true;
  };
  const drain = async () => {
    if (draining || replaying || stopped) { return; }
    draining = true;
    try {
      while (!stopped) {
        let frame: TerminalEvent;
        if (replay) {
          const next = replay.next();
          if (next.done) {
            replay = undefined;
            continue;
          }
          frame = next.value;
          if (!reserve([frame])) { return; }
        } else {
          if (!pending.length) { break; }
          frame = pending.shift()!;
        }
        inFlight = frame;
        await sink.send(frame);
        if (stopped) { break; }
        bytes -= utf8Bytes(encodeTerminalFrame(frame));
        inFlight = undefined;
      }
    } catch {
      fail('source-error');
    } finally {
      draining = false;
    }
  };
  subscription.unsubscribe = source.subscribe(frame => {
    if (stopped) { return; }
    try {
      if (frame.runId !== source.runId) { throw new Error('Wrong source identity'); }
      encodeTerminalFrame(frame);
      latest = Math.max(latest, frame.seq);
      if (reserve([frame])) {
        pending.push(frame);
        void drain();
      }
    } catch {
      fail('source-error');
    }
  });
  if (stopped) { subscription.unsubscribe(); }
  const ready = (async () => {
    try {
      if (stopped) { return; }
      const snapshot = await source.snapshot(cursor);
      if (stopped) { return; }
      if (!Number.isSafeInteger(snapshot.through) || snapshot.through < 0 ||
          !Number.isSafeInteger(snapshot.earliest) || snapshot.earliest < 1 ||
          snapshot.earliest > snapshot.through + 1) {
        throw new Error('Invalid source snapshot');
      }
      earliest = snapshot.earliest;
      latest = Math.max(snapshot.through, latest);
      if (cursor > snapshot.through) { fail('cursor-ahead'); return; }
      if (cursor < earliest - 1) { fail('history-gap'); return; }
      if (snapshot.frames.length > TERMINAL_LIMITS.historyFrames) {
        throw new Error('Snapshot exceeds history frame limit');
      }
      let expected = cursor + 1;
      let snapshotBytes = 0;
      for (const frame of snapshot.frames) {
        if (frame.runId !== source.runId || frame.seq !== expected++ || frame.seq > snapshot.through) {
          throw new Error('Noncontiguous snapshot');
        }
        snapshotBytes += utf8Bytes(encodeTerminalFrame(frame));
        if (snapshotBytes > TERMINAL_LIMITS.historyBytes) {
          throw new Error('Snapshot exceeds history byte limit');
        }
      }
      if (expected - 1 !== snapshot.through) { throw new Error('Incomplete snapshot'); }
      pending = pending.filter(frame => frame.type === 'output' && frame.seq > snapshot.through);
      bytes = pending.reduce((total, frame) => total + utf8Bytes(encodeTerminalFrame(frame)), 0);
      // The captured history is independently bounded above. Stage only one replay
      // record at a time so boundaries never disqualify an otherwise full history.
      replay = (function* (): Generator<TerminalEvent> {
        yield { version: 1, type: 'replayStart', runId: source.runId, cursor, through: snapshot.through };
        yield* snapshot.frames;
        yield { version: 1, type: 'replayEnd', runId: source.runId, through: snapshot.through };
      })();
      replaying = false;
      await drain();
    } catch {
      fail('source-error');
    }
  })();
  return { ready, dispose };
}

/** One receiver per connection; persist cursor only after applying an output result. */
export class TerminalReceiver {
  private phase: 'awaiting' | 'replay' | 'live' | 'resync' = 'awaiting';
  private through = 0;
  private applied: number;
  constructor(readonly runId: RunId, cursor = 0) {
    if (!Number.isSafeInteger(cursor) || cursor < 0) { throw new Error('Invalid reconnect cursor'); }
    this.applied = cursor;
  }

  get cursor(): number {
    return this.applied;
  }

  accept(frame: TerminalEvent): 'output' | 'duplicate' | 'boundary' | 'resync' {
    encodeTerminalFrame(frame);
    if (frame.runId !== this.runId) { throw new Error('Wrong terminal run'); }
    if (this.phase === 'resync') { throw new Error('Terminal requires resync'); }
    if (frame.type === 'resync') {
      this.phase = 'resync';
      return 'resync';
    }
    if (frame.type === 'replayStart') {
      if (this.phase !== 'awaiting' || frame.cursor !== this.cursor) { throw new Error('Invalid replay start'); }
      this.phase = 'replay';
      this.through = frame.through;
      return 'boundary';
    }
    if (frame.type === 'replayEnd') {
      if (this.phase !== 'replay' || frame.through !== this.through || this.cursor !== this.through) {
        throw new Error('Incomplete replay');
      }
      this.phase = 'live';
      return 'boundary';
    }
    if (this.phase === 'awaiting') { throw new Error('Output before replay'); }
    if (this.phase === 'replay' && frame.seq > this.through) { throw new Error('Live output before replay end'); }
    if (frame.seq <= this.cursor) { return 'duplicate'; }
    if (frame.seq !== this.cursor + 1) {
      this.phase = 'resync';
      return 'resync';
    }
    this.applied = frame.seq;
    return 'output';
  }
}
