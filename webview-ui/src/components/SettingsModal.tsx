import { useState, useEffect } from 'react';
import { vscode } from '../vscodeApi.js';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [soundEnabled, setSoundEnabled] = useState(true);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'settingsLoaded') {
        setSoundEnabled(message.soundEnabled ?? true);
      }
    };
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'getSettings' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleSoundToggle = () => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);
    vscode.postMessage({ type: 'setSoundEnabled', enabled: newValue });
  };

  const handleExport = () => {
    vscode.postMessage({ type: 'exportLayout' });
  };

  const handleImport = () => {
    vscode.postMessage({ type: 'importLayout' });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '8px',
          padding: '24px',
          minWidth: '320px',
          maxWidth: '500px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Settings</h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--vscode-foreground)',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ fontSize: '13px' }}>Sound Notifications</label>
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={handleSoundToggle}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
          </div>

          <div style={{ borderTop: '1px solid var(--vscode-panel-border)', paddingTop: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Layout</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleExport}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: 'var(--vscode-button-background)',
                  color: 'var(--vscode-button-foreground)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                Export Layout
              </button>
              <button
                onClick={handleImport}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: 'var(--vscode-button-background)',
                  color: 'var(--vscode-button-foreground)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                Import Layout
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
