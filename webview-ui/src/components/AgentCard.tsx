import { useEffect, useRef, useCallback } from 'react';

/** Agent detail info received from the extension */
export interface AgentDetailInfo {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'idle' | 'waiting';
  currentTask: string | null;
  charterSummary: string | null;
  recentActivity: string[];
  lastActiveAt: number;
}

interface AgentCardProps {
  detail: AgentDetailInfo | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onViewCharter?: (agentId: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  
  if (seconds < 60) return 'just now';
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours > 1 ? 's' : ''} ago`;
}

export function AgentCard({ detail, position, onClose, onViewCharter }: AgentCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
      onClose();
    }
  }, [onClose]);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (detail && position) {
      // Use mousedown instead of click to avoid the opening click
      // immediately triggering the "click outside" close handler.
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [detail, position, handleClickOutside, handleEscape]);

  if (!detail || !position) return null;

  // Clamp position to viewport bounds
  const maxWidth = 320;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const cardHeight = 400; // estimated max height
  
  let x = position.x;
  let y = position.y;
  
  if (x + maxWidth > viewportWidth) {
    x = viewportWidth - maxWidth - 10;
  }
  if (y + cardHeight > viewportHeight) {
    y = viewportHeight - cardHeight - 10;
  }
  if (x < 10) x = 10;
  if (y < 10) y = 10;

  const statusColor = 
    detail.status === 'active' ? '#4a9eff' :
    detail.status === 'waiting' ? '#ffd700' :
    '#888888';

  return (
    <div
      ref={cardRef}
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        maxWidth: `${maxWidth}px`,
        background: 'rgba(26, 26, 46, 0.95)',
        border: `2px solid ${statusColor}`,
        borderRadius: '8px',
        padding: '16px',
        pointerEvents: 'auto',
        zIndex: 100,
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#e0e0e0',
        boxShadow: '0 8px 16px rgba(0, 0, 0, 0.5)',
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          background: 'transparent',
          border: 'none',
          color: '#888',
          fontSize: '20px',
          cursor: 'pointer',
          padding: '0',
          width: '24px',
          height: '24px',
          lineHeight: '20px',
        }}
      >
        ×
      </button>

      {/* Header */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ 
          fontFamily: "'Press Start 2P', monospace", 
          fontSize: '14px', 
          marginBottom: '4px',
          color: statusColor,
        }}>
          {detail.name}
        </div>
        <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '8px' }}>
          {detail.role}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px' }}>
          <span style={{ 
            display: 'inline-block', 
            width: '8px', 
            height: '8px', 
            borderRadius: '50%', 
            background: statusColor,
          }} />
          <span style={{ color: '#ccc' }}>{detail.status}</span>
          <span style={{ marginLeft: 'auto', color: '#888' }}>
            {formatRelativeTime(detail.lastActiveAt)}
          </span>
        </div>
      </div>

      {/* Charter summary */}
      {detail.charterSummary && (
        <div style={{ 
          marginBottom: '12px', 
          padding: '8px', 
          background: 'rgba(0, 0, 0, 0.3)',
          borderRadius: '4px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}>
          <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>
            📜 Charter
          </div>
          <div style={{ fontSize: '11px', lineHeight: '1.4' }}>
            {detail.charterSummary}
          </div>
        </div>
      )}

      {/* Current task */}
      {detail.currentTask && (
        <div style={{ 
          marginBottom: '12px', 
          padding: '8px', 
          background: 'rgba(74, 158, 255, 0.1)',
          borderRadius: '4px',
          border: '1px solid rgba(74, 158, 255, 0.3)',
        }}>
          <div style={{ fontSize: '10px', color: '#4a9eff', marginBottom: '4px' }}>
            🔧 Current Task
          </div>
          <div style={{ fontSize: '11px', lineHeight: '1.4' }}>
            {detail.currentTask}
          </div>
        </div>
      )}

      {/* Recent activity */}
      {detail.recentActivity.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', color: '#888', marginBottom: '6px' }}>
            📋 Recent Activity
          </div>
          <div style={{ 
            fontSize: '10px', 
            lineHeight: '1.6',
            maxHeight: '120px',
            overflowY: 'auto',
          }}>
            {detail.recentActivity.slice(0, 5).map((activity, idx) => (
              <div key={idx} style={{ 
                marginBottom: '4px', 
                paddingLeft: '8px',
                borderLeft: '2px solid rgba(255, 255, 255, 0.2)',
              }}>
                {activity}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* View Charter button */}
      <button
        onClick={() => onViewCharter?.(detail.id)}
        style={{
          width: '100%',
          padding: '8px',
          background: statusColor,
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontSize: '11px',
          fontWeight: 'bold',
        }}
      >
        View Charter
      </button>
    </div>
  );
}
