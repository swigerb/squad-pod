import { describe, expect, it } from 'vitest';
import { clipboardFailure, clipboardMethod, manualPasteResult } from './clipboardDecisions.js';
describe('explicit clipboard decisions', () => {
  it('never reads or writes automatically, even with full clipboard capability', () => {
    const capabilities = { secureContext: true, readText: true, writeText: true };
    expect(clipboardMethod('copy', capabilities, false)).toBe('none');
    expect(clipboardMethod('paste', capabilities, false)).toBe('none');
    expect(clipboardMethod('copy', capabilities, true)).toBe('async-write');
    expect(clipboardMethod('paste', capabilities, true)).toBe('async-read');
  });
  it('offers copy-event/manual-paste fallback on plain HTTP, absent APIs and denied permission', () => {
    for (const capabilities of [
      { secureContext: false, readText: true, writeText: true },
      { secureContext: true, readText: false, writeText: false },
    ]) {
      expect(clipboardMethod('copy', capabilities, true)).toBe('copy-event');
      expect(clipboardMethod('paste', capabilities, true)).toBe('manual-paste');
    }
    expect(clipboardFailure('copy')).toEqual({ method: 'copy-event',
      message: 'Clipboard write refused. Try browser copy, or select and copy the text manually.' });
    expect(clipboardFailure('paste')).toEqual({ method: 'manual-paste',
      message: 'Clipboard read unavailable or refused. Paste text into the manual paste field.' });
  });
  it('distinguishes cancellation/empty text and preserves whitespace, multiline and astral text verbatim', () => {
    expect(manualPasteResult(null)).toEqual({ type: 'cancelled' });
    expect(manualPasteResult('')).toEqual({ type: 'empty' });
    const text = ' \nline\t\u{1f680}\r\n ';
    expect(manualPasteResult(text)).toEqual({ type: 'paste', text });
  });
});
