import { ZOOM_MIN, ZOOM_MAX } from '../constants.js';

// Thresholds/semantics: Pixel Agents v1.5.0 (b1bafd0), touchPrimitives.ts,
// touchGesture.ts and useCanvasTouchGestures.ts. Coordinates are CSS pixels.
export const TAP_SLOP_PX = 10;
export const TAP_DURATION_MS = 350;
export const LONG_PRESS_MS = 500;
export interface Point { x: number; y: number }
export interface TouchSample extends Point { id: number; time: number }
export interface TapTrack {
  start: TouchSample;
  last: TouchSample;
  slipped: boolean;
  cancelled: boolean;
}
export function withinTapSlop(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) <= TAP_SLOP_PX;
}
export function startTap(touch: TouchSample): TapTrack {
  return { start: touch, last: touch, slipped: false, cancelled: false };
}
export function moveTap(track: TapTrack, touch: TouchSample): TapTrack {
  if (touch.id !== track.start.id) return track;
  return { ...track, last: touch,
    slipped: track.slipped || !withinTapSlop(touch.x - track.start.x, touch.y - track.start.y) };
}
export function isShortTap(track: TapTrack, release: TouchSample): boolean {
  const elapsed = release.time - track.start.time;
  return release.id === track.start.id && !track.cancelled && !track.slipped &&
    elapsed >= 0 && elapsed <= TAP_DURATION_MS &&
    withinTapSlop(release.x - track.start.x, release.y - track.start.y);
}
export function canLongPress(track: TapTrack, now: number): boolean {
  return !track.cancelled && !track.slipped && now - track.start.time >= LONG_PRESS_MS;
}
export function safeTerminalUrl(text: string): string | null {
  // Do not let URL's whitespace/control normalization turn malformed output into a link.
  if (text !== text.trim() || /[\u0000-\u0020\u007f\\]/u.test(text) || !/^https?:\/\/[^/?#]/i.test(text)) return null;
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname &&
      !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
export function terminalTapAction(
  track: TapTrack, release: TouchSample, selectionActive: boolean, url: string | null,
): { type: 'none' } | { type: 'focus' } | { type: 'openUrl'; url: string } {
  if (selectionActive || !isShortTap(track, release)) return { type: 'none' };
  const safe = url === null ? null : safeTerminalUrl(url);
  return safe ? { type: 'openUrl', url: safe } : { type: 'focus' };
}

export interface OfficePanAnchor { point: Point; pan: Point; panned: boolean }
export function officePanStep(anchor: OfficePanAnchor, point: Point, devicePixelRatio: number) {
  const dx = point.x - anchor.point.x;
  const dy = point.y - anchor.point.y;
  const moved = anchor.panned || !withinTapSlop(dx, dy);
  return {
    anchor: { ...anchor, panned: moved },
    breakFollow: moved && !anchor.panned,
    pan: moved ? { x: anchor.pan.x + dx * devicePixelRatio, y: anchor.pan.y + dy * devicePixelRatio } : anchor.pan,
  };
}
export function pinchZoom(startDistance: number, distance: number, startZoom: number): number {
  if (startDistance <= 0 || !Number.isFinite(startDistance) || !Number.isFinite(distance)) return startZoom;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(startZoom * distance / startDistance)));
}
