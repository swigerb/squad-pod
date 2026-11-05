import { SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT, SNAPSHOT_BYTES, type CanvasPaint } from '../../../src/canvasRendering.js';

type Draw = { canvas: HTMLCanvasElement; paint: CanvasPaint };
const listeners = new Set<(draw: Draw) => void>();

/** Called only after the office renderer completes a nonzero-area draw. */
export function officeDrawn(canvas: HTMLCanvasElement, paint: CanvasPaint): void {
  for (const listener of listeners) listener({ canvas, paint });
}

/** No retained image: requests are served on the next completed office draw. */
export function observeOfficeDrawing(send: (frame: string) => void) {
  let acknowledged = false;
  let requestId: string | undefined;
  const listener = ({ canvas, paint }: Draw) => {
    if (!acknowledged) {
      send(JSON.stringify({ version: 1, kind: 'rendered', paint }));
      acknowledged = true;
    }
    if (!requestId) return;
    const id = requestId;
    requestId = undefined;
    let png: string | null = null;
    try {
      const scale = Math.min(1, SNAPSHOT_WIDTH / canvas.width, SNAPSHOT_HEIGHT / canvas.height);
      const copy = document.createElement('canvas');
      copy.width = Math.max(1, Math.floor(canvas.width * scale));
      copy.height = Math.max(1, Math.floor(canvas.height * scale));
      const ctx = copy.getContext('2d');
      if (!ctx) throw new Error('Canvas readback unavailable');
      ctx.drawImage(canvas, 0, 0, copy.width, copy.height);
      const url = copy.toDataURL('image/png');
      if (!url.startsWith('data:image/png;base64,')) throw new Error('PNG unavailable');
      const data = url.slice('data:image/png;base64,'.length);
      if (data.length > Math.ceil(SNAPSHOT_BYTES / 3) * 4) throw new Error('PNG exceeds limit');
      png = data;
    } catch { /* Report a single unavailable result; never send raw browser errors. */ }
    send(JSON.stringify({ version: 1, kind: 'snapshotResult', requestId: id, png }));
  };
  listeners.add(listener);
  return {
    request(value: unknown): boolean {
      if (!value || typeof value !== 'object') return false;
      const v = value as Record<string, unknown>;
      if (v.kind !== 'snapshotRequest') return false;
      if (Object.keys(v).length !== 3 || v.version !== 1 || typeof v.requestId !== 'string'
        || !/^[a-f0-9]{32}$/.test(v.requestId) || requestId) throw new Error('Invalid snapshot request');
      requestId = v.requestId;
      return true;
    },
    dispose() { listeners.delete(listener); requestId = undefined; },
  };
}
