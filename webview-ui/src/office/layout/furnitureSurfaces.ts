import { getCatalogEntry } from './furnitureCatalog.js';

interface FurnitureBounds {
  uid: string;
  type: string;
  col: number;
  row: number;
  width: number;
  height: number;
}

/** Match editor group ownership: greatest footprint overlap, then layout order. */
export function getSurfaceOwners(furniture: readonly FurnitureBounds[]): Map<string, string> {
  const surfaces = furniture.filter((item) => getCatalogEntry(item.type)?.isDesk);
  const owners = new Map<string, string>();
  for (const item of furniture) {
    if (!getCatalogEntry(item.type)?.canPlaceOnSurfaces) continue;
    let area = 0;
    for (const surface of surfaces) {
      if (surface.uid === item.uid) continue;
      const overlap = Math.max(0, Math.min(item.col + item.width, surface.col + surface.width)
        - Math.max(item.col, surface.col))
        * Math.max(0, Math.min(item.row + item.height, surface.row + surface.height)
          - Math.max(item.row, surface.row));
      if (overlap > area) {
        // Imported assets may be both a surface and a rider; never form a support cycle.
        let ancestor: string | undefined = surface.uid;
        while (ancestor !== undefined && ancestor !== item.uid) ancestor = owners.get(ancestor);
        if (ancestor === item.uid) continue;
        area = overlap;
        owners.set(item.uid, surface.uid);
      }
    }
  }
  return owners;
}
