import * as fs from 'node:fs';
import * as path from 'node:path';
import { TASK_DESCRIPTION_DISPLAY_MAX_LENGTH } from './constants.js';
import { sameDirectoryPath } from './directories.js';
import { listCopilotSessions, readSessionCwd, resolveCopilotHome } from './copilotSessionState.js';
import type { LiveSourceStatus, OutboundMessage } from './types.js';
import { ObservedTasks, taskIdentity } from './observedTasks.js';

export const LIVE_STALE_MS = 5 * 60_000;
export const SEED_BYTES = 2 * 1024 * 1024;
export const MAX_LINE_BYTES = 64 * 1024;
const MAX_TRACKED = 2048;
const text = (value: unknown, max = 160): string =>
  typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '';
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const basename = (value: unknown) => text(typeof value === 'string' ? value.split(/[\\/]/).at(-1) : '', 80);

export interface LiveEvent {
  type: string;
  toolCallId: string;
  parentToolCallId: string;
  toolName: string;
  squad: boolean;
  instanceId?: string;
  selectedAgentName?: string;
  identityOmitted?: boolean;
  task?: { name: string; agent_type: string; mode: string; description: string; fieldsTruncated?: boolean };
  file?: string;
  command?: string;
  context?: { contextTokens: number; maxContextTokens: number };
}

/** Project the undocumented envelope immediately; raw records never leave this function. */
export function parseLiveEvent(line: string): LiveEvent | null {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  const envelope = object(value);
  const data = object(envelope.data);
  const type = text(envelope.type);
  if (!['subagent.selected', 'subagent.started', 'subagent.completed', 'subagent.failed',
    'subagent.aborted', 'tool.execution_start', 'tool.execution_complete'].includes(type)) {return null;}
  const toolName = text(data.toolName, 80).replace(/[^a-zA-Z0-9_.-]/g, '');
  const event: LiveEvent = {
    type, toolName, toolCallId: taskIdentity(data.toolCallId), parentToolCallId: taskIdentity(data.parentToolCallId),
    squad: type === 'subagent.selected' && !envelope.agentId && data.agentName === 'Squad',
  };
  event.instanceId = taskIdentity(envelope.agentId) || undefined;
  if (type === 'subagent.selected' && event.instanceId) {
    event.selectedAgentName = taskIdentity(data.agentName) || undefined;
  }
  if (type === 'subagent.completed' && data.cancelled === true) { event.type = 'subagent.aborted'; }
  event.identityOmitted = (type !== 'subagent.selected' && (!event.toolCallId
    || (data.parentToolCallId !== undefined && data.parentToolCallId !== null && !event.parentToolCallId)))
    || (envelope.agentId !== undefined && envelope.agentId !== null && !event.instanceId)
    || (type === 'subagent.selected' && !!event.instanceId && !event.selectedAgentName);
  if (type === 'tool.execution_start') {
    const args = object(data.arguments);
    if (toolName === 'task') {
      event.task = {
        name: typeof args.name === 'string' && args.name.length <= 160 ? args.name : '',
        agent_type: typeof args.agent_type === 'string' ? args.agent_type.slice(0, 160) : '', mode: text(args.mode),
        description: text(args.description, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH),
        fieldsTruncated: ([['name', 160], ['agent_type', 160], ['mode', 160],
          ['description', TASK_DESCRIPTION_DISPLAY_MAX_LENGTH]] as const).some(([key, max]) =>
          typeof args[key] === 'string' && args[key].length > Number(max)),
      };
    } else if (['view', 'edit', 'create'].includes(toolName)) {
      event.file = basename(args.path);
    } else if (['powershell', 'bash'].includes(toolName)) {
      // Only the first token, including quoted executable paths; never flags or script bodies.
      const command = typeof args.command === 'string' ? args.command : '';
      const first = /^\s*(?:"([^"]+)"|'([^']+)'|([^\s;|&]+))/.exec(command);
      const token = first?.[1] ?? first?.[2] ?? first?.[3] ?? '';
      const name = basename(token);
      const quotedPowerShellExpression = toolName === 'powershell' && /^\s*["']/.test(command);
      event.command = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(name)
        && !/[=$()`{}[\];|&<>]/.test(token) && !quotedPowerShellExpression ? name : '';
    }
  }
  const metrics = object(object(data.toolTelemetry).metrics);
  const current = metrics.context_current_tokens;
  const limit = metrics.context_token_limit;
  if (type === 'tool.execution_complete' && typeof current === 'number' && Number.isFinite(current)
    && current >= 0 && typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    event.context = { contextTokens: current, maxContextTokens: limit };
  }
  return event;
}

export function liveToolLabel(event: LiveEvent): string {
  const labels: Record<string, string> = {
    view: `Reading ${event.file || 'file'}`, edit: `Editing ${event.file || 'file'}`,
    create: `Writing ${event.file || 'file'}`, powershell: `Running: ${event.command || 'shell'}`,
    bash: `Running: ${event.command || 'shell'}`, grep: 'Searching', glob: 'Searching',
    web_fetch: 'Fetching', web_search: 'Searching', task: 'Subtask',
  };
  return (labels[event.toolName] ?? event.toolName).slice(0, 30) || 'Tool';
}

export function exactLiveAgent(name: string, roster: readonly { id: string; folder?: string }[]): string | null {
  const key = name.toLowerCase();
  const matches = roster.filter(member => member.id.toLowerCase() === key || member.folder?.toLowerCase() === key);
  return key && matches.length === 1 ? matches[0].id : null;
}

function openEventFile(file: string): { fd: number; stat: fs.Stats } {
  const metadata = fs.lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) { throw new Error('Unsupported live event file'); }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0) | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    // Windows lstat can report an unknown (zero) volume ID while fstat supplies it.
    const differentDevice = metadata.dev !== 0 && stat.dev !== 0 && stat.dev !== metadata.dev;
    if (!stat.isFile() || differentDevice || stat.ino !== metadata.ino) {
      throw new Error('Live event file changed during open');
    }
    return { fd, stat };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

/** Fixed-size reads and bounded line carry, including when a single line is gigabytes long. */
export class EventTail {
  private offset = 0;
  private carry = Buffer.alloc(0);
  private skipping = false;
  private identity = '';
  reset = false;
  limited = false;

  read(file: string, emit: (event: LiveEvent) => void): fs.Stats {
    const { fd, stat } = openEventFile(file);
    try {
      const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      this.reset = this.identity !== identity || stat.size < this.offset;
      if (this.reset) {
        this.identity = identity;
        this.offset = Math.max(0, stat.size - SEED_BYTES);
        this.carry = Buffer.alloc(0);
        this.skipping = this.offset > 0;
        this.limited = this.skipping;
      }
      const end = Math.min(stat.size, this.offset + SEED_BYTES);
      const buffer = Buffer.alloc(MAX_LINE_BYTES);
      while (this.offset < end) {
        const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, end - this.offset), this.offset);
        if (!count) {break;}
        this.offset += count;
        let start = 0;
        for (let i = 0; i < count; i++) {
          if (buffer[i] !== 10) {continue;}
          this.consume(buffer.subarray(start, i), true, emit);
          start = i + 1;
        }
        this.consume(buffer.subarray(start, count), false, emit);
      }
      return stat;
    } finally { fs.closeSync(fd); }
  }

  private consume(part: Buffer, newline: boolean, emit: (event: LiveEvent) => void): void {
    if (this.carry.length + part.length > MAX_LINE_BYTES) {
      this.limited = true;
      this.carry = Buffer.alloc(0);
      this.skipping = true;
    }
    if (!this.skipping) {
      this.carry = Buffer.concat([this.carry, part]);
      if (newline) {
        const event = parseLiveEvent(this.carry.toString('utf8'));
        if (event) {emit(event);}
      }
    }
    if (newline) {
      this.carry = Buffer.alloc(0);
      this.skipping = false;
    }
  }
}

function isSquadSession(file: string): boolean {
  const { fd, stat } = openEventFile(file);
  try {
    const size = stat.size;
    // Both scans are bounded. The head preserves a marker even after a long session.
    for (const offset of new Set([0, Math.max(0, size - MAX_LINE_BYTES)])) {
      const buffer = Buffer.alloc(Math.min(MAX_LINE_BYTES, size - offset));
      const count = fs.readSync(fd, buffer, 0, buffer.length, offset);
      const lines = buffer.subarray(0, count).toString('utf8').split('\n');
      if (offset > 0) {lines.shift();}
      if (lines.some(line => parseLiveEvent(line)?.squad)) {return true;}
    }
    return false;
  } finally { fs.closeSync(fd); }
}

interface ActivityOptions {
  workspaceRoot: string;
  copilotHome?: string;
  roster: () => readonly { id: string; folder?: string }[];
  post: (message: OutboundMessage) => void;
  lifecycle: (agentId: string, active: boolean, task: string | null) => void;
  status: (status: LiveSourceStatus) => void;
  now?: () => number;
}

export class CopilotSessionActivity {
  private enabled = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private home = '';
  private session: { id: string; dir: string } | undefined;
  private tail = new EventTail();
  private discoveryAt = -Infinity;
  private lastBytesAt = 0;
  private lastSize = -1;
  private stale = false;
  private tasks = new Map<string, { agentId: string; description: string; instanceId?: string }>();
  private runs = new Map<string, string>();
  private tools = new Map<string, { agentId: string; toolName: string; label: string }>();
  private gauge = new Map<string, NonNullable<LiveEvent['context']>>();
  private source: LiveSourceStatus = { state: 'off', sessionId: null };
  private counter = 0;
  private seeding = false;
  private observedTasks = new ObservedTasks();

  constructor(private options: ActivityOptions) {}

  start(): void {
    if (this.enabled) {return;}
    this.enabled = true;
    this.home = this.options.copilotHome ?? resolveCopilotHome();
    this.poll();
    this.timer = setInterval(() => this.poll(), 1000);
  }

  stop(): void {
    this.enabled = false;
    if (this.timer) {clearInterval(this.timer);}
    this.timer = undefined;
    this.clear();
    this.session = undefined;
    this.discoveryAt = -Infinity;
    this.stale = false;
    this.setSource('off');
  }

  replay(): void {
    // Validate the current source before replay; a reconnect must not revive stale state.
    if (this.enabled) { this.poll(); }
    this.replayCurrent();
  }

  private replayCurrent(): void {
    for (const [agentId, taskId] of this.runs) {
      this.options.lifecycle(agentId, true, this.tasks.get(taskId)?.description ?? null);
    }
    for (const [toolId, tool] of this.tools) {
      this.options.post({ type: 'agentToolStart', agentId: tool.agentId, toolId, tool: tool.toolName, status: tool.label });
    }
    for (const [agentId, context] of this.gauge) {this.options.post({ type: 'agentContextUsage', agentId, ...context });}
    this.options.status(this.source);
    this.publishTasks();
  }

  poll(): void {
    if (!this.enabled) {return;}
    const now = (this.options.now ?? Date.now)();
    try {
      if (now - this.discoveryAt >= 5000) {
        this.discoveryAt = now;
        const sessions = listCopilotSessions(this.home, { limit: 32 });
        const match = sessions.find(session => {
          const cwd = readSessionCwd(session.dir);
          if (!cwd || !sameDirectoryPath(cwd, this.options.workspaceRoot)) {return false;}
          try { return isSquadSession(path.join(session.dir, 'events.jsonl')); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {return false;}
            throw error;
          }
        });
        if (match?.id !== this.session?.id) {
          this.clear();
          this.session = match;
          this.tail = new EventTail();
          this.lastSize = -1;
          this.stale = false;
        }
      }
      if (!this.session) { this.setSource('searching'); return; }
      const file = path.join(this.session.dir, 'events.jsonl');
      const events: LiveEvent[] = [];
      let stat = this.tail.read(file, event => events.push(event));
      if (this.stale && (this.tail.reset || stat.size !== this.lastSize)) {
        this.tail = new EventTail();
        events.length = 0;
        stat = this.tail.read(file, event => events.push(event));
      }
      if (this.tail.reset || stat.size !== this.lastSize) {
        this.lastBytesAt = Math.min(now, stat.mtimeMs);
        this.lastSize = stat.size;
      }
      if (now - this.lastBytesAt >= LIVE_STALE_MS) {
        this.clear();
        this.stale = true;
        this.setSource('searching');
        return;
      }
      this.stale = false;
      if (this.tail.reset) {
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
        this.replayCurrent();
      } else {
        for (const event of events) {this.accept(event);}
      }
      this.setSource('following');
      this.publishTasks();
    } catch (error) {
      this.clear();
      this.session = undefined;
      this.stale = false;
      this.discoveryAt = -Infinity;
      this.setSource((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'searching' : 'error');
    }
  }

  private setSource(state: LiveSourceStatus['state']): void {
    this.source = { state, sessionId: this.session?.id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8) || null };
    this.options.status(this.source);
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

  private lifecycle(agentId: string, active: boolean, task: string | null): void {
    if (!this.seeding) { this.options.lifecycle(agentId, active, task); }
  }

  private accept(event: LiveEvent): void {
    const duplicateTask = !!event.task && this.observedTasks.has(event.toolCallId);
    const attribution = event.selectedAgentName
      ? exactLiveAgent(event.selectedAgentName, this.options.roster())
      : event.task?.agent_type === 'general-purpose'
        ? exactLiveAgent(event.task.name, this.options.roster()) : null;
    if (this.session) { this.observedTasks.accept(event, this.session.id, attribution); }
    if (event.selectedAgentName && event.instanceId) {
      for (const observed of this.observedTasks.snapshot(this.session?.id ?? null).tasks) {
        if (observed.instanceId !== event.instanceId || observed.state !== 'running') { continue; }
        const previous = this.tasks.get(observed.toolCallId);
        if (previous && previous.agentId !== observed.agentId) {
          if (this.runs.get(previous.agentId) === observed.toolCallId) { this.finish(previous.agentId); }
          this.tasks.delete(observed.toolCallId);
        }
        if (observed.agentId) {
          this.tasks.set(observed.toolCallId, { agentId: observed.agentId, description: observed.description,
            instanceId: observed.instanceId });
          this.startRun(observed.agentId, observed.toolCallId, observed.description);
        }
      }
    }
    if (!event.toolCallId || duplicateTask) {return;}
    if (event.type === 'tool.execution_start' && event.task?.agent_type === 'general-purpose') {
      const agentId = attribution;
      if (agentId && !this.tasks.has(event.toolCallId) && this.tasks.size < MAX_TRACKED) {
        this.tasks.set(event.toolCallId, { agentId, description: event.task.description });
      }
    }
    if (event.type === 'subagent.started' && !this.tasks.has(event.toolCallId)) {
      const observed = this.observedTasks.snapshot(this.session?.id ?? null).tasks
        .find(row => row.toolCallId === event.toolCallId);
      if (observed?.agentId && observed.state === 'running') {
        this.tasks.set(event.toolCallId, { agentId: observed.agentId, description: observed.description,
          instanceId: observed.instanceId });
      }
    }
    const task = this.tasks.get(event.toolCallId);
    if (event.type === 'subagent.started' && task) {
      task.instanceId = this.observedTasks.snapshot(this.session?.id ?? null).tasks
        .find(row => row.toolCallId === event.toolCallId)?.instanceId;
      this.startRun(task.agentId, event.toolCallId, task.description);
    } else if (['subagent.completed', 'subagent.failed', 'subagent.aborted'].includes(event.type)) {
      const instanceId = task?.instanceId ?? event.instanceId;
      for (const [id, ended] of this.tasks) {
        if (id !== event.toolCallId && (!instanceId || ended.instanceId !== instanceId)) { continue; }
        if (this.runs.get(ended.agentId) === id) { this.finish(ended.agentId); }
        this.tasks.delete(id);
      }
    } else if (event.type === 'tool.execution_start') {
      const parent = this.tasks.get(event.parentToolCallId);
      if (!parent || this.runs.get(parent.agentId) !== event.parentToolCallId || this.tools.size >= MAX_TRACKED) {return;}
      const label = liveToolLabel(event);
      this.tools.set(event.toolCallId, { agentId: parent.agentId, toolName: event.toolName, label });
      this.post({ type: 'agentToolStart', agentId: parent.agentId, toolId: event.toolCallId, tool: event.toolName, status: label });
      this.telemetry(parent.agentId, label);
    } else if (event.type === 'tool.execution_complete') {
      const tool = this.tools.get(event.toolCallId);
      if (!tool) {return;}
      this.post({ type: 'agentToolDone', agentId: tool.agentId, toolId: event.toolCallId, tool: tool.toolName });
      if (event.context) {
        this.gauge.set(tool.agentId, event.context);
        this.post({ type: 'agentContextUsage', agentId: tool.agentId, ...event.context });
      }
      this.tools.delete(event.toolCallId);
    }
  }

  private startRun(agentId: string, toolCallId: string, description: string): void {
    if (this.runs.get(agentId) === toolCallId) { return; }
    if (this.runs.has(agentId)) { this.clearDisplays(agentId); }
    this.runs.set(agentId, toolCallId);
    this.lifecycle(agentId, true, description);
    this.telemetry(agentId, 'Live member started');
  }

  private finish(agentId: string): void {
    this.runs.delete(agentId);
    this.clearDisplays(agentId);
    this.lifecycle(agentId, false, null);
    this.telemetry(agentId, 'Live member finished');
  }

  private clearDisplays(agentId: string): void {
    this.gauge.delete(agentId);
    for (const [id, tool] of this.tools) {
      if (tool.agentId === agentId) { this.tools.delete(id); }
    }
    this.post({ type: 'agentToolsClear', agentId });
    this.post({ type: 'agentContextUsage', agentId, contextTokens: null, maxContextTokens: null });
  }

  private clear(): void {
    for (const id of this.runs.keys()) {this.finish(id);}
    this.tasks.clear();
    this.tools.clear();
    this.gauge.clear();
    this.observedTasks.clear();
    this.post({ type: 'observedTasks', snapshot: { sessionId: null, tasks: [], limited: false } });
  }

  private publishTasks(): void {
    this.post({ type: 'observedTasks',
      snapshot: this.observedTasks.snapshot(this.session?.id ?? null, this.tail.limited) });
  }
}
