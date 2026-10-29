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
import type { LayoutData, WebviewMessage, OutboundMessage, AgentDetailInfo, TelemetryEvent, SquadInfoData, TilesetData, TilesetMetadata, CharacterAssetEntry } from './types.js';
import {
  CUSTOM_CHAR_SPRITE_PREFIX,
  GLOBAL_KEY_SOUND_ENABLED,
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
  loadFurnitureAssets,
  loadFloorTiles,
  loadWallTiles,
  loadCharacterSprites,
  loadDefaultLayout,
} from './assetLoader.js';
import {
  readPersistedLayout,
  writePersistedLayout,
  watchLayoutFile,
  exportLayoutToFile,
  importLayoutFromFile,
} from './layoutPersistence.js';
import {
  readTeamFile,
  parseTeamName,
  parseProjectContext,
  parseAllMembers,
} from './teamParser.js';

export class SquadPodViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private context: vscode.ExtensionContext;
  private disposeSquadWatcher: (() => void) | undefined;
  private disposeLayoutWatcher: { dispose: () => void } | undefined;
  private disposables: vscode.Disposable[] = [];
  private telemetryCounter = 0;
  private watchedRoot: string | undefined;
  private output: vscode.OutputChannel | undefined;

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

      case 'saveAgentSeats':
        if (message.seats && typeof message.seats === 'object') {
          saveAgentSeats(
            message.seats as Record<string, string>,
            this.context,
          );
        }
        break;

      case 'saveLayout':
        this.onSaveLayout(message.layout as LayoutData | undefined);
        break;

      case 'setSoundEnabled':
        void this.context.globalState.update(
          GLOBAL_KEY_SOUND_ENABLED,
          message.enabled ?? false,
        );
        break;

      case 'getSettings':
        this.postMessage({ type: 'settingsLoaded', soundEnabled: this.isSoundEnabled() });
        break;

      case 'focusAgent':
        this.onFocusAgent(message.agentId as string | undefined);
        break;

      case 'openSquadAgent':
        this.onOpenSquadAgent(message.agentId as string | undefined);
        break;

      case 'exportLayout':
        this.onExportLayout();
        break;

      case 'importLayout':
        this.onImportLayout();
        break;

      case 'requestAgentDetail':
        this.onRequestAgentDetail(message.agentId as string | undefined);
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
    this.log(`webviewReady; workspaceRoot=${workspaceRoot ?? '<none>'}`);
    if (!workspaceRoot) {
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
    this.postMessage({ type: 'soundEnabled', enabled: this.isSoundEnabled() });
  }

  private startWatching(workspaceRoot: string, webview: vscode.Webview): void {
    this.watchedRoot = workspaceRoot;
    this.disposeSquadWatcher = startSquadWatching(workspaceRoot, {
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

    this.disposeLayoutWatcher = watchLayoutFile(workspaceRoot, (layout) => {
      this.postMessage({ type: 'layoutLoaded', layout });
      void this.context.workspaceState.update(WORKSPACE_KEY_LAYOUT, layout);
    });
  }

  private stopWatching(): void {
    this.disposeSquadWatcher?.();
    this.disposeSquadWatcher = undefined;
    this.disposeLayoutWatcher?.dispose();
    this.disposeLayoutWatcher = undefined;
    this.watchedRoot = undefined;
  }

  private isSoundEnabled(): boolean {
    return this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
  }

  // ─── Diagnostics ─────────────────────────────────────────────────

  private log(line: string): void {
    this.output ??= vscode.window.createOutputChannel('Squad Pod');
    this.output.appendLine(`[${new Date().toISOString()}] ${line}`);
  }

  private onDiagnosticReport(message: WebviewMessage): void {
    const report = message as WebviewMessage & {
      characterSheetsSize?: number;
      characterSheetKeys?: string[];
      bootstrapRan?: boolean;
      errors?: string[];
    };
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

    // Floor tiles
    const floorTiles = loadFloorTiles(extPath);
    if (floorTiles.length > 0) {
      this.postMessage({ type: 'floorTilesLoaded', tiles: floorTiles });
    }

    // Wall tiles
    const wallTiles = loadWallTiles(extPath);
    if (wallTiles.length > 0) {
      this.postMessage({ type: 'wallTilesLoaded', tiles: wallTiles });
    }

    // Furniture
    const furniture = loadFurnitureAssets(extPath);
    if (furniture.length > 0) {
      this.postMessage({ type: 'furnitureLoaded', furniture });
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

    // ── Tileset metadata (rich format) with legacy fallback ──────────
    const tilesetPngPath = path.join(assetsDir, 'tileset_office.png');
    const metadataJsonPath = path.join(assetsDir, 'tileset-metadata.json');
    const legacyJsonPath = path.join(assetsDir, 'tileset.json');

    if (fs.existsSync(tilesetPngPath)) {
      let tilesetPngUri = '';
      try {
        tilesetPngUri = this.pngToDataUri(tilesetPngPath);
        console.log('[SquadPod] tileset_office.png → data URI (' + Math.round(tilesetPngUri.length / 1024) + ' KB)');
      } catch (e) {
        console.error('[SquadPod] ❌ Failed to convert tileset_office.png to data URI:', e);
      }

      if (tilesetPngUri) {
        // Send rich metadata when available (for metadata-based rendering)
        if (fs.existsSync(metadataJsonPath)) {
          try {
            const metadata: TilesetMetadata = JSON.parse(
              fs.readFileSync(metadataJsonPath, 'utf-8'),
            );
            console.log('[SquadPod] Sending tilesetMetadataLoaded with', metadata.items?.length, 'items');
            this.postMessage({ type: 'tilesetMetadataLoaded', tilesetPngUri, metadata });
          } catch (e) {
            console.error('[SquadPod] tileset-metadata.json parse error:', e);
          }
        } else {
          console.warn('[SquadPod] tileset-metadata.json not found at:', metadataJsonPath);
        }

        // Always send legacy tileset data (drawTilesetFurniture relies on
        // the tileset.json object names which differ from metadata item IDs)
        this.sendLegacyTilesetData(legacyJsonPath, tilesetPngUri);
      } else {
        console.error('[SquadPod] Skipping tileset asset messages because tileset_office.png could not be converted');
      }
    } else {
      console.error('[SquadPod] ❌ tileset_office.png NOT FOUND at:', tilesetPngPath);
    }

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

  /** Send legacy tilesetAssetsLoaded message from tileset.json (backward compat). */
  private sendLegacyTilesetData(jsonPath: string, tilesetPngUri: string): void {
    if (!fs.existsSync(jsonPath)) { return; }
    try {
      const tilesetData: TilesetData = JSON.parse(
        fs.readFileSync(jsonPath, 'utf-8'),
      );
      console.log('[SquadPod] Sending tilesetAssetsLoaded with', Object.keys(tilesetData.objects ?? {}).length, 'objects');
      this.postMessage({ type: 'tilesetAssetsLoaded', tilesetPngUri, tilesetData });
    } catch (e) {
      console.error('[SquadPod] ❌ Failed to parse tileset.json:', e);
    }
  }

  // ─── Layout ───────────────────────────────────────────────────

  private loadAndSendLayout(workspaceRoot: string): void {
    // Try workspace-persisted layout first
    let layout = readPersistedLayout(workspaceRoot);

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
    ensureTileColors(layout);

    // Always send layoutLoaded message
    this.postMessage({ type: 'layoutLoaded', layout });
  }

  private onSaveLayout(layout: LayoutData | undefined): void {
    if (!layout) {return;}

    const workspaceRoot = this.getWorkspaceRoot();
    if (workspaceRoot) {
      writePersistedLayout(workspaceRoot, layout);
    }
    this.context.workspaceState.update(WORKSPACE_KEY_LAYOUT, layout);
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
    const layout = await importLayoutFromFile(vscode);
    if (!layout) {return;}

    const workspaceRoot = this.getWorkspaceRoot();
    if (workspaceRoot) {
      writePersistedLayout(workspaceRoot, layout);
    }
    this.context.workspaceState.update(WORKSPACE_KEY_LAYOUT, layout);
    this.postMessage({ type: 'layoutLoaded', layout });
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
 * Runtime check that a layout object has the shape the webview expects.
 * Guards against stale cached layouts with the old rooms-based schema.
 * Version 2 required — older layouts used blue-gray floor colors that
 * were nearly invisible against the dark blue body background.
 */
function isValidLayout(layout: unknown): layout is LayoutData {
  if (!layout || typeof layout !== 'object') { return false; }
  const l = layout as Record<string, unknown>;
  return (
    typeof l.cols === 'number' &&
    typeof l.rows === 'number' &&
    Array.isArray(l.tiles) &&
    Array.isArray(l.furniture) &&
    typeof l.version === 'number' &&
    l.version >= 2
  );
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

  const furniture = [
    { uid: 'desk-1', type: 'desk', col: 4, row: 3, rotation: 0 },
    { uid: 'chair-1', type: 'chair', col: 4, row: 4, rotation: 0 },
    { uid: 'desk-2', type: 'desk', col: 10, row: 3, rotation: 0 },
    { uid: 'chair-2', type: 'chair', col: 10, row: 4, rotation: 0 },
    { uid: 'desk-3', type: 'desk', col: 4, row: 7, rotation: 0 },
    { uid: 'chair-3', type: 'chair', col: 4, row: 8, rotation: 0 },
    { uid: 'desk-4', type: 'desk', col: 10, row: 7, rotation: 0 },
    { uid: 'chair-4', type: 'chair', col: 10, row: 8, rotation: 0 },
  ];

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
