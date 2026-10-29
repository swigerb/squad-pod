import { describe, expect, it, vi } from 'vitest';
import { renderFrame } from './renderer.js';

describe('asset diagnostic banner follows Debug View', () => {
  it.each([undefined, false, true])('draws the chars/tileset strip only when enabled (%s)', (debug) => {
    const canvas = document.createElement('canvas');
    const ctx = {
      canvas, clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      setTransform: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
    };
    renderFrame(ctx as unknown as CanvasRenderingContext2D,
      800, 600, [], [], [], 1, 0, 0, null, undefined, undefined,
      0, 0, null, null, null, [], debug);
    if (debug) {
      expect(ctx.fillText).toHaveBeenCalledWith(expect.stringMatching(/^chars:.*tileset:/), expect.any(Number), expect.any(Number));
      expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    } else {
      expect(ctx.fillText).not.toHaveBeenCalled();
      expect(ctx.fillRect).not.toHaveBeenCalled();
    }
  });
});
