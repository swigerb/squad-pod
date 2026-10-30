const STATUS_TO_TOOL: Record<string, string> = {
  Reading: 'Read',
  Searching: 'Grep',
  Writing: 'Write',
  Editing: 'Edit',
  Running: 'Bash',
  Task: 'Task',
  Building: 'Build',
  Testing: 'Test',
  Linting: 'Lint',
  Installing: 'Install',
  Deploying: 'Deploy',
  Debugging: 'Debug',
  Reviewing: 'Review',
  Planning: 'Plan',
  Thinking: 'Think',
  Waiting: 'Wait',
};

export interface ContextUsage { contextTokens: number; maxContextTokens: number }
export function pruneCompletedTools<T extends { done: boolean }>(tools: T[]): T[] {
  let completed = 0;
  return tools.slice().reverse().filter(tool => !tool.done || ++completed <= 3).reverse();
}

const contextByOffice = new WeakMap<object, Map<string, ContextUsage>>();

export function setContextUsage(office: object, agentId: string, usage: ContextUsage | null): void {
  let contexts = contextByOffice.get(office);
  if (!contexts) { contexts = new Map(); contextByOffice.set(office, contexts); }
  if (usage) contexts.set(agentId, usage);
  else contexts.delete(agentId);
}

export function getContextUsage(office: object, agentId: string): ContextUsage | undefined {
  return contextByOffice.get(office)?.get(agentId);
}

export function contextGauge(usage: ContextUsage): { percent: number; color: string; label: string } {
  const ratio = Math.max(0, Math.min(1, usage.contextTokens / usage.maxContextTokens));
  const percent = Math.round(ratio * 100);
  const color = ratio >= 0.95 ? '#ef4444' : ratio >= 0.8 ? '#fb923c' : ratio >= 0.6 ? '#facc15' : '#4ade80';
  return { percent, color, label: `${percent}% context used (${(usage.contextTokens / 1000).toFixed(1)}k of ${(usage.maxContextTokens / 1000).toFixed(1)}k tokens)` };
}

export function extractToolName(status: string): string {
  const normalized = status.trim();

  for (const [key, value] of Object.entries(STATUS_TO_TOOL)) {
    if (normalized.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }

  const words = normalized.split(/\s+/);
  if (words.length > 0) {
    const firstWord = words[0];
    if (firstWord.length > 0) {
      return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
    }
  }

  return 'Work';
}

export function defaultZoom(): number {
  const dpr = window.devicePixelRatio || 1;
  if (dpr >= 2) {
    return 2;
  }
  return 1;
}
