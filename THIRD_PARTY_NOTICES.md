# Third-party notices

Squad Pod ships the following third-party code and assets. Keep this file in
the VSIX and the private standalone observer package, and update it whenever a
bundled asset or runtime dependency changes. The observer build copies the
canonical root LICENSE and this notice into its generated package root.

## Code

| Component | License | Notes |
|---|---|---|
| [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) | MIT, Copyright (c) 2026 Pablo De Lucca | Office engine, renderer, editor, and pathfinding are adapted from Pixel Agents. Notice retained in [LICENSE](LICENSE). |
| [React](https://github.com/facebook/react) / React DOM / Scheduler | MIT, Copyright (c) Meta Platforms, Inc. and affiliates. | Bundled into VSIX `dist/webview/assets/index.js` and standalone `dist/browser/assets/standalone-*.js`. |
| [pngjs](https://github.com/pngjs/pngjs) | MIT; pngjs original work Copyright (c) 2015 Luke Page & Original Contributors; pngjs derived work Copyright (c) 2012 Kuba Niegowski | PNG decoding: bundled into VSIX `dist/extension.js`; installed standalone runtime dependency at `node_modules/pngjs`, retaining its complete LICENSE. |
| [ws](https://github.com/websockets/ws) | MIT, Copyright (c) 2011 Einar Otto Stangvik; Copyright (c) 2013 Arnout Kazemier and contributors; Copyright (c) 2016 Luigi Pinca and contributors | Standalone only: installed runtime dependency at `node_modules/ws`, retaining its complete LICENSE. Not bundled into the VSIX. |

The MIT permission grant, notice-retention condition and warranty disclaimer in
[LICENSE](LICENSE) apply to the bundled MIT components above, with their respective
copyright notices retained here. No font files are shipped in this package.

## Assets

| Asset | Source | License / status |
|---|---|---|
| `webview-ui/public/assets/characters/char_0.png`–`char_5.png` | [JIK-A-4 MetroCity free top-down character pack](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack), via [Pixel Agents v1.5.0](https://github.com/pixel-agents-hq/pixel-agents/tree/b1bafd02896d90d83457266575a1e8e5011ce997) | The creator says “You can use it as you wish”; the linked [creator forum post](https://itch.io/t/3377789/metrocity-free-top-down-character-pack) says credit is not necessary but appreciated. No named standard license is stated; these character assets are not represented as MIT. Attribution and exact source hashes are recorded in `webview-ui/public/assets/pixel-agents-source.json`. |
| `webview-ui/public/assets/characters/char_employee*.png` | Based on [JIK-A-4 MetroCity free top-down character pack](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) | Legacy sheets retained for compatibility; the creator's direct permission and optional/appreciated-credit terms above apply. |
| `webview-ui/public/assets/{furniture,floors,walls}/` | Pixel Agents `b1bafd02896d90d83457266575a1e8e5011ce997` | MIT, Copyright (c) 2026 Pablo De Lucca; full notice retained in [LICENSE](LICENSE). 25 item manifests / 38 furniture PNGs, nine floor PNGs and one wall PNG. |
| `webview-ui/public/assets/carpets/carpet_{0,1,2}.png` | Same pin, separate PR316 contribution | MIT, Copyright (c) 2026 Pablo De Lucca; carpet/zoning work credited to Pablo De Lucca and NNTin, introducing commit also credits Florin Timbuc. Full notice retained in [LICENSE](LICENSE). |
| `webview-ui/public/assets/pets/{claudio,gitcat}/pet.png` | Pixel Agents `b1bafd02896d90d83457266575a1e8e5011ce997` | MIT, Copyright (c) 2026 Pablo De Lucca; animated-pet contribution PR315, Gitcat PR219 credits itsManeka. Full notice retained in [LICENSE](LICENSE). |

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

### Carpet bundle verification

The three carpet sheets first appear in commit
`7a1643fb5e7bab59e1e789fac06c0f9a2fd78d7c`,
[pixel-agents-hq/pixel-agents#316](https://github.com/pixel-agents-hq/pixel-agents/pull/316)
(superseding [pixel-agents-hq/pixel-agents#259](https://github.com/pixel-agents-hq/pixel-agents/pull/259)).
That contribution explicitly credits the carpet/zoning work to Pablo De Lucca
and NNTin; the introducing commit retains NNTin and Florin Timbuc coauthor credits.
The [pinned README](https://github.com/pixel-agents-hq/pixel-agents/blob/b1bafd02896d90d83457266575a1e8e5011ce997/README.md)
explicitly lists bundled carpets and MIT licensing, and the pinned CONTRIBUTING
states that contributions are MIT. The root MIT copyright, permission grant and
disclaimer are retained in LICENSE. These sheets are **not** from PR117.

The original and pinned Git blob IDs are identical:

| File | Bytes | Git blob |
|---|---:|---|
| `carpet_0.png` | 394 | `67fe2cd77038247a84c1a66fb9592ba3ee41a780` |
| `carpet_1.png` | 380 | `25c9c0105fc0373cfcf89176101035bf64a5010c` |
| `carpet_2.png` | 363 | `28907dc0181b713bf9da57cfac6148a7f7ca6122` |

No premium art, generated substitute or other asset directory was imported.
The marching-squares renderer and dual-color behavior are adapted from the
same pinned MIT implementation.

### Pet bundle verification

The Claudio and Gitcat sheets are separate from the furniture and carpet trails.
PR315 introduces the upstream animated-pet work; PR219 credits itsManeka for
Gitcat. Both PNGs were compared with their Git blobs at the explicit Pixel Agents
v1.5.0 pin. The pinned CONTRIBUTING file states contributions are MIT-licensed;
the repository root MIT notice is retained in [LICENSE](LICENSE). Squad Pod's
`manifest.json` files are local metadata, not files claimed to come from upstream.

| File | Dimensions | Bytes | Pinned Git blob |
|---|---:|---:|---|
| `pets/claudio/pet.png` | 96×96 | 3,267 | `9433b28259850d8142e3d8e991b0548d20570f2e` |
| `pets/gitcat/pet.png` | 96×96 | 2,892 | `d2b7f9b5f39ca3d9106908ff206b7176f377627a` |

`assets/pixel-agents-source.json` records this separate pet provenance trail,
the exact art blobs, local manifest paths and pet-folder checksum. The asset
loader rejects pet sheets over 512 KiB or with dimensions other than 96×96,
and reports failures per pet without discarding other asset categories. The
Squad Pod manifests assign stable pet types (Claudio `0`, Gitcat `1`) so one
failed sheet never shifts another saved pet to a different species. PR219
credits itsManeka's pet sprites, including Claudio and Gitcat; PR315 adds the
animated-pet implementation.

`assets/pixel-agents-source.json` records both contribution trails, exact carpet
blobs and a content hash for all 76 imported files. The VSIX carries identical copies under
`dist/assets/` and `dist/webview/assets/`, plus this notice and LICENSE. The standalone
observer carries identical assets and provenance metadata under `dist/assets/`,
plus this notice and LICENSE in its package root. Asset paths above refer to the
repository source; neither distribution changes the recorded provenance.
The unresolved `tileset_office.png` and its metadata are removed, not retained
as a fallback. Historical `Screenshot.jpg` is excluded from the VSIX.

## Assets that are never bundled

- Premium tilesets, including the Donarg/Retropi Office Interior Tileset. VS Code supports importing your own copy locally; those files must stay out of source control, the VSIX and the standalone observer package.
