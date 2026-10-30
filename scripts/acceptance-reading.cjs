const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
require('tsx/cjs');

const root = path.resolve(__dirname, '..');
const extensionBundle = path.join(root, 'dist', 'extension.js');
const webRoot = path.join(root, 'dist', 'webview');
const webviewBundle = path.join(webRoot, 'assets', 'index.js');
const edgePath = process.env.EDGE_PATH
  || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const defaultBaselineRef = '30038cb01a38f44fbb727bd87b1ae621fbcdf8aa';
const outputDir = path.resolve(process.env.ACCEPTANCE_OUTPUT_DIR
  || path.join(os.tmpdir(), 'squad-pod-reading-acceptance'));
const viewportSizes = [{ width: 1280, height: 900 }, { width: 360, height: 640 }];
const providerMessageTypes = new Set([
  'settingsLoaded', 'sourceStatus', 'recordedUsage', 'characterSpritesLoaded',
  'manifestAssetsLoaded', 'layoutLoaded', 'existingAgents', 'squadRosterLoaded',
  'directoryCatalog',
]);
const colors = { typing: '#d14343', reading: '#1a8f52' };

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
}

function buildBaselineBundle() {
  const requestedBaselineRef = process.env.ACCEPTANCE_BASELINE_REF || defaultBaselineRef;
  let baselineRef;
  try {
    baselineRef = execFileSync('git', ['rev-parse', '--verify', `${requestedBaselineRef}^{commit}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error(
      `Unable to resolve acceptance baseline "${requestedBaselineRef}" as a local commit. ` +
      'Fetch the commit into this repository or set ACCEPTANCE_BASELINE_REF to an available commit.',
    );
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-reading-baseline-'));
  const archivePath = path.join(directory, 'source.tar');
  const archive = execFileSync('git', ['archive', '--format=tar', baselineRef], {
    cwd: root,
    maxBuffer: 128 * 1024 * 1024,
  });
  fs.writeFileSync(archivePath, archive);
  run('tar', ['-xf', archivePath, '-C', directory]);
  fs.rmSync(archivePath, { force: true });

  fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
  fs.symlinkSync(
    path.join(root, 'webview-ui', 'node_modules'),
    path.join(directory, 'webview-ui', 'node_modules'),
    'junction',
  );
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  run(process.execPath, [npmCli, 'run', 'build:webview'], { cwd: directory });
  const bundlePath = path.join(directory, 'dist', 'webview', 'assets', 'index.js');
  assert.ok(fs.existsSync(bundlePath), 'baseline production webview bundle must exist');
  return { baselineRef, bundlePath, directory };
}

function syntheticSprites() {
  const frames = (color) => {
    const frame = Array.from({ length: 24 }, () => Array(16).fill(color));
    const directions = {};
    for (const direction of [0, 1, 2, 3]) directions[direction] = [frame, frame];
    return directions;
  };
  return [{
    walk: frames('#123456'),
    typing: frames(colors.typing),
    reading: frames(colors.reading),
  }];
}

function createProviderFixture() {
  const messages = [];
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-reading-fixture-'));
  const squadRoot = path.join(workspaceRoot, '.squad');
  fs.mkdirSync(path.join(squadRoot, 'agents', 'fixture-agent'), { recursive: true });
  fs.writeFileSync(
    path.join(squadRoot, 'team.md'),
    '## Members\n\n| Name | Role | Charter | Status |\n| --- | --- | --- | --- |\n' +
      '| Synthetic Reader | Dev | `.squad/agents/fixture-agent/charter.md` | Active |\n',
  );

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
      workspaceFolders: [{ uri: uri(workspaceRoot), name: 'Synthetic reader fixture' }],
      onDidChangeWorkspaceFolders: () => disposable,
    },
  };
  const storageValues = new Map();
  const storage = {
    get: (key, fallback) => storageValues.has(key) ? storageValues.get(key) : fallback,
    update: async (key, value) => { storageValues.set(key, value); },
  };
  const context = {
    subscriptions: [],
    extensionPath: root,
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
    assert.ok(provider, 'compiled extension must register its webview provider');

    let html = '';
    const webview = {
      cspSource: 'http://127.0.0.1',
      options: undefined,
      get html() { return html; },
      set html(value) { html = value; },
      asWebviewUri: (resource) => `http://127.0.0.1/${path.relative(root, resource.fsPath).replaceAll(path.sep, '/')}`,
      onDidReceiveMessage: (listener) => { receiveMessage = listener; return disposable; },
      postMessage: (message) => { messages.push(message); return Promise.resolve(true); },
    };
    return {
      context, deactivate, dispose: () => {
        deactivate?.();
        Module._load = originalLoad;
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      },
      messages, provider, receive: (message) => receiveMessage(message),
      resolve: (port) => {
        webview.cspSource = `http://127.0.0.1:${port}`;
        webview.asWebviewUri = (resource) => `http://127.0.0.1:${port}/${path.relative(root, resource.fsPath).replaceAll(path.sep, '/')}`;
        provider.resolveWebviewView(
          { webview, onDidDispose: () => disposable },
          {},
          {},
        );
        assert.equal(webview.options.enableScripts, true);
        assert.match(html, /Content-Security-Policy/);
        receiveMessage({ type: 'webviewReady' });
        const fixtureAgent = messages.find((message) => message.type === 'existingAgents')
          ?.agents.find((agent) => agent.id === 'fixture-agent');
        assert.ok(fixtureAgent, 'compiled provider must deliver the synthetic roster member');
        assert.ok(messages.some((message) => message.type === 'layoutLoaded'),
          'compiled provider must deliver a layout through the host boundary');
        return html;
      },
    };
  } catch (error) {
    Module._load = originalLoad;
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    throw error;
  }
}

function createBridge(messages, mode) {
  const fixtures = messages.filter((message) => providerMessageTypes.has(message.type));
  const escapedFixtures = JSON.stringify(fixtures).replace(/</g, '\\u003c');
  const sprites = JSON.stringify(syntheticSprites()).replace(/</g, '\\u003c');
  return `
    window.__readingAcceptance = { replayed: false, outbound: [], mode: ${JSON.stringify(mode)} };
    window.__sendHost = (data) => window.dispatchEvent(new MessageEvent('message', { data }));
    if (${JSON.stringify(mode)} === 'fallback') {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
        if (kind === '2d' && this.width === 224 && this.height === 128) return null;
        return getContext.call(this, kind, ...args);
      };
    }
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__readingAcceptance.outbound.push(message);
        if (message.type === 'webviewReady' && !window.__readingAcceptance.replayed) {
          window.__readingAcceptance.replayed = true;
          setTimeout(() => {
            ${escapedFixtures}.forEach(window.__sendHost);
            window.__sendHost({ type: 'characterSpritesLoaded', sprites: ${sprites} });
            window.__sendHost({ type: 'agentStatus', agentId: 'fixture-agent', status: 'active' });
            window.__sendHost({ type: 'agentToolStart', agentId: 'fixture-agent', tool: 'Bash' });
          }, 125);
        }
      },
      getState: () => undefined,
      setState: (value) => value,
    });
    Math.random = () => 0;
  `;
}

async function pixelCounts(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = { typing: 0, reading: 0 };
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] === 209 && pixels[index + 1] === 67 && pixels[index + 2] === 67) counts.typing++;
      if (pixels[index] === 26 && pixels[index + 1] === 143 && pixels[index + 2] === 82) counts.reading++;
    }
    return { width: canvas.width, height: canvas.height, ...counts };
  });
}

async function checkPage(browser, url, viewport, mode, baseline, pageErrors, screenshotPath) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => pageErrors.push(`${mode} ${viewport.width}x${viewport.height}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[browser ${mode} ${viewport.width}x${viewport.height}] ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    console.error(`[request ${mode} ${viewport.width}x${viewport.height}] ${request.url()}: ${request.failure()?.errorText}`);
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  try {
    await page.waitForFunction(() => window.__readingAcceptance?.replayed === true
      && Boolean(document.querySelector('canvas')?.width), undefined, { timeout: 10000 });
  } catch (error) {
    console.error(`[browser state] ${JSON.stringify(await page.evaluate(() => ({
      acceptance: window.__readingAcceptance,
      canvases: [...document.querySelectorAll('canvas')].map((canvas) => [canvas.width, canvas.height]),
      body: document.body.innerText.slice(0, 500),
    })))}`);
    throw error;
  }
  await page.waitForTimeout(500);
  const working = await pixelCounts(page);
  assert.ok(working, 'working render must have a readable office canvas');
  await page.evaluate(() => window.__sendHost({
    type: 'agentToolStart',
    agentId: 'fixture-agent',
    tool: 'view',
  }));
  await page.waitForTimeout(250);
  const reading = await pixelCounts(page);
  assert.ok(reading, 'reading render must have a readable office canvas');

  if (baseline) {
    assert.equal(reading.reading, 0,
      `master negative control unexpectedly rendered reading-template pixels for ${mode} ${viewport.width}x${viewport.height}`);
  } else {
    assert.ok(reading.reading > 0,
      `reading metadata did not render reading-template pixels for ${mode} ${viewport.width}x${viewport.height}`);
    assert.equal(working.reading, 0,
      `working render unexpectedly used reading-template pixels for ${mode} ${viewport.width}x${viewport.height}`);
    if (mode === 'fallback') {
      assert.ok(working.typing > 0,
        `fallback working render did not use typing-template pixels at ${viewport.width}x${viewport.height}`);
      assert.equal(reading.typing, 0,
        `fallback reading render retained typing-template pixels at ${viewport.width}x${viewport.height}`);
    } else {
      assert.equal(working.typing, 0,
        `PNG working render unexpectedly used inline typing-template pixels at ${viewport.width}x${viewport.height}`);
    }
  }

  if (screenshotPath) await page.screenshot({ path: screenshotPath });
  await page.close();
  return { viewport, mode, baseline, working, reading };
}

async function main() {
  assert.ok(fs.existsSync(extensionBundle), 'production extension bundle must exist; run npm run build first');
  assert.ok(fs.existsSync(webviewBundle), 'production webview bundle must exist; run npm run build first');
  assert.ok(fs.existsSync(edgePath), `Edge executable not found: ${edgePath}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const baseline = buildBaselineBundle();
  const baselineHash = sha256(baseline.bundlePath);
  const servedBundleHash = sha256(webviewBundle);
  if (baselineHash === servedBundleHash) {
    fs.rmSync(baseline.directory, { recursive: true, force: true });
    throw new Error(
      `Acceptance baseline ${baseline.baselineRef} is not a pre-reading revision: ` +
      'its webview bundle is byte-identical to the current bundle.',
    );
  }
  const provider = createProviderFixture();
  let html = '';
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    const fromWebview = url.pathname.startsWith('/dist/webview/');
    const relative = decodeURIComponent(url.pathname).slice(fromWebview
      ? '/dist/webview/'.length
      : '/dist/'.length);
    if (relative === 'assets/index.js') {
      const isBaseline = url.searchParams.get('baseline') === '1';
      const bundle = isBaseline ? baseline.bundlePath : webviewBundle;
      console.log(`[bundle] ${isBaseline ? 'master negative control' : 'current'} ${sha256(bundle)}`);
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      fs.createReadStream(bundle).pipe(response);
      return;
    }
    const resourceRoot = fromWebview ? webRoot : path.join(root, 'dist');
    const file = path.resolve(resourceRoot, relative);
    if (!file.startsWith(`${resourceRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-type': file.endsWith('.css') ? 'text/css' : 'application/octet-stream',
    });
    fs.createReadStream(file).pipe(response);
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    const providerHtml = provider.resolve(port);
    const nonce = providerHtml.match(/<script nonce=\"([^\"]+)\"/)?.[1];
    assert.ok(nonce, 'compiled provider HTML must nonce-gate its scripts');
    const baselineProviderHtml = providerHtml.replace(/(index\.js\?v=[^\"]+)/, '$1&baseline=1');
    assert.notEqual(baselineProviderHtml, providerHtml, 'baseline script URL must select the master bundle');
    const messages = provider.messages.filter((message) => providerMessageTypes.has(message.type));
    const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const browser = await playwright.chromium.launch({
      executablePath: edgePath,
      headless: true,
      args: ['--disable-gpu'],
    });
    const pageErrors = [];
    const results = [];
    try {
      for (const viewport of viewportSizes) {
        for (const mode of ['png', 'fallback']) {
          const fixtureHtml = providerHtml
            .replace('</head>', `<script nonce=\"${nonce}\">${createBridge(messages, mode)}</script></head>`);
          html = fixtureHtml;
          results.push(await checkPage(
            browser,
            `http://127.0.0.1:${port}/?case=${mode}-current-${viewport.width}`,
            viewport,
            mode,
            false,
            pageErrors,
            path.join(outputDir, `reading-${mode}-${viewport.width}x${viewport.height}.png`),
          ));
        }
        for (const mode of ['png', 'fallback']) {
          html = baselineProviderHtml
            .replace('</head>', `<script nonce=\"${nonce}\">${createBridge(messages, mode)}</script></head>`);
          results.push(await checkPage(
            browser,
            `http://127.0.0.1:${port}/?case=${mode}-master-${viewport.width}`,
            viewport,
            mode,
            true,
            pageErrors,
            null,
          ));
        }
      }
    } finally {
      await browser.close();
    }

    assert.deepEqual(pageErrors, [], 'browser acceptance must have zero page errors');
    const report = {
      result: 'PASS',
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      baseRef: baseline.baselineRef,
      servedBundle: 'dist/webview/assets/index.js',
      servedBundleSha256: servedBundleHash,
      negativeControlBundleSha256: baselineHash,
      pageErrors,
      checks: results,
      screenshots: results.filter((result) => !result.baseline).map((result) =>
        `reading-${result.mode}-${result.viewport.width}x${result.viewport.height}.png`),
      syntheticEvidence: 'A mock VS Code boundary injects explicit agentToolStart tool names and custom reading frames; no live Squad producer is exercised.',
    };
    fs.writeFileSync(path.join(outputDir, 'reading-acceptance-results.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      result: report.result,
      head: report.head,
      servedBundleSha256: report.servedBundleSha256,
      negativeControlBundleSha256: report.negativeControlBundleSha256,
      checks: results.length,
      pageErrors: pageErrors.length,
      evidence: outputDir,
    }, null, 2));
  } finally {
    provider.dispose();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(baseline.directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
