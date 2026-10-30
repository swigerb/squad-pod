import { describe, expect, it } from 'vitest';
import { AnnotationLayout, OverlayLayout, type LabelBox } from './overlayLayout.js';

describe('ordered character annotation projection', () => {
  it('keeps full measured stacks disjoint through horizontal and vertical crossings', () => {
    const layout = new AnnotationLayout();
    const anchors = Array.from({ length: 8 }, (_, i) => ({
      id: `agent-${i}`, x: 180, y: 300, width: 140, height: 48,
    }));
    let previous = layout.place(anchors, 360, 800).boxes;
    for (let tick = 0; tick < 600; tick++) {
      anchors.forEach((anchor, i) => {
        anchor.x = 180 + Math.sin(tick / 25 + i) * 100;
        anchor.y = 300 + Math.sin(tick / 40 + i) * 80;
      });
      const { boxes, docked } = layout.place(anchors, 360, 800);
      expect(docked).toBe(false);
      const values = [...boxes.values()];
      values.forEach((box, i) => {
        if (tick > 0) expect(Math.abs(box.top - previous.get(`agent-${i}`)!.top)).toBeLessThanOrEqual(2.00001);
        expect(box.left).toBeGreaterThanOrEqual(4);
        expect(box.left + box.width).toBeLessThanOrEqual(356);
        expect(box.top).toBeGreaterThanOrEqual(4);
        expect(box.top + box.height).toBeLessThanOrEqual(796);
        values.slice(i + 1).forEach(other =>
          expect(box.top + box.height <= other.top || other.top + other.height <= box.top).toBe(true));
      });
      previous = boxes;
    }
  });

  it('uses an explicit list when full stacks cannot fit, rather than overlapping or truncating them', () => {
    const layout = new AnnotationLayout();
    const anchors = Array.from({ length: 8 }, (_, i) => ({
      id: `agent-${i}`, x: 180, y: 300, width: 140, height: 80,
    }));
    expect(layout.place(anchors, 360, 280).docked).toBe(true);
    expect(layout.place(anchors, 360, 900).docked).toBe(false);
    expect(layout.place(anchors.slice(0, 2), 360, 280).docked).toBe(false);
  });
});

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
