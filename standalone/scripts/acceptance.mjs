import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'squad observer installed acceptance '));
const project = path.join(root, 'synthetic project');
const home = path.join(root, 'empty synthetic home');
const install = path.join(root, 'isolated install with spaces');
const artifacts = process.env.OBSERVER_ARTIFACTS;
let child;
let browser;
const clients = [];
const report = { mode: 'synthetic read-only observer', packageInstalled: false, browser: false, screenshots: [], checks: [] };
function check(name) { report.checks.push(name); console.log(`PASS ${name}`); }
function npm(args, cwd) {
  const npmPath = process.env.npm_execpath ?? (process.platform === 'win32'
    ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js') : undefined);
  const command = npmPath ? process.execPath : 'npm';
  const argv = npmPath ? [npmPath, ...args] : args;
  const result = spawnSync(command, argv, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`npm failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
const waitFor = async (predicate, description, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${description}`);
};
async function treeDigest(folder) {
  const values = [];
  for (const entry of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(folder, entry.name);
    values.push(entry.name, entry.isDirectory() ? await treeDigest(target) : createHash('sha256').update(await fs.readFile(target)).digest('hex'));
  }
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
try {
  for (const dir of [path.join(project, '.squad', 'log'), path.join(project, '.squad-pod'), home, install]) await fs.mkdir(dir, { recursive: true });
  const roster = name => `# Synthetic observer team\n## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n| ${name} | Developer | .squad/agents/test-agent-1/charter.md | Active |\n`;
  const teamPath = path.join(project, '.squad', 'team.md');
  await fs.writeFile(teamPath, roster('TestBot'));
  const ledgerPath = path.join(project, '.squad', 'log', 'usage.jsonl');
  const usage = tokens => JSON.stringify({
    version: 1, kind: 'usage', sessionId: 'synthetic-session', timestamp: '2026-10-30T12:00:00Z',
    model: 'synthetic-model', agentName: 'TestBot', inputTokens: tokens, outputTokens: 25, estimatedCost: 0.01,
  }) + '\n';
  await fs.writeFile(ledgerPath, usage(100));
  const packed = npm(['pack', packageRoot, '--json', '--pack-destination', root], packageRoot);
  const inventory = JSON.parse(packed)[0];
  assert.equal(inventory.name, 'squad-pod-observer');
  assert.ok(inventory.files.some(file => file.path === 'dist/cli.mjs'));
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    assert.ok(inventory.files.some(file => file.path === name), `Installed tarball must include ${name}`);
  }
  const filename = inventory.filename;
  // npm ci caches tarballs, not necessarily registry metadata. Pack the already
  // restored runtime dependencies too, so acceptance needs neither metadata nor a feed.
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const runtimeTarballs = Object.keys(manifest.dependencies).map(name => {
    const dependency = JSON.parse(npm(['pack', path.join(packageRoot, 'node_modules', name), '--json', '--pack-destination', root], packageRoot))[0];
    return path.join(root, dependency.filename);
  });
  npm(['install', '--prefix', install, '--cache', path.join(root, 'empty npm cache'), '--ignore-scripts',
    '--offline', '--omit=optional', '--no-audit', '--no-fund', path.join(root, filename), ...runtimeTarballs], install);
  report.packageInstalled = true;
  check('tarball installed offline into isolated path with spaces');
  const installed = path.join(install, 'node_modules', 'squad-pod-observer');
  const require = createRequire(path.join(installed, 'package.json'));
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    assert.deepEqual(await fs.readFile(path.join(installed, name)),
      await fs.readFile(path.join(packageRoot, '..', name)), `Installed ${name} must match canonical root bytes`);
  }
  for (const name of Object.keys(manifest.dependencies)) {
    assert.deepEqual(await fs.readFile(path.join(path.dirname(require.resolve(`${name}/package.json`)), 'LICENSE')),
      await fs.readFile(path.join(packageRoot, 'node_modules', name, 'LICENSE')), `Runtime ${name} must retain its complete LICENSE`);
  }
  assert.deepEqual(await fs.readFile(path.join(installed, 'dist', 'assets', 'pixel-agents-source.json')),
    await fs.readFile(path.join(packageRoot, '..', 'webview-ui', 'public', 'assets', 'pixel-agents-source.json')),
    'Installed asset provenance must match canonical bytes');
  check('installed tarball retains exact canonical notices, dependency licenses and asset provenance');
  const { WebSocket } = require('ws');
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home };
  child = spawn(process.execPath, [path.join(installed, 'dist', 'cli.mjs'), project, '--port', '0'], {
    cwd: install, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  let stderr = '';
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.on('data', data => { stderr += data.toString(); });
  await waitFor(() => {
    if (child.exitCode !== null) throw new Error(`Installed CLI exited: ${stderr}`);
    return /http:\/\/127\.0\.0\.1:\d+/.test(output) && /\n[A-Za-z0-9_-]{43}\r?\n/.test(output);
  }, 'installed CLI ready');
  const origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const token = output.match(/\n([A-Za-z0-9_-]{43})\r?\n/)[1];
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /assets\/standalone-/);
  const auth = await fetch(`${origin}/auth`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  });
  assert.equal(auth.status, 204);
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/office`, { origin, headers: { Cookie: cookie } });
  clients.push(ws);
  const frames = [];
  ws.on('message', data => frames.push(JSON.parse(data.toString())));
  await once(ws, 'open');
  const send = message => ws.send(JSON.stringify({ version: 1, kind: 'office', message }));
  send({ type: 'webviewReady' });
  await waitFor(() => frames.some(frame => frame.message?.type === 'recordedUsage'), 'real initial snapshot');
  const snapshot = type => frames.filter(frame => frame.message?.type === type).at(-1)?.message;
  assert.equal(snapshot('existingAgents').agents[0].name, 'TestBot');
  assert.equal(snapshot('recordedUsage').snapshot.totals.inputTokens, 100);
  assert.ok(snapshot('manifestAssetsLoaded').snapshot.furniture.length > 0);
  const initialLayout = snapshot('layoutLoaded').layout;
  check('installed CLI serves real roster, ledger, bundled layout and assets with empty home');
  const before = await treeDigest(project);
  for (const message of [
    { type: 'saveLayout', layout: { version: 2, cols: 1, rows: 1, tiles: [1], furniture: [] } },
    { type: 'saveAgentSeats', seats: { 'test-agent-1': 'forged' } },
    { type: 'setSoundEnabled', enabled: true },
    { type: 'addDirectory', path: project },
    { type: 'addAssetDirectory' },
    { type: 'terminalInput', data: 'must never execute' },
  ]) {
    const count = frames.filter(frame => frame.code === 'READ_ONLY').length;
    send(message);
    await waitFor(() => frames.filter(frame => frame.code === 'READ_ONLY').length > count, 'forged mutation rejection');
  }
  assert.equal(await treeDigest(project), before);
  assert.deepEqual(await fs.readdir(home), []);
  check('forged production mutations rejected without project or synthetic-home writes');

  if (process.env.PLAYWRIGHT_MODULE) {
    const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true, ...(process.env.EDGE_PATH ? { executablePath: process.env.EDGE_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const tab = await context.newPage();
    const networkSockets = [];
    await tab.routeWebSocket('**/office', route => {
      route.connectToServer();
      networkSockets.push(route);
    });
    const browserErrors = [];
    tab.on('pageerror', error => browserErrors.push(error.message));
    tab.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
    tab.on('response', response => {
      if (response.status() >= 400) browserErrors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
    });
    const browserFrames = [];
    tab.on('websocket', socket => socket.on('framereceived', event => {
      try { browserFrames.push(JSON.parse(String(event.payload))); }
      catch { /* Non-JSON frames are checked separately by the production adapter. */ }
    }));
    await tab.goto(origin);
    await tab.getByLabel('Runtime credential from the observer console').fill(token);
    await tab.getByRole('button', { name: 'Connect read-only office' }).click();
    await tab.locator('.office-panel canvas').waitFor();
    await tab.getByRole('button', { name: /TestBot.*Developer/ }).waitFor();
    assert.match(await tab.locator('header [role="status"]').innerText(), /Connected - read-only/);
    for (const label of ['Edit Layout', 'Directories', 'Settings']) {
      assert.equal(await tab.getByRole('button', { name: label, exact: true }).isDisabled(), true);
    }
    await tab.getByRole('button', { name: /TestBot.*Developer/ }).click();
    const agentCard = tab.getByRole('dialog', { name: 'TestBot details' });
    await agentCard.getByText('Activity time unavailable', { exact: true }).waitFor();
    assert.doesNotMatch(await agentCard.innerText(), /\d+ hours? ago/);
    if (artifacts) {
      await fs.mkdir(artifacts, { recursive: true });
      await agentCard.screenshot({ path: path.join(artifacts, 'observer-unavailable-activity-card.png') });
      report.screenshots.push('observer-unavailable-activity-card.png');
    }
    check('installed production browser card labels the observer activity time unavailable');
    await agentCard.getByRole('button', { name: 'Close agent details', exact: true }).click();
    const squadInfoButton = tab.getByRole('button', { name: 'Squad Info', exact: true });
    assert.equal(await squadInfoButton.isDisabled(), false);
    await squadInfoButton.click();
    const squadInfo = tab.getByRole('dialog', { name: 'Squad Info' });
    await squadInfo.waitFor();
    await squadInfo.getByRole('button', { name: 'Show details for TestBot', exact: true }).click();
    await squadInfo.getByText(/Observed status:/).waitFor();
    await squadInfo.getByText(/Observed task:/).waitFor();
    await squadInfo.getByText(/Recent activity \(from workspace activity logs/).waitFor();
    await squadInfo.getByText('Charter content is unavailable.', { exact: false }).waitFor();
    assert.equal(await squadInfo.getByRole('button', { name: 'Open charter', exact: true }).isDisabled(), true);
    await squadInfo.getByText('Opening a charter in the editor is unavailable in the read-only observer.', { exact: true }).waitFor();
    check('read-only Squad Info expands observed details and explains unavailable charter opening');
    await squadInfo.getByRole('button', { name: 'Close Squad Info', exact: true }).click();
    await waitFor(async () => await tab.locator('canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return colors.size > 20;
    }), 'rendered office canvas');
    await tab.getByRole('button', { name: 'Telemetry', exact: false }).click();
    await tab.getByRole('heading', { name: /Recorded usage \/ model history/ }).waitFor();
    await tab.getByText('Settings and live-log consent are unavailable in this read-only observer.', { exact: false }).waitFor();
    assert.equal(await tab.getByRole('button', { name: 'Observation settings and consent', exact: true }).count(), 0);
    await tab.getByText(/Recent historical reports \(/).click();
    await tab.getByText(/Reported model: synthetic-model;/).waitFor();
    if (artifacts) {
      await fs.mkdir(artifacts, { recursive: true });
      await tab.screenshot({ path: path.join(artifacts, 'observer-desktop.png'), fullPage: true });
      report.screenshots.push('observer-desktop.png');
      await tab.setViewportSize({ width: 390, height: 844 });
      await tab.screenshot({ path: path.join(artifacts, 'observer-narrow.png'), fullPage: true });
      report.screenshots.push('observer-narrow.png');
      await tab.setViewportSize({ width: 1440, height: 960 });
    }
    await fs.writeFile(teamPath, roster('UpdatedTestBot'));
    await fs.writeFile(ledgerPath, usage(321));
    const floorIndex = initialLayout.tiles.findIndex(tile => tile === 1);
    const voidIndex = initialLayout.tiles.findIndex(tile => tile === 8);
    assert.ok(floorIndex >= 0 && voidIndex >= 0);
    const changedLayout = {
      ...initialLayout,
      tiles: initialLayout.tiles.map((tile, index) => index === floorIndex ? 10 : tile),
      tileColors: { ...initialLayout.tileColors, '0,0': { h: 120, s: 70, b: -10, c: 0 } },
    };
    await fs.writeFile(path.join(project, '.squad-pod', 'layout.json'), JSON.stringify(changedLayout));
    await tab.getByRole('button', { name: /UpdatedTestBot.*Developer/ }).waitFor();
    await waitFor(() => browserFrames.some(frame => frame.message?.type === 'recordedUsage' && frame.message.snapshot.totals?.inputTokens === 321), 'ledger update through actual browser transport');
    await waitFor(() => browserFrames.some(frame => frame.message?.type === 'layoutLoaded' && frame.message.layout.tileColors?.['0,0']?.h === 120), 'layout update through actual browser transport');
    await waitFor(() => browserFrames.some(frame => frame.message?.type === 'layoutLoaded'
      && frame.message.layout.tiles[floorIndex] === 10 && frame.message.layout.tiles[voidIndex] === 8), 'saved-project Floor10 and legacy VOID8 through actual browser transport');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(project, '.squad-pod', 'layout.json'), 'utf8')), changedLayout);
    if (artifacts) {
      await tab.screenshot({ path: path.join(artifacts, 'observer-saved-floor10.png'), fullPage: true });
      report.screenshots.push('observer-saved-floor10.png');
    }
    check('production renderer receives actual filesystem roster/layout/usage changes, no injected renderer/global');
    check('actual saved-project Floor10 observed in production browser; legacy VOID8 and source file preserved');
    const floorProbe = {
      version: 2, cols: 9, rows: 7, tiles: Array(63).fill(1), furniture: [],
      tileColors: Object.fromEntries([1, 4, 7].map(col => [`${col},1`, { h: 0, s: 0, b: 0, c: 0, colorize: false }])),
    };
    for (const col of [1, 4, 7]) floorProbe.tiles[9 + col] = 10;
    floorProbe.tiles[62] = 8;
    const layoutPath = path.join(project, '.squad-pod', 'layout.json');
    await fs.writeFile(layoutPath, JSON.stringify(floorProbe));
    const floorTab = await context.newPage();
    floorTab.on('pageerror', error => browserErrors.push(error.message));
    await floorTab.setViewportSize({ width: 900, height: 700 });
    await floorTab.goto(origin);
    await floorTab.getByLabel('Runtime credential from the observer console').fill(token);
    await floorTab.getByRole('button', { name: 'Connect read-only office' }).click();
    const floorCanvas = floorTab.locator('.office-panel canvas');
    await floorCanvas.waitFor();
    const { PNG } = require('pngjs');
    const sheet = PNG.sync.read(await fs.readFile(path.join(installed, 'dist', 'assets', 'floors', 'floor_7.png')));
    assert.equal(sheet.width, 16);
    assert.equal(sheet.height, 16);
    const expectedPixels = [];
    for (let row = 1; row < 15; row++) for (let col = 1; col < 15; col++) {
      const offset = (row * 16 + col) * 4;
      expectedPixels.push(...sheet.data.subarray(offset, offset + 4));
    }
    const sampleFloor = (col, row) => floorCanvas.evaluate((canvas, { col, row }) => {
      const zoom = 2;
      const x = Math.round((canvas.width - 9 * 16 * zoom) / 2 + col * 16 * zoom);
      const y = Math.round((canvas.height - 7 * 16 * zoom) / 2 + row * 16 * zoom);
      const image = canvas.getContext('2d').getImageData(x, y, 16 * zoom, 16 * zoom);
      const pixels = [];
      for (let r = 1; r < 15; r++) for (let c = 1; c < 15; c++) {
        const offset = ((r * zoom + 1) * image.width + c * zoom + 1) * 4;
        pixels.push(...image.data.slice(offset, offset + 4));
      }
      return pixels;
    }, { col, row });
    // Multiple separated cells avoid an independently wandering character obscuring the source art.
    await waitFor(async () => {
      const samples = await Promise.all([1, 4, 7].map(col => sampleFloor(col, 1)));
      return samples.some(pixels => JSON.stringify(pixels) === JSON.stringify(expectedPixels));
    }, 'saved Floor10 canvas pixels exactly match installed floor_7.png');
    assert.equal((await sampleFloor(8, 6)).every(value => value === 0), true, 'legacy VOID8 must remain transparent');
    assert.deepEqual(JSON.parse(await fs.readFile(layoutPath, 'utf8')), floorProbe);
    if (artifacts) {
      await floorTab.screenshot({ path: path.join(artifacts, 'observer-floor10-pixels.png'), fullPage: true });
      report.screenshots.push('observer-floor10-pixels.png');
    }
    await floorTab.close();
    await fs.writeFile(layoutPath, JSON.stringify(changedLayout));
    check('saved Floor10 renders exact installed source-sheet pixels and VOID8 stays transparent, without renderer injection');
    // Close only the actual network connection, never inject a renderer/client global.
    await networkSockets[0].close({ code: 1012, reason: 'Synthetic transient network disconnect' });
    await waitFor(async () => /Disconnected|Connection failed/.test(await tab.locator('header [role="status"]').innerText()), 'visible disconnect');
    await waitFor(async () => /Connected - read-only/.test(await tab.locator('header [role="status"]').innerText()), 'browser observation reconnect', 25_000);
    check('visible browser disconnect and authenticated observation-only reconnect');
    // Browser empty-state handling after genuine source removal/malformed edits.
    await fs.rm(teamPath);
    await fs.writeFile(path.join(project, '.squad-pod', 'layout.json'), '{malformed');
    await tab.getByText('No Squad team found', { exact: true }).waitFor();
    await tab.getByRole('alert').filter({ hasText: 'malformed' }).waitFor();
    assert.deepEqual(browserErrors, []);
    report.browser = true;
    check('desktop/narrow actual renderer plus missing/malformed source UX without browser errors');
    await context.close();
  }

  const oldOutputLength = output.length;
  const disconnected = once(ws, 'close');
  child.stdin.write('rotate\n');
  await disconnected;
  await waitFor(() => /\n[A-Za-z0-9_-]{43}\r?\n/.test(output.slice(oldOutputLength)), 'credential rotation');
  const revoked = await fetch(`${origin}/auth`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  });
  assert.equal(revoked.status, 403);
  check('runtime rotation revokes prior credential and disconnects authenticated clients');
  const exit = once(child, 'exit');
  child.stdin.write('quit\n');
  await Promise.race([exit, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('CLI did not exit within five seconds of graceful shutdown.')), 5000);
    timer.unref();
  })]);
  assert.equal(child.exitCode, 0);
  await assert.rejects(() => fetch(origin));
  assert.deepEqual(await fs.readdir(home), []);
  check('graceful CLI shutdown closes listener and leaves synthetic home empty');
  if (artifacts) await fs.writeFile(path.join(artifacts, 'observer-acceptance.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error('Observer acceptance failed:', error instanceof Error ? error.message : String(error));
  throw error;
} finally {
  for (const client of clients) client.terminate();
  if (browser) await browser.close();
  if (child && child.exitCode === null) {
    child.stdin.write('quit\n');
    await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'close');
    }
  }
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
