export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface CameraRequest { id: number; agentId?: string }

/** CSS-pixel framing is independent of the canvas backing-store DPR. */
export function fitOffice(view: Size, world: Size, minZoom: number, maxZoom: number): { zoom: number; pan: Point } {
  const zoom = Math.max(minZoom, Math.min(maxZoom,
    Math.floor(Math.min(Math.max(1, view.width - 64) / world.width, Math.max(1, view.height - 96) / world.height))));
  return { zoom, pan: { x: (view.width - world.width * zoom) / 2, y: (view.height - world.height * zoom) / 2 } };
}

/**
 * Pan range for one axis. A map that fits the viewport stays fully inside it.
 * A larger map may overscroll its edges by at most `margin` of the viewport
 * (and never more than it exceeds the viewport), so it always covers most of
 * the panel even at high zoom in a narrow view, and the bounds never invert.
 */
export function panAxisRange(viewSize: number, mapSize: number, margin: number): [number, number] {
  const slack = viewSize - mapSize;
  const overhang = Math.min(viewSize * margin, Math.max(0, -slack));
  return [Math.min(0, slack) - overhang, Math.max(0, slack) + overhang];
}

export function clampPanOffset(pan: Point, view: Size, map: Size, margin: number): Point {
  const [minX, maxX] = panAxisRange(view.width, map.width, margin);
  const [minY, maxY] = panAxisRange(view.height, map.height, margin);
  return {
    x: Math.min(maxX, Math.max(minX, pan.x)),
    y: Math.min(maxY, Math.max(minY, pan.y)),
  };
}

/** Keeps the world point under `anchor` (viewport coordinates) fixed across a zoom change. */
export function zoomPanAroundAnchor(pan: Point, oldZoom: number, newZoom: number, anchor: Point): Point {
  const scale = newZoom / oldZoom;
  return {
    x: anchor.x - (anchor.x - pan.x) * scale,
    y: anchor.y - (anchor.y - pan.y) * scale,
  };
}
