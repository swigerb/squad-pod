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
import type { LayoutData, WebviewMessage, OutboundMessage, AgentDetailInfo, TelemetryEvent, SquadInfoData, CharacterAssetEntry, SourceStatus, PodSettings, DirectoryCatalog } from './types.js';
import {
  CUSTOM_CHAR_SPRITE_PREFIX,
  WORKSPACE_KEY_LAYOUT,
} from './constants.js';
import {
  initializeAgents,
  refreshAgents,
  updateAgentStatus,
  sendExistingAgents,
  persistAgentMeta,
  saveAgentSeats,
  getAgents,
  disposeAgentManager,
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
import { defaultFurniture } from './defaultFurniture.js';
import {
  asDirectoryEntry,
  createSavedDirectory,
  ensureUniqueDirectoryName,
  forgetDirectoryLaunch,
  readLaunchHistory,
  readSavedDirectories,
  recordDirectoryLaunch,
  sameDirectoryPath,
  validateDirectoryPath,
  writeSavedDirectories,
  type SavedDirectory,
} from './directories.js';
import { launchSquadInTerminal } from './directoryLaunch.js';

export class SquadPodViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private context: vscode.ExtensionContext;
  private disposeSquadWatcher: (() => void) | undefined;
  private disposeLayoutWatcher: { dispose: () => void } | undefined;
  private assetWatcher: { dispose: () => void } | undefined;
  private disposables: vscode.Disposable[] = [];
  private telemetryCounter = 0;
  private watchedRoot: string | undefined;
  private output: vscode.OutputChannel | undefined;
  private sourceStatus: SourceStatus = {
    workspaceRoot: null, squadDir: null, teamFound: false,
    observer: 'stopped', nativeWatch: false, error: null,
  };

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
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
  }

  // ─── Message Handling ──────────────────────────────────────────

  private handleWebviewMessage(message: WebviewMessage): void {
    switch (message.type) {
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
        this.sendDirectoryCatalog();
        break;

      case 'addDirectory':
        void this.addDirectory().catch((error: unknown) => this.directoryError(error));
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
      this.postMessage({ type: 'sourceStatus', status: this.sourceStatus });
      this.postMessage({ type: 'noWorkspace' });
      return;
    }

    // A reloaded webview only needs a fresh snapshot; keep agent state,
    // timers and watchers alive so in-flight activity is not lost.
    let agents = getAgents();
    if (this.watchedRoot !== workspaceRoot || !this.disposeSquadWatcher) {
      this.stopWatching();
      agents = initializeAgents(workspaceRoot, this.context, webview);
      this.startWatching(workspaceRoot, webview);
    }

    // Assets first, then layout, then the roster snapshot (the webview
    // buffers roster until layout arrives, so either order is safe).
    this.loadAndSendAssets();
    this.loadAndSendCustomAssetUris();
    this.loadAndSendLayout(workspaceRoot);
    sendExistingAgents(agents, this.context, webview);
    this.postMessage({ type: 'sourceStatus', status: this.sourceStatus });
  }

  private startWatching(workspaceRoot: string, webview: vscode.Webview): void {
    this.watchedRoot = workspaceRoot;
    this.disposeSquadWatcher = startSquadWatching(workspaceRoot, {
      onStatusChanged: (status) => {
        this.sourceStatus = status;
        this.postMessage({ type: 'sourceStatus', status });
        if (status.error) { this.log(status.error); }
      },
      onRosterChanged: () => {
        const updated = refreshAgents(workspaceRoot, this.context, webview);
        sendExistingAgents(updated, this.context, webview);
        this.emitTelemetry('log', null, null, 'Team roster updated');
      },
      onAgentActivity: (event) => {
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
    this.assetWatcher?.dispose();
    const root = path.join(this.context.extensionPath, 'dist', 'assets');
    this.assetWatcher = watchAssetSnapshots(
      () => loadAssetSnapshot(root, this.assetDirectories()),
      (snapshot) => {
        this.postMessage({ type: 'manifestAssetsLoaded', snapshot });
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
      squadHistoryAvailable: false,
    };
  }

  private sendDirectoryCatalog(): void {
    try {
      this.postMessage({ type: 'directoryCatalog', catalog: this.directoryCatalog() });
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

  private async addDirectory(): Promise<void> {
    const current = readSavedDirectories(this.context.globalState);
    if (current.length >= 100) { throw new Error('At most 100 saved directories are supported.'); }

    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Add launch directory',
    });
    if (!selection?.[0]) { return; }
    const directoryPath = validateDirectoryPath(selection[0].fsPath);
    if ((vscode.workspace.workspaceFolders ?? []).some((folder) => sameDirectoryPath(folder.uri.fsPath, directoryPath))) {
      this.directoryNotice('That folder is already listed under Workspace folders.');
      return;
    }
    if (current.some((entry) => sameDirectoryPath(entry.path, directoryPath))) {
      this.directoryNotice('That folder is already in Saved directories.');
      return;
    }

    const defaultName = path.basename(directoryPath) || directoryPath;
    const nameInput = await vscode.window.showInputBox({
      prompt: 'Name this launch directory',
      value: defaultName,
      validateInput: (value) => {
        try {
          ensureUniqueDirectoryName(value, current);
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    });
    if (nameInput === undefined) { return; }
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
    const directories = readSavedDirectories(this.context.globalState);
    const directory = this.savedDirectory(id, directories);
    const selection = await vscode.window.showOpenDialog({
      defaultUri: vscode.Uri.file(directory.path),
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Change launch directory',
    });
    if (!selection?.[0]) { return; }
    const directoryPath = validateDirectoryPath(selection[0].fsPath);
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
  private pngToDataUri(filePath: string): string {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 8) {
      throw new Error(`PNG file is too small to be valid: ${filePath}`);
    }
    const pngSignature = [0x89, 0x50, 0x4E, 0x47];
    const hasPngSignature = pngSignature.every((byte, index) => buf[index] === byte);
    if (!hasPngSignature) {
      throw new Error(`File is not a valid PNG: ${filePath}`);
    }
    return `data:image/png;base64,${buf.toString('base64')}`;
  }

  private loadAndSendCustomAssetUris(): void {
    const webview = this.view?.webview;
    if (!webview) { return; }

    const assetsDir = path.join(this.context.extensionPath, 'dist', 'assets');
    console.log('[SquadPod] loadAndSendCustomAssetUris — assetsDir:', assetsDir);

    // ── Custom character sprite sheets (char_employeeA–E.png) ────────
    const charsDir = path.join(assetsDir, 'characters');
    if (fs.existsSync(charsDir)) {
      const customCharFiles = fs.readdirSync(charsDir)
        .filter(f => f.startsWith(CUSTOM_CHAR_SPRITE_PREFIX) && f.endsWith('.png'))
        .sort();

      if (customCharFiles.length > 0) {
        const characters: CharacterAssetEntry[] = [];
        for (const file of customCharFiles) {
          const filePath = path.join(charsDir, file);
          try {
            const uri = this.pngToDataUri(filePath);
            characters.push({
              id: path.basename(file, '.png'),
              uri,
            });
            console.log('[SquadPod] Prepared character asset', file, '(' + Math.round(uri.length / 1024) + ' KB)');
          } catch (e) {
            console.error('[SquadPod] ❌ Failed to convert character PNG to data URI:', filePath, e);
          }
        }

        console.log('[SquadPod] Sending characterAssetsLoaded with', characters.length, 'sheets:', characters.map(c => c.id + ' (' + Math.round(c.uri.length / 1024) + ' KB)').join(', '));
        if (characters.length > 0) {
          this.postMessage({ type: 'characterAssetsLoaded', characters });
        } else {
          console.warn('[SquadPod] characterAssetsLoaded skipped because no PNGs converted successfully');
        }
      } else {
        console.warn('[SquadPod] No custom character PNGs found in:', charsDir);
      }
    } else {
      console.warn('[SquadPod] characters/ dir not found at:', charsDir);
    }
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

/**
 * Ensure a layout has tileColors populated. Layouts from older versions,
 * external tools, or the layout editor may omit tileColors entirely.
 * Without tileColors, renderTileGrid skips every tile → blank blue screen.
 */
function ensureTileColors(layout: LayoutData): void {
  if (layout.tileColors && Object.keys(layout.tileColors).length > 0) { return; }

  // Warm tan for floors, dark brown for walls — clearly distinct
  // from the dark blue webview background (#1a1a2e).
  const floorColor = { h: 35, s: 40, b: 15, c: 0 };
  const wallColor  = { h: 20, s: 30, b: -25, c: 0 };
  const colors: Record<string, { h: number; s: number; b: number; c: number }> = {};

  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      const index = r * layout.cols + c;
      const tile = layout.tiles[index];
      colors[`${c},${r}`] = tile === 0 ? { ...wallColor } : { ...floorColor };
    }
  }

  layout.tileColors = colors;
}

/**
 * Create a minimal empty layout when no layout source is available.
 * This ensures the webview can always render, even without assets.
 * Format matches the webview's OfficeLayout type.
 */
function createMinimalLayout(): LayoutData {
  const cols = 20;
  const rows = 15;
  const tiles: number[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
        tiles.push(0); // WALL
      } else {
        tiles.push(1); // FLOOR_1
      }
    }
  }

  const furniture = defaultFurniture();

  // Populate tileColors so the renderer draws every tile.
  // Use warm tan/beige for floors (clearly distinct from the dark blue
  // body background #1a1a2e) and dark brown for walls.
  const floorColor = { h: 35, s: 40, b: 15, c: 0 };
  const wallColor  = { h: 20, s: 30, b: -25, c: 0 };
  const tileColors: Record<string, { h: number; s: number; b: number; c: number }> = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isWall = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
      tileColors[`${c},${r}`] = isWall ? { ...wallColor } : { ...floorColor };
    }
  }

  return {
    version: 2,
    cols,
    rows,
    tiles,
    furniture,
    tileColors,
  };
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
