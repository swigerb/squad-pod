import { useEffect, useRef, useState } from 'react';
import App from '../App.js';
import type { BrowserHostClient } from '../standalone/browserClient.js';
import { CANVAS_EDIT_FAILED, CANVAS_EXPIRED, createCanvasBootstrap, type CanvasHostClient } from './bootstrap.js';
import type { PreferenceMutation } from '../../../standalone/src/officePreferences.js';
import { PreferenceDraftControls } from '../standalone/PreferenceDraftControls.js';

export function CanvasPanel({ bootstrap }: { bootstrap?: () => Promise<CanvasHostClient> }) {
  const [client, setClient] = useState<CanvasHostClient | null>(null);
  const [expired, setExpired] = useState(false);
  const [editing, setEditing] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [preferenceDraft, setPreferenceDraft] = useState<PreferenceMutation | null>(null);
  const active = useRef(true);
  const [status, setStatus] = useState('Connecting to Squad Pod…');
  const [connect] = useState(() => bootstrap ?? createCanvasBootstrap(setStatus));
  useEffect(() => {
    active.current = true;
    void connect().then(value => {
      if (active.current) setClient(value);
      else value.dispose();
    }, () => { if (active.current) setExpired(true); });
    return () => { active.current = false; };
  }, [connect]);
  useEffect(() => () => client?.dispose(), [client]);
  async function enableEditing() {
    if (!client?.enableEditing || enabling) return;
    setEnabling(true);
    try {
      const control: BrowserHostClient = await client.enableEditing(draft => {
        if (active.current) setPreferenceDraft(draft);
      });
      if (!active.current) { control.dispose(); return; }
      setClient(control);
      setEditing(true);
    } catch { if (active.current) setEditError(CANVAS_EDIT_FAILED); }
    finally { if (active.current) setEnabling(false); }
  }
  return <section className="canvas-panel" aria-label="Squad Pod canvas">
    <p className="canvas-scope">{editing
      ? 'Editing enabled for this Canvas instance. Layout, seats and local settings use revision-checked project storage; unacknowledged drafts stay in this instance’s browser storage.'
      : 'Read-only Canvas by default. Enable editing to change the project office with separate control authority.'} Directory management, file opening and live logs are unavailable.</p>
    {client?.enableEditing && !editing && <button disabled={enabling || !!editError} onClick={() => void enableEditing()}>
      {enabling ? 'Enabling editing…' : 'Enable editing'}
    </button>}
    {editError && <p role="alert">{editError}</p>}
    {client && editing && preferenceDraft && <PreferenceDraftControls client={client} draft={preferenceDraft} />}
    <main>{expired ? <p role="alert">{CANVAS_EXPIRED}</p> : client
      ? <App key={editing ? 'control' : 'observer'} client={client} canvas readOnly={!editing} />
      : <p role="status">Connecting to Squad Pod…</p>}</main>
    {client && <p className="canvas-connection" role="status">{status}</p>}
  </section>;
}
