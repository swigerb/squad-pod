import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { TaskBubbleToggle } from './TaskBubbleToggle.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('toggles only viewer state without a host client or project control', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  function Viewer() {
    const [enabled, setEnabled] = useState(true);
    return <TaskBubbleToggle enabled={enabled} onChange={setEnabled} />;
  }
  try {
    act(() => root.render(<Viewer />));
    const button = host.querySelector('button')!;
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.title).toContain('this view only');
    act(() => button.click());
    expect(button.textContent).toBe('Task bubbles: Off');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    act(() => button.click());
    expect(button.getAttribute('aria-pressed')).toBe('true');
  } finally {
    act(() => root.unmount());
  }
});
