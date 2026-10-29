import type { PlacedFurniture } from './types.js';

/** Used only for a new office, never as a saved-layout migration. */
export function defaultFurniture(): PlacedFurniture[] {
  return [[4, 3], [10, 3], [4, 7], [10, 7]].flatMap<PlacedFurniture>(([col, row], i) => [
    { uid: `desk-${i + 1}`, type: 'pa_DESK_FRONT', col, row, rotation: 0, assetFootprint: { width: 3, height: 2 }, assetRole: 'desk' },
    { uid: `chair-${i + 1}`, type: 'pa_CUSHIONED_CHAIR_FRONT', col: col + 1, row: row + 2, rotation: 0, assetFootprint: { width: 1, height: 1 }, assetRole: 'seat' },
  ]);
}
