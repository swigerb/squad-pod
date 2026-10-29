import type { SourceStatus } from '../../../src/types.js';

export function MissingSquad({ status }: { status: SourceStatus | null }) {
  if (!status?.workspaceRoot || status.teamFound) return null;
  return (
    <section aria-label="Set up Squad" style={{
      position: 'absolute', top: '16px', left: '80px', right: '16px',
      maxWidth: '460px', maxHeight: '65%', overflowY: 'auto', padding: '20px',
      background: 'var(--vscode-editor-background)', color: 'var(--vscode-foreground)',
      border: '1px solid var(--vscode-panel-border)', borderRadius: '8px', zIndex: 45,
    }}>
      <h2 style={{ marginTop: 0 }}>No Squad team found</h2>
      <p>Open the workspace folder that contains your team's <code>.squad/team.md</code> (legacy <code>.ai-team/team.md</code> is also supported).</p>
      <p>New project? Follow the <a href="https://github.com/bradygaster/squad#readme">Squad setup guide</a>, then initialize a team yourself with the Squad agent in Copilot.</p>
      <p>The file observer will discover the team automatically when its roster is created. Squad Pod does not install Squad or run commands. Your saved office is kept.</p>
      <p style={{ overflowWrap: 'anywhere' }}>Looking in: {status.squadDir}</p>
      {status.error && <p role="alert">{status.error}</p>}
    </section>
  );
}
