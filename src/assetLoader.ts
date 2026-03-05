/**
 * assetLoader.ts — Load and parse PNG sprite assets for the pixel-art office.
 *
 * Ported from pixel-agents with the same PNG decoding and sprite slicing logic.
 * All assets live in `dist/assets/` (copied there by the esbuild copy plugin).
 */

import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import type {
  SpriteData,
  FurnitureAsset,
  CharacterSpriteSet,
  LayoutData,
} from './types.js';
import {
  PNG_ALPHA_THRESHOLD,
  WALL_PIECE_WIDTH,
  WALL_PIECE_HEIGHT,
  WALL_GRID_COLS,
  WALL_BITMASK_COUNT,
  FLOOR_PATTERN_COUNT,
  FLOOR_TILE_SIZE,
  CHARACTER_DIRECTIONS,
  CHAR_FRAME_W,
  CHAR_FRAME_H,
  CHAR_FRAMES_PER_ROW,
  CHAR_COUNT,
} from './constants.js';

// ─── PNG Helpers ────────────────────────────────────────────────────

/**
 * Decode a PNG file into raw RGBA pixel data.
 */
function decodePng(filePath: string): PNG {
  const buffer = fs.readFileSync(filePath);
  return PNG.sync.read(buffer);
}

/**
 * Convert a PNG image (or a region of one) into a SpriteData object.
 * Each pixel is stored as an integer: (r << 24) | (g << 16) | (b << 8) | a.
 * Pixels below the alpha threshold are stored as 0 (fully transparent).
 */
export function pngToSpriteData(
  png: PNG,
  srcX = 0,
  srcY = 0,
  width?: number,
  height?: number,
): SpriteData {
  const w = width ?? png.width;
  const h = height ?? png.height;
  const pixels: number[] = new Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = ((srcY + y) * png.width + (srcX + x)) * 4;
      const r = png.data[srcIdx] ?? 0;
      const g = png.data[srcIdx + 1] ?? 0;
      const b = png.data[srcIdx + 2] ?? 0;
      const a = png.data[srcIdx + 3] ?? 0;

      if (a < PNG_ALPHA_THRESHOLD) {
        pixels[y * w + x] = 0;
      } else {
        pixels[y * w + x] = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
      }
    }
  }

  return { width: w, height: h, pixels };
}

// ─── Asset Resolvers ────────────────────────────────────────────────

function resolveAssetPath(extensionPath: string, ...segments: string[]): string {
  return path.join(extensionPath, 'dist', 'assets', ...segments);
}

function assetExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// ─── Furniture Assets ───────────────────────────────────────────────

/**
 * Load all furniture sprite PNGs from `dist/assets/furniture/`.
 * Each PNG file becomes one FurnitureAsset.
 */
export function loadFurnitureAssets(extensionPath: string): FurnitureAsset[] {
  const dir = resolveAssetPath(extensionPath, 'furniture');
  if (!assetExists(dir)) {
    return [];
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
  const assets: FurnitureAsset[] = [];

  for (const file of files) {
    try {
      const png = decodePng(path.join(dir, file));
      const sprite = pngToSpriteData(png);
      assets.push({
        name: path.basename(file, '.png'),
        sprite,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return assets;
}

// ─── Floor Tiles ────────────────────────────────────────────────────

/**
 * Load floor tile patterns from `dist/assets/floor.png`.
 * The PNG contains FLOOR_PATTERN_COUNT patterns laid out horizontally,
 * each FLOOR_TILE_SIZE × FLOOR_TILE_SIZE.
 */
export function loadFloorTiles(extensionPath: string): SpriteData[] {
  const filePath = resolveAssetPath(extensionPath, 'floor.png');
  if (!assetExists(filePath)) {
    return [];
  }

  const png = decodePng(filePath);
  const tiles: SpriteData[] = [];

  for (let i = 0; i < FLOOR_PATTERN_COUNT; i++) {
    const srcX = i * FLOOR_TILE_SIZE;
    if (srcX + FLOOR_TILE_SIZE > png.width) {break;}
    tiles.push(pngToSpriteData(png, srcX, 0, FLOOR_TILE_SIZE, FLOOR_TILE_SIZE));
  }

  return tiles;
}

// ─── Wall Tiles ─────────────────────────────────────────────────────

/**
 * Load wall tiles from `dist/assets/walls.png`.
 * The PNG is a grid of WALL_GRID_COLS columns, with WALL_BITMASK_COUNT
 * entries of WALL_PIECE_WIDTH × WALL_PIECE_HEIGHT each.
 */
export function loadWallTiles(extensionPath: string): SpriteData[] {
  const filePath = resolveAssetPath(extensionPath, 'walls.png');
  if (!assetExists(filePath)) {
    return [];
  }

  const png = decodePng(filePath);
  const tiles: SpriteData[] = [];

  for (let i = 0; i < WALL_BITMASK_COUNT; i++) {
    const col = i % WALL_GRID_COLS;
    const row = Math.floor(i / WALL_GRID_COLS);
    const srcX = col * WALL_PIECE_WIDTH;
    const srcY = row * WALL_PIECE_HEIGHT;

    if (srcX + WALL_PIECE_WIDTH > png.width || srcY + WALL_PIECE_HEIGHT > png.height) {
      break;
    }

    tiles.push(pngToSpriteData(png, srcX, srcY, WALL_PIECE_WIDTH, WALL_PIECE_HEIGHT));
  }

  return tiles;
}

// ─── Character Sprites ──────────────────────────────────────────────

/**
 * Load character sprite sheets from `dist/assets/characters/`.
 * Each palette index has a corresponding `char{N}.png` file (0-indexed).
 *
 * Sprite sheet layout per character:
 *   Row 0: down  — 7 frames (idle 0, walk 0-2, idle 1, walk 3-5)  [approximation]
 *   Row 1: up    — 7 frames
 *   Row 2: right — 7 frames
 *
 * Each frame is CHAR_FRAME_W × CHAR_FRAME_H.
 * Idle frames: indices 0 and 4
 * Walk frames: indices 1-3 and 5-6
 */
export function loadCharacterSprites(extensionPath: string): CharacterSpriteSet[] {
  const dir = resolveAssetPath(extensionPath, 'characters');
  if (!assetExists(dir)) {
    return [];
  }

  const spriteSets: CharacterSpriteSet[] = [];

  for (let charIdx = 0; charIdx < CHAR_COUNT; charIdx++) {
    const filePath = path.join(dir, `char${charIdx}.png`);
    if (!assetExists(filePath)) {
      continue;
    }

    try {
      const png = decodePng(filePath);
      const directions: CharacterSpriteSet['directions'] = {};

      CHARACTER_DIRECTIONS.forEach((dir, rowIdx) => {
        const idle: SpriteData[] = [];
        const walk: SpriteData[] = [];

        for (let frame = 0; frame < CHAR_FRAMES_PER_ROW; frame++) {
          const srcX = frame * CHAR_FRAME_W;
          const srcY = rowIdx * CHAR_FRAME_H;

          if (srcX + CHAR_FRAME_W > png.width || srcY + CHAR_FRAME_H > png.height) {
            break;
          }

          const sprite = pngToSpriteData(png, srcX, srcY, CHAR_FRAME_W, CHAR_FRAME_H);

          // Frames 0 and 4 are idle poses; the rest are walk
          if (frame === 0 || frame === 4) {
            idle.push(sprite);
          } else {
            walk.push(sprite);
          }
        }

        directions[dir] = { idle, walk };
      });

      spriteSets.push({ paletteIndex: charIdx, directions });
    } catch {
      // Skip unreadable sprite sheets
    }
  }

  return spriteSets;
}

// ─── Default Layout ─────────────────────────────────────────────────

/**
 * Load the default office layout from `dist/assets/layout.json`.
 */
export function loadDefaultLayout(extensionPath: string): LayoutData | null {
  const filePath = resolveAssetPath(extensionPath, 'layout.json');
  if (!assetExists(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as LayoutData;
  } catch {
    return null;
  }
}
