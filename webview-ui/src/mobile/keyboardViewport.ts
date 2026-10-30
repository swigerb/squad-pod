// Adapted from Pixel Agents v1.5.0 (b1bafd0), mobile/keyboardViewport.ts.
export interface ViewportSample {
  width: number;
  innerHeight: number;
  visualHeight: number;
  editableFocused: boolean;
}
export interface KeyboardViewport { keyboardOpen: boolean; clampHeight: number | null }
export type ViewportBaselines = ReadonlyMap<number, number>;
export function readKeyboardViewport(baselines: ViewportBaselines, sample: ViewportSample): {
  baselines: ViewportBaselines; viewport: KeyboardViewport;
} {
  const width = Math.round(sample.width);
  const baseline = Math.max(baselines.get(width) ?? 0, sample.innerHeight, sample.visualHeight);
  const next = baseline === baselines.get(width) ? baselines : new Map(baselines).set(width, baseline);
  const keyboardOpen = sample.editableFocused && baseline - sample.visualHeight >= 150;
  return {
    baselines: next,
    viewport: { keyboardOpen, clampHeight: keyboardOpen && sample.visualHeight < sample.innerHeight - 1
      ? Math.round(sample.visualHeight) : null },
  };
}
