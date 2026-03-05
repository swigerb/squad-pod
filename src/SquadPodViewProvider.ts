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
import type { LayoutData, WebviewMessage, OutboundMessage, AgentDetailInfo } from './types.js';
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
      },
      onAgentActivity: (event) => {
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
      layout = this.context.workspaceState.get<LayoutData>(WORKSPACE_KEY_LAYOUT) ?? null;
    }

    // Fall back to bundled default
    if (!layout) {
      layout = loadDefaultLayout(this.context.extensionPath);
    }

    if (layout) {
      this.postMessage({ type: 'layoutLoaded', layout });
    }
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
