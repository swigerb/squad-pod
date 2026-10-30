const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
require('tsx/cjs');
const { OfficeState } = require('../webview-ui/src/office/engine/officeState.ts');
const { reconcileAgents } = require('../webview-ui/src/office/engine/agentSync.ts');

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
    getConfiguration: () => ({ get: (_key, defaultValue) => defaultValue }),
    workspaceFolders: [],
    onDidChangeWorkspaceFolders: () => disposable,
  },
};

assert.ok(fs.existsSync(extensionBundle), 'production extension bundle must exist');
assert.ok(fs.existsSync(webviewScript), 'production webview bundle must exist');
assert.ok(fs.readFileSync(webviewScript, 'utf8').includes('pets-carousel'), 'production webview must include the Pets editor');

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-pet-acceptance-'));
const workspaceAliasContainer = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-alias-'));
const workspaceAlias = path.join(workspaceAliasContainer, 'selected-root');
fs.symlinkSync(workspaceRoot, workspaceAlias, 'junction');
const savedRoot = workspaceRoot;
const unrelatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-unrelated-'));
fs.mkdirSync(path.join(workspaceRoot, '.squad'), { recursive: true });
fs.writeFileSync(
  path.join(workspaceRoot, '.squad', 'team.md'),
  '## Members\n\n| Name | Role | Charter | Status |\n| --- | --- | --- | --- |\n' +
    '| Synthetic Fixture Agent | Dev | `.squad/agents/fixture-agent/charter.md` | ✅ Active |\n' +
    (usageAcceptance
      ? '| Ada | Developer | .squad/agents/ada/charter.md | Idle |\n| Shared | Dev | .squad/agents/first/charter.md | Idle |\n| Shared | Dev | .squad/agents/second/charter.md | Idle |\n'
      : ''),
);
vscode.workspace.workspaceFolders = [{ uri: uri(workspaceAlias), name: 'Selected fixture root' }];
const savedDirectory = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Synthetic alternate project',
  path: savedRoot,
};
const unrelatedDirectory = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Unrelated synthetic project',
  path: unrelatedRoot,
};
const recentLaunch = { ...savedDirectory, id: 'recent-launch-id', lastLaunchedAt: '2026-10-29T00:00:00.000Z' };
const expectedDirectoryId = `workspace:${vscode.workspace.workspaceFolders[0].uri.toString()}`;
const mappedLayout = {
  version: 2,
  cols: 9,
  rows: 3,
  tiles: Array(27).fill(1),
  furniture: [1, 3, 5, 7].flatMap((col, index) => [
    { uid: `desk-${index}`, type: 'desk', col, row: 0, rotation: 0 },
    { uid: index === 0 ? 'chair-saved' : index === 1 ? 'chair-workspace' : `chair-${index}`, type: 'chair', col, row: 1, rotation: 0 },
  ]),
  areas: [
    { label: 'Saved Area', color: '#112233' },
    { label: 'Workspace Area', color: '#223344' },
  ],
  areaTiles: Array(27).fill(null).map((value, index) =>
    index === 10 ? 'Saved Area' : index === 12 ? 'Workspace Area' : value),
  areaMappings: {
    [savedDirectory.id]: ['Saved Area'],
    [expectedDirectoryId]: ['Workspace Area'],
  },
};
const storageValues = new Map([
  ['squad-pod.directories', [savedDirectory, unrelatedDirectory]],
  ['squad-pod.directoryLaunchHistory', [recentLaunch]],
  ['squad-pod.layout', mappedLayout],
]);
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
  const observedRoster = messages.find((message) => message.type === 'existingAgents');
  const fixtureAgent = observedRoster.agents.find((agent) => agent.id === 'fixture-agent');
  assert.ok(fixtureAgent, 'compiled provider must attach the selected real synthetic roster');
  assert.deepEqual(Object.keys(fixtureAgent).sort(), [
    'currentTask', 'directoryId', 'directoryMappingIds', 'id', 'name',
    'paletteIndex', 'role', 'seatId', 'status',
  ], 'compiled provider snapshot must keep the complete roster/activity payload shape');
  assert.equal(fixtureAgent.status, 'idle', 'new roster members start idle');
  assert.equal(fixtureAgent.currentTask, null, 'historical usage is not a current task');
  assert.equal(fixtureAgent.directoryId, expectedDirectoryId, 'workspace URI identity remains the primary stable ID');
  assert.deepEqual(fixtureAgent.directoryMappingIds, [expectedDirectoryId, savedDirectory.id],
    'canonical saved-path alias contributes a durable mapping ID after the workspace ID');
  const directoryCatalog = messages.find((message) => message.type === 'directoryCatalog')?.catalog;
  assert.ok(directoryCatalog?.workspaceDirectories.some((entry) => entry.id === expectedDirectoryId));
  assert.ok(directoryCatalog?.savedDirectories.some((entry) => entry.id === savedDirectory.id));
  assert.ok(directoryCatalog?.savedDirectories.some((entry) => entry.id === unrelatedDirectory.id));
  assert.ok(directoryCatalog?.recentLaunches.some((entry) => entry.id === recentLaunch.id));
  assert.equal(fixtureAgent.directoryMappingIds.includes(unrelatedDirectory.id), false,
    'unrelated saved paths are not aliases of the selected root');
  assert.equal(fixtureAgent.directoryMappingIds.includes(recentLaunch.id), false,
    'recent launch IDs are never mapping identities');

  const allocateSeat = (layout) => {
    const office = new OfficeState(layout);
    reconcileAgents(office, [fixtureAgent]);
    return office.characters.get(fixtureAgent.id)?.seatId;
  };
  assert.equal(allocateSeat(layoutMessage.layout), 'chair-saved',
    'compiled-provider roster identity must reach the real engine and honor the saved-directory Area mapping');
  const workspaceOnlyLayout = {
    ...layoutMessage.layout,
    areaMappings: { [expectedDirectoryId]: ['Workspace Area'] },
  };
  assert.equal(allocateSeat(workspaceOnlyLayout), 'chair-workspace',
    'workspace-ID mappings remain compatible when no saved-ID mapping applies');
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
      ['settingsLoaded', 'sourceStatus', 'recordedUsage', 'characterSpritesLoaded', 'manifestAssetsLoaded', 'layoutLoaded', 'existingAgents', 'squadRosterLoaded', 'directoryCatalog'].includes(message.type),
    ).map((message) => {
      if (message.type !== 'layoutLoaded') return message;
      const layout = { ...message.layout };
      delete layout.areas;
      delete layout.areaTiles;
      delete layout.areaMappings;
      return { ...message, layout };
    });
    const fixtures = JSON.stringify(hostMessages).replace(/</g, '\\u003c');
    let html = webview.html;
    const nonce = html.match(/<script nonce="([^"]+)"/)?.[1];
    assert.ok(nonce, 'provider HTML must nonce-gate its scripts');
    const bridge = `
      window.__petAcceptance = { outbound: [], fixtures: ${fixtures}, replayed: false, acquireCount: 0, state: undefined };
      window.__sendHost = (data) => window.dispatchEvent(new MessageEvent('message', { data }));
      window.acquireVsCodeApi = () => {
        window.__petAcceptance.acquireCount++;
        return {
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
        getState: () => window.__petAcceptance.state,
        setState(value) {
          window.__petAcceptance.state = value;
          return value;
        },
      };
      };
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
    console.log('PASS compiled-provider artifact and provider-to-seat mapping smoke (mocked VS Code boundary; no native VS Code host or directory launch).');
  }
} finally {
  deactivate?.();
  Module._load = originalLoad;
  fs.rmSync(workspaceAliasContainer, { recursive: true, force: true });
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  fs.rmSync(unrelatedRoot, { recursive: true, force: true });
}
