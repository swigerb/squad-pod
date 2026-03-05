import { useEffect, useRef, useState } from 'react';
import type { OfficeState } from '../engine/officeState.js';

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

  useEffect(() => {
    const updatePositions = () => {
      const positions: ToolPosition[] = [];
      for (const [agentId, tools] of Object.entries(agentTools)) {
        if (tools.length === 0) continue;
        const char = officeState.characters.get(agentId);
        if (!char) continue;
        const screenX = char.x * zoom + panRef.current!.x;
        const screenY = char.y * zoom + panRef.current!.y - 40 * zoom;
        positions.push({ agentId, x: screenX, y: screenY, tools });
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
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 30 }}>
      {toolPositions.map((pos) => (
        <div
          key={pos.agentId}
          style={{
            position: 'absolute',
            left: pos.x,
            top: pos.y,
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.8)',
            color: '#fff',
            fontSize: '10px',
            padding: '4px 6px',
            borderRadius: '4px',
            whiteSpace: 'nowrap',
            maxWidth: '200px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
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
