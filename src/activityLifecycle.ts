import { ObservedTasks } from './observedTasks.js';
import type { LiveEvent } from './activityProjection.js';
import type { LiveModelSnapshot, OutboundMessage, RuntimeModelObservation } from './types.js';

const MAX_TRACKED = 2048;

/** Source identity and replay bounds supplied by the owning adapter, never discovered here. */
export interface ActivitySourceContext {
  sessionId: string | null;
  limited: boolean;
}

/** Injected outputs, authoritative roster and source context for one projection instance. */
export interface ActivityLifecycleOptions {
  source: () => ActivitySourceContext;
  roster: () => readonly { id: string; folder?: string }[];
  post: (message: OutboundMessage) => void;
  lifecycle: (
    agentId: string, active: boolean, task: string | null, activityAt?: number, clockSkew?: boolean,
  ) => void;
  now?: () => number;
}

interface ActivityTimeObservation {
  activityAt?: number;
  clockSkew: boolean;
}

/** Display label for an already sanitized event. */
export function liveToolLabel(event: LiveEvent): string {
  const labels: Record<string, string> = {
    view: `Reading ${event.file || 'file'}`, edit: `Editing ${event.file || 'file'}`,
    create: `Writing ${event.file || 'file'}`, powershell: `Running: ${event.command || 'shell'}`,
    bash: `Running: ${event.command || 'shell'}`, grep: 'Searching', glob: 'Searching',
    web_fetch: 'Fetching', web_search: 'Searching', task: 'Subtask',
  };
  return (labels[event.toolName] ?? event.toolName).slice(0, 30) || 'Tool';
}

/** Resolve only unambiguous exact roster identities, never promote observed names. */
export function exactLiveAgent(name: string, roster: readonly { id: string; folder?: string }[]): string | null {
  const key = name.toLowerCase();
  const matches = roster.filter(member => member.id.toLowerCase() === key || member.folder?.toLowerCase() === key);
  return key && matches.length === 1 ? matches[0].id : null;
}

/**
 * Source-independent in-memory reduction of sanitized events. The adapter owns consent,
 * source validation/freshness and clear-before-source-change; no filesystem or host API is used.
 */
export class ActivityLifecycle {
  private tasks = new Map<string, {
    agentId: string; description: string; instanceId?: string; activityAt?: number; clockSkew?: boolean;
  }>();
  private runs = new Map<string, string>();
  private tools = new Map<string, { agentId: string; toolName: string; label: string }>();
  private toolOwners = new Map<string, string | null>();
  private gauge = new Map<string, NonNullable<LiveEvent['context']>>();
  private sessionModel: RuntimeModelObservation | null = null;
  private memberModels = new Map<string, RuntimeModelObservation>();
  private modelAgentOwners = new Map<string, string>();
  private unresolvedMemberModels = new Map<string, RuntimeModelObservation>();
  private counter = 0;
  private seeding = false;
  private observedTasks = new ObservedTasks();

  constructor(private options: ActivityLifecycleOptions) {}

  /** Rebuild from a bounded source replay without emitting historical activity. */
  seed(events: readonly LiveEvent[]): void {
    const previous = new Set(this.runs.keys());
    this.seeding = true;
    try {
      this.clear();
      for (const event of events) {this.accept(event);}
    } finally { this.seeding = false; }
    for (const id of previous) {
      if (!this.runs.has(id)) { this.finish(id); }
    }
    this.observedTasks.discardSeedCompletions();
  }

  /** Replay current activity only; adapters publish their source status before snapshots. */
  replayActivity(): void {
    for (const [agentId, taskId] of this.runs) {
      const task = this.tasks.get(taskId);
      this.lifecycle(agentId, true, task?.description ?? null, task?.activityAt, task?.clockSkew);
    }
    for (const [toolId, tool] of this.tools) {
      this.options.post({ type: 'agentToolStart', agentId: tool.agentId, toolId, tool: tool.toolName, status: tool.label });
    }
    for (const [agentId, context] of this.gauge) {this.options.post({ type: 'agentContextUsage', agentId, ...context });}
  }

  private telemetry(agentId: string, summary: string): void {
    if (this.seeding) {return;}
    this.options.post({ type: 'telemetryEvent', event: {
      id: `live-${++this.counter}`, timestamp: (this.options.now ?? Date.now)(), category: 'status',
      agentId, agentName: null, summary, detail: null,
    } });
  }

  private post(message: OutboundMessage): void {
    if (!this.seeding) { this.options.post(message); }
  }

  private lifecycle(
    agentId: string,
    active: boolean,
    task: string | null,
    activityAt?: number,
    clockSkew = false,
  ): void {
    if (this.seeding) {return;}
    if (clockSkew) {
      this.options.lifecycle(agentId, active, task, activityAt, true);
    } else if (activityAt === undefined) {
      this.options.lifecycle(agentId, active, task);
    } else {
      this.options.lifecycle(agentId, active, task, activityAt);
    }
  }

  private activityTime(activityAt: number | undefined): ActivityTimeObservation {
    if (activityAt === undefined) {return { clockSkew: false };}
    if (activityAt > (this.options.now ?? Date.now)()) {return { clockSkew: true };}
    return { activityAt, clockSkew: false };
  }

  private mergeTaskActivity(
    task: { activityAt?: number; clockSkew?: boolean },
    observation: ActivityTimeObservation,
  ): void {
    if (observation.clockSkew) {
      task.clockSkew = true;
    } else if (observation.activityAt !== undefined) {
      task.activityAt = Math.max(task.activityAt ?? 0, observation.activityAt);
      task.clockSkew = false;
    }
  }

  /** Consume a normalized sanitized event, not a CLI envelope or JSONL record. */
  accept(event: LiveEvent): void {
    const activityTime = this.activityTime(event.activityAt);
    const duplicateTask = !!event.task && this.observedTasks.has(event.toolCallId);
    const attribution = event.selectedAgentName
      ? exactLiveAgent(event.selectedAgentName, this.options.roster())
      : event.task?.agent_type === 'general-purpose'
        ? exactLiveAgent(event.task.name, this.options.roster()) : null;
    const sessionId = this.options.source().sessionId;
    if (sessionId) { this.observedTasks.accept(event, sessionId, attribution); }
    if (event.selectedAgentName && event.instanceId) {
      for (const observed of this.observedTasks.snapshot(this.options.source().sessionId).tasks) {
        if (observed.instanceId !== event.instanceId || observed.state !== 'running') { continue; }
        const previous = this.tasks.get(observed.toolCallId);
        if (previous && previous.agentId !== observed.agentId) {
          if (this.runs.get(previous.agentId) === observed.toolCallId) { this.finish(previous.agentId); }
          this.tasks.delete(observed.toolCallId);
        }
        if (observed.agentId) {
          const previousForOwner = previous?.agentId === observed.agentId ? previous : undefined;
          const task = {
            agentId: observed.agentId, description: observed.description, instanceId: observed.instanceId,
            activityAt: previousForOwner?.activityAt, clockSkew: previousForOwner?.clockSkew,
          };
          this.mergeTaskActivity(task, activityTime);
          this.tasks.set(observed.toolCallId, task);
          this.startRun(observed.agentId, observed.toolCallId, observed.description,
            task.activityAt, !!task.clockSkew);
          this.rememberModelOwner(event.instanceId, observed.agentId);
        } else {
          this.clearInstanceModelOwner(event.instanceId);
        }
      }
    }
    if (!event.toolCallId || duplicateTask) {
      this.acceptModelEvent(event, this.tasks.get(event.toolCallId));
      return;
    }
    if (event.type === 'tool.execution_start' && event.task?.agent_type === 'general-purpose') {
      const agentId = attribution;
      if (agentId && !this.tasks.has(event.toolCallId) && this.tasks.size < MAX_TRACKED) {
        this.tasks.set(event.toolCallId, { agentId, description: event.task.description });
      }
    }
    if (event.type === 'subagent.started' && !this.tasks.has(event.toolCallId)) {
      const observed = this.observedTasks.snapshot(this.options.source().sessionId).tasks
        .find(row => row.toolCallId === event.toolCallId);
      if (observed?.agentId && observed.state === 'running') {
        this.tasks.set(event.toolCallId, { agentId: observed.agentId, description: observed.description,
          instanceId: observed.instanceId, activityAt: activityTime.activityAt,
          clockSkew: activityTime.clockSkew });
      }
    }
    const task = this.tasks.get(event.toolCallId);
    if (event.type === 'subagent.started' && task) {
      task.instanceId = this.observedTasks.snapshot(this.options.source().sessionId).tasks
        .find(row => row.toolCallId === event.toolCallId)?.instanceId ?? event.instanceId;
      this.mergeTaskActivity(task, activityTime);
      this.startRun(task.agentId, event.toolCallId, task.description, task.activityAt, !!task.clockSkew);
      if (task.instanceId) {this.rememberModelOwner(task.instanceId, task.agentId);}
    } else if (['subagent.completed', 'subagent.failed', 'subagent.aborted'].includes(event.type)) {
      const instanceId = task?.instanceId ?? event.instanceId;
      for (const [id, ended] of this.tasks) {
        if (id !== event.toolCallId && (!instanceId || ended.instanceId !== instanceId)) { continue; }
        if (this.runs.get(ended.agentId) === id) {
          this.finish(ended.agentId, activityTime.activityAt, activityTime.clockSkew);
        }
        this.tasks.delete(id);
      }
    } else if (event.type === 'tool.execution_start') {
      const parent = this.tasks.get(event.parentToolCallId);
      const scopedOwner = event.agentScoped ? this.modelAgentOwners.get(event.agentInstanceId) : undefined;
      if (parent) {
        this.observeTaskActivity(event.parentToolCallId, activityTime);
      } else if (scopedOwner) {
        const runId = this.runs.get(scopedOwner);
        if (runId) {this.observeTaskActivity(runId, activityTime);}
      }
      if (parent) {
        this.rememberToolOwner(event.toolCallId, parent.agentId);
      } else if (scopedOwner) {
        this.rememberToolOwner(event.toolCallId, scopedOwner);
      } else if (!event.parentToolCallId && !event.agentScoped) {
        this.rememberToolOwner(event.toolCallId, null);
      }
      if (!parent || this.runs.get(parent.agentId) !== event.parentToolCallId
        || this.tools.size >= MAX_TRACKED) {return;}
      const label = liveToolLabel(event);
      this.tools.set(event.toolCallId, { agentId: parent.agentId, toolName: event.toolName, label });
      this.post({ type: 'agentToolStart', agentId: parent.agentId, toolId: event.toolCallId, tool: event.toolName, status: label });
      this.telemetry(parent.agentId, label);
    } else if (event.type === 'tool.execution_complete') {
      const tool = this.tools.get(event.toolCallId);
      const parentTask = this.tasks.get(event.parentToolCallId);
      if (!tool) {
        const owner = this.toolOwners.get(event.toolCallId);
        if (parentTask && (owner === undefined || owner === parentTask.agentId)) {
          this.observeTaskActivity(event.parentToolCallId, activityTime);
        } else if (owner) {
          const runId = this.runs.get(owner);
          if (runId) {this.observeTaskActivity(runId, activityTime);}
        }
        if (owner === null) {
          if (parentTask) {return;}
          this.acceptModelEvent(event, undefined, undefined, true);
        } else if (owner !== undefined) {
          if (parentTask && owner !== parentTask.agentId) {return;}
          this.acceptModelEvent(event, parentTask, owner);
        } else {
          this.acceptModelEvent(event, parentTask, parentTask?.agentId);
        }
        return;
      }
      if (parentTask && parentTask.agentId === tool.agentId) {
        this.observeTaskActivity(event.parentToolCallId, activityTime);
      } else {
        const runId = this.runs.get(tool.agentId);
        if (runId) {this.observeTaskActivity(runId, activityTime);}
      }
      this.post({ type: 'agentToolDone', agentId: tool.agentId, toolId: event.toolCallId, tool: tool.toolName });
      if (event.context) {
        this.gauge.set(tool.agentId, event.context);
        this.post({ type: 'agentContextUsage', agentId: tool.agentId, ...event.context });
      }
      this.tools.delete(event.toolCallId);
      this.acceptModelEvent(event, task, tool.agentId);
      return;
    }
    this.acceptModelEvent(event, this.tasks.get(event.toolCallId));
  }

  private startRun(
    agentId: string,
    toolCallId: string,
    description: string,
    activityAt?: number,
    clockSkew = false,
  ): void {
    const task = this.tasks.get(toolCallId);
    if (task) {this.mergeTaskActivity(task, { activityAt, clockSkew });}
    if (this.runs.get(agentId) === toolCallId) {
      if (activityAt !== undefined || clockSkew) {
        this.lifecycle(agentId, true, description, task?.activityAt, !!task?.clockSkew);
      }
      return;
    }
    if (this.runs.has(agentId)) { this.clearDisplays(agentId); }
    this.runs.set(agentId, toolCallId);
    this.lifecycle(agentId, true, description, task?.activityAt, !!task?.clockSkew);
    this.telemetry(agentId, 'Live member started');
  }

  private observeTaskActivity(toolCallId: string, observation: ActivityTimeObservation): void {
    const task = this.tasks.get(toolCallId);
    if (!task) {return;}
    const previousActivityAt = task.activityAt;
    const previousClockSkew = !!task.clockSkew;
    this.mergeTaskActivity(task, observation);
    if (this.runs.get(task.agentId) === toolCallId
      && (task.activityAt !== previousActivityAt || !!task.clockSkew !== previousClockSkew)) {
      this.lifecycle(task.agentId, true, task.description, task.activityAt, !!task.clockSkew);
    }
  }

  private finish(agentId: string, activityAt?: number, clockSkew = false): void {
    this.runs.delete(agentId);
    this.clearDisplays(agentId);
    this.lifecycle(agentId, false, null, activityAt, clockSkew);
    this.telemetry(agentId, 'Live member finished');
  }

  private rememberToolOwner(toolCallId: string, agentId: string | null): void {
    this.toolOwners.delete(toolCallId);
    this.toolOwners.set(toolCallId, agentId);
    if (this.toolOwners.size > MAX_TRACKED) {
      const oldest = this.toolOwners.keys().next().value as string | undefined;
      if (oldest) {this.toolOwners.delete(oldest);}
    }
  }

  private clearDisplays(agentId: string): void {
    const removedModel = this.memberModels.delete(agentId);
    for (const [instanceId, owner] of this.modelAgentOwners) {
      if (owner === agentId) {
        this.modelAgentOwners.delete(instanceId);
        this.unresolvedMemberModels.delete(instanceId);
      }
    }
    this.gauge.delete(agentId);
    for (const [id, tool] of this.tools) {
      if (tool.agentId === agentId) { this.tools.delete(id); }
    }
    this.post({ type: 'agentToolsClear', agentId });
    this.post({ type: 'agentContextUsage', agentId, contextTokens: null, maxContextTokens: null });
    if (removedModel) {this.publishModels();}
  }

  private modelSnapshot(): LiveModelSnapshot {
    return {
      sessionId: this.options.source().sessionId?.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8) || null,
      session: this.sessionModel,
      members: Object.fromEntries(this.memberModels),
    };
  }

  /** Publish current model observations without inventing missing producer data. */
  publishModels(): void {
    this.post({ type: 'liveModels', snapshot: this.modelSnapshot() });
  }

  private rememberModelOwner(instanceId: string, agentId: string): void {
    if (!instanceId) {return;}
    const existing = this.modelAgentOwners.get(instanceId);
    if (existing && existing !== agentId) {return;}
    this.modelAgentOwners.delete(instanceId);
    this.modelAgentOwners.set(instanceId, agentId);
    const pending = this.unresolvedMemberModels.get(instanceId);
    if (pending) {
      this.unresolvedMemberModels.delete(instanceId);
      this.memberModels.set(agentId, pending);
      this.publishModels();
    }
    if (this.modelAgentOwners.size > MAX_TRACKED) {
      const oldest = this.modelAgentOwners.keys().next().value as string | undefined;
      if (oldest) {
        const oldOwner = this.modelAgentOwners.get(oldest);
        this.modelAgentOwners.delete(oldest);
        this.unresolvedMemberModels.delete(oldest);
        if (oldOwner && ![...this.modelAgentOwners.values()].includes(oldOwner)
          && this.memberModels.delete(oldOwner)) {this.publishModels();}
      }
    }
  }

  private clearInstanceModelOwner(instanceId: string): void {
    const owner = this.modelAgentOwners.get(instanceId);
    this.modelAgentOwners.delete(instanceId);
    this.unresolvedMemberModels.delete(instanceId);
    if (owner && ![...this.modelAgentOwners.values()].includes(owner)
      && this.memberModels.delete(owner)) {this.publishModels();}
  }

  private acceptModelEvent(
    event: LiveEvent,
    task: { agentId: string; description: string } | undefined,
    knownOwnerId?: string,
    knownRootOwner = false,
  ): void {
    if (event.type === 'subagent.started' && task && event.agentInstanceId) {
      this.rememberModelOwner(event.agentInstanceId, task.agentId);
    }
    if (event.type === 'session.shutdown') {
      if (event.agentScoped) {
        this.clearInstanceModelOwner(event.agentInstanceId);
      } else {
        this.sessionModel = null;
        this.memberModels.clear();
        this.modelAgentOwners.clear();
        this.unresolvedMemberModels.clear();
        this.toolOwners.clear();
        this.publishModels();
      }
      return;
    }
    if (['subagent.completed', 'subagent.failed', 'subagent.aborted'].includes(event.type)
      && event.agentScoped) {
      this.clearInstanceModelOwner(event.agentInstanceId);
      return;
    }
    if (event.type === 'session.model_deselected') {
      if (!event.agentScoped) {
        this.sessionModel = null;
        this.publishModels();
      } else {
        const owner = this.modelAgentOwners.get(event.agentInstanceId);
        if (owner && this.memberModels.delete(owner)) {this.publishModels();}
      }
      return;
    }
    const observation = event.modelObservation;
    if (!observation) {return;}
    if (event.agentScoped) {
      if (knownRootOwner) {return;}
      const mappedOwner = event.type === 'subagent.started' ? task?.agentId
        : this.modelAgentOwners.get(event.agentInstanceId);
      if (mappedOwner && knownOwnerId && mappedOwner !== knownOwnerId) {return;}
      const owner = mappedOwner ?? knownOwnerId;
      if (owner && this.runs.has(owner)) {
        this.memberModels.set(owner, observation);
        this.publishModels();
      } else if (event.agentInstanceId) {
        this.unresolvedMemberModels.delete(event.agentInstanceId);
        this.unresolvedMemberModels.set(event.agentInstanceId, observation);
        if (this.unresolvedMemberModels.size > MAX_TRACKED) {
          const oldest = this.unresolvedMemberModels.keys().next().value as string | undefined;
          if (oldest) {this.unresolvedMemberModels.delete(oldest);}
        }
      }
      return;
    }
    if (knownOwnerId) {
      if (this.runs.has(knownOwnerId)) {
        this.memberModels.set(knownOwnerId, observation);
        this.publishModels();
      }
      return;
    }
    if (knownRootOwner) {
      this.sessionModel = observation;
      this.publishModels();
      return;
    }
    if (event.type === 'tool.execution_complete') {return;}
    if (event.type === 'subagent.started') {
      if (task && this.runs.has(task.agentId)) {
        this.memberModels.set(task.agentId, observation);
        this.publishModels();
      }
      return;
    }
    this.sessionModel = observation;
    this.publishModels();
  }

  /** Clear all ephemeral state when the owning adapter loses, changes or disables its source. */
  clear(): void {
    for (const id of this.runs.keys()) {this.finish(id);}
    this.tasks.clear();
    this.tools.clear();
    this.gauge.clear();
    this.sessionModel = null;
    this.memberModels.clear();
    this.modelAgentOwners.clear();
    this.unresolvedMemberModels.clear();
    this.toolOwners.clear();
    this.observedTasks.clear();
    this.post({ type: 'observedTasks', snapshot: { sessionId: null, tasks: [], limited: false } });
    this.post({ type: 'liveModels', snapshot: { sessionId: null, session: null, members: {} } });
  }

  /** Publish bounded tasks with the source's full session identity and truncation indicator. */
  publishTasks(): void {
    const source = this.options.source();
    this.post({ type: 'observedTasks',
      snapshot: this.observedTasks.snapshot(source.sessionId, source.limited) });
  }
}
