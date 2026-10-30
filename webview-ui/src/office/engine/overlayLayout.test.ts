import { describe, expect, it } from 'vitest';
import { OverlayLayout, type LabelBox } from './overlayLayout.js';

describe('persistent production overlay layout', () => {
  it('does not repack a settled collision lane when a neighbor leaves, and forgets removed identities', () => {
    const layout = new OverlayLayout();
    let occupied: LabelBox[] = [];
    layout.begin();
    layout.place('first', 180, 300, 100, 28, 360, 800, occupied, 0);
    const second = layout.place('second', 180, 300, 100, 28, 360, 800, occupied, 0);
    layout.end();
    expect(second.top).toBe(268);
    layout.begin();
    occupied = [];
    expect(layout.place('second', 180, 300, 100, 28, 360, 800, occupied, 100).top).toBe(268);
    layout.end();
    layout.begin();
    layout.end();
    layout.begin();
    expect(layout.place('second', 180, 300, 100, 28, 360, 800, [], 200).top).toBe(300);
  });

  it('bounds new collision lane movement after a long suspended frame', () => {
    const layout = new OverlayLayout();
    layout.begin();
    layout.place('label', 180, 300, 100, 28, 360, 800, [], 0);
    layout.end();
    layout.begin();
    const occupied = [{ left: 100, top: 100, width: 200, height: 300 }];
    const box = layout.place('label', 180, 300, 100, 28, 360, 800, occupied, 60_000);
    expect(Math.abs(box.top - 300)).toBeLessThanOrEqual(12);
  });

  it('does not remember viewport clamping as a distant character-relative lane', () => {
    const layout = new OverlayLayout();
    layout.begin();
    expect(layout.place('label', 200, 2000, 100, 28, 360, 600, [], 0).top).toBe(568);
    layout.end();
    layout.begin();
    expect(layout.place('label', 200, 300, 100, 28, 360, 600, [], 100).top).toBe(300);
  });
});
