/**
 * agentManager.ts — Manage Squad agent lifecycle and webview synchronization.
 *
 * The Squad roster (`team.md`) is authoritative: every visible member gets a
 * persistent character whose palette and seat survive reloads. Activity
 * events from the watcher only change status; they never create or remove
 * characters, so a finished task cannot make a team member disappear.
 */

import type * as vscode from 'vscode';
import type { SquadAgentState, SquadTeamMember, PersistedAgentMeta, OutboundMessage, TelemetryEvent } from './types.js';
import {
  WORKSPACE_KEY_AGENTS,
  WORKSPACE_KEY_AGENT_SEATS,
  ACTIVITY_TIMEOUT_MS,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from './constants.js';
import { readTeamRoster } from './teamParser.js';
import { resetActivityTimer, cancelActivityTimer, cancelAllTimers } from './timerManager.js';
import { resolveFileAgentId } from './core/agentIdentity.js';
export { slugify } from './core/agentIdentity.js';

export type AgentStatus = SquadAgentState['status'];

// ─── Module State ───────────────────────────────────────────────────

let agents = new Map<string, SquadAgentState>();
let disposed = false;
let telemetryCounter = 0;
const liveRuns = new Set<string>();

/** Live lifecycle owns status until completion or the session reader falls back. */
export function setLiveAgentStatus(agentId: string, active: boolean, task: string | null, webview: vscode.Webview): void {
  if (!active) {liveRuns.delete(agentId);}
  const agent = agents.get(agentId);
  if (!agent) {return;}
  cancelActivityTimer(agentId);
  if (active) {
    liveRuns.add(agentId);
    agent.status = 'active';
    agent.currentTask = task;
    agent.currentTaskSource = task ? 'live' : null;
    agent.lastActiveAt = Date.now();
    postToWebview(webview, { type: 'agentToolsClear', agentId });
    postToWebview(webview, {
      type: 'agentStatus', agentId, status: 'active',
      currentTask: agent.currentTask, currentTaskSource: agent.currentTaskSource,
    });
  } else {
    liveRuns.delete(agentId);
    updateAgentStatus(agentId, 'idle', null, webview);
  }
}

export function isLiveAgent(agentId: string): boolean {
  const resolved = resolveAgentId(agentId);
  return resolved !== null && liveRuns.has(resolved);
}

let externalCharacterPalettes: number[] = [];

/** Only future, unpersisted roster members use newly available sheets. */
export function setExternalCharacterPalettes(palettes: number[]): void {
  externalCharacterPalettes = [...palettes].sort((a, b) => a - b);
}

function directoryIdentityFields(directoryIds?: readonly string[]): {
  directoryId?: string;
  directoryMappingIds?: string[];
} {
  const uniqueIds = [...new Set(directoryIds ?? [])];
  if (!uniqueIds.length) { return {}; }
  return { directoryId: uniqueIds[0], directoryMappingIds: uniqueIds };
}

function makeTelemetryEvent(
  category: TelemetryEvent['category'],
  agentId: string | null,
  agentName: string | null,
  summary: string,
  detail: string | null = null,
): TelemetryEvent {
  return {
    id: `tel-${Date.now()}-${++telemetryCounter}`,
    timestamp: Date.now(),
    category,
    agentId,
    agentName,
    summary,
    detail,
  };
}

// ─── Identity ───────────────────────────────────────────────────────

/**
 * Map a name or slug seen in Squad files to a roster agent ID.
 *
 * Squad writes agents as their cast slug (`lisa-simpson`), display name
 * (`Lisa Simpson`), first name (`Lisa`), or a slug followed by a suffix
 * (`lisa-simpson-review`). Ambiguous first names resolve to nothing rather
 * than animating the wrong character.
 */
export function resolveAgentId(
  raw: string,
  roster: ReadonlyMap<string, Pick<SquadAgentState, 'id' | 'name'>> = agents,
): string | null {
  return resolveFileAgentId(raw, roster);
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Read the roster and build agent state, restoring persisted palette and
 * seat assignments. Nothing is posted here: the caller sends a single
 * `existingAgents` snapshot so the webview never sees duplicate creates.
 */
export function initializeAgents(
  workspaceRoot: string,
  context: vscode.ExtensionContext,
  _webview?: vscode.Webview,
): Map<string, SquadAgentState> {
  const members = readTeamRoster(workspaceRoot);
  const persisted = loadPersistedMeta(context);
  const previous = agents;

  cancelAllTimers();
  agents = new Map();
  disposed = false;

  // Members with a saved appearance claim it first so new members never collide.
  const ordered = [...members].sort(
    (a, b) => Number(persisted[b.slug]?.palette !== undefined) - Number(persisted[a.slug]?.palette !== undefined),
  );
  ordered.forEach((member, index) => {
    const state = memberToState(member, index, persisted, usedPalettes());
    const prior = previous.get(state.id);
    if (prior) {
      state.status = prior.status;
      state.currentTask = prior.currentTask;
      state.currentTaskSource = prior.currentTaskSource;
      state.lastActiveAt = prior.lastActiveAt;
    }
    agents.set(state.id, state);
  });

  persistAgentMeta(agents, context);
  return agents;
}

/**
 * Re-read the roster: add new members, remove departed ones, and update
 * name/role changes for existing members.
 */
export function refreshAgents(
  workspaceRoot: string,
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  directoryIds?: readonly string[],
): Map<string, SquadAgentState> {
  const members = readTeamRoster(workspaceRoot);
  const persisted = loadPersistedMeta(context);
  const newIds = new Set(members.map(m => m.slug));

  for (const id of Array.from(agents.keys())) {
    if (!newIds.has(id)) {
      cancelActivityTimer(id);
      agents.delete(id);
      postToWebview(webview, { type: 'agentClosed', agentId: id });
    }
  }

  members.forEach((member, index) => {
    const existing = agents.get(member.slug);
    if (existing) {
      existing.name = member.name;
      existing.role = member.role;
      return;
    }
    const state = memberToState(member, index, persisted, usedPalettes());
    agents.set(state.id, state);
    postToWebview(webview, {
      type: 'agentCreated',
      agent: {
        id: state.id,
        name: state.name,
        role: state.role,
        paletteIndex: state.paletteIndex,
        seatId: state.seatId,
        ...directoryIdentityFields(directoryIds),
      },
    });
  });

  persistAgentMeta(agents, context);
  return agents;
}

/**
 * Update an agent's status and current task, then notify the webview.
 *
 * Every `active` event restarts the idle countdown, so an agent that keeps
 * producing activity stays active instead of timing out mid-task.
 */
export function updateAgentStatus(
  rawAgentId: string,
  status: AgentStatus,
  task: string | null,
  webview: vscode.Webview,
): void {
  const agentId = resolveAgentId(rawAgentId);
  const agent = agentId ? agents.get(agentId) : undefined;
  if (agentId && liveRuns.has(agentId)) {return;}
  if (!agentId || !agent) {
    return;
  }

  const prevStatus = agent.status;
  const prevTask = agent.currentTask;
  const prevSource = agent.currentTaskSource;
  agent.status = status;
  agent.lastActiveAt = Date.now();
  agent.currentTask = status !== 'idle' && task ? truncateTask(task) || null : null;
  agent.currentTaskSource = agent.currentTask ? 'file' : null;
  const statusChanged = prevStatus !== status;
  const taskChanged = prevTask !== agent.currentTask || prevSource !== agent.currentTaskSource;

  if (statusChanged || taskChanged) {
    postToWebview(webview, {
      type: 'agentStatus', agentId, status,
      currentTask: agent.currentTask, currentTaskSource: agent.currentTaskSource,
    });
  }

  if (statusChanged || taskChanged) {
    const statusLabel = status === 'active' ? 'became active' : status === 'waiting' ? 'is waiting for input' : 'went idle';
    const taskSuffix = agent.currentTask ? ` (file activity hint): ${agent.currentTask}` : '';
    postToWebview(webview, {
      type: 'telemetryEvent',
      event: makeTelemetryEvent('status', agentId, agent.name, `${agent.name} ${statusLabel}${taskSuffix}`),
    });
  }

  if (status === 'active') {
    if (statusChanged || taskChanged) {
      if (prevStatus === 'waiting') {
        postToWebview(webview, { type: 'agentToolPermissionClear', agentId });
      }
      postToWebview(webview, { type: 'agentToolsClear', agentId });
      postToWebview(webview, {
        type: 'agentToolStart',
        agentId,
        tool: agent.currentTask ?? 'working',
        status: agent.currentTask ? `File activity hint: ${agent.currentTask}` : 'File activity observed',
      });
    }
    resetActivityTimer(agentId, ACTIVITY_TIMEOUT_MS, () => {
      updateAgentStatus(agentId, 'idle', null, webview);
    });
    return;
  }

  cancelActivityTimer(agentId);

  if (status === 'idle' && statusChanged) {
    postToWebview(webview, { type: 'agentToolDone', agentId, tool: prevTask ?? 'working' });
    postToWebview(webview, { type: 'agentToolsClear', agentId });
  }
}

/**
 * Send the full roster snapshot. The webview reconciles against it, so it
 * is safe to send on every (re)connect and after roster changes.
 */
export function sendExistingAgents(
  agentMap: Map<string, SquadAgentState>,
  _context: vscode.ExtensionContext | undefined,
  webview: vscode.Webview,
  directoryIds?: readonly string[],
): void {
  const agentArray = Array.from(agentMap.values()).map(a => ({
    id: a.id,
    name: a.name,
    role: a.role,
    paletteIndex: a.paletteIndex,
    seatId: a.seatId,
    ...directoryIdentityFields(directoryIds),
    status: a.status,
    currentTask: a.currentTask,
    currentTaskSource: a.currentTaskSource,
  }));

  postToWebview(webview, { type: 'existingAgents', agents: agentArray });
}

/**
 * Persist agent palette/seat assignments so they survive restarts.
 */
export function persistAgentMeta(
  agentMap: Map<string, SquadAgentState>,
  context: vscode.ExtensionContext,
): void {
  const meta: PersistedAgentMeta = { ...loadPersistedMeta(context) };
  for (const [id, agent] of agentMap) {
    meta[id] = {
      palette: agent.paletteIndex,
      seatId: agent.seatId ?? undefined,
    };
  }
  void context.workspaceState.update(WORKSPACE_KEY_AGENTS, meta);
}

/**
 * Save the complete seat map from the webview. Agents missing from the map
 * have no seat.
 */
export function saveAgentSeats(
  seatAssignments: Record<string, string | null>,
  context: vscode.ExtensionContext,
): void {
  const clean: Record<string, string> = {};
  for (const agent of agents.values()) {
    const seatId = seatAssignments[agent.id];
    agent.seatId = typeof seatId === 'string' && seatId ? seatId : null;
    if (agent.seatId) {
      clean[agent.id] = agent.seatId;
    }
  }
  void context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, clean);
  persistAgentMeta(agents, context);
}

/** Current agents map (for external access). */
export function getAgents(): Map<string, SquadAgentState> {
  return agents;
}

/** Clean up all timers (call on view disposal or deactivation). */
export function disposeAgentManager(): void {
  disposed = true;
  liveRuns.clear();
  cancelAllTimers();
  agents.clear();
  externalCharacterPalettes = [];
}

// ─── Internal Helpers ───────────────────────────────────────────────

function usedPalettes(): Set<number> {
  return new Set(Array.from(agents.values()).map(a => a.paletteIndex));
}

function memberToState(
  member: SquadTeamMember,
  rosterIndex: number,
  persisted: PersistedAgentMeta,
  taken?: Set<number>,
): SquadAgentState {
  const id = member.slug;
  const savedMeta = persisted[id];
  // Appearance index: the webview derives sprite palette (index % 6) and hue
  // shift (index / 6) from it, so every client renders the same look.
  let paletteIndex = savedMeta?.palette;
  if (paletteIndex === undefined || taken?.has(paletteIndex)) {
    paletteIndex = externalCharacterPalettes.find((palette) => !taken?.has(palette)) ?? (taken ? 0 : rosterIndex);
    while (taken?.has(paletteIndex)) {
      paletteIndex++;
    }
  }

  return {
    id,
    name: member.name,
    role: member.role,
    paletteIndex,
    seatId: savedMeta?.seatId ?? null,
    status: 'idle',
    currentTask: null,
    currentTaskSource: null,
    lastActiveAt: Date.now(),
  };
}

function loadPersistedMeta(context: vscode.ExtensionContext): PersistedAgentMeta {
  const meta = context.workspaceState.get<PersistedAgentMeta>(WORKSPACE_KEY_AGENTS) ?? {};
  const seats = context.workspaceState.get<Record<string, string>>(WORKSPACE_KEY_AGENT_SEATS) ?? {};
  const merged: PersistedAgentMeta = {};
  for (const [id, value] of Object.entries(meta)) {
    merged[id] = { ...value };
  }
  for (const [id, seatId] of Object.entries(seats)) {
    if (typeof seatId === 'string' && !merged[id]?.seatId) {
      merged[id] = { ...merged[id], seatId };
    }
  }
  return merged;
}

function truncateTask(task: string): string {
  const oneLine = task.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) {
    return oneLine;
  }
  return oneLine.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH - 3) + '...';
}

function postToWebview(webview: vscode.Webview, message: OutboundMessage): void {
  if (disposed) { return; }
  void webview.postMessage(message);
}
