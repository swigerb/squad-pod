import type { SourceStatus } from '../../../src/types.js';

export function SourceStatusView({ status, readOnly = false }: { status: SourceStatus | null; readOnly?: boolean }) {
  return (
    <section aria-label="Squad source status" style={{ fontSize: '12px', overflowWrap: 'anywhere' }}>
      <strong>Squad source</strong>
      {status ? (
        <>
          <div>Team file: {status.teamFound ? 'Found' : 'Not found'}</div>
          <div>Directory: {status.squadDir ?? 'No workspace folder'}</div>
          <div>File observer: {!status.workspaceRoot || !status.squadDir ? 'Unavailable (no selected Squad source)' : status.observer === 'watching'
            ? `Watching (${status.nativeWatch ? 'native watch + polling' : 'polling'})` : 'Stopped'}</div>
          {status.error && <div role="alert">{status.error}</div>}
        </>
      ) : <div>Awaiting host source status...</div>}
      <div>Live CLI observer: {status?.liveActivity?.state ?? 'Unavailable (no live source status)'}
        {status?.liveActivity?.sessionId ? ` (${status.liveActivity.sessionId})` : ''}</div>
      {readOnly && <p>Live observation requires server startup opt-in (--live-activity).
        {' '}{status?.liveActivity?.selection && `Selection: ${status.liveActivity.selection}. `}
        {status?.liveActivity?.reason
          ?? 'Selects the newest matching-project Squad session; not an owned-terminal correlation.'}</p>}
      <p>File observations are activity hints, not authoritative lifecycle, tool or context events.</p>
      <div>EventBus / WebSocket bridge: Not connected (no producer).</div>
    </section>
  );
}
