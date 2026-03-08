# Decision: CORS-Safe Image Loading in Webview

**Author:** Lisa Simpson  
**Date:** 2026-03-08  
**Status:** Implemented

## Context

VS Code webviews run at origin `vscode-webview://[uuid]` while resources are served from `https://file+.vscode-resource.vscode-cdn.net/`. This cross-origin relationship means:

1. `new Image()` loads succeed (CSP `img-src` allows it)
2. `canvas.getImageData()` may throw `SecurityError` (canvas tainted by cross-origin image)
3. Setting `crossOrigin="anonymous"` enables CORS but may cause the load itself to fail if the server doesn't send `Access-Control-Allow-Origin` headers

## Decision

All browser-side image loading in the webview must follow a **three-tier fallback** pattern:

1. **Try with `crossOrigin="anonymous"`** — enables `getImageData()` for pixel manipulation (background removal)
2. **On load error, retry WITHOUT `crossOrigin`** — image loads but canvas is tainted; pixel manipulation falls back gracefully
3. **On pixel access error (`getImageData`), catch and use raw image** — character has visible background but renders

Additionally, all `removeBackground()` / `getImageData()` calls must be wrapped in try/catch with graceful degradation.

## Team Impact

- **Bart (Canvas Dev):** Any new canvas pixel-manipulation code must handle `SecurityError` from `getImageData()`
- **Lisa (Extension Dev):** Image URIs from `webview.asWebviewUri()` are cross-origin; plan accordingly
- **All:** Never assume `getImageData()` works on images loaded from webview URIs
