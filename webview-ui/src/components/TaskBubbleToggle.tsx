export function TaskBubbleToggle({ enabled, onChange }: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return <button type="button" aria-pressed={enabled}
    title="Show or hide task summaries in this view only. Does not change project settings or live-source consent."
    style={{
      padding: '8px 16px', fontSize: 13, fontWeight: 500,
      background: enabled ? 'var(--vscode-button-background)' : 'var(--vscode-button-secondaryBackground)',
      color: enabled ? 'var(--vscode-button-foreground)' : 'var(--vscode-button-secondaryForeground)',
      border: 'none', borderRadius: 4, cursor: 'pointer',
    }}
    onClick={() => onChange(!enabled)}>
    Task bubbles: {enabled ? 'On' : 'Off'}
  </button>;
}
