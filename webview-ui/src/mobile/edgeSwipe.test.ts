import { describe, expect, it } from 'vitest';
import { reduceEdgeSwipe, type EdgeSwipeState } from './edgeSwipe.js';
import type { MobileView } from './mobileShellState.js';
const idle: EdgeSwipeState = { phase: 'idle' };
const touch = (x: number, y = 100, time = 0, id = 1) => ({ x, y, time, id });
function start(target: MobileView = 'terminal', x = target === 'terminal' ? 390 : 0, optOut = false) {
  return reduceEdgeSwipe(idle, {
    type: 'start', touch: touch(x), activeIds: [1], left: 0, width: 390, optOut,
  }, target);
}
describe('edge swipe arbitration', () => {
  it('arms only the correct 24px edge and leaves controls/selection handles alone', () => {
    expect(start('terminal', 366).effects).toEqual([{ type: 'arm' }]);
    expect(start('terminal', 365).effects).toEqual([]);
    expect(start('office', 24).effects).toEqual([{ type: 'arm' }]);
    expect(start('office', 25).effects).toEqual([]);
    expect(start('terminal', 390, true).effects).toEqual([]);
    expect(start('terminal', 391).effects).toEqual([]);
  });
  it('does not consume edge taps or vertical scroll intent', () => {
    const armed = start().state;
    expect(reduceEdgeSwipe(armed, { type: 'end', id: 1 }, 'terminal').effects).toEqual([{ type: 'release' }]);
    expect(reduceEdgeSwipe(armed, { type: 'move', touch: touch(389, 109, 20) }, 'terminal')).toEqual({
      state: idle, effects: [{ type: 'release' }],
    });
    expect(reduceEdgeSwipe(armed, { type: 'move', touch: touch(383, 100, 20) }, 'terminal').effects).toEqual([]);
  });
  it.each(['terminal', 'office'] as const)('claims/commits a deliberate distance swipe to %s', target => {
    const x = target === 'terminal' ? 390 : 0;
    const destination = target === 'terminal' ? 200 : 190;
    const moved = reduceEdgeSwipe(start(target).state, { type: 'move', touch: touch(destination, 100, 2000) }, target);
    expect(moved.effects).toEqual([
      { type: 'claim', touchId: 1 }, { type: 'consume' }, { type: 'drag', translatePx: -190 + (target === 'office' ? -10 : 0) },
    ]);
    expect(moved.state).toMatchObject({ phase: 'claimed', start: touch(x) });
    expect(reduceEdgeSwipe(moved.state, { type: 'end', id: 1 }, target).effects).toEqual([
      { type: 'release' }, { type: 'consume' }, { type: 'commit' },
    ]);
  });
  it('uses strict 35%/0.3 thresholds, settling short slow and wrong-way drags', () => {
    const slow = reduceEdgeSwipe(start().state, { type: 'move', touch: touch(370, 100, 1000) }, 'terminal');
    expect(reduceEdgeSwipe(slow.state, { type: 'end', id: 1 }, 'terminal').effects.at(-1)).toEqual({ type: 'settle' });
    const fast = reduceEdgeSwipe(start().state, { type: 'move', touch: touch(370, 100, 10) }, 'terminal');
    expect(reduceEdgeSwipe(fast.state, { type: 'end', id: 1 }, 'terminal').effects.at(-1)).toEqual({ type: 'commit' });
    const wrong = reduceEdgeSwipe(start('terminal', 366).state, { type: 'move', touch: touch(386, 100, 10) }, 'terminal');
    expect(wrong.effects.at(-1)).toEqual({ type: 'drag', translatePx: 0 });
    expect(reduceEdgeSwipe(wrong.state, { type: 'end', id: 1 }, 'terminal').effects.at(-1)).toEqual({ type: 'settle' });
    const boundary: EdgeSwipeState = {
      phase: 'claimed', start: touch(390), last: touch(253.5), width: 390, velocity: -0.3,
    };
    expect(reduceEdgeSwipe(boundary, { type: 'end', id: 1 }, 'terminal').effects.at(-1)).toEqual({ type: 'settle' });
  });
  it('tracks finger identity, settles cancel/disabled swipes and yields to multi-touch pinch', () => {
    const armed = start().state;
    expect(reduceEdgeSwipe(armed, { type: 'end', id: 2 }, 'terminal')).toEqual({ state: armed, effects: [] });
    const claimed = reduceEdgeSwipe(armed, { type: 'move', touch: touch(300, 100, 100) }, 'terminal').state;
    for (const result of [
      reduceEdgeSwipe(claimed, { type: 'cancel', id: 1 }, 'terminal'),
      reduceEdgeSwipe(claimed, { type: 'move', touch: touch(290) }, null),
      reduceEdgeSwipe(claimed, {
        type: 'start', touch: touch(380, 100, 110, 2), activeIds: [1, 2], left: 0, width: 390, optOut: false,
      }, 'terminal'),
    ]) expect(result).toEqual({ state: idle, effects: [{ type: 'release' }, { type: 'settle' }] });
  });
  it('recovers a lost touch end before arming another edge touch', () => {
    const result = reduceEdgeSwipe(start().state, {
      type: 'start', touch: touch(390, 100, 100, 2), activeIds: [2], left: 0, width: 390, optOut: false,
    }, 'terminal');
    expect(result.effects).toEqual([{ type: 'release' }, { type: 'arm' }]);
    expect(result.state).toMatchObject({ phase: 'armed', start: { id: 2 } });
  });
});
