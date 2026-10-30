import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { constants, realpathSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'squad owned installed acceptance '));
const artifacts = process.env.TERMINAL_ARTIFACTS;
const project = path.join(root, 'synthetic project with spaces');
const home = path.join(root, 'empty synthetic home');
const install = path.join(root, 'isolated install with spaces');
const sockets = [];
const processes = [];
let browser;
let mobileTab;
const report = { platform: `${process.platform}-${process.arch}`, node: process.version,
  head: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: packageRoot, encoding: 'utf8' }).stdout.trim(),
  sourceDirty: spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: packageRoot, encoding: 'utf8' }).stdout.trim(),
  mode: 'installed synthetic native PTY (never Copilot/Squad)', checks: [], screenshots: [], failures: [] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function check(name) { report.checks.push(name); console.log(`PASS ${name}`); }
function npm(args, cwd = packageRoot, env = {}) {
  const npmPath = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const result = spawnSync(process.execPath, [npmPath, ...args], {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`npm ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
async function until(predicate, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${description}`);
}
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function connect(WebSocket, origin, cookie) {
  const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/terminal`, { origin, headers: { Cookie: cookie } });
  sockets.push(ws);
  const frames = [];
  const closed = once(ws, 'close');
  ws.on('message', data => frames.push(JSON.parse(String(data))));
  ws.on('error', () => {});
  await once(ws, 'open');
  await until(() => frames.some(frame => frame.type === 'runs'), 'initial run registry');
  return { ws, frames, closed, send: frame => ws.send(JSON.stringify({ version: 1, ...frame })) };
}
try {
  for (const dir of [path.join(project, '.squad'), home, install]) await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(project, '.squad', 'team.md'),
    '# Synthetic team\n## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n| TestBot | Developer | .squad/agents/test-agent-1/charter.md | Active |\n');
  const packed = JSON.parse(npm(['pack', packageRoot, '--json', '--pack-destination', root]))[0];
  const tarball = path.join(root, packed.filename);
  report.tarball = { sha256: hash(await fs.readFile(tarball)), inventory: packed.files };
  npm(['install', '--prefix', install, '--ignore-scripts', '--no-audit', '--no-fund', tarball], install);
  const installed = path.join(install, 'node_modules', 'squad-pod-observer');
  const require = createRequire(path.join(installed, 'package.json'));
  const nativeRoot = path.dirname(require.resolve('node-pty/package.json'));
  let sourceBuilt = false;
  if (process.platform === 'linux') {
    assert.throws(() => require('node-pty'), /native module|pty\.node/i);
    report.platformLimitations = ['Official node-pty1.1.0 has no Linux prebuild: --ignore-scripts requires a subsequent native source build.'];
    check('Linux ignore-scripts limitation is explicit, not mistaken for native support');
    npm(['rebuild', 'node-pty', '--prefix', install, '--no-audit', '--no-fund'], install);
    sourceBuilt = true;
  } else if (process.platform === 'darwin') {
    const helper = path.join(nativeRoot, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper');
    const mode = (await fs.stat(helper)).mode & 0o777;
    report.ignoreScriptsHelperMode = mode.toString(8);
    assert.equal(mode & 0o111, 0, 'Revisit the documented upstream helper permission limitation if packaging changes');
    await assert.rejects(fs.access(helper, constants.X_OK), { code: 'EACCES' });
    report.platformLimitations = ['Official node-pty1.1.0 macOS prebuild spawn-helper is mode0644 and cannot execute, including after --ignore-scripts. A native source rebuild is required.'];
    check('macOS ignore-scripts helper permission failure is explicit before native source rebuild');
    npm(['rebuild', 'node-pty', '--prefix', install, '--no-audit', '--no-fund'], install,
      { npm_config_build_from_source: 'true' });
    sourceBuilt = true;
  }
  const native = require('node-pty');
  assert.equal(typeof native.spawn, 'function');
  report.native = { version: require('node-pty/package.json').version,
    licenseSha256: hash(await fs.readFile(path.join(nativeRoot, 'LICENSE'))) };
  assert.deepEqual(await fs.readFile(path.join(nativeRoot, 'LICENSE')),
    await fs.readFile(path.join(packageRoot, 'node_modules', 'node-pty', 'LICENSE')));
  const nativeFolder = path.join(nativeRoot, sourceBuilt
    ? 'build/Release' : `prebuilds/${process.platform}-${process.arch}`);
  const nativeFiles = await fs.readdir(nativeFolder, { recursive: true, withFileTypes: true });
  for (const entry of nativeFiles.filter(entry => entry.isFile() && entry.name === 'spawn-helper')) {
    await fs.access(path.join(entry.parentPath, entry.name), constants.X_OK);
  }
  report.native.files = Object.fromEntries(await Promise.all(nativeFiles.filter(entry => entry.isFile() &&
    /(?:\.node|\.dll|\.exe|spawn-helper)$/.test(entry.name)).map(async entry => {
    const filename = path.join(entry.parentPath, entry.name);
    return [path.relative(nativeRoot, filename), hash(await fs.readFile(filename))];
  })));
  assert.ok(Object.keys(report.native.files).some(filename => filename.endsWith('.node')));
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'TERMINAL_NOTICES.md']) {
    assert.deepEqual(await fs.readFile(path.join(installed, name)),
      await fs.readFile(path.join(name === 'TERMINAL_NOTICES.md' ? packageRoot : path.join(packageRoot, '..'), name)));
  }
  for (const name of ['xterm-LICENSE', 'addon-fit-LICENSE']) {
    assert.ok((await fs.readFile(path.join(installed, 'dist', 'terminal-licenses', name))).length > 1000);
  }
  report.serverFiles = Object.fromEntries(await Promise.all(['cli.mjs', 'ptyHost.mjs', 'fixture.mjs'].map(async name =>
    [name, hash(await fs.readFile(path.join(installed, 'dist', name)))])));
  const assets = (await fs.readdir(path.join(installed, 'dist', 'browser', 'assets'))).filter(name => /\.(js|css)$/.test(name)).sort();
  report.browserAssets = Object.fromEntries(await Promise.all(assets.map(async name =>
    [name, hash(await fs.readFile(path.join(installed, 'dist', 'browser', 'assets', name)))])));
  check('isolated tarball, native module, canonical notices and standalone terminal licenses');
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
    NODE_OPTIONS: '', GH_TOKEN: '', GITHUB_TOKEN: '' };
  const child = spawn(process.execPath, [path.join(installed, 'dist', 'cli.mjs'), project, '--port', '0', '--fixture'],
    { cwd: install, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  processes.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => { stdout += String(data); });
  child.stderr.on('data', data => { stderr += String(data); });
  await until(() => {
    if (child.exitCode !== null) throw new Error(`Installed host exited: ${stderr}`);
    return (stdout.match(/\n[A-Za-z0-9_-]{43}\r?\n/g) ?? []).length === 2;
  }, 'installed owned host ready');
  const origin = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const tokens = [...stdout.matchAll(/\n([A-Za-z0-9_-]{43})\r?\n/g)].map(match => match[1]);
  const authenticate = async (route, token) => {
    const response = await fetch(`${origin}/${route}`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    assert.equal(response.status, 204);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const cookie = await authenticate('terminal-auth', tokens[1]);
  const { WebSocket } = require('ws');
  let channel = await connect(WebSocket, origin, cookie);
  channel.send({ type: 'launch', requestId: 'native-acceptance-initial' });
  await until(() => channel.frames.some(frame => frame.type === 'launchResult' &&
    frame.requestId === 'native-acceptance-initial' && frame.result.ok), 'correlated initial launch result');
  await until(() => channel.frames.some(frame => frame.type === 'runs' && frame.runs.length === 1), 'launch inventory');
  const run = channel.frames.filter(frame => frame.type === 'runs').at(-1).runs[0];
  report.run = { runId: run.runId, pid: run.pid };
  channel.send({ type: 'attach', runId: run.runId, cursor: 0 });
  const output = () => channel.frames.filter(frame => frame.type === 'output').map(frame => frame.data).join('');
  await until(() => output().includes('"ready":true'), 'native output through installed transport');
  assert.ok(output().includes(JSON.stringify(realpathSync(project))));
  assert.ok(output().includes(JSON.stringify(['argument with spaces', 'literal"quote', 'trailing\\'])));
  assert.ok(output().includes('\u00e9\u4e2d\ud83d\ude80'));
  const readyLine = output().match(/FIXTURE (\{[^\r\n]*"ready":true[^\r\n]*\})/);
  assert.ok(readyLine);
  const ready = JSON.parse(readyLine[1]);
  assert.equal(ready.pid, run.pid);
  assert.ok(!ready.envKeys.includes('NODE_OPTIONS') && !ready.envKeys.includes('GH_TOKEN'));
  channel.send({ type: 'resize', runId: run.runId, cols: 103, rows: 35 });
  channel.send({ type: 'input', runId: run.runId, data: 'hello \u00e9\u4e2d\ud83d\ude80' });
  await until(() => output().includes('"cols":103,"rows":35') && output().includes('"input":'), 'input and resize');
  check('real installed PTY exact argv/cwd, Unicode, allowlist, input and resize');
  let cursor = Math.max(...channel.frames.filter(frame => frame.type === 'output').map(frame => frame.seq));
  channel.ws.close();
  await channel.closed;
  channel = await connect(WebSocket, origin, cookie);
  channel.send({ type: 'input', runId: run.runId, data: 'disconnected-marker' });
  channel.send({ type: 'attach', runId: run.runId, cursor });
  await until(() => output().includes('disconnected-marker') && channel.frames.some(frame => frame.type === 'replayEnd'), 'reconnect replay/live race');
  const sequences = channel.frames.filter(frame => frame.type === 'output').map(frame => frame.seq);
  assert.equal(new Set(sequences).size, sequences.length);
  assert.equal(sequences[0], cursor + 1);
  assert.equal(channel.frames.find(frame => frame.type === 'runs').runs[0].pid, run.pid);
  check('same PID across disconnect, contiguous replay-before-live and no duplicate sequences');
  channel.send({ type: 'input', runId: run.runId, data: 'BURST' });
  await until(() => output().includes('"burstDone":true'), 'history eviction burst');
  channel.ws.close();
  await channel.closed;
  channel = await connect(WebSocket, origin, cookie);
  channel.send({ type: 'attach', runId: run.runId, cursor: 0 });
  await until(() => channel.frames.some(frame => frame.type === 'resync'), 'explicit history gap');
  const resync = channel.frames.find(frame => frame.type === 'resync');
  assert.equal(resync.reason, 'history-gap');
  assert.ok(resync.earliest > 1);
  await channel.closed;
  channel = await connect(WebSocket, origin, cookie);
  channel.send({ type: 'attach', runId: run.runId, cursor: resync.earliest - 1 });
  await until(() => channel.frames.some(frame => frame.type === 'replayEnd'), 'explicit retained-history resync');
  check('bounded history evicts old output and requires explicit gap recovery');
  channel.send({ type: 'attach', runId: 'test-agent-1', cursor: 0 });
  await until(() => channel.frames.some(frame => frame.type === 'error'), 'observed identity rejection');
  channel.send({ type: 'input', runId: run.runId, data: 'CHILD' });
  await until(() => /"child":\d+/.test(output()), 'owned child');
  const descendant = Number(output().match(/"child":(\d+)/)[1]);
  assert.ok(alive(descendant));
  channel.send({ type: 'terminate', runId: run.runId });
  await until(() => !alive(run.pid) && !alive(descendant), 'owned descendant explicit cleanup');
  await until(() => channel.frames.filter(frame => frame.type === 'runs').at(-1)?.runs.length === 0, 'owned registry cleanup');
  check('observed identity rejected; explicit close cleans owned root and descendant');

  if (process.env.PLAYWRIGHT_MODULE) {
    const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH });
    const tab = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    tab.on('pageerror', error => errors.push(error.message));
    const received = [];
    tab.on('websocket', ws => ws.on('framereceived', event => {
      try { received.push(JSON.parse(String(event.payload))); }
      catch { /* Binary/invalid protocol behavior has separate boundary tests. */ }
    }));
    await tab.goto(origin);
    await tab.getByLabel('Runtime credential from the observer console', { exact: true }).fill(tokens[0]);
    await tab.getByRole('button', { name: 'Connect read-only office', exact: true }).click();
    await tab.locator('.office-panel canvas').waitFor();
    // The following selectors deliberately use visible production controls.
    await tab.locator('#terminal-credential').fill(tokens[1]);
    await tab.getByRole('button', { name: 'Authenticate terminals', exact: true }).click();
    await tab.getByRole('button', { name: 'Launch selected project', exact: true }).click();
    await until(() => received.some(frame => frame.type === 'output' && frame.data.includes('"ready":true')), 'browser native output');
    const desktopBounds = async () => {
      const bounds = await tab.locator('.observer-office-page').boundingBox();
      const viewport = tab.viewportSize();
      return bounds && bounds.width > 0 && bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1;
    };
    await until(desktopBounds, 'desktop office remains horizontally in bounds after correlated launch');
    const browserRun = received.filter(frame => frame.type === 'runs').at(-1).runs[0];
    await tab.locator('.xterm-helper-textarea').focus();
    await tab.keyboard.type('OK');
    const inputs = () => [...received.filter(frame => frame.type === 'output').map(frame => frame.data).join('')
      .matchAll(/FIXTURE (\{[^\r\n]*\})/g)].map(match => JSON.parse(match[1]).input ?? '').join('');
    await until(() => inputs().includes('OK'), 'complete browser input applied');
    const reconnectStart = received.length;
    await tab.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await until(() => received.slice(reconnectStart).some(frame => frame.type === 'replayStart' && frame.cursor > 0),
      'actual browser reconnect uses last applied cursor');
    await tab.getByText('Terminal connected. Office remains read-only.', { exact: true }).waitFor();
    for (const name of ['Edit Layout', 'Directories', 'Settings']) {
      assert.equal(await tab.getByRole('button', { name, exact: true }).isDisabled(), true);
    }
    const squadInfoButton = tab.getByRole('button', { name: 'Squad Info', exact: true });
    assert.equal(await squadInfoButton.isDisabled(), false);
    await squadInfoButton.click();
    const squadInfo = tab.getByRole('dialog', { name: 'Squad Info' });
    await squadInfo.waitFor();
    await squadInfo.getByRole('button', { name: 'Show details for TestBot', exact: true }).click();
    await squadInfo.getByText('Observed status: idle', { exact: true }).waitFor();
    await squadInfo.getByText('Observed activity: No current task observed.', { exact: true }).waitFor();
    await squadInfo.getByText(/Recent activity \(from workspace activity logs/).waitFor();
    await squadInfo.getByText('Charter content is unavailable.', { exact: false }).waitFor();
    assert.equal(await squadInfo.getByRole('button', { name: 'Open charter', exact: true }).isDisabled(), true);
    await squadInfo.getByText('Opening a charter in the editor is unavailable in the read-only observer.', { exact: true }).waitFor();
    check('read-only Squad Info expands observed details and explains unavailable charter opening');
    await fs.mkdir(path.join(project, '.squad', 'log'), { recursive: true });
    await fs.writeFile(path.join(project, '.squad', 'log', '2026-10-30T12-30-00Z-test-agent-1.md'),
      '**Agent:** test-agent-1\n<!-- Synthetic empty scaffolding -->\n');
    await squadInfo.getByText('Observed status: active', { exact: true }).waitFor();
    await squadInfo.getByText('File activity hint: Approximate local file activity (not live tool execution)', { exact: true }).waitFor();
    assert.equal(await squadInfo.getByText('Live task:', { exact: false }).count(), 0);
    check('owned-terminal surface keeps observed file hints distinct from owned execution');
    await squadInfo.getByRole('button', { name: 'Close Squad Info', exact: true }).click();
    if (artifacts) {
      await fs.mkdir(artifacts, { recursive: true });
      await tab.screenshot({ path: path.join(artifacts, 'terminal-desktop.png'), fullPage: true });
      report.screenshots.push('terminal-desktop.png');
    }
    const narrowStart = received.length;
    await tab.setViewportSize({ width: 390, height: 844 });
    await until(() => received.slice(narrowStart).some(frame => frame.type === 'output' && frame.data.includes('"resized":true')),
      'narrow browser resize reaches native PTY');
    await tab.locator('.xterm-helper-textarea').focus();
    await tab.keyboard.type('NARROW');
    await until(() => inputs().includes('NARROW'), 'narrow browser input applied');
    const terminalPanel = tab.locator('.owned-terminal');
    await until(async () => {
      const bounds = await terminalPanel.boundingBox();
      return bounds && Math.abs(bounds.x) <= 1;
    }, 'narrow terminal page settles horizontally in the viewport');
    const narrowBounds = await terminalPanel.boundingBox();
    report.narrowBounds = { viewport: tab.viewportSize(), terminal: narrowBounds,
      layout: await tab.evaluate(() => ({
        innerWidth, screenWidth: screen.width, mobile: matchMedia('(max-width: 700px), (pointer: coarse)').matches,
        trackWidth: document.querySelector('.observer-pages-track').getBoundingClientRect().width,
      })) };
    if (artifacts) {
      await terminalPanel.screenshot({ path: path.join(artifacts, 'terminal-narrow.png') });
      report.screenshots.push('terminal-narrow.png');
    }
    assert.ok(narrowBounds.width <= 391 && narrowBounds.x + narrowBounds.width <= 391,
      `Narrow terminal exceeded viewport: ${JSON.stringify(report.narrowBounds)}`);
    await tab.setViewportSize({ width: 1440, height: 960 });
    await until(desktopBounds, 'returning from narrow to desktop resets the mobile page transform');
    await tab.getByRole('button', { name: 'Squad Info', exact: true }).click();
    await tab.getByRole('dialog', { name: 'Squad Info' }).waitFor();
    await tab.getByRole('button', { name: 'Close Squad Info', exact: true }).click();
    check('desktop office and controls stay in bounds after correlated launch and narrow-to-desktop transition');
    mobileTab = await browser.newPage({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    });
    const mobileErrors = [];
    const mobileReceived = [];
    const mobileSent = [];
    await mobileTab.addInitScript(() => {
      window.syntheticClipboard = { reads: 0, writes: [] };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        readText: async () => {
          window.syntheticClipboard.reads++;
          return 'synthetic mobile paste';
        },
        writeText: async text => {
          window.syntheticClipboard.writes.push(text);
        },
      } });
    });
    mobileTab.on('pageerror', error => mobileErrors.push(error.message));
    mobileTab.on('websocket', ws => {
      ws.on('framereceived', event => {
        try { mobileReceived.push(JSON.parse(String(event.payload))); }
        catch { /* Invalid frames are asserted at the client/server boundaries. */ }
      });
      ws.on('framesent', event => {
        try { mobileSent.push(JSON.parse(String(event.payload))); }
        catch { /* Non-JSON frames have separate protocol coverage. */ }
      });
    });
    await mobileTab.goto(origin);
    await mobileTab.getByLabel('Runtime credential from the observer console', { exact: true }).fill(tokens[0]);
    await mobileTab.getByRole('button', { name: 'Connect read-only office', exact: true }).click();
    await mobileTab.locator('.office-panel canvas').waitFor();
    assert.equal(await mobileTab.getByRole('button', { name: 'Edit Layout', exact: true }).count(), 0,
      'mobile must hide the desktop layout editor');
    for (const name of ['Directories', 'Settings']) {
      assert.equal(await mobileTab.getByRole('button', { name, exact: true }).isDisabled(), true,
        `read-only mobile must not enable ${name}`);
    }
    assert.ok(await mobileTab.getByRole('button', { name: 'Squad Info', exact: true }).count());
    await mobileTab.getByRole('button', { name: 'Show terminal', exact: true }).click();
    await mobileTab.locator('#terminal-credential').fill(tokens[1]);
    await mobileTab.getByRole('button', { name: 'Authenticate terminals', exact: true }).click();
    const firstRunCard = mobileTab.locator(`button[aria-label$="process ${browserRun.pid}"]`);
    await firstRunCard.waitFor();
    await firstRunCard.click();
    await mobileTab.locator('.observer-mobile-stage[data-mobile-view="terminal"]').waitFor();
    await mobileTab.locator('.terminal-screen .xterm').waitFor();
    await mobileTab.getByText('Terminal connected. Office remains read-only.', { exact: true }).waitFor();
    assert.equal(await mobileTab.evaluate(() =>
      window.syntheticClipboard.reads), 0,
    'terminal must never read clipboard automatically');
    await mobileTab.getByRole('button', { name: 'Select all', exact: true }).click();
    await mobileTab.getByRole('button', { name: 'Copy selection', exact: true }).click();
    await until(async () => await mobileTab.evaluate(() =>
      window.syntheticClipboard.writes.length) > 0,
    'explicit synthetic copy');
    await mobileTab.getByRole('button', { name: 'Paste', exact: true }).click();
    await until(async () => await mobileTab.evaluate(() =>
      window.syntheticClipboard.reads) === 1,
    'explicit synthetic clipboard read');
    await until(() => mobileReceived.some(frame => frame.type === 'output' &&
      frame.data.includes('synthetic mobile paste')), 'synthetic clipboard input reaches PTY');
    await mobileTab.getByRole('button', { name: 'Ctrl+D', exact: true }).click();
    await until(() => mobileReceived.some(frame => frame.type === 'output' &&
      frame.data.includes('"input":"\\u0004"')), 'mobile keyboard accessory input reaches PTY');
    await mobileTab.getByRole('button', { name: 'Show office', exact: true }).click();
    await mobileTab.locator('.observer-mobile-stage[data-mobile-view="office"]').waitFor();
    await until(async () => Math.abs((await mobileTab.locator('.observer-office-page').boundingBox()).x) <= 1,
      'office page settles before canvas touch gestures');
    const cdp = await mobileTab.context().newCDPSession(mobileTab);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    const officePanel = mobileTab.locator('.office-panel');
    const canvas = officePanel.locator('canvas');
    await until(() => canvas.evaluate(element =>
      Math.abs(element.width - element.getBoundingClientRect().width * 3) <= 1),
    'mobile canvas uses DPR 3 backing store with CSS-sized viewport');
    const followObservedAgent = async () => {
      await mobileTab.locator('[data-agent-label="test-agent-1"]').click();
      await mobileTab.getByRole('button', { name: 'Close agent details', exact: true }).click();
      await until(async () => await officePanel.getAttribute('data-following-agent') === 'test-agent-1',
        'observed-agent selection starts office camera follow without terminal authority');
    };
    const touchPoints = points => points.map(([x, y], id) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 }));
    const canvasBounds = await canvas.boundingBox();
    assert.ok(canvasBounds);
    const center = { x: canvasBounds.x + canvasBounds.width / 2, y: canvasBounds.y + canvasBounds.height * 0.75 };
    await followObservedAgent();
    assert.equal(await mobileTab.evaluate(({ x, y }) =>
      document.elementFromPoint(x, y)?.tagName, center), 'CANVAS',
    'manual camera gestures start on the canvas, not an observed-agent label overlay');
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: touchPoints([[center.x - 30, center.y], [center.x + 30, center.y]]),
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: touchPoints([[center.x - 70, center.y], [center.x + 70, center.y]]),
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await officePanel.getAttribute('data-following-agent'), 'test-agent-1',
      'pure pinch must preserve production camera follow');
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: touchPoints([[center.x - 30, center.y], [center.x + 30, center.y]]),
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: touchPoints([[center.x, center.y + 20], [center.x + 60, center.y + 20]]),
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await until(async () => await officePanel.getAttribute('data-following-agent') === '',
      'two-finger office translation breaks production camera follow');
    await followObservedAgent();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: touchPoints([[center.x, center.y]]),
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: touchPoints([[center.x + 30, center.y + 20]]),
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await until(async () => await officePanel.getAttribute('data-following-agent') === '',
      'one-finger office pan breaks production camera follow');
    check('installed Edge DPR 3 touch: observed-agent camera follow survives pure pinch and ends on one/two-finger manual pan');
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: touchPoints([[385, center.y]]),
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: touchPoints([[305, center.y]]),
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: touchPoints([[305, center.y], [200, center.y]]),
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await until(async () => {
      const bounds = await mobileTab.locator('.observer-office-page').boundingBox();
      return bounds && Math.abs(bounds.x) <= 1;
    }, 'second finger cancels claimed edge navigation and settles original office page');
    assert.equal(await mobileTab.locator('.observer-mobile-stage').getAttribute('data-mobile-view'), 'office');
    check('installed Edge second-finger interruption settles a claimed edge swipe without changing pages');
    const swipe = async (direction) => {
      const startX = direction === 'left' ? 385 : 5;
      const endX = direction === 'left' ? 160 : 230;
      const currentPage = mobileTab.locator(direction === 'left' ? '.observer-office-page' : '.observer-terminal-page');
      await until(async () => {
        const bounds = await currentPage.boundingBox();
        return bounds && Math.abs(bounds.x) <= 1;
      }, 'current page settles before the next edge swipe');
      const surface = direction === 'left' ? canvas : mobileTab.locator('.owned-terminal > header');
      const bounds = await surface.boundingBox();
      assert.ok(bounds, 'edge swipe requires a visible non-control surface');
      const y = bounds.y + bounds.height / 2;
      const hit = await mobileTab.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return element && { tag: element.tagName, className: element.className, text: element.textContent?.slice(0, 100) };
      }, { x: startX, y });
      (report.swipes ??= []).push({ direction, bounds, startX, y, hit });
      assert.ok(hit, 'edge swipe starts inside the visible viewport');
      assert.equal(await mobileTab.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest(
        'button, input, select, textarea, a, [role="button"], [contenteditable="true"], [data-mobile-gesture-optout]',
      ), { x: startX, y }), false, 'edge navigation must not start on an opted-out terminal or control');
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x: startX, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
      });
      for (const x of direction === 'left' ? [330, 260, endX] : [70, 145, endX]) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
        });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipe('left');
    await mobileTab.locator('.observer-mobile-stage[data-mobile-view="terminal"]').waitFor();
    await swipe('right');
    await mobileTab.locator('.observer-mobile-stage[data-mobile-view="office"]').waitFor();
    await cdp.detach();
    const mobileLaunchCount = mobileSent.filter(frame => frame.type === 'launch').length;
    await mobileTab.getByRole('button', { name: 'Show terminal', exact: true }).click();
    await mobileTab.getByRole('button', { name: 'Launch owned terminal', exact: true }).click();
    await mobileTab.locator('.observer-mobile-stage[data-mobile-view="terminal"]').waitFor();
    const mobileLaunch = mobileSent.filter(frame => frame.type === 'launch').at(-1);
    assert.ok(mobileLaunch?.requestId);
    await until(() => mobileReceived.some(frame => frame.type === 'launchResult' &&
      frame.requestId === mobileLaunch.requestId && frame.result.ok), 'correlated mobile launch');
    const mobileLaunchResult = mobileReceived.find(frame => frame.type === 'launchResult' &&
      frame.requestId === mobileLaunch.requestId && frame.result.ok);
    await until(() => mobileTab.locator('button[aria-label^="Owned terminal"]').count().then(count => count === 2),
      'two owned-run cards match the registry after launch');
    assert.equal(await mobileTab.getByRole('button', { name: 'Launch owned terminal', exact: true }).count(), 1);
    const launchesAfter = mobileSent.filter(frame => frame.type === 'launch').length;
    assert.equal(launchesAfter, mobileLaunchCount + 1, 'mobile launch card sends exactly one launch');
    const mobileRun = mobileReceived.filter(frame => frame.type === 'runs').at(-1).runs
      .find(entry => entry.runId === mobileLaunchResult.result.runId);
    assert.ok(mobileRun, 'correlated result must appear in owned run inventory');
    await until(() => mobileReceived.some(frame => frame.type === 'output' && frame.runId === mobileRun.runId &&
      frame.data.includes('"ready":true')), 'mobile launch opens its exact PTY');
    const mobileRunCard = mobileTab.locator(`button[aria-label$="process ${mobileRun.pid}"]`);
    await mobileTab.getByRole('button', { name: 'Show office', exact: true }).click();
    await mobileRunCard.click();
    await mobileTab.locator('.observer-mobile-stage[data-mobile-view="terminal"]').waitFor();
    assert.equal(mobileSent.filter(frame => frame.type === 'launch').length, launchesAfter,
      'card and toggle navigation must not launch additional processes');
    const landscapeStart = mobileReceived.length;
    await mobileTab.setViewportSize({ width: 844, height: 390 });
    await until(() => mobileReceived.slice(landscapeStart).some(frame => frame.type === 'output' &&
      frame.data.includes('"resized":true')), 'landscape orientation resize reaches native PTY');
    const portraitStart = mobileReceived.length;
    await mobileTab.setViewportSize({ width: 390, height: 844 });
    await until(() => mobileReceived.slice(portraitStart).some(frame => frame.type === 'output' &&
      frame.data.includes('"resized":true')), 'portrait orientation resize reaches native PTY');
    if (artifacts) {
      await fs.mkdir(artifacts, { recursive: true });
      await mobileTab.getByRole('button', { name: 'Show office', exact: true }).click();
      await mobileTab.locator('.observer-mobile-stage[data-mobile-view="office"]').waitFor();
      await mobileTab.screenshot({ path: path.join(artifacts, 'terminal-mobile-portrait.png'), fullPage: true });
      await mobileTab.setViewportSize({ width: 844, height: 390 });
      await mobileTab.screenshot({ path: path.join(artifacts, 'terminal-mobile-landscape.png'), fullPage: true });
      report.screenshots.push('terminal-mobile-portrait.png', 'terminal-mobile-landscape.png');
    }
    assert.deepEqual(mobileErrors, []);
    check('installed Edge touch emulation: mobile editor suppression, exact owned-run cards, correlated launch, edge swipes, explicit synthetic clipboard and keyboard input');
    await mobileTab.context().close();
    mobileTab = undefined;
    channel.send({ type: 'terminate', runId: mobileRun.runId });
    await until(() => !alive(mobileRun.pid), 'mobile acceptance PTY cleanup');
    await tab.reload();
    await tab.getByLabel('Runtime credential from the observer console', { exact: true }).fill(tokens[0]);
    await tab.getByRole('button', { name: 'Connect read-only office', exact: true }).click();
    const start = received.length;
    await tab.locator('#terminal-credential').fill(tokens[1]);
    await tab.getByRole('button', { name: 'Authenticate terminals', exact: true }).click();
    await until(() => received.slice(start).some(frame => frame.type === 'runs' && frame.runs.some(run => run.pid === browserRun.pid)), 'same PID after actual reload');
    await until(() => received.slice(start).some(frame => frame.type === 'output' && frame.data.includes('"ready":true')),
      'actual reload reconstructs retained terminal output');
    assert.ok(alive(browserRun.pid));
    await tab.getByRole('button', { name: 'Close run…', exact: true }).click();
    await tab.getByRole('button', { name: 'Confirm terminate owned process', exact: true }).click();
    await until(() => !alive(browserRun.pid), 'production close control terminates owned run');
    assert.deepEqual(errors, []);
    check('installed Edge production renderer/terminal: input, reload same PID, desktop/narrow screenshots, strict CSP and read-only office');
    await browser.close();
    browser = undefined;
  }
  // One owned child survives viewer revocation, then shutdown reaps both.
  const registryStart = channel.frames.length;
  const previousRuns = new Set(channel.frames.filter(frame => frame.type === 'runs').at(-1)?.runs.map(run => run.runId));
  channel.send({ type: 'launch', requestId: 'native-acceptance-shutdown' });
  await until(() => channel.frames.some(frame => frame.type === 'launchResult' &&
    frame.requestId === 'native-acceptance-shutdown' && frame.result.ok), 'correlated shutdown launch result');
  await until(() => channel.frames.slice(registryStart).some(frame => frame.type === 'runs' &&
    frame.runs.some(run => !previousRuns.has(run.runId))), 'shutdown fixture');
  const shutdownRun = channel.frames.filter(frame => frame.type === 'runs').at(-1).runs.at(-1);
  const outputStart = channel.frames.length;
  channel.send({ type: 'attach', runId: shutdownRun.runId, cursor: 0 });
  await until(() => channel.frames.slice(outputStart).some(frame => frame.type === 'output' &&
    frame.data.includes('"ready":true')), 'shutdown ready');
  channel.send({ type: 'input', runId: shutdownRun.runId, data: 'CHILD' });
  await until(() => /"child":\d+/.test(output()), 'shutdown descendant');
  const shutdownChild = Number([...output().matchAll(/"child":(\d+)/g)].at(-1)[1]);
  const closed = once(channel.ws, 'close');
  child.stdin.write('rotate\n');
  await closed;
  assert.ok(alive(shutdownRun.pid));
  child.stdin.write('quit\n');
  await until(() => child.exitCode !== null, 'host shutdown');
  assert.equal(child.exitCode, 0, stderr);
  await until(() => !alive(shutdownRun.pid) && !alive(shutdownChild), 'shutdown descendant cleanup');
  assert.deepEqual(await fs.readdir(home), []);
  assert.equal(stderr, '');
  check('revocation detaches without killing owned process; shutdown cleans owned descendants; synthetic home remains empty');
} catch (error) {
  report.failures.push(String(error.stack ?? error));
  process.exitCode = 1;
  console.error(error);
  if (artifacts && mobileTab && !mobileTab.isClosed()) {
    await mobileTab.screenshot({ path: path.join(artifacts, 'mobile-failure.png'), fullPage: true });
    report.screenshots.push('mobile-failure.png');
  }
} finally {
  await mobileTab?.context().close();
  await browser?.close();
  for (const ws of sockets) ws.terminate();
  for (const child of processes) {
    if (child.exitCode === null) {
      child.stdin.write('quit\n');
      try { await until(() => child.exitCode !== null, 'cleanup host', 12_000); }
      catch { child.kill(); }
    }
  }
  report.cleanup = { tempRoot: root, hostProcessesExited: processes.every(child => child.exitCode !== null) };
  if (artifacts) {
    await fs.mkdir(artifacts, { recursive: true });
    await fs.writeFile(path.join(artifacts, 'terminal-report.json'), JSON.stringify(report, null, 2));
    await fs.copyFile(path.join(root, 'squad-pod-observer-0.1.0.tgz'), path.join(artifacts, 'squad-pod-observer-0.1.0.tgz')).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
