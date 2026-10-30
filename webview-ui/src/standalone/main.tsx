import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.js';
import { createBrowserClient, type BrowserHostClient } from './browserClient.js';
import './standalone.css';

function Observer() {
  const [client, setClient] = useState<BrowserHostClient | null>(null);
  const [status, setStatus] = useState('Authentication required');
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => client?.dispose(), [client]);

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    const token = input.current?.value ?? '';
    if (input.current) input.current.value = '';
    setPending(true);
    try {
      const response = await fetch('/auth', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error('Authentication failed. Use the current credential from the observer console.');
      client?.dispose();
      setClient(createBrowserClient(setStatus));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Authentication failed.');
    } finally { setPending(false); }
  }

  return <div className="observer-shell">
    <header>
      <strong>Squad Pod observer</strong>
      <span role="status">{status}</span>
      {client && <button onClick={() => { client.dispose(); setClient(null); setStatus('Authentication required'); }}>Authenticate again</button>}
    </header>
    <p className="observer-scope">Read-only local office. No layout/seat/settings writes, directory management, external assets, private live logs, or terminals. Activity is approximate file observation; usage is recorded ledger data only.</p>
    {client ? <main><App client={client} readOnly /></main> : <form onSubmit={event => void authenticate(event)}>
      <h1>Authenticate this viewer</h1>
      <label htmlFor="credential">Runtime credential from the observer console</label>
      <input ref={input} id="credential" type="password" autoComplete="off" maxLength={256} required />
      <button disabled={pending} type="submit">{pending ? 'Authenticating...' : 'Connect read-only office'}</button>
      <p>Credentials stay in memory, not URLs or browser storage. Type <code>rotate</code> in the server console to revoke viewers and get a new credential. A server restart also revokes all credentials.</p>
    </form>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<Observer />);
