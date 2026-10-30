import type { HostClient } from '../hostClient.js';
import type { OutboundMessage, WebviewMessage } from '../../../src/types.js';
import { decodeEvent } from '../../../standalone/src/events.js';

export interface BrowserHostClient extends HostClient {
  dispose(): void;
}

/** Production WebSocket adapter. Reconnection only requests observation snapshots. */
export function createBrowserClient(
  status: (state: string) => void,
  createSocket: (url: string) => WebSocket = url => new WebSocket(url),
  origin = window.location.origin,
): BrowserHostClient {
  const listeners = new Set<(message: OutboundMessage) => void>();
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let requested = false;
  let delay = 500;
  const encode = (message: WebviewMessage) => JSON.stringify({ version: 1, kind: 'office', message });

  function connect() {
    if (disposed || socket || !listeners.size) return;
    status('Connecting');
    const url = new URL('/office', origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const current = createSocket(url.href);
    socket = current;
    current.onopen = () => {
      if (disposed || socket !== current) return;
      delay = 500;
      status('Connected - read-only');
      if (requested) current.send(encode({ type: 'webviewReady' }));
    };
    current.onmessage = event => {
      if (disposed || socket !== current) return;
      try {
        if (typeof event.data !== 'string') throw new Error('Expected text office frame.');
        const message = decodeEvent(event.data);
        if (message.type === 'protocolError') {
          status(`Protocol error: ${message.code}`);
          return;
        }
        for (const listener of listeners) listener(message);
      } catch {
        status('Invalid server frame - disconnected');
        current.close(1002, 'Invalid server frame');
      }
    };
    current.onerror = () => {
      if (!disposed && socket === current) status('Connection failed - authenticate again if the credential was revoked');
    };
    current.onclose = () => {
      if (socket !== current) return;
      socket = undefined;
      if (disposed || !listeners.size) return;
      status('Disconnected - retrying observation only; authenticate again after rotation');
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 10_000);
    };
  }
  function disconnect() {
    if (retry) clearTimeout(retry);
    retry = undefined;
    const current = socket;
    socket = undefined;
    if (current) {
      current.onopen = null;
      current.onmessage = null;
      current.onerror = null;
      current.onclose = null;
      current.close();
    }
  }
  return {
    send(message) {
      if (disposed) { status('Disconnected'); return; }
      if (!['webviewReady', 'getSettings', 'requestAgentDetail'].includes(message.type)) {
        status('Read-only: this operation is unavailable; nothing was saved or launched.');
        return;
      }
      if (message.type === 'webviewReady') requested = true;
      if (socket?.readyState === WebSocket.OPEN) socket.send(encode(message));
      else if (message.type !== 'webviewReady') status('Disconnected - request not sent');
    },
    subscribe(listener) {
      if (disposed) throw new Error('Browser host disposed.');
      listeners.add(listener);
      connect();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) disconnect();
      };
    },
    getState() { return undefined; },
    setState() { throw new Error('Layout drafts and persistence are disabled in this read-only observer.'); },
    dispose() {
      disposed = true;
      disconnect();
      listeners.clear();
    },
  };
}
