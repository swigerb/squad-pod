import { WebSocket } from 'ws';
import { encodeTerminalFrame, TERMINAL_LIMITS } from '../../src/core/terminalFrames.js';
import { attachTerminal } from '../../src/core/terminalReplay.js';
import { decodeOwnedTerminalCommand } from '../../src/core/ownedTerminalProtocol.js';
import type { OwnedRuns } from './ownedRuns.js';

/** Per-connection authority ends synchronously on rotation; there is no queued action chain. */
export function terminalSocket(ws: WebSocket, runs: OwnedRuns, current: () => boolean): () => void {
  let active = true;
  let busy = false;
  let alive = true;
  let received = 0;
  let windowStart = Date.now();
  let attachment: ReturnType<typeof attachTerminal> | undefined;
  let sendTimer: ReturnType<typeof setTimeout> | undefined;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const valid = () => active && current() && ws.readyState === WebSocket.OPEN;
  const cleanup = () => {
    if (!active) return;
    active = false;
    attachment?.dispose();
    unsubscribe();
    clearInterval(heartbeat);
    clearTimeout(sendTimer);
    for (const timer of timers) clearTimeout(timer);
  };
  const stop = () => { cleanup(); ws.terminate(); };
  const send = (json: string) => {
    if (!valid()) return;
    if (ws.bufferedAmount + Buffer.byteLength(json) > TERMINAL_LIMITS.pendingBytes) { stop(); return; }
    if (!sendTimer) sendTimer = setTimeout(stop, 10_000);
    ws.send(json, error => {
      if (error) { stop(); return; }
      if (ws.bufferedAmount === 0) { clearTimeout(sendTimer); sendTimer = undefined; }
    });
  };
  const status = () => send(JSON.stringify(runs.status()));
  const unsubscribe = runs.subscribe(status);
  const heartbeat = setInterval(() => {
    if (!valid() || !alive) { stop(); return; }
    alive = false;
    ws.ping(undefined, undefined, error => { if (error) stop(); });
  }, 15_000);
  heartbeat.unref();
  ws.on('pong', () => { alive = true; });
  ws.on('error', stop);
  ws.on('close', cleanup);
  status();
  ws.on('message', (data, binary) => {
    if (!valid()) return;
    const now = Date.now();
    if (now - windowStart >= 1000) { windowStart = now; received = 0; }
    if (++received > 64 || binary) {
      send(JSON.stringify({ version: 1, type: 'error',
        message: 'Terminal rate/protocol limit reached. Some input may not have been applied.' }));
      ws.close(1008, 'Terminal rate/protocol limit');
      const timer = setTimeout(stop, 1000);
      timers.add(timer);
      return;
    }
    if (busy) { send(JSON.stringify({ version: 1, type: 'error', message: 'Owned action in progress.' })); return; }
    try {
      const json = data.toString();
      const command = decodeOwnedTerminalCommand(json);
      if (command.type === 'list') { status(); return; }
      if (command.type === 'launch') {
        busy = true;
        void runs.launch(valid).then(run => {
          if (valid()) send(JSON.stringify({ version: 1, type: 'launchResult',
            requestId: command.requestId, result: { ok: true, runId: run.runId } }));
        }).catch(error => {
          if (valid()) send(JSON.stringify({ version: 1, type: 'launchResult',
            requestId: command.requestId, result: { ok: false, message: String(error).slice(0, 1024) } }));
        }).finally(() => { busy = false; });
        return;
      }
      if (command.type === 'attach') {
        const source = runs.source(command.runId);
        attachment?.dispose();
        attachment = attachTerminal(source, command.cursor, {
          send: frame => new Promise<void>((resolve, reject) => {
            if (!valid()) { reject(new Error('Terminal authorization ended.')); return; }
            const json = encodeTerminalFrame(frame);
            if (ws.bufferedAmount + Buffer.byteLength(json) > TERMINAL_LIMITS.pendingBytes) {
              reject(new Error('Terminal transport overflow.')); return;
            }
            const timer = setTimeout(() => { timers.delete(timer); reject(new Error('Slow terminal client.')); stop(); }, 10_000);
            timers.add(timer);
            ws.send(json, error => {
              clearTimeout(timer);
              timers.delete(timer);
              if (!valid() || error) reject(error ?? new Error('Terminal authorization ended.'));
              else resolve();
            });
          }),
          abort: frame => {
            if (!valid()) return;
            send(encodeTerminalFrame(frame));
            ws.close(4009, 'Terminal requires explicit resync');
            const timer = setTimeout(stop, 1000);
            timers.add(timer);
          },
        });
      } else if (command.type === 'terminate') {
        // Check ownership before starting asynchronous cleanup, not after awaiting anything.
        runs.source(command.runId);
        busy = true;
        attachment?.dispose();
        void runs.close(command.runId).catch(error => {
          if (valid()) send(JSON.stringify({ version: 1, type: 'error', message: String(error) }));
        }).finally(() => { busy = false; });
      } else {
        Promise.resolve(runs.command(command)).catch(error => {
          if (valid()) send(JSON.stringify({ version: 1, type: 'error', message: String(error).slice(0, 1024) }));
        });
      }
    } catch (error) {
      send(JSON.stringify({ version: 1, type: 'error', message: String(error) }));
    }
  });
  return cleanup;
}
