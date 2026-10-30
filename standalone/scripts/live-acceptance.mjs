import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Fixture-only installed acceptance. Never use a real Copilot home or launch AI.
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'squad live installed acceptance '));
const project = path.join(root, 'synthetic project with spaces');
const home = path.join(root, 'synthetic home with spaces');
const install = path.join(root, 'isolated install with spaces');
const artifacts = process.env.LIVE_ARTIFACTS;
const sockets = [];
const processes = [];
let browser;
const secret = 'PRIVATE_FIXTURE_PROMPT_OUTPUT_SENTINEL';
const report = {
  mode: 'installed synthetic live observation; no real Squad or private logs',
  platform: `${process.platform}-${process.arch}`, node: process.version,
  head: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: packageRoot, encoding: 'utf8' }).stdout.trim(),
  dirty: spawnSync('git', ['status', '--porcelain'], { cwd: packageRoot, encoding: 'utf8' }).stdout.trim(),
  checks: [], screenshots: [], failures: [],
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function check(name) { report.checks.push(name); console.log(`PASS ${name}`); }
function npm(args, cwd = packageRoot) {
  const cli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`npm ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
async function until(predicate, description, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${description}`);
}
async function digest(folder) {
  const entries = [];
  for (const entry of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    entries.push([entry.name, entry.isDirectory() ? await digest(path.join(folder, entry.name))
      : hash(await fs.readFile(path.join(folder, entry.name)))]);
  }
  return hash(JSON.stringify(entries));
}
const line = (type, data, agentId) => JSON.stringify({ type, data, ...(agentId ? { agentId } : {}) }) + '\n';
const marker = line('subagent.selected', { agentName: 'Squad' });
const running = line('tool.execution_start', { toolCallId: 'fixture-run', toolName: 'task',
  arguments: { name: 'ada', agent_type: 'general-purpose', mode: 'background', description: 'Fixture live task', prompt: secret } })
  + line('subagent.started', { toolCallId: 'fixture-run' });
const transient = line('tool.execution_start', { toolCallId: 'fixture-child', parentToolCallId: 'fixture-run',
  toolName: 'task', arguments: { name: 'Fixture child', agent_type: 'explore', description: 'Fixture transient task' } })
  + line('subagent.selected', { agentName: 'TestBot' }, 'fixture-instance')
  + line('subagent.started', { toolCallId: 'fixture-child' }, 'fixture-instance');
const tool = id => line('tool.execution_start', { toolCallId: id, parentToolCallId: 'fixture-run', toolName: 'view',
  arguments: { path: `/private/${secret}/fixture.ts` } });
const done = id => line('tool.execution_complete', { toolCallId: id, output: secret,
  toolTelemetry: { metrics: { context_current_tokens: 800, context_token_limit: 1000 } } });
async function session(id, cwd, content, age = 0) {
  const directory = path.join(home, 'session-state', id);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'workspace.yaml'), `cwd: ${JSON.stringify(cwd)}\n`);
  const file = path.join(directory, 'events.jsonl');
  await fs.writeFile(file, content);
  const time = new Date(Date.now() - age);
  await fs.utimes(file, time, time);
  await fs.utimes(directory, time, time);
  return file;
}
try {
  for (const directory of [path.join(project, '.squad', 'log'), home, install]) await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(project, '.squad', 'team.md'),
    '# Synthetic team\n## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n| Ada | Developer | .squad/agents/ada/charter.md | Active |\n');
  const file = await session('fixture-session', project, marker);
  await session('wrong-workspace', root, marker + running + tool('wrong'));
  await session('not-squad', project, running + tool('not-squad'));
  const packed = JSON.parse(npm(['pack', packageRoot, '--json', '--pack-destination', root]))[0];
  const tarball = path.join(root, packed.filename);
  report.tarball = { sha256: hash(await fs.readFile(tarball)), inventory: packed.files };
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const dependencies = Object.keys(manifest.dependencies).map(name => {
    const dependency = JSON.parse(npm(['pack', path.join(packageRoot, 'node_modules', name),
      '--json', '--pack-destination', root]))[0];
    return path.join(root, dependency.filename);
  });
  npm(['install', '--prefix', install, '--cache', path.join(root, 'empty npm cache'), '--ignore-scripts',
    '--offline', '--omit=optional', '--no-audit', '--no-fund', tarball, ...dependencies], install);
  const installed = path.join(install, 'node_modules', 'squad-pod-observer');
  report.serverSha256 = hash(await fs.readFile(path.join(installed, 'dist', 'cli.mjs')));
  assert.equal(await digest(path.join(installed, 'dist')), await digest(path.join(packageRoot, 'dist')));
  const require = createRequire(path.join(installed, 'package.json'));
  const { WebSocket } = require('ws');
  check('fresh tarball installed offline, isolated home/paths with spaces, all installed dist bytes equal build');

  async function launch(live) {
    const child = spawn(process.execPath, [path.join(installed, 'dist', 'cli.mjs'), project, '--port', '0',
      ...(live ? ['--live-activity'] : [])], { cwd: install, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
        COPILOT_HOME: home, NODE_OPTIONS: '', GH_TOKEN: '', GITHUB_TOKEN: '' } });
    processes.push(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += String(data); });
    child.stderr.on('data', data => { stderr += String(data); });
    await until(() => {
      if (child.exitCode !== null) throw new Error(`Installed host exited: ${stderr}`);
      return (stdout.match(/\n[A-Za-z0-9_-]{43}\r?\n/g) ?? []).length === 2;
    }, 'installed CLI ready');
    const origin = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const tokens = [...stdout.matchAll(/\n([A-Za-z0-9_-]{43})\r?\n/g)].map(match => match[1]);
    if (live) {
      assert.ok(stdout.includes(home));
      assert.match(stdout, /never prompts or outputs/);
      assert.match(stdout, /not an owned-terminal correlation/);
    } else assert.doesNotMatch(stdout, /Live activity opted in/);
    const auth = await fetch(`${origin}/auth`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tokens[0] }) });
    assert.equal(auth.status, 204);
    const cookie = auth.headers.get('set-cookie').split(';')[0];
    async function connect() {
      const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/office`, { origin, headers: { Cookie: cookie } });
      sockets.push(ws);
      const frames = [];
      ws.on('message', data => frames.push(JSON.parse(String(data))));
      await once(ws, 'open');
      const send = message => ws.send(JSON.stringify({ version: 1, kind: 'office', message }));
      send({ type: 'webviewReady' });
      await until(() => frames.some(frame => frame.message?.type === 'existingAgents'), 'initial office snapshot');
      const latest = type => frames.filter(frame => frame.message?.type === type).at(-1)?.message;
      return { ws, frames, send, latest };
    }
    return { child, origin, tokens, connect };
  }
  async function stop(host) {
    for (const ws of sockets.splice(0)) ws.terminate();
    const exited = once(host.child, 'exit');
    host.child.stdin.write('quit\n');
    const [code] = await exited;
    assert.equal(code, 0);
    await assert.rejects(fetch(host.origin));
  }
  const off = await launch(false);
  let channel = await off.connect();
  assert.equal(channel.latest('sourceStatus').status.liveActivity.state, 'off');
  assert.equal(channel.latest('existingAgents').agents[0].status, 'idle');
  assert.ok(!channel.frames.some(frame => frame.message?.type === 'agentToolStart'));
  await stop(off);
  check('default startup stays off with no live activity from seeded home sessions');

  const before = await digest(project);
  const host = await launch(true);
  channel = await host.connect();
  assert.equal(channel.latest('sourceStatus').status.liveActivity.state, 'following');
  assert.equal(channel.latest('sourceStatus').status.liveActivity.sessionId, 'fixture-');
  assert.equal(channel.latest('existingAgents').agents[0].status, 'idle');
  check('opt-in scope printed; wrong-cwd and non-Squad sessions cannot animate selected member');
  assert.ok(process.env.PLAYWRIGHT_MODULE, 'Set PLAYWRIGHT_MODULE to the approved installed Playwright ESM entry');
  const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
  browser = await chromium.launch({ headless: true,
    ...(process.env.EDGE_PATH ? { executablePath: process.env.EDGE_PATH } : { channel: 'msedge' }) });
  report.browserVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const tab = await context.newPage();
  const browserErrors = [];
  const browserMessages = [];
  function watch(page) {
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('websocket', ws => ws.on('framereceived', event => {
      const frame = JSON.parse(String(event.payload));
      if (frame.message) browserMessages.push(frame.message);
    }));
  }
  watch(tab);
  await tab.goto(host.origin);
  await tab.getByLabel('Runtime credential from the observer console').fill(host.tokens[0]);
  await tab.getByRole('button', { name: 'Connect read-only office' }).click();
  await tab.locator('.office-panel canvas').waitFor();
  await tab.getByRole('button', { name: /^Telemetry/ }).click();
  await tab.getByText('Activity source diagnostics', { exact: true }).click();
  await until(() => tab.evaluate(() => document.body.textContent.includes('Live CLI observer: following')), 'browser live diagnostics');
  assert.equal(await tab.locator('#squad-pod-live-activity').count(), 0);
  for (const label of ['Edit Layout', 'Directories', 'Settings']) {
    assert.equal(await tab.getByRole('button', { name: label, exact: true }).isDisabled(), true);
  }
  await fs.appendFile(file, running + transient + tool('read-one'));
  await until(() => tab.evaluate(() => document.querySelector('[data-agent-tools="ada"]')?.textContent.includes('Reading fixture.ts')), 'live tool rendered');
  await fs.appendFile(file, done('read-one') + tool('read-two'));
  await until(() => tab.evaluate(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '80'), 'live context rendered');
  await until(() => tab.evaluate(() => document.querySelector('[data-observed-task="fixture-run"]')?.textContent.includes('running')), 'bounded transient task rendered');
  await until(() => tab.evaluate(() => document.querySelector('[data-subagent-label]')?.textContent.includes('Fixture child')), 'temporary child character label');
  assert.ok(browserMessages.some(message => message.type === 'observedTasks' && message.snapshot.tasks.some(task =>
    task.toolCallId === 'fixture-child' && task.instanceId === 'fixture-instance' && task.selectedAgentName === 'TestBot')));
  assert.ok(browserMessages.filter(message => message.type === 'existingAgents')
    .every(message => message.agents.length === 1 && message.agents[0].id === 'ada'));
  assert.match(await tab.locator('[aria-label="Squad source status"]').innerText(), /not an owned-terminal correlation/);
  assert.ok(!JSON.stringify(browserMessages).includes(secret));
  assert.ok(!(await tab.locator('body').innerText()).includes(secret));
  if (artifacts) {
    await fs.mkdir(artifacts, { recursive: true });
    await tab.screenshot({ path: path.join(artifacts, 'standalone-live-tool-context.png') });
    report.screenshots.push('standalone-live-tool-context.png');
  }
  check('installed Edge renders whitelisted member tool, 80% context and authoritative transient inventory/temporary child without roster promotion');
  for (const message of [{ type: 'setLiveActivity', enabled: false }, { type: 'launch' },
    { type: 'saveLayout', layout: {} }]) channel.send(message);
  await until(() => channel.frames.filter(frame => frame.code === 'READ_ONLY').length === 3, 'read-only mutation rejections');
  assert.equal(await digest(project), before);
  const swapped = await fetch(`${host.origin}/terminal-auth`, { method: 'POST',
    headers: { Origin: host.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: host.tokens[0] }) });
  assert.equal(swapped.status, 403);
  check('live reads grant no layout/settings/launch/terminal authority and do not write project files');

  // Reload creates a new office subscription and must reconstruct only in-flight tools.
  browserMessages.length = 0;
  await tab.reload();
  await tab.getByLabel('Runtime credential from the observer console').fill(host.tokens[0]);
  await tab.getByRole('button', { name: 'Connect read-only office' }).click();
  await tab.locator('.office-panel canvas').waitFor();
  await until(() => tab.evaluate(() => document.querySelector('[data-agent-tools="ada"]')?.textContent.includes('Reading fixture.ts')), 'reload tool replay');
  assert.ok(browserMessages.some(message => message.type === 'agentToolStart' && message.toolId === 'read-two'));
  assert.ok(!browserMessages.some(message => message.type === 'agentToolStart' && message.toolId === 'read-one'));
  check('reload reconstructs current tool/context without replaying completed tool history or launching a process');
  await fs.appendFile(file, line('subagent.completed', { toolCallId: 'fixture-child' }, 'fixture-instance')
    + line('subagent.completed', { toolCallId: 'fixture-run' }));
  await until(() => tab.evaluate(() => !document.querySelector('[role="progressbar"]')
    && !document.querySelector('[data-agent-tools="ada"]')), 'live completion clears displays');
  const staleFile = await session('stale-session', project, marker + running + tool('stale'), 6 * 60_000);
  // Newest directory candidate but genuinely stale event bytes.
  const time = new Date();
  await fs.utimes(path.dirname(staleFile), time, time);
  await until(() => channel.latest('sourceStatus').status.liveActivity.state === 'searching', 'stale source clears');
  await tab.getByRole('button', { name: /^Telemetry/ }).click();
  await tab.getByText('Activity source diagnostics', { exact: true }).click();
  await until(() => tab.evaluate(() => document.body.textContent.includes('Live CLI observer: searching')), 'browser stale diagnostics');
  assert.equal(await tab.locator('[data-observed-task]').count(), 0);
  if (artifacts) {
    await tab.screenshot({ path: path.join(artifacts, 'standalone-live-stale-cleared.png') });
    report.screenshots.push('standalone-live-stale-cleared.png');
  }
  check('completion and stale source clear member tools/context/tasks instead of reviving old activity');
  assert.deepEqual(browserErrors, []);
  await browser.close(); browser = undefined;
  await stop(host);
  check('graceful owned observer shutdown closes listener and subscriptions');
} catch (error) {
  report.failures.push(String(error));
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const ws of sockets) ws.terminate();
  for (const child of processes) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.stdin.write('quit\n');
    try { await until(() => child.exitCode !== null || child.signalCode !== null, 'fixture host cleanup'); }
    catch (error) {
      report.failures.push(String(error));
      process.exitCode = 1;
      child.kill();
      await until(() => child.exitCode !== null || child.signalCode !== null, 'forced fixture host cleanup');
    }
  }
  report.cleanedUp = processes.every(child => child.exitCode !== null || child.signalCode !== null);
  if (artifacts) {
    await fs.mkdir(artifacts, { recursive: true });
    await fs.writeFile(path.join(artifacts, 'live-report.json'), JSON.stringify(report, null, 2));
  }
  await fs.rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report, (key, value) => key === 'inventory' ? undefined : value, 2));
}
