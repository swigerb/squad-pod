import { describe, expect, it } from 'vitest';
import { readKeyboardViewport, type ViewportSample } from './keyboardViewport.js';
const portrait: ViewportSample = { width: 390, innerHeight: 844, visualHeight: 844, editableFocused: false };
describe('keyboard viewport samples, not physical-device acceptance', () => {
  it('clamps iOS-style visual-only shrink, and releases immediately on blur', () => {
    const initial = new Map<number, number>();
    const baseline = readKeyboardViewport(initial, portrait);
    expect(initial.size).toBe(0);
    const keyboard = readKeyboardViewport(baseline.baselines, { ...portrait, visualHeight: 500.4, editableFocused: true });
    expect(keyboard.viewport).toEqual({ keyboardOpen: true, clampHeight: 500 });
    expect(keyboard.baselines).toBe(baseline.baselines);
    expect(readKeyboardViewport(keyboard.baselines, { ...portrait, visualHeight: 500 }).viewport).toEqual({
      keyboardOpen: false, clampHeight: null,
    });
  });
  it('recognizes Android-style layout resize without a redundant clamp', () => {
    const baseline = readKeyboardViewport(new Map(), portrait).baselines;
    expect(readKeyboardViewport(baseline, {
      ...portrait, innerHeight: 500, visualHeight: 500, editableFocused: true,
    }).viewport).toEqual({ keyboardOpen: true, clampHeight: null });
  });
  it('rejects browser-chrome changes, uses a strict 150px keyboard threshold and 1px clamp epsilon', () => {
    const baseline = readKeyboardViewport(new Map(), portrait).baselines;
    expect(readKeyboardViewport(baseline, { ...portrait, visualHeight: 695, editableFocused: true }).viewport.keyboardOpen).toBe(false);
    expect(readKeyboardViewport(baseline, { ...portrait, visualHeight: 694, editableFocused: true }).viewport.keyboardOpen).toBe(true);
    expect(readKeyboardViewport(baseline, {
      ...portrait, innerHeight: 501, visualHeight: 500, editableFocused: true,
    }).viewport.clampHeight).toBeNull();
  });
  it('keeps orientation/resize baselines separate and restores portrait without a stale landscape clamp', () => {
    const first = readKeyboardViewport(new Map(), portrait);
    const landscape = readKeyboardViewport(first.baselines, { width: 844, innerHeight: 390, visualHeight: 390, editableFocused: true });
    expect(landscape.viewport).toEqual({ keyboardOpen: false, clampHeight: null });
    expect(landscape.baselines.get(390)).toBe(844);
    expect(landscape.baselines.get(844)).toBe(390);
    expect(readKeyboardViewport(landscape.baselines, { ...portrait, editableFocused: true }).viewport).toEqual({
      keyboardOpen: false, clampHeight: null,
    });
  });
});
