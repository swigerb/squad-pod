import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnedTerminalPanel } from './OwnedTerminalPanel.js';
import type { TerminalClientCallbacks, TerminalDisplay } from './terminalClient.js';
import { runId } from '../../../src/core/terminalFrames.js';

const mocks = vi.hoisted(() => ({
  client: { select: vi.fn(), launch: vi.fn(), terminate: vi.fn(), reconnect: vi.fn(),
    resize: vi.fn(), input: vi.fn(), resync: vi.fn(), dispose: vi.fn() },
  terminal: { options: { disableStdin: true }, cols: 80, rows: 24,
    loadAddon: vi.fn(), open: vi.fn(), reset: vi.fn(), write: vi.fn(), dispose: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })), onResize: vi.fn(() => ({ dispose: vi.fn() })) },
  fit: vi.fn(),
  connect: vi.fn<(display: TerminalDisplay, callbacks: TerminalClientCallbacks) => void>(),
}));
vi.mock('@xterm/xterm', () => ({ Terminal: class { constructor() { return mocks.terminal; } } }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = mocks.fit; } }));
vi.mock('./terminalClient.js', () => ({
  createTerminalClient: (display: TerminalDisplay, callbacks: TerminalClientCallbacks) => {
    mocks.connect(display, callbacks); return mocks.client;
  },
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<OwnedTerminalPanel />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); vi.unstubAllGlobals();
});
function button(text: string) {
  const found = Array.from(host.querySelectorAll('button')).find(node => node.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
async function authenticate(ok = true) {
  const fetch = vi.fn(async () => ({ ok }));
  vi.stubGlobal('fetch', fetch);
  const input = host.querySelector('input')!;
  input.value = 'terminal-test-credential';
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  return { fetch, input };
}
describe('owned terminal separate authority UI', () => {
  it('authenticates only the terminal endpoint, clears credentials, and explains unavailable runtime', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const { fetch, input } = await authenticate();
    expect(fetch).toHaveBeenCalledWith('/terminal-auth', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify({ token: 'terminal-test-credential' }),
    }));
    expect(input.value).toBe('');
    expect(storage).not.toHaveBeenCalled();
    const callbacks = mocks.connect.mock.calls[0][1];
    await act(async () => callbacks.runs([], false, 'Native terminal unavailable in this runtime'));
    expect(host.textContent).toContain('Native terminal unavailable in this runtime');
    expect(button('Launch selected project').disabled).toBe(true);
    expect(mocks.client.launch).not.toHaveBeenCalled();
    storage.mockRestore();
  });

  it('does not connect a failed credential or conflate office authentication with terminal access', async () => {
    await authenticate(false);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Terminal authentication failed');
    expect(host.textContent).toContain('not the office credential');
    expect(host.querySelector('input')!.value).toBe('');
  });

  it('uses explicit launch, close confirmation and resync with persistent lost-history disclosure', async () => {
    await authenticate();
    const callbacks = mocks.connect.mock.calls[0][1];
    const id = runId('existing-owned');
    await act(async () => callbacks.connected?.(true));
    await act(async () => callbacks.runs([{ runId: id, pid: 7, state: 'running', exitCode: null }], true, null));
    expect(mocks.client.select).toHaveBeenCalledWith(id);
    await act(async () => button('Launch selected project').click());
    expect(mocks.client.launch).toHaveBeenCalledOnce();
    await act(async () => button('Close run…').click());
    expect(mocks.client.terminate).not.toHaveBeenCalled();
    await act(async () => button('Confirm terminate owned process').click());
    expect(mocks.client.terminate).toHaveBeenCalledOnce();
    await act(async () => callbacks.connected?.(false));
    expect(button('Launch selected project').disabled).toBe(true);
    expect(button('Close run…').disabled).toBe(true);
    expect(host.textContent).toContain('Run states are last-known');
    await act(async () => callbacks.connected?.(true));
    await act(async () => callbacks.resync(true));
    expect((host.querySelector('select') as HTMLSelectElement).disabled).toBe(true);
    expect(button('Reconnect').disabled).toBe(true);
    expect(mocks.client.resync).not.toHaveBeenCalled();
    await act(async () => button('Clear terminal and resync retained history').click());
    expect(mocks.client.resync).toHaveBeenCalledOnce();
    await act(async () => callbacks.resync(false));
    expect(host.textContent).toContain('Earlier output and terminal state may be lost');
    await act(async () => button('Authenticate again').click());
    expect(mocks.client.dispose).toHaveBeenCalled();
    expect(mocks.client.terminate).toHaveBeenCalledOnce();
  });
});
