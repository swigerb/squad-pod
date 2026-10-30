import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserClient } from './browserClient.js';
import { connectOffice } from '../../../src/core/officeChannel.js';

class Socket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  open() { this.readyState = 1; this.onopen?.(); }
}
afterEach(() => vi.useRealTimers());
describe('production browser HostClient adapter', () => {
  it('subscribes before initial and reconnect snapshots without launching anything', async () => {
    vi.useFakeTimers();
    const sockets: Socket[] = [];
    const status = vi.fn();
    const client = createBrowserClient(status, url => {
      expect(url).toBe('ws://127.0.0.1:1234/office');
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    }, 'http://127.0.0.1:1234');
    const received = vi.fn();
    const unsubscribe = connectOffice(client, received);
    expect(sockets[0].send).not.toHaveBeenCalled();
    sockets[0].open();
    const ready = JSON.stringify({ version: 1, kind: 'office', message: { type: 'webviewReady' } });
    expect(sockets[0].send).toHaveBeenCalledExactlyOnceWith(ready);
    sockets[0].onmessage?.({ data: JSON.stringify({ version: 1, kind: 'office', message: {
      type: 'settingsLoaded', soundEnabled: false, debugEnabled: false, showAreas: false,
    } }) });
    expect(received).toHaveBeenCalledOnce();
    sockets[0].onclose?.();
    await vi.advanceTimersByTimeAsync(500);
    sockets[1].open();
    expect(sockets[1].send).toHaveBeenCalledExactlyOnceWith(ready);
    unsubscribe();
    client.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(2);
    expect(sockets[1].close).toHaveBeenCalledOnce();
  });

  it('surfaces blocked writes, invalid frames, disconnected reads and unavailable recovery', () => {
    const socket = new Socket();
    const status = vi.fn();
    const client = createBrowserClient(status, () => socket as unknown as WebSocket, 'http://127.0.0.1:1234');
    const unsubscribe = client.subscribe(() => {});
    client.send({ type: 'saveAgentSeats', seats: {} });
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining('nothing was saved'));
    expect(socket.send).not.toHaveBeenCalled();
    client.send({ type: 'getSettings' });
    expect(status).toHaveBeenLastCalledWith('Disconnected - request not sent');
    socket.open();
    socket.onmessage?.({ data: '{"version":2,"kind":"office","message":{}}' });
    expect(socket.close).toHaveBeenCalledWith(1002, 'Invalid server frame');
    expect(() => client.setState({})).toThrow('disabled');
    expect(client.getState()).toBeUndefined();
    unsubscribe();
    client.dispose();
  });
});
