/**
 * agentManager.ts — Manage Squad agent lifecycle and webview synchronization.
 *
 * Reads the team roster, creates SquadAgentState objects, assigns deterministic
 * palette indices and seats, persists metadata, and pushes updates to the
 * webview via postMessage.
 */

import type * as vscode from 'vscode';
import type { SquadAgentState, SquadTeamMember, PersistedAgentMeta, OutboundMessage, TelemetryEvent } from './types.js';
import {
  CHAR_COUNT,
  WORKSPACE_KEY_AGENTS,
  WORKSPACE_KEY_AGENT_SEATS,
  ACTIVITY_TIMEOUT_MS,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from './constants.js';
import { readTeamRoster } from './teamParser.js';
import { resetActivityTimer, cancelAllTimers } from './timerManager.js';

// ─── Module State ───────────────────────────────────────────────────

let agents = new Map<string, SquadAgentState>();
let disposed = false;
let telemetryCounter = 0;

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

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Read the team roster from disk, create an agent state for each visible
 * member, restore persisted palette/seat assignments, and send `agentCreated`
 * messages to the webview.
 */
export function initializeAgents(
  workspaceRoot: string,
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
): Map<string, SquadAgentState> {
  const members = readTeamRoster(workspaceRoot);
  const persisted = loadPersistedMeta(context);

  agents = new Map();
  disposed = false;

  members.forEach((member, index) => {
    const state = memberToState(member, index, persisted);
    agents.set(state.id, state);
  });

  // Send each agent to the webview
  for (const agent of agents.values()) {
    postToWebview(webview, {
      type: 'agentCreated',
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        paletteIndex: agent.paletteIndex,
      },
    });
  }

  return agents;
}

/**
 * Refresh agents from the roster. Adds new members, removes departed ones,
 * and notifies the webview accordingly.
 */
export function refreshAgents(
  workspaceRoot: string,
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
): Map<string, SquadAgentState> {
  const members = readTeamRoster(workspaceRoot);
  const persisted = loadPersistedMeta(context);
  const currentIds = new Set(agents.keys());
  const newIds = new Set(members.map(m => memberSlug(m)));

  // Remove agents that are no longer on the roster
  for (const id of currentIds) {
    if (!newIds.has(id)) {
      agents.delete(id);
      postToWebview(webview, { type: 'agentClosed', agentId: id });
    }
  }

  // Add or update agents
  members.forEach((member, index) => {
    const slug = memberSlug(member);
    if (!agents.has(slug)) {
      const state = memberToState(member, index, persisted);
      agents.set(state.id, state);
      postToWebview(webview, {
        type: 'agentCreated',
        agent: {
          id: state.id,
          name: state.name,
          role: state.role,
          paletteIndex: state.paletteIndex,
        },
      });
    }
  });

  return agents;
}

/**
 * Update a single agent's status and current task, then notify the webview.
 */
export function updateAgentStatus(
  agentId: string,
  status: 'active' | 'idle' | 'waiting',
  task: string | null,
  webview: vscode.Webview,
): void {
  const agent = agents.get(agentId);
  if (!agent) {
    return;
  }

  const prevStatus = agent.status;
  agent.status = status;
  agent.lastActiveAt = Date.now();

  if (task !== null) {
    agent.currentTask = truncateTask(task);
  }

  // Notify webview of status change
  postToWebview(webview, { type: 'agentStatus', agentId, status });

  // Emit telemetry for the status transition
  const statusLabel = status === 'active' ? 'became active' : status === 'waiting' ? 'is waiting for input' : 'went idle';
  const taskSuffix = agent.currentTask ? `: ${agent.currentTask}` : '';
  postToWebview(webview, {
    type: 'telemetryEvent',
    event: makeTelemetryEvent('status', agentId, agent.name, `${agent.name} ${statusLabel}${taskSuffix}`),
  });

  // If going active, send a tool-start message so the character animates
  if (status === 'active' && prevStatus !== 'active') {
    const toolName = agent.currentTask ?? 'working';
    postToWebview(webview, { type: 'agentToolStart', agentId, tool: toolName });

    // Start idle timeout — will flip to idle after ACTIVITY_TIMEOUT_MS
    resetActivityTimer(agentId, ACTIVITY_TIMEOUT_MS, () => {
      updateAgentStatus(agentId, 'idle', null, webview);
    });
  }

  // If going idle, send tool-done so character stops typing animation
  if (status === 'idle') {
    postToWebview(webview, { type: 'agentToolDone', agentId });
    postToWebview(webview, { type: 'agentToolsClear', agentId });
  }
}

/**
 * Send the full list of existing agents to the webview. Called on
 * `webviewReady` so the frontend can render the full office.
 */
export function sendExistingAgents(
  agentMap: Map<string, SquadAgentState>,
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
): void {
  const agentArray = Array.from(agentMap.values()).map(a => ({
    id: a.id,
    name: a.name,
    role: a.role,
    paletteIndex: a.paletteIndex,
    seatId: a.seatId,
    status: a.status,
    currentTask: a.currentTask,
  }));

  postToWebview(webview, { type: 'existingAgents', agents: agentArray });
}

/**
 * Persist agent palette/seat assignments to workspace state
 * so they survive extension restarts.
 */
export function persistAgentMeta(
  agentMap: Map<string, SquadAgentState>,
  context: vscode.ExtensionContext,
): void {
  const meta: PersistedAgentMeta = {};
  for (const [id, agent] of agentMap) {
    meta[id] = {
      palette: agent.paletteIndex,
      seatId: agent.seatId ?? undefined,
    };
  }
  context.workspaceState.update(WORKSPACE_KEY_AGENTS, meta);
}

/**
 * Save seat assignments from the webview.
 */
export function saveAgentSeats(
  seatAssignments: Record<string, string>,
  context: vscode.ExtensionContext,
): void {
  for (const [agentId, seatId] of Object.entries(seatAssignments)) {
    const agent = agents.get(agentId);
    if (agent) {
      agent.seatId = seatId;
    }
  }
  context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, seatAssignments);
  persistAgentMeta(agents, context);
}

/**
 * Get current agents map (for external access).
 */
export function getAgents(): Map<string, SquadAgentState> {
  return agents;
}

/**
 * Clean up all timers (call on extension deactivation).
 */
export function disposeAgentManager(): void {
  disposed = true;
  cancelAllTimers();
  agents.clear();
}

// ─── Internal Helpers ───────────────────────────────────────────────

function memberSlug(member: SquadTeamMember): string {
  return member.slug;
}

function memberToState(
  member: SquadTeamMember,
  rosterIndex: number,
  persisted: PersistedAgentMeta,
): SquadAgentState {
  const id = member.slug;
  const savedMeta = persisted[id];

  return {
    id,
    name: member.name,
    role: member.role,
    paletteIndex: savedMeta?.palette ?? (rosterIndex % CHAR_COUNT),
    seatId: savedMeta?.seatId ?? null,
    status: 'idle',
    currentTask: null,
    lastActiveAt: Date.now(),
  };
}

function loadPersistedMeta(context: vscode.ExtensionContext): PersistedAgentMeta {
  return (context.workspaceState.get<PersistedAgentMeta>(WORKSPACE_KEY_AGENTS) ?? {});
}

function truncateTask(task: string): string {
  if (task.length <= TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) {
    return task;
  }
  return task.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH - 3) + '...';
}

function postToWebview(webview: vscode.Webview, message: OutboundMessage): void {
  if (disposed) { return; }
  webview.postMessage(message);
}
