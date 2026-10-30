import { describe, expect, it, vi } from 'vitest';
import { connectOffice, type HostClient } from './officeChannel.js';
import type { OutboundMessage } from '../types.js';

describe('shared office/control channel', () => {
  it('subscribes before synchronous snapshot delivery using existing typed messages', () => {
    let subscriber: ((message: OutboundMessage) => void) | undefined;
    const unsubscribe = vi.fn();
    const client: HostClient = {
      subscribe(listener) { subscriber = listener; return unsubscribe; },
      send(message) {
        expect(message).toEqual({ type: 'webviewReady' });
        subscriber?.({ type: 'noWorkspace' });
      },
      getState: () => undefined,
      setState: state => state,
    };
    const listener = vi.fn();
    const dispose = connectOffice(client, listener);
    expect(listener).toHaveBeenCalledWith({ type: 'noWorkspace' });
    dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('unsubscribes and surfaces initialization failure', () => {
    const unsubscribe = vi.fn();
    const client: HostClient = {
      subscribe: () => unsubscribe,
      send: () => { throw new Error('disconnected'); },
      getState: () => undefined,
      setState: state => state,
    };
    expect(() => connectOffice(client, vi.fn())).toThrow('disconnected');
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
