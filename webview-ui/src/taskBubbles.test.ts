import { describe, expect, it } from 'vitest';
import { taskBubble, type TaskBubbleInput } from './taskBubbles.js';
import type { ObservedTask } from '../../src/observedTasks.js';

const secret = 'PROMPT_ARGUMENT_OUTPUT_SECRET';
const task: ObservedTask = {
  sessionId: 'session-full', toolCallId: 'call', parentToolCallId: null,
  name: secret, agentType: 'general-purpose', mode: 'background', description: secret,
  agentId: 'ada', state: 'running', fieldsTruncated: false,
};
const input: TaskBubbleInput = {
  agentId: 'ada', active: true, liveTask: true,
  source: { state: 'following', sessionId: 'session-' },
  snapshot: { sessionId: 'session-full', tasks: [task], limited: false }, tool: 'view',
};

describe('privacy-bounded task bubble projection', () => {
  it('uses fixed source-labeled phrases without metadata text or unknown tool names', () => {
    expect(taskBubble(input)).toBe('CLI tool: Reading a file');
    expect(taskBubble({ ...input, tool: secret })).toBe('CLI task: Task in progress');
    expect(taskBubble({ ...input, tool: 'constructor' })).toBe('CLI task: Task in progress');
    expect(taskBubble({ ...input, tool: 'powershell' })).toBe('CLI tool: Running a command');
    expect(taskBubble({ ...input, tool: null })).not.toContain(secret);
  });
  it.each(['off', 'searching', 'error'] as const)('withholds unavailable/stale %s sources', state => {
    expect(taskBubble({ ...input, source: { state, sessionId: 'session-' } })).toBeNull();
  });
  it('requires active live attribution and matching source/snapshot/task sessions', () => {
    for (const patch of [
      { active: false }, { liveTask: false }, { snapshot: null }, { source: undefined },
      { source: { state: 'following' as const, sessionId: 'another' } },
      { snapshot: { ...input.snapshot!, tasks: [{ ...task, sessionId: 'another' }] } },
      { snapshot: { ...input.snapshot!, tasks: [{ ...task, agentId: null, parentToolCallId: 'ada' }] } },
    ]) expect(taskBubble({ ...input, ...patch })).toBeNull();
  });
  it.each(['observed', 'completed', 'failed', 'aborted'] as const)('clears %s work instead of inferring a conversation', state => {
    expect(taskBubble({ ...input, snapshot: { ...input.snapshot!, tasks: [{ ...task, state }] } })).toBeNull();
  });
  it('bounds every supported tool phrase independently of hostile metadata length', () => {
    for (const tool of ['view', 'edit', 'create', 'powershell', 'bash', 'grep', 'rg', 'glob', 'web_fetch', 'web_search', 'task']) {
      const result = taskBubble({ ...input, tool })!;
      expect(result.length).toBeLessThanOrEqual(40);
      expect(result).not.toContain(secret);
      expect(result).toMatch(/^CLI tool: /);
    }
  });
});
