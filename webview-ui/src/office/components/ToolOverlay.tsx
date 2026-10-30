import { useEffect, useRef, useState } from 'react';
import type { OfficeState } from '../engine/officeState.js';
import { placeOverlay } from '../../components/AgentLabels.js';
import { getCharacterScreenBounds } from '../engine/characterGeometry.js';

interface ToolOverlayProps {
  officeState: OfficeState;
  agentTools: Record<string, Array<{ toolId: string; status: string; done: boolean; permissionWait?: boolean }>>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

interface ToolPosition {
  agentId: string;
  x: number;
  y: number;
  tools: Array<{ toolId: string; status: string; done: boolean; permissionWait?: boolean }>;
}

export function ToolOverlay({ officeState, agentTools, zoom, panRef }: ToolOverlayProps) {
  const [toolPositions, setToolPositions] = useState<ToolPosition[]>([]);
  const [subagentPositions, setSubagentPositions] = useState<Array<{
    id: string; parentId: string; name: string; parentName: string; x: number; y: number;
  }>>([]);
  const rafRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updatePositions = () => {
      const positions: ToolPosition[] = [];
      const container = containerRef.current;
      const origin = container?.getBoundingClientRect();
      const occupied = [...(container?.parentElement?.querySelectorAll<HTMLElement>(
        '[data-agent-label], [data-agent-tool-bubble], [data-agent-context]') ?? [])].map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left - (origin?.left ?? 0), top: rect.top - (origin?.top ?? 0),
          width: rect.width, height: rect.height };
      });
      for (const [agentId, tools] of Object.entries(agentTools).sort(([a], [b]) => a.localeCompare(b))) {
        if (tools.length === 0) continue;
        const char = officeState.characters.get(agentId);
        if (!char) continue;
        const bounds = getCharacterScreenBounds(char, zoom, panRef.current!);
        const screenX = (bounds.left + bounds.right) / 2;
        const screenY = bounds.top - 8 * zoom;
        const label = [...(container?.querySelectorAll<HTMLElement>('[data-agent-tools]') ?? [])]
          .find((element) => element.dataset.agentTools === agentId);
        const box = placeOverlay(screenX, screenY, label?.offsetWidth ?? 0, label?.offsetHeight ?? 0,
          container?.clientWidth || window.innerWidth, container?.clientHeight || window.innerHeight, occupied);
        positions.push({ agentId, x: box.left, y: box.top, tools });
      }
      const subPositions = [];
      for (const [id, { character, parentAgentId }] of officeState.subagents) {
        const bounds = getCharacterScreenBounds(character, zoom, panRef.current!);
        const label = [...(container?.querySelectorAll<HTMLElement>('[data-subagent-label]') ?? [])]
          .find(element => element.dataset.subagentLabel === id);
        const box = placeOverlay((bounds.left + bounds.right) / 2, bounds.bottom + 4,
          label?.offsetWidth ?? 0, label?.offsetHeight ?? 0,
          container?.clientWidth || window.innerWidth, container?.clientHeight || window.innerHeight, occupied);
        subPositions.push({ id, parentId: parentAgentId, name: character.name,
          parentName: officeState.characters.get(parentAgentId)?.name ?? parentAgentId, x: box.left, y: box.top });
      }
      setSubagentPositions(subPositions);
      setToolPositions(positions);
      rafRef.current = requestAnimationFrame(updatePositions);
    };
    rafRef.current = requestAnimationFrame(updatePositions);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [officeState, agentTools, zoom, panRef]);

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 30 }}>
      {subagentPositions.map(pos => <div key={pos.id} data-subagent-label={pos.id}
        data-parent-agent={pos.parentId} role="note"
        style={{ position: 'absolute', left: pos.x, top: pos.y, maxWidth: 'min(180px, calc(100vw - 8px))',
          background: 'rgba(0, 0, 0, 0.8)', color: '#bfdbfe', fontSize: 10, padding: '2px 4px',
          border: '1px dashed #93c5fd', borderRadius: 4, overflowWrap: 'anywhere' }}>
        Subtask: {pos.name}<br />Parent: {pos.parentName}
      </div>)}
      {toolPositions.map((pos) => {
        const running = pos.tools.filter(tool => !tool.done);
        const completedSlots = Math.max(0, 5 - running.length);
        const visible = [...running.slice(-5),
          ...(completedSlots ? pos.tools.filter(tool => tool.done).slice(-completedSlots) : [])];
        return (
        <div
          key={pos.agentId}
          data-agent-tools={pos.agentId}
          style={{
            position: 'absolute',
            left: pos.x,
            top: pos.y,
            background: 'rgba(0, 0, 0, 0.8)',
            color: '#fff',
            fontSize: '10px',
            padding: '4px 6px',
            borderRadius: '4px',
            boxSizing: 'border-box',
            maxWidth: 'min(200px, calc(100vw - 8px))',
            overflowWrap: 'anywhere',
            pointerEvents: 'none',
          }}
        >
          {visible.map((tool) => (
            <div key={tool.toolId} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {tool.done ? (
                <span style={{ color: '#4ade80' }}>✓</span>
              ) : tool.permissionWait ? (
                <span style={{ color: '#facc15' }}>⚠</span>
              ) : (
                <span style={{ color: '#60a5fa' }}>●</span>
              )}
              <span>{tool.status}</span>
            </div>
          ))}
          {pos.tools.length > 5 && <div>+{pos.tools.length - 5} more tools</div>}
        </div>
        );
      })}
    </div>
  );
}
