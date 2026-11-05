import { afterEach, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import { CanvasRendering } from './rendering.js';
import { SNAPSHOT_BYTES, SNAPSHOT_TIMEOUT, isCanvasPaint } from '../../../src/canvasRendering.js';

const paint = { firstPaintTime: 123, frameCount: 1, width: 800, height: 600,
  visibilityState: 'visible', onScreen: true };
const png = () => PNG.sync.write(new PNG({ width: 2, height: 1 })).toString('base64');
function fixture() {
  const send = vi.fn();
  const rendering = new CanvasRendering(send);
  const ack = () => rendering.receive({ version: 1, kind: 'rendered', paint });
  const reply = (data: unknown = png(), requestId = JSON.parse(send.mock.lastCall![0]).requestId) =>
    rendering.receive({ version: 1, kind: 'snapshotResult', requestId, png: data });
  return { send, rendering, ack, reply };
}
afterEach(() => vi.useRealTimers());

it('keeps missing paint unknown; validates and detaches bounded first-frame evidence', async () => {
  const f = fixture();
  expect(f.rendering.state()).toBeNull();
  await expect(f.rendering.capture()).rejects.toThrow('CANVAS_SNAPSHOT_UNAVAILABLE');
  expect(f.send).not.toHaveBeenCalled();
  expect(f.ack()).toBe(true);
  const state = f.rendering.state()!;
  state.width = 3;
  expect(f.rendering.state()).toEqual(paint);
  for (const change of [{ frameCount: 0 }, { frameCount: 65536 }, { width: 32769 },
    { height: 0 }, { firstPaintTime: Infinity }, { firstPaintTime: -1 }, { onScreen: 'yes' },
    { visibilityState: 'prerender' }, { secret: 'private' }]) {
    expect(isCanvasPaint({ ...paint, ...change })).toBe(false);
  }
  expect(isCanvasPaint({ ...paint, onScreen: null, visibilityState: 'hidden' })).toBe(true);
  expect(f.rendering.receive({ version: 1, kind: 'rendered', paint: { ...paint, width: 3 } })).toBe(true);
  expect(f.rendering.state()).toEqual(paint);
  f.rendering.dispose();
  expect(f.rendering.state()).toBeNull();
  expect(f.ack()).toBe(false);
});

it('requests a fresh correlated PNG every time; rejects unsolicited, foreign and stale responses', async () => {
  const f = fixture(), other = fixture();
  f.ack(); other.ack();
  const first = f.rendering.capture();
  const id = JSON.parse(f.send.mock.lastCall![0]).requestId;
  expect(f.send).toHaveBeenCalledWith(JSON.stringify({ version: 1, kind: 'snapshotRequest', requestId: id }));
  expect(other.reply(png(), id)).toBe(false);
  await expect(f.rendering.capture()).rejects.toThrow('CANVAS_SNAPSHOT_UNAVAILABLE');
  expect(f.reply()).toBe(true);
  expect(await first).toBe(png());
  const second = f.rendering.capture();
  expect(JSON.parse(f.send.mock.lastCall![0]).requestId).not.toBe(id);
  expect(f.reply(png(), id)).toBe(false);
  f.reply();
  expect(await second).toBe(png());
});

it.each(['bad', null, '', 'A'.repeat(Math.ceil(SNAPSHOT_BYTES / 3) * 4 + 4), 'AAAA===='])(
  'fails closed on malformed or oversized PNG %#', async data => {
    const f = fixture(); f.ack();
    const result = expect(f.rendering.capture()).rejects.toThrow('CANVAS_SNAPSHOT_UNAVAILABLE');
    expect(f.reply(data)).toBe(false);
    await result;
  });

it.each([[1025, 1], [1, 769], [0, 1], [1, 0]])('rejects dimensions %s x %s before PNG inflation', async (width, height) => {
  const f = fixture(); f.ack();
  const bytes = Buffer.from(png(), 'base64');
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  const result = expect(f.rendering.capture()).rejects.toThrow('CANVAS_SNAPSHOT_UNAVAILABLE');
  expect(f.reply(bytes.toString('base64'))).toBe(false);
  await result;
});

it('validates CRC/full image and accepts exactly the dimension caps', async () => {
  const f = fixture(); f.ack();
  const result = f.rendering.capture();
  const maximum = PNG.sync.write(new PNG({ width: 1024, height: 768 })).toString('base64');
  expect(f.reply(maximum)).toBe(true);
  expect(await result).toBe(maximum);
  const broken = Buffer.from(png(), 'base64');
  broken[29] ^= 1;
  const failure = expect(f.rendering.capture()).rejects.toThrow('CANVAS_SNAPSHOT_UNAVAILABLE');
  expect(f.reply(broken.toString('base64'))).toBe(false);
  await failure;
});

it('bounds time and disposes pending reads without retaining image bytes', async () => {
  vi.useFakeTimers();
  const f = fixture(); f.ack();
  const result = expect(f.rendering.capture()).rejects.toThrow('CANVAS_SNAPSHOT_UNAVAILABLE');
  const id = JSON.parse(f.send.mock.lastCall![0]).requestId;
  await vi.advanceTimersByTimeAsync(SNAPSHOT_TIMEOUT);
  await result;
  expect(f.reply(png(), id)).toBe(false);
  const pending = expect(f.rendering.capture()).rejects.toThrow('CANVAS_SNAPSHOT_UNAVAILABLE');
  f.rendering.dispose();
  await pending;
  expect(vi.getTimerCount()).toBe(0);
});

it('rejects a matching response beyond its wall deadline even before the timeout callback runs', async () => {
  vi.useFakeTimers();
  const f = fixture(); f.ack();
  const result = expect(f.rendering.capture()).rejects.toThrow('CANVAS_SNAPSHOT_UNAVAILABLE');
  vi.setSystemTime(Date.now() + SNAPSHOT_TIMEOUT);
  expect(f.reply()).toBe(false);
  await result;
  expect(vi.getTimerCount()).toBe(0);
});
