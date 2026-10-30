import { useCallback, useRef, useEffect, useState } from 'react';
import type { EditorState } from '../office/editor/editorState.js';
import { EditTool, TileType } from '../office/types.js';
import type { FloorColor, EditTool as EditToolType } from '../office/types.js';
import { buildDynamicCatalog } from '../office/layout/furnitureCatalog.js';
import { getFloorSprite } from '../office/floorTiles.js';
import { getCarpetPreview, hasCarpetVariant } from '../office/sprites/carpetTiles.js';
import type { SpriteData } from '../office/types.js';
import {
  getItemsByType,
  getItemById,
  getTilesetMetadataImage,
} from '../office/sprites/assetLoader.js';
import type { ItemType } from '../office/sprites/assetLoader.js';
import { getPetCount, getPetName, getPetSprites, getPetTypes } from '../office/sprites/petSpriteData.js';
import type { AreaDefinition } from '../office/types.js';
import type { DirectoryEntry } from '../../../src/types.js';
import { DEFAULT_FLOOR_COLOR } from '../constants.js';

// ─── Props ─────────────────────────────────────────────────────
export interface EditorToolbarProps {
  editorState: EditorState;
  isEditMode: boolean;
  onToolChange: (tool: EditToolType) => void;
  onTileTypeChange: (type: TileType) => void;
  onFloorColorChange: (color: FloorColor) => void;
  onWallColorChange: (color: FloorColor) => void;
  onFurnitureTypeChange: (type: string) => void;
  furniturePaletteColor: FloorColor | null;
  selectedFurnitureColor: FloorColor | null;
  onFurniturePaletteColorChange: (color: FloorColor | null) => void;
  onSelectedFurnitureColorChange: (color: FloorColor | null) => void;
  onFurnitureColorPickToggle: (target: 'selected' | 'palette') => void;
  furnitureColorPickTarget: 'selected' | 'palette' | null;
  onColorGestureStart: () => void;
  onColorGestureEnd: () => void;
  activePetTypes: number[];
  onPetToggle: (petType: number) => void;
  onCarpetVariantChange: (variant: number) => void;
  onCarpetColorChange: (color: FloorColor, accent?: boolean) => void;
  areas: AreaDefinition[];
  areaMappings?: Record<string, string[]>;
  directories: DirectoryEntry[];
  selectedAreaLabel: string | null;
  transformError: string | null;
  onAreaAdd: (label: string, color: string) => boolean;
  onAreaRename: (oldLabel: string, newLabel: string) => void;
  onAreaColorChange: (label: string, color: string) => void;
  onAreaRemove: (label: string) => void;
  onAreaMappingChange: (directoryId: string, label: string, mapped: boolean) => void;
  onAreaSelect: (label: string) => void;
  onSave: () => void;
  onReset: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelected: () => void;
  onRotateSelected: () => void;
  onToggleSelectedState: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canToggleSelectedState: boolean;
  isSelectedFurnitureOn: boolean;
  isDirty: boolean;
  hasSelection: boolean;
  onExpandGrid?: (direction: 'left' | 'right' | 'up' | 'down') => void;
}

// ─── Constants ─────────────────────────────────────────────────
const TOOLBAR_WIDTH = 220;
const BG = '#1e1e1e';
const BG_SECTION = '#252526';
const BORDER = '#3c3c3c';
const TEXT = '#cccccc';
const TEXT_DIM = '#888888';
const ACCENT = '#0078d4';
const DANGER = '#c83232';

const TOOL_DEFS: { tool: EditToolType; icon: string; label: string }[] = [
  { tool: EditTool.SELECT, icon: '◎', label: 'Select' },
  { tool: EditTool.TILE_PAINT, icon: '▦', label: 'Floor' },
  { tool: EditTool.WALL_PAINT, icon: '▥', label: 'Wall' },
  { tool: EditTool.CARPET_PAINT, icon: '▦', label: 'Carpet' },
  { tool: EditTool.AREA_PAINT, icon: '⬚', label: 'Area' },
  { tool: EditTool.FURNITURE_PLACE, icon: '♜', label: 'Furniture' },
  { tool: EditTool.PETS, icon: '♥', label: 'Pets' },
  { tool: EditTool.ERASE, icon: '✕', label: 'Erase' },
  { tool: EditTool.EYEDROPPER, icon: '⊙', label: 'Eyedrop' },
];

const FLOOR_TYPES: { type: TileType; label: string }[] = [
  { type: TileType.FLOOR_1, label: '1' },
  { type: TileType.FLOOR_2, label: '2' },
  { type: TileType.FLOOR_3, label: '3' },
  { type: TileType.FLOOR_4, label: '4' },
  { type: TileType.FLOOR_5, label: '5' },
  { type: TileType.FLOOR_6, label: '6' },
  { type: TileType.FLOOR_7, label: '7' },
];

// Map TileType floor values to tileset-metadata item IDs for previews
const FLOOR_TYPE_TO_ITEM: Record<number, string> = {
  [TileType.FLOOR_1]: 'floor_wood',
  [TileType.FLOOR_2]: 'floor_blue_diamond',
  [TileType.FLOOR_3]: 'floor_wood',
  [TileType.FLOOR_4]: 'floor_blue_diamond',
  [TileType.FLOOR_5]: 'floor_wood',
  [TileType.FLOOR_6]: 'floor_blue_diamond',
  [TileType.FLOOR_7]: 'floor_wood',
};

// Placeable item categories from tileset-metadata.json
const PLACEABLE_CATEGORIES: { type: ItemType; label: string }[] = [
  { type: 'furniture', label: 'Furniture' },
  { type: 'electronics', label: 'Electronics' },
  { type: 'appliance', label: 'Appliances' },
  { type: 'decoration', label: 'Decorations' },
];

// ─── Styles ────────────────────────────────────────────────────
const styles = {
  root: {
    position: 'absolute' as const,
    top: 'var(--editor-toolbar-top, 0px)',
    left: 0,
    bottom: 48, // above BottomToolbar
    width: `${TOOLBAR_WIDTH}px`,
    maxWidth: '100%',
    boxSizing: 'border-box' as const,
    background: BG,
    borderRight: `1px solid ${BORDER}`,
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
    zIndex: 60,
    fontFamily: 'var(--vscode-font-family, "Segoe UI", sans-serif)',
    fontSize: '12px',
    color: TEXT,
    userSelect: 'none' as const,
    scrollbarWidth: 'thin' as const,
    scrollbarColor: `${BORDER} ${BG}`,
  },

  section: {
    padding: '8px',
    borderBottom: `1px solid ${BORDER}`,
  },

  sectionLabel: {
    fontSize: '10px',
    fontWeight: 600 as const,
    textTransform: 'uppercase' as const,
    color: TEXT_DIM,
    marginBottom: '6px',
    letterSpacing: '0.5px',
  },

  input: {
    boxSizing: 'border-box' as const,
    minWidth: 0,
    padding: '4px',
    background: BG_SECTION,
    color: TEXT,
    border: `1px solid ${BORDER}`,
    borderRadius: '3px',
    fontSize: '11px',
  },

  toolGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '3px',
  },

  toolBtn: (active: boolean) => ({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: '6px 2px',
    background: active ? ACCENT : BG_SECTION,
    color: active ? '#ffffff' : TEXT,
    border: `1px solid ${active ? ACCENT : BORDER}`,
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '14px',
    lineHeight: '1',
    gap: '2px',
    transition: 'background 0.1s',
  }),

  toolLabel: {
    fontSize: '9px',
    opacity: 0.8,
  },

  floorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '3px',
  },

  floorBtn: (active: boolean) => ({
    width: '100%',
    aspectRatio: '1',
    background: active ? ACCENT : BG_SECTION,
    border: `1px solid ${active ? ACCENT : BORDER}`,
    borderRadius: '2px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    color: active ? '#fff' : TEXT,
    fontSize: '10px',
    fontWeight: 600 as const,
  }),

  sliderRow: {
    display: 'flex',
    alignItems: 'center' as const,
    gap: '6px',
    marginBottom: '4px',
  },

  sliderLabel: {
    width: '14px',
    fontSize: '10px',
    color: TEXT_DIM,
    flexShrink: 0,
    textAlign: 'right' as const,
  },

  slider: {
    flex: 1,
    height: '4px',
    accentColor: ACCENT,
    cursor: 'pointer',
  },

  sliderValue: {
    width: '28px',
    fontSize: '10px',
    color: TEXT_DIM,
    textAlign: 'right' as const,
    flexShrink: 0,
  },

  checkRow: {
    display: 'flex',
    alignItems: 'center' as const,
    gap: '6px',
    marginTop: '4px',
  },

  furnitureGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '3px',
  },

  furnitureBtn: (active: boolean) => ({
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    padding: '4px',
    background: active ? ACCENT : BG_SECTION,
    border: `1px solid ${active ? ACCENT : BORDER}`,
    borderRadius: '3px',
    cursor: 'pointer',
    color: active ? '#fff' : TEXT,
    gap: '2px',
  }),

  actionRow: {
    display: 'flex',
    gap: '3px',
    flexWrap: 'wrap' as const,
  },

  actionBtn: (disabled: boolean, danger?: boolean) => ({
    flex: '1 1 45%',
    padding: '5px 4px',
    background: disabled ? '#333' : danger ? DANGER : BG_SECTION,
    color: disabled ? '#666' : '#fff',
    border: `1px solid ${disabled ? '#444' : danger ? DANGER : BORDER}`,
    borderRadius: '3px',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: '11px',
    fontWeight: 500 as const,
    textAlign: 'center' as const,
    opacity: disabled ? 0.5 : 1,
  }),

  saveBtn: (dirty: boolean) => ({
    flex: '1 1 100%',
    padding: '6px 4px',
    background: dirty ? '#0e639c' : BG_SECTION,
    color: dirty ? '#fff' : TEXT_DIM,
    border: `1px solid ${dirty ? ACCENT : BORDER}`,
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 600 as const,
    textAlign: 'center' as const,
  }),

  expandSection: {
    display: 'flex',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: '2px',
  },

  expandBtn: {
    padding: '3px 8px',
    background: BG_SECTION,
    color: TEXT,
    border: `1px solid ${BORDER}`,
    borderRadius: '2px',
    cursor: 'pointer',
    fontSize: '11px',
  },
};

// ─── Sprite Preview (tiny canvas) ──────────────────────────────
function SpritePreview({ sprite, size = 24 }: { sprite: SpriteData; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs || !sprite.length) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    const rows = sprite.length;
    const cols = sprite[0]?.length ?? 0;
    if (cols === 0) return;

    cvs.width = cols;
    cvs.height = rows;
    ctx.clearRect(0, 0, cols, rows);
    ctx.imageSmoothingEnabled = false;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const color = sprite[r][c];
        if (color && color !== '') {
          ctx.fillStyle = color;
          ctx.fillRect(c, r, 1, 1);
        }
      }
    }
  }, [sprite]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        imageRendering: 'pixelated',
      }}
    />
  );
}

// ─── Tileset Item Preview (canvas from PNG spritesheet) ────────
function TilesetItemPreview({ itemId, size = 28 }: { itemId: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    const image = getTilesetMetadataImage();
    const item = getItemById(itemId);
    if (!image || !item) {
      cvs.width = size;
      cvs.height = size;
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#888';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', size / 2, size / 2);
      return;
    }

    const { x, y, width, height } = item.bounds;
    cvs.width = width;
    cvs.height = height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
  }, [itemId, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        imageRendering: 'pixelated',
      }}
    />
  );
}

/** Format a tileset metadata item ID into a human-readable label */
function formatItemLabel(id: string): string {
  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Color Sliders ─────────────────────────────────────────────
function ColorSliders({
  label,
  color,
  onChange,
  flat = false,
  onClear,
  clearLabel,
  onColorPickToggle,
  colorPickArmed = false,
  onGestureStart,
  onGestureEnd,
}: {
  label: string;
  color: FloorColor;
  onChange: (c: FloorColor) => void;
  flat?: boolean;
  onClear?: () => void;
  clearLabel?: string;
  onColorPickToggle?: () => void;
  colorPickArmed?: boolean;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}) {
  const handleChange = useCallback(
    (field: keyof FloorColor, value: number | boolean) => {
      onChange({ ...color, [field]: value });
    },
    [color, onChange]
  );

  return (
    <div
      data-testid={label === 'New Furniture Color' ? 'furniture-palette-color' : undefined}
      onPointerDown={(event) => {
        if (event.target instanceof HTMLInputElement && event.target.type === 'range') onGestureStart?.();
      }}
      onPointerUp={() => onGestureEnd?.()}
      onPointerCancel={() => onGestureEnd?.()}
      onLostPointerCapture={() => onGestureEnd?.()}
    >
      <div style={styles.sectionLabel}>{label}</div>
      {(onClear || onColorPickToggle) && (
        <div style={{ ...styles.actionRow, marginBottom: '6px' }}>
          {onClear && (
            <button type="button" style={styles.actionBtn(false)} onClick={onClear} aria-label={clearLabel}>
              No color
            </button>
          )}
          {onColorPickToggle && (
            <button
              type="button"
              style={{
                ...styles.actionBtn(false),
                ...(colorPickArmed ? { background: ACCENT, borderColor: ACCENT } : {}),
              }}
              onClick={onColorPickToggle}
              title="Copy color from another item"
              aria-label={`Copy color from another item to ${label}`}
              aria-pressed={colorPickArmed}
              data-testid={`furniture-color-pick-${label === 'New Furniture Color' ? 'palette' : 'selected'}`}
            >
              {colorPickArmed ? 'Cancel pick' : 'Pick color'}
            </button>
          )}
        </div>
      )}

      <div style={styles.sliderRow}>
        <span style={styles.sliderLabel}>H</span>
        <input
          type="range"
          aria-label={`${label} hue`}
          min={0}
          max={360}
          value={color.h}
          onChange={(e) => handleChange('h', Number(e.target.value))}
          style={styles.slider}
        />
        <span style={styles.sliderValue}>{color.h}</span>
      </div>

      <div style={styles.sliderRow}>
        <span style={styles.sliderLabel}>S</span>
        <input
          type="range"
          aria-label={`${label} saturation`}
          min={0}
          max={100}
          value={color.s}
          onChange={(e) => handleChange('s', Number(e.target.value))}
          style={styles.slider}
        />
        <span style={styles.sliderValue}>{color.s}</span>
      </div>

      <div style={styles.sliderRow}>
        <span style={styles.sliderLabel}>B</span>
        <input
          type="range"
          aria-label={`${label} brightness`}
          min={-100}
          max={100}
          value={color.b}
          onChange={(e) => handleChange('b', Number(e.target.value))}
          style={styles.slider}
        />
        <span style={styles.sliderValue}>{color.b}</span>
      </div>

      {!flat && <div style={styles.sliderRow}>
        <span style={styles.sliderLabel}>C</span>
        <input
          type="range"
          min={-100}
          max={100}
          value={color.c}
          onChange={(e) => handleChange('c', Number(e.target.value))}
          style={styles.slider}
        />
        <span style={styles.sliderValue}>{color.c}</span>
      </div>}

      {!flat && <div style={styles.checkRow}>
        <input
          type="checkbox"
          checked={!!color.colorize}
          onChange={(e) => handleChange('colorize', e.target.checked)}
          id={`colorize-${label}`}
        />
        <label htmlFor={`colorize-${label}`} style={{ fontSize: '10px', color: TEXT_DIM, cursor: 'pointer' }}>
          Colorize
        </label>
      </div>}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────
export function EditorToolbar({
  editorState,
  isEditMode,
  onToolChange,
  onTileTypeChange,
  onFloorColorChange,
  onWallColorChange,
  onFurnitureTypeChange,
  furniturePaletteColor,
  selectedFurnitureColor,
  onFurniturePaletteColorChange,
  onSelectedFurnitureColorChange,
  onFurnitureColorPickToggle,
  furnitureColorPickTarget,
  onColorGestureStart,
  onColorGestureEnd,
  activePetTypes,
  onPetToggle,
  onCarpetVariantChange,
  onCarpetColorChange,
  areas,
  areaMappings,
  directories,
  selectedAreaLabel,
  transformError,
  onAreaAdd,
  onAreaRename,
  onAreaColorChange,
  onAreaRemove,
  onAreaMappingChange,
  onAreaSelect,
  onSave,
  onReset,
  onUndo,
  onRedo,
  onDeleteSelected,
  onRotateSelected,
  onToggleSelectedState,
  canUndo,
  canRedo,
  canToggleSelectedState,
  isSelectedFurnitureOn,
  isDirty,
  hasSelection,
  onExpandGrid,
}: EditorToolbarProps) {
  // Force re-render when tileset assets become available
  const [_assetTick, setAssetTick] = useState(0);
  const [newAreaLabel, setNewAreaLabel] = useState('');
  const [newAreaColor, setNewAreaColor] = useState('#50c878');
  const [selectedDirectoryId, setSelectedDirectoryId] = useState('');
  useEffect(() => {
    const refresh = () => setAssetTick(t => t + 1);
    window.addEventListener('officeAssetsChanged', refresh);
    return () => window.removeEventListener('officeAssetsChanged', refresh);
  }, []);

  if (!isEditMode) return null;

  const activeTool = editorState.tool;
  const showFloorOptions = activeTool === EditTool.TILE_PAINT;
  const showWallOptions = activeTool === EditTool.WALL_PAINT;
  const showFurnitureOptions = activeTool === EditTool.FURNITURE_PLACE;
  const showCarpetOptions = activeTool === EditTool.CARPET_PAINT;
  const showAreaOptions = activeTool === EditTool.AREA_PAINT;
  const showPetOptions = activeTool === EditTool.PETS;
  const directoryOptions = directories;
  const selectedArea = areas.find((area) => area.label === selectedAreaLabel) ?? null;

  // Gather tileset metadata items for each placeable category
  const metadataCategories = PLACEABLE_CATEGORIES.map(cat => ({
    ...cat,
    items: getItemsByType(cat.type),
  })).filter(cat => cat.items.length > 0);

  return (
    <div style={styles.root} role="region" aria-label="Layout editor">
      {/* ── Tool Buttons ── */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>Tools</div>
        <div style={styles.toolGrid}>
          {TOOL_DEFS.map(({ tool, icon, label }) => (
            <button
              key={tool}
              style={styles.toolBtn(activeTool === tool)}
              onClick={() => onToolChange(tool)}
              title={label}
              aria-pressed={activeTool === tool}
            >
              <span>{icon}</span>
              <span style={styles.toolLabel}>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Floor Pattern Selector (with tile previews) ── */}
      {showCarpetOptions && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Carpet Style</div>
          <div style={styles.toolGrid}>
            {[0, 1, 2].map((variant) => (
              <button key={variant} title={`Carpet ${variant + 1}`}
                disabled={!hasCarpetVariant(variant)}
                aria-pressed={editorState.carpetVariant === variant}
                style={styles.furnitureBtn(editorState.carpetVariant === variant)}
                onClick={() => onCarpetVariantChange(variant)}>
                <SpritePreview sprite={getCarpetPreview(variant, editorState.carpetColor, editorState.carpetAccentColor)} size={52} />
                <span style={{ fontSize: '10px' }}>Style {variant + 1}</span>
              </button>
            ))}
          </div>
          <p style={{ fontSize: '10px', color: TEXT_DIM }}>Drag to paint over floors. Right-drag erases only carpet. Eyedrop copies style and both colors.</p>
          {!hasCarpetVariant(editorState.carpetVariant) && <p role="alert">Carpet style unavailable. Check asset diagnostics.</p>}
          <ColorSliders label="Carpet Main" color={editorState.carpetColor} onChange={(color) => onCarpetColorChange(color)} flat />
          <ColorSliders label="Carpet Accent" color={editorState.carpetAccentColor} onChange={(color) => onCarpetColorChange(color, true)} flat />
        </div>
      )}

      {showAreaOptions && (
        <div style={styles.section} data-testid="area-editor">
          <div style={styles.sectionLabel}>Named Areas</div>
          <p style={{ margin: '0 0 8px', fontSize: '10px', color: TEXT_DIM, lineHeight: 1.4 }}>
            Paint floor tiles, then map an Area to a stable directory. Choose Eyedrop and Shift-click a painted tile to select its Area; regular Eyedrop still samples carpet or floor. Mappings only affect real agents observed in the selected Squad root; launching another directory does not add its agents.
          </p>
          <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
            <input
              aria-label="New Area name"
              data-testid="new-area-name"
              value={newAreaLabel}
              onChange={(event) => setNewAreaLabel(event.target.value)}
              placeholder="Area name"
              style={{ ...styles.input, minWidth: 0, flex: 1 }}
            />
            <input
              aria-label="New Area color"
              type="color"
              value={newAreaColor}
              onChange={(event) => setNewAreaColor(event.target.value)}
              style={{ width: '32px', height: '28px', padding: 0, border: `1px solid ${BORDER}`, background: BG }}
            />
            <button
              type="button"
              data-testid="add-area"
              style={styles.actionBtn(false)}
              onClick={() => {
                if (onAreaAdd(newAreaLabel, newAreaColor)) setNewAreaLabel('');
              }}
            >Add</button>
          </div>
          {areas.map((area) => (
            <div key={area.label} style={{ display: 'grid', gridTemplateColumns: '1fr 30px 28px', gap: '4px', alignItems: 'center', marginBottom: '4px' }}>
              <input
                aria-label={`Rename Area ${area.label}`}
                key={area.label}
                defaultValue={area.label}
                onBlur={(event) => {
                  const value = event.currentTarget.value.trim();
                  if (value && value !== area.label) onAreaRename(area.label, value);
                  else event.currentTarget.value = area.label;
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    event.currentTarget.value = area.label;
                    event.currentTarget.blur();
                  }
                }}
                style={styles.input}
              />
              <input
                aria-label={`Color for Area ${area.label}`}
                type="color"
                value={area.color}
                onChange={(event) => onAreaColorChange(area.label, event.target.value)}
                style={{ width: '28px', height: '26px', padding: 0, border: `1px solid ${BORDER}`, background: BG }}
              />
              <button
                type="button"
                aria-label={`Remove Area ${area.label}`}
                title={`Remove ${area.label}`}
                style={styles.actionBtn(false, true)}
                onClick={() => onAreaRemove(area.label)}
              >×</button>
              <button
                type="button"
                aria-pressed={selectedAreaLabel === area.label}
                data-testid={`select-area-${area.label}`}
                style={{ ...styles.actionBtn(false), gridColumn: '1 / -1', textAlign: 'left', borderColor: selectedAreaLabel === area.label ? ACCENT : BORDER }}
                onClick={() => onAreaSelect(area.label)}
              >{selectedAreaLabel === area.label ? `Painting: ${area.label}` : `Select ${area.label}`}</button>
            </div>
          ))}
          {selectedArea && (
            <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: '8px', marginTop: '8px' }}>
              <label htmlFor="area-directory" style={{ display: 'block', marginBottom: '4px', fontSize: '10px', color: TEXT_DIM }}>
                Map {selectedArea.label} to directory
              </label>
              <select
                id="area-directory"
                data-testid="area-directory"
                value={selectedDirectoryId}
                onChange={(event) => setSelectedDirectoryId(event.target.value)}
                style={{ ...styles.input, width: '100%', marginBottom: '6px' }}
              >
                <option value="">Choose workspace or saved directory</option>
                {directoryOptions.map((directory) => (
                  <option key={directory.id} value={directory.id}>
                    {directory.name}{directory.valid ? '' : ' (unavailable)'}
                  </option>
                ))}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                <input
                  type="checkbox"
                  aria-label={`Map ${selectedArea.label} to selected directory`}
                  data-testid="area-mapping"
                  disabled={!selectedDirectoryId || !directoryOptions.some((directory) => directory.id === selectedDirectoryId)}
                  checked={selectedDirectoryId ? (areaMappings?.[selectedDirectoryId] ?? []).includes(selectedArea.label) : false}
                  onChange={(event) => onAreaMappingChange(selectedDirectoryId, selectedArea.label, event.target.checked)}
                />
                Prefer this Area for observed agents
              </label>
              {directoryOptions.length === 0 && (
                <p style={{ margin: '6px 0 0', fontSize: '10px', color: TEXT_DIM }}>No workspace or saved directories are available. Recent launch entries are not mapping identities.</p>
              )}
            </div>
          )}
          {transformError && <p role="alert" style={{ color: '#f14c4c', fontSize: '10px', margin: '8px 0 0' }}>{transformError}</p>}
        </div>
      )}

      {showPetOptions && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Pets</div>
          <div className="pets-carousel" data-testid="pets-carousel" style={styles.furnitureGrid}>
            {[...new Set([...getPetTypes(), ...activePetTypes])].sort((a, b) => a - b).map((petType) => {
              const sprites = getPetSprites(petType);
              const name = getPetName(petType);
              const active = activePetTypes.includes(petType);
              return (
                <button
                  key={petType}
                  type="button"
                  data-pet-type={petType}
                  title={sprites ? name : `${name} unavailable`}
                  aria-label={sprites ? name : `${name} unavailable; click to remove saved pet`}
                  aria-pressed={active}
                  disabled={!sprites && !active}
                  style={styles.furnitureBtn(active)}
                  onClick={() => onPetToggle(petType)}
                >
                  {sprites && <SpritePreview sprite={sprites.idleDown[0]} size={48} />}
                  <span style={{ fontSize: '9px' }}>{name}</span>
                  {!sprites && <span style={{ fontSize: '8px', color: TEXT_DIM }}>Unavailable</span>}
                </button>
              );
            })}
            {getPetCount() === 0 && (
              <div style={{ fontSize: '10px', color: TEXT_DIM, padding: '4px' }}>
                No valid pet sheets are loaded. Saved unavailable pets can still be removed; check asset diagnostics.
              </div>
            )}
          </div>
          <p style={{ fontSize: '10px', color: TEXT_DIM }}>Click a pet to add or remove it. Pets wander and follow nearby agents; click one to show a heart.</p>
        </div>
      )}

      {showFloorOptions && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Floor Pattern</div>
          <div style={styles.floorGrid}>
            {FLOOR_TYPES.map(({ type, label }) => {
              const itemId = FLOOR_TYPE_TO_ITEM[type];
              return (
                <button
                  key={type}
                  style={styles.floorBtn(editorState.tileType === type)}
                  onClick={() => onTileTypeChange(type)}
                  title={`Floor ${label}${itemId ? ` (${formatItemLabel(itemId)})` : ''}`}
                >
                  <SpritePreview sprite={getFloorSprite(type - 1)} size={22} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Floor Color ── */}
      {showFloorOptions && (
        <div style={styles.section}>
          <ColorSliders
            label="Floor Color"
            color={editorState.floorColor}
            onChange={onFloorColorChange}
          />
        </div>
      )}

      {/* ── Wall Tile Preview ── */}
      {showWallOptions && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Wall Tile</div>
          <div style={styles.furnitureGrid}>
            {getItemsByType('wall').map(item => (
              <button
                key={item.id}
                style={styles.furnitureBtn(true)}
                title={formatItemLabel(item.id)}
              >
                <TilesetItemPreview itemId={item.id} size={28} />
                <span style={{ fontSize: '9px' }}>{formatItemLabel(item.id)}</span>
              </button>
            ))}
            {getItemsByType('wall').length === 0 && (
              <div style={{ fontSize: '10px', color: TEXT_DIM, padding: '4px' }}>
                Wall (single type)
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Wall Color ── */}
      {showWallOptions && (
        <div style={styles.section}>
          <ColorSliders
            label="Wall Color"
            color={editorState.wallColor}
            onChange={onWallColorChange}
          />
        </div>
      )}

      {/* ── Legacy Furniture Catalog ── */}
      {showFurnitureOptions && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Furniture</div>
          <ColorSliders
            label="New Furniture Color"
            color={furniturePaletteColor ?? DEFAULT_FLOOR_COLOR}
            onChange={onFurniturePaletteColorChange}
            onClear={() => onFurniturePaletteColorChange(null)}
            clearLabel="Use no color for new furniture"
            onColorPickToggle={() => onFurnitureColorPickToggle('palette')}
            colorPickArmed={furnitureColorPickTarget === 'palette'}
          />
          <div style={styles.furnitureGrid}>
            {buildDynamicCatalog().map((entry) => (
              <button
                key={entry.type}
                style={styles.furnitureBtn(editorState.furnitureType === entry.type)}
                onClick={() => onFurnitureTypeChange(entry.type)}
                title={entry.label}
              >
                <SpritePreview sprite={entry.sprite} size={28} />
                <span style={{ fontSize: '9px' }}>{entry.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Tileset Metadata Categories (Electronics, Appliances, Decorations, etc.) ── */}
      {showFurnitureOptions && metadataCategories.map(cat => (
        <div key={cat.type} style={styles.section}>
          <div style={styles.sectionLabel}>{cat.label}</div>
          <div style={styles.furnitureGrid}>
            {cat.items.map(item => (
              <button
                key={item.id}
                style={styles.furnitureBtn(editorState.furnitureType === item.id)}
                onClick={() => onFurnitureTypeChange(item.id)}
                title={formatItemLabel(item.id)}
              >
                <TilesetItemPreview itemId={item.id} size={28} />
                <span style={{ fontSize: '9px' }}>{formatItemLabel(item.id)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* ── Selection Actions ── */}
      {hasSelection && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Selection</div>
          <ColorSliders
            label="Selected Furniture Color"
            color={selectedFurnitureColor ?? DEFAULT_FLOOR_COLOR}
            onChange={onSelectedFurnitureColorChange}
            onClear={() => onSelectedFurnitureColorChange(null)}
            clearLabel="Clear selected furniture color"
            onColorPickToggle={() => onFurnitureColorPickToggle('selected')}
            colorPickArmed={furnitureColorPickTarget === 'selected'}
            onGestureStart={onColorGestureStart}
            onGestureEnd={onColorGestureEnd}
          />
          <div style={styles.actionRow}>
            <button
              style={styles.actionBtn(false, true)}
              onClick={onDeleteSelected}
              title="Delete (Del)"
            >
              Delete
            </button>
            <button
              style={styles.actionBtn(false)}
              onClick={onRotateSelected}
              title="Rotate (R)"
            >
              Rotate
            </button>
            <button
              type="button"
              style={styles.actionBtn(!canToggleSelectedState)}
              onClick={canToggleSelectedState ? onToggleSelectedState : undefined}
              disabled={!canToggleSelectedState}
              aria-label={isSelectedFurnitureOn ? 'Turn off selected furniture' : 'Turn on selected furniture'}
              title={isSelectedFurnitureOn ? 'Turn off selected furniture' : 'Turn on selected furniture'}
            >
              {isSelectedFurnitureOn ? 'Turn Off' : 'Turn On'}
            </button>
          </div>
        </div>
      )}

      {/* ── Grid Expand ── */}
      {onExpandGrid && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Expand Grid</div>
          <div style={styles.expandSection}>
            <button style={styles.expandBtn} onClick={() => onExpandGrid('left')} title="Expand Left">←</button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <button style={styles.expandBtn} onClick={() => onExpandGrid('up')} title="Expand Up">↑</button>
              <button style={styles.expandBtn} onClick={() => onExpandGrid('down')} title="Expand Down">↓</button>
            </div>
            <button style={styles.expandBtn} onClick={() => onExpandGrid('right')} title="Expand Right">→</button>
          </div>
        </div>
      )}

      {/* ── Actions ── */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>Actions</div>
        <div style={styles.actionRow}>
          <button style={styles.saveBtn(isDirty)} onClick={onSave}>
            {isDirty ? '● Save Layout' : 'Save Layout'}
          </button>
          <button
            style={styles.actionBtn(!canUndo)}
            onClick={canUndo ? onUndo : undefined}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            style={styles.actionBtn(!canRedo)}
            onClick={canRedo ? onRedo : undefined}
            title="Redo (Ctrl+Y)"
          >
            Redo
          </button>
          <button
            style={styles.actionBtn(false, true)}
            onClick={onReset}
            title="Reset to last save"
          >
            Reset
          </button>
        </div>
      </div>

      {/* ── Keyboard Shortcuts ── */}
      <div style={{ ...styles.section, borderBottom: 'none' }}>
        <div style={styles.sectionLabel}>Shortcuts</div>
        <div style={{ fontSize: '10px', color: TEXT_DIM, lineHeight: '1.6' }}>
          <div><kbd style={kbdStyle}>Del</kbd> Delete selected</div>
          <div><kbd style={kbdStyle}>R</kbd> Rotate selected</div>
          <div><kbd style={kbdStyle}>Ctrl+Z</kbd> Undo</div>
          <div><kbd style={kbdStyle}>Ctrl+Shift+Z</kbd> Redo</div>
          <div><kbd style={kbdStyle}>Ctrl+Y</kbd> Redo</div>
          <div><kbd style={kbdStyle}>Esc</kbd> Deselect / Exit</div>
          <div><kbd style={kbdStyle}>Space+Drag</kbd> Pan</div>
          <div><kbd style={kbdStyle}>Ctrl+Scroll</kbd> Zoom</div>
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0 3px',
  background: '#333',
  border: '1px solid #555',
  borderRadius: '2px',
  fontSize: '9px',
  fontFamily: 'monospace',
  marginRight: '4px',
};
