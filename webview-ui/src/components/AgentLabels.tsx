import { useEffect, useRef, useState } from 'react';
import type { OfficeState } from '../office/engine/officeState.js';
import { getContextUsage, contextGauge } from '../office/toolUtils.js';
import { getCharacterScreenBounds } from '../office/engine/characterGeometry.js';
import { OverlayLayout, type LabelBox } from '../office/engine/overlayLayout.js';
export { placeOverlay } from '../office/engine/overlayLayout.js';

interface AgentLabelsProps {
  officeState: OfficeState;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onAgentClick?: (agentId: string, screenX: number, screenY: number) => void;
  onLocateAgent?: (agentId: string) => void;
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
  anchorX: number;
  anchorY: number;
  offscreen: string;
  gauge?: ReturnType<typeof contextGauge> & { x: number; y: number };
}

export function AgentLabels({ officeState, zoom, panRef, onAgentClick, onLocateAgent }: AgentLabelsProps) {
  const [labelPositions, setLabelPositions] = useState<LabelPosition[]>([]);
  const rafRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(new OverlayLayout());

  useEffect(() => {
    const updatePositions = (time: number) => {
      const positions: LabelPosition[] = [];
      const occupied: LabelBox[] = [];
      const container = containerRef.current;
      const width = container?.clientWidth || window.innerWidth;
      const height = container?.clientHeight || window.innerHeight;
      const layout = layoutRef.current;
      layout.begin();
      for (const [agentId, char] of [...officeState.characters].sort(([a], [b]) => a.localeCompare(b))) {
        const px = panRef.current!.x;
        const py = panRef.current!.y;
        const bounds = getCharacterScreenBounds(char, zoom, { x: px, y: py });
        const labelX = (bounds.left + bounds.right) / 2;
        const characterTop = bounds.top;
        const labelY = characterTop - 14;
        const offscreen = [
          bounds.right < 0 ? 'left' : bounds.left > width ? 'right' : '',
          bounds.bottom < 0 ? 'above' : bounds.top > height ? 'below' : '',
        ].filter(Boolean).join(' / ');
        const label = [...(container?.querySelectorAll<HTMLElement>('[data-agent-label]') ?? [])]
          .find((element) => element.dataset.agentLabel === agentId);
        const box = layout.place(`name:${agentId}`, labelX, labelY, label?.offsetWidth ?? 0, label?.offsetHeight ?? 0,
          width, height, occupied, time);
        positions.push({
          agentId,
          name: char.name || agentId,
          role: char.role || '',
          labelX: box.left + box.width / 2,
          labelY: box.top,
          toolX: labelX + 8 * zoom + 4,
          toolY: characterTop - 2,
          isActive: char.active,
          tool: char.tool,
          bubbleType: char.bubbleState.type,
          isSelected: officeState.selectedAgentId === agentId,
          anchorX: labelX,
          anchorY: characterTop,
          offscreen,
        });
      }
      for (const pos of positions) {
        if (!pos.isActive || !pos.tool) continue;
        const bubble = [...(container?.querySelectorAll<HTMLElement>('[data-agent-tool-bubble]') ?? [])]
          .find((element) => element.dataset.agentToolBubble === pos.agentId);
        const box = layout.place(`tool:${pos.agentId}`, pos.toolX, pos.toolY, bubble?.offsetWidth ?? 0, bubble?.offsetHeight ?? 0,
          width, height, occupied, time);
        pos.toolX = box.left;
        pos.toolY = box.top;
      }
      for (const pos of positions) {
        const usage = getContextUsage(officeState, pos.agentId);
        if (!usage || !pos.isActive || !container?.querySelector('[data-agent-label]')) continue;
        const box = layout.place(`context:${pos.agentId}`, pos.labelX, pos.labelY + 32, 40, 4, width, height, occupied, time);
        pos.gauge = { ...contextGauge(usage), x: box.left, y: box.top };
      }
      layout.end();
      setLabelPositions(positions);
      rafRef.current = requestAnimationFrame(updatePositions);
    };
    rafRef.current = requestAnimationFrame(updatePositions);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [officeState, zoom, panRef]);

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
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
          <div key={pos.agentId} data-agent-offscreen={pos.offscreen || undefined}>
            {!pos.offscreen && <svg aria-hidden="true" style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden',
            }}>
              <line x1={pos.labelX} y1={pos.labelY} x2={pos.anchorX} y2={pos.anchorY}
                stroke={pos.isSelected ? '#fbbf24' : '#cbd5e1'} strokeWidth={1} strokeOpacity={0.65} />
            </svg>}
            {pos.gauge && <span data-agent-context={pos.agentId} role="progressbar"
              aria-label={pos.gauge.label} title={pos.gauge.label}
              aria-valuenow={pos.gauge.percent} aria-valuemin={0} aria-valuemax={100}
              style={{ position: 'absolute', left: pos.gauge.x, top: pos.gauge.y,
                width: 40, height: 4, background: '#333', pointerEvents: 'auto', boxShadow: '0 0 0 1px #111' }}>
              <span style={{ display: 'block', height: '100%', width: `${pos.gauge.percent}%`, background: pos.gauge.color }} />
            </span>}
            {/* Tool bubble */}
            {pos.isActive && pos.tool && (
              <div data-agent-tool-bubble={pos.agentId} style={{
                position: 'absolute',
                left: pos.toolX,
                top: pos.toolY,
                background: 'rgba(0,0,0,0.75)',
                color: '#60a5fa',
                fontSize: '9px',
                fontWeight: 600,
                padding: '2px 5px',
                borderRadius: '4px',
                maxWidth: 'min(200px, calc(100vw - 8px))',
                overflowWrap: 'anywhere',
                pointerEvents: 'none',
              }}>
                {pos.tool}
              </div>
            )}

            {/* Name label (clickable) */}
            <button
              type="button"
              data-agent-label={pos.agentId}
              title={pos.offscreen ? `Locate ${pos.name}: off-screen ${pos.offscreen}` : undefined}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (pos.offscreen && onLocateAgent) {
                  onLocateAgent(pos.agentId);
                  return;
                }
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
                background: 'rgba(0,0,0,0.8)',
                border: 0,
                padding: 0,
                maxWidth: 'calc(100vw - 8px)',
                overflowWrap: 'anywhere',
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
              {pos.offscreen && <span style={{ fontSize: '10px', color: '#fbbf24' }}>
                Off-screen {pos.offscreen}{onLocateAgent ? ' - Locate' : ''}
              </span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
