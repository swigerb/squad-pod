import { useEffect, useRef, useState } from 'react';
import type { OfficeState } from '../office/engine/officeState.js';
import { getContextUsage, contextGauge } from '../office/toolUtils.js';
import { getCharacterScreenBounds } from '../office/engine/characterGeometry.js';

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
  gauge?: ReturnType<typeof contextGauge> & { x: number; y: number };
}

interface LabelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Place measured overlays in stable lanes, without shortening their text. */
export function placeOverlay(x: number, y: number, width: number, height: number,
  viewportWidth: number, viewportHeight: number, occupied: LabelBox[]): LabelBox {
  const left = width > 0 ? Math.max(4, Math.min(x - width / 2, viewportWidth - width - 4)) : x;
  const top = height > 0 ? Math.max(4, Math.min(y, viewportHeight - height - 4)) : y;
  const overlaps = (candidate: number) => occupied.some((box) =>
    left < box.left + box.width + 4 && left + width + 4 > box.left
    && candidate < box.top + box.height + 4 && candidate + height + 4 > box.top);
  const candidates = [top, ...occupied.map((box) => box.top - height - 4).sort((a, b) => b - a),
    ...occupied.map((box) => box.top + box.height + 4).sort((a, b) => a - b)];
  const placed = candidates.find((candidate) => candidate >= 4
    && candidate + height <= viewportHeight - 4 && !overlaps(candidate));
  const box = { left, top: placed ?? top, width, height };
  occupied.push(box);
  return box;
}

export function AgentLabels({ officeState, zoom, panRef, onAgentClick }: AgentLabelsProps) {
  const [labelPositions, setLabelPositions] = useState<LabelPosition[]>([]);
  const rafRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updatePositions = () => {
      const positions: LabelPosition[] = [];
      const occupied: LabelBox[] = [];
      const container = containerRef.current;
      const width = container?.clientWidth || window.innerWidth;
      const height = container?.clientHeight || window.innerHeight;
      for (const [agentId, char] of [...officeState.characters].sort(([a], [b]) => a.localeCompare(b))) {
        const px = panRef.current!.x;
        const py = panRef.current!.y;
        const bounds = getCharacterScreenBounds(char, zoom, { x: px, y: py });
        const labelX = (bounds.left + bounds.right) / 2;
        const characterTop = bounds.top;
        const labelY = characterTop - 14;
        const label = [...(container?.querySelectorAll<HTMLElement>('[data-agent-label]') ?? [])]
          .find((element) => element.dataset.agentLabel === agentId);
        const box = placeOverlay(labelX, labelY, label?.offsetWidth ?? 0, label?.offsetHeight ?? 0,
          width, height, occupied);
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
        });
      }
      for (const pos of positions) {
        if (!pos.isActive || !pos.tool) continue;
        const bubble = [...(container?.querySelectorAll<HTMLElement>('[data-agent-tool-bubble]') ?? [])]
          .find((element) => element.dataset.agentToolBubble === pos.agentId);
        const box = placeOverlay(pos.toolX, pos.toolY, bubble?.offsetWidth ?? 0, bubble?.offsetHeight ?? 0,
          width, height, occupied);
        pos.toolX = box.left;
        pos.toolY = box.top;
      }
      for (const pos of positions) {
        const usage = getContextUsage(officeState, pos.agentId);
        if (!usage || !pos.isActive) continue;
        const box = placeOverlay(pos.labelX, pos.labelY + 32, 40, 4, width, height, occupied);
        pos.gauge = { ...contextGauge(usage), x: box.left, y: box.top };
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
          <div key={pos.agentId}>
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
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') e.stopPropagation();
              }}
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
                maxWidth: 'calc(100vw - 8px)',
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
