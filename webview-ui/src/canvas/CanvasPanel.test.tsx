import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CanvasPanel } from './CanvasPanel.js';
import { CANVAS_EDIT_FAILED, CANVAS_EXPIRED, type CanvasHostClient } from './bootstrap.js';
import { CANVAS_CONTROL_CAPABILITIES, CANVAS_OBSERVER_CAPABILITIES } from '../../../src/core/hostCapabilities.js';
import type { PreferenceMutation } from '../../../standalone/src/officePreferences.js';

vi.mock('../App.js', () => ({
  default: ({ readOnly }: { readOnly: boolean }) => <p>{readOnly ? 'Observer office' : 'Editable office'}</p>,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('shows a neutral expired-session state with no credential form or raw errors', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const bootstrap = vi.fn().mockRejectedValue(new Error('private credential'));
  try {
    await act(async () => root.render(<CanvasPanel bootstrap={bootstrap} />));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(CANVAS_EXPIRED);
    expect(host.textContent).not.toContain('private credential');
    expect(host.textContent).not.toContain('VS Code');
    expect(host.querySelector('input, form')).toBeNull();
    expect(bootstrap).toHaveBeenCalledOnce();
  } finally { act(() => root.unmount()); host.remove(); }
});

function client(): CanvasHostClient {
  return {
    capabilities: CANVAS_OBSERVER_CAPABILITIES, dispose: vi.fn(), discardPreferenceDraft: vi.fn(),
    send: vi.fn(), subscribe: vi.fn(), getState: vi.fn(), setState: <T,>(state: T) => state,
  };
}

it('keeps the viewer read-only until the user enables editing, then displays retained preference controls', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const viewer = client();
  const control = { ...client(), capabilities: CANVAS_CONTROL_CAPABILITIES };
  let grant!: (client: CanvasHostClient) => void;
  const permission = new Promise<CanvasHostClient>(resolve => { grant = resolve; });
  let onDraft!: (draft: PreferenceMutation | null) => void;
  viewer.enableEditing = vi.fn(callback => { onDraft = callback; return permission; });
  try {
    await act(async () => root.render(<CanvasPanel bootstrap={async () => viewer} />));
    expect(viewer.enableEditing).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Observer office');
    const enable = host.querySelector('button')!;
    act(() => enable.click());
    expect(enable.disabled).toBe(true);
    expect(viewer.dispose).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('Editable office');
    await act(async () => grant(control));
    expect(viewer.dispose).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Editable office');
    const draft: PreferenceMutation = { type: 'setShowAreas', enabled: true };
    act(() => onDraft(draft));
    expect(host.textContent).toContain('Unacknowledged settings/seat draft');
    const buttons = [...host.querySelectorAll('button')];
    act(() => buttons.find(button => button.textContent?.startsWith('Retry'))!.click());
    expect(control.send).toHaveBeenCalledWith(draft);
    act(() => buttons.find(button => button.textContent === 'Discard preference draft')!.click());
    expect(control.discardPreferenceDraft).toHaveBeenCalledOnce();
  } finally { act(() => root.unmount()); host.remove(); }
  expect(control.dispose).toHaveBeenCalledOnce();
});

it('retains the observer on enable failure and shows an explicit safe error', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const viewer = client();
  viewer.enableEditing = vi.fn().mockRejectedValue(new Error('private credential'));
  try {
    await act(async () => root.render(<CanvasPanel bootstrap={async () => viewer} />));
    await act(async () => host.querySelector('button')!.click());
    expect(host.textContent).toContain('Observer office');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(CANVAS_EDIT_FAILED);
    expect(host.textContent).not.toContain('private credential');
    expect(viewer.dispose).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); }
});

it('disposes late editing authority after the Canvas panel closes', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const viewer = client();
  const control = client();
  let grant!: (client: CanvasHostClient) => void;
  viewer.enableEditing = vi.fn(() => new Promise<CanvasHostClient>(resolve => { grant = resolve; }));
  await act(async () => root.render(<CanvasPanel bootstrap={async () => viewer} />));
  act(() => host.querySelector('button')!.click());
  act(() => root.unmount());
  await act(async () => grant(control));
  expect(viewer.dispose).toHaveBeenCalledOnce();
  expect(control.dispose).toHaveBeenCalledOnce();
});
