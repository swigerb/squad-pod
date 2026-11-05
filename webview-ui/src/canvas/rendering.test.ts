import { afterEach, expect, it, vi } from 'vitest';
import { officeDrawn, observeOfficeDrawing } from './rendering.js';
import { SNAPSHOT_BYTES, SNAPSHOT_TIMEOUT } from '../../../src/canvasRendering.js';

const paint = { firstPaintTime: 123, frameCount: 1, width: 2000, height: 1000,
  visibilityState: 'visible' as const, onScreen: true };
const id = 'a'.repeat(32);
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('acknowledges only a completed draw, once per connection, and never caches a snapshot', () => {
  const send = vi.fn(), drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const toData = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
  const canvas = document.createElement('canvas');
  canvas.width = 2000; canvas.height = 1000;
  const observer = observeOfficeDrawing(send);
  try {
    expect(send).not.toHaveBeenCalled();
    officeDrawn(canvas, paint);
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({ version: 1, kind: 'rendered', paint });
    expect(toData).not.toHaveBeenCalled();
    expect(observer.request({ version: 1, kind: 'snapshotRequest', requestId: id })).toBe(true);
    expect(toData).not.toHaveBeenCalled();
    officeDrawn(canvas, { ...paint, frameCount: 2 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.lastCall![0])).toEqual({ version: 1, kind: 'snapshotResult', requestId: id, png: 'AAAA' });
    expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0, 1024, 512);
    const copy = toData.mock.instances[0] as HTMLCanvasElement;
    expect([copy.width, copy.height]).toEqual([1024, 512]);
    officeDrawn(canvas, paint);
    expect(toData).toHaveBeenCalledOnce();
    observer.dispose();
    officeDrawn(canvas, paint);
    expect(send).toHaveBeenCalledTimes(2);
  } finally { observer.dispose(); }
});

it.each(['throws', 'oversize', 'not-png', 'no-context'])('returns only sanitized unavailability on %s', reason => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(reason === 'no-context' ? null
    : { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => {
    if (reason === 'throws') throw new Error('private credentials and path');
    return reason === 'oversize' ? `data:image/png;base64,${'a'.repeat(Math.ceil(SNAPSHOT_BYTES / 3) * 4 + 4)}` : 'data:,';
  });
  const send = vi.fn(), observer = observeOfficeDrawing(send);
  try {
    observer.request({ version: 1, kind: 'snapshotRequest', requestId: id });
    officeDrawn(document.createElement('canvas'), paint);
    expect(JSON.parse(send.mock.lastCall![0])).toEqual({ version: 1, kind: 'snapshotResult', requestId: id, png: null });
    expect(JSON.stringify(send.mock.calls)).not.toContain('private');
  } finally { observer.dispose(); }
});

it('accepts only bounded exact request envelopes and drops pending requests on disposal', () => {
  const send = vi.fn(), observer = observeOfficeDrawing(send);
  expect(observer.request({ kind: 'office' })).toBe(false);
  for (const value of [{ version: 2, kind: 'snapshotRequest', requestId: id },
    { version: 1, kind: 'snapshotRequest', requestId: '../private' },
    { version: 1, kind: 'snapshotRequest', requestId: id, extra: true }]) {
    expect(() => observer.request(value)).toThrow('Invalid snapshot request');
  }
  observer.request({ version: 1, kind: 'snapshotRequest', requestId: id });
  observer.dispose();
  officeDrawn(document.createElement('canvas'), paint);
  expect(send).not.toHaveBeenCalled();
});

it('replaces a timed-out queued request without drawing and returns only the latest nonce on resume', async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
  const send = vi.fn(), observer = observeOfficeDrawing(send);
  const canvas = document.createElement('canvas'), nextId = 'b'.repeat(32);
  try {
    officeDrawn(canvas, paint);
    observer.request({ version: 1, kind: 'snapshotRequest', requestId: id });
    await vi.advanceTimersByTimeAsync(SNAPSHOT_TIMEOUT + 1);
    expect(send).toHaveBeenCalledOnce();
    expect(() => observer.request({ version: 1, kind: 'snapshotRequest', requestId: nextId })).not.toThrow();
    officeDrawn(canvas, { ...paint, frameCount: 2 });
    officeDrawn(canvas, { ...paint, frameCount: 3 });
    expect(send.mock.calls.map(([frame]) => JSON.parse(frame)).filter(frame => frame.kind === 'snapshotResult'))
      .toEqual([{ version: 1, kind: 'snapshotResult', requestId: nextId, png: 'AAAA' }]);
  } finally { observer.dispose(); }
});
