import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CanvasPanel } from './CanvasPanel.js';
import { CANVAS_EXPIRED } from './bootstrap.js';

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
