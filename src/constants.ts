// ─── Timing ─────────────────────────────────────────────────────────
export const SQUAD_POLL_INTERVAL_MS = 2000;
export const ACTIVITY_TIMEOUT_MS = 30000;
export const FILE_WATCHER_POLL_INTERVAL_MS = 1000;
export const TOOL_DONE_DELAY_MS = 300;

// ─── Display ────────────────────────────────────────────────────────
export const BASH_COMMAND_DISPLAY_MAX_LENGTH = 30;
export const TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40;

// ─── PNG / Asset Parsing ────────────────────────────────────────────
export const PNG_ALPHA_THRESHOLD = 128;
export const WALL_PIECE_WIDTH = 16;
export const WALL_PIECE_HEIGHT = 32;
export const WALL_GRID_COLS = 4;
export const WALL_BITMASK_COUNT = 16;
export const FLOOR_PATTERN_COUNT = 7;
export const FLOOR_TILE_SIZE = 16;
export const CHARACTER_DIRECTIONS = ['down', 'up', 'right'] as const;
export const CHAR_FRAME_W = 16;
export const CHAR_FRAME_H = 32;
export const CHAR_FRAMES_PER_ROW = 7;
export const CHAR_COUNT = 6;

// ─── Layout Persistence ─────────────────────────────────────────────
export const LAYOUT_FILE_DIR = '.squad-pod';
export const LAYOUT_FILE_NAME = 'layout.json';
export const LAYOUT_FILE_POLL_INTERVAL_MS = 2000;

// ─── Settings ───────────────────────────────────────────────────────
export const GLOBAL_KEY_SOUND_ENABLED = 'squad-pod.soundEnabled';

// ─── VS Code Identifiers ────────────────────────────────────────────
export const VIEW_ID = 'squad-pod.panelView';
export const COMMAND_SHOW_PANEL = 'squad-pod.showPanel';
export const COMMAND_EXPORT_DEFAULT_LAYOUT = 'squad-pod.exportDefaultLayout';
export const WORKSPACE_KEY_AGENTS = 'squad-pod.agents';
export const WORKSPACE_KEY_AGENT_SEATS = 'squad-pod.agentSeats';
export const WORKSPACE_KEY_LAYOUT = 'squad-pod.layout';

// ─── Squad Directory Paths (relative to workspace root) ─────────────
export const SQUAD_DIR = '.squad';
export const SQUAD_TEAM_FILE = '.squad/team.md';
export const SQUAD_SESSIONS_DIR = '.squad/sessions';
export const SQUAD_LOG_DIR = '.squad/log';
export const SQUAD_ORCHESTRATION_LOG_DIR = '.squad/orchestration-log';
export const SQUAD_AGENTS_DIR = '.squad/agents';
