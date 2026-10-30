import { describe, expect, it } from 'vitest';
import { clampPanOffset, fitOffice, panAxisRange, zoomPanAroundAnchor } from './viewport.js';
import { PAN_MARGIN_FRACTION, TILE_SIZE, ZOOM_MAX, ZOOM_MIN } from '../../constants.js';

const M = PAN_MARGIN_FRACTION;

describe('explicit office framing', () => {
  it.each([[788, 600, 2], [360, 640, 1], [1400, 900, 3]])(
    'fits a 21-column office into %sx%s CSS pixels without consulting DPR', (width, height, expectedZoom) => {
      const world = { width: 21 * TILE_SIZE, height: 15 * TILE_SIZE };
      const fit = fitOffice({ width, height }, world, ZOOM_MIN, ZOOM_MAX);
      expect(fit.zoom).toBe(expectedZoom);
      expect(fit.pan.x).toBeGreaterThanOrEqual(0);
      expect(fit.pan.y).toBeGreaterThanOrEqual(0);
      expect(fit.pan.x + world.width * fit.zoom).toBeLessThanOrEqual(width);
      expect(fit.pan.y + world.height * fit.zoom).toBeLessThanOrEqual(height);
    });

  it('centers oversized saved layouts at minimum zoom without mutating them', () => {
    const world = Object.freeze({ width: 2000, height: 1000 });
    expect(fitOffice({ width: 360, height: 640 }, world, 1, 10)).toEqual({
      zoom: 1, pan: { x: -820, y: -180 },
    });
  });
});

/** Visible fraction of the map along one axis for a given pan offset. */
function visibleFraction(pan: number, mapSize: number, viewSize: number): number {
  const overlap = Math.min(pan + mapSize, viewSize) - Math.max(pan, 0);
  return Math.max(0, overlap) / mapSize;
}

describe('panAxisRange', () => {
  it('keeps a map that fits the viewport fully inside it, never with inverted bounds', () => {
    const [min, max] = panAxisRange(716, 240, M);
    expect(min).toBeLessThanOrEqual(max);
    expect(min).toBe(0);
    expect(max).toBe(716 - 240);
  });

  it('is continuous as the map grows past the viewport', () => {
    expect(panAxisRange(356, 356, M)).toEqual([0, 0]);
    const [min, max] = panAxisRange(356, 360, M);
    expect(min).toBe(-8);
    expect(max).toBe(4);
  });

  it('keeps a wide map covering at least (1 - margin) of a narrow viewport', () => {
    // 20 cols at zoom 10 in a 356px panel: margin is bounded by the viewport.
    const map = 20 * TILE_SIZE * 10;
    const [min, max] = panAxisRange(356, map, M);
    expect(max).toBeLessThan(356);
    expect(min + map).toBeGreaterThan(0);
    expect(visibleFraction(max, map, 356) * map).toBeGreaterThanOrEqual(356 * (1 - M));
    expect(visibleFraction(min, map, 356) * map).toBeGreaterThanOrEqual(356 * (1 - M));
  });
});

describe('clampPanOffset', () => {
  it('pulls an offscreen-left map fully back into a small viewport', () => {
    const map = { width: 320, height: 240 };
    const view = { width: 356, height: 716 };
    const pan = clampPanOffset({ x: -462, y: -122 }, view, map, M);
    expect(visibleFraction(pan.x, map.width, view.width)).toBe(1);
    expect(visibleFraction(pan.y, map.height, view.height)).toBe(1);
  });

  it('leaves an in-range pan untouched', () => {
    const pan = { x: 10, y: 20 };
    expect(clampPanOffset(pan, { width: 800, height: 600 }, { width: 320, height: 240 }, M)).toEqual(pan);
  });
});

describe('zoomPanAroundAnchor', () => {
  it('keeps the world point under the anchor fixed', () => {
    const anchor = { x: 178, y: 358 };
    const pan = { x: -462, y: -122 };
    const next = zoomPanAroundAnchor(pan, 4, 1, anchor);
    expect((anchor.x - pan.x) / 4).toBeCloseTo((anchor.x - next.x) / 1);
    expect((anchor.y - pan.y) / 4).toBeCloseTo((anchor.y - next.y) / 1);
  });

  it.each([
    [356, 716],
    [2400, 400],
    [300, 1600],
    [1920, 1080],
  ])('repeated zoom in/out across the full range never loses a 20x15 office (%ix%i)', (w, h) => {
    const view = { width: w, height: h };
    const mapAt = (z: number) => ({ width: 20 * TILE_SIZE * z, height: 15 * TILE_SIZE * z });
    let zoom = 4;
    let pan = { x: (w - mapAt(zoom).width) / 2, y: (h - mapAt(zoom).height) / 2 };
    const steps = [...Array(12).fill(-1), ...Array(12).fill(1), ...Array(12).fill(-1)];
    for (const step of steps) {
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + step));
      if (next === zoom) continue;
      pan = clampPanOffset(zoomPanAroundAnchor(pan, zoom, next, { x: w / 2, y: h / 2 }), view, mapAt(next), M);
      zoom = next;
      const map = mapAt(zoom);
      const visW = visibleFraction(pan.x, map.width, w) * map.width;
      const visH = visibleFraction(pan.y, map.height, h) * map.height;
      expect(visW).toBeGreaterThanOrEqual(map.width <= w ? map.width : w * (1 - M) - 1e-9);
      expect(visH).toBeGreaterThanOrEqual(map.height <= h ? map.height : h * (1 - M) - 1e-9);
    }
    expect(zoom).toBe(ZOOM_MIN);
  });
});
