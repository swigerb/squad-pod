# Skill: Adding an OutboundMessage Variant

## When to Use

Any time the extension host needs to send a new data type to the webview.

## Steps

1. **Define types in `src/types.ts`** — add interfaces for the payload, then add a new variant to the `OutboundMessage` discriminated union with a unique `type` string literal.

2. **Send from extension host** — in `src/SquadPodViewProvider.ts`, call `this.postMessage({ type: 'yourNewType', ...payload })`. Place the call in `onWebviewReady()` for init-time data, or in a watcher callback for runtime events.

3. **Handle in webview** — in `webview-ui/src/hooks/useExtensionMessages.ts`, add a `case 'yourNewType':` block. Use dynamic `import()` for heavy modules (e.g., asset loaders) to keep the handler lightweight.

4. **Mirror types on webview side** — since extension and webview are separate build targets, duplicate the payload interfaces in the webview code. Keep them identical.

## Pattern: Backward-Compatible Supersession

When a new message type supersedes an old one (e.g., `tilesetMetadataLoaded` supersedes `tilesetAssetsLoaded`):

- Send the new message if the richer data source is available
- Fall back to the old message if it's not
- On the webview side, have the new handler also populate legacy data structures so existing consumers keep working
- Never remove the old message case until all consumers are migrated

## Pattern: Dual-Format Asset Messages

When two data formats describe the same asset (rich metadata vs legacy), send BOTH messages from the extension when both source files exist. Each populates its own data structure on the webview side. This avoids cross-mapping name mismatches (e.g., metadata item IDs differ from legacy object names).

## Gotcha: Asset Ready Gates

If the webview uses a shared boolean gate (e.g., `assetsReady`) to enable a rendering path, EVERY ingestion function that loads assets must set the gate to `true`. Otherwise the renderer will silently skip the PNG path even when assets are loaded. Search for all callers of the gate-check function to verify.

## Key Files

- `src/types.ts` — discriminated union lives here
- `src/SquadPodViewProvider.ts` — extension-side sender
- `webview-ui/src/hooks/useExtensionMessages.ts` — webview-side handler
