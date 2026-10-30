import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnedTerminalPanel } from './OwnedTerminalPanel.js';
import type { TerminalClientCallbacks, TerminalDisplay, TerminalInputDelivery } from './terminalClient.js';
import { runId } from '../../../src/core/terminalFrames.js';

const mocks = vi.hoisted(() => ({
  client: { select: vi.fn(), launch: vi.fn(), terminate: vi.fn(), reconnect: vi.fn(),
    resize: vi.fn(), input: vi.fn((_data: string): TerminalInputDelivery => ({ status: 'queued' })), resync: vi.fn(), dispose: vi.fn() },
  terminal: { options: { disableStdin: true }, cols: 80, rows: 24,
    loadAddon: vi.fn(), open: vi.fn(), reset: vi.fn(), write: vi.fn(), dispose: vi.fn(),
    selectAll: vi.fn(), getSelection: vi.fn(() => 'selected output'), hasSelection: vi.fn(() => false),
    buffer: { active: { getLine: vi.fn() } },
    registerLinkProvider: vi.fn((_provider: unknown) => ({ dispose: vi.fn() })),
    onData: vi.fn(() => ({ dispose: vi.fn() })), onResize: vi.fn(() => ({ dispose: vi.fn() })) },
  fit: vi.fn(),
  connect: vi.fn<(display: TerminalDisplay, callbacks: TerminalClientCallbacks) => void>(),
}));
const fixtureRunId = runId('owned-ui-fixture');
vi.mock('@xterm/xterm', () => ({ Terminal: class { constructor() { return mocks.terminal; } } }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = mocks.fit; } }));
vi.mock('./terminalClient.js', () => ({
  createTerminalClient: (display: TerminalDisplay, callbacks: TerminalClientCallbacks) => {
    mocks.connect(display, callbacks); return mocks.client;
  },
}));
let root: Root;
let host: HTMLDivElement;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
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
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  if (originalSecureContext) Object.defineProperty(window, 'isSecureContext', originalSecureContext);
  else Reflect.deleteProperty(window, 'isSecureContext');
});
function button(text: string) {
  const found = Array.from(host.querySelectorAll('button')).find(node => node.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
function touch(type: string, time: number, x: number, y: number) {
  const point = { identifier: 1, clientX: x, clientY: y };
  const event = new Event(type, { bubbles: true }) as TouchEvent;
  Object.defineProperties(event, {
    timeStamp: { value: time },
    touches: { value: type === 'touchend' ? [] : [point] },
    changedTouches: { value: [point] },
  });
  return event;
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

  it('keeps clipboard access explicit and sends bounded mobile keyboard, copy and paste actions', async () => {
    const readText = vi.fn(async () => 'clipboard command');
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText, writeText } });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    await act(async () => root.render(<OwnedTerminalPanel mobile />));
    await authenticate();
    const callbacks = mocks.connect.mock.calls[0][1];
    await act(async () => {
      callbacks.connected?.(true);
      callbacks.runs([{ runId: fixtureRunId, pid: 7, state: 'running', exitCode: null }], true, null);
      callbacks.ready(true);
    });
    expect(readText).not.toHaveBeenCalled();
    await act(async () => button('Select all').click());
    expect(mocks.terminal.selectAll).toHaveBeenCalledOnce();
    await act(async () => button('Copy selection').click());
    expect(writeText).toHaveBeenCalledWith('selected output');
    await act(async () => button('Paste').click());
    expect(readText).toHaveBeenCalledOnce();
    expect(mocks.client.input).toHaveBeenCalledWith('clipboard command');
    for (const key of ['Tab', 'Esc', 'Ctrl+C', 'Ctrl+D', '↑', '↓', '←', '→']) {
      await act(async () => button(key).click());
    }
    expect(mocks.client.input.mock.calls.map(([value]) => value)).toEqual([
      'clipboard command', '\t', '\u001b', '\u0003', '\u0004', '\u001b[A', '\u001b[B', '\u001b[D', '\u001b[C',
    ]);
  });

  it('shows manual copy/paste fallback after clipboard APIs are refused', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      readText: vi.fn(async () => { throw new Error('denied'); }),
      writeText: vi.fn(async () => { throw new Error('denied'); }),
    } });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    await act(async () => root.render(<OwnedTerminalPanel mobile />));
    await authenticate();
    const callbacks = mocks.connect.mock.calls[0][1];
    await act(async () => {
      callbacks.connected?.(true);
      callbacks.runs([{ runId: fixtureRunId, pid: 7, state: 'running', exitCode: null }], true, null);
      callbacks.ready(true);
    });
    await act(async () => button('Copy selection').click());
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Selected terminal text for manual copy"]')?.value)
      .toBe('selected output');
    await act(async () => button('Paste').click());
    const manual = host.querySelector<HTMLTextAreaElement>('#manual-terminal-paste')!;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    valueSetter.call(manual, 'manual command');
    await act(async () => manual.dispatchEvent(new Event('input', { bubbles: true })));
    await act(async () => button('Send pasted text').click());
    expect(mocks.client.input).toHaveBeenCalledWith('manual command');
  });

  it.each(['run-switch', 'disconnect'] as const)(
    'retains unsent clipboard text when the terminal %s during the read', async change => {
      let finishRead!: (text: string) => void;
      const readText = vi.fn(() => new Promise<string>(resolve => { finishRead = resolve; }));
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
      await act(async () => root.render(<OwnedTerminalPanel mobile />));
      await authenticate();
      const callbacks = mocks.connect.mock.calls[0][1];
      await act(async () => {
        callbacks.connected?.(true);
        callbacks.runs([
          { runId: fixtureRunId, pid: 7, state: 'running', exitCode: null },
          { runId: runId('other-owned-run'), pid: 8, state: 'running', exitCode: null },
        ], true, null);
        callbacks.ready(true);
      });
      await act(async () => button('Paste').click());
      if (change === 'run-switch') {
        await act(async () => callbacks.runs([
          { runId: runId('other-owned-run'), pid: 8, state: 'running', exitCode: null },
        ], true, null));
      } else {
        await act(async () => callbacks.connected?.(false));
      }
      await act(async () => finishRead('delayed clipboard command'));
      expect(mocks.client.input).not.toHaveBeenCalled();
      expect(host.querySelector<HTMLTextAreaElement>('#manual-terminal-paste')?.value)
        .toBe('delayed clipboard command');
      expect(host.textContent).toContain('kept for review; nothing was sent');
  });

  it.each(['reconnect', 'run-round-trip', 'readiness-round-trip'] as const)(
    'invalidates a pending clipboard read even after a %s restores the original target', async change => {
      let finishRead!: (text: string) => void;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        readText: vi.fn(() => new Promise<string>(resolve => { finishRead = resolve; })),
      } });
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
      await act(async () => root.render(<OwnedTerminalPanel mobile />));
      await authenticate();
      const callbacks = mocks.connect.mock.calls[0][1];
      await act(async () => {
        callbacks.connected?.(true);
        callbacks.runs([
          { runId: fixtureRunId, pid: 7, state: 'running', exitCode: null },
          { runId: runId('other-owned-run'), pid: 8, state: 'running', exitCode: null },
        ], true, null);
        callbacks.ready(true);
      });
      await act(async () => button('Paste').click());
      if (change === 'run-round-trip') {
        const onAccessChange = vi.fn();
        await act(async () => root.render(<OwnedTerminalPanel mobile onAccessChange={onAccessChange}
          selectedRunId={runId('other-owned-run')} />));
        await act(async () => root.render(<OwnedTerminalPanel mobile onAccessChange={onAccessChange}
          selectedRunId={fixtureRunId} />));
        expect(mocks.client.select).toHaveBeenLastCalledWith(fixtureRunId);
      } else {
        await act(async () => {
          if (change === 'reconnect') callbacks.connected?.(false);
          callbacks.ready(false);
          if (change === 'reconnect') callbacks.connected?.(true);
          callbacks.ready(true);
        });
      }
      expect(button('Paste').disabled).toBe(false);
      await act(async () => finishRead('stale input after healed state'));
      expect(mocks.client.input).not.toHaveBeenCalled();
      expect(host.querySelector<HTMLTextAreaElement>('#manual-terminal-paste')?.value)
        .toBe('stale input after healed state');
      expect(host.textContent).toContain('kept for review; nothing was sent');
    },
  );

  it.each(['older-first', 'newer-first'] as const)(
    'lets a newer explicit paste supersede an older pending clipboard read (%s)', async order => {
    const finishReads: Array<(text: string) => void> = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      readText: vi.fn(() => new Promise<string>(resolve => { finishReads.push(resolve); })),
    } });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    await act(async () => root.render(<OwnedTerminalPanel mobile />));
    await authenticate();
    const callbacks = mocks.connect.mock.calls[0][1];
    await act(async () => {
      callbacks.connected?.(true);
      callbacks.runs([{ runId: fixtureRunId, pid: 7, state: 'running', exitCode: null }], true, null);
      callbacks.ready(true);
    });
    await act(async () => button('Paste').click());
    await act(async () => button('Paste').click());
    if (order === 'older-first') {
      await act(async () => finishReads[0]('superseded paste'));
      expect(mocks.client.input).not.toHaveBeenCalled();
    }
    mocks.client.input.mockReturnValueOnce({ status: 'not-sent' });
    await act(async () => finishReads[1]('newest deliberate paste'));
    expect(mocks.client.input).toHaveBeenCalledExactlyOnceWith('newest deliberate paste');
    if (order === 'newer-first') await act(async () => finishReads[0]('superseded paste'));
    expect(mocks.client.input).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLTextAreaElement>('#manual-terminal-paste')?.value).toBe('newest deliberate paste');
    expect(host.textContent).toContain('input was not sent');
  });

  it('reports blocked and partial paste truthfully and preserves only the unsent remainder', async () => {
    const readText = vi.fn(async () => 'clipboard command');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    await act(async () => root.render(<OwnedTerminalPanel mobile />));
    await authenticate();
    const callbacks = mocks.connect.mock.calls[0][1];
    await act(async () => {
      callbacks.connected?.(true);
      callbacks.runs([{ runId: fixtureRunId, pid: 7, state: 'running', exitCode: null }], true, null);
      callbacks.ready(true);
    });
    mocks.client.input.mockReturnValueOnce({ status: 'not-sent' });
    await act(async () => button('Paste').click());
    expect(host.querySelector<HTMLTextAreaElement>('#manual-terminal-paste')?.value).toBe('clipboard command');
    expect(host.textContent).toContain('input was not sent');
    mocks.client.input.mockReturnValueOnce({ status: 'partial', sentCodeUnits: 10 });
    await act(async () => button('Send pasted text').click());
    expect(host.querySelector<HTMLTextAreaElement>('#manual-terminal-paste')?.value).toBe('command');
    expect(host.textContent).toContain('Some manual paste input may have been applied');
    expect(host.textContent).toContain('unsent remainder is kept');
  });

  it('accepts manual paste above the old 65536-character ceiling and explicitly rejects above 256 KiB', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      readText: vi.fn(async () => { throw new Error('denied'); }),
    } });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    await act(async () => root.render(<OwnedTerminalPanel mobile />));
    await authenticate();
    const callbacks = mocks.connect.mock.calls[0][1];
    await act(async () => {
      callbacks.connected?.(true);
      callbacks.runs([{ runId: fixtureRunId, pid: 7, state: 'running', exitCode: null }], true, null);
      callbacks.ready(true);
    });
    await act(async () => button('Paste').click());
    const manual = host.querySelector<HTMLTextAreaElement>('#manual-terminal-paste')!;
    const large = 'a'.repeat(70_000);
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    valueSetter.call(manual, large);
    await act(async () => manual.dispatchEvent(new Event('input', { bubbles: true })));
    expect(manual.value).toHaveLength(70_000);
    await act(async () => button('Send pasted text').click());
    expect(mocks.client.input).toHaveBeenCalledWith(large);

    await act(async () => button('Paste').click());
    const nextManual = host.querySelector<HTMLTextAreaElement>('#manual-terminal-paste')!;
    const overLimit = 'b'.repeat(256 * 1024 + 1);
    valueSetter.call(nextManual, overLimit);
    await act(async () => nextManual.dispatchEvent(new Event('input', { bubbles: true })));
    expect(nextManual.value).toHaveLength(overLimit.length);
    expect(nextManual.maxLength).toBe(-1);
    await act(async () => button('Send pasted text').click());
    expect(host.textContent).toContain('Paste text exceeds 256 KiB');
  });

  it('opens only safe terminal links on a short, unmoved touch without active selection', async () => {
    await act(async () => root.render(<OwnedTerminalPanel mobile />));
    await authenticate();
    const callbacks = mocks.connect.mock.calls[0][1];
    await act(async () => {
      callbacks.connected?.(true);
      callbacks.runs([{ runId: fixtureRunId, pid: 7, state: 'running', exitCode: null }], true, null);
      callbacks.ready(true);
    });
    const text = 'open https://example.com';
    mocks.terminal.buffer.active.getLine.mockReturnValue({
      length: text.length, getCell: (column: number) => ({ getChars: () => text[column] ?? '' }),
    });
    const provider = mocks.terminal.registerLinkProvider.mock.calls[0][0] as {
      provideLinks: (line: number, done: (links: Array<{
        range: unknown; text: string; activate: (event: MouseEvent, text: string) => void;
      }> | undefined) => void) => void;
    };
    const getLink = () => {
      let links: Array<{ range: unknown; text: string; activate: (event: MouseEvent, text: string) => void }> | undefined;
      provider.provideLinks(1, result => { links = result; });
      return links?.[0];
    };
    const screen = host.querySelector('.terminal-screen')!;
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await act(async () => {
      screen.dispatchEvent(touch('touchstart', 100, 4, 5));
      screen.dispatchEvent(touch('touchend', 250, 4, 5));
    });
    getLink()?.activate(new MouseEvent('click'), 'https://example.com/');
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');

    await act(async () => {
      screen.dispatchEvent(touch('touchstart', 300, 4, 5));
      screen.dispatchEvent(touch('touchend', 700, 4, 5));
    });
    getLink()?.activate(new MouseEvent('click'), 'https://example.com/');
    expect(open).toHaveBeenCalledOnce();

    await act(async () => {
      screen.dispatchEvent(touch('touchstart', 800, 4, 5));
      screen.dispatchEvent(touch('touchmove', 820, 24, 5));
      screen.dispatchEvent(touch('touchmove', 840, 4, 5));
      screen.dispatchEvent(touch('touchend', 850, 4, 5));
    });
    getLink()?.activate(new MouseEvent('click'), 'https://example.com/');
    expect(open).toHaveBeenCalledOnce();
    mocks.terminal.hasSelection.mockReturnValue(true);
    await act(async () => {
      screen.dispatchEvent(touch('touchstart', 900, 4, 5));
      screen.dispatchEvent(touch('touchend', 950, 4, 5));
    });
    getLink()?.activate(new MouseEvent('click'), 'https://example.com/');
    expect(open).toHaveBeenCalledOnce();
  });
});
