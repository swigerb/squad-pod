import { useState } from 'react';
import { useHostClient } from '../HostClientContext.js';
import { CANVAS_HOST_BUSY, HOST_UNAVAILABLE } from './hostBridge.js';

export function ProjectLayoutImport() {
  const { canvasHost } = useHostClient();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function load() {
    if (!canvasHost || busy || failed) return;
    setBusy(true);
    try {
      await canvasHost.importLayout(path);
      setNotice('Project JSON imported into the draft only. Review before saving.');
    } catch (error) {
      // Busy sent nothing; the project path stays available.
      if (error instanceof Error && error.message === CANVAS_HOST_BUSY) setNotice(CANVAS_HOST_BUSY);
      else { setFailed(true); setNotice(`${HOST_UNAVAILABLE} Use the browser JSON picker fallback.`); }
    }
    finally { setBusy(false); }
  }
  return <div>
    <label>In-project layout JSON path
      <input value={path} onChange={event => setPath(event.target.value)} placeholder="layouts/office.json" />
    </label>
    <button disabled={!canvasHost || !path || busy || failed} onClick={() => void load()}>Import project JSON</button>
    <p>Relative to this joined project only; no links or traversal. 2 MiB maximum. Candidate; pending native.</p>
    {notice && <p role={failed ? 'alert' : 'status'}>{notice}</p>}
  </div>;
}
