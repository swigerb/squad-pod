const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { PNG } = require('pngjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
require('tsx/cjs');
const { getColorizedTileSprite } = require('../webview-ui/src/office/colorize.ts');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.ACCEPTANCE_OUTPUT_DIR || path.join(os.tmpdir(), 'squad-floor-evidence'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-floor-provider-'));
const layoutFile = path.join(workspace, '.squad-pod', 'layout.json');
const exportedFile = path.join(output, 'exported-layout.json');
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const neutral = { h: 0, s: 0, b: 0, c: 0, colorize: false };
const initial = {
  version: 2, cols: 9, rows: 7,
  tiles: [0, 8, 1, 2, 3, 4, 5, 6, 7, 9, ...Array(53).fill(1)],
  furniture: [{ uid: 'control-chair', type: 'pa_CUSHIONED_CHAIR_FRONT', col: 7, row: 5, rotation: 0,
    assetFootprint: { width: 1, height: 1 }, assetRole: 'seat' }],
  tileColors: Object.fromEntries(Array.from({ length: 63 }, (_, i) => [`${i % 9},${Math.floor(i / 9)}`, neutral])),
  areas: [{ label: 'Test Area', color: '#123456' }],
  areaTiles: Array.from({ length: 63 }, (_, i) => i === 20 ? 'Test Area' : null),
  areaMappings: { 'test-directory': ['Test Area'] },
  carpetTiles: Array.from({ length: 63 }, (_, i) => i === 20 ? { variant: 1 } : null),
  pets: [],
};
const result = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  boundary: 'Production extension and webview; real provider save/reload/export/import and temporary disk files. Mocked VS Code APIs/dialogs; no native VS Code or real Squad session.',
  bundleSha256: digest(fs.readFileSync(path.join(root, 'dist', 'webview', 'assets', 'index.js'))),
};
const messages = [];
const notices = [];
let provider, receiveMessage, deactivate, browser, server;
const originalLoad = Module._load;

async function until(read, description) {
  for (let i = 0; i < 150; i++) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(path.join(workspace, '.squad'));
  fs.writeFileSync(path.join(workspace, '.squad', 'team.md'), '## Members\n\n| Name | Role | Charter | Status |\n| --- | --- | --- | --- |\n');
  fs.mkdirSync(path.dirname(layoutFile));
  fs.writeFileSync(layoutFile, JSON.stringify(initial));
  const uri = (fsPath) => ({ fsPath, toString: () => pathToFileURL(fsPath).toString() });
  const disposable = { dispose() {} };
  const storageValues = new Map();
  const storage = {
    get: (key, fallback) => storageValues.has(key) ? storageValues.get(key) : fallback,
    update: async (key, value) => { storageValues.set(key, value); },
  };
  const vscode = {
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    window: {
      registerWebviewViewProvider: (_id, value) => { provider = value; return disposable; },
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      showSaveDialog: async () => uri(exportedFile),
      showOpenDialog: async () => [uri(exportedFile)],
      showInformationMessage: (message) => { notices.push(message); },
      showWarningMessage: (message) => { notices.push(message); },
      showErrorMessage: (message) => { throw new Error(message); },
    },
    commands: { registerCommand: () => disposable, executeCommand() {} },
    workspace: {
      workspaceFolders: [{ uri: uri(workspace), name: 'Floor fixture' }],
      getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      onDidChangeWorkspaceFolders: () => disposable,
      fs: {
        writeFile: async (file, bytes) => fs.writeFileSync(file.fsPath, bytes),
        readFile: async (file) => fs.readFileSync(file.fsPath),
      },
    },
  };
  Module._load = function (request, parent, isMain) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  const extension = require(path.join(root, 'dist', 'extension.js'));
  deactivate = extension.deactivate;
  extension.activate({ subscriptions: [], extensionPath: root, workspaceState: storage, globalState: storage });
  let html;
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/host') {
      let body = '';
      for await (const chunk of request) body += chunk;
      receiveMessage(JSON.parse(body));
      response.end('{}');
    } else if (url.pathname === '/messages') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ cursor: messages.length, messages: messages.slice(Number(url.searchParams.get('cursor'))) }));
    } else if (url.pathname === '/') {
      response.setHeader('content-type', 'text/html');
      response.end(html.replace('INITIAL_CURSOR', String(messages.length)));
    } else {
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(path.join(root, 'dist') + path.sep) || !fs.existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
      fs.createReadStream(file).pipe(response);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const webview = {
    cspSource: origin,
    asWebviewUri: (resource) => `${origin}/${path.relative(root, resource.fsPath).replaceAll(path.sep, '/')}`,
    onDidReceiveMessage: (listener) => { receiveMessage = listener; return disposable; },
    postMessage: (message) => { messages.push(message); return Promise.resolve(true); },
    html: '',
  };
  provider.resolveWebviewView({ webview, onDidDispose: () => disposable }, {}, {});
  const nonce = webview.html.match(/<script nonce="([^"]+)"/)[1];
  html = webview.html.replace('</head>', `<script nonce="${nonce}">
    window.__floorAcceptance = { outbound: [], incoming: [], state: undefined };
    let cursor = INITIAL_CURSOR, polling = false;
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__floorAcceptance.outbound.push(message);
        fetch('/host', { method: 'POST', body: JSON.stringify(message) });
      },
      getState: () => JSON.parse(sessionStorage.getItem('vscode-state') || 'null'),
      setState(value) {
        window.__floorAcceptance.state = value;
        sessionStorage.setItem('vscode-state', JSON.stringify(value));
        return value;
      },
    });
    setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const batch = await (await fetch('/messages?cursor=' + cursor)).json();
        cursor = batch.cursor;
        for (const data of batch.messages) {
          window.__floorAcceptance.incoming.push(data);
          window.dispatchEvent(new MessageEvent('message', { data }));
        }
      } finally { polling = false; }
    }, 100);
  </script></head>`);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  result.browser = browser.version();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.__floorAcceptance.incoming.some((m) => m.type === 'layoutLoaded'));
  await page.evaluate(() => {
    for (const [name, value] of Object.entries({
      'editor-background': '#1e1e1e', foreground: '#cccccc',
      'button-background': '#0e639c', 'button-foreground': '#ffffff',
      'button-secondaryBackground': '#3a3d41', 'button-secondaryForeground': '#ffffff',
      'panel-border': '#80808059', errorForeground: '#f48771',
    })) document.documentElement.style.setProperty(`--vscode-${name}`, value);
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(layoutFile)), initial, 'opening must not change the saved office');
  const canvas = page.locator('canvas').first();
  await page.getByRole('button', { name: 'Edit Layout', exact: true }).click();
  await page.getByTitle('Floor', { exact: true }).click();
  const mapping = [[1, 0], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6], [9, 8], [10, 7]];
  assert.equal(await page.locator('button[title^="Floor "]').count(), 9);
  result.palette = [];
  for (const [type, source] of mapping) {
    // Exact title prefix must not confuse Floor 1 with Floor 10.
    const button = page.getByRole('button', { name: new RegExp(`^Floor ${type}(?: \\(|$)`) });
    const bounds = await button.boundingBox();
    const editorBounds = await page.getByRole('region', { name: 'Layout editor' }).boundingBox();
    assert.ok(bounds.x >= editorBounds.x && bounds.x + bounds.width <= editorBounds.x + editorBounds.width,
      `Floor ${type} must fit inside the palette without horizontal clipping`);
    const actual = await button.locator('canvas').evaluate((c) => Array.from(c.getContext('2d').getImageData(0, 0, 16, 16).data));
    const sourceFile = path.join(root, 'webview-ui', 'public', 'assets', 'floors', `floor_${source}.png`);
    const png = PNG.sync.read(fs.readFileSync(sourceFile));
    assert.deepEqual(actual, Array.from(png.data), `Floor ${type} preview must be exactly floor_${source}.png`);
    result.palette.push({ type, source: `floor_${source}.png`, rgbaSha256: digest(Buffer.from(actual)) });
  }
  const geometry = await canvas.evaluate((c) => {
    const rect = c.getBoundingClientRect();
    const zoom = Number(document.querySelector('[aria-label="Office zoom"]').textContent.match(/\d+/)[0]);
    return { x: rect.x + (c.width - 9 * 16 * zoom) / 2, y: rect.y + (c.height - 7 * 16 * zoom) / 2, zoom };
  });
  const clickTile = (col, row) => page.mouse.click(geometry.x + (col * 16 + 8) * geometry.zoom, geometry.y + (row * 16 + 8) * geometry.zoom);
  const sample = (col, row) => canvas.evaluate((c, { col, row, geometry }) => {
    const rect = c.getBoundingClientRect();
    const x = Math.round(geometry.x - rect.x + col * 16 * geometry.zoom);
    const y = Math.round(geometry.y - rect.y + row * 16 * geometry.zoom);
    const image = c.getContext('2d').getImageData(x, y, 16 * geometry.zoom, 16 * geometry.zoom);
    const pixels = [];
    // Omit editor grid lines and sample source pixel centers.
    for (let r = 1; r < 15; r++) for (let col = 1; col < 15; col++) {
      const i = ((r * geometry.zoom + Math.floor(geometry.zoom / 2)) * image.width
        + col * geometry.zoom + Math.floor(geometry.zoom / 2)) * 4;
      pixels.push(...image.data.slice(i, i + 4));
    }
    return pixels;
  }, { col, row, geometry });
  await page.mouse.move(0, 0);
  const voidBefore = await sample(1, 0);
  const oldBefore = await sample(2, 0);
  await page.getByRole('button', { name: 'Floor 10', exact: true }).click();
  await clickTile(4, 3);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(100);
  const painted = await page.evaluate(() => window.__floorAcceptance.state.draft);
  assert.equal(painted.tiles[31], 10);
  const newColor = painted.tileColors['4,3'];
  const source = PNG.sync.read(fs.readFileSync(path.join(root, 'webview-ui', 'public', 'assets', 'floors', 'floor_7.png')));
  const sprite = Array.from({ length: 16 }, (_, r) => Array.from({ length: 16 }, (_, c) =>
    '#' + source.data.subarray((r * 16 + c) * 4, (r * 16 + c) * 4 + 3).toString('hex')));
  const tinted = getColorizedTileSprite('browser-floor-expected', sprite, newColor);
  const expectedPixels = tinted.slice(1, 15).flatMap((row) => row.slice(1, 15).flatMap((hex) => [...Buffer.from(hex.slice(1), 'hex'), 255]));
  assert.deepEqual(await sample(4, 3), expectedPixels, 'painted Floor 10 pixels must match the missing source sheet with the selected color');
  assert.deepEqual(await sample(1, 0), voidBefore, 'VOID pixels must remain unchanged');
  assert.deepEqual(await sample(2, 0), oldBefore, 'existing floor pixels must remain unchanged');
  for (const key of ['furniture', 'areas', 'areaTiles', 'areaMappings', 'carpetTiles', 'pets']) {
    assert.deepEqual(painted[key], initial[key], `painting must preserve ${key}`);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(layoutFile)), initial, 'painting is only a draft');
  await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.__floorAcceptance.state.draft), initial);
  await page.getByTitle('Redo (Ctrl+Y)', { exact: true }).click();
  await page.getByRole('button', { name: /^Floor 1 \(/ }).click();
  await page.getByTitle('Eyedrop', { exact: true }).click();
  await clickTile(4, 3);
  assert.equal(await page.getByRole('button', { name: 'Floor 10', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: /Save Layout/ }).click();
  await until(() => JSON.parse(fs.readFileSync(layoutFile)).tiles[31] === 10, 'provider save to disk');
  assert.deepEqual(JSON.parse(fs.readFileSync(layoutFile)), painted);
  await page.screenshot({ path: path.join(output, 'floor10-painted.png') });
  await page.reload();
  await page.waitForFunction(() => window.__floorAcceptance.incoming.some((m) => m.type === 'layoutLoaded'));
  assert.deepEqual(await page.evaluate(() => window.__floorAcceptance.incoming.find((m) => m.type === 'layoutLoaded').layout), painted);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Export Layout', exact: true }).click();
  await until(() => fs.existsSync(exportedFile), 'provider export JSON');
  assert.deepEqual(JSON.parse(fs.readFileSync(exportedFile)), painted);
  // Change only the selected import file to prove import is staged, not an echo of the saved office.
  const imported = structuredClone(painted);
  imported.tiles[32] = 10;
  imported.tileColors['5,3'] = newColor;
  fs.writeFileSync(exportedFile, JSON.stringify(imported, null, 2));
  await page.getByRole('button', { name: 'Import Layout', exact: true }).click();
  await page.waitForFunction(() => window.__floorAcceptance.state?.draft?.tiles[32] === 10);
  assert.deepEqual(await page.evaluate(() => window.__floorAcceptance.state.draft), imported);
  assert.deepEqual(JSON.parse(fs.readFileSync(layoutFile)), painted, 'import must remain an unsaved draft');
  await page.getByRole('button', { name: '\u00d7', exact: true }).click();
  if (await page.getByRole('button', { name: 'Edit Layout', exact: true }).count()) {
    await page.getByRole('button', { name: 'Edit Layout', exact: true }).click();
  }
  await page.getByRole('button', { name: /Save Layout/ }).click();
  await until(() => JSON.parse(fs.readFileSync(layoutFile)).tiles[32] === 10, 'save imported draft');
  await page.reload();
  await page.waitForFunction(() => window.__floorAcceptance.incoming.some((m) => m.type === 'layoutLoaded'));
  assert.deepEqual(await page.evaluate(() => window.__floorAcceptance.incoming.find((m) => m.type === 'layoutLoaded').layout), imported);
  assert.deepEqual(errors, []);
  assert.equal(messages.some((m) => m.type === 'layoutError'), false);
  result.cases = ['nine exact source-sheet previews', 'ordinary-click Floor 10 paint and eyedrop', 'exact tinted canvas pixels',
    'legacy VOID and floor pixels unchanged', 'unrelated layers unchanged', 'undo/redo', 'provider disk save/reload',
    'provider JSON export', 'provider import as unsaved draft', 'import save/reload'];
  result.newStylePixelsSha256 = digest(Buffer.from(expectedPixels));
  result.notices = notices;
  fs.copyFileSync(layoutFile, path.join(output, 'saved-layout.json'));
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(`PASS floor acceptance: ${result.cases.join('; ')}\nEvidence: ${output}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  deactivate?.();
  Module._load = originalLoad;
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(workspace, { recursive: true, force: true });
});
