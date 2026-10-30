import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { OwnedRun } from '../../../src/core/ownedTerminalProtocol.js';
import type { RunId } from '../../../src/core/terminalFrames.js';
import type { MobileTerminalAccess } from '../mobile/mobileShellState.js';
import { useKeyboardViewport } from '../mobile/useKeyboardViewport.js';
import { clipboardFailure, clipboardMethod, manualPasteResult } from '../mobile/clipboardDecisions.js';
import { findSafeTerminalLinks, moveTap, safeTerminalUrl, startTap, terminalTapAction,
  type TapTrack, type TouchSample } from '../mobile/touchDecisions.js';
import { createTerminalClient, type OwnedTerminalClient } from './terminalClient.js';
import { utf8Bytes } from '../../../src/core/terminalFrames.js';
import '@xterm/xterm/css/xterm.css';

const MAX_MANUAL_PASTE_BYTES = 256 * 1024;
export interface OwnedTerminalPanelProps {
  mobile?: boolean;
  selectedRunId?: RunId;
  launchPending?: boolean;
  onAccessChange?: (access: MobileTerminalAccess) => void;
  onLaunchRequested?: (requestId: string) => void;
  onLaunchHandler?: (launch: ((requestId: string) => boolean) | null) => void;
  onLaunchResult?: (requestId: string, result: { ok: true; runId: RunId } | { ok: false; message: string }) => void;
  onSelectionChange?: (runId: RunId | undefined) => void;
  onKeyboardViewport?: (viewport: { keyboardOpen: boolean; clampHeight: number | null }) => void;
}
function newLaunchRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replaceAll('-', '');
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function OwnedTerminalPanel({
  mobile = false, selectedRunId: requestedRunId, launchPending = false, onAccessChange,
  onLaunchRequested, onLaunchHandler, onLaunchResult, onSelectionChange, onKeyboardViewport,
}: OwnedTerminalPanelProps) {
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
  const [clipboardFallback, setClipboardFallback] = useState<string | null>(null);
  const [manualPaste, setManualPaste] = useState('');
  const [showManualPaste, setShowManualPaste] = useState(false);
  const [clipboardNotice, setClipboardNotice] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const client = useRef<OwnedTerminalClient | undefined>(undefined);
  const selectedRef = useRef<RunId | undefined>(undefined);
  const authRequest = useRef<AbortController | undefined>(undefined);
  const fitTerminal = useRef<(() => void) | undefined>(undefined);
  const terminalInstance = useRef<Terminal | null>(null);
  const mobileRef = useRef(mobile);
  mobileRef.current = mobile;
  const accessRef = useRef<MobileTerminalAccess>({
    authenticated: false, connected: false, available: false, ready: false, resync: false, runs: [],
  });
  const keyboardViewport = useKeyboardViewport(mobile, onKeyboardViewport);
  function publishAccess(patch: Partial<MobileTerminalAccess>) {
    accessRef.current = { ...accessRef.current, ...patch };
    onAccessChange?.(accessRef.current);
  }
  function selectRun(runId: RunId | undefined) {
    if (runId === selectedRef.current) return;
    selectedRef.current = runId;
    setSelected(runId);
    setConfirmClose(false);
    setLostHistory(false);
    client.current?.select(runId);
  }

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
    terminalInstance.current = terminal;
    let activeTap: TapTrack | null = null;
    let lastTap: { track: TapTrack; release: TouchSample } | null = null;
    let tapTimer: ReturnType<typeof setTimeout> | undefined;
    const touchSample = (touch: Touch, time: number): TouchSample => ({
      id: touch.identifier, x: touch.clientX, y: touch.clientY, time,
    });
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { activeTap = null; lastTap = null; return; }
      activeTap = startTap(touchSample(event.touches[0], event.timeStamp));
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!activeTap) return;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === activeTap?.start.id);
      if (touch) activeTap = moveTap(activeTap, touchSample(touch, event.timeStamp));
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!activeTap) return;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === activeTap?.start.id);
      if (!touch) return;
      const release = touchSample(touch, event.timeStamp);
      lastTap = { track: activeTap, release };
      activeTap = null;
      if (tapTimer) clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { lastTap = null; }, 500);
    };
    const onTouchCancel = () => { activeTap = null; lastTap = null; };
    const screen = container.current;
    screen.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    screen.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    screen.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    screen.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });
    const links = terminal.registerLinkProvider({
      provideLinks: (lineNumber, callback) => {
        const line = terminal.buffer.active.getLine(lineNumber - 1);
        if (!line) { callback(undefined); return; }
        let text = '';
        const columns: number[] = [];
        for (let column = 0; column < line.length; column++) {
          const chars = line.getCell(column)?.getChars() ?? '';
          for (let index = 0; index < chars.length; index++) {
            text += chars[index];
            columns.push(column);
          }
        }
        callback(findSafeTerminalLinks(text).flatMap(link => {
          const start = columns[link.start];
          const end = columns[link.end - 1];
          return start === undefined || end === undefined ? [] : [{
            range: { start: { x: start + 1, y: lineNumber }, end: { x: end + 1, y: lineNumber } },
            text: link.url,
            activate: (_event: MouseEvent, raw: string) => {
              const url = safeTerminalUrl(raw);
              if (!url) return;
              if (mobileRef.current) {
                const tap = lastTap;
                lastTap = null;
                if (!tap || terminalTapAction(tap.track, tap.release, terminal.hasSelection(), url).type !== 'openUrl') return;
              }
              window.open(url, '_blank', 'noopener,noreferrer');
            },
          }];
        }));
      },
    });
    const current = createTerminalClient({
      write: data => new Promise<void>((resolve, reject) => {
        if (!active) { reject(new Error('Terminal disposed')); return; }
        try { terminal.write(data, resolve); } catch (error) { reject(error); }
      }),
      reset: () => { terminal.reset(); },
    }, {
      connected: value => {
        if (!active) return;
        setConnected(value);
        publishAccess({ connected: value });
      },
      status: message => { if (active) setStatus(message); },
      ready: value => {
        if (!active) return;
        terminal.options.disableStdin = !value;
        setReady(value);
        publishAccess({ ready: value });
        if (value) requestAnimationFrame(() => { if (active) fitTerminal.current?.(); });
      },
      resync: value => {
        if (!active) return;
        setResync(value);
        publishAccess({ resync: value });
      },
      runs: (entries, enabled, unavailableReason) => {
        if (!active) return;
        setRuns(entries); setAvailable(enabled); setReason(unavailableReason);
        publishAccess({ runs: entries, available: enabled });
        if (onAccessChange) return;
        const missing = selectedRef.current !== undefined && !entries.some(run => run.runId === selectedRef.current);
        const next = !selectedRef.current || missing ? entries[0]?.runId : undefined;
        if (next || missing) {
          selectedRef.current = next;
          setSelected(next);
          setConfirmClose(false);
          setLostHistory(false);
          current.select(next);
        }
      },
      launchResult: (requestId, result) => {
        if (!active) return;
        if (!result.ok) setStatus(`Launch failed: ${result.message}`);
        onLaunchResult?.(requestId, result);
      },
    });
    client.current = current;
    onLaunchHandler?.(requestId => {
      const sent = current.launch(requestId);
      if (!sent) onLaunchResult?.(requestId, {
        ok: false, message: 'Disconnected or backpressured — launch was not sent.',
      });
      return sent;
    });
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
      if (tapTimer) clearTimeout(tapTimer);
      links.dispose();
      screen.removeEventListener('touchstart', onTouchStart, { capture: true });
      screen.removeEventListener('touchmove', onTouchMove, { capture: true });
      screen.removeEventListener('touchend', onTouchEnd, { capture: true });
      screen.removeEventListener('touchcancel', onTouchCancel, { capture: true });
      observer.disconnect();
      data.dispose(); resize.dispose(); current.dispose(); terminal.dispose();
      onLaunchHandler?.(null);
      client.current = undefined; fitTerminal.current = undefined; terminalInstance.current = null;
    };
  }, [authenticated]);

  useEffect(() => {
    if (!onAccessChange || requestedRunId === selectedRef.current) return;
    if (requestedRunId === undefined || accessRef.current.runs.some(run => run.runId === requestedRunId)) selectRun(requestedRunId);
  }, [requestedRunId, onAccessChange]);

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
      publishAccess({ authenticated: true });
      setAuthenticated(true);
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : 'Terminal authentication failed.');
    } finally { if (!controller.signal.aborted) setPending(false); }
  }
  const clipboardCapabilities = () => ({
    secureContext: window.isSecureContext,
    readText: typeof navigator.clipboard?.readText === 'function',
    writeText: typeof navigator.clipboard?.writeText === 'function',
  });
  const isCurrentInputTarget = (targetClient: OwnedTerminalClient, runId: RunId) => {
    const access = accessRef.current;
    return client.current === targetClient && selectedRef.current === runId &&
      access.authenticated && access.connected && access.available && access.ready && !access.resync &&
      access.runs.some(entry => entry.runId === runId && entry.state === 'running');
  };
  const retainPaste = (text: string, message: string) => {
    setManualPaste(text);
    setShowManualPaste(true);
    setClipboardNotice(message);
  };
  const sendPaste = (targetClient: OwnedTerminalClient, runId: RunId, text: string, source: string) => {
    if (!isCurrentInputTarget(targetClient, runId)) {
      retainPaste(text, `Terminal changed or disconnected. ${source} text was kept for review; nothing was sent.`);
      return;
    }
    const delivery = targetClient.input(text);
    if (delivery.status === 'queued') {
      setManualPaste('');
      setShowManualPaste(false);
      setClipboardNotice(`${source} input queued for the selected terminal; process consumption is not acknowledged.`);
    } else if (delivery.status === 'partial') {
      retainPaste(text.slice(delivery.sentCodeUnits),
        `Some ${source.toLowerCase()} input may have been applied. The unsent remainder is kept; review the terminal before retrying.`);
    } else {
      retainPaste(text, `${source} input was not sent. Text is kept for an explicit retry after the terminal reconnects.`);
    }
  };
  async function copySelection() {
    const text = terminalInstance.current?.getSelection() ?? '';
    if (!text) {
      setClipboardNotice('Select terminal text first, or use Select all.');
      return;
    }
    if (clipboardMethod('copy', clipboardCapabilities(), true) === 'async-write') {
      try {
        await navigator.clipboard.writeText(text);
        setClipboardFallback(null);
        setClipboardNotice('Terminal selection copied.');
        return;
      } catch {
        // Continue to the deliberate manual-copy fallback.
      }
    }
    setClipboardFallback(text);
    setClipboardNotice(clipboardFailure('copy').message);
  }
  async function pasteClipboard() {
    const targetClient = client.current;
    const targetRunId = selectedRef.current;
    if (!targetClient || !targetRunId || !isCurrentInputTarget(targetClient, targetRunId)) {
      setClipboardNotice('Select a connected, ready owned terminal before pasting.');
      return;
    }
    if (clipboardMethod('paste', clipboardCapabilities(), true) !== 'async-read') {
      setManualPaste('');
      setShowManualPaste(true);
      setClipboardNotice(clipboardFailure('paste').message);
      return;
    }
    try {
      const result = manualPasteResult(await navigator.clipboard.readText());
      if (result.type === 'paste') {
        if (utf8Bytes(result.text) > MAX_MANUAL_PASTE_BYTES) {
          setShowManualPaste(true);
          setClipboardNotice('Clipboard text exceeds 256 KiB. Paste a smaller chunk or enter a shorter command.');
          return;
        }
        sendPaste(targetClient, targetRunId, result.text, 'Clipboard');
      } else setClipboardNotice(result.type === 'empty' ? 'Clipboard is empty.' : 'Paste cancelled.');
    } catch {
      setManualPaste('');
      setShowManualPaste(true);
      setClipboardNotice(clipboardFailure('paste').message);
    }
  }
  function sendManualPaste() {
    const result = manualPasteResult(manualPaste);
    if (result.type !== 'paste') {
      setClipboardNotice(result.type === 'empty' ? 'Enter text to paste.' : 'Paste cancelled.');
      return;
    }
    if (utf8Bytes(result.text) > MAX_MANUAL_PASTE_BYTES) {
      setClipboardNotice('Paste text exceeds 256 KiB. Send it in smaller chunks.');
      return;
    }
    const targetClient = client.current;
    const targetRunId = selectedRef.current;
    if (!targetClient || !targetRunId) {
      setClipboardNotice('Select a connected, ready owned terminal before sending pasted text.');
      return;
    }
    sendPaste(targetClient, targetRunId, result.text, 'Manual paste');
  }
  const run = runs.find(entry => entry.runId === selected);
  const keyboardEnabled = authenticated && connected && available && ready && !resync && !!run && run.state === 'running';
  return <section className="owned-terminal" aria-label="Owned terminals">
    <header>
      <strong>Owned terminals</strong>
      {authenticated && <button onClick={() => {
        client.current?.dispose(); setAuthenticated(false); setReady(false);
        setRuns([]); setSelected(undefined); selectedRef.current = undefined;
        setAvailable(false); setReason('Authenticate to check terminal availability.');
        publishAccess({ authenticated: false, connected: false, available: false, ready: false, resync: false, runs: [] });
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
        {!mobile && <button disabled={!available || !connected || resync || launchPending} onClick={() => {
          const requestId = newLaunchRequestId();
          if (onLaunchRequested) onLaunchRequested(requestId);
          else {
            if (!client.current?.launch(requestId)) {
              setStatus('Disconnected or backpressured — launch was not sent.');
            }
          }
        }}>Launch selected project</button>}
        {!mobile && <label>Owned run <select aria-label="Owned run" value={selected ?? ''} disabled={resync} onChange={event => {
          const next = runs.find(entry => entry.runId === event.target.value)?.runId;
          if (onSelectionChange) onSelectionChange(next);
          else selectRun(next);
        }}>
          <option value="">Select a run</option>
          {runs.map(entry => <option key={entry.runId} value={entry.runId}>
            {entry.runId} · PID {entry.pid} · {entry.state}{entry.state === 'exited' ? ` (${entry.exitCode ?? 'unknown'})` : ''}
          </option>)}
        </select></label>}
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
      {mobile && <div className="terminal-keybar" aria-label="Terminal keyboard and clipboard controls">
        <button type="button" disabled={!keyboardEnabled} onClick={() => terminalInstance.current?.selectAll()}>Select all</button>
        <button type="button" disabled={!keyboardEnabled} onClick={() => void copySelection()}>Copy selection</button>
        <button type="button" disabled={!keyboardEnabled} onClick={() => void pasteClipboard()}>Paste</button>
        {(['Tab', 'Esc', 'Ctrl+C', 'Ctrl+D', '↑', '↓', '←', '→'] as const).map((key, index) => {
          const input = ['\t', '\u001b', '\u0003', '\u0004', '\u001b[A', '\u001b[B', '\u001b[D', '\u001b[C'][index];
          return <button key={key} type="button" disabled={!keyboardEnabled} onClick={() => client.current?.input(input)}>{key}</button>;
        })}
      </div>}
      {clipboardNotice && <p className="terminal-notice" role="status">{clipboardNotice}</p>}
      {clipboardFallback !== null && <textarea className="terminal-clipboard-fallback" aria-label="Selected terminal text for manual copy"
        readOnly value={clipboardFallback} onFocus={event => event.currentTarget.select()} />}
      {showManualPaste &&
        <div className="terminal-manual-paste-wrap">
          <label htmlFor="manual-terminal-paste">Paste text manually</label>
          <textarea id="manual-terminal-paste" className="terminal-manual-paste" value={manualPaste}
            onChange={event => setManualPaste(event.target.value)}
            onPaste={event => {
              if (utf8Bytes(event.clipboardData.getData('text')) > MAX_MANUAL_PASTE_BYTES) {
                event.preventDefault();
                setClipboardNotice('Paste text exceeds 256 KiB. Send it in smaller chunks.');
              }
            }} />
          <button type="button" disabled={!keyboardEnabled || !manualPaste} onClick={sendManualPaste}>Send pasted text</button>
        </div>}
      <div ref={container} className="terminal-screen" aria-label="Owned run terminal" data-mobile-gesture-optout
        style={keyboardViewport.keyboardOpen ? { height: 'min(28vh, 220px)', minHeight: 120 } : undefined} />
    </>}
  </section>;
}
