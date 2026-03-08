import { useEffect, useState, useRef, useCallback } from 'react';
import type { OfficeState } from '../office/engine/officeState.js';
import type { OfficeLayout, ToolActivity, SquadTeamMember, TelemetryEvent } from '../office/types.js';
import { vscode } from '../vscodeApi.js';
import type { AgentDetailInfo } from '../components/AgentCard.js';
import type { SquadInfoData } from '../components/SquadInfoCard.js';

// Static imports — dynamic import() creates code-split chunks in Vite whose
// module-level state is isolated from the main bundle.  That means calling
// e.g. setFloorSprites on the chunk's copy has NO effect on the renderer's
// copy imported statically in renderer.ts.  Static imports guarantee a single
// module instance shared across the entire bundle.
import { setCharacterTemplates } from '../office/sprites/defaultCharacters.js';
import { buildDynamicCatalog } from '../office/layout/furnitureCatalog.js';
import { setFloorSprites } from '../office/floorTiles.js';
import { setWallSprites } from '../office/wallTiles.js';
import {
  setAssetBaseUrl,
  loadAssets,
  setTilesetMetadata,
  setLegacyTilesetAssets,
  loadCharacterSheetsFromUris,
  areAssetsReady,
  getAssetLoadSnapshot,
} from '../office/sprites/assetLoader.js';

const MAX_TELEMETRY_EVENTS = 200;

export interface ExtensionMessageState {
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

interface AgentInfo {
  id: string;
  name: string;
  role: string;
}

export function useExtensionMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  _isEditDirty?: () => boolean
): ExtensionMessageState {
  const [agents, setAgents] = useState<string[]>([]);
  const [selectedAgent] = useState<string | null>(null);
  const [agentTools, setAgentTools] = useState<Record<string, ToolActivity[]>>({});
  const [agentStatuses, setAgentStatuses] = useState<Record<string, string>>({});
  const [rosterMembers, setRosterMembers] = useState<SquadTeamMember[]>([]);
  const [layoutReady, setLayoutReady] = useState(false);
  const [noWorkspace, setNoWorkspace] = useState(false);
  const [agentDetail, setAgentDetail] = useState<AgentDetailInfo | null>(null);
  const [squadInfo, setSquadInfo] = useState<SquadInfoData | null>(null);
  const [telemetryEvents, setTelemetryEvents] = useState<TelemetryEvent[]>([]);
  const bufferedAgentsRef = useRef<AgentInfo[]>([]);
  const agentsRef = useRef<string[]>([]);
  const layoutReadyRef = useRef(false);

  // Keep refs in sync with state so the message handler always sees current values
  agentsRef.current = agents;
  layoutReadyRef.current = layoutReady;

  const clearTelemetry = useCallback(() => setTelemetryEvents([]), []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (
        message?.type === 'tilesetMetadataLoaded' ||
        message?.type === 'tilesetAssetsLoaded' ||
        message?.type === 'characterAssetsLoaded'
      ) {
        console.log('[useExtensionMessages] Asset message received:', message.type, getAssetLoadSnapshot());
      }

      switch (message.type) {
        case 'squadRosterLoaded': {
          setRosterMembers(message.members || []);
          break;
        }

        case 'agentCreated': {
          const agent = message.agent;
          if (!agent) break;
          const { id, name, role } = agent;
          if (!agents.includes(id)) {
            setAgents((prev) => [...prev, id]);
            getOfficeState().addAgent(id, name, role);
          }
          break;
        }

        case 'agentClosed': {
          const id = message.agentId;
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
          const { status } = message;
          setAgentStatuses((prev) => ({ ...prev, [id]: status }));
          const officeState = getOfficeState();
          if (status === 'active') {
            officeState.setAgentActive(id, true);
          } else if (status === 'idle') {
            officeState.setAgentActive(id, false);
          } else if (status === 'waiting') {
            officeState.showWaitingBubble(id);
          }
          break;
        }

        case 'agentToolStart': {
          const id = message.agentId;
          const toolId = message.tool ?? message.toolId;
          const { status } = message;
          setAgentTools((prev) => {
            const tools = prev[id] || [];
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
          const { agents: existingAgents, agentMeta } = message;
          // Check both the ref AND the officeState directly — the ref might
          // be stale if React hasn't re-rendered since layoutLoaded was handled.
          const layoutIsReady = layoutReadyRef.current || getOfficeState().layout.cols > 0;
          if (!layoutIsReady) {
            bufferedAgentsRef.current = existingAgents;
          } else {
            const officeState = getOfficeState();
            for (const agent of existingAgents) {
              if (!agentsRef.current.includes(agent.id)) {
                setAgents((prev) => [...prev, agent.id]);
                const meta = agentMeta?.[agent.id];
                officeState.addAgent(
                  agent.id,
                  agent.name,
                  agent.role,
                  meta?.palette,
                  meta?.hueShift,
                  meta?.seatId
                );
                if (meta?.isActive) {
                  officeState.setAgentActive(agent.id, true);
                }
              }
            }
          }
          break;
        }

        case 'layoutLoaded': {
          const { layout } = message;
          setLayoutReady(true);
          // Update ref immediately so subsequent message handlers in the same
          // tick (e.g., existingAgents arriving right after) see the correct value.
          // React's setState is async — the ref normally updates on re-render.
          layoutReadyRef.current = true;
          const officeState = getOfficeState();
          officeState.rebuildFromLayout(layout, true);
          onLayoutLoaded?.(layout);

          if (bufferedAgentsRef.current.length > 0) {
            const existingAgents = bufferedAgentsRef.current;
            for (const agent of existingAgents) {
              if (!agentsRef.current.includes(agent.id)) {
                setAgents((prev) => [...prev, agent.id]);
                officeState.addAgent(agent.id, agent.name, agent.role);
              }
            }
            bufferedAgentsRef.current = [];
          }
          break;
        }

        case 'characterSpritesLoaded': {
          const { sprites } = message;
          setCharacterTemplates(sprites);
          break;
        }

        case 'furnitureLoaded':
        case 'furnitureAssetsLoaded': {
          const { catalog: _catalog, sprites: _sprites } = message;
          buildDynamicCatalog();
          break;
        }

        case 'floorTilesLoaded': {
          const tiles = message.tiles ?? message.sprites;
          setFloorSprites(tiles);
          break;
        }

        case 'wallTilesLoaded': {
          const tiles = message.tiles ?? message.sprites;
          setWallSprites(tiles);
          break;
        }

        case 'settingsLoaded': {
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
            console.log('[useExtensionMessages] tilesetMetadataLoaded received:', metadata.items?.length, 'items');
            setTilesetMetadata(metadata, tilesetPngUri);
            console.log('[useExtensionMessages] tilesetMetadataLoaded dispatched to assetLoader', getAssetLoadSnapshot());
          } else {
            console.error('[useExtensionMessages] tilesetMetadataLoaded missing metadata or tilesetPngUri');
          }
          break;
        }

        case 'tilesetAssetsLoaded': {
          const { tilesetData, tilesetPngUri } = message;
          if (tilesetData && tilesetPngUri) {
            console.log('[useExtensionMessages] tilesetAssetsLoaded received');
            setLegacyTilesetAssets(tilesetData as { tile_size?: number; objects: Record<string, { x: number; y: number; w: number; h: number }> }, tilesetPngUri as string);
            console.log('[useExtensionMessages] tilesetAssetsLoaded dispatched to assetLoader', getAssetLoadSnapshot());
          } else {
            console.error('[useExtensionMessages] tilesetAssetsLoaded missing tilesetData or tilesetPngUri');
          }
          break;
        }

        case 'characterAssetsLoaded': {
          const { characters } = message;
          if (characters && Array.isArray(characters)) {
            console.log('[useExtensionMessages] characterAssetsLoaded received:', characters.length, 'sheets');
            loadCharacterSheetsFromUris(characters);
            console.log('[useExtensionMessages] characterAssetsLoaded dispatched to assetLoader', getAssetLoadSnapshot());
            setTimeout(() => {
              console.log('[useExtensionMessages] ⏱️ Asset check (3s after characterAssetsLoaded): areAssetsReady()=' + areAssetsReady(), getAssetLoadSnapshot());
            }, 3000);
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
          setLayoutReady(true);
          break;
        }

        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    console.log('[useExtensionMessages] Posting webviewReady to extension host');
    vscode.postMessage({ type: 'webviewReady' });

    return () => window.removeEventListener('message', handleMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getOfficeState, onLayoutLoaded]);

  return {
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
