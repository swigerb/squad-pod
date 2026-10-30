import type { OutboundMessage } from '../../src/types.js';
import { isValidLayout } from '../../src/layoutValidation.js';
import { MAX_OBSERVED_TASKS, taskIdentity } from '../../src/observedTasks.js';
import { TASK_DESCRIPTION_DISPLAY_MAX_LENGTH } from '../../src/constants.js';

type Check = (value: unknown) => boolean;
const text: Check = v => typeof v === 'string' && v.length <= 8192;
const short: Check = v => typeof v === 'string' && v.length <= 256;
const number: Check = v => typeof v === 'number' && Number.isFinite(v);
const integer: Check = v => number(v) && Number.isSafeInteger(v) && (v as number) >= 0;
const boolean: Check = v => typeof v === 'boolean';
const nullable = (check: Check): Check => v => v === null || check(v);
const optional = (check: Check): Check => v => v === undefined || check(v);
const array = (check: Check, max: number): Check => v => Array.isArray(v) && v.length <= max && v.every(check);
const oneOf = (...values: unknown[]): Check => v => values.includes(v);
function object(fields: Record<string, Check>): Check {
  return v => !!v && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).every(key => Object.hasOwn(fields, key))
    && Object.entries(fields).every(([key, check]) => check(Reflect.get(v, key)));
}
const dictionary = (check: Check, max: number): Check => v => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length <= max && Object.keys(v).every(key => key.length <= 8192)
  && Object.values(v).every(check);
const color = object({ h: number, s: number, b: number, c: number, colorize: optional(boolean) });
const sprite = array(array(v => typeof v === 'string' && /^(?:|#[\da-f]{6}(?:[\da-f]{2})?)$/i.test(v), 512), 512);
const layout: Check = v => isValidLayout(v) && object({
  version: optional(integer), cols: integer, rows: integer, tiles: array(v => integer(v) && (v as number) <= 10, 65536),
  furniture: array(object({
    uid: short, type: short, col: integer, row: integer, rotation: optional(number), color: optional(color),
    assetFootprint: optional(object({ width: integer, height: integer })),
    assetRole: optional(oneOf('desk', 'seat')), state: optional(short),
  }), 4096),
  tileColors: optional(dictionary(color, 65536)),
  carpetTiles: optional(array(nullable(object({
    variant: integer, color: optional(color), accentColor: optional(color), order: optional(number),
  })), 65536)),
  pets: optional(array(object({ id: short, petType: integer }), 32)),
  areas: optional(array(object({ label: short, color: short }), 100)),
  areaTiles: optional(array(nullable(short), 65536)),
  areaMappings: optional(dictionary(array(short, 100), 500)),
})(v);
export const isObserverLayout = layout;
const agent = {
  id: short, name: short, role: short, paletteIndex: integer, seatId: nullable(short),
  status: oneOf('active', 'idle', 'waiting'), currentTask: nullable(text),
  currentTaskSource: optional(nullable(oneOf('file', 'live'))),
};
const runtimeModel = object({
  model: v => typeof v === 'string' && v.length > 0 && v.length <= 160
    && v.trim() === v && !/[\x00-\x1f\x7f]/.test(v),
  kind: oneOf('session-selection', 'assistant-message', 'tool-call', 'subagent-model'),
  source: oneOf('session.start.selectedModel', 'session.resume.selectedModel', 'session.model_change.newModel',
    'assistant.message.model', 'tool.execution_complete.model', 'subagent.started.model', 'subagent.configured.model'),
  timestamp: v => typeof v === 'string' && v.length <= 40
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)
    && Number.isFinite(Date.parse(v)),
});
const schemas: Record<string, Check> = {
  liveModels: object({ type: oneOf('liveModels'), snapshot: object({
    sessionId: nullable(v => typeof v === 'string' && /^[a-zA-Z0-9-]{1,8}$/.test(v)),
    session: nullable(runtimeModel),
    members: v => dictionary(runtimeModel, 2048)(v)
      && Object.keys(v as object).every(key => key.length <= 256),
  }) }),
  agentToolStart: object({
    type: oneOf('agentToolStart'), agentId: short, tool: short,
    toolId: v => !!taskIdentity(v), status: short,
  }),
  agentToolDone: object({
    type: oneOf('agentToolDone'), agentId: short, tool: short, toolId: v => !!taskIdentity(v),
  }),
  agentToolsClear: object({ type: oneOf('agentToolsClear'), agentId: short }),
  agentContextUsage: object({
    type: oneOf('agentContextUsage'), agentId: short,
    contextTokens: nullable(v => number(v) && (v as number) >= 0),
    maxContextTokens: nullable(v => number(v) && (v as number) > 0),
  }),
  observedTasks: object({ type: oneOf('observedTasks'), snapshot: object({
    sessionId: nullable(short), limited: boolean, tasks: array(object({
      sessionId: short, toolCallId: v => !!taskIdentity(v),
      parentToolCallId: nullable(v => !!taskIdentity(v)),
      name: short, agentType: short, mode: short,
      description: v => typeof v === 'string' && v.length <= TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
      agentId: nullable(short), state: oneOf('observed', 'running', 'completed', 'failed', 'aborted'),
      instanceId: optional(v => !!taskIdentity(v)),
      selectedAgentName: optional(v => !!taskIdentity(v)),
      fieldsTruncated: boolean,
    }), MAX_OBSERVED_TASKS),
  }) }),
  telemetryEvent: object({ type: oneOf('telemetryEvent'), event: object({
    id: short, timestamp: number, category: oneOf('status'),
    agentId: nullable(short), agentName: nullable(short), summary: short, detail: oneOf(null),
  }) }),
  settingsLoaded: object({ type: oneOf('settingsLoaded'), soundEnabled: boolean, debugEnabled: boolean, showAreas: boolean }),
  sourceStatus: object({ type: oneOf('sourceStatus'), status: object({
    workspaceRoot: nullable(text), squadDir: nullable(text), teamFound: boolean,
    observer: oneOf('watching', 'stopped'), nativeWatch: boolean, error: nullable(text),
    liveActivity: optional(object({
      state: oneOf('off', 'searching', 'following', 'error'), sessionId: nullable(short),
      selection: optional(oneOf('owned-session', 'matching-project', 'unavailable')), reason: optional(text),
    })),
  }) }),
  layoutLoaded: object({
    type: oneOf('layoutLoaded'), layout, revision: nullable(text), workspaceRoot: text,
    source: optional(oneOf('external', 'import')),
  }),
  layoutSaved: object({ type: oneOf('layoutSaved'), layout, revision: nullable(text) }),
  layoutError: object({ type: oneOf('layoutError'), error: text, source: optional(oneOf('watcher')) }),
  existingAgents: object({ type: oneOf('existingAgents'), agents: array(object(agent), 128) }),
  agentDetailLoaded: object({ type: oneOf('agentDetailLoaded'), requestId: optional(short), detail: object({
    id: short, name: short, role: short, workspaceRoot: text, status: agent.status, currentTask: nullable(text),
    currentTaskSource: agent.currentTaskSource,
    charterSummary: nullable(text), charterContent: nullable(text),
    charterStatus: oneOf('available', 'missing', 'unreadable', 'unavailable'),
    expertise: nullable(text), responsibilities: nullable(text), boundaries: nullable(text),
    recentActivity: array(text, 20), lastActiveAt: integer,
    lastActiveAtStatus: oneOf('unobserved', 'available', 'clock-skew'),
  }) }),
  recordedUsage: object({ type: oneOf('recordedUsage'), snapshot: object({
    state: oneOf('unavailable', 'missing', 'ready', 'partial', 'error'), sourcePath: nullable(text),
    diagnostic: nullable(text), checkedAt: short, lastRecordAt: nullable(short), lastUsageAt: nullable(short),
    invalidLines: integer, unsupportedLines: integer, pendingFinalLine: boolean, usageRecords: integer,
    attemptedTurns: integer, coveredTurns: integer, unlinkedUsageRecords: integer, normalizedValueRecords: integer,
    totals: nullable(object({ inputTokens: integer, outputTokens: integer, estimatedCost: number })),
    history: array(object({
      sessionId: text, turnId: nullable(text), agentName: nullable(short), rosterName: nullable(short),
      attribution: oneOf('roster-match', 'unattributed', 'ambiguous'), model: short,
      inputTokens: integer, outputTokens: integer, estimatedCost: number, timestamp: short,
    }), 40),
  }) }),
  manifestAssetsLoaded: object({ type: oneOf('manifestAssetsLoaded'), snapshot: object({
    furniture: array(object({
      type: short, label: short, width: integer, height: integer, sprite,
      isDesk: boolean, category: short, canPlaceOnSurfaces: boolean, canPlaceOnWalls: boolean,
      groupId: optional(short), groupType: optional(oneOf('rotation', 'state', 'animation')),
      rotationScheme: optional(oneOf('2-way', '3-way-mirror', '4-way')),
      orientation: optional(oneOf('front', 'back', 'side', 'left', 'right')),
      state: optional(oneOf('on', 'off')), frame: optional(integer), mirrorSide: optional(boolean),
    }), 128),
    floors: array(sprite, 128), walls: array(sprite, 128), carpets: array(array(sprite, 128), 128),
    pets: array(object({ id: short, name: short, petType: integer, sprite }), 128),
    directories: array(text, 1), diagnostics: array(text, 256),
  }) }),
};

/** Separate server-to-browser allowlist; never cast arbitrary JSON to the trusted office seam. */
export function decodeEvent(raw: string): OutboundMessage | { type: 'protocolError'; code: string } {
  if (new TextEncoder().encode(raw).byteLength > 8 * 1024 * 1024) throw new Error('Office frame exceeds limit.');
  const frame: unknown = JSON.parse(raw);
  if (object({ version: oneOf(1), kind: oneOf('error'), code: v => typeof v === 'string' && /^[A-Z_]{1,64}$/.test(v) })(frame)) {
    return { type: 'protocolError', code: Reflect.get(frame as object, 'code') as string };
  }
  if (!object({ version: oneOf(1), kind: oneOf('office'), message: v => {
    if (!v || typeof v !== 'object' || !('type' in v) || typeof v.type !== 'string') return false;
    return Object.hasOwn(schemas, v.type) && schemas[v.type](v);
  } })(frame)) throw new Error('Invalid server office frame.');
  return (frame as { message: OutboundMessage }).message;
}
