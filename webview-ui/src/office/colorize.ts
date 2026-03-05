import type { FloorColor, SpriteData } from './types.js';

const colorizeCache = new Map<string, SpriteData>();

export function getColorizedSprite(
  cacheKey: string,
  sprite: SpriteData,
  color: FloorColor
): SpriteData {
  if (colorizeCache.has(cacheKey)) {
    return colorizeCache.get(cacheKey)!;
  }

  const result = color.colorize
    ? colorizeSprite(sprite, color)
    : adjustSprite(sprite, color);

  colorizeCache.set(cacheKey, result);
  return result;
}

export function clearColorizeCache(): void {
  colorizeCache.clear();
}

function colorizeSprite(sprite: SpriteData, color: FloorColor): SpriteData {
  const h = color.h;
  const s = color.s / 100;
  const brightness = color.b / 100;
  const contrast = color.c / 100;

  return sprite.map((row) =>
    row.map((hex) => {
      if (!hex) return '';

      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);

      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      let lightness = gray / 255;

      lightness += brightness;
      lightness = (lightness - 0.5) * (1 + contrast) + 0.5;
      lightness = Math.max(0, Math.min(1, lightness));

      return hslToHex(h, s, lightness);
    })
  );
}

function adjustSprite(sprite: SpriteData, color: FloorColor): SpriteData {
  const hueShift = color.h;
  const satShift = color.s / 100;
  const brightness = color.b / 100;
  const contrast = color.c / 100;

  return sprite.map((row) =>
    row.map((hex) => {
      if (!hex) return '';

      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);

      let [h, s, l] = rgbToHsl(r, g, b);

      h = (h + hueShift) % 360;
      if (h < 0) h += 360;

      s = Math.max(0, Math.min(1, s + satShift));

      l += brightness;
      l = (l - 0.5) * (1 + contrast) + 0.5;
      l = Math.max(0, Math.min(1, l));

      return hslToHex(h, s, l);
    })
  );
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0,
    g = 0,
    b = 0;

  if (h >= 0 && h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h >= 60 && h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h >= 180 && h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h >= 240 && h < 300) {
    r = x;
    g = 0;
    b = c;
  } else if (h >= 300 && h < 360) {
    r = c;
    g = 0;
    b = x;
  }

  const rByte = clamp255((r + m) * 255);
  const gByte = clamp255((g + m) * 255);
  const bByte = clamp255((b + m) * 255);

  return (
    '#' +
    rByte.toString(16).padStart(2, '0') +
    gByte.toString(16).padStart(2, '0') +
    bByte.toString(16).padStart(2, '0')
  );
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    if (max === r) {
      h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
    } else if (max === g) {
      h = ((b - r) / delta + 2) * 60;
    } else {
      h = ((r - g) / delta + 4) * 60;
    }
  }

  return [h, s, l];
}

function clamp255(v: number): number {
  return Math.round(Math.max(0, Math.min(255, v)));
}
