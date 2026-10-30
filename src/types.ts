export interface SquadTeamMember {
  name: string;        // e.g. "Homer Simpson"
  slug: string;        // e.g. "homer-simpson" (directory name)
  role: string;        // e.g. "Lead"
  status: string;      // e.g. "✅ Active", "📋 Silent", "🔄 Monitor"
  charterPath: string; // e.g. ".squad/agents/homer-simpson/charter.md"
}

export type CurrentTaskSource = 'file' | 'live';

export interface SquadAgentState {
  id: string;                    // agent slug (e.g. "homer-simpson")
  name: string;                  // display name (e.g. "Homer Simpson")
  role: string;                  // e.g. "Lead"
  paletteIndex: number;          // character sprite palette index
  seatId: string | null;         // assigned seat in office
  status: 'active' | 'idle' | 'waiting'; // current activity
  currentTask: string | null;    // source-observed description, not necessarily live work
  currentTaskSource?: CurrentTaskSource | null;
  lastActiveAt: number | null;    // timestamp of the last attributable live activity
}

export interface SquadSession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  agent?: string;        // agent slug if identifiable
  messages: Array<{
    role: string;
    content: string;
    timestamp: string;
  }>;
}

export interface AgentDetailInfo {
  id: string;
  name: string;
  role: string;
  workspaceRoot: string;
  status: 'active' | 'idle' | 'waiting';
  currentTask: string | null;
  currentTaskSource?: CurrentTaskSource | null;
  charterSummary: string | null;  // first 2-3 sentences from charter.md
  charterContent: string | null;
  charterStatus: 'available' | 'missing' | 'unreadable' | 'unavailable';
  modelSources?: import('./declaredModels.js').ModelConfigSource[];
  expertise: string | null;
  responsibilities: string | null;
  boundaries: string | null;
  recentActivity: string[];        // last 3-5 log entries mentioning this agent
  lastActiveAt: number | null;
}

export interface PersistedAgentMeta {
  [agentId: string]: {
    palette?: number;
    seatId?: string;
  };
}

export interface SpriteData {
  width: number;
  height: number;
  pixels: number[];
}

export interface FurnitureAsset {
  name: string;
  sprite: SpriteData;
}

export interface FloorColor {
  h: number;
  s: number;
  b: number;
  c: number;
  colorize?: boolean;
}

export interface PlacedFurniture {
  assetFootprint?: { width: number; height: number };
  assetRole?: 'desk' | 'seat';
  uid: string;
  type: string;
  col: number;
  row: number;
  rotation: number;
  color?: FloorColor;
  state?: string;
}

export interface PlacedPet {
  id: string;
  petType: number;
}

export interface AreaDefinition {
  label: string;
  color: string;
}

export interface LayoutData {
  version?: number;
  cols: number;
  rows: number;
  tiles: number[];
  furniture: PlacedFurniture[];
  tileColors?: Record<string, FloorColor>;
  carpetTiles?: Array<CarpetTile | null>;
  pets?: PlacedPet[];
  areas?: AreaDefinition[];
  areaTiles?: Array<string | null>;
  areaMappings?: Record<string, string[]>;
}

export interface CarpetTile {
  variant: number;
  color?: FloorColor;
  accentColor?: FloorColor;
  order?: number;
}

export interface CharacterSpriteSet {
  paletteIndex: number;
  directions: {
    [direction: string]: {
      idle: SpriteData[];
      walk: SpriteData[];
    };
  };
}

// ─── Custom Tileset Assets ──────────────────────────────────────────

/** Coordinate region within a tileset PNG (pixel coordinates and dimensions). */
export interface TilesetObjectRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Parsed content of tileset.json — maps object names to pixel regions
 * in the tileset PNG.  Sent to the webview so it can slice the
 * spritesheet without extension-host PNG decoding.
 */
export interface TilesetData {
  name: string;
  tile_size: number;
  source: string;
  objects: Record<string, TilesetObjectRegion>;
}

/** Webview-safe URI for a single custom character sprite sheet. */
export interface CharacterAssetEntry {
  id: string;
  uri: string;
  paletteIndex: number;
  source: string;
  file: string;
  sha256: string;
}

// ─── Tileset Metadata (rich format from tileset-metadata.json) ───────

/** Category for a tileset item — determines rendering layer and interaction rules. */
export type ItemType = 'floor' | 'wall' | 'furniture' | 'electronics' | 'appliance' | 'decoration';

/** Pixel-coordinate bounding box within the tileset PNG. */
export interface ItemBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A single item in the tileset — identified by id, categorized by type. */
export interface TilesetItem {
  id: string;
  type: ItemType;
  bounds: ItemBounds;
}

/** Maps an interactive tileset item to the action it triggers. */
export interface TilesetInteractable {
  item_id: string;
  action: string;
}

/**
 * Full tileset metadata — the richer successor to TilesetData.
 * 18 categorized items with precise bounds plus an interactables table.
 */
export interface TilesetMetadata {
  tileset_name: string;
  tile_size: number;
  asset_source: string;
  items: TilesetItem[];
  interactables: TilesetInteractable[];
}

// ─── Telemetry ──────────────────────────────────────────────────────

export type TelemetryCategory = 'status' | 'session' | 'log' | 'orchestration' | 'agent' | 'decision';

export interface TelemetryEvent {
  id: string;
  timestamp: number;
  category: TelemetryCategory;
  agentId: string | null;
  agentName: string | null;
  summary: string;
  detail: string | null;
}

export type WebviewMessage =
  | { type: 'selectCliUsage' | 'refreshCliUsage' | 'clearCliUsage' }
  | { type: 'setLiveActivity'; enabled: boolean }
  | { type: 'addAssetDirectory' }
  | { type: 'removeAssetDirectory'; directory: string }
  | { type: 'getDirectories' }
  | { type: 'addDirectory'; path?: string; name?: string }
  | { type: 'updateDirectoryName'; id: string; name: string }
  | { type: 'changeDirectoryPath' | 'removeDirectory' | 'forgetDirectoryLaunch'; id: string }
  | { type: 'launchDirectory'; id: string; source: 'workspace' | 'saved' | 'recent' }
  | { type: 'webviewReady' | 'getSettings' | 'exportLayout' | 'importLayout' | 'openSquadInfo' }
  | { type: 'setSoundEnabled' | 'setDebugEnabled' | 'setShowAreas'; enabled: boolean }
  | { type: 'saveAgentSeats'; seats: Record<string, string> }
  | { type: 'saveLayout'; layout: LayoutData; expectedRevision?: string | null; workspaceRoot?: string | null }
  | { type: 'exportLayoutSnapshot'; layout: LayoutData }
  | { type: 'focusAgent' | 'openSquadAgent'; agentId: string }
  | { type: 'requestAgentDetail'; agentId: string; requestId?: string }
  | { type: 'diagnosticReport'; characterSheetsSize?: number; characterSheetKeys?: string[]; bootstrapRan?: boolean; errors?: string[] };

export interface PodSettings {
  soundEnabled: boolean;
  debugEnabled: boolean;
  showAreas: boolean;
}

export interface DirectoryEntry {
  id: string;
  name: string;
  path: string;
  valid: boolean;
  error?: string;
  lastLaunchedAt?: string;
}

export interface DirectoryCatalog {
  workspaceDirectories: DirectoryEntry[];
  savedDirectories: DirectoryEntry[];
  recentLaunches: DirectoryEntry[];
  squadHistory: DirectoryEntry[];
}

export interface SourceStatus {
  liveActivity?: LiveSourceStatus;
  workspaceRoot: string | null;
  squadDir: string | null;
  teamFound: boolean;
  observer: 'watching' | 'stopped';
  nativeWatch: boolean;
  error: string | null;
}

export interface LiveSourceStatus {
  state: 'off' | 'searching' | 'following' | 'error';
  sessionId: string | null;
}

export interface RuntimeModelObservation {
  model: string;
  kind: 'session-selection' | 'assistant-message' | 'tool-call' | 'subagent-model';
  source: RuntimeModelSource;
  timestamp: string;
}

export type RuntimeModelSource =
  | 'session.start.selectedModel'
  | 'session.resume.selectedModel'
  | 'session.model_change.newModel'
  | 'assistant.message.model'
  | 'tool.execution_complete.model'
  | 'subagent.started.model'
  | 'subagent.configured.model';

export interface LiveModelSnapshot {
  sessionId: string | null;
  session: RuntimeModelObservation | null;
  members: Record<string, RuntimeModelObservation>;
}

export interface AgentCreatedMessage {
  type: 'agentCreated';
  agent: {
    id: string;
    name: string;
    role: string;
    paletteIndex: number;
    seatId?: string | null;
    directoryId?: string | null;
    directoryMappingIds?: string[];
  };
}

export interface AgentStatusMessage {
  type: 'agentStatus';
  agentId: string;
  status: 'active' | 'idle' | 'waiting';
  currentTask?: string | null;
  currentTaskSource?: CurrentTaskSource | null;
}

export interface AgentToolStartMessage {
  type: 'agentToolStart';
  agentId: string;
  tool: string;
  toolId?: string;
  status?: string;
}

export interface AgentToolDoneMessage {
  type: 'agentToolDone';
  agentId: string;
  tool?: string;
  toolId?: string;
}

export interface ExistingAgentsMessage {
  type: 'existingAgents';
  agents: Array<{
    id: string;
    name: string;
    role: string;
    paletteIndex: number;
    seatId: string | null;
    directoryId?: string | null;
    directoryMappingIds?: string[];
    status: 'active' | 'idle' | 'waiting';
    currentTask: string | null;
    currentTaskSource?: CurrentTaskSource | null;
  }>;
}

export interface SquadInfoData {
  teamName: string | null;
  description: string | null;
  workspaceRoot: string | null;
  members: Array<{
    id: string;
    name: string;
    role: string;
    status: string;
    isActive: boolean;
    currentTask: string | null;
    currentTaskSource?: CurrentTaskSource | null;
  }>;
  hiddenMembers: Array<{ name: string; role: string; status: string }>;
  projectContext: string | null;
  totalAgents: number;
  activeAgents: number;
}

export type OutboundMessage =
  | { type: 'observedTasks'; snapshot: import('./observedTasks.js').ObservedTaskSnapshot }
  | { type: 'liveModels'; snapshot: LiveModelSnapshot }
  | { type: 'agentContextUsage'; agentId: string; contextTokens: number | null; maxContextTokens: number | null }
  | { type: 'recordedUsage'; snapshot: import('./recordedUsage.js').RecordedUsageSnapshot }
  | { type: 'cliUsage'; snapshot: import('./cliUsage.js').CliUsageSnapshot }
  | AgentCreatedMessage
  | AgentStatusMessage
  | AgentToolStartMessage
  | AgentToolDoneMessage
  | ExistingAgentsMessage
  | { type: 'agentClosed'; agentId: string }
  | { type: 'agentToolsClear'; agentId: string }
  | { type: 'agentToolPermissionClear'; agentId: string }
  | ({ type: 'settingsLoaded' } & PodSettings)
  | { type: 'directoryCatalog'; catalog: DirectoryCatalog }
  | { type: 'directoryError'; error: string }
  | { type: 'directoryNotice'; notice: string }
  | { type: 'sourceStatus'; status: SourceStatus }
  | { type: 'agentToolPermission'; agentId: string; tool: string }
  | { type: 'layoutLoaded'; layout: LayoutData; source?: 'external' | 'import'; revision?: string | null; workspaceRoot?: string }
  | { type: 'layoutSaved'; layout: LayoutData; revision: string | null }
  | { type: 'layoutError'; error: string; source?: 'watcher' }
  | { type: 'manifestAssetsLoaded'; snapshot: import('./manifestAssets.js').AssetSnapshot }
  // Webview-accepted legacy kinds not emitted by this host: squadRosterLoaded, floorTilesLoaded, wallTilesLoaded, furnitureLoaded, furnitureAssetsLoaded, assetBaseUrl.
  | { type: 'squadRosterLoaded'; members: SquadTeamMember[] }
  | { type: 'characterSpritesLoaded'; sprites: CharacterSpriteSet[] }
  | { type: 'floorTilesLoaded'; tiles?: unknown; sprites?: unknown }
  | { type: 'wallTilesLoaded'; tiles?: unknown; sprites?: unknown }
  | { type: 'furnitureLoaded'; furniture: FurnitureAsset[] }
  | { type: 'furnitureAssetsLoaded'; catalog?: unknown; sprites?: unknown }
  | { type: 'assetBaseUrl'; url: string }
  | { type: 'soundEnabled'; enabled: boolean }
  | { type: 'agentDetailLoaded'; detail: AgentDetailInfo; requestId?: string }
  | { type: 'squadInfoLoaded'; info: SquadInfoData }
  | { type: 'telemetryEvent'; event: TelemetryEvent }
  | { type: 'tilesetAssetsLoaded'; tilesetPngUri: string; tilesetData: TilesetData }
  | { type: 'tilesetMetadataLoaded'; tilesetPngUri: string; metadata: TilesetMetadata }
  | { type: 'characterAssetsLoaded'; characters: CharacterAssetEntry[]; diagnostics: string[] }
  | { type: 'noWorkspace' };
