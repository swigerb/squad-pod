import { act } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  roots: [] as Root[],
  dispose: vi.fn(),
  createClient: vi.fn(),
  terminalShell: vi.fn(),
}));
vi.mock('../App.js', () => ({
  default: ({ readOnly }: { readOnly: boolean }) => <div data-office="true">{readOnly ? 'read-only office' : 'control office'}</div>,
}));
vi.mock('./MobileShell.js', () => ({
  MobileShell: ({ office }: { office: React.ReactNode }) => {
    mocks.terminalShell(); return office;
  },
}));
vi.mock('./browserClient.js', () => ({ createBrowserClient: mocks.createClient }));
vi.mock('react-dom/client', async importOriginal => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return { ...actual, createRoot: (...args: Parameters<typeof actual.createRoot>) => {
    const root = actual.createRoot(...args);
    mocks.roots.push(root);
    return root;
  } };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.createClient.mockReturnValue({ dispose: mocks.dispose });
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState(null, '', '/');
});
afterEach(async () => {
  await act(async () => { for (const root of mocks.roots.splice(0)) root.unmount(); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fetcher(authenticated = true) {
  const fetch = vi.fn(async (path: string) => {
    return {
      ok: path !== '/auth' || authenticated,
      json: async () => ({ serverIdentity: 'a'.repeat(43), projectIdentity: null }),
    };
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function load() {
  await act(async () => { await import('./main.js'); });
}

describe('standalone CLI paste authentication', () => {
  it('does not auto-exchange Canvas fragments or enable the removed Canvas mode', async () => {
    document.head.innerHTML = '<meta name="squad-canvas" content="read-only">';
    window.history.replaceState(null, '', '/#c=canvas-secret');
    const fetch = fetcher();
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    await load();
    expect(window.location.hash).toBe('#c=canvas-secret');
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(document.querySelector('form')).not.toBeNull();
    expect(document.querySelector('#credential')).not.toBeNull();
    expect(mocks.terminalShell).toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });

  it('rejects invalid pasted credentials without losing the CLI authentication form', async () => {
    const fetch = fetcher(false);
    await load();
    document.querySelector<HTMLInputElement>('#credential')!.value = 'bad-cli-secret';
    await act(async () => document.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    ));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Authentication failed. Use the current credential from the observer console.');
    expect(document.querySelector<HTMLInputElement>('#credential')!.value).toBe('');
    expect(document.querySelector('form')).not.toBeNull();
    expect(mocks.terminalShell).toHaveBeenCalled();
  });

  it('leaves the default CLI paste flow and credential handling unchanged', async () => {
    const fetch = fetcher();
    await load();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector('label[for="credential"]')?.textContent).toContain('observer console');
    expect(mocks.terminalShell).toHaveBeenCalled();
    document.querySelector<HTMLInputElement>('#credential')!.value = 'cli-secret';
    await act(async () => document.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    ));
    expect(fetch).toHaveBeenNthCalledWith(1, '/auth', expect.objectContaining({
      body: JSON.stringify({ token: 'cli-secret' }),
    }));
    expect(document.querySelector('[data-office]')?.textContent).toBe('read-only office');
    expect(mocks.createClient).toHaveBeenCalledWith(expect.any(Function), undefined, window.location.origin, undefined);
    await act(async () => mocks.roots.pop()!.unmount());
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
});
