import type { ObservedTaskSnapshot } from '../../src/observedTasks.js';
import type { LiveSourceStatus } from '../../src/types.js';

const TOOL_SUMMARIES: Readonly<Record<string, string>> = {
  view: 'Reading a file', edit: 'Editing a file', create: 'Writing a file',
  powershell: 'Running a command', bash: 'Running a command',
  grep: 'Searching files', rg: 'Searching files', glob: 'Finding files',
  web_fetch: 'Fetching a page', web_search: 'Searching the web', task: 'Running a subtask',
};

export interface TaskBubbleInput {
  agentId: string;
  active: boolean;
  liveTask: boolean;
  source: LiveSourceStatus | undefined;
  snapshot: ObservedTaskSnapshot | null;
  tool?: string | null;
}

/** Only fixed phrases leave this projection; task text and tool arguments are never copied. */
export function taskBubble({ agentId, active, liveTask, source, snapshot, tool }: TaskBubbleInput): string | null {
  if (!active || !liveTask || source?.state !== 'following' || !source.sessionId || !snapshot?.sessionId) return null;
  // Source status carries the adapter's eight-character display ID, not an ownership credential.
  const displayId = snapshot.sessionId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8);
  if (displayId !== source.sessionId) return null;
  const matches = snapshot.tasks.filter(task =>
    task.sessionId === snapshot.sessionId && task.agentId === agentId);
  if (!matches.some(task => task.state === 'running')) return null;
  const phrase = tool && Object.hasOwn(TOOL_SUMMARIES, tool) ? TOOL_SUMMARIES[tool] : null;
  return phrase ? `CLI tool: ${phrase}` : 'CLI task: Task in progress';
}
