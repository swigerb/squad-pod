# Custom asset manifests

Squad Pod can load local furniture and pet sheets from directories you add in **Settings → Add Asset Directory**. Asset files stay local. Changes are detected automatically; unloading a directory does not delete files or remove placed items from layouts.

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

`file` is optional and defaults to `<id>.png`. `width` and `height` are image pixels; the sprite must exactly match its footprint at 16 pixels per tile. The manifest `type` may also be a `group` containing `asset` leaves. Group leaves are loaded as separate static variants; animation is not supported.

Use local, non-interlaced PNG files. Files must be named directly in the manifest, not referenced by URLs or nested paths. Duplicate asset IDs are rejected. External packs support furniture only; floor, wall, and character packs are not loaded.

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
- Each directory and item folder can contain at most 128 entries. Each manifest is limited to 64 KiB, 128 nodes, and eight levels.
- A furniture PNG can be at most 1 MiB and 256×256 pixels; its footprint can be at most 16×16 tiles.
- Each added directory has a per-pass budget of 2 MiB read across 128 files and 48 decoded assets. Split larger packs across available directories.
- A pet PNG can be at most 512 KiB. Pet IDs and types must be unique across loaded pet manifests.

Invalid manifests or images are skipped and reported in the asset warnings and Settings. A placed item whose art is unavailable remains in the layout and is shown with a missing-art marker.
