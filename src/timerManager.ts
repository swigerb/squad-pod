/**
 * timerManager.ts — Per-agent activity timers for idle/active transitions.
 *
 * Each agent gets one timer. When activity is detected the timer resets.
 * When it fires, the callback triggers (typically switching the agent to idle).
 */

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Start an activity timer for the given agent.
 * If one is already running it is left untouched — call `resetActivityTimer`
 * if you want to restart the countdown.
 */
export function startActivityTimer(
  agentId: string,
  delayMs: number,
  callback: () => void,
): void {
  if (timers.has(agentId)) {
    return; // already running
  }
  const handle = setTimeout(() => {
    timers.delete(agentId);
    callback();
  }, delayMs);
  timers.set(agentId, handle);
}

/**
 * Cancel an outstanding activity timer for the given agent (no-op if none).
 */
export function cancelActivityTimer(agentId: string): void {
  const handle = timers.get(agentId);
  if (handle !== undefined) {
    clearTimeout(handle);
    timers.delete(agentId);
  }
}

/**
 * Cancel any running timer and immediately start a fresh one.
 */
export function resetActivityTimer(
  agentId: string,
  delayMs: number,
  callback: () => void,
): void {
  cancelActivityTimer(agentId);
  startActivityTimer(agentId, delayMs, callback);
}

/**
 * Cancel every outstanding timer (used on extension deactivation).
 */
export function cancelAllTimers(): void {
  for (const handle of timers.values()) {
    clearTimeout(handle);
  }
  timers.clear();
}
