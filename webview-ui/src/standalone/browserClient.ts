import type { HostClient } from '../hostClient.js';
import type { OutboundMessage, WebviewMessage } from '../../../src/types.js';
import { decodeEvent, isObserverLayout } from '../../../standalone/src/events.js';
import { LayoutDraft } from '../office/editor/layoutDraft.js';
import { validPreferences, validPreferenceMutation, type OfficePreferences, type PreferenceMutation } from '../../../standalone/src/officePreferences.js';

export interface BrowserControlOptions {
  recoveryKey: string;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  onPreferenceDraft?: (draft: PreferenceMutation | null) => void;
}

export interface BrowserHostClient extends HostClient {
  dispose(): void;
  discardPreferenceDraft(): void;
}

/** Production WebSocket adapter. Reconnection only requests observation snapshots. */
export function createBrowserClient(
  status: (state: string) => void,
  createSocket: (url: string) => WebSocket = url => new WebSocket(url),
  origin = window.location.origin,
  control?: BrowserControlOptions,
): BrowserHostClient {
  const listeners = new Set<(message: OutboundMessage) => void>();
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let requested = false;
  let delay = 500;
  let preferencesRevision: string | null | undefined;
  let requestId = 0;
  let inFlight: number | undefined;
  let inFlightPreference = false;
  let preferenceDraft: PreferenceMutation | null = null;
  let recovery: unknown;
  let preferences: OfficePreferences | undefined;
  let roster: Extract<OutboundMessage, { type: 'existingAgents' }> | undefined;
  const storage = control ? control.storage ?? window.localStorage : undefined;
  const emit = (message: OutboundMessage) => {
    if (control && preferences) {
      if (message.type === 'existingAgents') {
        roster = message;
        message = { ...message, agents: message.agents.map(agent => ({
          ...agent, seatId: preferences!.agents[agent.id]?.seatId ?? null,
          paletteIndex: preferences!.agents[agent.id]?.palette ?? agent.paletteIndex,
        })) };
      } else if (message.type === 'settingsLoaded') message = { type: 'settingsLoaded', ...preferences.settings };
    }
    for (const listener of listeners) listener(message);
  };
  const failure = (error: string) => {
    status(error);
    emit({ type: 'layoutError', error });
  };
  const validRevision = (v: unknown) => v === null || typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const preferenceKey = control ? `${control.recoveryKey}:preferences` : '';
  function reconcilePreferences() {
    if (!preferences) return;
    emit({ type: 'settingsLoaded', ...preferences.settings });
    if (roster) emit(roster);
  }
  function retainPreference(draft: PreferenceMutation | null): boolean {
    if (draft !== null) {
      preferenceDraft = draft;
      control?.onPreferenceDraft?.(draft);
    }
    try {
      storage?.setItem(preferenceKey, JSON.stringify(draft));
      if (draft === null) {
        preferenceDraft = null;
        control?.onPreferenceDraft?.(null);
      }
      return true;
    }
    catch {
      failure('Preference recovery storage failed; export the visible attempted change before closing. Nothing is retried automatically.');
      return false;
    }
  }
  if (control && storage) {
    const raw = storage.getItem(preferenceKey);
    if (raw !== null) {
      if (raw.length > 128 * 1024) throw new Error('Preference draft exceeds recovery limit; existing storage was not replaced.');
      const draft: unknown = JSON.parse(raw);
      if (draft !== null && !validPreferenceMutation(draft)) throw new Error('Malformed preference draft; existing storage was not replaced.');
      preferenceDraft = draft;
      control.onPreferenceDraft?.(draft);
    }
  }
  const encode = (message: WebviewMessage) => JSON.stringify({ version: 1, kind: 'office', message });

  function connect() {
    if (disposed || socket || !listeners.size) return;
    status('Connecting');
    const url = new URL(control ? '/control' : '/office', origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const current = createSocket(url.href);
    socket = current;
    current.onopen = () => {
      if (disposed || socket !== current) return;
      delay = 500;
      preferencesRevision = undefined;
      status(control ? 'Connected - selected-project office control' : 'Connected - read-only');
      if (requested) current.send(encode({ type: 'webviewReady' }));
    };
    current.onmessage = event => {
      if (disposed || socket !== current) return;
      try {
        if (typeof event.data !== 'string') throw new Error('Expected text office frame.');
        if (event.data.length > 8 * 1024 * 1024) throw new Error('Office frame exceeds limit.');
        const frame: unknown = JSON.parse(event.data);
        if (control && frame && typeof frame === 'object' && 'kind' in frame) {
          const value = frame as Record<string, unknown>;
          if (value.kind === 'controlState') {
            if (Object.keys(value).length !== 4 || value.version !== 1 || !validRevision(value.preferencesRevision)
              || !validPreferences(value.preferences)) throw new Error('Invalid control state.');
            const changed = preferencesRevision !== value.preferencesRevision;
            preferences = value.preferences;
            preferencesRevision = value.preferencesRevision as string | null;
            // Advance the revision only with the corresponding complete authoritative
            // settings/seat map, including replies to unrelated detail requests.
            if (changed) {
              emit({ type: 'settingsLoaded', ...preferences.settings });
              if (roster) emit(roster);
            }
            return;
          }
          if (value.kind === 'controlResult') {
            if (Object.keys(value).length !== 4 || value.version !== 1 || !Number.isSafeInteger(value.requestId)
              || !Array.isArray(value.messages) || value.messages.length > 8) throw new Error('Invalid control result.');
            if (value.requestId !== inFlight) return;
            const messages = value.messages.map(item => {
              const message = decodeEvent(JSON.stringify({ version: 1, kind: 'office', message: item }));
              if (message.type === 'protocolError') throw new Error('Invalid control result event.');
              return message;
            });
            inFlight = undefined;
            if (inFlightPreference && !messages.some(message => message.type === 'layoutError')) retainPreference(null);
            inFlightPreference = false;
            for (const message of messages) {
              emit(message);
            }
            return;
          }
        }
        const message = decodeEvent(event.data);
        if (message.type === 'protocolError') {
          status(`Protocol error: ${message.code}`);
          if (control && inFlight !== undefined) {
            inFlight = undefined;
            failure(`Office request rejected (${message.code}); draft retained.`);
          }
          return;
        }
        if (message.type === 'layoutError') inFlight = undefined;
        emit(message);
      } catch {
        status('Invalid server frame - disconnected');
        current.close(1002, 'Invalid server frame');
      }
    };
    current.onerror = () => {
      if (!disposed && socket === current) status('Connection failed - authenticate again if the credential was revoked');
    };
    current.onclose = () => {
      if (socket !== current) return;
      socket = undefined;
      preferencesRevision = undefined;
      if (inFlight !== undefined) {
        inFlight = undefined;
        failure('Disconnected before save acknowledgement. Draft retained; inspect saved state before deliberately retrying.');
      }
      if (disposed || !listeners.size) return;
      status('Disconnected - retrying observation only; authenticate again after rotation');
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 10_000);
    };
  }
  function disconnect() {
    if (retry) clearTimeout(retry);
    retry = undefined;
    const current = socket;
    socket = undefined;
    if (current) {
      current.onopen = null;
      current.onmessage = null;
      current.onerror = null;
      current.onclose = null;
      current.close();
    }
  }
  return {
    send(message) {
      if (disposed) { status('Disconnected'); return; }
      if (control && (message.type === 'exportLayout' || message.type === 'exportLayoutSnapshot')) {
        const state = recovery as { draft?: unknown } | undefined;
        const layout = message.type === 'exportLayoutSnapshot' ? message.layout : state?.draft;
        if (!isObserverLayout(layout)) { failure('No valid layout draft to export.'); return; }
        const bytes = JSON.stringify(layout, null, 2);
        if (new TextEncoder().encode(bytes).length > 2 * 1024 * 1024) { failure('Layout exceeds export limit.'); return; }
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = 'squad-pod-layout.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        return;
      }
      if (control && message.type === 'importLayout') {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json,application/json';
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) return;
          if (file.size > 2 * 1024 * 1024) { failure('Import exceeds 2 MiB; draft retained.'); return; }
          void file.text().then(text => {
            const layout: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
            if (!isObserverLayout(layout)) throw new Error('Invalid office layout.');
            emit({ type: 'layoutLoaded', layout: layout as Extract<OutboundMessage, { type: 'layoutLoaded' }>['layout'], revision: null, workspaceRoot: '', source: 'import' });
          }).catch(() => failure('Invalid or unreadable import; existing draft retained.'));
        };
        input.click();
        return;
      }
      if (control && ['saveLayout', 'saveAgentSeats', 'setSoundEnabled', 'setDebugEnabled', 'setShowAreas'].includes(message.type)) {
        const mutation = message as Extract<WebviewMessage, {
          type: 'saveLayout' | 'saveAgentSeats' | 'setSoundEnabled' | 'setDebugEnabled' | 'setShowAreas'
        }>;
        const preference = validPreferenceMutation(mutation);
        if (preference && preferenceDraft !== null
          && JSON.stringify(preferenceDraft) !== JSON.stringify(mutation)) {
          reconcilePreferences();
          failure('New preference change rejected, not retained: an earlier settings/seat draft is unresolved. Retry or export and discard that draft first.');
          return;
        }
        if (preference && !retainPreference(mutation)) { reconcilePreferences(); return; }
        if (socket?.readyState !== WebSocket.OPEN || preferencesRevision === undefined) {
          if (preference) reconcilePreferences();
          failure('Disconnected or not ready - change not sent; draft retained.'); return;
        }
        if (inFlight !== undefined) {
          if (preference) reconcilePreferences();
          failure('Another office save is pending; change not sent. Retry deliberately after acknowledgement.'); return;
        }
        const expectedRevision = mutation.type === 'saveLayout' ? mutation.expectedRevision ?? null : preferencesRevision;
        const frame = JSON.stringify({ version: 1, kind: 'control', requestId: ++requestId, expectedRevision, message });
        if (new TextEncoder().encode(frame).length > 2 * 1024 * 1024 + 8192) {
          failure('Office change exceeds frame limit; draft retained.'); return;
        }
        inFlight = requestId;
        inFlightPreference = preference;
        try { socket.send(frame); }
        catch {
          inFlight = undefined;
          failure('Office change could not be sent; draft retained. Retry deliberately after reconnecting.');
        }
        return;
      }
      if (control && message.type === 'diagnosticReport') return;
      if (!['webviewReady', 'getSettings', 'requestAgentDetail'].includes(message.type)) {
        status('Read-only: this operation is unavailable; nothing was saved or launched.');
        return;
      }
      if (message.type === 'webviewReady') requested = true;
      if (socket?.readyState === WebSocket.OPEN) socket.send(encode(message));
      else if (message.type !== 'webviewReady') status('Disconnected - request not sent');
    },
    discardPreferenceDraft() {
      if (!control || disposed) return;
      if (inFlight !== undefined) { failure('Another office save is pending; the preference draft cannot be discarded before acknowledgement.'); return; }
      if (retainPreference(null)) reconcilePreferences();
    },
    subscribe(listener) {
      if (disposed) throw new Error('Browser host disposed.');
      listeners.add(listener);
      connect();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) disconnect();
      };
    },
    getState() {
      if (!control || !storage) return undefined;
      const raw = storage.getItem(control.recoveryKey);
      if (raw === null) return undefined;
      if (raw.length > 8 * 1024 * 1024) throw new Error('Recovery exceeds 8 MiB; existing data was not replaced.');
      recovery = JSON.parse(raw);
      return recovery;
    },
    setState<T>(state: T): T {
      if (!control || !storage) throw new Error('Layout drafts and persistence are disabled in this read-only observer.');
      const checked = new LayoutDraft(state);
      if (checked.invalidRecovery) throw new Error(checked.error ?? 'Invalid recovery state.');
      const raw = JSON.stringify(checked.state);
      if (new TextEncoder().encode(raw).length > 8 * 1024 * 1024) throw new Error('Recovery exceeds 8 MiB. Export before closing.');
      recovery = checked.state;
      storage.setItem(control.recoveryKey, raw);
      return state;
    },
    dispose() {
      disposed = true;
      disconnect();
      listeners.clear();
    },
  };
}
