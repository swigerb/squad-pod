import { useEffect, useRef, useState } from 'react';
import type { OfficeState } from '../office/engine/officeState.js';

interface AgentLabelsProps {
  officeState: OfficeState;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onAgentClick?: (agentId: string, screenX: number, screenY: number) => void;
}

interface LabelPosition {
  agentId: string;
  name: string;
  role: string;
  labelX: number;
  labelY: number;
  toolX: number;
  toolY: number;
  isActive: boolean;
  tool: string | undefined;
  bubbleType: string;
  isSelected: boolean;
}

export function AgentLabels({ officeState, zoom, panRef, onAgentClick }: AgentLabelsProps) {
  const [labelPositions, setLabelPositions] = useState<LabelPosition[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const updatePositions = () => {
      const positions: LabelPosition[] = [];
      for (const [agentId, char] of officeState.characters) {
        // Use char.x/y for smooth movement tracking
        const px = panRef.current!.x;
        const py = panRef.current!.y;
        const labelX = char.x * zoom + px;
        const characterTop = char.y * zoom + py - 20 * zoom;
        const labelY = characterTop - 14;
        positions.push({
          agentId,
          name: char.name || agentId,
          role: char.role || '',
          labelX,
          labelY,
          toolX: labelX + 8 * zoom + 4,
          toolY: characterTop - 2,
          isActive: char.active,
          tool: char.tool,
          bubbleType: char.bubbleState.type,
          isSelected: officeState.selectedAgentId === agentId,
        });
      }
      setLabelPositions(positions);
      rafRef.current = requestAnimationFrame(updatePositions);
    };
    rafRef.current = requestAnimationFrame(updatePositions);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [officeState, zoom, panRef]);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
      {labelPositions.map((pos) => {
        let dotColor = 'transparent';
        let dotClass = '';
        let status = 'Idle';
        if (pos.bubbleType === 'permission') {
          dotColor = '#facc15';
          status = 'Permission required';
        } else if (pos.bubbleType === 'waiting') {
          dotColor = '#facc15';
          status = 'Waiting';
        } else if (pos.isActive) {
          dotColor = '#60a5fa';
          dotClass = 'pixel-agents-pulse';
          status = 'Active';
        }

        return (
          <div key={pos.agentId}>
            {/* Tool bubble */}
            {pos.isActive && pos.tool && (
              <div style={{
                position: 'absolute',
                left: pos.toolX,
                top: pos.toolY,
                background: 'rgba(0,0,0,0.75)',
                color: '#60a5fa',
                fontSize: '9px',
                fontWeight: 600,
                padding: '2px 5px',
                borderRadius: '4px',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}>
                {pos.tool}
              </div>
            )}

            {/* Name label (clickable) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (e.detail === 0) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  onAgentClick?.(pos.agentId, rect.left + rect.width / 2, rect.bottom);
                } else {
                  onAgentClick?.(pos.agentId, e.clientX, e.clientY);
                }
              }}
              style={{
                position: 'absolute',
                left: pos.labelX,
                top: pos.labelY,
                transform: 'translateX(-50%)',
                textAlign: 'center',
                fontSize: '11px',
                fontWeight: 600,
                color: pos.isSelected ? '#fbbf24' : '#fff',
                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                cursor: 'pointer',
                pointerEvents: 'auto',
                background: 'transparent',
                border: 0,
                padding: 0,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span
                  role="img"
                  aria-label={status}
                  title={status}
                  className={dotClass}
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: dotColor,
                    flexShrink: 0,
                  }}
                />
                <span>{pos.name}</span>
              </span>
              {pos.role && <span style={{ fontSize: '9px', opacity: 0.7 }}>{pos.role}</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
