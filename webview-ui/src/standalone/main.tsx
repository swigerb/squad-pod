import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.js';
import { createBrowserClient, type BrowserHostClient } from './browserClient.js';
import { MobileShell } from './MobileShell.js';
import type { PreferenceMutation } from '../../../standalone/src/officePreferences.js';
import './standalone.css';

function Observer() {
  const [client, setClient] = useState<BrowserHostClient | null>(null);
  const [status, setStatus] = useState('Authentication required');
  const [pending, setPending] = useState(false);
  const [control, setControl] = useState(false);
  const [preferenceDraft, setPreferenceDraft] = useState<PreferenceMutation | null>(null);
  const [keyboardClamp, setKeyboardClamp] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const onKeyboardViewport = useCallback((viewport: { clampHeight: number | null }) => {
    setKeyboardClamp(viewport.clampHeight);
  }, []);
  useEffect(() => () => client?.dispose(), [client]);

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    const token = input.current?.value ?? '';
    if (input.current) input.current.value = '';
    setPending(true);
    try {
      const response = await fetch(control ? '/control-auth' : '/auth', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error('Authentication failed. Use the current credential from the observer console.');
      const contextResponse = await fetch('/office-context', { credentials: 'same-origin' });
      if (!contextResponse.ok) throw new Error('Cannot establish selected-project server identity.');
      const context: unknown = await contextResponse.json();
      if (!context || typeof context !== 'object' || !('serverIdentity' in context)
        || typeof context.serverIdentity !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(context.serverIdentity)
        || !('projectIdentity' in context) || (control && (typeof context.projectIdentity !== 'string'
          || !/^[a-f0-9]{64}$/.test(context.projectIdentity)))) throw new Error('Invalid server identity.');
      client?.dispose();
      setPreferenceDraft(null);
      setClient(createBrowserClient(setStatus, undefined, window.location.origin, control
        ? { recoveryKey: `squad-office:${context.serverIdentity}:${context.projectIdentity}`, onPreferenceDraft: setPreferenceDraft } : undefined));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Authentication failed.');
    } finally { setPending(false); }
  }

  const office = client
    ? <main><App key={control ? 'control' : 'observer'} client={client} readOnly={!control} standalone /></main>
    : <form onSubmit={event => void authenticate(event)}>
      <h1>Authenticate this viewer</h1>
      <label htmlFor="credential">Runtime credential from the observer console</label>
      <input ref={input} id="credential" type="password" autoComplete="off" maxLength={256} required />
      <label><input type="checkbox" checked={control} disabled={pending} onChange={event => setControl(event.target.checked)} />Use separate office-control authority (requires server --office-control opt-in)</label>
      <button disabled={pending} type="submit">{pending ? 'Authenticating...' : control ? 'Connect office control' : 'Connect read-only office'}</button>
      <p>Credentials stay in memory, not URLs or browser storage. Type <code>rotate</code> in the server console to revoke viewers and get a new credential. A server restart also revokes all credentials.</p>
    </form>;
  return <div className="observer-shell" style={keyboardClamp === null ? undefined : {
    height: `${keyboardClamp}px`, minHeight: 0,
  }}>
    <header>
      <strong>Squad Pod observer</strong>
      <span role="status">{status}</span>
      {client && <button onClick={() => { client.dispose(); setClient(null); setStatus('Authentication required'); }}>Authenticate again</button>}
    </header>
    <p className="observer-scope">{control && client ? 'Authenticated selected-project office control. Layout, seats and local settings only.' : 'Read-only local office by default.'} No directory management, external assets or native dialogs. Terminals below require separate authority. Activity is approximate file observation unless the local CLI explicitly opts in with --live-activity; Telemetry shows source and correlation coverage. Usage is recorded ledger data only.</p>
    {client && control && preferenceDraft && <details open>
      <summary>Unacknowledged settings/seat draft</summary>
      <p>Inspect before retrying: this change has not been acknowledged. Other preference changes are rejected until it is resolved. A recovered full seat map may replace current assignments; reconcile or export and discard it first.</p>
      <pre>{JSON.stringify(preferenceDraft, null, 2)}</pre>
      <button onClick={() => client.send(preferenceDraft)}>Retry this preference change deliberately</button>
      <button onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(preferenceDraft, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'squad-pod-preference-draft.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }}>Export preference draft</button>
      <button onClick={() => client.discardPreferenceDraft()}>Discard preference draft</button>
    </details>}
    <MobileShell office={office} onKeyboardViewport={onKeyboardViewport} />
  </div>;
}

createRoot(document.getElementById('root')!).render(<Observer />);
