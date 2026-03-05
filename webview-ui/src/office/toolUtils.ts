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
