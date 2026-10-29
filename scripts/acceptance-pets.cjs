const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const extensionPath = path.resolve(__dirname, '..');
const extensionBundle = path.join(extensionPath, 'dist', 'extension.js');
const webviewScript = path.join(extensionPath, 'dist', 'webview', 'assets', 'index.js');
const messages = [];
const serveBrowser = process.argv.includes('--serve');
const usageAcceptance = process.argv.includes('--usage');
let provider;
let receiveMessage;
let deactivate;
const disposable = { dispose() {} };
const uri = (fsPath) => ({ fsPath });
const vscode = {
  Uri: {
    file: (fsPath) => uri(fsPath),
    joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)),
  },
  window: {
    registerWebviewViewProvider: (_viewId, value) => { provider = value; return disposable; },
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
  },
  commands: {
    registerCommand: () => disposable,
    executeCommand() {},
  },
  workspace: {
    workspaceFolders: [],
    onDidChangeWorkspaceFolders: () => disposable,
  },
};

assert.ok(fs.existsSync(extensionBundle), 'production extension bundle must exist');
assert.ok(fs.existsSync(webviewScript), 'production webview bundle must exist');
assert.ok(fs.readFileSync(webviewScript, 'utf8').includes('pets-carousel'), 'production webview must include the Pets editor');

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-pet-acceptance-'));
fs.mkdirSync(path.join(workspaceRoot, '.squad'), { recursive: true });
fs.writeFileSync(
  path.join(workspaceRoot, '.squad', 'team.md'),
  '## Members\n\n| Name | Role | Charter |\n| --- | --- | --- |\n' + (usageAcceptance
    ? '| Ada | Developer | .squad/agents/ada/charter.md |\n| Shared | Dev | .squad/agents/first/charter.md |\n| Shared | Dev | .squad/agents/second/charter.md |\n' : ''),
);
if (usageAcceptance) {
  const timestamp = '2026-10-28T15:00:00Z';
  const report = {
    version: 1, kind: 'usage', sessionId: 'historical-session', turnId: 'turn-1',
    agentName: 'Ada', model: 'recorded-model-a', inputTokens: 1200, outputTokens: 300,
    estimatedCost: 0.04, timestamp,
  };
  fs.mkdirSync(path.join(workspaceRoot, '.squad', 'log'));
  fs.writeFileSync(path.join(workspaceRoot, '.squad', 'log', 'usage.jsonl'), [
    { version: 1, kind: 'turn-start', sessionId: report.sessionId, turnId: 'turn-1', timestamp },
    { version: 1, kind: 'turn-start', sessionId: report.sessionId, turnId: 'turn-2', timestamp },
    report,
    { ...report, agentName: 'Not on roster', turnId: undefined, model: 'unknown', inputTokens: 0, outputTokens: 0 },
    { ...report, agentName: 'Shared', turnId: undefined, model: 'recorded-model-b', inputTokens: 200, outputTokens: 100 },
    { ...report, inputTokens: -1 }, { ...report, version: 2 },
  ].map(record => JSON.stringify(record)).join('\n') + '\n{"version":1');
}
vscode.workspace.workspaceFolders = [{ uri: uri(workspaceRoot) }];
const storage = {
  get: (_key, fallback) => fallback,
  update: async () => {},
};
const context = {
  subscriptions: [],
  extensionPath,
  globalState: storage,
  workspaceState: storage,
};

const originalLoad = Module._load;
try {
  Module._load = function (request, parent, isMain) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  const extension = require(extensionBundle);
  deactivate = extension.deactivate;
  extension.activate(context);
  assert.ok(provider, 'compiled extension must register the webview provider');

  const webview = {
    cspSource: 'http://127.0.0.1:4173',
    options: undefined,
    html: '',
    asWebviewUri: (resource) => `http://127.0.0.1:4173/${path.relative(extensionPath, resource.fsPath).replaceAll(path.sep, '/')}`,
    onDidReceiveMessage: (listener) => { receiveMessage = listener; return disposable; },
    postMessage: (message) => { messages.push(message); return Promise.resolve(true); },
  };
  provider.resolveWebviewView(
    { webview, onDidDispose: () => disposable },
    {},
    {},
  );
  assert.equal(webview.options.enableScripts, true);
  assert.match(webview.html, /dist\/webview\/assets\/index\.js/);
  assert.match(webview.html, /Content-Security-Policy/);
  assert.equal(typeof receiveMessage, 'function');

  receiveMessage({ type: 'webviewReady' });
  const assetSnapshot = messages.find((message) => message.type === 'manifestAssetsLoaded')?.snapshot;
  assert.ok(assetSnapshot, 'compiled provider must publish its production asset snapshot');
  assert.deepEqual(assetSnapshot.pets.map((pet) => pet.id).sort(), ['claudio', 'gitcat']);
  const layoutMessage = messages.find((message) => message.type === 'layoutLoaded');
  assert.ok(layoutMessage, 'compiled provider must deliver a layout through the host boundary');
  if (usageAcceptance) {
    const snapshot = messages.find(message => message.type === 'recordedUsage')?.snapshot;
    assert.ok(snapshot, 'compiled provider must publish recorded usage');
    assert.equal(snapshot.state, 'partial');
    assert.deepEqual(snapshot.totals, { inputTokens: 1400, outputTokens: 400, estimatedCost: 0.12 });
    assert.equal(snapshot.coveredTurns, 1);
    assert.equal(snapshot.attemptedTurns, 2);
    assert.equal(snapshot.invalidLines, 1);
    assert.equal(snapshot.unsupportedLines, 1);
    assert.equal(snapshot.pendingFinalLine, true);
    assert.deepEqual(snapshot.history.map(entry => entry.attribution), ['roster-match', 'unattributed', 'ambiguous']);
    assert.equal(messages.some(message => ['agentStatus', 'agentToolStart', 'agentToolDone', 'telemetryEvent', 'agentCreated'].includes(message.type)), false,
      'historical ledger bootstrap must not emit activity');
  }

  if (serveBrowser) {
    const port = 4173;
    const hostMessages = messages.filter((message) =>
      ['settingsLoaded', 'sourceStatus', 'recordedUsage', 'characterSpritesLoaded', 'manifestAssetsLoaded', 'layoutLoaded', 'existingAgents', 'squadRosterLoaded'].includes(message.type),
    );
    const fixtures = JSON.stringify(hostMessages).replace(/</g, '\\u003c');
    let html = webview.html;
    const nonce = html.match(/<script nonce="([^"]+)"/)?.[1];
    assert.ok(nonce, 'provider HTML must nonce-gate its scripts');
    const bridge = `
      window.__petAcceptance = { outbound: [], fixtures: ${fixtures}, replayed: false };
      window.__sendHost = (data) => window.dispatchEvent(new MessageEvent('message', { data }));
      window.acquireVsCodeApi = () => ({
        postMessage(message) {
          window.__petAcceptance.outbound.push(message);
          if (message.type === 'webviewReady' && !window.__petAcceptance.replayed) {
            window.__petAcceptance.replayed = true;
            setTimeout(() => window.__petAcceptance.fixtures.forEach(window.__sendHost), 100);
          }
          if (message.type === 'saveLayout') {
            setTimeout(() => window.__sendHost({
              type: 'layoutSaved', layout: message.layout,
              revision: 'browser-ack-' + Date.now(),
            }), 25);
          }
        },
        getState: () => undefined,
        setState: (value) => value,
      });
      Math.random = () => 0;
    `;
    html = html.replace('</head>', `<script nonce="${nonce}">${bridge}</script></head>`);
    const webRoot = path.join(extensionPath, 'dist', 'webview');
    const server = http.createServer((request, response) => {
      const requestPath = new URL(request.url, `http://${request.headers.host}`).pathname;
      if (requestPath === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(html);
        return;
      }
      const relative = decodeURIComponent(requestPath).replace(/^\/dist\/webview\//, '');
      const file = path.resolve(webRoot, relative);
      if (!file.startsWith(`${webRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404);
        response.end();
        return;
      }
      const type = file.endsWith('.js') ? 'text/javascript'
        : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
      response.writeHead(200, { 'content-type': type });
      fs.createReadStream(file).pipe(response);
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`Production pet browser fixture at http://127.0.0.1:${port}/ (mocked VS Code boundary; Ctrl+C to stop).`);
    });
  } else {
    console.log('PASS compiled-provider artifact smoke (mocked VS Code boundary; does not execute webview UI or a native VS Code host).');
  }
} finally {
  deactivate?.();
  Module._load = originalLoad;
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}
