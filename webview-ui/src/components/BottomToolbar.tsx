import { useState } from 'react';
import { SettingsModal } from './SettingsModal.js';
import { vscode } from '../vscodeApi.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onToggleEditMode: () => void;
  onOpenSquadInfo?: () => void;
  isTelemetryOpen: boolean;
  onToggleTelemetry: () => void;
  telemetryCount: number;
}

export function BottomToolbar({ isEditMode, onToggleEditMode, onOpenSquadInfo, isTelemetryOpen, onToggleTelemetry, telemetryCount }: BottomToolbarProps) {
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
          justifyContent: 'center',
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
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}
