# Skill: Metadata-Driven Tileset Rendering

## Pattern

Use a JSON metadata file as the single source of truth for sprite sheet clipping, collision classification, and interactable definitions. Rendering, collision, and interaction modules consume the same metadata through typed accessors.

## When to Use

- Adding new tileset items (just add to tileset-metadata.json — no code changes)
- Building collision layers from sprite sheet metadata
- Creating interactable systems tied to specific items

## Key Techniques

### Multi-tile grid calculation
```typescript
const cols = Math.ceil(item.bounds.width / TILE_SIZE);  // 48px → 3 tiles
const rows = Math.ceil(item.bounds.height / TILE_SIZE);  // 32px → 2 tiles
```

### Type-based collision classification
```typescript
const BLOCKING_TYPES: ReadonlySet<ItemType> = new Set(['furniture', 'electronics', 'appliance', 'wall']);
const isBlocking = BLOCKING_TYPES.has(item.type);  // O(1)
```

### Metadata-driven drawImage clipping
```typescript
const { x, y, width, height } = item.bounds;
ctx.drawImage(image, x, y, width, height, destX, destY, width * zoom, height * zoom);
```

## Files

- `webview-ui/src/office/sprites/tilesetRenderer.ts` — Rendering functions
- `webview-ui/src/office/engine/collision.ts` — Collision layer
- `webview-ui/src/office/engine/interactables.ts` — Interactable registry
- `webview-ui/public/assets/tileset-metadata.json` — Source of truth
