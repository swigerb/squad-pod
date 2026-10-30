export function TaskBubbleToggle({ enabled, onChange }: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return <button type="button" aria-pressed={enabled}
    title="Show or hide task summaries in this view only. Does not change project settings or live-source consent."
    onClick={() => onChange(!enabled)}>
    Task bubbles: {enabled ? 'On' : 'Off'}
  </button>;
}
