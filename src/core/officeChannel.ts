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

/**
 * Own one subscription, subscribing before ready and optional synchronous initialization.
 * Failed initialization retires delivery and cleans up; disposal is once-only, even if it throws.
 */
export function connectOffice(
  client: HostClient,
  listener: (message: OutboundMessage) => void,
  initialize?: () => void,
): () => void {
  let active = true;
  let unsubscribe: (() => void) | undefined;
  const dispose = () => {
    if (!active) return;
    // Retire before invoking adapter code, which may synchronously deliver or throw.
    active = false;
    unsubscribe?.();
  };
  try {
    unsubscribe = client.subscribe(message => {
      if (active) listener(message);
    });
    client.send({ type: 'webviewReady' });
    initialize?.();
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Office initialization and cleanup failed');
    }
    throw error;
  }
  return dispose;
}
