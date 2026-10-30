import { useRef, useEffect, useState, useCallback } from 'react';
import type { TelemetryEvent, TelemetryCategory } from '../office/types.js';
import type { RecordedUsageSnapshot } from '../../../src/recordedUsage.js';
import { RecordedUsage } from './RecordedUsage.js';
import { ObservedTasks } from './ObservedTasks.js';
import type { ObservedTaskSnapshot } from '../../../src/observedTasks.js';
import type { LiveSourceStatus, SourceStatus } from '../../../src/types.js';
import { SourceStatusView } from './SourceStatusView.js';

interface TelemetryDrawerProps {
  readOnly?: boolean;
  events: TelemetryEvent[];
  recordedUsage: RecordedUsageSnapshot | null;
  observedTasks?: ObservedTaskSnapshot | null;
  liveSource?: LiveSourceStatus;
  sourceStatus?: SourceStatus | null;
  onOpenSettings: () => void;
  isOpen: boolean;
  onToggle: () => void;
  onClear: () => void;
}

const CATEGORY_COLORS: Record<TelemetryCategory, string> = {
  status: '#4ec9b0',
  session: '#569cd6',
  log: '#dcdcaa',
  orchestration: '#c586c0',
  agent: '#ce9178',
  decision: '#d7ba7d',
};

const CATEGORY_LABELS: Record<TelemetryCategory, string> = {
  status: 'STATUS',
  session: 'SESSION',
  log: 'LOG',
  orchestration: 'ORCH',
  agent: 'AGENT',
  decision: 'DECISION',
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function TelemetryDrawer({ readOnly = false, events, recordedUsage, observedTasks = null, liveSource, sourceStatus = null, onOpenSettings, isOpen, onToggle, onClear }: TelemetryDrawerProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!events.length && listRef.current) {
      listRef.current.scrollTop = 0;
      setAutoScroll(true);
    }
  }, [events.length]);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (events.length && autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events.length, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!listRef.current) { return; }
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 30;
    setAutoScroll(isAtBottom);
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const jumpToBottom = useCallback(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
      setAutoScroll(true);
    }
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '48px',
        left: 0,
        right: 0,
        height: isOpen ? '40%' : '0',
        minHeight: isOpen ? '120px' : '0',
        maxHeight: isOpen ? '50%' : '0',
        background: 'var(--vscode-editor-background)',
        borderTop: isOpen ? '1px solid var(--vscode-panel-border)' : 'none',
        transition: 'height 0.25s ease, min-height 0.25s ease, max-height 0.25s ease',
        overflow: 'hidden',
        zIndex: 45,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 12px',
          borderBottom: '1px solid var(--vscode-panel-border)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--vscode-foreground)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Telemetry
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          {!autoScroll && (
            <button onClick={jumpToBottom} style={smallButtonStyle}>
              ↓ Latest
            </button>
          )}
          <button onClick={onClear} title="Clear activity feed only; observed tasks and recorded usage are unchanged" style={smallButtonStyle}>
            Clear activity
          </button>
          <button onClick={onToggle} style={smallButtonStyle}>
            ✕
          </button>
        </div>
      </div>

      {/* Event list */}
      <div
        role="region"
        aria-label="Telemetry content"
        ref={listRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 0',
          fontFamily: 'var(--vscode-editor-font-family, monospace)',
          fontSize: '12px',
          lineHeight: '18px',
          color: 'var(--vscode-foreground)',
        }}
      >
        <h3 style={{ padding: '0 12px', margin: '4px 0', fontSize: 12 }}>Activity events ({events.length})</h3>
        {events.length === 0 ? (
          <div style={{ padding: '4px 12px', color: 'var(--vscode-descriptionForeground)' }}>
            No activity events observed since this panel opened or activity was cleared.
            {' '}Existing files are a baseline, not replayed activity. Idle sources do not imply a failed collector or zero usage.
          </div>
        ) : null}
        <RecordedUsage snapshot={recordedUsage} />
        <div style={{ padding: '6px 12px', overflowWrap: 'anywhere' }}>
          {readOnly ? <p role="status">Settings and live-log consent are unavailable in this read-only observer. Nothing is enabled here.</p>
            : <><button onClick={onOpenSettings} style={smallButtonStyle}>Observation settings and consent</button>
              <p>Review live CLI observation in Settings; opening Settings enables nothing and does not populate recorded usage.</p></>}
          <details>
            <summary>Activity source diagnostics</summary>
            <SourceStatusView status={sourceStatus} readOnly={readOnly} />
          </details>
        </div>
        {isOpen && <ObservedTasks readOnly={readOnly} snapshot={observedTasks} source={liveSource} />}
        {events.length > 0 && (
          events.map((event) => {
            const isExpanded = expandedIds.has(event.id);
            const hasDetail = !!event.detail;
            return (
              <div
                key={event.id}
                onClick={hasDetail ? () => toggleExpand(event.id) : undefined}
                style={{
                  padding: '2px 12px',
                  cursor: hasDetail ? 'pointer' : 'default',
                  borderBottom: '1px solid var(--vscode-widget-border, transparent)',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = 'var(--vscode-list-hoverBackground)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                }}
              >
                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                  <span style={{ color: 'var(--vscode-descriptionForeground)', flexShrink: 0 }}>
                    {formatTimestamp(event.timestamp)}
                  </span>
                  <span
                    style={{
                      background: CATEGORY_COLORS[event.category],
                      color: '#1e1e1e',
                      padding: '0 4px',
                      borderRadius: '2px',
                      fontSize: '10px',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {CATEGORY_LABELS[event.category]}
                  </span>
                  <span style={{ color: 'var(--vscode-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {event.summary}
                  </span>
                  {hasDetail && (
                    <span style={{ color: 'var(--vscode-descriptionForeground)', flexShrink: 0 }}>
                      {isExpanded ? '▾' : '▸'}
                    </span>
                  )}
                </div>
                {isExpanded && event.detail && (
                  <div
                    style={{
                      marginTop: '4px',
                      marginLeft: '80px',
                      padding: '4px 8px',
                      background: 'var(--vscode-textBlockQuote-background)',
                      borderLeft: `2px solid ${CATEGORY_COLORS[event.category]}`,
                      color: 'var(--vscode-foreground)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {event.detail}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const smallButtonStyle: React.CSSProperties = {
  padding: '2px 8px',
  background: 'transparent',
  color: 'var(--vscode-foreground)',
  border: '1px solid var(--vscode-panel-border)',
  borderRadius: '3px',
  cursor: 'pointer',
  fontSize: '11px',
};
