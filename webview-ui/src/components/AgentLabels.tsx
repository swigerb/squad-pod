import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';
import { getContextUsage, contextGauge } from '../office/toolUtils.js';
import { getCharacterScreenBounds } from '../office/engine/characterGeometry.js';
import { AnnotationLayout } from '../office/engine/overlayLayout.js';
export { placeOverlay } from '../office/engine/overlayLayout.js';

interface AgentLabelsProps {
  officeState: OfficeState;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  agentTools?: Record<string, ToolActivity[]>;
  onAgentClick?: (agentId: string, screenX: number, screenY: number) => void;
  onLocateAgent?: (agentId: string) => void;
}

interface LabelPosition {
  agentId: string;
  name: string;
  role: string;
  labelX: number;
  labelY: number;
  anchorX: number;
  anchorY: number;
  width: number;
  height: number;
  measured: boolean;
  offscreen: string;
  isActive: boolean;
  tool: string | undefined;
  tools: ToolActivity[];
  bubbleType: string;
  isSelected: boolean;
  gauge?: ReturnType<typeof contextGauge>;
}

export function AgentLabels({ officeState, zoom, panRef, agentTools = {}, onAgentClick, onLocateAgent }: AgentLabelsProps) {
  const [frame, setFrame] = useState<{ positions: LabelPosition[]; docked: boolean }>({ positions: [], docked: false });
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(new AnnotationLayout());
  const refreshRef = useRef<(() => void) | null>(null);
  const toolsRef = useRef(agentTools);
  toolsRef.current = agentTools;

  useEffect(() => {
    let raf = 0;
    const updatePositions = () => {
      const container = containerRef.current;
      const width = container?.clientWidth || window.innerWidth;
      const height = container?.clientHeight || window.innerHeight;
      const elements = new Map([...(container?.querySelectorAll<HTMLElement>('[data-agent-annotation]') ?? [])]
        .map(element => [element.dataset.agentAnnotation!, element]));
      const positions: LabelPosition[] = [];
      for (const [agentId, char] of officeState.characters) {
        const bounds = getCharacterScreenBounds(char, zoom, panRef.current!);
        const element = elements.get(agentId);
        const usage = getContextUsage(officeState, agentId);
        positions.push({
          agentId, name: char.name || agentId, role: char.role || '',
          labelX: (bounds.left + bounds.right) / 2, labelY: bounds.top - 14,
          anchorX: (bounds.left + bounds.right) / 2, anchorY: bounds.top,
          width: element?.offsetWidth ?? 0, height: element?.offsetHeight ?? 0,
          measured: !!element, isActive: char.active, tool: char.tool, tools: toolsRef.current[agentId] ?? [],
          bubbleType: char.bubbleState.type, isSelected: officeState.selectedAgentId === agentId,
          offscreen: [
            bounds.right < 0 ? 'left' : bounds.left > width ? 'right' : '',
            bounds.bottom < 0 ? 'above' : bounds.top > height ? 'below' : '',
          ].filter(Boolean).join(' / '),
          gauge: usage && char.active ? contextGauge(usage) : undefined,
        });
      }
      const { boxes, docked } = layoutRef.current.place(positions.map(pos => ({
        id: pos.agentId, x: pos.labelX, y: pos.labelY - 56, width: pos.width, height: pos.height,
      })), width, height - 112);
      for (const pos of positions) {
        const box = boxes.get(pos.agentId)!;
        pos.labelX = box.left + box.width / 2;
        pos.labelY = box.top + 56;
      }
      setFrame({ positions, docked });
    };
    refreshRef.current = updatePositions;
    const tick = () => {
      updatePositions();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); refreshRef.current = null; };
  }, [officeState, zoom, panRef]);

  // A new name/tool/context footprint must be separated before paint, not one
  // animation frame after its DOM content has already covered a neighbor.
  useLayoutEffect(() => {
    const elements = containerRef.current?.querySelectorAll<HTMLElement>('[data-agent-annotation]');
    if ([...(elements ?? [])].some(element => {
      const pos = frame.positions.find(item => item.agentId === element.dataset.agentAnnotation);
      return pos && (!pos.measured || pos.width !== element.offsetWidth || pos.height !== element.offsetHeight);
    })) refreshRef.current?.();
  }, [frame]);

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
      {!frame.docked && <svg aria-hidden="true" style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden',
      }}>
        {frame.positions.filter(pos => !pos.offscreen && pos.measured).map(pos =>
          <line key={pos.agentId} data-agent-connector={pos.agentId}
            x1={pos.labelX} y1={pos.labelY + pos.height} x2={pos.anchorX} y2={pos.anchorY}
            stroke={pos.isSelected ? '#fbbf24' : '#cbd5e1'} strokeWidth={1} strokeOpacity={0.65} />)}
      </svg>}
      <div data-label-dock={frame.docked || undefined} role={frame.docked ? 'group' : undefined}
        aria-label={frame.docked ? 'Crowded office labels - scroll to browse, locate to center a character' : undefined}
        style={frame.docked ? {
          position: 'absolute', right: 4, top: 60, bottom: 60, width: 220, maxWidth: 'calc(100% - 8px)',
          overflowY: 'auto', pointerEvents: 'auto', background: 'rgba(0,0,0,0.9)', padding: 4,
        } : undefined}>
        {frame.docked && <p style={{ fontSize: 11, margin: '0 0 8px' }}>Office labels (list, not character positions)</p>}
        {frame.positions.map(pos => {
          let dotColor = 'transparent';
          let dotClass = '';
          let status = 'Idle';
          if (pos.bubbleType === 'permission') { dotColor = '#facc15'; status = 'Permission required'; }
          else if (pos.bubbleType === 'waiting') { dotColor = '#facc15'; status = 'Waiting'; }
          else if (pos.isActive) { dotColor = '#60a5fa'; dotClass = 'pixel-agents-pulse'; status = 'Active'; }
          const running = pos.tools.filter(tool => !tool.done);
          const completedSlots = Math.max(0, 5 - running.length);
          const visible = [...running.slice(-5),
            ...(completedSlots ? pos.tools.filter(tool => tool.done).slice(-completedSlots) : [])];
          return (
            <div key={pos.agentId} data-agent-annotation={pos.agentId} data-agent-offscreen={pos.offscreen || undefined}
              style={{
                position: frame.docked ? 'relative' : 'absolute',
                left: frame.docked ? undefined : pos.labelX, top: frame.docked ? undefined : pos.labelY,
                transform: frame.docked ? undefined : 'translateX(-50%)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                width: 'max-content', maxWidth: frame.docked ? '100%' : 'min(220px, calc(100% - 8px))',
                marginBottom: frame.docked ? 8 : undefined, visibility: pos.measured ? 'visible' : 'hidden',
                background: 'rgba(0,0,0,0.8)', color: '#fff', borderRadius: 4,
                overflowWrap: 'anywhere', boxSizing: 'border-box',
              }}>
              <button type="button" data-agent-label={pos.agentId}
                onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); }}
                onClick={e => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  onAgentClick?.(pos.agentId, e.detail === 0 ? rect.left + rect.width / 2 : e.clientX,
                    e.detail === 0 ? rect.bottom : e.clientY);
                }}
                style={{
                  textAlign: 'center', fontSize: 11, fontWeight: 600, color: pos.isSelected ? '#fbbf24' : '#fff',
                  textShadow: '1px 1px 2px rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 2, cursor: 'pointer', pointerEvents: 'auto',
                  background: 'transparent', border: 0, padding: 0, maxWidth: '100%', overflowWrap: 'anywhere',
                }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span role="img" aria-label={status} title={status} className={dotClass}
                    style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                  <span>{pos.name}</span>
                </span>
                {pos.role && <span style={{ fontSize: 9, opacity: 0.7 }}>{pos.role}</span>}
                {pos.offscreen && <span style={{ fontSize: 10, color: '#fbbf24' }}>Off-screen {pos.offscreen}</span>}
              </button>
              {(pos.offscreen || frame.docked) && onLocateAgent && <button type="button"
                aria-label={`Locate ${pos.name}`} onClick={e => { e.stopPropagation(); onLocateAgent(pos.agentId); }}
                onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); }}
                style={{ pointerEvents: 'auto', cursor: 'pointer' }}>Locate character</button>}
              {pos.isActive && pos.tool && <div data-agent-tool-bubble={pos.agentId}
                style={{ color: '#60a5fa', fontSize: 9, fontWeight: 600, maxWidth: '100%' }}>{pos.tool}</div>}
              {pos.gauge && <span data-agent-context={pos.agentId} role="progressbar"
                aria-label={pos.gauge.label} title={pos.gauge.label}
                aria-valuenow={pos.gauge.percent} aria-valuemin={0} aria-valuemax={100}
                style={{ width: 40, height: 4, background: '#333', pointerEvents: 'auto', boxShadow: '0 0 0 1px #111' }}>
                <span style={{ display: 'block', height: '100%', width: `${pos.gauge.percent}%`, background: pos.gauge.color }} />
              </span>}
              {pos.tools.length > 0 && <div data-agent-tools={pos.agentId}
                style={{ fontSize: 10, padding: '4px 6px', maxWidth: '100%', boxSizing: 'border-box' }}>
                {visible.map(tool => <div key={tool.toolId} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: tool.done ? '#4ade80' : tool.permissionWait ? '#facc15' : '#60a5fa' }}>
                    {tool.done ? '✓' : tool.permissionWait ? '⚠' : '●'}
                  </span>
                  <span>{tool.status}</span>
                </div>)}
                {pos.tools.length > 5 && <div>+{pos.tools.length - 5} more tools</div>}
              </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
