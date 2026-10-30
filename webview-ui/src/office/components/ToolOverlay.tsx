import { useEffect, useRef, useState } from 'react';
import type { OfficeState } from '../engine/officeState.js';
import { placeOverlay } from '../../components/AgentLabels.js';

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
        const screenX = char.x * zoom + panRef.current!.x;
        const screenY = char.y * zoom + panRef.current!.y - 40 * zoom;
        const label = [...(container?.querySelectorAll<HTMLElement>('[data-agent-tools]') ?? [])]
          .find((element) => element.dataset.agentTools === agentId);
        const box = placeOverlay(screenX, screenY, label?.offsetWidth ?? 0, label?.offsetHeight ?? 0,
          container?.clientWidth || window.innerWidth, container?.clientHeight || window.innerHeight, occupied);
        positions.push({ agentId, x: box.left, y: box.top, tools });
      }
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
      {toolPositions.map((pos) => (
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
          {pos.tools.map((tool, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
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
        </div>
      ))}
    </div>
  );
}
