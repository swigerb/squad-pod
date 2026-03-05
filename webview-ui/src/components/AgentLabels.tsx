import { useEffect, useRef, useState } from 'react';
import type { OfficeState } from '../office/engine/officeState.js';
import { PULSE_ANIMATION_DURATION_SEC } from '../constants.js';

interface AgentLabelsProps {
  officeState: OfficeState;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

interface LabelPosition {
  agentId: string;
  name: string;
  role: string;
  x: number;
  y: number;
  isActive: boolean;
  bubbleType: 'permission' | 'waiting' | null;
  isSelected: boolean;
}

export function AgentLabels({ officeState, zoom, panRef }: AgentLabelsProps) {
  const [labelPositions, setLabelPositions] = useState<LabelPosition[]>([]);
  const rafRef = useRef<number>();

  useEffect(() => {
    const updatePositions = () => {
      const positions: LabelPosition[] = [];
      for (const [agentId, char] of officeState.characters) {
        const screenX = char.x * zoom + panRef.current!.x;
        const screenY = char.y * zoom + panRef.current!.y - 30 * zoom;
        positions.push({
          agentId,
          name: char.name || agentId,
          role: char.role || '',
          x: screenX,
          y: screenY,
          isActive: char.isActive,
          bubbleType: char.bubbleType,
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
        if (pos.bubbleType === 'waiting') {
          dotColor = '#facc15';
        } else if (pos.isActive) {
          dotColor = '#60a5fa';
          dotClass = 'pixel-agents-pulse';
        }

        return (
          <div
            key={pos.agentId}
            style={{
              position: 'absolute',
              left: pos.x,
              top: pos.y,
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
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div
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
            </div>
            {pos.role && <div style={{ fontSize: '9px', opacity: 0.8 }}>{pos.role}</div>}
          </div>
        );
      })}
    </div>
  );
}
