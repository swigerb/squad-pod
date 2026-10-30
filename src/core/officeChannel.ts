import type { OutboundMessage, WebviewMessage } from '../types.js';

/** The office/control channel remains independent of terminal I/O. */
export interface HostClient {
  send(message: WebviewMessage): void;
  subscribe(listener: (message: OutboundMessage) => void): () => void;
  getState(): unknown | undefined;
  setState<T>(state: T): T;
}

/** Subscribe before requesting the initial office snapshot, including synchronous hosts. */
export function connectOffice(
  client: HostClient,
  listener: (message: OutboundMessage) => void,
): () => void {
  const unsubscribe = client.subscribe(listener);
  try {
    client.send({ type: 'webviewReady' });
  } catch (error) {
    unsubscribe();
    throw error;
  }
  return unsubscribe;
}
