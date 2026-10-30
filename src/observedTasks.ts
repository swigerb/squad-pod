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
  state: 'observed' | 'running' | 'completed' | 'failed' | 'aborted';
  fieldsTruncated: boolean;
}

export interface ObservedTaskSnapshot {
  sessionId: string | null;
  tasks: ObservedTask[];
  limited: boolean;
}

const terminal = (task: ObservedTask) => !['observed', 'running'].includes(task.state);

/** Ephemeral inventory, deliberately independent of the roster animation registry. */
export class ObservedTasks {
  private tasks = new Map<string, ObservedTask>();
  private limited = false;

  clear(): void {
    this.tasks.clear();
    this.limited = false;
  }

  has(toolCallId: string): boolean {
    return this.tasks.has(toolCallId);
  }

  accept(event: LiveEvent, sessionId: string, agentId: string | null): void {
    if (event.identityOmitted) { this.limited = true; }
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
