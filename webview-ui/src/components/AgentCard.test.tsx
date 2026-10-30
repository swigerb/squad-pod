import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentCard, type AgentDetailInfo } from './AgentCard.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('AgentCard activity time', () => {
  let host: HTMLDivElement;
  let root: Root;

  const detail: AgentDetailInfo = {
    id: 'test-agent',
    name: 'TestBot',
    role: 'Developer',
    workspaceRoot: 'workspace',
    status: 'active',
    currentTask: null,
    charterSummary: null,
    charterContent: null,
    charterStatus: 'unavailable',
    expertise: null,
    responsibilities: null,
    boundaries: null,
    recentActivity: [],
    lastActiveAt: 0,
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(lastActiveAt: number) {
    act(() => root.render(
      <AgentCard
        detail={{ ...detail, lastActiveAt }}
        position={{ x: 10, y: 10 }}
        onClose={() => {}}
      />,
    ));
    return host.querySelector('[role="dialog"]')!;
  }

  it('labels an unavailable timestamp instead of showing an epoch-based age', () => {
    const card = render(0);

    expect(card.textContent).toContain('Activity time unavailable');
    expect(card.textContent).not.toMatch(/\d+ hours? ago/);
  });

  it('preserves relative-time formatting for a valid timestamp', () => {
    const card = render(Date.now() - 2 * 60 * 1000);

    expect(card.textContent).toContain('2 min ago');
  });

  it.each([
    ['file', 'File activity hint'],
    ['live', 'Live task'],
    [undefined, 'Observed activity'],
  ] as const)('labels task provenance %s without claiming every source is live', (currentTaskSource, label) => {
    act(() => root.render(<AgentCard
      detail={{ ...detail, currentTask: 'Synthetic description', currentTaskSource }}
      position={{ x: 10, y: 10 }} onClose={() => {}}
    />));
    expect(host.textContent).toContain(label);
    expect(host.textContent).toContain('Synthetic description');
    expect(host.textContent).not.toContain('Current Task');
  });
});
