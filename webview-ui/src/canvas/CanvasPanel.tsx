import { useEffect, useState } from 'react';
import App from '../App.js';
import type { BrowserHostClient } from '../standalone/browserClient.js';
import { CANVAS_EXPIRED, createCanvasBootstrap } from './bootstrap.js';

export function CanvasPanel({ bootstrap }: { bootstrap?: () => Promise<BrowserHostClient> }) {
  const [client, setClient] = useState<BrowserHostClient | null>(null);
  const [expired, setExpired] = useState(false);
  const [status, setStatus] = useState('Connecting to Squad Pod…');
  const [connect] = useState(() => bootstrap ?? createCanvasBootstrap(setStatus));
  useEffect(() => {
    let active = true;
    let connected: BrowserHostClient | undefined;
    void connect().then(value => {
      connected = value;
      if (active) setClient(value);
      else value.dispose();
    }, () => { if (active) setExpired(true); });
    return () => { active = false; connected?.dispose(); };
  }, [connect]);
  return <section className="canvas-panel" aria-label="Squad Pod canvas">
    <p className="canvas-scope">Read-only Canvas. Layout, settings changes, directory management, file opening, live logs and recovery storage are unavailable.</p>
    <main>{expired ? <p role="alert">{CANVAS_EXPIRED}</p> : client
      ? <App client={client} canvas />
      : <p role="status">Connecting to Squad Pod…</p>}</main>
    {client && <p className="canvas-connection" role="status">{status}</p>}
  </section>;
}
