import type { PlacedFurniture } from './types.js';

function place(
  uid: string,
  assetId: string,
  col: number,
  row: number,
  width: number,
  height: number,
  assetRole?: 'desk' | 'seat',
): PlacedFurniture {
  return {
    uid,
    type: `pa_${assetId}`,
    col,
    row,
    rotation: 0,
    assetFootprint: { width, height },
    ...(assetRole ? { assetRole } : {}),
  };
}

/** Source-faithful starter furniture for fresh offices and explicit export, never saved-layout migration. */
export function defaultFurniture(): PlacedFurniture[] {
  // Furniture rows are translated by nine to trim the source layout's empty upper margin.
  return [
    place('conference-table', 'TABLE_FRONT', 4, 7, 3, 4, 'desk'),
    place('lounge-table', 'COFFEE_TABLE', 14, 5, 2, 2),
    place('sofa-left', 'SOFA_SIDE', 13, 5, 1, 2),
    place('sofa-back', 'SOFA_BACK', 14, 7, 2, 1),
    place('sofa-front', 'SOFA_FRONT', 14, 4, 2, 1),
    place('sofa-right', 'SOFA_SIDE:left', 16, 5, 1, 2),
    place('plant-hanging-1', 'HANGING_PLANT', 9, 0, 1, 2),
    place('plant-hanging-2', 'HANGING_PLANT', 1, 0, 1, 2),
    place('bookshelf-1', 'DOUBLE_BOOKSHELF', 7, 0, 2, 2),
    place('bookshelf-2', 'DOUBLE_BOOKSHELF', 2, 0, 2, 2),
    place('painting-small-1', 'SMALL_PAINTING', 12, 0, 1, 2),
    place('clock-1', 'CLOCK', 5, 0, 1, 2),
    place('plant-1', 'PLANT', 18, 1, 1, 2),
    place('coffee-1', 'COFFEE', 14, 6, 1, 1),
    place('chair-left-1', 'WOODEN_CHAIR_SIDE', 3, 9, 1, 2, 'seat'),
    place('chair-left-2', 'WOODEN_CHAIR_SIDE', 3, 7, 1, 2, 'seat'),
    place('chair-right-1', 'WOODEN_CHAIR_SIDE:left', 7, 7, 1, 2, 'seat'),
    place('chair-right-2', 'WOODEN_CHAIR_SIDE:left', 7, 9, 1, 2, 'seat'),
    place('desk-1', 'DESK_FRONT', 2, 3, 3, 2, 'desk'),
    place('desk-2', 'DESK_FRONT', 6, 3, 3, 2, 'desk'),
    place('bench-1', 'CUSHIONED_BENCH', 3, 5, 1, 1, 'seat'),
    place('bench-2', 'CUSHIONED_BENCH', 7, 5, 1, 1, 'seat'),
    place('computer-1', 'PC_FRONT_OFF', 7, 3, 1, 2),
    place('computer-2', 'PC_FRONT_OFF', 3, 3, 1, 2),
    place('computer-side-1', 'PC_SIDE', 4, 7, 1, 2),
    place('computer-side-2', 'PC_SIDE', 4, 9, 1, 2),
    place('computer-side-3', 'PC_SIDE:left', 6, 7, 1, 2),
    place('computer-side-4', 'PC_SIDE:left', 6, 9, 1, 2),
    place('plant-2', 'PLANT_2', 11, 1, 1, 2),
    place('painting-large', 'LARGE_PAINTING', 14, 0, 2, 2),
    place('bin-1', 'BIN', 2, 11, 1, 1),
    place('table-small-front', 'SMALL_TABLE_FRONT', 17, 10, 2, 2),
    place('table-small-side', 'SMALL_TABLE_SIDE', 1, 9, 1, 3),
    place('coffee-2', 'COFFEE', 1, 10, 1, 1),
    place('plant-3', 'PLANT_2', 1, 8, 1, 2),
    place('painting-small-2', 'SMALL_PAINTING_2', 17, 0, 1, 2),
  ];
}
