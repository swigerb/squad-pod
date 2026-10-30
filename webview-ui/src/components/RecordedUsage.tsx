import type { RecordedUsageSnapshot } from '../../../src/recordedUsage.js';

export function RecordedUsage({ snapshot }: { snapshot: RecordedUsageSnapshot | null }) {
  return (
    <section aria-label="Recorded Squad usage" style={{ padding: '8px 12px', borderBottom: '1px solid var(--vscode-panel-border)', overflowWrap: 'anywhere', color: 'var(--vscode-foreground, #cccccc)' }}>
        <h3 style={{ margin: 0, fontSize: 12 }}>Recorded usage / model history - {snapshot?.state ?? 'waiting for source'}</h3>
        <p>Historical reports only, not current model, live context or billing-grade accounting.</p>
        {!snapshot ? <p>Usage source has not reported yet; no totals available.</p> : <>
          {snapshot.totals ? <p>
            {snapshot.state === 'partial' ? 'Partial sums (valid records only)' : 'Recorded event sums'}: {snapshot.totals.inputTokens.toLocaleString()} input / {snapshot.totals.outputTokens.toLocaleString()} output tokens;
            {' '}reported estimated cost {snapshot.totals.estimatedCost.toPrecision(6)} (producer units).
          </p> : <p>No usage totals available. An empty, missing or rejected source is not recorded zero consumption.
            {' '}Usage requires a local ledger; enabling live CLI observation does not create one.</p>}
          <details>
            <summary>Usage coverage and source diagnostics</summary>
          <p>{snapshot.usageRecords} usage reports; {snapshot.attemptedTurns > 0
            ? `${snapshot.coveredTurns} / ${snapshot.attemptedTurns} recorded starts have usage (distinct turn IDs, as in Squad cost).`
            : 'coverage unavailable (0 / 0 recorded starts).'}
            {' '}{snapshot.unlinkedUsageRecords} reports without a matching start. This is ledger coverage, not all-runtime coverage.
          </p>
          <p>Latest usage report: {snapshot.lastUsageAt ? new Date(snapshot.lastUsageAt).toLocaleString() : 'unavailable'}</p>
            <p>Scope: all valid complete local ledger records; no agent or time filter.</p>
            <p>Local source: <strong>{snapshot.state}</strong><br />{snapshot.sourcePath ?? 'No selected workspace source'}</p>
            {snapshot.diagnostic && <p role="status">{snapshot.diagnostic}</p>}
            <p>Checked: {new Date(snapshot.checkedAt).toLocaleString()}<br />
              Latest valid record: {snapshot.lastRecordAt ? new Date(snapshot.lastRecordAt).toLocaleString() : 'unavailable'}
            </p>
            <p>Rejected lines: {snapshot.invalidLines}; unsupported: {snapshot.unsupportedLines}; pending final line: {snapshot.pendingFinalLine ? 'yes' : 'no'}.</p>
            <p>Reports may repeat; sums do not deduplicate usage events. The producer may substitute zero / unknown for missing values
              {' '}({snapshot.normalizedValueRecords} reports contain zero tokens or unknown model). Zero is not evidence that usage was measured.</p>
            <p>Live context: unavailable (runtime bus not connected). Parent-child hierarchy / roster promotion: unavailable (no supported live feed).</p>
            <p>Local ledger production is not guaranteed for Copilot CLI / VS Code / App or nonlocal backends.
              {' '}Do not start the deprecated Squad shell to populate this view.</p>
          </details>
          <details>
            <summary>Recent historical reports ({snapshot.history.length} of {snapshot.usageRecords}, newest first; at most 40)</summary>
            {snapshot.history.map((entry, index) => <div key={index} style={{ margin: '8px 0', paddingLeft: 8, borderLeft: '2px solid var(--vscode-panel-border)' }}>
              <strong>{entry.agentName || 'Unnamed'} - {entry.attribution === 'roster-match'
                ? `historical roster match: ${entry.rosterName}`
                : entry.attribution === 'ambiguous' ? 'unattributed (ambiguous roster identity)' : 'unattributed'}</strong>
              <div>Reported model: {entry.model}; {new Date(entry.timestamp).toLocaleString()}</div>
              <div>{entry.inputTokens} input / {entry.outputTokens} output; estimated cost {entry.estimatedCost.toPrecision(6)}</div>
              <div>Session: {entry.sessionId}; turn: {entry.turnId ?? 'not recorded'}</div>
            </div>)}
          </details>
        </>}
    </section>
  );
}
