# Decision: Tileset PNG Replaces Colored Rectangles for Tile Grid Rendering

**Author:** Lisa Simpson
**Date:** 2026-03-08
**Status:** Implemented

## Context

The renderer always drew floor and wall tiles as colored rectangles (HSB-adjusted solid fills for walls, colorized inline sprites for floors). Custom tileset assets were loaded into memory but never used for tile grid rendering — only furniture used the tileset via `drawTilesetFurniture()`.

## Decision

When tileset metadata and the tileset PNG are loaded, `renderTileGrid()` now draws floor and wall tiles directly from the tileset sprite sheet. Colored rendering is preserved as a fallback when assets aren't available.

**TileType → Tileset item mapping:**
- `FLOOR_1` → `floor_wood`
- `FLOOR_2` → `floor_blue_diamond`
- `FLOOR_3–7` → alternating `floor_wood`/`floor_blue_diamond`
- `WALL` → `wall_white_panel` (clipped to top 16px of 16×32 source)

## Rationale

The tileset PNG contains hand-crafted pixel art that looks significantly better than procedurally colored rectangles. The asset delivery pipeline was already working correctly — only the renderer was missing the connection.

## Impact

- **Rendering:** Office now shows tileset artwork instead of flat colors when custom assets are present
- **Fallback:** No-asset installs continue working with colored rectangles
- **Performance:** `drawImage()` from a cached `HTMLImageElement` is faster than `getColorizedSprite()` → `getCachedSprite()` → `drawImage()`
- **Future:** Additional floor/wall variants in tileset-metadata.json can be mapped to new TileType values by extending `tileTypeToMetadataItem` in `tilesetRenderer.ts`
