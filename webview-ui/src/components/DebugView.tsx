import type { OfficeState } from '../office/engine/officeState.js';

interface DebugViewProps {
  officeState: OfficeState;
  agentTools: Record<string, Array<{ toolId: string; status: string; done: boolean; permissionWait?: boolean }>>;
  agentStatuses: Record<string, string>;
  onClose: () => void;
}

export function DebugView({ officeState, agentTools, agentStatuses, onClose }: DebugViewProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.9)',
        color: '#fff',
        padding: '24px',
        overflowY: 'auto',
        zIndex: 2000,
        fontFamily: 'monospace',
        fontSize: '12px',
      }}
      onClick={onClose}
    >
      <div style={{ maxWidth: '800px', margin: '0 auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0 }}>Debug View</h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid #666',
              color: '#fff',
              padding: '4px 12px',
              cursor: 'pointer',
              borderRadius: '4px',
            }}
          >
            Close
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#4ade80' }}>Agents ({officeState.characters.size})</h3>
            {Array.from(officeState.characters.entries()).map(([id, char]) => {
              const tools = agentTools[id] || [];
              const status = agentStatuses[id] || 'idle';
              return (
                <div key={id} style={{ marginBottom: '12px', paddingLeft: '16px', borderLeft: '2px solid #333' }}>
                  <div style={{ fontWeight: 'bold' }}>
                    {char.name} ({char.role})
                  </div>
                  <div style={{ color: '#888', fontSize: '11px' }}>ID: {id}</div>
                  <div style={{ marginTop: '4px' }}>
                    <span style={{ color: '#60a5fa' }}>State:</span> {char.state}
                  </div>
                  <div>
                    <span style={{ color: '#60a5fa' }}>Position:</span> ({char.col}, {char.row})
                  </div>
                  <div>
                    <span style={{ color: '#60a5fa' }}>Status:</span> {status}
                  </div>
                  <div>
                    <span style={{ color: '#60a5fa' }}>Active:</span> {char.active ? 'Yes' : 'No'}
                  </div>
                  {char.tool && (
                    <div>
                      <span style={{ color: '#60a5fa' }}>Current Tool:</span> {char.tool}
                    </div>
                  )}
                  {char.bubbleState.type !== 'none' && (
                    <div>
                      <span style={{ color: '#60a5fa' }}>Bubble:</span> {char.bubbleState.type}
                    </div>
                  )}
                  {tools.length > 0 && (
                    <div style={{ marginTop: '4px' }}>
                      <span style={{ color: '#60a5fa' }}>Tools:</span>
                      <div style={{ paddingLeft: '12px', marginTop: '2px' }}>
                        {tools.map((tool, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#4ade80' }}>Layout Info</h3>
            <div style={{ paddingLeft: '16px' }}>
              <div>
                <span style={{ color: '#60a5fa' }}>Dimensions:</span> {officeState.layout.cols} × {officeState.layout.rows}
              </div>
              <div>
                <span style={{ color: '#60a5fa' }}>Seats:</span> {officeState.seats.length}
              </div>
              <div>
                <span style={{ color: '#60a5fa' }}>Furniture:</span> {officeState.furniture.length}
              </div>
              <div>
                <span style={{ color: '#60a5fa' }}>Walkable Tiles:</span> {officeState.walkableTiles.size}
              </div>
            </div>
          </div>

          {officeState.selectedAgentId && (
            <div>
              <h3 style={{ margin: '0 0 8px 0', color: '#4ade80' }}>Selected Agent</h3>
              <div style={{ paddingLeft: '16px' }}>
                <div style={{ color: '#facc15' }}>{officeState.selectedAgentId}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
