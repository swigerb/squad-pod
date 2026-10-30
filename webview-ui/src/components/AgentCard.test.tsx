import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentCard, type AgentDetailInfo } from './AgentCard.js';
import { liveModelUnavailableReason } from './RuntimeModelStatus.js';

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

  function render(lastActiveAt: number | null) {
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

  it('explicitly represents an agent with no attributable live observation', () => {
    const card = render(null);

    expect(card.textContent).toContain('No attributable activity observed');
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

  it('shows only runtime model observations with their producer source and timestamp', () => {
    act(() => root.render(<AgentCard
      detail={detail}
      position={{ x: 10, y: 10 }}
      onClose={() => {}}
      runtimeModel={{
        model: 'synthetic-runtime-model', kind: 'assistant-message',
        source: 'assistant.message.model', timestamp: '2026-10-30T12:34:56.000Z',
      }}
      liveActivity={{ state: 'following', sessionId: 'session' }}
    />));
    expect(host.textContent).toContain('Member runtime model: synthetic-runtime-model');
    expect(host.textContent).toContain('assistant.message.model');
    expect(host.textContent).toContain('2026-10-30T12:34:56.000Z');
    expect(host.textContent).not.toContain('Declared');
  });

  it('distinguishes automatic selection and tool-call provenance', () => {
    act(() => root.render(<AgentCard
      detail={detail}
      position={{ x: 10, y: 10 }}
      onClose={() => {}}
      runtimeModel={{
        model: 'auto', kind: 'tool-call',
        source: 'tool.execution_complete.model', timestamp: '2026-10-30T12:34:56.000Z',
      }}
      liveActivity={{ state: 'following', sessionId: 'session' }}
    />));
    expect(host.textContent).toContain('Automatic selection (auto; not a concrete model)');
    expect(host.textContent).toContain('Model emitted for a tool call');
    expect(host.textContent).toContain('tool.execution_complete.model');
  });

  it.each([
    [undefined, false, 'Live Activity is off; enable it to observe runtime model events.'],
    [{ state: 'searching', sessionId: null }, false, 'No matching Copilot CLI session is currently being followed.'],
    [{ state: 'error', sessionId: null }, false, 'The selected Copilot CLI session could not be read.'],
    [{ state: 'following', sessionId: 'session' }, false, 'No current runtime model observation is available for this session or member.'],
    [{ state: 'following', sessionId: 'session' }, true, 'Live model observation is unavailable in the read-only observer.'],
  ] as const)('explains unavailable model state %s', (liveActivity, readOnly, reason) => {
    expect(liveModelUnavailableReason(liveActivity, readOnly)).toBe(reason);
  });
});
