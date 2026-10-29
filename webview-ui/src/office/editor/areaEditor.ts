import { TileType } from '../types.js';
import type { AreaDefinition, OfficeLayout } from '../types.js';

const MAX_AREA_LABEL_LENGTH = 80;
const MAX_DIRECTORY_ID_LENGTH = 8192;

function inGrid(layout: OfficeLayout, col: number, row: number): boolean {
  return Number.isInteger(col) && Number.isInteger(row)
    && col >= 0 && row >= 0 && col < layout.cols && row < layout.rows;
}

export function validateAreaLabel(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Area name must be text.');
  const label = value.trim();
  if (!label || label.length > MAX_AREA_LABEL_LENGTH || /[\u0000-\u001f\u007f]/.test(label)) {
    throw new Error('Area name must be 1–80 characters and contain no control characters.');
  }
  return label;
}

function validateAreaColor(value: unknown): string {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) {
    throw new Error('Area color must be a six-digit hex color.');
  }
  return value.toLowerCase();
}

function validateDirectoryId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > MAX_DIRECTORY_ID_LENGTH) {
    throw new Error('A valid stable directory ID is required.');
  }
  return value;
}

export function addArea(layout: OfficeLayout, labelInput: unknown, colorInput: unknown): OfficeLayout {
  const label = validateAreaLabel(labelInput);
  const color = validateAreaColor(colorInput);
  if ((layout.areas ?? []).length >= 100) throw new Error('At most 100 Areas are supported.');
  if ((layout.areas ?? []).some((area) => area.label.toLocaleLowerCase() === label.toLocaleLowerCase())) {
    throw new Error(`An Area named "${label}" already exists.`);
  }
  return { ...layout, areas: [...(layout.areas ?? []), { label, color }] };
}

export function removeArea(layout: OfficeLayout, label: string): OfficeLayout {
  if (!layout.areas?.some((area) => area.label === label)) return layout;
  const next = { ...layout };
  const areas = layout.areas.filter((area) => area.label !== label);
  if (areas.length) next.areas = areas;
  else delete next.areas;

  if (layout.areaTiles) {
    const areaTiles = layout.areaTiles.map((value) => value === label ? null : value);
    if (areaTiles.some((value) => value !== null)) next.areaTiles = areaTiles;
    else delete next.areaTiles;
  }

  if (layout.areaMappings) {
    const areaMappings = Object.fromEntries(
      Object.entries(layout.areaMappings)
        .map(([directoryId, labels]) => [directoryId, labels.filter((value) => value !== label)] as const)
        .filter(([, labels]) => labels.length > 0),
    );
    if (Object.keys(areaMappings).length) next.areaMappings = areaMappings;
    else delete next.areaMappings;
  }
  return next;
}

export function renameArea(layout: OfficeLayout, oldLabel: string, newLabelInput: unknown): OfficeLayout {
  const newLabel = validateAreaLabel(newLabelInput);
  if (!layout.areas?.some((area) => area.label === oldLabel)) return layout;
  if (oldLabel === newLabel) return layout;
  if (layout.areas.some((area) => area.label.toLocaleLowerCase() === newLabel.toLocaleLowerCase())) {
    throw new Error(`An Area named "${newLabel}" already exists.`);
  }

  const next: OfficeLayout = {
    ...layout,
    areas: layout.areas.map((area) => area.label === oldLabel ? { ...area, label: newLabel } : area),
  };
  if (layout.areaTiles) {
    next.areaTiles = layout.areaTiles.map((value) => value === oldLabel ? newLabel : value);
  }
  if (layout.areaMappings) {
    next.areaMappings = Object.fromEntries(Object.entries(layout.areaMappings).map(([directoryId, labels]) => [
      directoryId,
      [...new Set(labels.map((value) => value === oldLabel ? newLabel : value))],
    ]));
  }
  return next;
}

export function changeAreaColor(layout: OfficeLayout, label: string, colorInput: unknown): OfficeLayout {
  const color = validateAreaColor(colorInput);
  if (!layout.areas?.some((area) => area.label === label)) return layout;
  if (layout.areas.find((area) => area.label === label)?.color === color) return layout;
  return {
    ...layout,
    areas: layout.areas.map((area) => area.label === label ? { ...area, color } : area),
  };
}

export function setAreaMapping(
  layout: OfficeLayout,
  directoryIdInput: unknown,
  label: string,
  mapped: boolean,
): OfficeLayout {
  const directoryId = validateDirectoryId(directoryIdInput);
  if (!layout.areas?.some((area) => area.label === label)) {
    throw new Error('The selected Area is no longer available.');
  }
  const mappings = new Map(Object.entries(layout.areaMappings ?? {}));
  const labels = new Set(mappings.get(directoryId) ?? []);
  if (mapped) labels.add(label);
  else labels.delete(label);
  if (labels.size) mappings.set(directoryId, [...labels]);
  else mappings.delete(directoryId);
  if (!mappings.size) {
    const next = { ...layout };
    delete next.areaMappings;
    return next;
  }
  return { ...layout, areaMappings: Object.fromEntries(mappings) };
}

export function applyAreaPaint(layout: OfficeLayout, col: number, row: number, label: string): OfficeLayout {
  if (!inGrid(layout, col, row) || !layout.areas?.some((area) => area.label === label)) return layout;
  const index = row * layout.cols + col;
  const tile = layout.tiles[index];
  if (tile === TileType.WALL || tile === TileType.VOID || tile === undefined) return layout;
  if (layout.areaTiles?.[index] === label) return layout;
  const areaTiles = layout.areaTiles ? [...layout.areaTiles] : Array(layout.tiles.length).fill(null);
  areaTiles[index] = label;
  return { ...layout, areaTiles };
}

export function applyAreaErase(layout: OfficeLayout, col: number, row: number): OfficeLayout {
  if (!inGrid(layout, col, row) || !layout.areaTiles?.[row * layout.cols + col]) return layout;
  const areaTiles = [...layout.areaTiles];
  areaTiles[row * layout.cols + col] = null;
  if (!areaTiles.some((label) => label !== null)) {
    const next = { ...layout };
    delete next.areaTiles;
    return next;
  }
  return { ...layout, areaTiles };
}

export function pickArea(layout: OfficeLayout, col: number, row: number): AreaDefinition | null {
  if (!inGrid(layout, col, row)) return null;
  const label = layout.areaTiles?.[row * layout.cols + col];
  return layout.areas?.find((area) => area.label === label) ?? null;
}
