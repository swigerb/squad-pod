# Custom asset manifests

Squad Pod can load local furniture, pets, and character sheets from directories you add in **Settings → Add Asset Directory**. Asset files stay local. Changes are detected automatically; unloading a directory does not delete files or remove placed items from layouts.

## Furniture

Select a directory whose immediate subfolders each contain a `manifest.json` and the referenced PNG:

```text
my-assets/
  lamp-pack/
    manifest.json
    lamp.png
```

The manifest describes one or more furniture sprites. For a single sprite, use:

```json
{
  "id": "lamp-pack",
  "name": "Lamp pack",
  "category": "decor",
  "type": "asset",
  "file": "lamp.png",
  "width": 16,
  "height": 16,
  "footprintW": 1,
  "footprintH": 1,
  "canPlaceOnWalls": false,
  "canPlaceOnSurfaces": false,
  "backgroundTiles": 0
}
```

`file` is optional and defaults to `<id>.png`. `width` and `height` are image pixels; the sprite must exactly match its footprint at 16 pixels per tile.

Items with `canPlaceOnSurfaces: true` belong to an overlapping desk (`category: "desks"`). The largest footprint overlap wins, with layout order breaking ties. Rendering and grouped editor moves use the same ownership: the desk draws first, then its accessories, at the desk's normal scene depth. Foreground characters and furniture can still obscure the group. No group IDs are added to saved layouts.

### Directional rotation groups

Use a `group` with `groupType: "rotation"` to offer directional sprites as one furniture item. Each `asset` member needs its own `id`, image dimensions, footprint, and `orientation`. For example:

```json
{
  "id": "chair-pack",
  "name": "Chair pack",
  "category": "chairs",
  "type": "group",
  "groupType": "rotation",
  "rotationScheme": "4-way",
  "canPlaceOnWalls": false,
  "canPlaceOnSurfaces": false,
  "backgroundTiles": 0,
  "members": [
    { "type": "asset", "id": "chair-front", "orientation": "front", "width": 16, "height": 16, "footprintW": 1, "footprintH": 1 },
    { "type": "asset", "id": "chair-right", "orientation": "right", "width": 16, "height": 16, "footprintW": 1, "footprintH": 1 },
    { "type": "asset", "id": "chair-back", "orientation": "back", "width": 16, "height": 16, "footprintW": 1, "footprintH": 1 },
    { "type": "asset", "id": "chair-left", "orientation": "left", "width": 16, "height": 16, "footprintW": 1, "footprintH": 1 }
  ]
}
```

Orientations are `front`, `right`, `back`, `left`, or `side`; `side` is treated as `right`. Set `mirrorSide: true` on a `side` member to provide a mirrored left-facing sprite. `rotationScheme` accepts `2-way`, `3-way-mirror`, and `4-way`; a `2-way` group cycles between front and right. When a group has at least two usable orientations, it appears as one palette item, and **R** or **Rotate** cycles through the available views. Ungrouped items rotate geometrically. State switching and animation playback are not supported.

Use local, non-interlaced PNG files. Files must be named directly in the manifest, not referenced by URLs or nested paths. Duplicate asset IDs are rejected. External floor, wall, and carpet packs are not supported.

## Characters

Put sheets directly in `characters/` without a manifest:

```text
my-assets/
  characters/
    char_artist.png
```

Use transparent, non-interlaced **224x128 PNGs**: seven 32x32 frames per row, with rows ordered **up, right, down, left**. Each frame renders at 16x16 game pixels. Filenames must be `char_NAME.png`; NAME allows 1-80 letters, digits, underscores or hyphens, beginning with a letter or digit. Duplicate filenames across directories and symlinks are rejected; Settings shows invalid-sheet warnings.

Up to eight sheets per directory and 32 total are accepted, each at most 512 KiB. Character imports have separate per-directory allowances of 256 entries, 16 attempts and 2 MiB read per refresh. Adding, editing or removing sheets updates the office automatically.

Existing agents keep their saved appearances. New members claim unused custom sheets, one member per sheet, then bundled styles. Keep folder paths and filenames unchanged to retain assignments; editing the art updates its appearance. A missing sheet uses a stable bundled fallback, and restoring the same path and filename restores its art.

`characters` and `pets` are reserved folders; a furniture folder with either name is not imported.

## Pets

Put each pet in a `pets/<id>/` subfolder of an added asset directory:

```text
my-assets/
  pets/
    my-dog/
      manifest.json
      pet.png
```

Pet manifests require a folder-matching `id`, a display `name`, and a unique integer `petType`:

```json
{
  "id": "my-dog",
  "name": "My Dog",
  "petType": 2
}
```

Pet sheets must be 96×96 pixel PNGs. Bundled pets use types `0` and `1`; custom pets can use an unused type from `2` through `511`.

## Import limits

- Up to eight asset directories can be registered.
- Furniture and pet imports allow at most 128 entries per directory and item folder. Each manifest is limited to 64 KiB, 128 nodes, and eight levels.
- A furniture PNG can be at most 1 MiB and 256×256 pixels; its footprint can be at most 16×16 tiles.
- Furniture and pet imports share a per-directory, per-pass budget of 2 MiB read across 128 files and 48 decoded assets. Split larger packs across available directories.
- A pet PNG can be at most 512 KiB. Pet IDs and types must be unique across loaded pet manifests.

Invalid manifests or images are skipped and reported in the asset warnings and Settings. A placed item whose art is unavailable remains in the layout and is shown with a missing-art marker.
