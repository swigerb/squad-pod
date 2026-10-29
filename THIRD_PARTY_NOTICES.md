# Third-party notices

Squad Pod ships the following third-party code and assets. Keep this file in
the VSIX and update it whenever a bundled asset or runtime dependency changes.

## Code

| Component | License | Notes |
|---|---|---|
| [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) | MIT, Copyright (c) 2026 Pablo De Lucca | Office engine, renderer, editor, and pathfinding are adapted from Pixel Agents. Notice retained in [LICENSE](LICENSE). |
| [React](https://github.com/facebook/react) / React DOM / Scheduler | MIT, Copyright (c) Meta Platforms, Inc. and affiliates. | Bundled into `dist/webview/assets/index.js`. |
| [pngjs](https://github.com/pngjs/pngjs) | MIT; pngjs original work Copyright (c) 2015 Luke Page & Original Contributors; pngjs derived work Copyright (c) 2012 Kuba Niegowski | Bundled into `dist/extension.js`; PNG decoding. |

The MIT permission grant, notice-retention condition and warranty disclaimer in
[LICENSE](LICENSE) apply to the bundled MIT components above, with their respective
copyright notices retained here. No font files are shipped in this package.

## Assets

| Asset | Source | License / status |
|---|---|---|
| `webview-ui/public/assets/characters/char_employee*.png` | Based on [JIK-A-4 MetroCity free top-down character pack](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) | Free to use; credit appreciated and retained. |
| `webview-ui/public/assets/{furniture,floors,walls}/` | Pixel Agents `b1bafd02896d90d83457266575a1e8e5011ce997` | MIT, Copyright (c) 2026 Pablo De Lucca; full notice retained in [LICENSE](LICENSE). 25 item manifests / 38 furniture PNGs, nine floor PNGs and one wall PNG. |

### Original bundle verification

The source is [Pixel Agents v1.5.0](https://github.com/pixel-agents-hq/pixel-agents/tree/b1bafd02896d90d83457266575a1e8e5011ce997).
The furniture/floor/wall paths were checked against the tree of the explicit
original/open-source asset replacement,
[pixel-agents-hq/pixel-agents#117](https://github.com/pixel-agents-hq/pixel-agents/pull/117),
merged at `3ebb247a8138b2608bf291997562f2854929894b`.
All 48 PNG blobs are identical to that original bundle. Of the 25 manifests,
only COFFEE and LARGE_PLANT differ at the pin: later commit
`dfb5b30f7699e2a7613952e5e4d4c8637cb07d23` changed category/background
metadata, not art. Source manifests are shipped unchanged.

This conclusion is specific to those paths: PR117 explicitly identifies them
as original open-source pieces replacing privately licensed art; the pinned
CONTRIBUTING states contributions are MIT; the root MIT license and Pablo De
Lucca copyright were inspected and retained. No separate asset-license file
was found in the pinned tree. This is **not** an assumption that every asset in
that repository is covered solely because the root license is MIT.

`assets/pixel-agents-source.json` records the source pins and a content hash
for all 73 imported files. The VSIX carries identical copies under
`dist/assets/` and `dist/webview/assets/`, plus this notice and LICENSE.
The unresolved `tileset_office.png` and its metadata are removed, not retained
as a fallback. Historical `Screenshot.jpg` is excluded from the VSIX.

## Assets that are never bundled

- Premium tilesets, including the Donarg/Retropi Office Interior Tileset. Users may import their own copy locally; those files must stay out of source control and the VSIX.
