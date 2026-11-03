import { useId } from 'react';
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
  const id = useId();
  const canExport = client.capabilities.actions.includes('exportLayout');
  const canImport = client.capabilities.actions.includes('importLayout');
  const handleExport = () => {
    if (canExport) client.send({ type: 'exportLayout' });
  };

  const handleImport = () => {
    if (canImport) client.send({ type: 'importLayout' });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
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
            <label htmlFor={`${id}-sound`} style={{ fontSize: '13px' }}>Sound Notifications</label>
            <input
              id={`${id}-sound`}
              type="checkbox"
              checked={settings.soundEnabled}
              onChange={() => onSoundChange(!settings.soundEnabled)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label htmlFor={`${id}-areas`} style={{ fontSize: '13px' }}>Show Named Areas</label>
            <input
              id={`${id}-areas`}
              type="checkbox"
              checked={settings.showAreas}
              onChange={() => onShowAreasChange(!settings.showAreas)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
          </div>

          {onToggleDebugMode && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor={`${id}-debug`} style={{ fontSize: '13px' }}>Debug View</label>
              <input
                id={`${id}-debug`}
                type="checkbox"
                checked={isDebugMode}
                onChange={onToggleDebugMode}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            </div>
          )}

          {!standalone && <><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label htmlFor={`${id}-live`} style={{ fontSize: '13px' }}>Live Activity (opt-in)</label>
            <input id={`${id}-live`} type="checkbox"
              checked={!!sourceStatus?.liveActivity && sourceStatus.liveActivity.state !== 'off'}
              onChange={(event) => client.send({ type: 'setLiveActivity', enabled: event.target.checked })} />
          </div>
          <p role="status" style={{ fontSize: '12px', margin: 0 }}>
            Live source: {sourceStatus?.liveActivity?.state ?? 'unavailable'}
            {sourceStatus?.liveActivity?.sessionId ? ` (${sourceStatus.liveActivity.sessionId})` : ''}.
            {' '}Reads local Copilot CLI session metadata for this workspace after confirmation.
          </p></>}
          <SourceStatusView status={sourceStatus} readOnly={standalone} />
          {!standalone && <AssetDirectories status={assetStatus} />}
          {standalone ? <p role="status">Selected-project settings only. Native dialogs, directory management, external assets and browser-granted private/live log consent are unavailable. Live observation requires local CLI --live-activity opt-in.</p> : <p style={{ fontSize: '12px', margin: 0 }}>
            Automatic launch on startup/refocus: Off. Directory launches require an explicit click and use VS Code&apos;s normal terminal and Copilot permission prompts.
            Live tools and context use an undocumented, best-effort Copilot CLI session format.
          </p>}

          <div style={{ borderTop: '1px solid var(--vscode-panel-border)', paddingTop: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Layout</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                disabled={!canExport}
                onClick={handleExport}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: 'var(--vscode-button-background)',
                  color: 'var(--vscode-button-foreground)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: canExport ? 'pointer' : 'not-allowed',
                  opacity: canExport ? 1 : 0.5,
                  fontSize: '12px',
                }}
              >
                Export Layout
              </button>
              <button
                disabled={!canImport}
                onClick={handleImport}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: 'var(--vscode-button-background)',
                  color: 'var(--vscode-button-foreground)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: canImport ? 'pointer' : 'not-allowed',
                  opacity: canImport ? 1 : 0.5,
                  fontSize: '12px',
                }}
              >
                Import Layout
              </button>
            </div>
            {!canExport && <p role="status">Layout export is unavailable in this host.</p>}
            {!canImport && <p role="status">Layout import is unavailable in this host.</p>}
            {standalone && (canImport || canExport) && <p role="status">
              {canImport && 'Import selects a browser file. '}{canExport && 'Export downloads validated JSON. '}
              Neither grants filesystem or terminal access.
            </p>}
          </div>
        </div>
      </div>
    </div>
  );
}
