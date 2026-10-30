import { useEffect, useRef, useCallback } from 'react';
import { useState } from 'react';
import type { AgentDetailInfo } from './AgentCard.js';

export interface SquadInfoData {
  teamName: string | null;
  description: string | null;
  workspaceRoot: string | null;
  members: Array<{
    id: string;
    name: string;
    role: string;
    status: string;
    isActive: boolean;
    currentTask: string | null;
  }>;
  hiddenMembers: Array<{ name: string; role: string; status: string }>;
  projectContext: string | null;
  totalAgents: number;
  activeAgents: number;
}

interface SquadInfoCardProps {
  info: SquadInfoData | null;
  agentDetails?: Record<string, AgentDetailInfo>;
  availableAgentIds?: string[];
  onRequestAgentDetail?: (agentId: string) => void;
  onOpenCharter?: (agentId: string) => void;
  onClose: () => void;
}

function statusDot(isActive: boolean): string {
  return isActive ? '🟢' : '⚪';
}

function roleEmoji(role: string): string {
  const r = role.toLowerCase();
  if (r.includes('lead') || r.includes('architect')) return '🏗️';
  if (r.includes('frontend') || r.includes('ui') || r.includes('design')) return '⚛️';
  if (r.includes('backend') || r.includes('api') || r.includes('server')) return '🔧';
  if (r.includes('test') || r.includes('qa') || r.includes('quality')) return '🧪';
  if (r.includes('devops') || r.includes('infra')) return '⚙️';
  if (r.includes('docs') || r.includes('devrel') || r.includes('writer')) return '📝';
  if (r.includes('scribe')) return '📋';
  if (r.includes('monitor')) return '🔄';
  return '👤';
}

export function SquadInfoCard({
  info, agentDetails = {}, availableAgentIds = [], onRequestAgentDetail, onOpenCharter, onClose,
}: SquadInfoCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
      onClose();
    }
  }, [onClose]);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (expandedAgentId && (!info?.members.some(member => member.id === expandedAgentId)
      || !availableAgentIds.includes(expandedAgentId))) {
      setExpandedAgentId(null);
    }
  }, [availableAgentIds, expandedAgentId, info]);

  useEffect(() => {
    if (info) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [info, handleClickOutside, handleEscape]);

  if (!info) return null;
  const expandedDetail = expandedAgentId ? agentDetails[expandedAgentId] : undefined;
  const detail = expandedDetail?.workspaceRoot === info.workspaceRoot ? expandedDetail : undefined;

  const accentColor = '#4a9eff';

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.5)',
      zIndex: 200,
      pointerEvents: 'auto',
    }}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Squad Info"
        style={{
          width: '400px',
          maxWidth: 'calc(100vw - 20px)',
          maxHeight: 'calc(100vh - 20px)',
          boxSizing: 'border-box',
          background: 'rgba(26, 26, 46, 0.97)',
          border: `2px solid ${accentColor}`,
          borderRadius: '12px',
          padding: '20px',
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#e0e0e0',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        {/* Close button */}
        <button
          type="button"
          aria-label="Close Squad Info"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            background: 'transparent',
            border: 'none',
            color: '#888',
            fontSize: '22px',
            cursor: 'pointer',
            padding: '0',
            width: '28px',
            height: '28px',
            lineHeight: '24px',
          }}
        >
          ×
        </button>

        {/* Header */}
        <div style={{ marginBottom: '16px', paddingRight: '32px' }}>
          <div style={{
            fontFamily: "'Press Start 2P', monospace",
            fontSize: '16px',
            color: accentColor,
            marginBottom: '6px',
          }}>
            {info.teamName || 'Squad Team'}
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '11px',
            color: '#aaa',
          }}>
            <span>👥 {info.totalAgents} agent{info.totalAgents !== 1 ? 's' : ''}</span>
            <span>🟢 {info.activeAgents} active</span>
          </div>
        </div>

        {/* Project Context */}
        {info.projectContext && (
          <div style={{
            marginBottom: '16px',
            padding: '10px',
            background: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '6px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}>
            <div style={{ fontSize: '10px', color: '#888', marginBottom: '6px' }}>
              📂 Project
            </div>
            <div style={{ fontSize: '11px', lineHeight: '1.5', color: '#ccc' }}>
              {info.projectContext}
            </div>
          </div>
        )}

        {/* Members */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '10px', color: '#888', marginBottom: '8px' }}>
            🏢 Team Members
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {info.members.map((m) => (
              <div key={m.id}>
                <button
                  type="button"
                  aria-expanded={expandedAgentId === m.id}
                  aria-controls={`agent-detail-${encodeURIComponent(m.id)}`}
                  aria-label={`${expandedAgentId === m.id ? 'Hide' : 'Show'} details for ${m.name}`}
                  onClick={() => {
                    if (expandedAgentId === m.id) {
                      setExpandedAgentId(null);
                    } else {
                      setExpandedAgentId(m.id);
                      if (availableAgentIds.includes(m.id)) {
                        onRequestAgentDetail?.(m.id);
                      }
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '8px 10px',
                    textAlign: 'left',
                    font: 'inherit',
                    color: 'inherit',
                    cursor: 'pointer',
                    background: m.isActive
                      ? 'rgba(74, 158, 255, 0.1)'
                      : 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '6px',
                    border: m.isActive
                      ? '1px solid rgba(74, 158, 255, 0.3)'
                      : '1px solid rgba(255, 255, 255, 0.06)',
                  }}>
                  <span style={{ fontSize: '14px', flexShrink: 0 }}>{roleEmoji(m.role)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: '12px', color: m.isActive ? accentColor : '#e0e0e0' }}>
                      {m.name}
                    </span>
                    <span style={{ marginLeft: '6px', fontSize: '10px', color: '#888' }}>{m.role}</span>
                  </span>
                  <span style={{ fontSize: '11px', flexShrink: 0 }}>{statusDot(m.isActive)}</span>
                </button>
                {expandedAgentId === m.id && (
                  <div id={`agent-detail-${encodeURIComponent(m.id)}`} style={{
                    margin: '4px 0 6px', padding: '10px', background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '6px',
                  }}>
                    {!availableAgentIds.includes(m.id) ? (
                      <div role="status">This agent is no longer available in the current workspace.</div>
                    ) : !detail ? (
                      <div role="status">Loading observed details…</div>
                    ) : (
                      <>
                        <div><strong>Observed status:</strong> {detail.status}</div>
                        <div><strong>Observed task:</strong> {detail.currentTask || 'No current task observed.'}</div>
                        <section aria-label="Model metadata" style={{ marginTop: '8px', overflowWrap: 'anywhere' }}>
                          <div><strong>Current-session model:</strong> unavailable</div>
                          <div>No authoritative runtime model field is implemented. Historical model reports remain historical.</div>
                          <strong>Declared model metadata (not effective runtime selection):</strong>
                          {detail.modelSources ? detail.modelSources.map(source => (
                            <div key={source.sourcePath} style={{ marginTop: '8px' }}>
                              <div><strong>{source.sourcePath}</strong> — {source.state}</div>
                              {source.values.map(field => (
                                <div key={field.key}>
                                  <strong>{field.key}:</strong> {field.key !== 'Rationale' && field.value.trim().toLowerCase() === 'auto'
                                    ? 'Automatic selection (auto; not a concrete model)' : field.value}
                                </div>
                              ))}
                              <div role="status">{source.diagnostic}</div>
                            </div>
                          )) : <div role="status">Declared model metadata is unavailable in the read-only observer.</div>}
                        </section>
                        <div style={{ marginTop: '8px' }}>
                          <strong>Charter summary (from charter.md):</strong>
                          <div>{detail.charterSummary || (detail.charterStatus === 'available'
                            ? 'No summary paragraph found in the charter.'
                            : `Charter content is ${detail.charterStatus}.`)}</div>
                        </div>
                        {detail.expertise && <div style={{ marginTop: '8px' }}><strong>Declared expertise:</strong><div>{detail.expertise}</div></div>}
                        {detail.responsibilities && <div style={{ marginTop: '8px' }}><strong>Declared responsibilities:</strong><div style={{ whiteSpace: 'pre-wrap' }}>{detail.responsibilities}</div></div>}
                        {detail.boundaries && <div style={{ marginTop: '8px' }}><strong>Declared boundaries:</strong><div style={{ whiteSpace: 'pre-wrap' }}>{detail.boundaries}</div></div>}
                        <div style={{ marginTop: '8px' }}>
                          <strong>Recent activity (from workspace activity logs; no timestamps supplied):</strong>
                          {detail.recentActivity.length
                            ? detail.recentActivity.map((activity, index) => <div key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{activity}</div>)
                            : <div>No recent activity entries observed.</div>}
                        </div>
                        <details style={{ marginTop: '8px' }}>
                          <summary>Charter source text</summary>
                          {detail.charterContent
                            ? <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '240px', overflow: 'auto' }}>{detail.charterContent}</pre>
                            : <div role="status">Charter text is {detail.charterStatus}.</div>}
                        </details>
                        {onOpenCharter ? (
                          <button type="button" onClick={() => onOpenCharter(m.id)} style={{ marginTop: '8px' }}>
                            Open charter
                          </button>
                        ) : (
                          <div style={{ marginTop: '8px' }}>
                            <button type="button" disabled title="Opening files is unavailable in the read-only observer.">Open charter</button>
                            <div role="note">Opening a charter in the editor is unavailable in the read-only observer.</div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Hidden members */}
        {info.hiddenMembers.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '10px', color: '#666', marginBottom: '6px' }}>
              🔇 Background Services
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {info.hiddenMembers.map((m) => (
                <span
                  key={m.name}
                  style={{
                    fontSize: '10px',
                    color: '#666',
                    padding: '3px 8px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '4px',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                  }}
                >
                  {roleEmoji(m.role)} {m.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* No members fallback */}
        {info.members.length === 0 && !info.projectContext && (
          <div style={{
            padding: '16px',
            textAlign: 'center',
            color: '#888',
            fontSize: '11px',
          }}>
            {info.description || 'No squad configuration found. Set up a .squad/team.md to see your team here.'}
          </div>
        )}
      </div>
    </div>
  );
}
