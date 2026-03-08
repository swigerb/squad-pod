/**
 * PNG Asset Preloader
 *
 * Loads tileset and character sprite sheet PNGs, pre-processes them
 * (background removal for characters), and provides them to renderers.
 * Falls back gracefully if assets can't be loaded — existing inline
 * sprite rendering continues to work.
 *
 * Supports two metadata formats:
 *   - tileset-metadata.json (rich: typed items with bounds + interactables)
 *   - tileset.json (legacy: simple name→region object map)
 */

import { TILE_SIZE } from '../types.js';

// ── Types — legacy tileset.json format ────────────────────────────

export interface TilesetObjectDef {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TilesetData {
  image: HTMLImageElement;
  objects: Record<string, TilesetObjectDef>;
  tileSize: number;
}

// ── Types — rich tileset-metadata.json format ─────────────────────

export type ItemType = 'floor' | 'wall' | 'furniture' | 'electronics' | 'appliance' | 'decoration';

export interface ItemBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TilesetItem {
  id: string;
  type: ItemType;
  bounds: ItemBounds;
}

export interface TilesetInteractable {
  item_id: string;
  action: string;
}

export interface TilesetMetadata {
  tileset_name: string;
  tile_size: number;
  asset_source: string;
  items: TilesetItem[];
  interactables: TilesetInteractable[];
}

export interface CharacterSheetData {
  /** Pre-processed canvas with background removed (transparent). */
  image: HTMLCanvasElement;
  /** Width of a single frame in source pixels. */
  frameWidth: number;
  /** Height of a single frame in source pixels. */
  frameHeight: number;
  /** Number of animation frames per direction row. */
  framesPerRow: number;
  /** Number of direction rows (always 4). */
  rows: number;
  /** Source pixels per base game pixel (e.g. 20 if 320px row = 16 base). */
  scale: number;
  /** Base frame width in game pixels (frameWidth / scale). */
  baseWidth: number;
  /** Base frame height in game pixels (frameHeight / scale). */
  baseHeight: number;
}

// ── Module state ──────────────────────────────────────────────────

let tilesetData: TilesetData | null = null;
const characterSheets = new Map<string, CharacterSheetData>();
let loadingPromise: Promise<void> | null = null;
let assetsReady = false;
let assetBaseUrl = '';

// ── Rich metadata state ──────────────────────────────────────────

let tilesetMetadata: TilesetMetadata | null = null;
let tilesetMetadataImage: HTMLImageElement | null = null;
const itemById = new Map<string, TilesetItem>();
const itemsByType = new Map<ItemType, TilesetItem[]>();
let interactables: TilesetInteractable[] = [];

// ── Public accessors ──────────────────────────────────────────────

export function areAssetsReady(): boolean {
  return assetsReady;
}

export function getTilesetData(): TilesetData | null {
  return tilesetData;
}

export function getCharacterSheet(key: string): CharacterSheetData | null {
  return characterSheets.get(key) ?? null;
}

/** Set the base URL for assets (e.g. from extension webview URI). */
export function setAssetBaseUrl(url: string): void {
  assetBaseUrl = url.endsWith('/') ? url : url + '/';
}

// ── Rich metadata accessors ──────────────────────────────────────

/** Returns the loaded TilesetMetadata, or null if only legacy data is available. */
export function getTilesetMetadata(): TilesetMetadata | null {
  return tilesetMetadata;
}

/** Returns the tileset PNG image loaded for the rich metadata path. */
export function getTilesetMetadataImage(): HTMLImageElement | null {
  return tilesetMetadataImage;
}

/** Look up a single tileset item by its unique id (e.g. "desk_work_monitor"). */
export function getItemById(id: string): TilesetItem | undefined {
  return itemById.get(id);
}

/** Get all tileset items of a given type category (e.g. "furniture", "appliance"). */
export function getItemsByType(type: ItemType): TilesetItem[] {
  return itemsByType.get(type) ?? [];
}

/** Get the interactables list — items that support player interaction. */
export function getInteractables(): TilesetInteractable[] {
  return interactables;
}

/**
 * Ingest rich tileset metadata sent by the extension host via
 * `tilesetMetadataLoaded`.  Builds the id and type lookup indexes,
 * then loads the tileset PNG image in the browser.
 */
export function setTilesetMetadata(metadata: TilesetMetadata, tilesetPngUri: string): void {
  console.log('[assetLoader] setTilesetMetadata called with', metadata.items?.length, 'items, URI:', tilesetPngUri.slice(0, 80));
  tilesetMetadata = metadata;
  interactables = metadata.interactables ?? [];

  // Build lookup indexes
  itemById.clear();
  itemsByType.clear();
  for (const item of metadata.items) {
    itemById.set(item.id, item);
    const bucket = itemsByType.get(item.type);
    if (bucket) {
      bucket.push(item);
    } else {
      itemsByType.set(item.type, [item]);
    }
  }
  console.log('[assetLoader] itemById has', itemById.size, 'entries; floor_wood?', itemById.has('floor_wood'), 'wall_white_panel?', itemById.has('wall_white_panel'));

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    tilesetMetadataImage = img;
    assetsReady = true;
    console.log(`[assetLoader] ✅ Tileset metadata PNG loaded: ${img.width}×${img.height}, assetsReady=true`);
  };
  img.onerror = (e) => {
    console.error('[assetLoader] ❌ Failed to load tileset PNG for metadata:', tilesetPngUri, e);
    // Retry without crossOrigin — some VS Code webview environments
    // serve local files without CORS headers, causing crossOrigin
    // loads to fail even though non-CORS loads succeed.
    const retry = new Image();
    retry.onload = () => {
      tilesetMetadataImage = retry;
      assetsReady = true;
      console.log(`[assetLoader] ✅ Tileset metadata PNG loaded (retry, no CORS): ${retry.width}×${retry.height}`);
    };
    retry.onerror = (e2) => {
      console.error('[assetLoader] ❌ Tileset PNG retry also failed:', e2);
    };
    retry.src = tilesetPngUri;
  };
  img.src = tilesetPngUri;
}

/**
 * Ingest legacy tileset data from a `tilesetAssetsLoaded` message.
 * Loads the tileset PNG and populates the legacy TilesetData used by
 * renderers calling `getTilesetData()` / `drawTilesetFurniture()`.
 *
 * The legacy tileset.json uses different object names than
 * tileset-metadata.json, so both paths must be populated for full
 * rendering support.
 */
export function setLegacyTilesetAssets(
  data: { tile_size?: number; objects: Record<string, TilesetObjectDef> },
  tilesetPngUri: string,
): void {
  console.log('[assetLoader] setLegacyTilesetAssets called with', Object.keys(data.objects ?? {}).length, 'objects');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    tilesetData = {
      image: img,
      objects: data.objects ?? {},
      tileSize: data.tile_size ?? TILE_SIZE,
    };
    assetsReady = true;
    console.log(`[assetLoader] ✅ Legacy tileset PNG loaded: ${img.width}×${img.height}, ${Object.keys(data.objects ?? {}).length} objects, assetsReady=true`);
  };
  img.onerror = (e) => {
    console.error('[assetLoader] ❌ Failed to load legacy tileset PNG:', tilesetPngUri, e);
    // Retry without crossOrigin
    const retry = new Image();
    retry.onload = () => {
      tilesetData = {
        image: retry,
        objects: data.objects ?? {},
        tileSize: data.tile_size ?? TILE_SIZE,
      };
      assetsReady = true;
      console.log(`[assetLoader] ✅ Legacy tileset PNG loaded (retry, no CORS): ${retry.width}×${retry.height}`);
    };
    retry.onerror = (e2) => {
      console.error('[assetLoader] ❌ Legacy tileset PNG retry also failed:', e2);
    };
    retry.src = tilesetPngUri;
  };
  img.src = tilesetPngUri;
}

// ── Internals ─────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/**
 * Remove the near-white background from a sprite sheet by making
 * matching pixels transparent.  Samples the top-left corner for
 * the reference colour.
 *
 * If `getImageData()` throws (e.g. cross-origin canvas taint in
 * a VS Code webview), returns the canvas with the raw image drawn
 * on it — the character will have a visible background, but at
 * least it renders.
 */
function removeBackground(img: HTMLImageElement, tolerance: number = 45): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  try {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;

    // Reference background from top-left pixel
    const bgR = d[0], bgG = d[1], bgB = d[2];

    for (let i = 0; i < d.length; i += 4) {
      const dr = Math.abs(d[i] - bgR);
      const dg = Math.abs(d[i + 1] - bgG);
      const db = Math.abs(d[i + 2] - bgB);
      if (dr + dg + db < tolerance) {
        d[i + 3] = 0; // transparent
      }
    }

    ctx.putImageData(imageData, 0, 0);
  } catch (e) {
    // Canvas tainted by cross-origin image (SecurityError).
    // Return canvas with raw image — character has a background
    // but at least renders instead of falling back to colored circles.
    console.warn('[assetLoader] removeBackground failed (CORS?), using raw image:', e);
  }
  return canvas;
}

function resolveUrl(relativePath: string): string {
  return assetBaseUrl + relativePath;
}

// ── URI-based character sheet loader ──────────────────────────────

/**
 * Load character sprite sheets from webview-safe URIs sent by the
 * extension host via `characterAssetsLoaded`.  Each entry has an id
 * like "char_employeeA" and a webview URI pointing to the PNG.
 *
 * This populates the same `characterSheets` Map used by
 * `drawCharacterFromSheet()`, keyed by the trailing letter (A–D).
 */
export function loadCharacterSheetsFromUris(
  characters: Array<{ id: string; uri: string }>
): void {
  console.log('[assetLoader] loadCharacterSheetsFromUris called with', characters.length, 'sheets');

  for (const { id, uri } of characters) {
    // Extract sheet key: "char_employeeA" → "A"
    const key = id.replace(/^char_employee/, '');
    if (!key) {
      console.warn('[assetLoader] Could not extract sheet key from id:', id);
      continue;
    }

    const processImage = (img: HTMLImageElement, label: string) => {
      try {
        const processed = removeBackground(img);

        const rows = 4;
        const frameHeight = img.height / rows;
        const scale = Math.round(frameHeight / TILE_SIZE);
        const baseHeight = Math.round(frameHeight / scale);
        const framesPerRow = img.width % 7 === 0 ? 7 : Math.round(img.width / (baseHeight * scale * (img.width / img.height)));
        const frameWidth = Math.round(img.width / (framesPerRow || 7));
        const baseWidth = Math.round(frameWidth / scale);

        characterSheets.set(key, {
          image: processed,
          frameWidth,
          frameHeight,
          framesPerRow: framesPerRow || 7,
          rows,
          scale,
          baseWidth,
          baseHeight,
        });

        console.log(`[assetLoader] ✅ Character sheet "${key}" loaded (${label}): ${img.width}×${img.height}, ${framesPerRow}×${rows} frames, scale=${scale}`);
        assetsReady = true;
      } catch (e) {
        console.error(`[assetLoader] ❌ Error processing character sheet "${key}" (${label}):`, e);
      }
    };

    // Try with crossOrigin first (enables removeBackground pixel access)
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => processImage(img, 'CORS');
    img.onerror = () => {
      // Retry without crossOrigin — image will load but canvas may be tainted
      console.warn(`[assetLoader] Character sheet "${key}" CORS load failed, retrying without crossOrigin`);
      const retry = new Image();
      retry.onload = () => processImage(retry, 'no-CORS');
      retry.onerror = (e) => {
        console.error(`[assetLoader] ❌ Character sheet "${key}" failed to load entirely:`, uri.slice(0, 80), e);
      };
      retry.src = uri;
    };
    img.src = uri;
  }
}

// ── Public loader ─────────────────────────────────────────────────

/**
 * Kick off asset loading.  Safe to call multiple times — returns the
 * same promise if already loading.  On failure, sets `assetsReady` to
 * false so inline sprite rendering continues to work.
 */
export function loadAssets(): Promise<void> {
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      // Load tileset image + JSON in parallel
      const [tilesetImg, tilesetJson] = await Promise.all([
        loadImage(resolveUrl('assets/tileset_office.png')),
        fetch(resolveUrl('assets/tileset.json')).then(r => {
          if (!r.ok) throw new Error(`tileset.json: ${r.status}`);
          return r.json();
        }),
      ]);

      tilesetData = {
        image: tilesetImg,
        objects: tilesetJson.objects ?? {},
        tileSize: tilesetJson.tile_size ?? TILE_SIZE,
      };

      // Load all character sprite sheets in parallel
      const charKeys = ['A', 'B', 'C', 'D', 'E'];
      const charImages = await Promise.all(
        charKeys.map(key =>
          loadImage(resolveUrl(`assets/characters/char_employee${key}.png`))
        ),
      );

      for (let i = 0; i < charKeys.length; i++) {
        const img = charImages[i];
        const processed = removeBackground(img);

        const rows = 4;
        const frameHeight = img.height / rows;
        const scale = Math.round(frameHeight / TILE_SIZE);
        const baseHeight = Math.round(frameHeight / scale);
        // Determine frame width: try dividing evenly by 7 first (known layout)
        const framesPerRow = img.width % 7 === 0 ? 7 : Math.round(img.width / (baseHeight * scale * (img.width / img.height)));
        const frameWidth = Math.round(img.width / (framesPerRow || 7));
        const baseWidth = Math.round(frameWidth / scale);

        characterSheets.set(charKeys[i], {
          image: processed,
          frameWidth,
          frameHeight,
          framesPerRow: framesPerRow || 7,
          rows,
          scale,
          baseWidth,
          baseHeight,
        });
      }

      assetsReady = true;
    } catch (e) {
      console.warn('[assetLoader] PNG assets unavailable via URL fetch, using inline sprites:', e);
      // Only reset if URI-based loaders haven't already loaded assets
      if (!tilesetMetadataImage && characterSheets.size === 0 && !tilesetData) {
        assetsReady = false;
      }
    }
  })();

  return loadingPromise;
}
