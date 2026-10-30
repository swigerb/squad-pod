import { describe, expect, it } from 'vitest';
import { AnnotationLayout } from './overlayLayout.js';

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

describe('shared member and transient projection', () => {
  it('separates the exact new-parent collision instead of smoothing a transient back into occupied text', () => {
    const layout = new AnnotationLayout();
    const subtask = { id: 'subtask:test', x: 100, y: 100, width: 80, height: 20 };
    expect(layout.place([subtask], 360, 800).boxes.get(subtask.id)?.top).toBe(100);
    const parent = { ...subtask, id: 'member:test' };
    const otherTask = { ...subtask, id: 'subtask:other' };
    for (let tick = 0; tick < 100; tick++) {
      subtask.y = 100 + Math.sin(tick / 10) * 20;
      parent.height = tick % 2 ? 80 : 20; // New measured tool/context footprint.
      otherTask.height = tick % 3 ? 20 : 60; // Wrapping transient description.
      const { boxes, docked } = layout.place([subtask, parent, otherTask], 360, 800);
      expect(docked).toBe(false);
      const values = [...boxes.values()];
      values.forEach((box, i) => values.slice(i + 1).forEach(other =>
        expect(box.top + box.height <= other.top || other.top + other.height <= box.top).toBe(true)));
    }
  });
});
