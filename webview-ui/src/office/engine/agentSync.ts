/**
 * Pure helpers that keep the office in sync with the extension's
 * authoritative agent snapshot. The extension owns a unique appearance
 * index per Squad member; the webview maps it to one of six sprite palettes
 * plus a hue rotation, so every client renders the same look.
 */

export const PALETTE_COUNT = 6;
const HUE_STEP_DEGREES = 45;

export type AgentStatus = 'active' | 'idle' | 'waiting';

export interface AgentSnapshot {
  id: string;
  name: string;
  role: string;
  paletteIndex?: number;
  seatId?: string | null;
  status?: AgentStatus;
}

export interface AgentSyncTarget {
  characters: Map<string, unknown>;
  addAgent(
    id: string,
    name: string,
    role: string,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string
  ): void;
  removeAgent(id: string): void;
  setAgentActive(id: string, active: boolean): void;
  showWaitingBubble(id: string): void;
}

export function appearanceFromIndex(index: number | undefined): { palette: number; hueShift: number } {
  const i = Number.isFinite(index) && (index as number) > 0 ? Math.floor(index as number) : 0;
  return {
    palette: i % PALETTE_COUNT,
    hueShift: (Math.floor(i / PALETTE_COUNT) * HUE_STEP_DEGREES) % 360,
  };
}

export function addSnapshotAgent(target: AgentSyncTarget, agent: AgentSnapshot): boolean {
  if (target.characters.has(agent.id)) return false;
  const hasAppearance = typeof agent.paletteIndex === 'number';
  const { palette, hueShift } = appearanceFromIndex(agent.paletteIndex);
  target.addAgent(
    agent.id,
    agent.name,
    agent.role,
    hasAppearance ? palette : undefined,
    hasAppearance ? hueShift : undefined,
    agent.seatId ?? undefined
  );
  return true;
}

export function applyAgentStatus(target: AgentSyncTarget, id: string, status: AgentStatus | undefined): void {
  if (status === 'active') {
    target.setAgentActive(id, true);
  } else if (status === 'waiting') {
    target.setAgentActive(id, false);
    target.showWaitingBubble(id);
  } else if (status === 'idle') {
    target.setAgentActive(id, false);
  }
}

/**
 * Make the office match `snapshot`: add missing agents with their stored
 * appearance and seat, remove agents that are no longer on the roster, and
 * apply each agent's current status. Safe to call repeatedly.
 */
export function reconcileAgents(
  target: AgentSyncTarget,
  snapshot: AgentSnapshot[]
): { added: string[]; removed: string[] } {
  const wanted = new Set(snapshot.map((a) => a.id));
  const removed: string[] = [];
  for (const id of Array.from(target.characters.keys())) {
    if (!wanted.has(id)) {
      target.removeAgent(id);
      removed.push(id);
    }
  }
  const added: string[] = [];
  for (const agent of snapshot) {
    if (addSnapshotAgent(target, agent)) added.push(agent.id);
    applyAgentStatus(target, agent.id, agent.status);
  }
  return { added, removed };
}
