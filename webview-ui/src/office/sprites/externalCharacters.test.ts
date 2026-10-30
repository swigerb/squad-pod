import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Direction } from '../types.js';

class FixtureImage {
  width = 224;
  height = 128;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  set src(value: string) {
    if (value.endsWith('bad')) { queueMicrotask(() => this.onerror?.()); return; }
    if (value.endsWith('dimensions')) { this.width = 112; }
    if (!value.endsWith('pending')) { queueMicrotask(() => this.onload?.()); }
  }
}

describe('external sheets after synchronous bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('Image', FixtureImage);
    vi.stubGlobal('ImageData', class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      putImageData: vi.fn(), drawImage: vi.fn(),
    }) as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function modules() {
    const loader = await import('./assetLoader.js');
    const renderer = await import('./characterSheetRenderer.js');
    const sync = await import('../engine/agentSync.js');
    return { ...loader, ...renderer, ...sync };
  }
  const entry = (paletteIndex: number, suffix = 'good') => ({
    id: `external_${paletteIndex}`, paletteIndex, uri: `data:image/png;base64,${suffix}`,
  });

  it('preserves six built-in identities, stored hue variants, and their draw commands for indices 0-63', async () => {
    const m = await modules();
    expect(m.getFullDiagnosticReport().characterSheetKeys).toEqual([
      'builtin:0', 'builtin:1', 'builtin:2', 'builtin:3', 'builtin:4', 'builtin:5',
    ]);
    const sheets = Array.from({ length: 6 }, (_, index) => m.getCharacterSheet(`builtin:${index}`));
    expect(sheets.every((sheet) => sheet?.layout === 'pixel-agents'
      && sheet.frameWidth === 16 && sheet.frameHeight === 32
      && sheet.baseWidth === 16 && sheet.baseHeight === 32
      && sheet.framesPerRow === 7 && sheet.rows === 3)).toBe(true);
    for (let index = 0; index < 64; index++) {
      const { palette, hueShift } = m.appearanceFromIndex(index);
      const appearance = m.sheetAppearance(palette, hueShift);
      expect(palette).toBe(index % 6);
      expect(hueShift).toBe((Math.floor(index / 6) * 45) % 360);
      expect(appearance).toEqual({
        sheetKey: `builtin:${palette}`,
        hueDegrees: hueShift,
      });
      for (const direction of [Direction.DOWN, Direction.LEFT, Direction.RIGHT, Direction.UP]) {
        const ctx = {
          drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(),
          translate: vi.fn(), scale: vi.fn(), filter: '',
        };
        expect(m.drawCharacterFromSheet(ctx as unknown as CanvasRenderingContext2D, palette, direction, 3, 10, 20, 2, hueShift)).toBe(true);
        const row = direction === Direction.DOWN ? 0
          : direction === Direction.UP ? 1 : 2;
        const x = direction === Direction.LEFT ? 0 : 10;
        const y = direction === Direction.LEFT ? 0 : 20;
        expect(ctx.drawImage).toHaveBeenCalledWith(
          sheets[palette]?.image, 16, row * 32, 16, 32, x, y, 32, 64,
        );
        if (direction === Direction.LEFT) {
          expect(ctx.translate).toHaveBeenCalledWith(42, 20);
          expect(ctx.scale).toHaveBeenCalledWith(-1, 1);
        }
        expect(ctx.filter).toBe(appearance.hueDegrees ? `hue-rotate(${appearance.hueDegrees}deg)` : '');
      }
    }
  });

  it('adds, replaces and removes external sheets without touching persisted legacy looks', async () => {
    const m = await modules();
    const a = m.EXTERNAL_CHARACTER_BASE + 48 * 123;
    const b = m.EXTERNAL_CHARACTER_BASE + 48 * 456;
    const appearances = Array.from({ length: 64 }, (_, i) => {
      const p = m.appearanceFromIndex(i);
      return m.sheetAppearance(p.palette, p.hueShift);
    });
    const originalSheet = m.getCharacterSheet('builtin:0');
    await m.loadCharacterSheetsFromUris([entry(a), entry(b)]);
    expect(m.sheetAppearance(a)).toEqual({ sheetKey: `external:${a}`, hueDegrees: 0 });
    expect(m.sheetAppearance(b)).toEqual({ sheetKey: `external:${b}`, hueDegrees: 0 });
    const externalA = m.getCharacterSheet(`external:${a}`);
    await m.loadCharacterSheetsFromUris([entry(b), entry(a)]);
    expect(m.getCharacterSheet(`external:${a}`)).toBe(externalA);
    expect(m.sheetAppearance(a)).toEqual({ sheetKey: `external:${a}`, hueDegrees: 0 });
    await m.loadCharacterSheetsFromUris([entry(a, 'replacement')]);
    expect(m.getCharacterSheet(`external:${a}`)).not.toBe(externalA);
    expect(m.getCharacterSheet(`external:${b}`)).toBeNull();
    expect(m.sheetAppearance(b)).toEqual({ sheetKey: 'builtin:0', hueDegrees: 0 });
    await m.loadCharacterSheetsFromUris([]);
    expect(m.sheetAppearance(a)).toEqual({ sheetKey: 'builtin:0', hueDegrees: 0 });
    expect(m.getCharacterSheet('builtin:0')).toBe(originalSheet);
    expect(Array.from({ length: 64 }, (_, i) => {
      const p = m.appearanceFromIndex(i);
      return m.sheetAppearance(p.palette, p.hueShift);
    })).toEqual(appearances);
  });

  it('isolates bad image decodes and wrong dimensions, and rejects bundled overrides', async () => {
    const m = await modules();
    const base = m.EXTERNAL_CHARACTER_BASE;
    const errors = await m.loadCharacterSheetsFromUris([
      entry(base), entry(base + 48, 'bad'), entry(base + 96, 'dimensions'),
      { id: 'char_employeeA', uri: 'data:image/png;base64,good', paletteIndex: 0 },
    ]);
    expect(errors).toHaveLength(3);
    expect(m.getCharacterSheet(`external:${base}`)).not.toBeNull();
    expect(m.getCharacterSheet(`external:${base + 48}`)).toBeNull();
    expect(m.getCharacterSheet(`external:${base + 96}`)).toBeNull();
    expect(m.getFullDiagnosticReport().characterSheetKeys).toEqual([
      'builtin:0', 'builtin:1', 'builtin:2', 'builtin:3', 'builtin:4', 'builtin:5', `external:${base}`,
    ]);
  });

  it('keeps stale asynchronous decodes from resurrecting removed sheets', async () => {
    const images: FixtureImage[] = [];
    vi.stubGlobal('Image', class extends FixtureImage {
      constructor() { super(); images.push(this); }
    });
    const m = await modules();
    const pending = m.loadCharacterSheetsFromUris([entry(m.EXTERNAL_CHARACTER_BASE, 'pending')]);
    await m.loadCharacterSheetsFromUris([]);
    images[0].onload?.();
    await pending;
    expect(m.getFullDiagnosticReport().characterSheetKeys).toEqual([
      'builtin:0', 'builtin:1', 'builtin:2', 'builtin:3', 'builtin:4', 'builtin:5',
    ]);
  });

  it('uses the exact legacy fallback cycle for persisted external variants', async () => {
    const m = await modules();
    for (let variant = 0; variant < 48; variant++) {
      const index = m.EXTERNAL_CHARACTER_BASE + 123 * 48 + variant;
      const legacy = { palette: index % 6, hueShift: Math.floor(index / 6) * 45 % 360 };
      expect(m.sheetAppearance(index)).toEqual(m.sheetAppearance(legacy.palette, legacy.hueShift));
      expect(m.appearanceFromIndex(index)).toEqual({ palette: index, hueShift: 0 });
    }
  });
});
