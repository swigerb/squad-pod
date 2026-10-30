import type { TouchSample } from './touchDecisions.js';
import type { MobileView } from './mobileShellState.js';

// Pixel Agents v1.5.0 (b1bafd0), mobile/edgeSwipe.ts: 24px zone, 8px slop,
// 35% distance or >0.3px/ms smoothed velocity. UI controls opt out in the adapter.
interface Tracking {
  start: TouchSample;
  last: TouchSample;
  width: number;
  velocity: number;
}
export type EdgeSwipeState = { phase: 'idle' } | ({ phase: 'armed' | 'claimed' } & Tracking);
export type EdgeSwipeEvent =
  | { type: 'start'; touch: TouchSample; activeIds: readonly number[]; left: number; width: number; optOut: boolean }
  | { type: 'move'; touch: TouchSample }
  | { type: 'end'; id: number }
  | { type: 'cancel'; id: number };
export type EdgeSwipeEffect =
  | { type: 'arm' | 'release' | 'consume' | 'commit' | 'settle' }
  | { type: 'claim'; touchId: number }
  | { type: 'drag'; translatePx: number };
export function reduceEdgeSwipe(
  state: EdgeSwipeState, event: EdgeSwipeEvent, target: MobileView | null,
): { state: EdgeSwipeState; effects: EdgeSwipeEffect[] } {
  const idle: EdgeSwipeState = { phase: 'idle' };
  const release = (): EdgeSwipeEffect[] => state.phase === 'idle' ? [] : [
    { type: 'release' }, ...(state.phase === 'claimed' ? [{ type: 'settle' } as const] : []),
  ];
  if (target === null) return { state: idle, effects: release() };
  const direction = target === 'terminal' ? -1 : 1;
  if (event.type === 'start') {
    // A second finger belongs to the office pinch, never to page navigation.
    if (event.activeIds.length !== 1) return { state: idle, effects: release() };
    if (state.phase !== 'idle' && event.activeIds.includes(state.start.id)) return { state, effects: [] };
    const effects = release();
    const x = event.touch.x - event.left;
    const inZone = x >= 0 && x <= event.width &&
      (target === 'terminal' ? x >= event.width - 24 : x <= 24);
    if (event.optOut || !inZone || event.width <= 0) return { state: idle, effects };
    return {
      state: { phase: 'armed', start: event.touch, last: event.touch, width: event.width, velocity: 0 },
      effects: [...effects, { type: 'arm' }],
    };
  }
  if (state.phase === 'idle') return { state, effects: [] };
  const id = event.type === 'move' ? event.touch.id : event.id;
  if (id !== state.start.id) return { state, effects: [] };
  if (event.type === 'cancel') return { state: idle, effects: release() };
  if (event.type === 'end') {
    if (state.phase === 'armed') return { state: idle, effects: [{ type: 'release' }] };
    const commit = (state.last.x - state.start.x) * direction > state.width * 0.35 ||
      state.velocity * direction > 0.3;
    return { state: idle, effects: [
      { type: 'release' }, { type: 'consume' }, { type: commit ? 'commit' : 'settle' },
    ] };
  }
  const dx = event.touch.x - state.start.x;
  const dy = event.touch.y - state.start.y;
  if (state.phase === 'armed') {
    if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) return { state: idle, effects: [{ type: 'release' }] };
    if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return { state, effects: [] };
  }
  const velocity = 0.8 * (event.touch.x - state.last.x) / Math.max(1, event.touch.time - state.last.time) +
    0.2 * state.velocity;
  const offset = direction * Math.min(state.width, Math.max(0, dx * direction));
  return {
    state: { ...state, phase: 'claimed', last: event.touch, velocity },
    effects: [
      ...(state.phase === 'armed' ? [{ type: 'claim', touchId: state.start.id } as const] : []),
      { type: 'consume' }, { type: 'drag', translatePx: (target === 'office' ? -state.width : 0) + offset },
    ],
  };
}
