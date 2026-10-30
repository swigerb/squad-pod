// Explicit user activation only. Unlike upstream v1.5.0's denied-read no-op,
// denial offers manual paste so requested text is never silently discarded.
export type ClipboardOperation = 'copy' | 'paste';
export type ClipboardMethod = 'async-write' | 'async-read' | 'copy-event' | 'manual-paste' | 'none';
export interface ClipboardCapabilities { secureContext: boolean; readText: boolean; writeText: boolean }
export function clipboardMethod(
  operation: ClipboardOperation, capabilities: ClipboardCapabilities, userInitiated: boolean,
): ClipboardMethod {
  if (!userInitiated) return 'none';
  if (operation === 'copy') return capabilities.secureContext && capabilities.writeText ? 'async-write' : 'copy-event';
  return capabilities.secureContext && capabilities.readText ? 'async-read' : 'manual-paste';
}
export function clipboardFailure(operation: ClipboardOperation): {
  method: ClipboardMethod; message: string;
} {
  return operation === 'copy'
    ? { method: 'copy-event', message: 'Clipboard write refused. Try browser copy, or select and copy the text manually.' }
    : { method: 'manual-paste', message: 'Clipboard read unavailable or refused. Paste text into the manual paste field.' };
}
export function manualPasteResult(text: string | null):
  { type: 'cancelled' } | { type: 'empty' } | { type: 'paste'; text: string } {
  if (text === null) return { type: 'cancelled' };
  return text === '' ? { type: 'empty' } : { type: 'paste', text };
}
