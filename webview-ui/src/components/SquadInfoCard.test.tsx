import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SquadInfoCard, type SquadInfoData } from './SquadInfoCard.js';
import type { AgentDetailInfo } from './AgentCard.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('SquadInfoCard activity time', () => {
  let host: HTMLDivElement;
  let root: Root;

  const info: SquadInfoData = {
    teamName: null,
    description: null,
    workspaceRoot: 'workspace',
    members: [{
      id: 'test-agent', name: 'TestBot', role: 'Developer', status: 'idle',
      isActive: false, currentTask: null,
    }],
    hiddenMembers: [],
    projectContext: null,
    totalAgents: 1,
    activeAgents: 0,
  };
  const detail: AgentDetailInfo = {
    id: 'test-agent',
    name: 'TestBot',
    role: 'Developer',
    workspaceRoot: 'workspace',
    status: 'idle',
    currentTask: null,
    charterSummary: null,
    charterContent: null,
    charterStatus: 'unavailable',
    expertise: null,
    responsibilities: null,
    boundaries: null,
    recentActivity: [],
    lastActiveAt: null,
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(
      <SquadInfoCard
        info={info}
        agentDetails={{ 'test-agent': detail }}
        availableAgentIds={['test-agent']}
        onClose={() => {}}
      />,
    ));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('shows an explicit never-observed value in the expanded member detail', () => {
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Show details for TestBot"]')!.click());

    expect(host.textContent).toContain('Last attributable live activity:');
    expect(host.textContent).toContain('No attributable activity observed');
  });
});
