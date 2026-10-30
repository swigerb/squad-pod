import { useEffect, useRef, useState } from 'react';
import type { OfficeState } from '../engine/officeState.js';
import { OverlayLayout } from '../engine/overlayLayout.js';
import { getCharacterScreenBounds } from '../engine/characterGeometry.js';

interface ToolOverlayProps {
  officeState: OfficeState;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

export function ToolOverlay({ officeState, zoom, panRef }: ToolOverlayProps) {
  const [subagentPositions, setSubagentPositions] = useState<Array<{
    id: string; parentId: string; name: string; parentName: string; x: number; y: number;
  }>>([]);
  const rafRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(new OverlayLayout());

  useEffect(() => {
    const updatePositions = (time: number) => {
      const container = containerRef.current;
      const origin = container?.getBoundingClientRect();
      const layout = layoutRef.current;
      layout.begin();
      const width = container?.clientWidth || window.innerWidth;
      const height = container?.clientHeight || window.innerHeight;
      const occupied = [...(container?.parentElement?.querySelectorAll<HTMLElement>(
        '[data-agent-annotation]') ?? [])].map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left - (origin?.left ?? 0), top: rect.top - (origin?.top ?? 0),
          width: rect.width, height: rect.height };
      });
      const subPositions = [];
      for (const [id, { character, parentAgentId }] of officeState.subagents) {
        const bounds = getCharacterScreenBounds(character, zoom, panRef.current!);
        if (bounds.right < 0 || bounds.left > width || bounds.bottom < 0 || bounds.top > height) continue;
        const label = [...(container?.querySelectorAll<HTMLElement>('[data-subagent-label]') ?? [])]
          .find(element => element.dataset.subagentLabel === id);
        const box = layout.place(`subagent:${id}`, (bounds.left + bounds.right) / 2, bounds.bottom + 4,
          label?.offsetWidth ?? 0, label?.offsetHeight ?? 0,
          width, height, occupied, time);
        subPositions.push({ id, parentId: parentAgentId, name: character.name,
          parentName: officeState.characters.get(parentAgentId)?.name ?? parentAgentId, x: box.left, y: box.top });
      }
      layout.end();
      setSubagentPositions(subPositions);
      rafRef.current = requestAnimationFrame(updatePositions);
    };
    rafRef.current = requestAnimationFrame(updatePositions);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [officeState, zoom, panRef]);

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 19 }}>
      {subagentPositions.map(pos => <div key={pos.id} data-subagent-label={pos.id}
        data-parent-agent={pos.parentId} role="note"
        style={{ position: 'absolute', left: pos.x, top: pos.y, maxWidth: 'min(180px, calc(100vw - 8px))',
          background: 'rgba(0, 0, 0, 0.8)', color: '#bfdbfe', fontSize: 10, padding: '2px 4px',
          border: '1px dashed #93c5fd', borderRadius: 4, overflowWrap: 'anywhere' }}>
        Subtask: {pos.name}<br />Parent: {pos.parentName}
      </div>)}
    </div>
  );
}
