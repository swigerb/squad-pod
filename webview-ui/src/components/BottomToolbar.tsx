import { useState } from 'react';
import { SettingsModal } from './SettingsModal.js';
import { vscode } from '../vscodeApi.js';
import type { PodSettings, SourceStatus } from '../../../src/types.js';
import type { AssetStatusData } from './AssetStatus.js';

interface BottomToolbarProps {
  assetStatus?: AssetStatusData;
  isEditMode: boolean;
  onToggleEditMode: () => void;
  onOpenSquadInfo?: () => void;
  onOpenDirectories: () => void;
  isTelemetryOpen: boolean;
  onToggleTelemetry: () => void;
  telemetryCount: number;
  isDebugMode?: boolean;
  onToggleDebugMode?: () => void;
  settings: PodSettings;
  sourceStatus: SourceStatus | null;
  onSoundChange: (enabled: boolean) => void;
}

export function BottomToolbar({ assetStatus, isEditMode, onToggleEditMode, onOpenSquadInfo, onOpenDirectories, isTelemetryOpen, onToggleTelemetry, telemetryCount, isDebugMode = false, onToggleDebugMode, settings, sourceStatus, onSoundChange }: BottomToolbarProps) {
  const [showSettings, setShowSettings] = useState(false);

  const handleSquadInfo = () => {
    if (onOpenSquadInfo) {
      onOpenSquadInfo();
    } else {
      vscode.postMessage({ type: 'openSquadInfo' });
    }
  };

  return (
    <>
      <div
        className="bottom-toolbar"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '48px',
          background: 'var(--vscode-editor-background)',
          borderTop: '1px solid var(--vscode-panel-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'safe center',
          overflowX: 'auto',
          boxSizing: 'border-box',
          scrollbarWidth: 'thin',
          gap: '8px',
          padding: '0 16px',
          zIndex: 50,
        }}
      >
        <button
          onClick={handleSquadInfo}
          style={{
            padding: '8px 16px',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          Squad Info
        </button>
        <button
          onClick={onToggleTelemetry}
          style={{
            padding: '8px 16px',
            background: isTelemetryOpen ? 'var(--vscode-button-secondaryBackground)' : 'var(--vscode-button-background)',
            color: isTelemetryOpen ? 'var(--vscode-button-secondaryForeground)' : 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
            position: 'relative',
          }}
        >
          Telemetry
          {!isTelemetryOpen && telemetryCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                background: '#f14c4c',
                color: '#fff',
                borderRadius: '8px',
                padding: '0 5px',
                fontSize: '10px',
                fontWeight: 700,
                minWidth: '16px',
                textAlign: 'center',
                lineHeight: '16px',
              }}
            >
              {telemetryCount > 99 ? '99+' : telemetryCount}
            </span>
          )}
        </button>
        <button
          onClick={onToggleEditMode}
          style={{
            padding: '8px 16px',
            background: isEditMode ? 'var(--vscode-button-secondaryBackground)' : 'var(--vscode-button-background)',
            color: isEditMode ? 'var(--vscode-button-secondaryForeground)' : 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          {isEditMode ? 'Exit Layout Editor' : 'Edit Layout'}
        </button>
        <button
          onClick={onOpenDirectories}
          style={{
            padding: '8px 12px',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          Directories
        </button>
        <button
          onClick={() => setShowSettings(true)}
          style={{
            padding: '8px 16px',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          Settings
        </button>
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} isDebugMode={isDebugMode} onToggleDebugMode={onToggleDebugMode}
        settings={settings} sourceStatus={sourceStatus} assetStatus={assetStatus} onSoundChange={onSoundChange} />}
    </>
  );
}
