import { TASK_DESCRIPTION_DISPLAY_MAX_LENGTH } from './constants.js';
import { taskIdentity } from './observedTasks.js';
import type { RuntimeModelObservation, RuntimeModelSource } from './types.js';

const text = (value: unknown, max = 160): string =>
  typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '';
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const basename = (value: unknown) => text(typeof value === 'string' ? value.split(/[\\/]/).at(-1) : '', 80);
const sourceTimestamp = (value: unknown): number | undefined => {
  const timestamp = text(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)) {
    return undefined;
  }
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Normalized, sanitized activity shared by source adapters and ActivityLifecycle.
 * Producers may construct this contract directly; CLI envelopes are only one adapter input.
 * Raw prompts, arguments/results and unknown envelope fields are not part of this contract.
 */
export interface LiveEvent {
  type: string;
  activityAt?: number;
  toolCallId: string;
  parentToolCallId: string;
  toolName: string;
  squad: boolean;
  agentScoped: boolean;
  agentInstanceId: string;
  instanceId?: string;
  selectedAgentName?: string;
  modelObservation?: RuntimeModelObservation;
  identityOmitted?: boolean;
  task?: { name: string; agent_type: string; mode: string; description: string; fieldsTruncated?: boolean };
  file?: string;
  command?: string;
  context?: { contextTokens: number; maxContextTokens: number };
}

/**
 * Project supported event-envelope fields without discovery, I/O or a JSONL dependency.
 * Adapters supply a record in this shape; raw records and unknown fields are not retained.
 * Source timestamps and model provenance are preserved, not replaced with an ingestion clock.
 */
export function projectActivityEvent(value: unknown): LiveEvent | null {
  const envelope = object(value);
  const data = object(envelope.data);
  const type = text(envelope.type);
  if (!['subagent.selected', 'subagent.started', 'subagent.completed', 'subagent.failed',
    'subagent.aborted', 'subagent.configured', 'tool.execution_start', 'tool.execution_complete',
    'assistant.message', 'session.start', 'session.resume', 'session.model_change',
    'session.model_deselected', 'session.shutdown'].includes(type)) {return null;}
  const toolName = text(data.toolName, 80).replace(/[^a-zA-Z0-9_.-]/g, '');
  const event: LiveEvent = {
    type, toolName, toolCallId: taskIdentity(data.toolCallId), parentToolCallId: taskIdentity(data.parentToolCallId),
    squad: type === 'subagent.selected' && !envelope.agentId && data.agentName === 'Squad',
    agentScoped: Object.hasOwn(envelope, 'agentId') && envelope.agentId !== null && envelope.agentId !== undefined,
    agentInstanceId: taskIdentity(envelope.agentId),
  };
  event.activityAt = sourceTimestamp(envelope.timestamp);
  event.instanceId = taskIdentity(envelope.agentId) || undefined;
  if (type === 'subagent.selected' && event.instanceId) {
    event.selectedAgentName = taskIdentity(data.agentName) || undefined;
  }
  if (type === 'subagent.completed' && data.cancelled === true) { event.type = 'subagent.aborted'; }
  const callBearing = ['subagent.started', 'subagent.completed', 'subagent.failed', 'subagent.aborted',
    'tool.execution_start', 'tool.execution_complete'].includes(type);
  event.identityOmitted = (callBearing && (!event.toolCallId
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
  if (envelope.ephemeral !== true) {
    const modelFields: Record<string, {
      key: string; kind: RuntimeModelObservation['kind']; source: RuntimeModelSource;
    }> = {
      'session.start': { key: 'selectedModel', kind: 'session-selection', source: 'session.start.selectedModel' },
      'session.resume': { key: 'selectedModel', kind: 'session-selection', source: 'session.resume.selectedModel' },
      'session.model_change': { key: 'newModel', kind: 'session-selection', source: 'session.model_change.newModel' },
      'assistant.message': { key: 'model', kind: 'assistant-message', source: 'assistant.message.model' },
      'subagent.started': { key: 'model', kind: 'subagent-model', source: 'subagent.started.model' },
      'subagent.configured': { key: 'model', kind: 'subagent-model', source: 'subagent.configured.model' },
      'tool.execution_complete': { key: 'model', kind: 'tool-call', source: 'tool.execution_complete.model' },
    };
    const modelField = modelFields[type];
    if (modelField) {
      const model = data[modelField.key];
      const timestamp = text(envelope.timestamp, 40);
      if (typeof model === 'string' && model.trim().length > 0 && model.length <= 160
        && !/[\x00-\x1f\x7f]/.test(model)
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
        && Number.isFinite(Date.parse(timestamp))) {
        event.modelObservation = {
          model: model.trim(), kind: modelField.kind, source: modelField.source, timestamp,
        };
      }
    }
  }
  return event;
}
