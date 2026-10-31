# Launch directory capture captions

All images in this directory were captured from source
`9da1daa54a02c8147d2fe579cbbbf22c969e8d8d`.
They use the production webview with synthetic catalog data and a mocked native
host. These are local layout captures, not CI, native VS Code integration,
standalone directory-management, or real CLI execution evidence.

| Files | Viewport | Caption |
|---|---|---|
| `directory-dialog-invalid-1280x900.png`, `directory-dialog-invalid-360x640.png` | 1280x900, 360x640 respectively | Unavailable directory with disabled Launch and a concise row-level reason |
| `directory-dialog-workspace-1280x900.png`, `directory-dialog-workspace-360x640.png` | 1280x900, 360x640 respectively | Valid workspace folder with explicit Launch |
| `directory-dialog-saved-1280x900.png`, `directory-dialog-saved-360x640.png` | 1280x900, 360x640 respectively | Long saved list scrolled to the last rows; collapsed Add footer, Browse, and manual-entry disclosure remain visible |
| `directory-dialog-empty-1280x900.png`, `directory-dialog-empty-360x640.png` | 1280x900, 360x640 respectively | Empty catalog grouped by purpose |
| `directory-dialog-manual-stress-360x640.png` | 360x640 | Scrollable manual entry with 10 suggestions, expanded errors, and preserved draft |

The narrow saved-list assertion checks footer/control bounds before any locator
auto-scroll. The capture then exercises Manage on the last saved row.
`directory-dialog-report.json` records the source, assertions, and geometry.

Product SHA-256:

- `index.js`: `2E4E44AFDE7E778DE81339E02B215A67FD36361EA414C0A281552BE516FD1612`
- `index.css`: `5AE6F7BFDD7CDECB861ADCFF7F4D5B310574C090A100C55D6CEA3DCE69576FCC`

Commands: `npm run build:webview` and
`ACCEPTANCE_OUTPUT_DIR=<evidence directory> node scripts\acceptance-directory-suggestions.cjs`.
Both passed; Vite reported its chunk-size warning. The harness closed all pages,
the browser, and the HTTP server. `.github/workflows/squad-ci.yml` does not run
this capture harness; its lint, types, unit tests, builds, standalone checks,
and packaging are separate CI validation.
