import { ActivityLifecycle, exactLiveAgent, liveToolLabel } from '../../../src/activityLifecycle.js';
import { projectActivityEvent } from '../../../src/activityProjection.js';
import { taskIdentity } from '../../../src/observedTasks.js';
import type { ExistingAgentsMessage, OutboundMessage } from '../../../src/types.js';

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const supported = new Set(['tool.execution_start', 'tool.execution_complete', 'subagent.selected',
  'subagent.started', 'subagent.configured', 'subagent.completed', 'subagent.failed', 'subagent.aborted',
  'assistant.turn_start', 'assistant.turn_end', 'session.idle', 'session.model_change', 'session.usage_info']);
const MAX_ALIASES = 128;

/** Per-office, non-replaying projection of whitelisted joined SDK events. */
export class CanvasActivity {
  private roster: ExistingAgentsMessage['agents'] = [];
  private running = new Map<string, string | null>();
  private selected = new Map<string, string>();
  private turns = new Map<string, string>();
  private endedTurns = new Set<string>();
  private instances = new Map<string, string>();
  private dispatchMembers = new Map<string, string>();
  private gauges = new Map<string, { contextTokens: number; maxContextTokens: number }>();
  private starts = new Set<string>(); // Bounded start/completion tombstones, not just active calls.
  private tools = new Map<string, string>();
  private rootTools = new Map<string, Extract<OutboundMessage, { type: 'agentToolStart' }>>();
  private dispatched = new Set<string>();
  private seen = new Set<string>();
  private limited = false;
  private sink: (message: OutboundMessage) => void;
  private lifecycle: ActivityLifecycle;

  constructor(private sessionId: string, post: (message: OutboundMessage) => void) {
    this.sink = post;
    this.lifecycle = new ActivityLifecycle({
      source: () => ({ sessionId: this.sessionId, limited: this.limited }),
      roster: () => this.roster,
      post: message => this.sink(message),
      lifecycle: (id, active, task) => {
        if (active) this.running.set(id, task);
        else this.running.delete(id);
        this.status(id);
      },
    });
  }

  private active(agentId: string): boolean {
    return this.running.has(agentId) || [...this.turns.values()].includes(agentId)
      || [...this.rootTools.values()].some(tool => tool.agentId === agentId);
  }

  private status(agentId: string) {
    const active = this.active(agentId);
    this.sink({ type: 'agentStatus', agentId, status: active ? 'active' : 'idle',
      currentTask: this.running.get(agentId) ?? null, currentTaskSource: active ? 'live' : null });
  }

  /** Clear synchronously before closing, replacing or revoking an office. */
  clear(preserveSessionModel = false): void {
    const owners = new Set([...this.turns.values(), ...this.gauges.keys(),
      ...[...this.rootTools.values()].map(tool => tool.agentId)]);
    for (const owner of new Set([...this.rootTools.values()].map(tool => tool.agentId)))
      this.sink({ type: 'agentToolsClear', agentId: owner });
    this.rootTools.clear();
    this.turns.clear();
    this.endedTurns.clear();
    this.selected.clear();
    this.instances.clear();
    this.dispatchMembers.clear();
    this.gauges.clear();
    this.lifecycle.clear(preserveSessionModel);
    for (const owner of owners) {
      this.status(owner);
      this.sink({ type: 'agentContextUsage', agentId: owner, contextTokens: null, maxContextTokens: null });
    }
    this.seen.clear();
    this.starts.clear();
    this.tools.clear();
    this.dispatched.clear();
    this.limited = false;
  }

  /** Overlay file snapshots without replacing declared roster membership or provenance. */
  snapshot(messages: OutboundMessage[]): OutboundMessage[] {
    const roster = messages.find(message => message.type === 'existingAgents');
    if (roster?.type === 'existingAgents') {
      if (this.roster.some(member => !roster.agents.some(next => next.id === member.id))) this.clear();
      this.roster = roster.agents;
    }
    return messages.map(message => {
      if (message.type === 'agentDetailLoaded') {
        const active = this.active(message.detail.id);
        return { ...message, detail: { ...message.detail, status: active ? 'active' : 'idle',
          currentTask: this.running.get(message.detail.id) ?? null, currentTaskSource: active ? 'live' : null } };
      }
      if (message.type === 'sourceStatus') return { ...message, status: { ...message.status,
        liveActivity: { state: 'following', sessionId: this.sessionId, selection: 'owned-session',
          reason: 'Exact joined SDK session; live events only, no replay.' } } } as OutboundMessage;
      if (message.type !== 'existingAgents') return message;
      return { ...message, agents: message.agents.map(agent => {
        const active = this.active(agent.id);
        return { ...agent, status: active ? 'active' as const : 'idle' as const,
          currentTask: this.running.get(agent.id) ?? null, currentTaskSource: active ? 'live' as const : null };
      }) };
    });
  }

  /** Current sanitized state for a viewer handshake, never historical event replay. */
  current(): OutboundMessage[] {
    const messages: OutboundMessage[] = [];
    const previous = this.sink;
    this.sink = message => messages.push(message);
    try {
      this.lifecycle.replayActivity();
      for (const tool of this.rootTools.values()) this.sink(tool);
      this.lifecycle.publishTasks();
      this.lifecycle.publishModels();
      for (const [agentId, context] of this.gauges) this.sink({ type: 'agentContextUsage', agentId, ...context });
    } finally { this.sink = previous; }
    return messages;
  }

  /** Project bounded tool metadata; never retain raw arguments, results or prompts. */
  accept(value: unknown): void {
    const raw = record(value);
    if (typeof raw.type !== 'string' || !supported.has(raw.type)) return;
    const data = record(raw.data);
    const eventId = taskIdentity(raw.id);
    if (raw.id !== undefined && !eventId) { this.limited = true; return; }
    if (eventId && this.seen.has(eventId)) return;
    if (eventId) {
      this.seen.add(eventId);
      if (this.seen.size > MAX_ALIASES) {
        this.seen.delete(this.seen.values().next().value!);
        this.limited = true;
      }
    }
    const agentId = taskIdentity(raw.agentId);
    if (raw.agentId !== undefined && !agentId) { this.limited = true; return; }
    const scope = agentId || (['subagent.completed', 'subagent.failed', 'subagent.aborted'].includes(raw.type)
      ? [...this.instances].find(([, call]) => call === taskIdentity(data.toolCallId))?.[0] : '') || '';
    if (raw.type === 'subagent.selected') {
      const owner = exactLiveAgent(taskIdentity(data.agentName), this.roster);
      const previous = this.selected.get(scope);
      if (previous && previous !== owner) {
        if (!scope) {
          for (const [call, tool] of this.rootTools) if (tool.agentId === previous) this.rootTools.delete(call);
          this.sink({ type: 'agentToolsClear', agentId: previous });
        }
        for (const key of this.turns.keys()) if (JSON.parse(key)[0] === scope) this.turns.delete(key);
        this.gauges.delete(previous);
        this.sink({ type: 'agentContextUsage', agentId: previous, contextTokens: null, maxContextTokens: null });
        this.status(previous);
      }
      if (this.selected.size < MAX_ALIASES || this.selected.has(scope)) {
        if (owner) this.selected.set(scope, owner);
        else this.selected.delete(scope);
      } else this.limited = true;
    }
    if (raw.type === 'session.idle') {
      if (!agentId) {
        const selected = this.selected.get('');
        const starts = new Set([...new Set([...this.starts, ...this.tools.keys()])].slice(-MAX_ALIASES));
        const dispatched = new Set(this.dispatched);
        const seen = new Set(this.seen);
        const ended = [...new Set([...this.endedTurns, ...this.turns.keys()])].slice(-MAX_ALIASES);
        this.clear(true);
        if (selected) this.selected.set('', selected);
        this.starts = starts;
        this.dispatched = dispatched;
        this.seen = seen;
        this.endedTurns = new Set(ended);
      } else {
        const call = this.instances.get(agentId);
        if (call) this.accept({ type: 'subagent.completed', agentId, data: { toolCallId: call } });
      }
      return;
    }
    if (raw.type === 'assistant.turn_start' || raw.type === 'assistant.turn_end') {
      const turnId = taskIdentity(data.turnId);
      const key = JSON.stringify([scope, turnId]);
      if (raw.type === 'assistant.turn_start' && this.endedTurns.has(key)) return;
      if (raw.type === 'assistant.turn_end' && turnId) {
        this.endedTurns.add(key);
        if (this.endedTurns.size > MAX_ALIASES) this.endedTurns.delete(this.endedTurns.values().next().value!);
      }
      const owner = this.turns.get(key) ?? this.selected.get(scope);
      if (!turnId || !owner) return;
      if (raw.type === 'assistant.turn_start' && this.turns.size < MAX_ALIASES) this.turns.set(key, owner);
      else if (raw.type === 'assistant.turn_end') this.turns.delete(key);
      else this.limited = true;
      this.status(owner);
      return;
    }
    if (raw.type === 'session.usage_info') {
      const owner = this.selected.get(scope);
      if (owner && typeof data.currentTokens === 'number' && Number.isFinite(data.currentTokens)
        && data.currentTokens >= 0 && typeof data.tokenLimit === 'number' && Number.isFinite(data.tokenLimit)
        && data.tokenLimit > 0) {
        const context = { contextTokens: data.currentTokens, maxContextTokens: data.tokenLimit };
        this.gauges.set(owner, context);
        this.sink({ type: 'agentContextUsage', agentId: owner, ...context });
      }
      return;
    }
    // Only tool starts expose arguments to the shared allowlist projector, never the lifecycle.
    const metrics = raw.type === 'tool.execution_complete' ? record(record(data.toolTelemetry).metrics) : {};
    const event = projectActivityEvent({ type: raw.type, id: eventId, agentId: agentId || undefined,
      timestamp: raw.timestamp, ephemeral: raw.ephemeral, data: {
        toolCallId: data.toolCallId, parentToolCallId: data.parentToolCallId,
        toolName: data.toolName, agentName: data.agentName, cancelled: data.cancelled,
        arguments: raw.type === 'tool.execution_start' ? data.arguments : undefined,
        model: data.model, newModel: data.newModel,
        toolTelemetry: { metrics: {
          context_current_tokens: metrics.context_current_tokens, context_token_limit: metrics.context_token_limit,
        } },
      } });
    if (!event) return;
    if (event.identityOmitted) this.limited = true;
    if (event.type === 'tool.execution_start' && event.toolCallId) {
      if (this.starts.has(event.toolCallId) || this.tools.has(event.toolCallId)) return;
      if (this.tools.size >= MAX_ALIASES) { this.limited = true; return; }
      this.tools.set(event.toolCallId, scope);
      if (event.task?.agent_type === 'general-purpose' && !event.identityOmitted) {
        const member = exactLiveAgent(event.task.name, this.roster);
        if (member && this.dispatchMembers.size < MAX_ALIASES) this.dispatchMembers.set(event.toolCallId, member);
        else if (member) this.limited = true;
      }
    }
    if (event.toolCallId && event.type.startsWith('tool.')) {
      if (event.type === 'tool.execution_complete') this.starts.delete(event.toolCallId);
      this.starts.add(event.toolCallId);
      if (this.starts.size > MAX_ALIASES) {
        this.starts.delete(this.starts.values().next().value!);
        this.limited = true;
      }
    }
    if (event.type === 'tool.execution_complete') {
      const owner = this.selected.get(scope || this.tools.get(event.toolCallId) || '');
      if (event.context && owner) this.gauges.set(owner, event.context);
      this.tools.delete(event.toolCallId);
    }
    if (event.type === 'tool.execution_start' && event.toolCallId && !event.identityOmitted
      && !agentId && !event.parentToolCallId) {
      const owner = this.selected.get('');
      if (owner) {
        const tool = { type: 'agentToolStart' as const, agentId: owner, toolId: event.toolCallId,
          tool: event.toolName, status: liveToolLabel(event) };
        this.rootTools.set(event.toolCallId, tool);
        this.sink(tool);
        this.status(owner);
      }
    } else if (event.type === 'tool.execution_complete') {
      const tool = this.rootTools.get(event.toolCallId);
      if (tool) {
        this.rootTools.delete(event.toolCallId);
        this.sink({ type: 'agentToolDone', agentId: tool.agentId, toolId: tool.toolId, tool: tool.tool });
        if (event.context) this.sink({ type: 'agentContextUsage', agentId: tool.agentId, ...event.context });
        this.status(tool.agentId);
      }
    }
    if (event.toolCallId && event.type.startsWith('tool.') && !event.parentToolCallId && agentId) {
      event.parentToolCallId = this.instances.get(agentId) ?? '';
    }
    const terminal = ['subagent.completed', 'subagent.failed', 'subagent.aborted'].includes(event.type);
    if ((event.type === 'subagent.started' || terminal) && event.toolCallId) {
      if (event.type === 'subagent.started' && this.dispatched.has(event.toolCallId)) return;
      this.dispatched.add(event.toolCallId);
      if (this.dispatched.size > MAX_ALIASES) this.dispatched.delete(this.dispatched.values().next().value!);
      // Fallback for joins that observe a lifecycle start without its spawning tool start.
      this.lifecycle.accept({ ...event, type: 'tool.execution_start', toolName: 'task',
        task: { name: taskIdentity(data.agentName), agent_type: taskIdentity(data.agentType),
          mode: taskIdentity(data.executionMode), description: '' } });
    }
    if (event.type === 'subagent.started' && event.toolCallId) {
      const owner = this.selected.get(scope) ?? this.dispatchMembers.get(event.toolCallId)
        ?? exactLiveAgent(taskIdentity(data.agentName), this.roster);
      if (event.instanceId && (this.instances.size < MAX_ALIASES || this.instances.has(event.instanceId))) {
        this.instances.set(event.instanceId, event.toolCallId);
        if (owner) {
          this.selected.set(scope, owner);
          this.lifecycle.accept({ ...event, type: 'subagent.selected', selectedAgentName: owner });
        }
      } else if (event.instanceId) this.limited = true;
    }
    this.lifecycle.accept(event);
    if (terminal) {
      const owner = this.selected.get(scope);
      this.dispatchMembers.delete(event.toolCallId);
      this.instances.delete(scope);
      this.selected.delete(scope);
      for (const [call, actor] of this.tools) if (actor === scope) this.tools.delete(call);
      if (owner) {
        this.gauges.delete(owner);
        for (const [key, member] of this.turns) if (member === owner) this.turns.delete(key);
        this.status(owner);
      }
    }
    this.lifecycle.publishTasks();
  }
}
