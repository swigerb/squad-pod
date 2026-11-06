import { useState } from 'react';
import { useHostClient } from '../HostClientContext.js';
import type { CanvasUsageQuantity } from '../../../src/core/canvasHost.js';
import { CANVAS_HOST_BUSY, HOST_UNAVAILABLE } from './hostBridge.js';

/** Separate from imported CLI exports and recorded ledger totals. Fetch only on gesture. */
export function SessionUsage() {
  const { canvasHost } = useHostClient();
  const [quantities, setQuantities] = useState<CanvasUsageQuantity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    if (!canvasHost?.usage || busy) return;
    setBusy(true);
    setQuantities(null);
    setNotice(null);
    try { setQuantities(await canvasHost.getUsage()); }
    catch (failure) {
      // Busy sent nothing; Refresh stays available.
      if (failure instanceof Error && failure.message === CANVAS_HOST_BUSY) setNotice(CANVAS_HOST_BUSY);
      else setError(HOST_UNAVAILABLE);
    }
    finally { setBusy(false); }
  }
  return <section aria-label="Joined-session usage">
    <h3>Joined-session SDK usage</h3>
    <p>Separate current-session source, not a CLI export, ledger sum, USD bill or model observation.
      Missing quantities are unavailable, not zero. Candidate; pending native.</p>
    <button disabled={!canvasHost?.usage || busy || !!error} onClick={() => void refresh()}>Refresh joined-session usage</button>
    {error ? <p role="alert">{error}</p> : !canvasHost?.usage ? <p role="status">{HOST_UNAVAILABLE}</p>
      : notice ? <p role="status">{notice}</p> : null}
    {quantities?.map(q => <p key={q.label}>{q.label}: {q.value.toLocaleString()} {q.unit}</p>)}
    {quantities?.length === 0 && <p>No session quantities reported; missing is not zero.</p>}
  </section>;
}
