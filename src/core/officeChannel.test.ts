import { describe, expect, it, vi } from 'vitest';
import { connectOffice, type HostClient } from './officeChannel.js';
import type { OutboundMessage } from '../types.js';
import { VSCODE_HOST_CAPABILITIES } from './hostCapabilities.js';

function fixture() {
  let subscriber: (message: OutboundMessage) => void = () => {};
  const unsubscribe = vi.fn(() => subscriber({ type: 'noWorkspace' }));
  const client: HostClient = {
    capabilities: VSCODE_HOST_CAPABILITIES,
    subscribe: vi.fn(listener => { subscriber = listener; return unsubscribe; }),
    send: vi.fn(),
    getState: () => undefined,
    setState: state => state,
  };
  return { client, unsubscribe, emit: () => subscriber({ type: 'noWorkspace' }) };
}

describe('shared office/control channel', () => {
  it('subscribes before synchronous snapshot delivery using existing typed messages', () => {
    let subscriber: ((message: OutboundMessage) => void) | undefined;
    const unsubscribe = vi.fn();
    const client: HostClient = {
      capabilities: VSCODE_HOST_CAPABILITIES,
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
      capabilities: VSCODE_HOST_CAPABILITIES,
      subscribe: () => unsubscribe,
      send: () => { throw new Error('disconnected'); },
      getState: () => undefined,
      setState: state => state,
    };
    expect(() => connectOffice(client, vi.fn())).toThrow('disconnected');
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('disposes once and fences synchronous cleanup emissions and retained callbacks', () => {
    const host = fixture();
    const listener = vi.fn();
    const dispose = connectOffice(host.client, listener);
    host.emit();
    expect(listener).toHaveBeenCalledOnce();
    dispose();
    dispose();
    host.emit();
    expect(host.unsubscribe).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
  });

  it.each(['ready', 'initialize'] as const)('retires after %s failure without hiding it', phase => {
    const host = fixture();
    const listener = vi.fn();
    const failure = new Error(phase);
    const initialize = vi.fn(() => { if (phase === 'initialize') throw failure; });
    if (phase === 'ready') vi.mocked(host.client.send).mockImplementation(() => { throw failure; });
    expect(() => connectOffice(host.client, listener, initialize)).toThrow(failure);
    host.emit();
    expect(listener).not.toHaveBeenCalled();
    expect(host.unsubscribe).toHaveBeenCalledOnce();
    expect(initialize).toHaveBeenCalledTimes(phase === 'ready' ? 0 : 1);
  });

  it('preserves both initialization and cleanup errors in order', () => {
    const host = fixture();
    const failure = new Error('initialize');
    const cleanupFailure = new Error('cleanup');
    const listener = vi.fn();
    host.unsubscribe.mockImplementation(() => { host.emit(); throw cleanupFailure; });
    let caught: unknown;
    try {
      connectOffice(host.client, listener, () => { throw failure; });
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([failure, cleanupFailure]);
    host.emit();
    expect(listener).not.toHaveBeenCalled();
    expect(host.unsubscribe).toHaveBeenCalledOnce();
  });

  it('surfaces cleanup failure once while keeping the connection retired', () => {
    const host = fixture();
    const failure = new Error('cleanup');
    host.unsubscribe.mockImplementation(() => { host.emit(); throw failure; });
    const listener = vi.fn();
    const dispose = connectOffice(host.client, listener);
    expect(dispose).toThrow(failure);
    expect(dispose).not.toThrow();
    host.emit();
    expect(host.unsubscribe).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });

  it('retires a retained listener when subscribe throws without returning teardown authority', () => {
    const host = fixture();
    const subscribe = host.client.subscribe;
    const failure = new Error('subscribe');
    host.client.subscribe = listener => {
      subscribe(listener);
      host.emit();
      throw failure;
    };
    const listener = vi.fn();
    expect(() => connectOffice(host.client, listener)).toThrow(failure);
    host.emit();
    expect(listener).toHaveBeenCalledOnce();
    expect(host.unsubscribe).not.toHaveBeenCalled();
    expect(host.client.send).not.toHaveBeenCalled();
  });

  it('keeps independently connected clients live when a peer is disposed', () => {
    const a = fixture(), b = fixture();
    const listenerA = vi.fn(), listenerB = vi.fn();
    const disposeA = connectOffice(a.client, listenerA);
    const disposeB = connectOffice(b.client, listenerB);
    disposeA();
    a.emit(); b.emit();
    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledOnce();
    expect(b.unsubscribe).not.toHaveBeenCalled();
    disposeB();
    expect(b.unsubscribe).toHaveBeenCalledOnce();
  });
});
