import type { CliUsageSnapshot } from '../../../src/cliUsage.js';

export function CliUsage({ snapshot, readOnly, onAction }: {
  snapshot: CliUsageSnapshot | null;
  readOnly: boolean;
  onAction: (type: 'selectCliUsage' | 'refreshCliUsage' | 'clearCliUsage') => void;
}) {
  const report = snapshot?.report;
  return <section aria-label="Imported CLI usage" style={{ padding: '8px 12px', borderBottom: '1px solid var(--vscode-panel-border)', overflowWrap: 'anywhere' }}>
    <h3 style={{ margin: 0, fontSize: 12 }}>Copilot CLI usage export - {snapshot?.state ?? 'unselected'}</h3>
    <p>Separate historical snapshot; never added to Squad ledger totals. Not USD, billing-grade accounting, current model or live context.</p>
    {readOnly ? <p>CLI usage import is unavailable in standalone/read-only observation. Use the VS Code extension to select an export.</p>
      : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button onClick={() => onAction('selectCliUsage')}>Select CLI usage JSON...</button>
        <button disabled={!snapshot?.canRefresh} onClick={() => onAction('refreshCliUsage')}>Refresh selected export</button>
        <button disabled={!snapshot || snapshot.state === 'unselected'} onClick={() => onAction('clearCliUsage')}>Forget export</button>
      </div>}
    {snapshot?.diagnostic && <p role="alert">{snapshot.diagnostic}</p>}
    {!report ? <p>No imported CLI quantities available. Missing or rejected data is not zero consumption.
      {' '}Launch with <code>copilot --agent squad --usage-output-file &lt;file.json&gt;</code> to request an export;
      {' '}then explicitly select that workspace-local file. No automatic discovery or paid run is performed by Pod.</p> : <>
      <p>Producer-reported session quantities: {report.userRequests.toLocaleString()} user-initiated API requests;
        {' '}{String(report.premiumRequests)} premium-request cost (multiplier applied);
        {' '}{String(report.apiDurationMs)} ms API time;
        {' '}nano-AI units: {report.nanoAiu === null ? 'not reported' : String(report.nanoAiu)}.</p>
      <p>Session identity: unknown. Workspace attribution: user-selected file location only, not verified producer attribution.
        {' '}Agent attribution: unknown. Completion, resumed history and all-agent coverage: unknown.
        {' '}Reported session start: {report.sessionStartTime} (not a session ID).</p>
      <details>
        <summary>Reported model breakdowns ({report.models.length} of {report.modelCount}; at most 40)</summary>
        <p>Raw per-model quantities, not combined with session, agent, provider or token-detail totals.
          {' '}Cache and reasoning fields may overlap other token fields. No token rollup is inferred.</p>
        {report.models.map(m => <div key={m.model} style={{ margin: '8px 0' }}>
          <strong>Historical model: {m.model}</strong>
          <div>{m.inputTokens.toLocaleString()} input / {m.outputTokens.toLocaleString()} output tokens;
            {' '}{m.cacheReadTokens.toLocaleString()} cache-read / {m.cacheWriteTokens.toLocaleString()} cache-write tokens;
            {' '}reasoning tokens: {m.reasoningTokens === null ? 'not reported' : m.reasoningTokens.toLocaleString()}.</div>
          <div>{m.requests.toLocaleString()} model API requests; {String(m.premiumRequests)} premium-request cost;
            {' '}nano-AI units: {m.nanoAiu === null ? 'not reported' : String(m.nanoAiu)}.</div>
        </div>)}
      </details>
    </>}
    <details>
      <summary>CLI import provenance and limits</summary>
      <p>Contract: Copilot CLI 1.0.105 shipped UsageGetMetricsResult projection. Actual export version is not recorded by the producer and is unverified.
        {' '}Synthetic fixture validation only; real-export acceptance pending.</p>
      <p>Source: {snapshot?.sourcePath ?? 'No selected export'}. Checked: {snapshot?.checkedAt ?? 'not checked'}.</p>
      <p>One selected file replaces the previous snapshot, including on repeated refresh. No multi-file or cross-source sums.
        {' '}Unknown fields are ignored; agent/provider/token-detail data, currentModel, last-call tokens and code-change paths are not displayed.
        {' '}Selection is in-memory only, with no background polling. Replaced files require selection again.</p>
    </details>
  </section>;
}
