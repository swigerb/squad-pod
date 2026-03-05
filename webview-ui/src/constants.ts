import type { FloorColor } from './office/types.js';

// Grid & Layout
export const TILE_SIZE = 16;
export const DEFAULT_COLS = 20;
export const DEFAULT_ROWS = 11;
export const MAX_COLS = 64;
export const MAX_ROWS = 64;

// Character Animation
export const WALK_SPEED_PX_PER_SEC = 48;
export const WALK_FRAME_DURATION_SEC = 0.15;
export const TYPE_FRAME_DURATION_SEC = 0.3;
export const WANDER_PAUSE_MIN_SEC = 2.0;
export const WANDER_PAUSE_MAX_SEC = 20.0;
export const WANDER_MOVES_BEFORE_REST_MIN = 3;
export const WANDER_MOVES_BEFORE_REST_MAX = 6;
export const SEAT_REST_MIN_SEC = 120.0;
export const SEAT_REST_MAX_SEC = 240.0;

// Rendering
export const CHARACTER_SITTING_OFFSET_PX = 6;
export const CHARACTER_Z_SORT_OFFSET = 0.5;
export const OUTLINE_Z_SORT_OFFSET = 0.001;
export const SELECTED_OUTLINE_ALPHA = 1.0;
export const HOVERED_OUTLINE_ALPHA = 0.5;
export const GHOST_PREVIEW_SPRITE_ALPHA = 0.5;
export const GHOST_PREVIEW_TINT_ALPHA = 0.25;
export const SELECTION_DASH_PATTERN = [4, 3];
export const VOID_TILE_DASH_PATTERN = [3, 2];
export const BUBBLE_FADE_DURATION_SEC = 0.5;
export const BUBBLE_SITTING_OFFSET_PX = 10;
export const BUBBLE_VERTICAL_OFFSET_PX = 24;
export const FALLBACK_FLOOR_COLOR = '#808080';

// Overlay Colors
export const SEAT_OWN_COLOR = 'rgba(90, 200, 140, 0.5)';
export const SEAT_AVAILABLE_COLOR = 'rgba(90, 140, 255, 0.3)';
export const SEAT_BUSY_COLOR = 'rgba(255, 140, 90, 0.3)';
export const GRID_LINE_COLOR = 'rgba(255, 255, 255, 0.15)';
export const VOID_TILE_OUTLINE_COLOR = 'rgba(255, 100, 100, 0.4)';
export const GHOST_BORDER_VALID = 'rgba(90, 200, 140, 0.8)';
export const GHOST_BORDER_INVALID = 'rgba(255, 90, 90, 0.8)';
export const GHOST_BORDER_VALID_COLOR = 'rgba(90, 200, 140, 0.8)';
export const GHOST_BORDER_INVALID_COLOR = 'rgba(255, 90, 90, 0.8)';
export const SELECTION_HIGHLIGHT_COLOR = 'rgba(90, 140, 255, 0.3)';
export const DELETE_BUTTON_BG = 'rgba(200, 50, 50, 0.9)';
export const ROTATE_BUTTON_BG = 'rgba(90, 140, 255, 0.9)';

// Zoom
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 10;
export const ZOOM_DEFAULT_DPR_FACTOR = 2;
export const ZOOM_LEVEL_FADE_DELAY_MS = 1500;
export const ZOOM_LEVEL_HIDE_DELAY_MS = 2000;
export const ZOOM_LEVEL_FADE_DURATION_SEC = 0.5;
export const ZOOM_SCROLL_THRESHOLD = 50;
export const PAN_MARGIN_FRACTION = 0.25;

// Editor
export const UNDO_STACK_MAX_SIZE = 50;
export const LAYOUT_SAVE_DEBOUNCE_MS = 500;
export const DEFAULT_FLOOR_COLOR: FloorColor = { h: 210, s: 25, b: 0, c: 0 };
export const DEFAULT_WALL_COLOR: FloorColor = { h: 30, s: 15, b: -20, c: 0 };
export const DEFAULT_NEUTRAL_COLOR: FloorColor = { h: 0, s: 0, b: 0, c: 0 };

// Notification Sound
export const NOTIFICATION_NOTE_1_FREQ = 659.25;
export const NOTIFICATION_NOTE_2_FREQ = 1318.5;
export const NOTIFICATION_NOTE_DURATION_SEC = 0.1;
export const NOTIFICATION_NOTE_GAP_SEC = 0.05;

// Game Logic
export const MAX_DELTA_TIME_SEC = 0.1;
export const WAITING_BUBBLE_DURATION_SEC = 2.0;
export const DISMISS_BUBBLE_FAST_FADE_SEC = 0.3;
export const INACTIVE_SEAT_TIMER_MIN_SEC = 30.0;
export const INACTIVE_SEAT_TIMER_MAX_SEC = 60.0;
export const PALETTE_COUNT = 6;
export const HUE_SHIFT_MIN = 0;
export const HUE_SHIFT_MAX = 360;
export const AUTO_ON_DEPTH_MIN = 2;
export const AUTO_ON_DEPTH_MAX = 8;
export const CHARACTER_HIT_RADIUS_PX = 8;
export const CHARACTER_HIT_HALF_WIDTH = 8;
export const CHARACTER_HIT_HEIGHT = 16;
export const TOOL_OVERLAY_VERTICAL_OFFSET = 32;
export const PULSE_ANIMATION_DURATION_SEC = 1.5;
