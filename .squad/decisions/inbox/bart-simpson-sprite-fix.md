# Decision: Clean Build Targets Before Asset Copy

**Author:** Bart Simpson (Frontend Dev)
**Date:** 2026-03-08
**Status:** Implemented

## Context

The esbuild copy-assets plugin copied webview-ui/public/assets/ to dist/assets/ using
fs.cpSync() without cleaning the target first. When character sprite files C/D/E were
removed from source, the stale PNGs persisted in dist/assets/characters/. The extension
host then sent 5 character sheet data URIs instead of 2, adding ~252KB of unnecessary
payload to the characterAssetsLoaded message.

## Decision

Updated esbuild.js copy-assets plugin to rmSync the target directory before cpSync.
This ensures dist/assets/ is always a clean mirror of webview-ui/public/assets/.

## Consequences

- dist/assets/ will always match source, no stale file surprises
- Build is slightly slower (delete + copy instead of overwrite), negligible impact
- All team members building from source get identical dist/ output
