# Decision: No `window.confirm()` or `window.alert()` in Webview

**Author:** Bart Simpson
**Date:** 2025-07-24

## Context

The "Exit Layout Editor" button silently did nothing because `handleToggleEditMode` used `window.confirm()` to ask about unsaved changes. In VS Code webview sandbox, `window.confirm()` returns `false` immediately without showing a dialog (no `allow-modals` permission), causing the handler to return early.

## Decision

Never use `window.confirm()`, `window.alert()`, or `window.prompt()` in the webview. These modal dialog APIs are blocked by the VS Code webview sandbox.

For confirmation flows, either:
1. Use VS Code message passing (`postMessage` to extension → extension calls `vscode.window.showWarningMessage` → posts result back)
2. Design UX that doesn't require blocking confirmation (e.g., undo/reset buttons, auto-save)

## Impact

All webview code (`webview-ui/src/`). Anyone adding user-facing dialogs must use the VS Code messaging pattern instead of browser-native modals.
