import { useHostClient } from '../HostClientContext.js';
import type { PodSettings, SourceStatus } from '../../../src/types.js';
import { SourceStatusView } from './SourceStatusView.js';
import { AssetDirectories, type AssetStatusData } from './AssetStatus.js';

interface SettingsModalProps {
  standalone?: boolean;
  assetStatus?: AssetStatusData;
  onClose: () => void;
  isDebugMode?: boolean;
  onToggleDebugMode?: () => void;
  settings: PodSettings;
  onSoundChange: (enabled: boolean) => void;
  onShowAreasChange: (enabled: boolean) => void;
  sourceStatus: SourceStatus | null;
}

export function SettingsModal({ standalone = false, assetStatus, onClose, isDebugMode = false, onToggleDebugMode, settings, onSoundChange, onShowAreasChange, sourceStatus }: SettingsModalProps) {
  const client = useHostClient();
  const handleExport = () => {
    client.send({ type: 'exportLayout' });
  };

  const handleImport = () => {
    client.send({ type: 'importLayout' });
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
          color: 'var(--vscode-foreground)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '8px',
          padding: '24px',
          width: 'calc(100vw - 32px)',
          boxSizing: 'border-box',
          maxWidth: '500px',
          maxHeight: '90vh',
          overflowY: 'auto',
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
            <label htmlFor="squad-pod-sound" style={{ fontSize: '13px' }}>Sound Notifications</label>
            <input
              id="squad-pod-sound"
              type="checkbox"
              checked={settings.soundEnabled}
              onChange={() => onSoundChange(!settings.soundEnabled)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label htmlFor="squad-pod-show-areas" style={{ fontSize: '13px' }}>Show Named Areas</label>
            <input
              id="squad-pod-show-areas"
              type="checkbox"
              checked={settings.showAreas}
              onChange={() => onShowAreasChange(!settings.showAreas)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
          </div>

          {onToggleDebugMode && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="squad-pod-debug-view" style={{ fontSize: '13px' }}>Debug View</label>
              <input
                id="squad-pod-debug-view"
                type="checkbox"
                checked={isDebugMode}
                onChange={onToggleDebugMode}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            </div>
          )}

          {!standalone && <><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label htmlFor="squad-pod-live-activity" style={{ fontSize: '13px' }}>Live Activity (opt-in)</label>
            <input id="squad-pod-live-activity" type="checkbox"
              checked={!!sourceStatus?.liveActivity && sourceStatus.liveActivity.state !== 'off'}
              onChange={(event) => client.send({ type: 'setLiveActivity', enabled: event.target.checked })} />
          </div>
          <p role="status" style={{ fontSize: '12px', margin: 0 }}>
            Live source: {sourceStatus?.liveActivity?.state ?? 'unavailable'}
            {sourceStatus?.liveActivity?.sessionId ? ` (${sourceStatus.liveActivity.sessionId})` : ''}.
            {' '}Reads local Copilot CLI session metadata for this workspace after confirmation.
          </p></>}
          <SourceStatusView status={sourceStatus} />
          {!standalone && <AssetDirectories status={assetStatus} />}
          {standalone ? <p role="status">Selected-project settings only. Native dialogs, directory management, external assets and private/live log consent are unavailable. Import selects a browser file; export downloads validated JSON. Neither grants filesystem or terminal access.</p> : <p style={{ fontSize: '12px', margin: 0 }}>
            Automatic launch on startup/refocus: Off. Directory launches require an explicit click and use VS Code&apos;s normal terminal and Copilot permission prompts.
            Live tools and context use an undocumented, best-effort Copilot CLI session format.
          </p>}

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
