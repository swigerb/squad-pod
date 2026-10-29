import type { SourceStatus } from '../../../src/types.js';

export function SourceStatusView({ status }: { status: SourceStatus | null }) {
  return (
    <section aria-label="Squad source status" style={{ fontSize: '12px', overflowWrap: 'anywhere' }}>
      <strong>Squad source</strong>
      {status ? (
        <>
          <div>Team file: {status.teamFound ? 'Found' : 'Not found'}</div>
          <div>Directory: {status.squadDir ?? 'No workspace folder'}</div>
          <div>File observer: {status.observer === 'watching'
            ? `Watching (${status.nativeWatch ? 'native watch + polling' : 'polling'})` : 'Stopped'}</div>
          {status.error && <div role="alert">{status.error}</div>}
        </>
      ) : <div>Awaiting host source status...</div>}
      <p>File observations are activity hints, not authoritative lifecycle, tool or context events.</p>
      <div>EventBus / WebSocket bridge: Not connected (no producer).</div>
    </section>
  );
}
