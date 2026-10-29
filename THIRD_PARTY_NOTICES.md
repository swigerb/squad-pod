# Third-party notices

Squad Pod ships the following third-party code and assets. Keep this file in
the VSIX and update it whenever a bundled asset or runtime dependency changes.

## Code

| Component | License | Notes |
|---|---|---|
| [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) | MIT, Copyright (c) 2026 Pablo De Lucca | Office engine, renderer, editor, and pathfinding are adapted from Pixel Agents. Notice retained in [LICENSE](LICENSE). |
| [React](https://github.com/facebook/react) / React DOM | MIT, Copyright (c) Meta Platforms, Inc. and affiliates | Bundled into `dist/webview/assets/index.js`. |

## Assets

| Asset | Source | License / status |
|---|---|---|
| `webview-ui/public/assets/characters/char_employee*.png` | Based on [JIK-A-4 MetroCity free top-down character pack](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) | Free to use; credit appreciated and retained. |
| `webview-ui/public/assets/tileset_office.png` and its metadata | Imported in commit `b861d32` and repacked in `d811ed8` | **Provenance not recorded.** The maintainer must confirm it is original or redistributable before a Marketplace release. It must not contain any part of the Donarg/Retropi Office Interior Tileset, whose license forbids redistribution even when edited. |

## Assets that are never bundled

- Premium tilesets, including the Donarg/Retropi Office Interior Tileset. Users may import their own copy locally; those files must stay out of source control and the VSIX.
