export interface LabelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AnnotationAnchor {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Persistent vertical order plus least-squares separation. Unlike greedy
 * collision lanes, horizontal crossings cannot exchange rows. Projection is
 * continuous in the anchors: moving a character cannot teleport another row.
 */
export class AnnotationLayout {
  private order: string[] = [];

  place(anchors: AnnotationAnchor[], width: number, height: number) {
    const byId = new Map(anchors.map(anchor => [anchor.id, anchor]));
    this.order = this.order.filter(id => byId.has(id));
    const known = new Set(this.order);
    this.order.push(...anchors.filter(anchor => !known.has(anchor.id))
      .sort((a, b) => a.y - b.y || a.id.localeCompare(b.id)).map(anchor => anchor.id));
    const ordered = this.order.map(id => byId.get(id)!);
    const total = ordered.reduce((sum, anchor) => sum + anchor.height + 4, -4);
    const docked = total > height - 8;
    const blocks: Array<{ start: number; end: number; sum: number; count: number }> = [];
    const offsets: number[] = [];
    let offset = 0;
    ordered.forEach((anchor, index) => {
      offsets.push(offset);
      blocks.push({ start: index, end: index, sum: anchor.y - offset, count: 1 });
      while (blocks.length > 1) {
        const right = blocks[blocks.length - 1];
        const left = blocks[blocks.length - 2];
        if (left.sum / left.count <= right.sum / right.count) break;
        blocks.splice(-2, 2, { start: left.start, end: right.end,
          sum: left.sum + right.sum, count: left.count + right.count });
      }
      offset += anchor.height + 4;
    });
    const boxes = new Map<string, LabelBox>();
    for (const block of blocks) {
      const top = Math.max(4, Math.min(block.sum / block.count, height - total - 4));
      for (let index = block.start; index <= block.end; index++) {
        const anchor = ordered[index];
        boxes.set(anchor.id, {
          left: Math.max(4, Math.min(anchor.x - anchor.width / 2, width - anchor.width - 4)),
          top: top + offsets[index], width: anchor.width, height: anchor.height,
        });
      }
    }
    return { boxes, docked };
  }
}

export function placeOverlay(x: number, y: number, width: number, height: number,
  viewportWidth: number, viewportHeight: number, occupied: LabelBox[]): LabelBox {
  const left = width > 0 ? Math.max(4, Math.min(x - width / 2, viewportWidth - width - 4)) : x;
  const top = height > 0 ? Math.max(4, Math.min(y, viewportHeight - height - 4)) : y;
  const overlaps = (candidate: number) => occupied.some((box) =>
    left < box.left + box.width + 4 && left + width + 4 > box.left
    && candidate < box.top + box.height + 4 && candidate + height + 4 > box.top);
  const candidates = [top, ...occupied.flatMap(box => [box.top - height - 4, box.top + box.height + 4])]
    .sort((a, b) => Math.abs(a - top) - Math.abs(b - top));
  const placed = candidates.find((candidate) => candidate >= 4
    && candidate + height <= viewportHeight - 4 && !overlaps(candidate));
  const box = { left, top: placed ?? top, width, height };
  occupied.push(box);
  return box;
}
