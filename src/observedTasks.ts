import type { LiveEvent } from './copilotSessionActivity.js';

export const MAX_OBSERVED_TASKS = 64;
export const MAX_RECENT_TASKS = 16;
export const TASK_ID_MAX_LENGTH = 160;

/** IDs are opaque: reject invalid values rather than trimming or truncating into aliases. */
export function taskIdentity(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length <= TASK_ID_MAX_LENGTH
    && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value) ? value : '';
}

export interface ObservedTask {
  sessionId: string;
  toolCallId: string;
  parentToolCallId: string | null;
  name: string;
  agentType: string;
  mode: string;
  description: string;
  agentId: string | null;
  instanceId?: string;
  selectedAgentName?: string;
  state: 'observed' | 'running' | 'completed' | 'failed' | 'aborted';
  fieldsTruncated: boolean;
}

export interface ObservedTaskSnapshot {
  sessionId: string | null;
  tasks: ObservedTask[];
  limited: boolean;
}

export interface TransientSubagent {
  id: string;
  parentAgentId: string;
  name: string;
}

/** Call IDs and instance IDs are session-scoped, never display-name identities. */
export function transientSubagents(snapshot: ObservedTaskSnapshot | null, rosterIds: readonly string[]): TransientSubagent[] {
  if (!snapshot?.sessionId) { return []; }
  const tasks = snapshot.tasks.filter(task => task.sessionId === snapshot.sessionId).slice(0, MAX_OBSERVED_TASKS);
  const byCall = new Map(tasks.map(task => [task.toolCallId, task]));
  const rosterId = (task: ObservedTask): string | undefined =>
    rosterIds.find(id => id === task.agentId)
      ?? (task.selectedAgentName ? rosterIds.find(id => id.toLowerCase() === task.selectedAgentName!.toLowerCase()) : undefined);
  const identity = (task: ObservedTask) => JSON.stringify([task.sessionId,
    task.instanceId ? 'instance' : 'call', task.instanceId || task.toolCallId]);
  // A selected roster identity or terminal alias wins over another call for the same instance.
  const suppressed = new Set(tasks.filter(task => terminal(task) || rosterId(task)).map(identity));
  const result = new Map<string, TransientSubagent>();
  for (const task of tasks) {
    const id = identity(task);
    if (task.state !== 'running' || suppressed.has(id)) { continue; }
    const seen = new Set([task.toolCallId]);
    let parent = byCall.get(task.parentToolCallId ?? '');
    while (parent && !seen.has(parent.toolCallId) && parent.state === 'running') {
      seen.add(parent.toolCallId);
      const parentAgentId = rosterId(parent);
      if (parentAgentId) {
        result.set(id, { id, parentAgentId, name: task.name || task.selectedAgentName || 'Unnamed task' });
        break;
      }
      parent = byCall.get(parent.parentToolCallId ?? '');
    }
  }
  return [...result.values()];
}

const terminal = (task: ObservedTask) => !['observed', 'running'].includes(task.state);

/** Ephemeral inventory; selection may link an instance to an existing roster ID, never create one. */
export class ObservedTasks {
  private tasks = new Map<string, ObservedTask>();
  private selections = new Map<string, { name: string; agentId: string | null }>();
  private limited = false;

  clear(): void {
    this.tasks.clear();
    this.selections.clear();
    this.limited = false;
  }

  has(toolCallId: string): boolean {
    return this.tasks.has(toolCallId);
  }

  accept(event: LiveEvent, sessionId: string, agentId: string | null): void {
    if (event.identityOmitted) { this.limited = true; }
    if (event.type === 'subagent.selected' && event.instanceId && event.selectedAgentName) {
      if (this.selections.size < MAX_OBSERVED_TASKS || this.selections.has(event.instanceId)) {
        this.selections.set(event.instanceId, { name: event.selectedAgentName, agentId });
      } else { this.limited = true; }
      for (const task of this.tasks.values()) {
        if (task.instanceId === event.instanceId && !terminal(task)) {
          task.selectedAgentName = event.selectedAgentName;
          task.agentId = agentId;
        }
      }
    }
    if (!event.toolCallId) { return; }
    if (event.type === 'tool.execution_start' && event.task) {
      // Repeated starts must not rename, reattribute or resurrect an observed call.
      if (this.tasks.has(event.toolCallId)) { return; }
      if (this.tasks.size >= MAX_OBSERVED_TASKS) {
        const oldestDone = [...this.tasks].find(([, task]) => terminal(task));
        if (oldestDone) { this.tasks.delete(oldestDone[0]); }
        else { this.limited = true; return; }
        this.limited = true;
      }
      this.tasks.set(event.toolCallId, {
        sessionId, toolCallId: event.toolCallId, parentToolCallId: event.parentToolCallId || null,
        name: event.task.name.replace(/[\x00-\x1f\x7f]/g, ' '),
        agentType: event.task.agent_type.replace(/[\x00-\x1f\x7f]/g, ' '), mode: event.task.mode,
        description: event.task.description, fieldsTruncated: !!event.task.fieldsTruncated,
        agentId, state: 'observed',
      });
    }
    const task = this.tasks.get(event.toolCallId);
    if (!task || terminal(task)) { return; }
    if (event.type === 'subagent.started' && task.state === 'observed' && event.instanceId) {
      task.instanceId = event.instanceId;
      const selected = this.selections.get(event.instanceId);
      if (selected) {
        task.selectedAgentName = selected.name;
        task.agentId = selected.agentId;
      }
    }
    switch (event.type) {
      case 'subagent.started': task.state = 'running'; break;
      case 'subagent.completed': task.state = 'completed'; break;
      case 'subagent.failed': task.state = 'failed'; break;
      case 'subagent.aborted': task.state = 'aborted'; break;
      // tool.execution_complete is dispatch completion, not subagent completion.
    }
    if (terminal(task)) {
      this.tasks.delete(event.toolCallId);
      this.tasks.set(event.toolCallId, task);
    }
    const completed = [...this.tasks].filter(([, row]) => terminal(row));
    for (const [id] of completed.slice(0, Math.max(0, completed.length - MAX_RECENT_TASKS))) {
      this.tasks.delete(id);
      this.limited = true;
    }
  }

  discardSeedCompletions(): void {
    for (const [id, task] of this.tasks) {
      if (terminal(task)) { this.tasks.delete(id); }
    }
  }

  snapshot(sessionId: string | null, sourceLimited = false): ObservedTaskSnapshot {
    return {
      sessionId, limited: this.limited || sourceLimited,
      tasks: [...this.tasks.values()].map(task => ({
        ...task, parentToolCallId: this.safeParent(task),
      })),
    };
  }

  private safeParent(task: ObservedTask): string | null {
    const seen = new Set([task.toolCallId]);
    let id = task.parentToolCallId;
    while (id) {
      if (seen.has(id)) { return null; }
      seen.add(id);
      const parent = this.tasks.get(id);
      if (!parent || parent.sessionId !== task.sessionId) {
        // A directly observed parent is usable even if its own parent is unknown.
        return id === task.parentToolCallId ? null : task.parentToolCallId;
      }
      id = parent.parentToolCallId;
    }
    return task.parentToolCallId;
  }
}
