import { useEffect, useState, useRef } from 'react';
import type { OfficeState } from '../office/engine/officeState.js';
import type { OfficeLayout, ToolActivity, SquadTeamMember } from '../office/types.js';
import { vscode } from '../vscodeApi.js';

export interface ExtensionMessageState {
  agents: string[];
  selectedAgent: string | null;
  agentTools: Record<string, ToolActivity[]>;
  agentStatuses: Record<string, string>;
  rosterMembers: SquadTeamMember[];
  layoutReady: boolean;
}

interface AgentInfo {
  id: string;
  name: string;
  role: string;
}

export function useExtensionMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  isEditDirty?: () => boolean
): ExtensionMessageState {
  const [agents, setAgents] = useState<string[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [agentTools, setAgentTools] = useState<Record<string, ToolActivity[]>>({});
  const [agentStatuses, setAgentStatuses] = useState<Record<string, string>>({});
  const [rosterMembers, setRosterMembers] = useState<SquadTeamMember[]>([]);
  const [layoutReady, setLayoutReady] = useState(false);
  const bufferedAgentsRef = useRef<AgentInfo[]>([]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case 'squadRosterLoaded': {
          setRosterMembers(message.members || []);
          break;
        }

        case 'agentCreated': {
          const { id, name, role } = message;
          if (!agents.includes(id)) {
            setAgents((prev) => [...prev, id]);
            getOfficeState().addAgent(id, name, role);
          }
          break;
        }

        case 'agentClosed': {
          const { id } = message;
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
          const { id, status } = message;
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
          const { id, toolId, status } = message;
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
          const { id, toolId } = message;
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
          const { id } = message;
          setAgentTools((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          getOfficeState().setAgentTool(id, null);
          break;
        }

        case 'agentToolPermission': {
          const { id } = message;
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
          const { id } = message;
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
          if (!layoutReady) {
            bufferedAgentsRef.current = existingAgents;
          } else {
            const officeState = getOfficeState();
            for (const agent of existingAgents) {
              if (!agents.includes(agent.id)) {
                setAgents((prev) => [...prev, agent.id]);
                const meta = agentMeta?.[agent.id];
                officeState.addAgent(
                  agent.id,
                  agent.name,
                  agent.role,
                  meta?.palette,
                  meta?.hueShift,
                  meta?.seatId,
                  true
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
          const officeState = getOfficeState();
          officeState.rebuildFromLayout(layout, true);
          onLayoutLoaded?.(layout);

          if (bufferedAgentsRef.current.length > 0) {
            const existingAgents = bufferedAgentsRef.current;
            for (const agent of existingAgents) {
              if (!agents.includes(agent.id)) {
                setAgents((prev) => [...prev, agent.id]);
                officeState.addAgent(agent.id, agent.name, agent.role);
              }
            }
            bufferedAgentsRef.current = [];
          }
          break;
        }

        case 'characterSpritesLoaded': {
          const { characters } = message;
          import('../office/sprites/defaultCharacters.js').then(({ setCharacterTemplates }) => {
            setCharacterTemplates(characters);
          });
          break;
        }

        case 'furnitureAssetsLoaded': {
          const { catalog, sprites } = message;
          import('../office/layout/furnitureCatalog.js').then(({ buildDynamicCatalog }) => {
            buildDynamicCatalog(catalog, sprites);
          });
          break;
        }

        case 'floorTilesLoaded': {
          const { sprites } = message;
          import('../office/floorTiles.js').then(({ setFloorSprites }) => {
            setFloorSprites(sprites);
          });
          break;
        }

        case 'wallTilesLoaded': {
          const { sprites } = message;
          import('../office/wallTiles.js').then(({ setWallSprites }) => {
            setWallSprites(sprites);
          });
          break;
        }

        case 'settingsLoaded': {
          break;
        }

        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'webviewReady' });

    return () => window.removeEventListener('message', handleMessage);
  }, [agents, layoutReady, getOfficeState, onLayoutLoaded]);

  return {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    rosterMembers,
    layoutReady,
  };
}
