import {
  decodeOwnedTerminalCommand, decodeOwnedTerminalEvent,
  type OwnedRun, type OwnedTerminalCommand,
} from '../../../src/core/ownedTerminalProtocol.js';
import { TERMINAL_LIMITS, utf8Bytes, type RunId } from '../../../src/core/terminalFrames.js';
import { TerminalReceiver } from '../../../src/core/terminalReplay.js';

export interface TerminalDisplay {
  write(data: string): Promise<void>;
  reset(): void;
}
export interface TerminalClientCallbacks {
  status(message: string): void;
  runs(runs: OwnedRun[], available: boolean, reason: string | null): void;
  resync(required: boolean): void;
  ready(ready: boolean): void;
  connected?(connected: boolean): void;
}

/** Memory-only connection state; a new page always reconstructs its terminal from cursor zero. */
export function createTerminalClient(
  display: TerminalDisplay,
  callbacks: TerminalClientCallbacks,
  createSocket: (url: string) => WebSocket = url => new WebSocket(url),
  origin = window.location.origin,
) {
  let socket: WebSocket | undefined;
  let disposed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 500;
  let selected: RunId | undefined;
  let receiver: TerminalReceiver | undefined;
  let generation = 0;
  let blocked = false;
  let earliest: number | undefined;
  let ready = false;
  let processing = false;
  let pendingBytes = 0;
  let inFlight = false;
  const queue: { json: string; bytes: number; generation: number }[] = [];

  function setReady(value: boolean) { ready = value; callbacks.ready(value); }
  function disconnect() {
    if (retry) clearTimeout(retry);
    retry = undefined;
    const current = socket;
    socket = undefined;
    if (current) {
      current.onopen = null;
      current.onmessage = null;
      current.onclose = null;
      current.onerror = null;
      current.close();
    }
    setReady(false);
    callbacks.connected?.(false);
  }
  function fail(message: string, from?: number) {
    blocked = true;
    earliest = from;
    generation++;
    queue.length = 0;
    // Keep an in-flight write accounted until its callback completes.
    disconnect();
    callbacks.resync(true);
    callbacks.status(`${message} Terminal stopped; explicit resync is required.`);
  }
  function send(command: OwnedTerminalCommand) {
    if (disposed || socket?.readyState !== 1 || socket.bufferedAmount > TERMINAL_LIMITS.pendingBytes) {
      callbacks.status('Disconnected or backpressured — command was not sent.');
      return false;
    }
    try {
      const json = JSON.stringify(command);
      decodeOwnedTerminalCommand(json);
      socket.send(json);
      return true;
    } catch {
      fail('Invalid command or failed transport.');
      return false;
    }
  }
  function attach(cursor = receiver?.cursor ?? 0) {
    if (!selected) return;
    receiver = new TerminalReceiver(selected, cursor);
    setReady(false);
    send({ version: 1, type: 'attach', runId: selected, cursor });
  }
  function scheduleReconnect() {
    if (disposed || blocked || socket || retry || processing) return;
    retry = setTimeout(() => { retry = undefined; connect(); }, delay);
    delay = Math.min(delay * 2, 10_000);
  }
  async function drain() {
    if (processing) return;
    processing = true;
    try {
      while (queue.length && !disposed && !blocked) {
        const item = queue.shift()!;
        inFlight = true;
        try {
          if (item.generation !== generation) continue;
          const event = decodeOwnedTerminalEvent(item.json);
          if (event.type === 'runs') {
            callbacks.runs(event.runs, event.available, event.reason);
          } else if (event.type === 'error') {
            callbacks.status(event.message);
          } else if (event.runId === selected && receiver) {
            let result;
            try {
              result = await receiver.apply(event, data => display.write(data),
                () => !disposed && item.generation === generation);
            } catch (error) {
              if (disposed || item.generation !== generation) continue;
              throw error;
            }
            if (disposed || item.generation !== generation) continue;
            if (result === 'resync') {
              fail(event.type === 'resync' ? `Resync: ${event.reason}.` : 'Output sequence gap.',
                event.type === 'resync' ? event.earliest : undefined);
            } else if (event.type === 'replayEnd') {
              setReady(true);
              callbacks.status('Terminal connected. Office remains read-only.');
            }
          }
        } finally {
          pendingBytes -= item.bytes;
          inFlight = false;
        }
      }
    } catch {
      fail('Invalid terminal data or terminal rendering failure.');
    } finally {
      processing = false;
      if (!queue.length) pendingBytes = 0;
      scheduleReconnect();
    }
  }
  function connect() {
    if (disposed || blocked || socket || processing) return;
    const url = new URL('/terminal', origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const current = createSocket(url.href);
    socket = current;
    callbacks.status('Connecting owned terminal…');
    current.onopen = () => {
      if (socket !== current || disposed) return;
      delay = 500;
      callbacks.connected?.(true);
      callbacks.status('Terminal authenticated. Select an owned run or launch the selected project.');
      send({ version: 1, type: 'list' });
      attach();
    };
    current.onmessage = event => {
      if (socket !== current || disposed || blocked) return;
      if (typeof event.data !== 'string') { fail('Expected a JSON text frame.'); return; }
      if (event.data.length > TERMINAL_LIMITS.frameBytes) { fail('Terminal frame overflow.'); return; }
      const bytes = utf8Bytes(event.data);
      if (bytes > TERMINAL_LIMITS.frameBytes ||
          pendingBytes + bytes > TERMINAL_LIMITS.pendingBytes ||
          queue.length + (inFlight ? 1 : 0) + 1 > TERMINAL_LIMITS.pendingFrames) {
        fail('Terminal inbound queue overflow.');
        return;
      }
      pendingBytes += bytes;
      queue.push({ json: event.data, bytes, generation });
      void drain();
    };
    current.onerror = () => {
      if (socket === current) callbacks.status('Terminal connection failed. Authenticate again after credential rotation.');
    };
    current.onclose = event => {
      if (socket !== current) return;
      socket = undefined;
      setReady(false);
      callbacks.connected?.(false);
      if ([1008, 1009, 4009].includes(event.code)) {
        fail('Terminal channel reached a policy/output limit. Some input may not have been applied.');
        return;
      }
      callbacks.status('Terminal disconnected — reconnecting to the same run without launching.');
      scheduleReconnect();
    };
  }
  connect();
  return {
    select(runId: RunId | undefined) {
      generation++;
      queue.length = 0;
      selected = runId;
      receiver = undefined;
      earliest = undefined;
      blocked = false;
      callbacks.resync(false);
      // Reopen after any pending write has drained; never clear underneath xterm.write.
      disconnect();
      const reset = () => {
        if (disposed) return;
        if (processing) { retry = setTimeout(reset, 10); return; }
        pendingBytes = 0;
        display.reset();
        connect();
      };
      reset();
    },
    launch() { if (!blocked) send({ version: 1, type: 'launch' }); },
    input(data: string) {
      if (!ready || !selected || blocked) return;
      // Split by code point, never by UTF-16 code unit (paste can contain astral Unicode).
      let chunk = '';
      let size = 0;
      // JSON can expand each control byte to six bytes; reserve identity/envelope space too.
      const chunkBytes = Math.min(TERMINAL_LIMITS.inputBytes, Math.floor((TERMINAL_LIMITS.frameBytes - 512) / 6));
      for (const point of data) {
        const bytes = utf8Bytes(point);
        if (size + bytes > chunkBytes) {
          if (!send({ version: 1, type: 'input', runId: selected, data: chunk })) return;
          chunk = ''; size = 0;
        }
        chunk += point; size += bytes;
      }
      if (chunk) send({ version: 1, type: 'input', runId: selected, data: chunk });
    },
    resize(cols: number, rows: number) {
      if (ready && selected && !blocked) send({
        version: 1, type: 'resize', runId: selected,
        cols: Math.max(1, Math.min(1000, cols)), rows: Math.max(1, Math.min(1000, rows)),
      });
    },
    terminate() { if (selected && !blocked) send({ version: 1, type: 'terminate', runId: selected }); },
    reconnect() {
      if (blocked || disposed) return;
      disconnect();
      scheduleReconnect();
    },
    resync() {
      if (!blocked || processing || disposed) return;
      const cursor = earliest === undefined ? 0 : earliest - 1;
      generation++;
      receiver = selected ? new TerminalReceiver(selected, cursor) : undefined;
      display.reset();
      blocked = false;
      callbacks.resync(false);
      callbacks.status('Terminal cleared. Earlier terminal history/state may be lost; replaying retained output only.');
      connect();
    },
    dispose() {
      disposed = true;
      generation++;
      queue.length = 0;
      disconnect();
    },
  };
}
export type OwnedTerminalClient = ReturnType<typeof createTerminalClient>;
