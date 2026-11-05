import { randomBytes } from 'node:crypto';
import { PNG } from 'pngjs';
import { isCanvasPaint, SNAPSHOT_BYTES, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT, SNAPSHOT_TIMEOUT,
  type CanvasPaint } from '../../../src/canvasRendering.js';

const unavailable = () => new Error('CANVAS_SNAPSHOT_UNAVAILABLE');

/** One authenticated socket; no cache, unsolicited images or parallel captures. */
export class CanvasRendering {
  private paint: CanvasPaint | null = null;
  private disposed = false;
  private pending?: { id: string; resolve: (png: string) => void; reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>; deadline: number };
  constructor(private send: (frame: string) => void) {}

  state(): CanvasPaint | null { return this.paint ? { ...this.paint } : null; }

  receive(value: Record<string, unknown>): boolean {
    if (this.disposed || value.version !== 1) return false;
    if (value.kind === 'rendered') {
      if (Object.keys(value).length !== 3 || !isCanvasPaint(value.paint)) return false;
      this.paint ??= { ...value.paint };
      return true;
    }
    if (value.kind !== 'snapshotResult') return false;
    const pending = this.pending;
    if (!pending || value.requestId !== pending.id) return false;
    this.pending = undefined;
    clearTimeout(pending.timer);
    try {
      if (Date.now() >= pending.deadline || Object.keys(value).length !== 4 || typeof value.png !== 'string'
        || !value.png || value.png.length > Math.ceil(SNAPSHOT_BYTES / 3) * 4
        || value.png.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.png)) throw unavailable();
      const bytes = Buffer.from(value.png, 'base64');
      if (bytes.length > SNAPSHOT_BYTES || bytes.toString('base64') !== value.png
        || bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw unavailable();
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      if (!width || !height || width > SNAPSHOT_WIDTH || height > SNAPSHOT_HEIGHT) throw unavailable();
      // Check dimensions before inflation; verify CRCs and the full PNG before returning bytes.
      const image = PNG.sync.read(bytes, { checkCRC: true });
      if (image.width !== width || image.height !== height) throw unavailable();
      pending.resolve(value.png);
      return true;
    } catch { pending.reject(unavailable()); return false; }
  }

  capture(): Promise<string> {
    if (this.disposed || !this.paint || this.pending) return Promise.reject(unavailable());
    return new Promise((resolve, reject) => {
      const id = randomBytes(16).toString('hex');
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(unavailable());
      }, SNAPSHOT_TIMEOUT);
      this.pending = { id, resolve, reject, timer, deadline: Date.now() + SNAPSHOT_TIMEOUT };
      try { this.send(JSON.stringify({ version: 1, kind: 'snapshotRequest', requestId: id })); }
      catch { this.dispose(); }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.paint = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(unavailable());
      this.pending = undefined;
    }
  }
}
