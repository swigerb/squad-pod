import type { WebviewMessage } from '../types.js';

/** Existing office actions, excluding the mandatory readiness handshake. */
export type HostAction = Exclude<WebviewMessage['type'], 'webviewReady'>;

/**
 * Adapter support, not authorization or a promise of successful execution.
 * Unlisted actions are unsupported. Asset delivery remains part of the snapshot;
 * asset-directory actions below describe management, not renderer asset support.
 */
export interface HostCapabilities {
  readonly actions: readonly HostAction[];
  readonly recoveryState: 'unavailable' | 'webview-state' | 'browser-storage';
}

/** Existing native message handlers and VS Code recovery storage. */
export const VSCODE_HOST_CAPABILITIES: HostCapabilities = Object.freeze({
  actions: Object.freeze<HostAction[]>([
    'getSettings', 'requestAgentDetail',
    'saveLayout', 'saveAgentSeats', 'setSoundEnabled', 'setDebugEnabled', 'setShowAreas',
    'addAssetDirectory', 'removeAssetDirectory',
    'importLayout', 'exportLayout', 'exportLayoutSnapshot',
    'focusAgent', 'openSquadAgent', 'openSquadInfo',
    'getDirectories', 'addDirectory', 'updateDirectoryName', 'changeDirectoryPath',
    'removeDirectory', 'forgetDirectoryLaunch', 'launchDirectory',
    'selectCliUsage', 'refreshCliUsage', 'clearCliUsage', 'setLiveActivity',
    'diagnosticReport',
  ]),
  recoveryState: 'webview-state',
});

/** Default standalone observer: no editor writes, recovery, dialogs or navigation. */
export const STANDALONE_OBSERVER_CAPABILITIES: HostCapabilities = Object.freeze({
  actions: Object.freeze<HostAction[]>(['getSettings', 'requestAgentDetail']),
  recoveryState: 'unavailable',
});

/** Copilot app Canvas: observation only, without cross-panel recovery storage. */
export const CANVAS_OBSERVER_CAPABILITIES: HostCapabilities = Object.freeze({
  actions: Object.freeze<HostAction[]>(['getSettings', 'requestAgentDetail']),
  recoveryState: 'unavailable',
});

/**
 * Existing opted-in standalone control adapter, including browser-local file I/O.
 * Saves still require independent server authorization, readiness and revision checks.
 */
export const STANDALONE_CONTROL_CAPABILITIES: HostCapabilities = Object.freeze({
  actions: Object.freeze<HostAction[]>([
    'getSettings', 'requestAgentDetail',
    'saveLayout', 'saveAgentSeats', 'setSoundEnabled', 'setDebugEnabled', 'setShowAreas',
    'importLayout', 'exportLayout', 'exportLayoutSnapshot',
  ]),
  recoveryState: 'browser-storage',
});

/** Canvas UI opt-in uses the same guarded office operations, never agent actions. */
export const CANVAS_CONTROL_CAPABILITIES: HostCapabilities = STANDALONE_CONTROL_CAPABILITIES;
