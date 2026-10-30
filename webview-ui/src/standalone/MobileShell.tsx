import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { OwnedRun } from '../../../src/core/ownedTerminalProtocol.js';
import {
  initialMobileShellState, reduceMobileShell, type MobileShellEvent,
  type MobileShellState, type MobileTerminalAccess,
} from '../mobile/mobileShellState.js';
import { reduceEdgeSwipe, type EdgeSwipeEffect, type EdgeSwipeState } from '../mobile/edgeSwipe.js';
import { OwnedTerminalPanel, type OwnedTerminalPanelProps } from './OwnedTerminalPanel.js';

const INITIAL_ACCESS: MobileTerminalAccess = {
  authenticated: false, connected: false, available: false, ready: false, resync: false, runs: [],
};
function isMobile(): boolean {
  return (typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 700px), (pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
}
function requestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

interface MobileShellProps {
  office: ReactNode;
  onKeyboardViewport?: OwnedTerminalPanelProps['onKeyboardViewport'];
}
export function MobileShell({ office, onKeyboardViewport }: MobileShellProps) {
  const [state, setState] = useState(initialMobileShellState);
  const [access, setAccess] = useState(INITIAL_ACCESS);
  const [mobile, setMobile] = useState(isMobile);
  const [launchNotice, setLaunchNotice] = useState('');
  const stateRef = useRef<MobileShellState>(initialMobileShellState);
  const accessRef = useRef<MobileTerminalAccess>(INITIAL_ACCESS);
  const launchRef = useRef<((id: string) => boolean) | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const syntheticCancelRef = useRef(false);

  useEffect(() => {
    const query = typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 700px), (pointer: coarse)') : null;
    const update = () => setMobile((query?.matches ?? false) || navigator.maxTouchPoints > 0);
    query?.addEventListener('change', update);
    update();
    return () => query?.removeEventListener('change', update);
  }, []);

  const dispatch = (event: MobileShellEvent) => {
    const step = reduceMobileShell(stateRef.current, event, accessRef.current);
    stateRef.current = step.state;
    setState(step.state);
    for (const effect of step.effects) {
      if (effect.type === 'select') continue;
      if (effect.type === 'launch') {
        const sent = launchRef.current?.(effect.requestId) ?? false;
        if (!sent) dispatch({ type: 'launchResult', requestId: effect.requestId,
          result: { ok: false, message: 'Terminal disconnected or launch was not sent.' } });
      } else setLaunchNotice(effect.message);
    }
  };
  const updateAccess: NonNullable<OwnedTerminalPanelProps['onAccessChange']> = next => {
    accessRef.current = { ...next };
    setAccess(next);
    dispatch({ type: next.connected ? 'runsChanged' : 'disconnect' });
  };
  const launchResult: NonNullable<OwnedTerminalPanelProps['onLaunchResult']> = (request, result) => {
    dispatch({ type: 'launchResult', requestId: request, result });
  };
  const selectionChanged: NonNullable<OwnedTerminalPanelProps['onSelectionChange']> = runId => {
    if (runId) dispatch({ type: 'card', card: { kind: 'owned', runId } });
    else dispatch({ type: 'clearSelection' });
  };
  const changeView = () => dispatch({ type: 'toggle' });

  useEffect(() => {
    const shell = shellRef.current;
    const track = trackRef.current;
    if (!mobile || !shell || !track) return;
    let current: EdgeSwipeState = { phase: 'idle' };
    const target = state.view === 'office' ? 'terminal' : 'office';
    const applyEffects = (effects: EdgeSwipeEffect[], event: TouchEvent) => {
      for (const effect of effects) {
        if (effect.type === 'arm') {
          if (event.cancelable) event.preventDefault();
        } else if (effect.type === 'claim') {
          const original = event.target;
          if (original instanceof Element) {
            const cancel = new Event('touchcancel', { bubbles: true });
            Object.defineProperties(cancel, {
              changedTouches: { value: Array.from(event.changedTouches) },
              touches: { value: [] },
              targetTouches: { value: [] },
            });
            syntheticCancelRef.current = true;
            try { original.dispatchEvent(cancel); }
            finally { syntheticCancelRef.current = false; }
          }
        } else if (effect.type === 'consume') {
          event.stopImmediatePropagation();
          if (event.cancelable) event.preventDefault();
        } else if (effect.type === 'drag') {
          track.style.transition = 'none';
          track.style.transform = `translateX(${effect.translatePx}px)`;
        } else if (effect.type === 'release') {
          track.style.transition = 'transform 180ms ease-out';
        } else if (effect.type === 'commit') {
          track.style.transition = 'transform 180ms ease-out';
          changeView();
        } else if (effect.type === 'settle') {
          track.style.transition = 'transform 180ms ease-out';
          track.style.transform = state.view === 'terminal' ? 'translateX(-50%)' : 'translateX(0)';
        }
      }
    };
    const handle = (event: TouchEvent) => {
      if (syntheticCancelRef.current && event.type === 'touchcancel') return;
      const rect = shell.getBoundingClientRect();
      if (event.type === 'touchstart') {
        const touch = event.changedTouches[0];
        if (!touch) return;
        const optedOut = event.target instanceof Element && !!event.target.closest(
          'button, input, select, textarea, a, [role="button"], [contenteditable="true"], [data-mobile-gesture-optout]',
        );
        const step = reduceEdgeSwipe(current, {
          type: 'start', touch: { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp },
          activeIds: Array.from(event.touches, item => item.identifier),
          left: rect.left, width: rect.width, optOut: optedOut,
        }, target);
        current = step.state;
        applyEffects(step.effects, event);
        return;
      }
      if (event.type === 'touchmove') {
        for (const touch of Array.from(event.changedTouches)) {
          const step = reduceEdgeSwipe(current, {
            type: 'move', touch: { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp },
          }, target);
          current = step.state;
          applyEffects(step.effects, event);
        }
        return;
      }
      const touch = event.changedTouches[0];
      if (!touch) return;
      const step = reduceEdgeSwipe(current, {
        type: event.type === 'touchcancel' ? 'cancel' : 'end', id: touch.identifier,
      }, target);
      current = step.state;
      applyEffects(step.effects, event);
    };
    shell.addEventListener('touchstart', handle, { capture: true, passive: false });
    shell.addEventListener('touchmove', handle, { capture: true, passive: false });
    shell.addEventListener('touchend', handle, { capture: true });
    shell.addEventListener('touchcancel', handle, { capture: true });
    return () => {
      shell.removeEventListener('touchstart', handle, { capture: true });
      shell.removeEventListener('touchmove', handle, { capture: true });
      shell.removeEventListener('touchend', handle, { capture: true });
      shell.removeEventListener('touchcancel', handle, { capture: true });
    };
  }, [mobile, state.view, access.available]);

  useEffect(() => {
    const track = trackRef.current;
    if (track) {
      track.style.transition = mobile ? 'transform 180ms ease-out' : 'none';
      track.style.transform = mobile && state.view === 'terminal' ? 'translateX(-50%)' : 'translateX(0)';
    }
  }, [mobile, state.view]);

  return <section ref={shellRef} className="observer-mobile-stage" data-mobile-view={state.view}>
    <div className="observer-pages-track" ref={trackRef}>
      <div className="observer-office-page">{office}</div>
      <div className="observer-terminal-page">
        <OwnedTerminalPanel mobile={mobile} selectedRunId={state.selectedRunId}
          launchPending={state.pendingLaunch !== null} onAccessChange={updateAccess}
          onLaunchRequested={id => dispatch({ type: 'launch', requestId: id })}
          onLaunchHandler={handler => { launchRef.current = handler; }}
          onLaunchResult={launchResult} onSelectionChange={selectionChanged}
          onKeyboardViewport={onKeyboardViewport} />
      </div>
    </div>
    {mobile &&
      <button className="mobile-view-toggle" type="button" onClick={changeView}
        data-mobile-gesture-optout aria-label={state.view === 'office' ? 'Show terminal' : 'Show office'}
        title={state.view === 'office' ? 'Show terminal' : 'Show office'}>
        {state.view === 'office' ? '>_' : 'Office'}
      </button>}
    {mobile && <nav className="mobile-owned-run-bar" aria-label="Owned terminal cards" data-mobile-gesture-optout>
      {access.runs.map((run: OwnedRun, index) => {
        const selected = state.selectedRunId === run.runId;
        return <button key={run.runId} type="button" aria-pressed={selected}
          aria-label={`Owned terminal ${index + 1}, ${run.state}, process ${run.pid}`}
          onClick={() => dispatch({ type: 'card', card: { kind: 'owned', runId: run.runId } })}>
          <span>Terminal {index + 1}</span><small>PID {run.pid} · {run.state}</small>
        </button>;
      })}
      <button type="button" className="mobile-launch-card" disabled={!access.authenticated || !access.connected ||
        !access.available || access.resync || state.pendingLaunch !== null}
        aria-label="Launch owned terminal" onClick={() => {
          setLaunchNotice('');
          dispatch({ type: 'launch', requestId: requestId() });
        }}>
        {state.pendingLaunch ? state.pendingLaunch.acknowledgedRunId
          ? 'Waiting for run…' : 'Launching…' : '+ Launch'}
      </button>
      {launchNotice && <span role="status">{launchNotice}</span>}
    </nav>}
  </section>;
}
