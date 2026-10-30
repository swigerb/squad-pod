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
  channel.send({ type: 'launch' });
  await until(() => channel.frames.some(frame => frame.type === 'runs' && frame.runs.length === 1), 'launch');
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
      const narrowStart = received.length;
      await tab.setViewportSize({ width: 390, height: 844 });
      await until(() => received.slice(narrowStart).some(frame => frame.type === 'output' && frame.data.includes('"resized":true')),
        'narrow browser resize reaches native PTY');
      await tab.locator('.xterm-helper-textarea').focus();
      await tab.keyboard.type('NARROW');
      await until(() => inputs().includes('NARROW'), 'narrow browser input applied');
      const terminalPanel = tab.locator('.owned-terminal');
      assert.ok((await terminalPanel.boundingBox()).width <= 390);
      await terminalPanel.screenshot({ path: path.join(artifacts, 'terminal-narrow.png') });
      report.screenshots.push('terminal-narrow.png');
    }
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
  channel.send({ type: 'launch' });
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
} finally {
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
