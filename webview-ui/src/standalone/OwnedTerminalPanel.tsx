import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { OwnedRun } from '../../../src/core/ownedTerminalProtocol.js';
import type { RunId } from '../../../src/core/terminalFrames.js';
import { createTerminalClient, type OwnedTerminalClient } from './terminalClient.js';
import '@xterm/xterm/css/xterm.css';

export function OwnedTerminalPanel() {
  const [authenticated, setAuthenticated] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('Separate terminal authentication required. Office access grants no terminal authority.');
  const [runs, setRuns] = useState<OwnedRun[]>([]);
  const [available, setAvailable] = useState(false);
  const [reason, setReason] = useState<string | null>('Authenticate to check terminal availability.');
  const [selected, setSelected] = useState<RunId | undefined>();
  const [ready, setReady] = useState(false);
  const [resync, setResync] = useState(false);
  const [lostHistory, setLostHistory] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const client = useRef<OwnedTerminalClient | undefined>(undefined);
  const selectedRef = useRef<RunId | undefined>(undefined);
  const knownRuns = useRef(new Set<RunId>());
  const launchRequested = useRef(false);
  const authRequest = useRef<AbortController | undefined>(undefined);
  const fitTerminal = useRef<(() => void) | undefined>(undefined);

  useEffect(() => () => authRequest.current?.abort(), []);
  useEffect(() => {
    if (!authenticated || !container.current) return;
    let active = true;
    const terminal = new Terminal({
      scrollback: 2000, cols: 80, rows: 24, fontSize: 13,
      allowProposedApi: false, allowTransparency: false,
      disableStdin: true, screenReaderMode: true,
      linkHandler: { activate: () => { /* Terminal output cannot navigate the authenticated browser. */ } },
      theme: { background: '#151521', foreground: '#e4e6f0' },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current);
    const current = createTerminalClient({
      write: data => new Promise<void>((resolve, reject) => {
        if (!active) { reject(new Error('Terminal disposed')); return; }
        try { terminal.write(data, resolve); } catch (error) { reject(error); }
      }),
      reset: () => { terminal.reset(); },
    }, {
      connected: value => { if (active) setConnected(value); },
      status: message => { if (active) setStatus(message); },
      ready: value => {
        if (!active) return;
        terminal.options.disableStdin = !value;
        setReady(value);
        if (value) requestAnimationFrame(() => { if (active) fitTerminal.current?.(); });
      },
      resync: value => { if (active) setResync(value); },
      runs: (entries, enabled, unavailableReason) => {
        if (!active) return;
        setRuns(entries); setAvailable(enabled); setReason(unavailableReason);
        const launched = launchRequested.current
          ? entries.find(run => !knownRuns.current.has(run.runId)) : undefined;
        if (launched) launchRequested.current = false;
        knownRuns.current = new Set(entries.map(run => run.runId));
        const missing = selectedRef.current !== undefined && !entries.some(run => run.runId === selectedRef.current);
        const next = launched?.runId ?? (!selectedRef.current || missing ? entries[0]?.runId : undefined);
        if (next || missing) {
          selectedRef.current = next;
          setSelected(next);
          setConfirmClose(false);
          setLostHistory(false);
          current.select(next);
        }
      },
    });
    client.current = current;
    const fitNow = () => {
      if (!active || !container.current?.clientWidth || !container.current.clientHeight) return;
      try {
        fit.fit();
        current.resize(terminal.cols, terminal.rows);
      } catch { setStatus('Terminal could not fit this viewport. Resize the terminal panel and retry.'); }
    };
    fitTerminal.current = fitNow;
    const observer = new ResizeObserver(fitNow);
    observer.observe(container.current);
    const data = terminal.onData(value => current.input(value));
    const resize = terminal.onResize(size => current.resize(size.cols, size.rows));
    fitNow();
    return () => {
      active = false;
      observer.disconnect();
      data.dispose(); resize.dispose(); current.dispose(); terminal.dispose();
      client.current = undefined; fitTerminal.current = undefined;
    };
  }, [authenticated]);

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    const token = input.current?.value ?? '';
    if (input.current) input.current.value = '';
    setPending(true);
    const controller = new AbortController();
    authRequest.current = controller;
    try {
      const response = await fetch('/terminal-auth', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error('Terminal authentication failed. Use the separate terminal credential from the runtime console.');
      setAuthenticated(true);
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : 'Terminal authentication failed.');
    } finally { if (!controller.signal.aborted) setPending(false); }
  }
  const run = runs.find(entry => entry.runId === selected);
  return <section className="owned-terminal" aria-label="Owned terminals">
    <header>
      <strong>Owned terminals</strong>
      {authenticated && <button onClick={() => {
        client.current?.dispose(); setAuthenticated(false); setReady(false);
        setRuns([]); setSelected(undefined); selectedRef.current = undefined;
        knownRuns.current.clear(); launchRequested.current = false;
        setAvailable(false); setReason('Authenticate to check terminal availability.');
        setStatus('Terminal disconnected. The owned process was not terminated.');
      }}>Authenticate again</button>}
    </header>
    <p className="terminal-status" role="status">{status}</p>
    {!authenticated ? <form onSubmit={event => void authenticate(event)}>
      <label htmlFor="terminal-credential">Terminal credential (not the office credential)</label>
      <input id="terminal-credential" ref={input} type="password" autoComplete="off" maxLength={256} required />
      <button disabled={pending} type="submit">{pending ? 'Authenticating…' : 'Authenticate terminals'}</button>
      <p>No credentials, output, or replay cursors are stored in browser storage. Reloading requires authentication and reconstructs output from retained history.</p>
    </form> : <>
      <p className="terminal-scope">Launch runs the runtime’s selected project with its fixed command. Only owned runs accept input. Reconnect never launches or terminates a process.</p>
      {!connected && <p className="terminal-warning" role="note">Terminal channel disconnected. Run states are last-known; process controls are disabled. Reauthenticate after credential rotation.</p>}
      {(!available || reason) && <p className="terminal-warning" role="note">Terminals {available ? 'notice' : 'unavailable'}: {reason || 'Runtime did not provide an availability reason.'}</p>}
      <div className="terminal-controls">
        <button disabled={!available || !connected || resync} onClick={() => {
          launchRequested.current = true;
          client.current?.launch();
        }}>Launch selected project</button>
        <label>Owned run <select aria-label="Owned run" value={selected ?? ''} disabled={resync} onChange={event => {
          const next = runs.find(entry => entry.runId === event.target.value)?.runId;
          selectedRef.current = next; setSelected(next); setConfirmClose(false);
          setLostHistory(false); client.current?.select(next);
        }}>
          <option value="">Select a run</option>
          {runs.map(entry => <option key={entry.runId} value={entry.runId}>
            {entry.runId} · PID {entry.pid} · {entry.state}{entry.state === 'exited' ? ` (${entry.exitCode ?? 'unknown'})` : ''}
          </option>)}
        </select></label>
        <button disabled={resync} onClick={() => client.current?.reconnect()}>Reconnect</button>
        <button disabled={!selected || !ready} onClick={() => fitTerminal.current?.()}>Fit terminal</button>
        <button disabled={!run || !connected || resync} onClick={() => setConfirmClose(!confirmClose)}>Close run…</button>
        {confirmClose && <button disabled={!connected} className="terminal-danger" onClick={() => {
          client.current?.terminate(); setConfirmClose(false);
        }}>Confirm terminate owned process</button>}
      </div>
      {resync && <div className="terminal-warning" role="alert">
        Replay continuity failed. Nothing will reset automatically. Resync clears the screen and may discard missing history and terminal state.
        <button onClick={() => { setLostHistory(true); client.current?.resync(); }}>Clear terminal and resync retained history</button>
      </div>}
      {lostHistory && <p className="terminal-warning">History was explicitly reset. Earlier output and terminal state may be lost.</p>}
      <div ref={container} className="terminal-screen" aria-label="Owned run terminal" />
    </>}
  </section>;
}
