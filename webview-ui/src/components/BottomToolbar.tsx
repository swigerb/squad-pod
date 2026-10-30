import { useHostClient } from '../HostClientContext.js';

interface BottomToolbarProps {
  readOnly?: boolean;
  isEditMode: boolean;
  onToggleEditMode: () => void;
  onOpenSquadInfo?: () => void;
  onOpenDirectories: () => void;
  onOpenSettings: () => void;
  isTelemetryOpen: boolean;
  onToggleTelemetry: () => void;
  telemetryCount: number;
}

export function BottomToolbar({ readOnly = false, isEditMode, onToggleEditMode, onOpenSquadInfo, onOpenDirectories, onOpenSettings, isTelemetryOpen, onToggleTelemetry, telemetryCount }: BottomToolbarProps) {
  const client = useHostClient();

  const handleSquadInfo = () => {
    if (onOpenSquadInfo) {
      onOpenSquadInfo();
    } else {
      client.send({ type: 'openSquadInfo' });
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
          disabled={readOnly}
          title={readOnly ? 'Squad information dialog is unavailable in the read-only observer.' : undefined}
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
          disabled={readOnly}
          title={readOnly ? 'Layout and appearance changes are disabled in the read-only observer.' : undefined}
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
          disabled={readOnly}
          title={readOnly ? 'Only the explicitly selected project is observed. Directory management is unavailable.' : undefined}
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
          disabled={readOnly}
          title={readOnly ? 'Settings, live logs and external assets are unavailable in the read-only observer.' : undefined}
          onClick={onOpenSettings}
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
    </>
  );
}
