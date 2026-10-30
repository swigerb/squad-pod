import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'squad office installed acceptance '));
const project = path.join(root, 'selected synthetic project with spaces');
const home = path.join(root, 'empty synthetic home');
const install = path.join(root, 'installed package with spaces');
const artifacts = process.env.OFFICE_ARTIFACTS;
const report = { mode: 'installed synthetic office control (no native VS Code or real Squad)',
  head: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: packageRoot, encoding: 'utf8' }).stdout.trim(),
  sourceDirty: spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: packageRoot, encoding: 'utf8' }).stdout.trim(),
  checks: [], screenshots: [], failures: [] };
let child;
let context;
let browser;
let diagnosticPage;
const controlTrace = [];
const layoutFile = path.join(project, '.squad-pod', 'layout.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function check(name) { report.checks.push(name); console.log(`PASS ${name}`); }
function npm(args, cwd = packageRoot) {
  const cli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`npm ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
async function until(predicate, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${description}`);
}
async function digest(folder) {
  const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
  return Object.fromEntries(await Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
    const file = path.join(entry.parentPath, entry.name);
    return [path.relative(folder, file), hash(await fs.readFile(file))];
  })));
}
try {
  if (!process.env.PLAYWRIGHT_MODULE) throw new Error('PLAYWRIGHT_MODULE must identify an already installed Playwright module; no browser downloads are performed.');
  for (const dir of [path.join(project, '.squad'), home, install]) await fs.mkdir(dir, { recursive: true });
  const teamFile = path.join(project, '.squad', 'team.md');
  await fs.writeFile(teamFile, '# Synthetic team\n## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n| TestBot | Developer | .squad/agents/test-agent-1/charter.md | Active |\n');
  const teamBytes = await fs.readFile(teamFile);
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const packed = JSON.parse(npm(['pack', packageRoot, '--json', '--pack-destination', root]))[0];
  report.tarball = { sha256: hash(await fs.readFile(path.join(root, packed.filename))), files: packed.files.map(file => file.path) };
  const runtime = Object.keys(manifest.dependencies).map(name => {
    const dep = JSON.parse(npm(['pack', path.join(packageRoot, 'node_modules', name), '--json', '--pack-destination', root]))[0];
    return path.join(root, dep.filename);
  });
  npm(['install', '--prefix', install, '--cache', path.join(root, 'empty npm cache'), '--ignore-scripts',
    '--offline', '--omit=optional', '--no-audit', '--no-fund', path.join(root, packed.filename), ...runtime], install);
  const installed = path.join(install, 'node_modules', 'squad-pod-observer');
  const installDigest = await digest(install);
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
    NODE_OPTIONS: '', GH_TOKEN: '', GITHUB_TOKEN: '' };
  child = spawn(process.execPath, [path.join(installed, 'dist', 'cli.mjs'), project, '--port', '0', '--office-control'],
    { cwd: install, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let stderr = '';
  child.stdout.on('data', data => { output += String(data); });
  child.stderr.on('data', data => { stderr += String(data); });
  await until(() => {
    if (child.exitCode !== null) throw new Error(`Installed host exited: ${stderr}`);
    return [...output.matchAll(/\n([A-Za-z0-9_-]{43})\r?\n/g)].length === 3;
  }, 'installed office-control host');
  const origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const credentials = [...output.matchAll(/\n([A-Za-z0-9_-]{43})\r?\n/g)].map(match => match[1]);
  check('private tarball installed offline, isolated paths with spaces and empty synthetic home');
  const { chromium } = await import(path.isAbsolute(process.env.PLAYWRIGHT_MODULE)
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : process.env.PLAYWRIGHT_MODULE);
  await fs.mkdir(path.join(root, 'browser temp'));
  browser = await chromium.launch({
    executablePath: process.env.EDGE_PATH, headless: true,
    timeout: 20_000,
  });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(10_000);
  context.setDefaultNavigationTimeout(15_000);
  const page = await context.newPage();
  diagnosticPage = page;
  const controlSockets = [];
  const sentControlFrames = [];
  await page.routeWebSocket('**/control', route => {
    route.connectToServer();
    controlSockets.push(route);
  });
  page.on('websocket', socket => {
    if (socket.url().endsWith('/control')) {
      socket.on('framesent', frame => {
        const value = JSON.parse(String(frame.payload));
        if (value.kind === 'control') {
          sentControlFrames.push(value.requestId);
          controlTrace.push({ at: Date.now(), direction: 'sent', value });
        }
      });
      socket.on('framereceived', frame => {
        controlTrace.push({ at: Date.now(), direction: 'received', value: JSON.parse(String(frame.payload)) });
      });
    }
  });
  check('owned headless browser launched');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function authenticate(control = true) {
    await page.goto(origin);
    await page.getByLabel('Use separate office-control authority', { exact: false }).setChecked(control);
    await page.locator('#credential').fill(credentials[control ? 2 : 0]);
    await page.getByRole('button', { name: control ? 'Connect office control' : 'Connect read-only office', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Layout', exact: true }).waitFor();
    await until(() => page.evaluate(() => !!document.querySelector('canvas')?.width), 'office canvas ready');
  }
  await authenticate(false);
  check('read-only viewer authenticated in installed browser');
  assert.equal(await page.getByRole('button', { name: 'Edit Layout', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Settings', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Authenticate again', exact: true }).click();
  await page.getByLabel('Use separate office-control authority', { exact: false }).check();
  await page.locator('#credential').fill(credentials[2]);
  await page.getByRole('button', { name: 'Connect office control', exact: true }).click();
  check('office-control form submitted with separate authority');
  assert.equal(await page.getByRole('button', { name: 'Directories', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Squad Info', exact: true }).click();
  await page.getByRole('button', { name: 'Show details for TestBot', exact: true }).click();
  await page.getByText('Charter content is unavailable.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Open charter', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Close Squad Info', exact: true }).click();
  check('office control preserves observed Squad Info and correlated details without native charter authority');
  await page.getByRole('button', { name: 'Edit Layout', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Layout editor' });
  await editor.getByTitle('Pets', { exact: true }).click();
  const pet = editor.locator('button[data-pet-type]').first();
  const petType = Number(await pet.getAttribute('data-pet-type'));
  await pet.click();
  await editor.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
  assert.equal(await pet.getAttribute('aria-pressed'), 'false');
  await editor.getByTitle('Redo (Ctrl+Y)', { exact: true }).click();
  assert.equal(await pet.getAttribute('aria-pressed'), 'true');
  await editor.getByRole('button', { name: /Save Layout/ }).click();
  await until(async () => {
    try { return JSON.parse(await fs.readFile(layoutFile, 'utf8')).pets?.some(p => p.petType === petType); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }, 'committed pet bytes');
  const initial = JSON.parse(await fs.readFile(layoutFile, 'utf8'));
  assert.equal(initial.pets.length, 1);
  check('actual shared editor pet mutation, undo/redo and committed layout bytes');
  await page.reload();
  await authenticate();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Show Named Areas', { exact: true }).click();
  const preferencesFile = path.join(project, '.squad-pod', 'office-preferences.json');
  await until(async () => {
    try { return JSON.parse(await fs.readFile(preferencesFile, 'utf8')).settings.showAreas; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }, 'acknowledged settings bytes');
  assert.equal(await page.locator('#squad-pod-live-activity').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Add Asset Directory', exact: true }).count(), 0);
  await fs.writeFile(`${preferencesFile}.lock`, 'synthetic preferences writer');
  await page.getByLabel('Sound Notifications', { exact: true }).click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).locator('..').getByRole('button').click();
  await page.getByText(/Office save failed:/).waitFor();
  assert.equal(JSON.parse(await fs.readFile(preferencesFile, 'utf8')).settings.soundEnabled, false);
  const preferenceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export preference draft', exact: true }).click();
  const failedPreference = JSON.parse(await fs.readFile(await (await preferenceDownload).path(), 'utf8'));
  assert.deepEqual(failedPreference, { type: 'setSoundEnabled', enabled: true });
  await page.reload();
  await authenticate();
  await page.getByText('Unacknowledged settings/seat draft', { exact: true }).waitFor();
  assert.equal(JSON.parse(await fs.readFile(preferencesFile, 'utf8')).settings.soundEnabled, false);
  await fs.unlink(`${preferencesFile}.lock`);
  await page.getByRole('button', { name: 'Retry this preference change deliberately', exact: true }).click();
  await until(async () => JSON.parse(await fs.readFile(preferencesFile, 'utf8')).settings.soundEnabled, 'deliberate recovered preference retry');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  check('failed preference change exports, survives reload without replay and commits only on deliberate retry');
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Layout', exact: true }).click();
  const download = await downloadWait;
  const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  assert.deepEqual(exported.pets, initial.pets);
  const imported = { ...initial, pets: [], areas: [{ label: 'Synthetic area', color: '#123456' }],
    areaTiles: Array(initial.cols * initial.rows).fill(null), areaMappings: {} };
  const chooserWait = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import Layout', exact: true }).click();
  const chooser = await chooserWait;
  await chooser.setFiles({ name: 'synthetic-import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await page.getByRole('heading', { name: 'Settings', exact: true }).locator('..').getByRole('button').click();
  await page.getByRole('button', { name: 'Edit Layout', exact: true }).click();
  await page.getByRole('region', { name: 'Layout editor' }).getByRole('button', { name: /Save Layout/ }).click();
  await until(async () => JSON.parse(await fs.readFile(layoutFile, 'utf8')).areas?.[0]?.label === 'Synthetic area', 'import saved');
  check('reload persisted layout, acknowledged Areas settings, deliberate bounded browser import/export and unavailable native-only controls');
  // Keep a dirty local draft, then introduce an external version before save.
  await page.getByRole('region', { name: 'Layout editor' }).getByTitle('Pets', { exact: true }).click();
  await page.getByRole('region', { name: 'Layout editor' }).locator('button[data-pet-type]').first().click();
  const external = { ...imported, areas: [{ label: 'External area', color: '#654321' }] };
  await fs.writeFile(layoutFile, JSON.stringify(external));
  const recovery = page.getByRole('region', { name: 'Layout recovery' });
  await recovery.getByText(/Layout conflict:/).waitFor();
  const beforeResolve = await fs.readFile(layoutFile, 'utf8');
  await page.getByRole('region', { name: 'Layout editor' }).getByRole('button', { name: /Save Layout/ }).click();
  assert.equal(await fs.readFile(layoutFile, 'utf8'), beforeResolve);
  await page.reload();
  await authenticate();
  await page.getByRole('region', { name: 'Layout recovery' }).getByText(/Layout conflict:/).waitFor();
  await page.getByRole('region', { name: 'Layout recovery' }).getByText('Inspect local draft', { exact: true }).click();
  const recoveryDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export local draft', exact: true }).click();
  const recovered = JSON.parse(await fs.readFile(await (await recoveryDownload).path(), 'utf8'));
  assert.equal(recovered.pets.length, 1);
  assert.equal(recovered.areas[0].label, 'Synthetic area');
  await page.getByRole('button', { name: /Keep local draft #/ }).click();
  await page.getByRole('button', { name: 'Edit Layout', exact: true }).click();
  await page.getByRole('region', { name: 'Layout editor' }).getByRole('button', { name: /Save Layout/ }).click();
  await until(async () => JSON.parse(await fs.readFile(layoutFile, 'utf8')).pets?.length === 1, 'resolved draft commit');
  report.beforeLock = {
    at: Date.now(), controlTrace: structuredClone(controlTrace),
    ui: await page.locator('body').innerText(),
    lock: await fs.readFile(`${layoutFile}.lock`, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }),
  };
  check('external conflict does not overwrite; dirty draft survives browser reload, exports and explicitly resolves');
  // An exclusive cooperating-writer lock forces a recoverable storage failure.
  await fs.writeFile(`${layoutFile}.lock`, 'synthetic competing writer');
  await page.getByRole('region', { name: 'Layout editor' }).getByTitle('Pets', { exact: true }).click();
  await page.getByRole('region', { name: 'Layout editor' }).locator('button[data-pet-type]').first().click();
  await page.getByRole('region', { name: 'Layout editor' }).getByRole('button', { name: /Save Layout/ }).click();
  await page.getByText(/Office save failed:/).waitFor();
  report.lockedFailure = { at: Date.now(), controlTrace: structuredClone(controlTrace),
    layout: JSON.parse(await fs.readFile(layoutFile, 'utf8')), lock: await fs.readFile(`${layoutFile}.lock`, 'utf8') };
  assert.equal(JSON.parse(await fs.readFile(layoutFile, 'utf8')).pets.length, 1);
  await fs.unlink(`${layoutFile}.lock`);
  await page.getByRole('region', { name: 'Layout editor' }).getByRole('button', { name: /Save Layout/ }).click();
  await until(async () => JSON.parse(await fs.readFile(layoutFile, 'utf8')).pets.length === 0, 'retry after storage failure');
  check('failed storage save remains visible with draft; deliberate retry commits after fault removed');
  const beforeReconnect = await fs.readFile(layoutFile, 'utf8');
  const mutationsBeforeReconnect = sentControlFrames.length;
  await controlSockets.at(-1).close({ code: 1012, reason: 'Synthetic transient office disconnect' });
  await page.getByText(/Disconnected - retrying observation only/).waitFor();
  await page.getByText('Connected - selected-project office control', { exact: true }).waitFor();
  assert.equal(await fs.readFile(layoutFile, 'utf8'), beforeReconnect);
  assert.equal(sentControlFrames.length, mutationsBeforeReconnect);
  const savedRecovery = await page.evaluate(() => Object.entries(localStorage));
  assert.ok(savedRecovery.length > 0);
  for (const [key, value] of savedRecovery) {
    assert.match(key, /^squad-office:[A-Za-z0-9_-]{43}:[a-f0-9]{64}(?::preferences)?$/);
    for (const token of credentials) assert.ok(!value.includes(token) && !key.includes(token));
  }
  check('reconnect sends no replayed mutation; recovery scoped to server/project with credentials absent');
  if (artifacts) {
    await fs.mkdir(artifacts, { recursive: true });
    await page.getByRole('region', { name: 'Layout recovery' }).getByText('Inspect local draft', { exact: true }).click();
    await page.screenshot({ path: path.join(artifacts, 'office-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Exit Layout Editor', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(artifacts, 'office-narrow.png'), fullPage: true });
    report.screenshots = ['office-desktop.png', 'office-narrow.png'];
  }
  await context.close(); context = undefined;
  await browser.close(); browser = undefined;
  child.stdin.write('quit\n');
  await once(child, 'exit');
  child = undefined;
  assert.deepEqual(await fs.readFile(teamFile), teamBytes);
  assert.deepEqual(await fs.readdir(home), []);
  assert.deepEqual(await digest(install), installDigest);
  const projectFiles = Object.keys(await digest(project));
  assert.ok(projectFiles.every(file => file === path.join('.squad', 'team.md')
    || file === path.join('.squad-pod', 'layout.json') || file === path.join('.squad-pod', 'office-preferences.json')
    || file.startsWith(path.join('.squad-pod', 'recovery') + path.sep)));
  assert.deepEqual(errors, []);
  check('fixture roster and installed bytes unchanged, empty synthetic home untouched; only owned office state/recovery project targets written');
} catch (error) {
  report.failures.push(error instanceof Error ? error.message : String(error));
  if (artifacts && diagnosticPage && !diagnosticPage.isClosed()) {
    await fs.mkdir(artifacts, { recursive: true });
    const readDiagnostic = async file => {
      try { return await fs.readFile(file, 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    };
    await fs.writeFile(path.join(artifacts, 'office-failure.json'), JSON.stringify({
      at: Date.now(), controlTrace,
      ui: await diagnosticPage.locator('body').innerText(),
      layout: await readDiagnostic(layoutFile),
      lock: await readDiagnostic(`${layoutFile}.lock`),
    }, null, 2));
    await diagnosticPage.screenshot({ path: path.join(artifacts, 'office-failure.png'), fullPage: true });
  }
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser?.close();
  if (child && child.exitCode === null) {
    child.stdin.write('quit\n');
    await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill();
  }
  if (artifacts) {
    await fs.mkdir(artifacts, { recursive: true });
    await fs.writeFile(path.join(artifacts, 'office-report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
  await fs.rm(root, { recursive: true, force: true });
}
