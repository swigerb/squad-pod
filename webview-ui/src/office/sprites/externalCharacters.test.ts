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

  it('preserves the embedded A/B pair and pinned-master draw commands for indices 0-63', async () => {
    const m = await modules();
    expect(m.getFullDiagnosticReport().characterSheetKeys).toEqual(['A', 'B']);
    const sheets = [m.getCharacterSheet('A'), m.getCharacterSheet('B')];
    expect(sheets.every((sheet) => sheet?.frameWidth === 32 && sheet.frameHeight === 32
      && sheet.baseWidth === 16 && sheet.baseHeight === 16 && sheet.framesPerRow === 7 && sheet.rows === 4)).toBe(true);
    // Frozen mapping from 949972fc: A/B alternation, three variants, 45-degree groups.
    const golden = [
      'A:0', 'B:0', 'A:120', 'B:120', 'A:240', 'B:240',
      'A:45', 'B:45', 'A:165', 'B:165', 'A:285', 'B:285',
      'A:90', 'B:90', 'A:210', 'B:210', 'A:330', 'B:330',
      'A:135', 'B:135', 'A:255', 'B:255', 'A:15', 'B:15',
      'A:180', 'B:180', 'A:300', 'B:300', 'A:60', 'B:60',
      'A:225', 'B:225', 'A:345', 'B:345', 'A:105', 'B:105',
      'A:270', 'B:270', 'A:30', 'B:30', 'A:150', 'B:150',
      'A:315', 'B:315', 'A:75', 'B:75', 'A:195', 'B:195',
      'A:0', 'B:0', 'A:120', 'B:120', 'A:240', 'B:240',
      'A:45', 'B:45', 'A:165', 'B:165', 'A:285', 'B:285',
      'A:90', 'B:90', 'A:210', 'B:210',
    ];
    for (let index = 0; index < 64; index++) {
      const { palette, hueShift } = m.appearanceFromIndex(index);
      const appearance = m.sheetAppearance(palette, hueShift);
      expect(`${appearance.sheetKey}:${appearance.hueDegrees}`).toBe(golden[index]);
      for (const direction of [Direction.DOWN, Direction.LEFT, Direction.RIGHT, Direction.UP]) {
        const ctx = { drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), filter: '' };
        expect(m.drawCharacterFromSheet(ctx as unknown as CanvasRenderingContext2D, palette, direction, 3, 10, 20, 2, hueShift)).toBe(true);
        const rows = [2, 3, 1, 0];
        expect(ctx.drawImage).toHaveBeenCalledWith(
          sheets[index % 2]?.image, 96, rows[direction] * 32, 32, 32, 10, 20, 32, 32,
        );
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
    const originalA = m.getCharacterSheet('A');
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
    expect(m.sheetAppearance(b)).toEqual({ sheetKey: 'A', hueDegrees: 0 });
    await m.loadCharacterSheetsFromUris([]);
    expect(m.sheetAppearance(a)).toEqual({ sheetKey: 'A', hueDegrees: 0 });
    expect(m.getCharacterSheet('A')).toBe(originalA);
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
    expect(m.getFullDiagnosticReport().characterSheetKeys).toEqual(['A', 'B', `external:${base}`]);
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
    expect(m.getFullDiagnosticReport().characterSheetKeys).toEqual(['A', 'B']);
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
