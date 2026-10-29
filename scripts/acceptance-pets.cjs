const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const extensionPath = path.resolve(__dirname, '..');
const extensionBundle = path.join(extensionPath, 'dist', 'extension.js');
const webviewScript = path.join(extensionPath, 'dist', 'webview', 'assets', 'index.js');
const messages = [];
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
  '## Members\n\n| Name | Role | Charter |\n| --- | --- | --- |\n',
);
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
    cspSource: 'vscode-webview-resource:',
    options: undefined,
    html: '',
    asWebviewUri: (resource) => `https://webview.test/${path.relative(extensionPath, resource.fsPath).replaceAll(path.sep, '/')}`,
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

  console.log('PASS production webview + compiled provider smoke acceptance (mocked VS Code boundary; not a native VS Code host).');
} finally {
  deactivate?.();
  Module._load = originalLoad;
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}
