/**
 * SquadPodViewProvider.ts — Main webview view provider for the Squad Pod panel.
 *
 * Lifecycle:
 *   1. VS Code creates the webview → `resolveWebviewView` fires
 *   2. Webview loads React app, sends `webviewReady`
 *   3. Provider reads team roster, initializes agents, starts watchers, loads
 *      assets, sends layout + sprites + agents to webview
 *   4. File watchers detect `.squad/` activity → agent status updates → webview
 *   5. On dispose, all watchers and timers are torn down
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { LayoutData, WebviewMessage, OutboundMessage, AgentDetailInfo, TelemetryEvent, SquadInfoData, SourceStatus, PodSettings, DirectoryCatalog } from './types.js';
import {
  WORKSPACE_KEY_LAYOUT,
  VIEW_ID,
} from './constants.js';
import { createMinimalLayout, ensureTileColors } from './core/layoutState.js';
import {
  initializeAgents,
  refreshAgents,
  updateAgentStatus,
  sendExistingAgents,
  persistAgentMeta,
  saveAgentSeats,
  getAgents,
  disposeAgentManager,
  setLiveAgentStatus,
  isLiveAgent,
  setExternalCharacterPalettes,
} from './agentManager.js';
import { startSquadWatching, type ActivitySource } from './squadWatcher.js';
import { pickSquadWorkspace, resolveSquadDir } from './squadPaths.js';
import {
  loadCharacterSprites,
  loadDefaultLayout,
} from './assetLoader.js';
import {
  readPersistedLayout,
  watchLayoutFile,
  exportLayoutToFile,
  importLayoutFromFile,
  readLayoutRevision,
  parseLayoutJson,
  saveLayoutIfUnchanged,
  isValidLayout,
} from './layoutPersistence.js';
import {
  readTeamFile,
  parseTeamName,
  parseProjectContext,
  parseAllMembers,
} from './teamParser.js';
import { readSettings, saveSetting } from './settings.js';
import { assetSourceFingerprint, loadAssetSnapshot, watchAssetSnapshots } from './manifestAssets.js';
import { watchCharacterSnapshots } from './characterAssets.js';
import {
  asDirectoryEntry,
  createSavedDirectory,
  ensureUniqueDirectoryName,
  forgetDirectoryLaunch,
  readLaunchHistory,
  readSavedDirectories,
  recordDirectoryLaunch,
  resolveDirectoryMappingIds,
  sameDirectoryPath,
  SquadDirectorySuggestions,
  validateDirectoryPath,
  writeSavedDirectories,
  type SavedDirectory,
} from './directories.js';
import { launchSquadInTerminal } from './directoryLaunch.js';
import { readRecordedUsage } from './recordedUsage.js';
import { CopilotSessionActivity } from './copilotSessionActivity.js';

export class SquadPodViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private context: vscode.ExtensionContext;
  private disposeSquadWatcher: (() => void) | undefined;
  private usageTimer: ReturnType<typeof setInterval> | undefined;
  private usageRoster: ReturnType<typeof parseAllMembers> = [];
  private disposeLayoutWatcher: { dispose: () => void } | undefined;
  private assetWatcher: { dispose: () => void } | undefined;
  private characterWatcher: { dispose: () => void } | undefined;
  private characterDiagnostics: string[] = [];
  private disposables: vscode.Disposable[] = [];
  private telemetryCounter = 0;
  private directorySuggestions = new SquadDirectorySuggestions();
  private directoryCatalogRequest = 0;
  private directorySuggestionsRequested = false;
  private watchedRoot: string | undefined;
  private output: vscode.OutputChannel | undefined;
  private liveActivity: CopilotSessionActivity | undefined;
  private liveConsent = false;
  private liveRequest = 0;
  private livePending = false;
  private sourceStatus: SourceStatus = {
    workspaceRoot: null, squadDir: null, teamFound: false,
    observer: 'stopped', nativeWatch: false, error: null,
  };

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async showPanel(): Promise<void> {
    if (!this.view?.visible) {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }
  }

  // ─── WebviewViewProvider ────────────────────────────────────────

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _resolveContext: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'dist')),
      ],
    };

    webviewView.webview.html = this.getWebviewHtml(webviewView.webview);

    // Listen for messages from the webview
    webviewView.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleWebviewMessage(message),
      undefined,
      this.disposables,
    );

    // Re-target the office when the user adds or removes workspace folders
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.sendDirectoryCatalog();
      if (this.watchedRoot !== this.getWorkspaceRoot()) {
        this.stopWatching();
        this.onWebviewReady();
      }
    }, undefined, this.disposables);

    // Teardown on view dispose
    webviewView.onDidDispose(() => this.teardown(), undefined, this.disposables);
    vscode.workspace.onDidChangeConfiguration?.((event) => {
      if (event.affectsConfiguration('squad-pod.liveActivity')) {
        void this.configureLiveActivity(vscode.workspace.getConfiguration('squad-pod').get('liveActivity', false));
      }
    }, undefined, this.disposables);
  }

  // ─── Message Handling ──────────────────────────────────────────

  private handleWebviewMessage(message: WebviewMessage): void {
    switch (message.type) {
      case 'setLiveActivity':
        if (typeof message.enabled === 'boolean') {void this.configureLiveActivity(message.enabled, true);}
        break;
      case 'webviewReady':
        this.onWebviewReady();
        break;

      case 'addAssetDirectory':
        void this.addAssetDirectory().catch((error: unknown) => this.assetDirectoryError(error));
        break;

      case 'removeAssetDirectory':
        void this.removeAssetDirectory(message.directory).catch((error: unknown) => this.assetDirectoryError(error));
        break;

      case 'getDirectories':
        this.directorySuggestionsRequested = true;
        this.sendDirectoryCatalog();
        break;

      case 'addDirectory':
        void this.addDirectory(message.path, message.name).catch((error: unknown) => this.directoryError(error));
        break;

      case 'updateDirectoryName':
        void this.updateDirectoryName(message.id, message.name).catch((error: unknown) => this.directoryError(error));
        break;

      case 'changeDirectoryPath':
        void this.changeDirectoryPath(message.id).catch((error: unknown) => this.directoryError(error));
        break;

      case 'removeDirectory':
        void this.removeDirectory(message.id).catch((error: unknown) => this.directoryError(error));
        break;

      case 'forgetDirectoryLaunch':
        void this.forgetDirectoryLaunch(message.id).catch((error: unknown) => this.directoryError(error));
        break;

      case 'launchDirectory':
        void this.launchDirectory(message.id, message.source).catch((error: unknown) => this.directoryError(error));
        break;

      case 'saveAgentSeats':
        if (message.seats && typeof message.seats === 'object') {
          saveAgentSeats(
            message.seats,
            this.context,
          );
        }
        break;

      case 'saveLayout':
        this.onSaveLayout(message.layout, message.expectedRevision, message.workspaceRoot);
        break;

      case 'exportLayoutSnapshot':
        if (isValidLayout(message.layout)) {
          void exportLayoutToFile(message.layout, vscode).catch((error: unknown) => {
            this.postMessage({ type: 'layoutError', error: `Could not export recovery snapshot: ${String(error)}` });
          });
        } else {
          this.postMessage({ type: 'layoutError', error: 'Cannot export an invalid layout snapshot.' });
        }
        break;

      case 'setSoundEnabled':
        void this.onSaveSetting('soundEnabled', message.enabled);
        break;

      case 'setDebugEnabled':
        void this.onSaveSetting('debugEnabled', message.enabled);
        break;

      case 'setShowAreas':
        void this.onSaveSetting('showAreas', message.enabled);
        break;

      case 'getSettings':
        this.postMessage({ type: 'settingsLoaded', ...readSettings(this.context.globalState) });
        break;

      case 'focusAgent':
        this.onFocusAgent(message.agentId);
        break;

      case 'openSquadAgent':
        this.onOpenSquadAgent(message.agentId);
        break;

      case 'exportLayout':
        this.onExportLayout();
        break;

      case 'importLayout':
        this.onImportLayout();
        break;

      case 'requestAgentDetail':
        this.onRequestAgentDetail(message.agentId);
        break;

      case 'openSquadInfo':
        this.onOpenSquadInfo();
        break;

      case 'diagnosticReport':
        this.onDiagnosticReport(message);
        break;

      default:
        // Unknown message — ignore
        break;
    }
  }

  // ─── Initialization ───────────────────────────────────────────

  private onWebviewReady(): void {
    const webview = this.view?.webview;
    if (!webview) {return;}

    const workspaceRoot = this.getWorkspaceRoot();
    this.postMessage({ type: 'settingsLoaded', ...readSettings(this.context.globalState) });
    this.sendDirectoryCatalog();
    this.log(`webviewReady; workspaceRoot=${workspaceRoot ?? '<none>'}`);
    if (!workspaceRoot) {
      this.sendRecordedUsage();
      this.postMessage({ type: 'sourceStatus', status: this.sourceStatus });
      this.postMessage({ type: 'noWorkspace' });
      return;
    }

    // A reloaded webview only needs a fresh snapshot; keep agent state,
    // timers and watchers alive so in-flight activity is not lost.
    this.loadAndSendCustomAssetUris();
    let agents = getAgents();
    if (this.watchedRoot !== workspaceRoot || !this.disposeSquadWatcher) {
      this.stopWatching();
      agents = initializeAgents(workspaceRoot, this.context, webview);
      this.startWatching(workspaceRoot, webview);
    }

    // Assets first, then layout, then the roster snapshot (the webview
    // buffers roster until layout arrives, so either order is safe).
    this.loadAndSendAssets();
    this.loadAndSendLayout(workspaceRoot);
    sendExistingAgents(agents, this.context, webview, this.getWorkspaceDirectoryIds(workspaceRoot));
    this.postMessage({ type: 'sourceStatus', status: this.sourceStatus });
    this.sendRecordedUsage(workspaceRoot);
    this.liveActivity?.replay();
    void this.configureLiveActivity(vscode.workspace.getConfiguration('squad-pod').get('liveActivity', false));
  }

  private async configureLiveActivity(enabled: boolean, writeSetting = false): Promise<void> {
    if (enabled && this.livePending) {return;}
    const request = ++this.liveRequest;
    if (!enabled) {
      this.livePending = false;
      this.liveConsent = false;
      this.liveActivity?.stop();
      this.liveActivity = undefined;
      this.sourceStatus.liveActivity = { state: 'off', sessionId: null };
      this.postMessage({ type: 'sourceStatus', status: this.sourceStatus });
    }
    try {
      if (enabled && !this.liveConsent) {
        this.livePending = true;
        const answer = await vscode.window.showWarningMessage(
          'Show live Squad activity? Squad Pod will read local Copilot CLI workspace metadata and session event logs for this workspace. Only member names, short task descriptions, tool names, file basenames, command names and context counts are used. Prompts, other arguments and outputs are never displayed or stored. The session format is undocumented and best-effort.',
          { modal: true }, 'Enable Live Activity',
        );
        if (request !== this.liveRequest) {return;}
        this.livePending = false;
        enabled = answer === 'Enable Live Activity';
        this.liveConsent = enabled;
        writeSetting = true;
      }
      if (writeSetting) {
        await vscode.workspace.getConfiguration('squad-pod').update('liveActivity', enabled, vscode.ConfigurationTarget.Workspace);
      }
      if (request !== this.liveRequest || !enabled || !this.liveConsent) {
        if (!enabled) {
          this.sourceStatus.liveActivity = { state: 'off', sessionId: null };
          this.postMessage({ type: 'sourceStatus', status: this.sourceStatus });
        }
        return;
      }
      if (this.liveActivity || !this.watchedRoot || !this.view) {return;}
      const webview = this.view.webview;
      this.liveActivity = new CopilotSessionActivity({
        workspaceRoot: this.watchedRoot,
        roster: () => [...getAgents().keys()].map(id => ({ id, folder: id })),
        post: message => this.postMessage(message),
        lifecycle: (id, active, task) => setLiveAgentStatus(id, active, task, webview),
        status: liveActivity => {
          this.sourceStatus = { ...this.sourceStatus, liveActivity };
          this.postMessage({ type: 'sourceStatus', status: this.sourceStatus });
          if (liveActivity.state === 'error') {this.log('Live activity: unable to read session metadata or events.');}
        },
      });
      this.liveActivity.start();
    } catch {
      if (request !== this.liveRequest) {return;}
      this.livePending = false;
      this.liveActivity?.stop();
      this.liveActivity = undefined;
      this.liveConsent = false;
      this.sourceStatus.liveActivity = { state: 'error', sessionId: null };
      this.postMessage({ type: 'sourceStatus', status: this.sourceStatus });
      this.log('Live activity: could not update setting or obtain consent.');
      void vscode.window.showErrorMessage('Squad Pod could not enable live activity. Check workspace settings permissions.');
    }
  }

  private sendRecordedUsage(workspaceRoot?: string): void {
    this.postMessage({ type: 'recordedUsage', snapshot: readRecordedUsage(workspaceRoot, this.usageRoster) });
  }

  private startWatching(workspaceRoot: string, webview: vscode.Webview): void {
    this.watchedRoot = workspaceRoot;
    this.usageRoster = parseAllMembers(readTeamFile(workspaceRoot) ?? '');
    this.usageTimer = setInterval(() => this.sendRecordedUsage(workspaceRoot), 2000);
    this.disposeSquadWatcher = startSquadWatching(workspaceRoot, {
      onStatusChanged: (status) => {
        if (status.squadDir !== this.sourceStatus.squadDir) {
          this.usageRoster = parseAllMembers(readTeamFile(workspaceRoot) ?? '');
        }
        this.sourceStatus = { ...status, liveActivity: this.sourceStatus.liveActivity };
        this.postMessage({ type: 'sourceStatus', status: this.sourceStatus });
        if (status.error) { this.log(status.error); }
      },
      onRosterChanged: () => {
        this.usageRoster = parseAllMembers(readTeamFile(workspaceRoot) ?? '');
        this.sendRecordedUsage(workspaceRoot);
        const directoryIds = this.getWorkspaceDirectoryIds(workspaceRoot);
        const updated = refreshAgents(workspaceRoot, this.context, webview, directoryIds);
        sendExistingAgents(updated, this.context, webview, directoryIds);
        this.liveActivity?.replay();
        this.emitTelemetry('log', null, null, 'Team roster updated');
      },
      onAgentActivity: (event) => {
        if (isLiveAgent(event.agentId)) {return;}
        const agent = getAgents().get(event.agentId)
          ?? [...getAgents().values()].find(a => event.agentId.startsWith(a.id));
        const displayName = agent?.name ?? event.agentId;
        this.emitTelemetry(
          telemetryCategoryFor(event.source),
          agent?.id ?? event.agentId,
          displayName,
          `[${event.source}] ${displayName} — ${event.task ?? 'activity detected'}`,
          event.task,
        );
        updateAgentStatus(event.agentId, event.status, event.task, webview);
      },
    });

    this.disposeLayoutWatcher = watchLayoutFile(workspaceRoot, (layout, revision) => {
      this.postMessage({ type: 'layoutLoaded', layout, revision, workspaceRoot });
      void this.context.workspaceState.update(WORKSPACE_KEY_LAYOUT, layout).then(undefined, (error: unknown) => {
        this.postMessage({ type: 'layoutError', error: `Could not cache external layout: ${String(error)}` });
      });
    }, (error) => this.postMessage({ type: 'layoutError', error, source: 'watcher' }));
  }

  private stopWatching(): void {
    ++this.liveRequest;
    this.livePending = false;
    this.liveConsent = false;
    this.liveActivity?.stop();
    this.liveActivity = undefined;
    if (this.usageTimer) {clearInterval(this.usageTimer);}
    this.usageTimer = undefined;
    this.usageRoster = [];
    this.disposeSquadWatcher?.();
    this.disposeSquadWatcher = undefined;
    this.disposeLayoutWatcher?.dispose();
    this.disposeLayoutWatcher = undefined;
    this.watchedRoot = undefined;
    this.sourceStatus = {
      workspaceRoot: null, squadDir: null, teamFound: false,
      observer: 'stopped', nativeWatch: false, error: null,
    };
  }

  private async onSaveSetting(setting: keyof PodSettings, enabled: unknown): Promise<void> {
    try {
      await saveSetting(this.context.globalState, setting, enabled);
    } catch (error) {
      this.log(`Failed to save ${setting}: ${String(error)}`);
      void vscode.window.showErrorMessage(`Squad Pod could not save ${setting}: ${String(error)}`);
    }
    this.postMessage({ type: 'settingsLoaded', ...readSettings(this.context.globalState) });
  }

  // ─── Diagnostics ─────────────────────────────────────────────────

  private log(line: string): void {
    this.output ??= vscode.window.createOutputChannel('Squad Pod');
    this.output.appendLine(`[${new Date().toISOString()}] ${line}`);
  }

  private onDiagnosticReport(report: Extract<WebviewMessage, { type: 'diagnosticReport' }>): void {
    this.log(
      `webview assets: sheets=${report.characterSheetsSize ?? '?'} [${(report.characterSheetKeys ?? []).join(', ')}]` +
      ` bootstrap=${report.bootstrapRan ?? '?'} errors=${(report.errors ?? []).join('; ') || 'none'}`,
    );
  }

  // ─── Asset Loading ─────────────────────────────────────────────

  private loadAndSendAssets(): void {
    const extPath = this.context.extensionPath;

    // Character sprites
    const sprites = loadCharacterSprites(extPath);
    if (sprites.length > 0) {
      this.postMessage({ type: 'characterSpritesLoaded', sprites });
    }

    this.startAssetWatching();
  }

  private assetDirectories(): string[] {
    return this.context.globalState.get<string[]>('squad-pod.assetDirectories', []);
  }

  private assetDirectoryError(error: unknown): void {
    const message = `Squad Pod asset directory: ${error instanceof Error ? error.message : String(error)}`;
    this.log(message);
    void vscode.window.showErrorMessage(message);
  }

  private startAssetWatching(): void {
    this.loadAndSendCustomAssetUris();
    this.assetWatcher?.dispose();
    const root = path.join(this.context.extensionPath, 'dist', 'assets');
    this.assetWatcher = watchAssetSnapshots(
      () => loadAssetSnapshot(root, this.assetDirectories()),
      (snapshot) => {
        this.postMessage({
          type: 'manifestAssetsLoaded',
          snapshot: { ...snapshot, diagnostics: [...snapshot.diagnostics, ...this.characterDiagnostics] },
        });
        for (const diagnostic of snapshot.diagnostics) { this.log(`Asset: ${diagnostic}`); }
      },
      1000,
      () => assetSourceFingerprint(root, this.assetDirectories()),
    );
  }

  private async addAssetDirectory(): Promise<void> {
    const directories = this.assetDirectories();
    if (directories.length >= 8) {
      void vscode.window.showWarningMessage('Squad Pod: At most eight asset directories are supported.');
      return;
    }
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
      openLabel: 'Add local furniture directory',
    });
    if (!selection?.[0]) { return; }
    const directory = selection[0].fsPath;
    if (!directories.includes(directory)) {
      await this.context.globalState.update('squad-pod.assetDirectories', [...directories, directory]);
    }
    this.startAssetWatching();
  }

  private async removeAssetDirectory(directory: string): Promise<void> {
    await this.context.globalState.update('squad-pod.assetDirectories', this.assetDirectories().filter((d) => d !== directory));
    this.startAssetWatching();
  }

  // ─── Explicit directory management and launch ───────────────────

  private directoryCatalog(): DirectoryCatalog {
    const workspaceDirectories = (vscode.workspace.workspaceFolders ?? []).map((folder) =>
      asDirectoryEntry({
        id: `workspace:${folder.uri.toString()}`,
        name: folder.name,
        path: folder.uri.fsPath,
      }),
    );
    const savedDirectories = readSavedDirectories(this.context.globalState)
      .map((directory) => asDirectoryEntry(directory));
    const recentLaunches = readLaunchHistory(this.context.globalState)
      .map((directory) => asDirectoryEntry(directory, directory.lastLaunchedAt));
    return {
      workspaceDirectories,
      savedDirectories,
      recentLaunches,
      squadHistory: [],
    };
  }

  private sendDirectoryCatalog(): void {
    const request = ++this.directoryCatalogRequest;
    try {
      const catalog = this.directoryCatalog();
      this.postMessage({ type: 'directoryCatalog', catalog });
      if (!this.directorySuggestionsRequested) { return; }
      const enabled = vscode.workspace.getConfiguration('squad-pod').get<boolean>('directorySuggestions', true);
      void this.directorySuggestions.list(
        enabled, [...catalog.workspaceDirectories, ...catalog.savedDirectories], undefined,
        () => request === this.directoryCatalogRequest
          && vscode.workspace.getConfiguration('squad-pod').get<boolean>('directorySuggestions', true),
      )
        .then((squadHistory) => {
          if (request !== this.directoryCatalogRequest) { return; }
          if (!vscode.workspace.getConfiguration('squad-pod').get<boolean>('directorySuggestions', true)) { return; }
          this.postMessage({ type: 'directoryCatalog', catalog: { ...catalog, squadHistory } });
        }).catch((error: unknown) => this.directoryError(error));
    } catch (error) {
      this.directoryError(error);
    }
  }

  private directoryError(error: unknown): void {
    const message = `Squad Pod directory: ${error instanceof Error ? error.message : String(error)}`;
    this.log(message);
    this.postMessage({ type: 'directoryError', error: message });
  }

  private directoryNotice(notice: string): void {
    this.postMessage({ type: 'directoryNotice', notice });
  }

  private savedDirectory(id: unknown, directories = readSavedDirectories(this.context.globalState)): SavedDirectory {
    if (typeof id !== 'string' || !id) { throw new Error('A saved directory ID is required.'); }
    const directory = directories.find((entry) => entry.id === id);
    if (!directory) { throw new Error('That saved directory no longer exists. Refresh the directory list and try again.'); }
    return directory;
  }

  private async addDirectory(suggestedPath?: string, suggestedName?: string): Promise<void> {
    if (readSavedDirectories(this.context.globalState).length >= 100) {
      throw new Error('At most 100 saved directories are supported.');
    }

    const selection = suggestedPath === undefined ? await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Add launch directory',
    }) : [{ fsPath: suggestedPath }];
    if (!selection?.[0]) { return; }
    const directoryPath = validateDirectoryPath(selection[0].fsPath);
    if ((vscode.workspace.workspaceFolders ?? []).some((folder) => sameDirectoryPath(folder.uri.fsPath, directoryPath))) {
      this.directoryNotice('That folder is already listed under Workspace folders.');
      return;
    }
    if (readSavedDirectories(this.context.globalState).some((entry) => sameDirectoryPath(entry.path, directoryPath))) {
      this.directoryNotice('That folder is already in Saved directories.');
      return;
    }

    const defaultName = path.basename(directoryPath) || directoryPath;
    const nameInput = suggestedName ?? await vscode.window.showInputBox({
      prompt: 'Name this launch directory',
      value: defaultName,
      validateInput: (value) => {
        try {
          ensureUniqueDirectoryName(value, readSavedDirectories(this.context.globalState));
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    });
    if (nameInput === undefined) { return; }
    const current = readSavedDirectories(this.context.globalState);
    if (current.some((entry) => sameDirectoryPath(entry.path, directoryPath))) {
      throw new Error('That folder is already in Saved directories.');
    }
    if ((vscode.workspace.workspaceFolders ?? []).some((folder) => sameDirectoryPath(folder.uri.fsPath, directoryPath))) {
      throw new Error('That folder is already listed under Workspace folders.');
    }
    const name = ensureUniqueDirectoryName(nameInput, current);
    const directory = createSavedDirectory(name, directoryPath);
    await writeSavedDirectories(this.context.globalState, [...current, directory]);
    this.sendDirectoryCatalog();
    this.directoryNotice(`Saved "${name}". Launch it explicitly from the directory list.`);
  }

  private async updateDirectoryName(id: unknown, nameInput: unknown): Promise<void> {
    const directories = readSavedDirectories(this.context.globalState);
    const directory = this.savedDirectory(id, directories);
    const name = ensureUniqueDirectoryName(nameInput, directories, directory.id);
    await writeSavedDirectories(
      this.context.globalState,
      directories.map((entry) => entry.id === directory.id ? { ...entry, name } : entry),
    );
    this.sendDirectoryCatalog();
    this.directoryNotice(`Renamed directory to "${name}".`);
  }

  private async changeDirectoryPath(id: unknown): Promise<void> {
    const original = this.savedDirectory(id);
    const selection = await vscode.window.showOpenDialog({
      defaultUri: vscode.Uri.file(original.path),
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Change launch directory',
    });
    if (!selection?.[0]) { return; }
    const directoryPath = validateDirectoryPath(selection[0].fsPath);
    const directories = readSavedDirectories(this.context.globalState);
    const directory = this.savedDirectory(id, directories);
    if (directories.some((entry) => entry.id !== directory.id && sameDirectoryPath(entry.path, directoryPath))) {
      throw new Error('That folder is already in Saved directories.');
    }
    if ((vscode.workspace.workspaceFolders ?? []).some((folder) => sameDirectoryPath(folder.uri.fsPath, directoryPath))) {
      throw new Error('That folder is already listed under Workspace folders.');
    }
    await writeSavedDirectories(
      this.context.globalState,
      directories.map((entry) => entry.id === directory.id ? { ...entry, path: directoryPath } : entry),
    );
    this.sendDirectoryCatalog();
    this.directoryNotice(`Updated the folder for "${directory.name}". Existing terminals are unchanged.`);
  }

  private async removeDirectory(id: unknown): Promise<void> {
    const directories = readSavedDirectories(this.context.globalState);
    const directory = this.savedDirectory(id, directories);
    await writeSavedDirectories(this.context.globalState, directories.filter((entry) => entry.id !== directory.id));
    this.sendDirectoryCatalog();
    this.directoryNotice(`Removed "${directory.name}". Any terminal already launched keeps running.`);
  }

  private async forgetDirectoryLaunch(id: unknown): Promise<void> {
    if (typeof id !== 'string' || !id) { throw new Error('A recent launch ID is required.'); }
    const history = readLaunchHistory(this.context.globalState);
    if (!history.some((entry) => entry.id === id)) { throw new Error('That recent launch no longer exists.'); }
    await forgetDirectoryLaunch(this.context.globalState, id);
    this.sendDirectoryCatalog();
  }

  private async launchDirectory(id: unknown, source: 'workspace' | 'saved' | 'recent'): Promise<void> {
    const catalog = this.directoryCatalog();
    const entries = source === 'workspace' ? catalog.workspaceDirectories
      : source === 'saved' ? catalog.savedDirectories
        : source === 'recent' ? catalog.recentLaunches : undefined;
    if (!entries) { throw new Error('Unsupported directory source.'); }
    if (typeof id !== 'string' || !id) { throw new Error('A directory ID is required.'); }
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) { throw new Error('That directory is no longer available. Refresh the directory list and try again.'); }
    if (!entry.valid) { throw new Error(entry.error ?? 'This directory is invalid. Edit it before launching.'); }

    const cwd = launchSquadInTerminal(entry.name, entry.path, {
      isTrusted: vscode.workspace.isTrusted,
      createTerminal: (name, directory) => vscode.window.createTerminal({
        name,
        cwd: vscode.Uri.file(directory),
      }),
    });

    try {
      const record = createSavedDirectory(entry.name, cwd);
      await recordDirectoryLaunch(this.context.globalState, record);
      this.sendDirectoryCatalog();
      this.directoryNotice(`Launch requested in a new terminal at ${cwd}. Check that terminal for CLI output or permission prompts.`);
    } catch (error) {
      this.directoryNotice(`Launch requested in a new terminal at ${cwd}, but Squad Pod could not save its recent-launch record: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ─── Custom Asset URIs ──────────────────────────────────────────

  /**
   * Send webview-safe URIs for the custom tileset and character sprite
   * sheets.  The webview loads these PNGs via `new Image()` in the
   * browser, avoiding the extension-host PNG-decode + pixel-array
   * overhead of the legacy inline-sprite pipeline.
   *
   * Assets are expected in `dist/assets/` (copied by the esbuild
   * copy-assets plugin from `webview-ui/public/assets/`).
   */
  /**
   * Convert a PNG file to a base64 data URI.
   *
   * Webview resource URIs (`vscode-resource:`) have been unreliable for
   * `new Image()` loads — failures are silent (no onerror) and vary by
   * VS Code version/platform.  Data URIs bypass the webview resource
   * server entirely and are explicitly allowed by the CSP (`img-src data:`).
   */
  private loadAndSendCustomAssetUris(): void {
    this.characterWatcher?.dispose();
    this.characterWatcher = watchCharacterSnapshots(
      () => this.assetDirectories(),
      ({ characters, diagnostics }) => {
        setExternalCharacterPalettes(characters.map((character) => character.paletteIndex));
        this.characterDiagnostics = diagnostics.map((line) => `Character: ${line}`);
        this.postMessage({ type: 'characterAssetsLoaded', characters, diagnostics: this.characterDiagnostics });
        for (const diagnostic of diagnostics) { this.log(`Character: ${diagnostic}`); }
        for (const character of characters) {
          this.log(`Character: ${character.source} / ${character.file} SHA-256 ${character.sha256}`);
        }
      },
    );
  }

  // ─── Layout ───────────────────────────────────────────────────

  private loadAndSendLayout(workspaceRoot: string): void {
    // Try workspace-persisted layout first
    let revision: string | null;
    try {
      revision = readLayoutRevision(workspaceRoot);
    } catch (error) {
      this.postMessage({ type: 'layoutError', error: `Cannot read saved layout; no layout was replaced. ${String(error)}` });
      return;
    }
    let layout = revision === null ? null : parseLayoutJson(revision);

    // Fall back to VS Code workspace state
    if (!layout) {
      const cached = this.context.workspaceState.get<LayoutData>(WORKSPACE_KEY_LAYOUT);
      if (cached && isValidLayout(cached)) {
        layout = cached;
      }
    }

    // Fall back to bundled default
    if (!layout) {
      layout = loadDefaultLayout(this.context.extensionPath);
    }

    // Last resort: create minimal empty layout
    if (!layout) {
      layout = createMinimalLayout();
    }

    // Ensure tileColors is populated — layouts from older versions or
    // external sources may omit it, causing the renderer to skip all tiles.
    if (revision === null) {ensureTileColors(layout);}

    // Always send layoutLoaded message
    this.postMessage({ type: 'layoutLoaded', layout, revision, workspaceRoot });
    if (revision !== null && !parseLayoutJson(revision)) {
      this.postMessage({ type: 'layoutError', error: 'Saved layout is malformed. The file was not overwritten; recover it before saving.' });
    }
  }

  private onSaveLayout(layout: LayoutData, expectedRevision: string | null | undefined, originalRoot: string | null | undefined): void {
    try {
      const workspaceRoot = this.getWorkspaceRoot();
      if (!workspaceRoot) {throw new Error('Open the original workspace before saving.');}
      if (originalRoot !== workspaceRoot) {throw new Error('Workspace changed. Export recovery copies and reopen the original workspace before saving.');}
      if (expectedRevision === undefined) {throw new Error('Missing layout revision. Reload the panel before saving.');}
      const result = saveLayoutIfUnchanged(workspaceRoot, layout, expectedRevision);
      if (!result.saved) {
        if (result.layout) {
          this.postMessage({ type: 'layoutLoaded', layout: result.layout, revision: result.revision, workspaceRoot });
        }
        throw new Error(result.layout
          ? 'Saved layout changed in another window. Both versions were kept; resolve the incoming snapshot before retrying Save.'
          : 'Saved layout was deleted or became malformed. The draft was kept; restore the file and reload before saving.');
      }
      void this.context.workspaceState.update(WORKSPACE_KEY_LAYOUT, layout).then(undefined, (error: unknown) => {
        this.postMessage({ type: 'layoutError', error: `Layout saved on disk but workspace cache failed: ${String(error)}` });
      });
      this.postMessage({ type: 'layoutSaved', layout, revision: result.revision });
    } catch (error) {
      this.postMessage({ type: 'layoutError', error: `Squad Pod: ${String(error)}` });
    }
  }

  private async onExportLayout(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    let layout: LayoutData | null = null;

    if (workspaceRoot) {
      layout = readPersistedLayout(workspaceRoot);
    }
    if (!layout) {
      layout = loadDefaultLayout(this.context.extensionPath);
    }
    if (!layout) {
      vscode.window.showWarningMessage('Squad Pod: No layout to export.');
      return;
    }

    const success = await exportLayoutToFile(layout, vscode);
    if (success) {
      vscode.window.showInformationMessage('Squad Pod: Layout exported.');
    }
  }

  private async onImportLayout(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    const layout = await importLayoutFromFile(vscode);
    if (!layout) {return;}
    if (!workspaceRoot || workspaceRoot !== this.getWorkspaceRoot()) {
      this.postMessage({ type: 'layoutError', error: 'Workspace changed during import. The source file and draft were not changed; import again in the intended workspace.' });
      return;
    }

    // Stage only. A dirty webview must retain both versions before any disk write.
    this.postMessage({ type: 'layoutLoaded', layout, source: 'import', workspaceRoot });
  }

  // ─── Agent Actions ────────────────────────────────────────────

  private onFocusAgent(agentId: string | undefined): void {
    this.openAgentFile(agentId, ['history.md', 'charter.md']);
  }

  private onOpenSquadAgent(agentId: string | undefined): void {
    this.openAgentFile(agentId, ['charter.md', 'history.md']);
  }

  private openAgentFile(agentId: string | undefined, candidates: string[]): void {
    if (!agentId) {return;}
    const workspaceRoot = this.getWorkspaceRoot();
    const agent = agentId ? getAgents().get(agentId) : undefined;
    if (!workspaceRoot || !agent) {return;}

    const agentDir = path.join(resolveSquadDir(workspaceRoot), 'agents', agent.id);
    const target = candidates.map(f => path.join(agentDir, f)).find(f => fs.existsSync(f));
    if (target) {
      void vscode.window.showTextDocument(vscode.Uri.file(target), { preview: true });
    } else if (fs.existsSync(agentDir)) {
      void vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(agentDir));
    } else {
      void vscode.window.showInformationMessage(`Squad Pod: ${agent.name} has no charter or history yet.`);
    }
  }

  private onRequestAgentDetail(agentId: string | undefined): void {
    if (!agentId) {return;}

    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {return;}

    const detail = getAgentDetail(workspaceRoot, agentId);
    if (detail) {
      this.postMessage({ type: 'agentDetailLoaded', detail });
    }
  }

  private onOpenSquadInfo(): void {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {
      this.postMessage({
        type: 'squadInfoLoaded',
        info: {
          teamName: null,
          description: null,
          members: [],
          hiddenMembers: [],
          projectContext: null,
          totalAgents: 0,
          activeAgents: 0,
        },
      });
      return;
    }

    const content = readTeamFile(workspaceRoot);
    const agents = getAgents();

    if (!content) {
      this.postMessage({
        type: 'squadInfoLoaded',
        info: {
          teamName: null,
          description: 'No .squad/team.md found. Run `squad init` or open a Squad-configured project.',
          members: [],
          hiddenMembers: [],
          projectContext: null,
          totalAgents: agents.size,
          activeAgents: [...agents.values()].filter(a => a.status === 'active').length,
        },
      });
      return;
    }

    const teamName = parseTeamName(content);
    const projectContext = parseProjectContext(content);
    const allMembers = parseAllMembers(content);

    const isHidden = (m: { role: string; status: string; name: string }) => {
      const lr = m.role.toLowerCase();
      const ls = m.status.toLowerCase();
      const ln = m.name.toLowerCase();
      return lr.includes('scribe') || ls.includes('silent') ||
        (ln === 'ralph' && lr.includes('monitor'));
    };

    const visible = allMembers.filter(m => !isHidden(m));
    const hidden = allMembers.filter(m => isHidden(m));

    const members = visible.map(m => {
      const agent = agents.get(m.slug);
      return {
        name: m.name,
        role: m.role,
        status: m.status,
        isActive: agent?.status === 'active',
        currentTask: agent?.currentTask ?? null,
      };
    });

    const hiddenMembers = hidden.map(m => ({
      name: m.name,
      role: m.role,
      status: m.status,
    }));

    const info: SquadInfoData = {
      teamName,
      description: projectContext,
      members,
      hiddenMembers,
      projectContext,
      totalAgents: agents.size,
      activeAgents: [...agents.values()].filter(a => a.status === 'active').length,
    };

    this.postMessage({ type: 'squadInfoLoaded', info });
  }

  // ─── Default Layout Export (command) ──────────────────────────

  async exportDefaultLayout(): Promise<void> {
    const layout = loadDefaultLayout(this.context.extensionPath);
    if (!layout) {
      vscode.window.showWarningMessage('Squad Pod: No default layout found in extension assets.');
      return;
    }

    const success = await exportLayoutToFile(layout, vscode);
    if (success) {
      vscode.window.showInformationMessage('Squad Pod: Default layout exported.');
    }
  }

  // ─── Webview HTML ─────────────────────────────────────────────

  private getWebviewHtml(webview: vscode.Webview): string {
    const distUri = vscode.Uri.file(path.join(this.context.extensionPath, 'dist', 'webview'));

    // Resolve the webview entry point
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'index.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'index.css'),
    );

    // Cache-busting: append timestamp to force fresh load on every panel create
    const cacheBuster = Date.now();
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    img-src ${webview.cspSource} data:;
    font-src ${webview.cspSource};
    connect-src ${webview.cspSource};
  " />
  <link rel="stylesheet" href="${styleUri}?v=${cacheBuster}" />
  <title>Squad Pod</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}?v=${cacheBuster}"></script>
</body>
</html>`;
  }

  // ─── Utilities ────────────────────────────────────────────────

  private getWorkspaceRoot(): string | undefined {
    return pickSquadWorkspace((vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath));
  }

  private getWorkspaceDirectoryIds(workspaceRoot: string): string[] {
    const workspaceDirectories = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      id: `workspace:${folder.uri.toString()}`,
      path: folder.uri.fsPath,
    }));
    return resolveDirectoryMappingIds(
      workspaceRoot,
      workspaceDirectories,
      readSavedDirectories(this.context.globalState),
    );
  }

  private postMessage(message: OutboundMessage): void {
    void this.view?.webview?.postMessage(message);
  }

  private emitTelemetry(
    category: TelemetryEvent['category'],
    agentId: string | null,
    agentName: string | null,
    summary: string,
    detail: string | null = null,
  ): void {
    this.postMessage({
      type: 'telemetryEvent',
      event: {
        id: `tel-${Date.now()}-${++this.telemetryCounter}`,
        timestamp: Date.now(),
        category,
        agentId,
        agentName,
        summary,
        detail,
      },
    });
  }

  // ─── Teardown ─────────────────────────────────────────────────

  private teardown(): void {
    this.assetWatcher?.dispose();
    this.assetWatcher = undefined;
    this.characterWatcher?.dispose();
    this.characterWatcher = undefined;
    this.stopWatching();

    const agents = getAgents();
    if (agents.size > 0) {
      persistAgentMeta(agents, this.context);
    }

    disposeAgentManager();
  }

  dispose(): void {
    this.teardown();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this.output?.dispose();
    this.output = undefined;
  }
}

function telemetryCategoryFor(source: ActivitySource): TelemetryEvent['category'] {
  switch (source) {
    case 'orchestration-log': return 'orchestration';
    case 'agent-files': return 'agent';
    case 'decision': return 'decision';
    default: return source;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function getAgentDetail(workspaceRoot: string, agentId: string): AgentDetailInfo | null {
  const agents = getAgents();
  const agent = agents.get(agentId);
  if (!agent) {
    return null;
  }

  // Read charter summary
  let charterSummary: string | null = null;
  const squadDir = resolveSquadDir(workspaceRoot);
  const charterPath = path.join(squadDir, 'agents', agentId, 'charter.md');
  try {
    const charterContent = fs.readFileSync(charterPath, 'utf8');
    const lines = charterContent.split('\n');
    
    // Skip title line (first # heading), find first paragraph
    let foundHeading = false;
    const paragraphLines: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (!foundHeading && trimmed.startsWith('#')) {
        foundHeading = true;
        continue;
      }
      
      if (foundHeading && trimmed.length > 0) {
        paragraphLines.push(trimmed);
        // Collect lines until we have enough content
        if (paragraphLines.join(' ').length > 100) {
          break;
        }
      }
    }
    
    if (paragraphLines.length > 0) {
      const paragraph = paragraphLines.join(' ');
      // Take first 2-3 sentences
      const sentences = paragraph.split(/\.\s+/);
      charterSummary = sentences.slice(0, 3).join('. ');
      if (!charterSummary.endsWith('.')) {
        charterSummary += '.';
      }
    }
  } catch {
    // Charter doesn't exist or can't be read
    charterSummary = null;
  }

  // Scan log directory for recent activity
  const recentActivity: string[] = [];
  const logFiles: { name: string; path: string }[] = [];
  for (const dirName of ['orchestration-log', 'log']) {
    const dir = path.join(squadDir, dirName);
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.md')) {
          logFiles.push({ name: f, path: path.join(dir, f) });
        }
      }
    } catch {
      // Directory missing
    }
  }
  logFiles.sort((x, y) => y.name.localeCompare(x.name));
  try {
    for (const { name: logFile, path: logPath } of logFiles.slice(0, 40)) {
      try {
        const logContent = fs.readFileSync(logPath, 'utf8');
        const lowerContent = logContent.toLowerCase();
        const agentNameLower = agent.name.toLowerCase();
        const agentIdLower = agentId.toLowerCase();

        // Check if the log is this agent's (by filename) or mentions it
        if (logFile.toLowerCase().includes(agentIdLower) || lowerContent.includes(agentNameLower) || lowerContent.includes(agentIdLower)) {
          // Extract first meaningful line (not a heading)
          const lines = logContent.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0 && !trimmed.startsWith('#')) {
              recentActivity.push(trimmed.substring(0, 150));
              break;
            }
          }
          
          if (recentActivity.length >= 5) {
            break;
          }
        }
      } catch {
        // Skip this log file
        continue;
      }
    }
  } catch {
    // Log directory doesn't exist or can't be read
  }

  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    currentTask: agent.currentTask,
    charterSummary,
    recentActivity,
    lastActiveAt: agent.lastActiveAt,
  };
}
