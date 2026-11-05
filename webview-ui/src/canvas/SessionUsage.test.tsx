import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostClientProvider } from '../HostClientContext.js';
import { CANVAS_OBSERVER_CAPABILITIES } from '../../../src/core/hostCapabilities.js';
import type { CanvasHostBridge } from '../../../src/core/canvasHost.js';
import { CliUsage } from '../components/CliUsage.js';
import { HOST_UNAVAILABLE } from './hostBridge.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
function mount(getUsage: CanvasHostBridge['getUsage']) {
  const bridge: CanvasHostBridge = { charter: false, usage: true, export: false,
    openCharter: vi.fn(), exportLayout: vi.fn(), importLayout: vi.fn(), getUsage };
  const send = vi.fn();
  act(() => root.render(<HostClientProvider client={{
    capabilities: CANVAS_OBSERVER_CAPABILITIES, canvasHost: bridge,
    send, subscribe: () => () => {}, getState: () => undefined, setState: v => v,
  }}><CliUsage canvas readOnly snapshot={null} onAction={vi.fn()} /></HostClientProvider>));
  return { send, bridge };
}
describe('separate joined-session usage UI', () => {
  it('fetches on click, displays only reported quantities with units and retains CLI import limitations', async () => {
    const getUsage = vi.fn(async () => [{ label: 'API time', value: 0, unit: 'ms' }]);
    const { send } = mount(getUsage);
    expect(getUsage).not.toHaveBeenCalled();
    expect(host.textContent).toContain('CLI usage import is unavailable in Canvas.');
    expect(host.textContent).not.toContain('Select CLI usage JSON');
    expect(host.textContent).not.toContain('--usage-output-file');
    await act(async () => host.querySelector('button')!.click());
    expect(getUsage).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('API time: 0 ms');
    expect(host.textContent).not.toContain('premium requests: 0');
    expect(send).not.toHaveBeenCalled();
  });
  it('shows missing as unavailable and disables refresh after a sanitized failure without retrying', async () => {
    const getUsage = vi.fn<CanvasHostBridge['getUsage']>().mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('PRIVATE path or SDK exception'));
    mount(getUsage);
    await act(async () => host.querySelector('button')!.click());
    expect(host.textContent).toContain('No session quantities reported; missing is not zero.');
    await act(async () => host.querySelector('button')!.click());
    expect(host.querySelector('button')!.disabled).toBe(true);
    expect(host.querySelector('[role=alert]')!.textContent).toBe(HOST_UNAVAILABLE);
    expect(host.textContent).not.toContain('PRIVATE');
    expect(getUsage).toHaveBeenCalledTimes(2);
  });
});
