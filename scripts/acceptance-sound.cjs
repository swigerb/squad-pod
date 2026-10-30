const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const artifactRoot = path.resolve(option('--artifact-root') || repoRoot);
const extensionBundle = path.join(artifactRoot, 'dist', 'extension.js');
const webRoot = path.join(artifactRoot, 'dist', 'webview');
const webviewScript = path.join(webRoot, 'assets', 'index.js');
const evidencePath = option('--evidence');
const expectRegression = process.argv.includes('--expect-regression');
const edgePath = process.env.EDGE_PATH
  || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

function uri(fsPath) {
  return { fsPath, toString: () => pathToFileURL(fsPath).toString() };
}

function makeVscode(baseUrl) {
  const disposable = { dispose() {} };
  let provider;
  let receiveMessage;
  const messages = [];
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
  const storage = {
    get: (key, fallback) => key === 'squad-pod.soundEnabled' ? false : fallback,
    update: async () => {},
  };
  const context = {
    subscriptions: [],
    extensionPath: artifactRoot,
    globalState: storage,
    workspaceState: storage,
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  try {
    const extension = require(extensionBundle);
    extension.activate(context);
    assert.ok(provider, 'compiled provider must register the webview');
    const webview = {
      cspSource: baseUrl,
      options: undefined,
      html: '',
      asWebviewUri: (resource) => `${baseUrl}/${path.relative(artifactRoot, resource.fsPath).replaceAll(path.sep, '/')}`,
      onDidReceiveMessage: (listener) => { receiveMessage = listener; return disposable; },
      postMessage: (message) => { messages.push(message); return Promise.resolve(true); },
    };
    provider.resolveWebviewView(
      { webview, onDidDispose: () => disposable },
      {},
      {},
    );
    assert.equal(typeof receiveMessage, 'function');
    receiveMessage({ type: 'webviewReady' });
    assert.equal(messages[0]?.type, 'settingsLoaded', 'provider must send settings before its initial snapshots');
    return { extension, webview, messages };
  } finally {
    Module._load = originalLoad;
  }
}

function htmlWithFixture(providerHtml, messages) {
  const nonce = providerHtml.match(/<script nonce="([^"]+)"/)?.[1];
  assert.ok(nonce, 'provider HTML must nonce-gate its scripts');
  const fixtures = JSON.stringify(messages).replace(/</g, '\\u003c');
  const bridge = `
    window.__soundAcceptance = { outbound: [], fixtureStarted: false, fixtureDone: false };
    window.__sendHost = (data) => window.dispatchEvent(new MessageEvent('message', { data }));
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__soundAcceptance.outbound.push(message);
        if (message.type !== 'webviewReady' || window.__soundAcceptance.fixtureStarted) return;
        window.__soundAcceptance.fixtureStarted = true;
        setTimeout(() => {
          const send = window.__sendHost;
          const roster = [{
            id: 'synthetic-sound-agent', name: 'Synthetic Sound Agent',
            role: 'Developer', paletteIndex: 0, seatId: null,
            status: 'active', currentTask: null,
          }];
          // Synthetic pre-settings replay; provider startup sends settingsLoaded first.
          send({ type: 'existingAgents', agents: roster });
          send({ type: 'agentStatus', agentId: 'synthetic-sound-agent', status: 'idle' });
          send({
            type: 'layoutLoaded',
            layout: { version: 1, cols: 5, rows: 5, tiles: Array(25).fill(1), furniture: [] },
          });
          window.__soundAcceptance.preSettingsContextCount = window.__soundAudio.contexts.length;
          ${fixtures}.forEach(send);
          send({ type: 'existingAgents', agents: roster });
          send({ type: 'agentStatus', agentId: 'synthetic-sound-agent', status: 'waiting' });
          send({ type: 'agentStatus', agentId: 'synthetic-sound-agent', status: 'active' });
          send({ type: 'agentStatus', agentId: 'synthetic-sound-agent', status: 'idle' });
          window.__soundAcceptance.mutedReconnectContextCount = window.__soundAudio.contexts.length;
          window.__soundAcceptance.fixtureDone = true;
        }, 50);
      },
      getState: () => undefined,
      setState: (value) => value,
    });
  `;
  return providerHtml.replace('</head>', `<script nonce="${nonce}">${bridge}</script></head>`);
}

function audioStub() {
  return `
    window.__soundAudio = { contexts: [] };
    class RecordingParam {
      constructor() { this.events = []; }
      setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); }
      linearRampToValueAtTime(value, time) { this.events.push({ type: 'linear', value, time }); }
      exponentialRampToValueAtTime(value, time) { this.events.push({ type: 'exponential', value, time }); }
      cancelScheduledValues(time) { this.events.push({ type: 'cancel', time }); }
    }
    class RecordingAudioContext {
      constructor() {
        this.state = 'suspended';
        this.currentTime = 10;
        this.destination = {};
        this.resumeCalls = 0;
        this.oscillators = [];
        this.gains = [];
        window.__soundAudio.contexts.push(this);
      }
      createOscillator() {
        const oscillator = {
          frequency: { value: 0 }, type: 'sine', starts: [], stops: [],
          disconnected: false, onended: null,
          connect() {}, disconnect() { this.disconnected = true; },
          start(time) { this.starts.push(time); },
          stop(time) { this.stops.push(time); },
        };
        this.oscillators.push(oscillator);
        return oscillator;
      }
      createGain() {
        const gain = {
          gain: new RecordingParam(), disconnected: false,
          connect() {}, disconnect() { this.disconnected = true; },
        };
        this.gains.push(gain);
        return gain;
      }
      resume() {
        this.resumeCalls += 1;
        this.state = 'running';
        return Promise.resolve();
      }
    }
    window.AudioContext = RecordingAudioContext;
  `;
}

function staticServer(html) {
  return http.createServer((request, response) => {
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
      : file.endsWith('.css') ? 'text/css'
        : file.endsWith('.png') ? 'image/png'
          : 'application/octet-stream';
    response.writeHead(200, { 'content-type': type });
    fs.createReadStream(file).pipe(response);
  });
}

function checkMetrics(result) {
  const failures = [];
  const expect = (condition, message) => {
    if (!condition) failures.push(message);
  };
  expect(result.preSettingsContextCount === 0, 'pre-settings buffered transition created audio');
  expect(result.mutedReconnectContextCount === 0, 'muted reconnect transitions created audio');
  expect(result.enabled.contextCount === 1, 'enabled transition did not create exactly one AudioContext');
  expect(result.enabled.frequencies.join(',') === '659.25,1318.5', 'enabled transition changed the two-note frequencies');
  expect(result.enabled.state === 'running' && result.enabled.resumeCalls === 1, 'enabled transition did not resume the context');
  expect(result.muted.afterScheduledMute.every((note) => note.oscillatorDisconnected && note.gainDisconnected),
    'muting did not disconnect every scheduled note');
  expect(result.muted.afterScheduledMute.every((note) => note.cancelled && note.zeroed && note.stopped),
    'muting did not cancel gain automation, zero gain and stop every scheduled note');
  expect(result.muted.countAfterTransition === 2, 'muted transition scheduled additional notes');
  expect(result.unmuted.frequencies.join(',') === '659.25,1318.5', 'unmuting did not schedule a fresh two-note sound');
  expect(result.unmuted.previousNotesDisconnected, 'unmuting restored a note that had already been muted');
  expect(result.rapidToggle.count === 4 && result.rapidToggle.allDisconnected,
    'rapid mute/unmute/mute left scheduled notes audible or created extra notes');
  return failures;
}

async function runViewport(browser, baseUrl, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript({ content: audioStub() });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__soundAcceptance?.fixtureDone === true, null, { timeout: 15000 });
  const result = await page.evaluate(() => {
    const send = window.__sendHost;
    const setSetting = (enabled) => send({
      type: 'settingsLoaded', soundEnabled: enabled, debugEnabled: false, showAreas: false,
    });
    const roster = [{
      id: 'synthetic-sound-agent', name: 'Synthetic Sound Agent',
      role: 'Developer', paletteIndex: 0, seatId: null, status: 'active', currentTask: null,
    }];
    const currentAudio = () => window.__soundAudio.contexts.at(-1);
    setSetting(true);
    send({ type: 'existingAgents', agents: roster });
    send({ type: 'agentStatus', agentId: 'synthetic-sound-agent', status: 'idle' });
    const enabledContext = currentAudio();
    const enabled = {
      contextCount: window.__soundAudio.contexts.length,
      frequencies: enabledContext?.oscillators.map((note) => note.frequency.value) ?? [],
      state: enabledContext?.state,
      resumeCalls: enabledContext?.resumeCalls,
    };

    setSetting(false);
    const afterScheduledMute = enabledContext?.oscillators.map((oscillator, index) => ({
      oscillatorDisconnected: oscillator.disconnected,
      gainDisconnected: enabledContext.gains[index]?.disconnected,
      cancelled: enabledContext.gains[index]?.gain.events.some((event) => event.type === 'cancel'),
      zeroed: enabledContext.gains[index]?.gain.events.some((event) =>
        event.type === 'set' && event.value === 0 && event.time === enabledContext.currentTime),
      stopped: oscillator.stops.at(-1) === enabledContext.currentTime,
    })) ?? [];
    send({ type: 'agentStatus', agentId: 'synthetic-sound-agent', status: 'active' });
    send({ type: 'agentStatus', agentId: 'synthetic-sound-agent', status: 'idle' });
    const muted = {
      afterScheduledMute,
      countAfterTransition: enabledContext?.oscillators.length ?? 0,
    };

    setSetting(true);
    send({ type: 'agentStatus', agentId: 'synthetic-sound-agent', status: 'active' });
    send({ type: 'agentStatus', agentId: 'synthetic-sound-agent', status: 'idle' });
    const unmuted = {
      frequencies: enabledContext?.oscillators.slice(2).map((note) => note.frequency.value) ?? [],
      previousNotesDisconnected: enabledContext?.oscillators.slice(0, 2).every((note) => note.disconnected) ?? false,
    };

    setSetting(false);
    setSetting(true);
    setSetting(false);
    const rapidToggle = {
      count: enabledContext?.oscillators.length ?? 0,
      allDisconnected: enabledContext?.oscillators.every((note) => note.disconnected) ?? false,
    };

    return {
      preSettingsContextCount: window.__soundAcceptance.preSettingsContextCount,
      mutedReconnectContextCount: window.__soundAcceptance.mutedReconnectContextCount,
      enabled,
      muted,
      unmuted,
      rapidToggle,
    };
  });
  await context.close();
  return { viewport, result, pageErrors };
}

async function main() {
  assert.ok(fs.existsSync(extensionBundle), `compiled extension bundle not found: ${extensionBundle}`);
  assert.ok(fs.existsSync(webviewScript), `production webview bundle not found: ${webviewScript}`);
  assert.ok(fs.existsSync(edgePath), `Edge executable not found: ${edgePath}`);
  const scriptSha256 = crypto.createHash('sha256').update(fs.readFileSync(webviewScript)).digest('hex');

  const server = staticServer('');
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const { extension, webview, messages } = makeVscode(baseUrl);
  const html = htmlWithFixture(webview.html, messages);
  server.removeAllListeners('request');
  server.on('request', staticServer(html).listeners('request')[0]);

  let browser;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ executablePath: edgePath, headless: true });
    const viewports = [
      { width: 1280, height: 900 },
      { width: 360, height: 640 },
    ];
    const results = [];
    for (const viewport of viewports) {
      results.push(await runViewport(browser, baseUrl, viewport));
    }

    const failures = results.flatMap(({ viewport, result, pageErrors }) => [
      ...checkMetrics(result).map((message) => `${viewport.width}x${viewport.height}: ${message}`),
      ...pageErrors.map((message) => `${viewport.width}x${viewport.height}: page error: ${message}`),
    ]);
    const evidence = {
      head: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: artifactRoot, encoding: 'utf8',
      }).trim(),
      artifactRoot,
      servedWebviewBundle: path.relative(artifactRoot, webviewScript),
      servedWebviewBundleSha256: scriptSha256,
      browser: edgePath,
      audioEvidence: 'Recording AudioContext stub injected before page load; not native acoustic evidence.',
      hostEvidence: 'Compiled provider with mocked VS Code boundary; all roster/status events described as synthetic fixtures.',
      providerFirstMessage: messages[0]?.type,
      settingsDefault: 'Persisted setting injected as false; provider default for new users is unchanged.',
      results,
      failures,
    };
    if (evidencePath) {
      fs.mkdirSync(path.dirname(path.resolve(evidencePath)), { recursive: true });
      fs.writeFileSync(path.resolve(evidencePath), `${JSON.stringify(evidence, null, 2)}\n`);
    }

    if (expectRegression) {
      assert.ok(failures.length > 0, 'negative control unexpectedly passed all new-behavior assertions');
      assert.ok(failures.some((failure) => failure.includes('pre-settings buffered transition created audio')),
        'negative control did not reproduce the pre-settings sound regression');
      assert.ok(failures.some((failure) => failure.includes('muting did not disconnect every scheduled note')),
        'negative control did not reproduce the queued-note regression');
      console.log(`PASS expected negative-control regressions (${failures.length}): ${failures.join('; ')}`);
    } else {
      assert.deepEqual(failures, [], `production sound acceptance failed: ${failures.join('; ')}`);
      console.log(`PASS production sound acceptance at 1280x900 and 360x640; bundle SHA-256 ${scriptSha256}`);
    }
    if (evidencePath) console.log(`Evidence: ${path.resolve(evidencePath)}`);
  } finally {
    await browser?.close();
    extension.deactivate?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
