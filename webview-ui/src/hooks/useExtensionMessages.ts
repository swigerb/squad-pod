import { useEffect, useState, useRef, useCallback } from 'react';
import type { OfficeState } from '../office/engine/officeState.js';
import type { OfficeLayout, ToolActivity, SquadTeamMember, TelemetryEvent } from '../office/types.js';
import { useHostClient } from '../HostClientContext.js';
import type { AgentDetailInfo } from '../components/AgentCard.js';
import type { SquadInfoData } from '../components/SquadInfoCard.js';
import {
  addSnapshotAgent,
  applyAgentStatus,
  reconcileAgents,
  type AgentSnapshot,
  type AgentStatus,
} from '../office/engine/agentSync.js';
import { playDoneSound, setSoundEnabled } from '../notificationSound.js';
import type { DirectoryCatalog, PodSettings, SourceStatus } from '../../../src/types.js';
import type { AssetSnapshot } from '../../../src/manifestAssets.js';
import type { RecordedUsageSnapshot } from '../../../src/recordedUsage.js';
import type { OutboundMessage } from '../../../src/types.js';

// Static imports — dynamic import() creates code-split chunks in Vite whose
// module-level state is isolated from the main bundle.  That means calling
// e.g. setFloorSprites on the chunk's copy has NO effect on the renderer's
// copy imported statically in renderer.ts.  Static imports guarantee a single
// module instance shared across the entire bundle.
import { isRendererCharacters, isRendererTiles } from '../legacySprites.js';
import { setCharacterTemplates } from '../office/sprites/defaultCharacters.js';
import { buildDynamicCatalog } from '../office/layout/furnitureCatalog.js';
import { setFloorSprites } from '../office/floorTiles.js';
import { setWallSprites } from '../office/wallTiles.js';
import { setCarpetSprites } from '../office/sprites/carpetTiles.js';
import { setPetTemplates } from '../office/sprites/petSpriteData.js';
import {
  setAssetBaseUrl,
  loadAssets,
  setTilesetMetadata,
  setLegacyTilesetAssets,
  loadCharacterSheetsFromUris,
  getFullDiagnosticReport,
} from '../office/sprites/assetLoader.js';

const MAX_TELEMETRY_EVENTS = 200;
const OBSERVED_TASK_ROW_ID = '__squad-pod-observed-task';

type AgentActivityMessage = Extract<OutboundMessage, {
  type: 'agentStatus' | 'agentToolStart' | 'agentToolDone' | 'agentToolsClear'
    | 'agentToolPermission' | 'agentToolPermissionClear';
}>;

function isAgentActivityMessage(message: OutboundMessage): message is AgentActivityMessage {
  switch (message.type) {
    case 'agentStatus':
    case 'agentToolStart':
    case 'agentToolDone':
    case 'agentToolsClear':
    case 'agentToolPermission':
    case 'agentToolPermissionClear':
      return true;
    default:
      return false;
  }
}

export interface ExtensionMessageState {
  recordedUsage: RecordedUsageSnapshot | null;
  assetStatus: Pick<AssetSnapshot, 'directories' | 'diagnostics'>;
  settings: PodSettings;
  sourceStatus: SourceStatus | null;
  directoryCatalog: DirectoryCatalog | null;
  directoryError: string | null;
  directoryNotice: string | null;
  updateSetting: (setting: keyof PodSettings, enabled: boolean) => void;
  agents: string[];
  selectedAgent: string | null;
  agentTools: Record<string, ToolActivity[]>;
  agentStatuses: Record<string, string>;
  rosterMembers: SquadTeamMember[];
  layoutReady: boolean;
  noWorkspace: boolean;
  agentDetail: AgentDetailInfo | null;
  setAgentDetail: React.Dispatch<React.SetStateAction<AgentDetailInfo | null>>;
  squadInfo: SquadInfoData | null;
  setSquadInfo: React.Dispatch<React.SetStateAction<SquadInfoData | null>>;
  telemetryEvents: TelemetryEvent[];
  clearTelemetry: () => void;
}

export function useExtensionMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout, source: 'external' | 'import', revision: string | null, workspaceRoot?: string) => void,
  onLayoutSaved?: (layout: OfficeLayout, revision: string | null) => void,
  onLayoutError?: (error: string, source?: 'watcher') => void,
): ExtensionMessageState {
  const client = useHostClient();
  const [recordedUsage, setRecordedUsage] = useState<RecordedUsageSnapshot | null>(null);
  const [assetStatus, setAssetStatus] = useState<Pick<AssetSnapshot, 'directories' | 'diagnostics'>>({ directories: [], diagnostics: [] });
  const [legacyAssetDiagnostics, setLegacyAssetDiagnostics] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<PodSettings>({ soundEnabled: true, debugEnabled: false, showAreas: false });
  const [sourceStatus, setSourceStatus] = useState<SourceStatus | null>(null);
  const [directoryCatalog, setDirectoryCatalog] = useState<DirectoryCatalog | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [directoryNotice, setDirectoryNotice] = useState<string | null>(null);
  const [agents, setAgents] = useState<string[]>([]);
  const [selectedAgent] = useState<string | null>(null);
  const [agentTools, setAgentTools] = useState<Record<string, ToolActivity[]>>({});
  const [agentStatuses, setAgentStatuses] = useState<Record<string, string>>({});
  const [rosterMembers, setRosterMembers] = useState<SquadTeamMember[]>([]);
  // Every applied snapshot must render App's layout-derived UI, even after ready.
  const [layoutRevision, setLayoutRevision] = useState(0);
  const layoutReady = layoutRevision > 0;
  const [noWorkspace, setNoWorkspace] = useState(false);
  const [agentDetail, setAgentDetail] = useState<AgentDetailInfo | null>(null);
  const [squadInfo, setSquadInfo] = useState<SquadInfoData | null>(null);
  const [telemetryEvents, setTelemetryEvents] = useState<TelemetryEvent[]>([]);
  const bufferedAgentsRef = useRef<AgentSnapshot[] | null>(null);
  const bufferedActivityMessagesRef = useRef<AgentActivityMessage[]>([]);
  const statusesRef = useRef<Record<string, string>>({});
  const agentsRef = useRef<string[]>([]);
  const layoutReadyRef = useRef(false);

  // Keep refs in sync with state so the message handler always sees current values
  agentsRef.current = agents;
  layoutReadyRef.current = layoutReady;
  statusesRef.current = agentStatuses;

  const clearTelemetry = useCallback(() => setTelemetryEvents([]), []);
  const updateSetting = useCallback((setting: keyof PodSettings, enabled: boolean) => {
    setSettings((prev) => ({ ...prev, [setting]: enabled }));
    if (setting === 'soundEnabled') setSoundEnabled(enabled);
    const type = setting === 'soundEnabled' ? 'setSoundEnabled'
      : setting === 'debugEnabled' ? 'setDebugEnabled' : 'setShowAreas';
    client.send({ type, enabled });
  }, [client]);

  useEffect(() => {
    const rejectLegacySprites = (type: string) => {
      const diagnostic = `${type}: unsupported legacy sprite format. Existing assets were retained. Reload supported assets from VS Code.`;
      console.error(`[useExtensionMessages] ${diagnostic}`);
      setLegacyAssetDiagnostics((previous) => ({ ...previous, [type]: diagnostic }));
    };
    const clearLegacyDiagnostic = (type: string) => {
      setLegacyAssetDiagnostics((previous) => {
        const next = { ...previous };
        delete next[type];
        return next;
      });
    };
    const handleMessage = (message: OutboundMessage): void => {
      if (isAgentActivityMessage(message)
        && bufferedAgentsRef.current !== null
        && !layoutReadyRef.current
        && getOfficeState().layout.cols === 0) {
        bufferedActivityMessagesRef.current.push(message);
        return;
      }

      const applySnapshot = (snapshot: AgentSnapshot[]) => {
        const officeState = getOfficeState();
        reconcileAgents(officeState, snapshot);
        for (const agent of snapshot) {
          if (agent.status !== undefined || agent.currentTask !== undefined) {
            officeState.setAgentTool(agent.id, null);
          }
        }
        const seats = officeState.getSeatAssignments();
        if (snapshot.some((a) => (a.seatId ?? undefined) !== seats[a.id])) {
          client.send({ type: 'saveAgentSeats', seats });
        }
        const ids = snapshot.map((a) => a.id);
        agentsRef.current = ids;
        setAgents(ids);
        const statuses: Record<string, string> = {};
        for (const a of snapshot) {
          if (a.status) statuses[a.id] = a.status;
        }
        statusesRef.current = statuses;
        setAgentStatuses(statuses);
        setAgentTools((prev) => {
          const next: Record<string, ToolActivity[]> = {};
          for (const agent of snapshot) {
            const hasSnapshotActivity = agent.status !== undefined || agent.currentTask !== undefined;
            if (hasSnapshotActivity) {
              const task = agent.currentTask?.trim() && agent.status !== 'idle' ? agent.currentTask : null;
              if (task) {
                next[agent.id] = [{
                  toolId: OBSERVED_TASK_ROW_ID,
                  status: `Observed task: ${task}`,
                  done: false,
                }];
              }
            } else if (prev[agent.id]) {
              next[agent.id] = prev[agent.id];
            }
          }
          return next;
        });
      };

      switch (message.type) {
        case 'recordedUsage':
          setRecordedUsage(message.snapshot);
          break;
        case 'manifestAssetsLoaded': {
          const snapshot = message.snapshot as AssetSnapshot;
          buildDynamicCatalog(snapshot.furniture);
          setFloorSprites(snapshot.floors);
          setWallSprites(snapshot.walls);
          setCarpetSprites(snapshot.carpets);
          setPetTemplates(snapshot.pets ?? []);
          getOfficeState().refreshAssets();
          setAssetStatus({ directories: snapshot.directories, diagnostics: snapshot.diagnostics });
          break;
        }
        case 'squadRosterLoaded': {
          setRosterMembers(message.members || []);
          break;
        }

        case 'agentCreated': {
          const agent = message.agent as AgentSnapshot | undefined;
          if (!agent?.id) break;
          const officeState = getOfficeState();
          if (!layoutReadyRef.current && officeState.layout.cols === 0) {
            bufferedAgentsRef.current = [...(bufferedAgentsRef.current ?? []), agent];
            break;
          }
          addSnapshotAgent(officeState, agent);
          if (!agentsRef.current.includes(agent.id)) {
            agentsRef.current = [...agentsRef.current, agent.id];
            setAgents((prev) => (prev.includes(agent.id) ? prev : [...prev, agent.id]));
          }
          break;
        }

        case 'agentClosed': {
          const id = message.agentId;
          agentsRef.current = agentsRef.current.filter((a) => a !== id);
          if (bufferedAgentsRef.current) {
            bufferedAgentsRef.current = bufferedAgentsRef.current.filter((a) => a.id !== id);
          }
          bufferedActivityMessagesRef.current = bufferedActivityMessagesRef.current
            .filter((activity) => activity.agentId !== id);
          setAgents((prev) => prev.filter((a) => a !== id));
          setAgentTools((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setAgentStatuses((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          getOfficeState().removeAgent(id);
          break;
        }

        case 'agentStatus': {
          const id = message.agentId;
          const status = message.status as AgentStatus;
          const previous = statusesRef.current[id];
          statusesRef.current = { ...statusesRef.current, [id]: status };
          setAgentStatuses((prev) => ({ ...prev, [id]: status }));
          applyAgentStatus(getOfficeState(), id, status);
          if (previous === 'active' && status !== 'active') {
            playDoneSound();
          }
          if (status === 'idle') {
            getOfficeState().setAgentTool(id, null);
            setAgentTools((prev) => {
              const tools = prev[id];
              if (!tools?.some((tool) => tool.toolId === OBSERVED_TASK_ROW_ID)) return prev;
              return { ...prev, [id]: tools.filter((tool) => tool.toolId !== OBSERVED_TASK_ROW_ID) };
            });
          }
          break;
        }

        case 'agentToolStart': {
          const id = message.agentId;
          const toolId = message.tool ?? message.toolId;
          const status = message.status ?? toolId;
          setAgentTools((prev) => {
            const tools = (prev[id] || []).filter((tool) => tool.toolId !== OBSERVED_TASK_ROW_ID);
            const existing = tools.find((t) => t.toolId === toolId);
            if (existing) {
              existing.status = status;
              existing.done = false;
              existing.permissionWait = false;
              return { ...prev, [id]: [...tools] };
            }
            return { ...prev, [id]: [...tools, { toolId, status, done: false }] };
          });
          getOfficeState().setAgentTool(id, toolId);
          break;
        }

        case 'agentToolDone': {
          const id = message.agentId;
          const toolId = message.tool ?? message.toolId;
          setAgentTools((prev) => {
            const tools = prev[id] || [];
            const tool = tools.find((t) => t.toolId === toolId);
            if (tool) {
              tool.done = true;
            }
            return { ...prev, [id]: [...tools] };
          });
          break;
        }

        case 'agentToolsClear': {
          const id = message.agentId;
          setAgentTools((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          getOfficeState().setAgentTool(id, null);
          break;
        }

        case 'agentToolPermission': {
          const id = message.agentId;
          setAgentTools((prev) => {
            const tools = prev[id] || [];
            for (const tool of tools) {
              if (!tool.done) {
                tool.permissionWait = true;
              }
            }
            return { ...prev, [id]: [...tools] };
          });
          getOfficeState().showPermissionBubble(id);
          break;
        }

        case 'agentToolPermissionClear': {
          const id = message.agentId;
          setAgentTools((prev) => {
            const tools = prev[id] || [];
            for (const tool of tools) {
              tool.permissionWait = false;
            }
            return { ...prev, [id]: [...tools] };
          });
          getOfficeState().clearPermissionBubble(id);
          break;
        }

        case 'existingAgents': {
          const snapshot: AgentSnapshot[] = Array.isArray(message.agents) ? message.agents : [];
          // Roster and layout can arrive in either order; buffer until seats exist.
          const layoutIsReady = layoutReadyRef.current || getOfficeState().layout.cols > 0;
          if (!layoutIsReady) {
            bufferedAgentsRef.current = snapshot;
            bufferedActivityMessagesRef.current = [];
          } else {
            applySnapshot(snapshot);
          }
          break;
        }

        case 'layoutLoaded': {
          const { layout } = message;
          setLayoutRevision((revision) => revision + 1);
          // Update ref immediately so subsequent message handlers in the same
          // tick (e.g., existingAgents arriving right after) see the correct value.
          // React's setState is async — the ref normally updates on re-render.
          layoutReadyRef.current = true;
          const officeState = getOfficeState();
          if (onLayoutLoaded) onLayoutLoaded(layout, message.source ?? 'external', message.revision ?? null, message.workspaceRoot);
          else officeState.rebuildFromLayout(layout, true);

          if (bufferedAgentsRef.current !== null) {
            const buffered = bufferedAgentsRef.current;
            const bufferedActivityMessages = bufferedActivityMessagesRef.current;
            bufferedAgentsRef.current = null;
            bufferedActivityMessagesRef.current = [];
            applySnapshot(buffered);
            for (const activity of bufferedActivityMessages) {
              if (agentsRef.current.includes(activity.agentId)) {
                handleMessage(activity);
              }
            }
          }
          break;
        }
        case 'layoutSaved':
          onLayoutSaved?.(message.layout, message.revision);
          break;
        case 'layoutError':
          onLayoutError?.(message.error, message.source);
          break;

        case 'characterSpritesLoaded': {
          const sprites: unknown = message.sprites;
          if (isRendererCharacters(sprites)) {
            setCharacterTemplates(sprites);
            clearLegacyDiagnostic(message.type);
          } else rejectLegacySprites(message.type);
          break;
        }

        case 'furnitureAssetsLoaded': {
          const { catalog: _catalog, sprites: _sprites } = message;
          buildDynamicCatalog();
          break;
        }
        case 'furnitureLoaded':
          buildDynamicCatalog();
          break;

        case 'floorTilesLoaded':
        case 'wallTilesLoaded': {
          const tiles: unknown = message.tiles ?? message.sprites;
          if (isRendererTiles(tiles)) {
            if (message.type === 'floorTilesLoaded') setFloorSprites(tiles);
            else setWallSprites(tiles);
            clearLegacyDiagnostic(message.type);
          } else rejectLegacySprites(message.type);
          break;
        }

        case 'settingsLoaded': {
          setSettings({
            soundEnabled: message.soundEnabled,
            debugEnabled: message.debugEnabled,
            showAreas: message.showAreas === true,
          });
          setSoundEnabled(message.soundEnabled);
          break;
        }

        case 'directoryCatalog': {
          setDirectoryCatalog(message.catalog);
          setDirectoryError(null);
          break;
        }

        case 'directoryError': {
          setDirectoryError(message.error);
          setDirectoryNotice(null);
          break;
        }

        case 'directoryNotice': {
          setDirectoryNotice(message.notice);
          setDirectoryError(null);
          break;
        }

        case 'sourceStatus': {
          setSourceStatus(message.status);
          setNoWorkspace(message.status.workspaceRoot === null);
          break;
        }

        case 'soundEnabled': {
          setSoundEnabled(message.enabled ?? true);
          break;
        }

        case 'assetBaseUrl': {
          const { url } = message;
          if (url) {
            setAssetBaseUrl(url);
            loadAssets();
          }
          break;
        }

        case 'tilesetMetadataLoaded': {
          const { metadata, tilesetPngUri } = message;
          if (metadata && tilesetPngUri) {
            setTilesetMetadata(metadata, tilesetPngUri);
          } else {
            console.error('[useExtensionMessages] tilesetMetadataLoaded missing metadata or tilesetPngUri');
          }
          break;
        }

        case 'tilesetAssetsLoaded': {
          const { tilesetData, tilesetPngUri } = message;
          if (tilesetData && tilesetPngUri) {
            setLegacyTilesetAssets(tilesetData as { tile_size?: number; objects: Record<string, { x: number; y: number; w: number; h: number }> }, tilesetPngUri as string);
          } else {
            console.error('[useExtensionMessages] tilesetAssetsLoaded missing tilesetData or tilesetPngUri');
          }
          break;
        }

        case 'characterAssetsLoaded': {
          const { characters } = message;
          if (characters && Array.isArray(characters)) {
            loadCharacterSheetsFromUris(characters);
          } else {
            console.error('[useExtensionMessages] characterAssetsLoaded missing characters array');
          }
          break;
        }

        case 'agentDetailLoaded': {
          const { detail } = message;
          setAgentDetail(detail);
          break;
        }

        case 'squadInfoLoaded': {
          setSquadInfo(message.info);
          break;
        }

        case 'telemetryEvent': {
          const { event } = message;
          if (event) {
            setTelemetryEvents((prev) => {
              const next = [...prev, event as TelemetryEvent];
              return next.length > MAX_TELEMETRY_EVENTS ? next.slice(-MAX_TELEMETRY_EVENTS) : next;
            });
          }
          break;
        }

        case 'noWorkspace': {
          setNoWorkspace(true);
          setLayoutRevision((revision) => revision + 1);
          break;
        }

        default:
          break;
      }
    };

    const unsubscribe = client.subscribe(handleMessage);
    client.send({ type: 'webviewReady' });
    client.send({ type: 'diagnosticReport', ...getFullDiagnosticReport() });

    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, getOfficeState, onLayoutLoaded, onLayoutSaved, onLayoutError]);

  return {
    recordedUsage,
    assetStatus: { ...assetStatus, diagnostics: [...assetStatus.diagnostics, ...Object.values(legacyAssetDiagnostics)] },
    settings,
    sourceStatus,
    directoryCatalog,
    directoryError,
    directoryNotice,
    updateSetting,
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    rosterMembers,
    layoutReady,
    noWorkspace,
    agentDetail,
    setAgentDetail,
    squadInfo,
    setSquadInfo,
    telemetryEvents,
    clearTelemetry,
  };
}
