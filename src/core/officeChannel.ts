import type { OutboundMessage, WebviewMessage } from '../types.js';
import type { HostCapabilities } from './hostCapabilities.js';
export type { HostAction, HostCapabilities } from './hostCapabilities.js';

/** The office/control channel remains independent of terminal I/O. */
export interface HostClient {
  /** Describes adapter support only; send/subscribe retain their existing behavior. */
  readonly capabilities: HostCapabilities;
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
