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
import type { LayoutData, WebviewMessage, OutboundMessage, AgentDetailInfo, TelemetryEvent } from './types.js';
import {
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
import { startSquadWatching } from './squadWatcher.js';
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

export class SquadPodViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private context: vscode.ExtensionContext;
  private disposeSquadWatcher: (() => void) | undefined;
  private disposeLayoutWatcher: { dispose: () => void } | undefined;
  private disposables: vscode.Disposable[] = [];
  private telemetryCounter = 0;

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
        this.context.globalState.update(
          GLOBAL_KEY_SOUND_ENABLED,
          message.enabled ?? false,
        );
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
    if (!workspaceRoot) {
      this.postMessage({ type: 'noWorkspace' });
      return;
    }

    // 1. Read team roster and initialize agents
    const agents = initializeAgents(workspaceRoot, this.context, webview);

    // 2. Start watching .squad/ for activity
    this.disposeSquadWatcher?.();
    this.disposeSquadWatcher = startSquadWatching(workspaceRoot, {
      onRosterChanged: () => {
        // Re-read roster, add/remove agents
        const updated = refreshAgents(workspaceRoot, this.context, webview);
        sendExistingAgents(updated, this.context, webview);
        this.emitTelemetry('log', null, null, 'Team roster updated');
      },
      onAgentActivity: (event) => {
        // Emit detailed telemetry for the raw file event
        const agents = getAgents();
        const agent = agents.get(event.agentId);
        const displayName = agent?.name ?? event.agentId;
        const sourceLabel = event.source === 'orchestration-log' ? 'orchestration' : event.source;
        this.emitTelemetry(
          sourceLabel as TelemetryEvent['category'],
          event.agentId,
          displayName,
          `[${event.source}] ${displayName} — ${event.task ?? 'activity detected'}`,
          event.task,
        );

        updateAgentStatus(event.agentId, event.status, event.task, webview);
      },
    });

    // 3. Load and send assets
    this.loadAndSendAssets();

    // 4. Load and send layout
    this.loadAndSendLayout(workspaceRoot);

    // 5. Send existing agents (full state dump)
    sendExistingAgents(agents, this.context, webview);

    // 6. Send sound setting
    const soundEnabled = this.context.globalState.get<boolean>(
      GLOBAL_KEY_SOUND_ENABLED,
      true,
    );
    this.postMessage({ type: 'soundEnabled', enabled: soundEnabled });

    // 7. Start watching layout file for external changes
    this.disposeLayoutWatcher?.dispose();
    this.disposeLayoutWatcher = watchLayoutFile(workspaceRoot, (layout) => {
      this.postMessage({ type: 'layoutLoaded', layout });
      this.context.workspaceState.update(WORKSPACE_KEY_LAYOUT, layout);
    });
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
    if (!agentId) {return;}
    const agents = getAgents();
    const agent = agents.get(agentId);
    if (!agent) {return;}

    // Show agent info in an information message
    const task = agent.currentTask ? ` — ${agent.currentTask}` : '';
    vscode.window.showInformationMessage(
      `${agent.name} (${agent.role}) [${agent.status}]${task}`,
    );
  }

  private onOpenSquadAgent(agentId: string | undefined): void {
    if (!agentId) {return;}

    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) {return;}

    const agents = getAgents();
    const agent = agents.get(agentId);
    if (!agent) {return;}

    // Open the agent's charter.md in the editor
    const charterPath = path.join(
      workspaceRoot,
      '.squad',
      'agents',
      agent.id,
      'charter.md',
    );

    const uri = vscode.Uri.file(charterPath);
    vscode.window.showTextDocument(uri, { preview: true }).then(
      () => {},
      () => {
        // Charter doesn't exist — try opening the agent directory
        const agentDir = path.join(workspaceRoot, '.squad', 'agents', agent.id);
        vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(agentDir));
      },
    );
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
    if (!workspaceRoot) {return;}

    const teamFile = path.join(workspaceRoot, '.squad', 'team.md');
    const uri = vscode.Uri.file(teamFile);
    vscode.window.showTextDocument(uri, { preview: true }).then(
      () => {},
      () => {
        // team.md doesn't exist — reveal the .squad directory
        const squadDir = path.join(workspaceRoot, '.squad');
        vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(squadDir)).then(
          () => {},
          () => {
            vscode.window.showInformationMessage(
              'No .squad/ directory found. Open a Squad-configured project to see team info.',
            );
          },
        );
      },
    );
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
  " />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Squad Pod</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  // ─── Utilities ────────────────────────────────────────────────

  private getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private postMessage(message: OutboundMessage): void {
    this.view?.webview?.postMessage(message);
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
    this.disposeSquadWatcher?.();
    this.disposeSquadWatcher = undefined;

    this.disposeLayoutWatcher?.dispose();
    this.disposeLayoutWatcher = undefined;

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
  if (!layout || typeof layout !== 'object') return false;
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
  if (layout.tileColors && Object.keys(layout.tileColors).length > 0) return;

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
  const charterPath = path.join(workspaceRoot, '.squad', 'agents', agentId, 'charter.md');
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
  const logDir = path.join(workspaceRoot, '.squad', 'log');
  try {
    const logFiles = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, 5);

    for (const logFile of logFiles) {
      const logPath = path.join(logDir, logFile);
      try {
        const logContent = fs.readFileSync(logPath, 'utf8');
        const lowerContent = logContent.toLowerCase();
        const agentNameLower = agent.name.toLowerCase();
        const agentIdLower = agentId.toLowerCase();
        
        // Check if log mentions this agent
        if (lowerContent.includes(agentNameLower) || lowerContent.includes(agentIdLower)) {
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
