const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');

const extensionPath = path.resolve(__dirname, '..');
const extensionBundle = path.join(extensionPath, 'dist', 'extension.js');
const webviewScript = path.join(extensionPath, 'dist', 'webview', 'assets', 'index.js');
const messages = [];
const serveBrowser = process.argv.includes('--serve');
let provider;
let receiveMessage;
let deactivate;
const disposable = { dispose() {} };
const uri = (fsPath) => ({ fsPath, toString: () => pathToFileURL(fsPath).toString() });
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
const savedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-directory-acceptance-'));
fs.mkdirSync(path.join(workspaceRoot, '.squad'), { recursive: true });
fs.writeFileSync(
  path.join(workspaceRoot, '.squad', 'team.md'),
  '## Members\n\n| Name | Role | Charter | Status |\n| --- | --- | --- | --- |\n| Synthetic Fixture Agent | Dev | `.squad/agents/fixture-agent/charter.md` | ✅ Active |\n',
);
vscode.workspace.workspaceFolders = [{ uri: uri(workspaceRoot), name: 'Selected fixture root' }];
const savedDirectory = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Synthetic alternate project',
  path: savedRoot,
};
const storageValues = new Map([['squad-pod.directories', [savedDirectory]]]);
const storage = {
  get: (key, fallback) => storageValues.has(key) ? storageValues.get(key) : fallback,
  update: async (key, value) => { storageValues.set(key, value); },
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
  receiveMessage({ type: 'getDirectories' });
  const assetSnapshot = messages.find((message) => message.type === 'manifestAssetsLoaded')?.snapshot;
  assert.ok(assetSnapshot, 'compiled provider must publish its production asset snapshot');
  assert.deepEqual(assetSnapshot.pets.map((pet) => pet.id).sort(), ['claudio', 'gitcat']);
  const layoutMessage = messages.find((message) => message.type === 'layoutLoaded');
  assert.ok(layoutMessage, 'compiled provider must deliver a layout through the host boundary');
  const expectedDirectoryId = `workspace:${vscode.workspace.workspaceFolders[0].uri.toString()}`;
  const observedRoster = messages.find((message) => message.type === 'existingAgents');
  assert.deepEqual(
    observedRoster.agents.map(({ id, directoryId }) => ({ id, directoryId })),
    [{ id: 'fixture-agent', directoryId: expectedDirectoryId }],
    'compiled provider must attach only the selected real roster and its stable workspace URI identity',
  );
  const directoryCatalog = messages.find((message) => message.type === 'directoryCatalog')?.catalog;
  assert.ok(directoryCatalog?.workspaceDirectories.some((entry) => entry.id === expectedDirectoryId));
  assert.ok(directoryCatalog?.savedDirectories.some((entry) => entry.id === savedDirectory.id));

  if (serveBrowser) {
    const port = 4173;
    const hostMessages = messages.filter((message) =>
    ['settingsLoaded', 'sourceStatus', 'characterSpritesLoaded', 'manifestAssetsLoaded', 'layoutLoaded', 'existingAgents', 'squadRosterLoaded', 'directoryCatalog'].includes(message.type),
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
  fs.rmSync(savedRoot, { recursive: true, force: true });
}
