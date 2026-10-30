/**
 * Pure helpers that keep the office in sync with the extension's
 * authoritative agent snapshot. The extension owns a unique appearance
 * index per Squad member; the webview maps it to one of six sprite palettes
 * plus a hue rotation, so every client renders the same look.
 */

export const PALETTE_COUNT = 6;
export const EXTERNAL_CHARACTER_BASE = 48 * 0x1000000;
const HUE_STEP_DEGREES = 45;

export type AgentStatus = 'active' | 'idle' | 'waiting';

export interface AgentSnapshot {
  id: string;
  name: string;
  role: string;
  currentTask?: string | null;
  paletteIndex?: number;
  seatId?: string | null;
  directoryId?: string | null;
  directoryMappingIds?: string[];
  status?: AgentStatus;
}

export interface AgentSyncTarget {
  characters: {
    get(id: string): { name: string; role: string } | undefined;
    keys(): IterableIterator<string>;
  };
  addAgent(
    id: string,
    name: string,
    role: string,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    preferredDirectoryId?: string,
    preferredDirectoryMappingIds?: string[],
  ): void;
  setAgentDirectoryId?(id: string, directoryId: string | null | undefined): void;
  removeAgent(id: string): void;
  setAgentActive(id: string, active: boolean): void;
  showWaitingBubble(id: string): void;
}

export function appearanceFromIndex(index: number | undefined): { palette: number; hueShift: number } {
  const i = Number.isFinite(index) && (index as number) > 0 ? Math.floor(index as number) : 0;
  if (Number.isSafeInteger(i) && i >= EXTERNAL_CHARACTER_BASE) {
    return { palette: i, hueShift: 0 };
  }
  return {
    palette: i % PALETTE_COUNT,
    hueShift: (Math.floor(i / PALETTE_COUNT) * HUE_STEP_DEGREES) % 360,
  };
}

export function addSnapshotAgent(target: AgentSyncTarget, agent: AgentSnapshot): boolean {
  const existing = target.characters.get(agent.id);
  if (existing) {
    existing.name = agent.name;
    existing.role = agent.role;
    if (agent.directoryId !== undefined) {
      target.setAgentDirectoryId?.(agent.id, agent.directoryId);
    }
    return false;
  }
  const hasAppearance = typeof agent.paletteIndex === 'number';
  const { palette, hueShift } = appearanceFromIndex(agent.paletteIndex);
  target.addAgent(
    agent.id,
    agent.name,
    agent.role,
    hasAppearance ? palette : undefined,
    hasAppearance ? hueShift : undefined,
    agent.seatId ?? undefined,
    agent.directoryId ?? undefined,
    agent.directoryMappingIds,
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
