/** Bounded application-reported drawing evidence, not compositor visibility. */
export interface CanvasPaint {
  firstPaintTime: number;
  frameCount: number;
  width: number;
  height: number;
  visibilityState: 'visible' | 'hidden';
  onScreen: boolean | null;
}
export const SNAPSHOT_WIDTH = 1024;
export const SNAPSHOT_HEIGHT = 768;
export const SNAPSHOT_BYTES = 1024 * 1024;
export const SNAPSHOT_FRAME = Math.ceil(SNAPSHOT_BYTES / 3) * 4 + 1024;
export const SNAPSHOT_TIMEOUT = 2000;

export function isCanvasPaint(value: unknown): value is CanvasPaint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return false; }
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 6
    && typeof v.firstPaintTime === 'number' && Number.isFinite(v.firstPaintTime)
    && v.firstPaintTime >= 0 && v.firstPaintTime <= Number.MAX_SAFE_INTEGER
    && Number.isSafeInteger(v.frameCount) && Number(v.frameCount) > 0 && Number(v.frameCount) <= 65535
    && Number.isSafeInteger(v.width) && Number(v.width) > 0 && Number(v.width) <= 32768
    && Number.isSafeInteger(v.height) && Number(v.height) > 0 && Number(v.height) <= 32768
    && (v.visibilityState === 'visible' || v.visibilityState === 'hidden')
    && (v.onScreen === null || typeof v.onScreen === 'boolean');
}
