export interface LabelBox {
  left: number;
  top: number;
  width: number;
  height: number;
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

interface Placement {
  offset: number;
  time: number;
}

/**
 * Keep each chosen character-relative lane until it collides, rather than
 * repacking all labels toward their anchors every frame. Lane changes are
 * bounded in CSS pixels; world/camera movement is deliberately not smoothed.
 */
export class OverlayLayout {
  private placements = new Map<string, Placement>();
  private seen = new Set<string>();

  begin() { this.seen.clear(); }

  place(id: string, x: number, y: number, width: number, height: number,
    viewportWidth: number, viewportHeight: number, occupied: LabelBox[], time: number): LabelBox {
    this.seen.add(id);
    const previous = this.placements.get(id);
    const anchor = height > 0 ? Math.max(4, Math.min(y, Math.max(4, viewportHeight - height - 4))) : y;
    const preferred = anchor + (previous?.offset ?? 0);
    const target = placeOverlay(x, preferred, width, height, viewportWidth, viewportHeight, occupied);
    if (previous) {
      // Cap long/background frames too: resuming must not teleport a lane.
      const step = 120 * Math.min(0.1, Math.max(0, (time - previous.time) / 1000));
      const offset = Math.max(previous.offset - step, Math.min(previous.offset + step, target.top - anchor));
      target.top = Math.max(4, Math.min(anchor + offset, Math.max(4, viewportHeight - height - 4)));
    }
    if (width > 0 && height > 0) this.placements.set(id, { offset: target.top - anchor, time });
    return target;
  }

  end() {
    for (const id of this.placements.keys()) if (!this.seen.has(id)) this.placements.delete(id);
  }
}
