# Skill: Synchronous Webview Asset Loading

**Skill ID:** sync-webview-assets  
**Category:** VS Code Extension Development  
**Applies To:** Webview assets that must be available at module init time  
**Difficulty:** Intermediate

## Problem

Async image loading (new Image().onload, createImageBitmap, img.decode()) is unreliable in VS Code Electron webviews. Images loaded via these methods may:
- Never fire onload events
- Resolve too late for module initialization
- Work in Chrome DevTools but fail in production
- Leave critical state (sprite sheets, UI assets) unpopulated at first render

## Solution Pattern

**Pre-decode images to raw pixel data at build time, embed in bundle, use synchronous Canvas API (putImageData) at module init.**

### Step 1: Build-Time Image Decode Script

Create a script that decodes PNGs to raw RGBA bytes and outputs TypeScript with embedded data:

```python
# scripts/gen_embedded_images.py
from PIL import Image
import base64

img = Image.open(path).convert("RGBA")
width, height = img.size
rgba_bytes = img.tobytes()  # Raw RGBA pixel array
b64 = base64.b64encode(rgba_bytes).decode("ascii")

# Output TypeScript with width, height, and base64 RGBA
output = f"""
export const IMAGE_WIDTH = {width};
export const IMAGE_HEIGHT = {height};
export const IMAGE_RGBA = "{b64}";
"""
```

**Key points:**
- Use `.convert("RGBA")` to normalize format
- Use `.tobytes()` for raw pixel data (not PNG/JPEG compressed)
- Base64-encode the raw bytes for embedding in JS/TS

### Step 2: Synchronous Bootstrap Code

At module init time, decode and render synchronously:

```typescript
// assetLoader.ts (module scope, NOT inside a function)
if (typeof document !== 'undefined' && typeof atob === 'function') {
  // Decode base64 → Uint8ClampedArray
  const binary = atob(IMAGE_RGBA);
  const rgba = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) {
    rgba[i] = binary.charCodeAt(i);
  }
  
  // Create ImageData from raw pixels
  const imageData = new ImageData(rgba, IMAGE_WIDTH, IMAGE_HEIGHT);
  
  // Draw to canvas via putImageData (SYNCHRONOUS!)
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  
  // Store in module state — immediately available
  myAssetMap.set('my-image', canvas);
}
```

**Key points:**
- Run at module scope (not async function) for immediate execution
- `putImageData()` is 100% synchronous — no onload, no Promise
- Guard with `typeof document !== 'undefined'` for Node/test environments
- Guard with `typeof atob === 'function'` to avoid ReferenceError in Node

### Step 3: Cache-Busting for Webview HTML

Add timestamp query parameter to script/CSS URIs to force fresh loads:

```typescript
// SquadPodViewProvider.ts
private getWebviewHtml(webview: vscode.Webview): string {
  const scriptUri = webview.asWebviewUri(scriptPath);
  const styleUri = webview.asWebviewUri(stylePath);
  const cacheBuster = Date.now();
  
  return `
    <link href="${styleUri}?v=${cacheBuster}" />
    <script src="${scriptUri}?v=${cacheBuster}"></script>
  `;
}
```

**Key points:**
- `Date.now()` generates unique timestamp on every panel creation
- Prevents Electron from serving stale cached JS/CSS
- Critical during development when rebuilding frequently

## When to Use This Pattern

✅ **Use synchronous RGBA loading when:**
- Asset must be available at module init (before first render)
- Asset is small enough for bundle embedding (<1MB raw RGBA)
- Running in VS Code Electron webview (unreliable Image loading)
- Fallback rendering is unacceptable

❌ **Don't use this pattern when:**
- Asset can load lazily after bootstrap
- Asset is large (>1MB raw) — bundle size impact too high
- Fallback rendering is acceptable during load
- Running in standard browser (async Image is reliable)

## Tradeoffs

**Pros:**
- ✅ 100% reliable — no race conditions, no async timing issues
- ✅ Immediate availability — pixels ready before first frame
- ✅ Synchronous execution — guaranteed load order
- ✅ Works in all Electron versions

**Cons:**
- ❌ Larger bundle size — raw RGBA is ~3× bigger than PNG
- ❌ Build-time dependency — requires PIL/Sharp/Canvas for decode
- ❌ Regenerate on source changes — run gen script after image updates

## Bundle Size Calculation

```
Raw RGBA size = width × height × 4 bytes
Base64 size = (raw size × 4/3) rounded up

Example: 224×128 PNG
- Raw RGBA: 224 × 128 × 4 = 114,688 bytes
- Base64: 114,688 × 4/3 = 152,917 bytes (~153KB)
- Original PNG: ~38KB
- Overhead: ~115KB per sprite
```

For 2-5 small sprites, this is acceptable. For 10+ sprites, consider hybrid approach (critical embedded, others async).

## Real-World Example

Squad Pod character sprites (224×128, 2 sheets):
- **Before:** 375KB bundle, async loading, colored rectangle fallbacks
- **After:** 611KB bundle, sync loading, sprites render 100% reliably
- **Tradeoff:** +236KB bundle for guaranteed rendering — worth it

## Testing

```typescript
// characterLoader.test.ts
describe('synchronous character loading', () => {
  it('populates characterSheets at module init', () => {
    // No setup needed — bootstrap runs on import
    const sheet = characterSheets.get('A');
    expect(sheet).toBeDefined();
    expect(sheet!.frameWidth).toBe(32);
  });
});
```

Guard the bootstrap code with `typeof document !== 'undefined'` so tests don't crash in Node.js/JSDOM.

## Common Mistakes

1. **Using async/await in bootstrap** — defeats the purpose, module state may be accessed before resolution
2. **Forgetting cache-busting** — old fixes won't take effect, wastes debugging time
3. **Not guarding with typeof checks** — crashes in Node.js test environments
4. **Embedding PNG data URIs** — still requires async Image decode, doesn't solve the problem

## Tools Needed

- **Python:** PIL (Pillow) for `Image.open().convert("RGBA").tobytes()`
- **Node.js:** Sharp for `sharp(buffer).raw().toBuffer()`
- **Browser:** Canvas API for `putImageData()`

## References

- Squad Pod commit: 0d474bd "Fix sprite rendering with cache-busting and synchronous RGBA loading"
- MDN: [ImageData](https://developer.mozilla.org/en-US/docs/Web/API/ImageData)
- MDN: [putImageData](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/putImageData)
- PIL docs: [Image.tobytes()](https://pillow.readthedocs.io/en/stable/reference/Image.html#PIL.Image.Image.tobytes)
