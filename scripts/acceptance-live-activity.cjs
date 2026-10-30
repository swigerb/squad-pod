const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const secret = 'SENTINEL_SECRET_NEVER_LEAVE_PARSER';
const event = (type, data, envelope = {}) => JSON.stringify({ type, data, ...envelope }) + '\n';
const spawn = () => event('tool.execution_start', {
  toolCallId: 'member-run', toolName: 'task', arguments: {
    name: 'ada', agent_type: 'general-purpose', mode: 'background', description: 'Fixture live task', prompt: secret,
  },
}) + event('subagent.started', { toolCallId: 'member-run', agentName: 'general-purpose' }, { agentId: 'internal' });
const tool = (id, name, args) => event('tool.execution_start', {
  toolCallId: id, parentToolCallId: 'member-run', toolName: name, arguments: { ...args, prompt: secret },
});
const done = (id, tokens = 800) => event('tool.execution_complete', {
  toolCallId: id, result: { content: secret }, toolTelemetry: {
    metrics: { context_current_tokens: tokens, context_token_limit: 1000, secret },
  },
});

const guardedMethods = ['openSync', 'readFileSync', 'readdirSync', 'opendirSync', 'statSync', 'lstatSync', 'existsSync', 'realpathSync'];
function monitorFixtureFs(target, { home, extensionRoot = root, realHome = path.join(os.homedir(), '.copilot'), reads = [] }) {
  const inside = (file, directory) => {
    const relative = path.relative(directory, path.resolve(String(file)));
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
  };
  const bundledRoots = ['assets', path.join('webview', 'assets')].map(directory => path.join(extensionRoot, 'dist', directory));
  const check = file => {
    if (inside(file, home)) reads.push(String(file));
    assert.ok(!inside(file, realHome) || bundledRoots.some(directory => inside(file, directory)),
      'must never read the real Copilot home outside known bundled extension assets');
  };
  return new Proxy(target, {
    get(fsTarget, property) {
      const method = fsTarget[property];
      if (!guardedMethods.includes(property)) return method;
      const wrapped = (...args) => { check(args[0]); return method(...args); };
      if (property === 'realpathSync') wrapped.native = (...args) => { check(args[0]); return method.native(...args); };
      return wrapped;
    },
  });
}

function assertFilesystemGuard() {
  const realHome = path.join(os.tmpdir(), 'squad-guard-home');
  const extensionRoot = path.join(realHome, 'session-state', 'fixture', 'files', 'extension');
  let calls = 0;
  const fakeFs = Object.fromEntries(guardedMethods.map(method => [method, () => { calls++; }]));
  fakeFs.realpathSync.native = () => { calls++; };
  const guarded = monitorFixtureFs(fakeFs, { home: path.join(os.tmpdir(), 'injected-home'), extensionRoot, realHome });
  const blocked = [
    realHome, path.join(realHome, 'session-state', 'unrelated', 'events.jsonl'),
    path.join(extensionRoot, 'dist', 'assets-unrelated', 'events.jsonl'),
    path.join(extensionRoot, 'dist', 'assets', '..', '..', 'events.jsonl'),
  ];
  for (const method of [...guardedMethods.map(name => guarded[name]), guarded.realpathSync.native]) {
    const before = calls;
    for (const file of blocked) assert.throws(() => method(file), /must never read the real Copilot home/);
    assert.equal(calls, before, 'blocked paths must never reach the filesystem, including native realpath');
    method(path.join(extensionRoot, 'dist', 'assets', 'floors', 'floor_1.png'));
    method(path.join(extensionRoot, 'dist', 'webview', 'assets', 'characters', 'char_0.png'));
    assert.equal(calls, before + 2, 'only known bundled asset subtrees are exempt inside an artifact home');
  }
  return { blockedPathsPerMethod: blocked.length, guardedMethods: guardedMethods.length + 1, allowedBundledRoots: 2 };
}

/** Only the VS Code boundary is mocked; all homes, workspaces and events are synthetic. */
function createLiveFixture({ extensionCode, baseUrl = 'http://127.0.0.1', consent = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-live-'));
  const workspace = path.join(directory, 'workspace');
  const home = path.join(directory, 'copilot-home');
  const session = path.join(home, 'session-state', 'fixture-session');
  const squad = path.join(workspace, '.squad');
  fs.mkdirSync(squad, { recursive: true });
  fs.mkdirSync(session, { recursive: true });
  fs.writeFileSync(path.join(squad, 'team.md'),
    '## Members\n| Name | Role | Charter |\n| --- | --- | --- |\n| Ada | Developer | .squad/agents/ada/charter.md |\n');
  fs.writeFileSync(path.join(session, 'workspace.yaml'), `cwd: ${JSON.stringify(workspace)}\nsecret: ${secret}\n`);
  const eventsFile = path.join(session, 'events.jsonl');
  fs.writeFileSync(eventsFile, event('subagent.selected', { agentName: 'Squad' }));
  const previousHome = process.env.COPILOT_HOME;
  process.env.COPILOT_HOME = home;
  const messages = [];
  const output = [];
  const confirmations = [];
  const reads = [];
  let allowed = consent;
  let enabled = false;
  let provider, receive, configurationChanged;
  const disposable = { dispose() {} };
  const uri = fsPath => ({ fsPath, toString: () => `file://${fsPath.replaceAll(path.sep, '/')}` });
  const config = {
    get(key, fallback) { return key === 'liveActivity' ? enabled : key === 'directorySuggestions' ? false : fallback; },
    async update(key, value) {
      assert.equal(key, 'liveActivity');
      enabled = value;
      configurationChanged?.({ affectsConfiguration: name => name === 'squad-pod.liveActivity' });
    },
  };
  const vscode = {
    ConfigurationTarget: { Workspace: 2 },
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    workspace: {
      getConfiguration: () => config, workspaceFolders: [{ uri: uri(workspace), name: 'Fixture' }],
      onDidChangeWorkspaceFolders: () => disposable,
      onDidChangeConfiguration: callback => { configurationChanged = callback; return disposable; },
    },
    window: {
      registerWebviewViewProvider: (_id, value) => { provider = value; return disposable; },
      createOutputChannel: () => ({ appendLine: line => output.push(line), dispose() {} }),
      showWarningMessage: async (message, options, action) => {
        assert.equal(options.modal, true);
        confirmations.push(message);
        return allowed ? action : undefined;
      },
      showErrorMessage: async message => { output.push(message); },
      createTerminal() { throw new Error('Forbidden terminal'); },
    },
    commands: { registerCommand: () => disposable, executeCommand() { throw new Error('Forbidden command'); } },
  };
  const values = new Map([
    ['squad-pod.soundEnabled', false],
    ['squad-pod.layout', {
      version: 2, cols: 10, rows: 10, tiles: Array(100).fill(2),
      furniture: [
        { uid: 'desk', type: 'desk', col: 4, row: 4, rotation: 0 },
        { uid: 'chair', type: 'chair', col: 4, row: 5, rotation: 0 },
      ],
    }],
    ['squad-pod.agentSeats', { ada: 'chair' }],
  ]);
  const storage = {
    get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    update: async (key, value) => { values.set(key, value); },
  };
  const monitoredFs = monitorFixtureFs(fs, { home, reads });
  const compiled = { exports: {} };
  const nodeRequire = Module.createRequire(path.join(root, 'package.json'));
  const require = name => name === 'vscode' ? vscode : ['fs', 'node:fs'].includes(name) ? monitoredFs : nodeRequire(name);
  const code = extensionCode ?? fs.readFileSync(path.join(root, 'dist', 'extension.js'), 'utf8');
  try {
    new Function('require', 'module', 'exports', code)(require, compiled, compiled.exports);
    compiled.exports.activate({ extensionPath: root, subscriptions: [], workspaceState: storage, globalState: storage });
    assert.ok(provider);
    const webview = {
      cspSource: baseUrl, html: '',
      asWebviewUri: resource => `${baseUrl}/${path.relative(root, resource.fsPath).replaceAll(path.sep, '/')}`,
      onDidReceiveMessage: callback => { receive = callback; return disposable; },
      postMessage: message => { messages.push(message); return Promise.resolve(true); },
    };
    provider.resolveWebviewView({ webview, onDidDispose: () => disposable }, {}, {});
    return {
      workspace, home, messages, output, confirmations, reads, webview,
      get enabled() { return enabled; },
      setConsent(value) { allowed = value; },
      setExternal(value) {
        enabled = value;
        configurationChanged?.({ affectsConfiguration: name => name === 'squad-pod.liveActivity' });
      },
      send: message => receive(message),
      append: content => fs.appendFileSync(eventsFile, content),
      stale() {
        fs.appendFileSync(eventsFile, '\n');
        const old = new Date(Date.now() - 6 * 60_000);
        fs.utimesSync(eventsFile, old, old);
      },
      lose() { fs.unlinkSync(eventsFile); },
      replace(content) { fs.writeFileSync(eventsFile, content); },
      fail() {
        fs.renameSync(eventsFile, eventsFile + '.old');
        fs.mkdirSync(eventsFile);
      },
      dispose() {
        compiled.exports.deactivate();
        if (previousHome === undefined) delete process.env.COPILOT_HOME;
        else process.env.COPILOT_HOME = previousHome;
        fs.rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    compiled.exports.deactivate?.();
    if (previousHome === undefined) delete process.env.COPILOT_HOME;
    else process.env.COPILOT_HOME = previousHome;
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function mutations(out) {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-live-mutation-'));
  const mutants = [
    { name: 'wrong-tool-id', file: 'copilotSessionActivity.ts',
      from: "toolId: event.toolCallId, tool: tool.toolName", to: "toolId: 'wrong-tool-id', tool: tool.toolName" },
    { name: 'task-completion-is-member-completion', file: 'copilotSessionActivity.ts',
      from: "const tool = this.tools.get(event.toolCallId);",
      to: "if (task) { this.finish(task.agentId); return; }\n      const tool = this.tools.get(event.toolCallId);" },
    { name: 'fuzzy-attribution', file: 'copilotSessionActivity.ts',
      from: 'member.id.toLowerCase() === key', to: 'key.startsWith(member.id.toLowerCase())' },
    { name: 'prompt-leak', file: 'copilotSessionActivity.ts',
      from: 'description: text(args.description, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH)',
      to: 'description: text(args.prompt, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH)' },
    { name: 'timer-idles-live-member', file: 'agentManager.ts',
      from: 'if (agentId && liveRuns.has(agentId)) {return;}', to: '' },
  ];
  try {
    fs.cpSync(path.join(root, 'src'), path.join(source, 'src'), { recursive: true });
    for (const file of ['package.json', 'tsconfig.json', 'vitest.config.ts']) fs.copyFileSync(path.join(root, file), path.join(source, file));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(source, 'node_modules'), 'junction');
    const run = name => {
      const result = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
        'run', 'src/copilotSessionActivity.test.ts', 'src/agentManager.test.ts'], {
        cwd: source, encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024,
      });
      fs.writeFileSync(path.join(out, `mutation-${name}.log`), `${result.stdout || ''}\n${result.stderr || ''}`);
      if (result.error) throw result.error;
      return result.status;
    };
    assert.equal(run('baseline'), 0, 'unmutated tests must pass');
    for (const mutant of mutants) {
      const file = path.join(source, 'src', mutant.file);
      const original = fs.readFileSync(file, 'utf8');
      assert.ok(original.includes(mutant.from), `mutation anchor: ${mutant.name}`);
      fs.writeFileSync(file, original.replace(mutant.from, mutant.to));
      try { assert.notEqual(run(mutant.name), 0, `${mutant.name} must be killed`); }
      finally { fs.writeFileSync(file, original); }
      console.log(`KILLED ${mutant.name}`);
    }
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
}

async function browserAcceptance(out) {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const guardProof = assertFilesystemGuard();
  const colorizeModule = { exports: {} };
  const colorizeCode = require('esbuild').transformSync(
    fs.readFileSync(path.join(root, 'webview-ui', 'src', 'office', 'colorize.ts'), 'utf8'),
    { loader: 'ts', format: 'cjs' },
  ).code;
  new Function('module', 'exports', colorizeCode)(colorizeModule, colorizeModule.exports);
  let fixture;
  const server = http.createServer((request, response) => {
    if (request.url === '/messages') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(fixture.messages));
    } else if (request.url === '/send' && request.method === 'POST') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => { fixture.send(JSON.parse(body)); response.end('{}'); });
    } else if (request.url === '/') {
      response.setHeader('content-type', 'text/html');
      response.end(fixture.webview.html.replace(/<meta[^>]+Content-Security-Policy[^>]+>/, '').replace('<head>', `<head><script>
        let received = 0;
        window.acquireVsCodeApi = () => ({
          postMessage: message => fetch('/send', {method:'POST', body:JSON.stringify(message)}),
          getState: () => undefined, setState() {}
        });
        setInterval(async () => {
          const messages = await (await fetch('/messages')).json();
          messages.slice(received).forEach(data => window.dispatchEvent(new MessageEvent('message', {data})));
          received = messages.length;
        }, 100);
      </script>`));
    } else {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (process.argv.includes('--reject-builtin-assets') && pathname.startsWith('/dist/webview/assets/characters/')) {
        response.writeHead(404); response.end(); return;
      }
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(path.join(root, 'dist') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404); response.end(); return;
      }
      response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'image/png');
      response.end(fs.readFileSync(file));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.EDGE_PATH, headless: true });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 640 }]) {
      fixture = createLiveFixture({ baseUrl });
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
      const errors = [];
      const failedAssets = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('response', response => {
        if (response.status() >= 400 && new URL(response.url()).pathname.includes('/assets/')) {
          failedAssets.push({ url: new URL(response.url()).pathname, status: response.status() });
        }
      });
      await page.addInitScript(() => {
        window.__liveAssetProof = { character: false, bundledFloor: false };
        const drawImage = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
          if (this.canvas.isConnected && source instanceof HTMLCanvasElement) {
            if (source.width === 112 && source.height === 96 && args.length === 8) {
              window.__liveAssetProof.character = true;
            }
            if (!window.__liveAssetProof.bundledFloor && window.__expectedFloor &&
                args.length === 2 && source.width === source.height && source.width % 16 === 0) {
              const pixels = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
              const samples = [];
              const scale = source.width / 16;
              for (let row = 0; row < 16; row++) {
                for (let col = 0; col < 16; col++) {
                  const index = (row * scale * source.width + col * scale) * 4;
                  samples.push(...pixels.slice(index, index + 4));
                }
              }
              if (JSON.stringify(samples) === JSON.stringify(window.__expectedFloor)) window.__liveAssetProof.bundledFloor = true;
            }
          }
          return drawImage.call(this, source, ...args);
        };
      });
      await page.goto(baseUrl);
      const packagedImages = ['characters/char_0.png', 'characters/char_1.png', 'floors/floor_1.png'];
      for (const asset of packagedImages) {
        const resource = '/dist/webview/assets/' + asset;
        const response = await page.request.get(baseUrl + resource);
        assert.equal(response.status(), 200, `packaged resource must be served at ${resource}`);
        assert.deepEqual(await response.body(), fs.readFileSync(path.join(root, 'dist', 'webview', 'assets', asset)),
          'browser resource must be the exact packaged PNG, not a synthetic substitute');
      }
      const decodedAssets = await page.evaluate(async assets => Promise.all(assets.map(async asset => {
        const image = new Image();
        image.src = '/dist/webview/assets/' + asset;
        await image.decode();
        return { asset, width: image.naturalWidth, height: image.naturalHeight };
      })), packagedImages);
      assert.deepEqual(decodedAssets.map(({ width, height }) => [width, height]), [[112, 96], [112, 96], [16, 16]]);
      await page.evaluate(() => {
        for (const [name, value] of Object.entries({
          'editor-background': '#1e1e1e', foreground: '#cccccc',
          'button-background': '#0e639c', 'button-foreground': '#ffffff',
          'button-secondaryBackground': '#3a3d41', 'button-secondaryForeground': '#ffffff',
          'panel-border': '#80808059', errorForeground: '#f48771',
        })) document.documentElement.style.setProperty(`--vscode-${name}`, value);
      });
      await page.locator('[data-agent-label="ada"]').waitFor();
      const snapshot = fixture.messages.find(message => message.type === 'manifestAssetsLoaded')?.snapshot;
      assert.ok(snapshot?.floors.length === 9, 'provider must load all nine bundled floor sprites');
      assert.ok(new Set(snapshot.floors[1].flat()).size > 1, 'fixture floor must be textured, not the flat fallback');
      const floor = colorizeModule.exports.getColorizedSprite('acceptance-floor', snapshot.floors[1], { h: 35, s: 40, b: 15, c: 0 });
      const expectedFloor = floor.flat().flatMap(hex => [
        parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16), hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255,
      ]);
      await page.evaluate(expected => { window.__expectedFloor = expected; }, expectedFloor);
      try {
        await page.waitForFunction(() => window.__liveAssetProof.character && window.__liveAssetProof.bundledFloor);
      } catch (error) {
        console.error(await page.evaluate(() => ({ assets: window.__liveAssetProof, text: document.body.innerText })));
        throw error;
      }
      const assetWarnings = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Asset warnings/ }) });
      const expectedWarnings = [
        'Unavailable art is shown as grey markers. Your layout is unchanged. Export a backup before manually replacing items; unknown dimensions block placement.',
        'Unavailable asset: desk', 'Unavailable asset: chair',
      ];
      const assertAssetDiagnostics = async () => {
        assert.deepEqual(await assetWarnings.locator('p').allTextContents(), expectedWarnings,
          'only the two deliberately retained legacy furniture placeholders may be diagnosed');
        assert.equal(await assetWarnings.locator('summary').innerText(), 'Asset warnings (2)');
        const snapshots = fixture.messages.filter(message => message.type === 'manifestAssetsLoaded');
        assert.ok(snapshots.length > 0 && snapshots.every(message => message.snapshot.floors.length === 9 &&
          message.snapshot.diagnostics.length === 0), 'real compiled-provider bundled floor snapshots must be complete and diagnostic-free');
      };
      await assertAssetDiagnostics();
      while (await page.getByRole('button', { name: 'Zoom out', exact: true }).isEnabled()) {
        await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await page.getByText('2x', { exact: true }).waitFor();
      assert.equal(fixture.reads.length, 0, 'default-off production provider must not touch the injected home');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.locator('#squad-pod-live-activity').click();
      await page.waitForFunction(() => document.querySelector('#squad-pod-live-activity').checked);
      await page.getByRole('button', { name: '×', exact: true }).click();
      fixture.append(spawn() + done('member-run') + tool('read-one', 'view', { path: `C:\\private\\${secret}\\fixture.ts` }));
      await page.locator('[data-agent-tools="ada"]').filter({ hasText: 'Reading fixture.ts' }).waitFor();
      await page.locator('[data-agent-label="ada"] [aria-label="Active"]').waitFor();
      const firstCanvas = await page.locator('canvas').first().screenshot();
      let advanced = false;
      for (let frame = 0; frame < 10 && !advanced; frame++) {
        await page.waitForTimeout(100);
        advanced = !firstCanvas.equals(await page.locator('canvas').first().screenshot());
      }
      assert.ok(advanced, 'production canvas must advance the active character animation');
      fixture.append(done('read-one', 600) + tool('edit-one', 'edit', { path: 'fixture.ts' }));
      await page.getByRole('progressbar', { name: '60% context used (0.6k of 1.0k tokens)' }).waitFor();
      await page.locator('[data-agent-tools="ada"]').filter({ hasText: 'Editing fixture.ts' }).waitFor();
      fixture.append(done('edit-one', 950));
      await page.getByRole('progressbar', { name: '95% context used (0.9k of 1.0k tokens)' }).waitFor();
      fixture.append(Array.from({ length: 120 }, (_, index) =>
        tool(`many-${index}`, 'edit', { path: `many-${index}.ts` }) + done(`many-${index}`)
      ).join(''));
      await page.locator('[data-agent-tools="ada"]').filter({ hasText: 'Editing many-119.ts' }).waitFor();
      assert.equal(await page.locator('[data-agent-tools="ada"] > div').count(), 3, 'completed rows remain bounded after 120 calls');
      fixture.append(Array.from({ length: 12 }, (_, index) =>
        tool(`parallel-${index}`, 'edit', { path: `parallel-${index}.ts` })).join(''));
      await page.locator('[data-agent-tools="ada"]').filter({ hasText: '+10 more tools' }).waitFor();
      assert.equal(await page.locator('[data-agent-tools="ada"] > div').count(), 6, 'concurrent rows show five plus overflow');
      await page.waitForTimeout(200);
      const toolBounds = await page.locator('[data-agent-tools="ada"]').boundingBox();
      assert.ok(toolBounds.height <= 120 && toolBounds.y >= 0 && toolBounds.y + toolBounds.height <= viewport.height,
        'long-run tool overlay stays bounded inside the viewport');
      const overlaps = await page.evaluate(() => {
        const elements = [...document.querySelectorAll('[data-agent-label], [data-agent-tool-bubble], [data-agent-tools], [data-agent-context]')];
        const boxes = elements.map(element => ({ id: element.getAttribute('data-agent-context') ? 'context' : element.getAttribute('data-agent-tools') ? 'tools' : element.textContent, rect: element.getBoundingClientRect().toJSON() }));
        return boxes.flatMap((a, i) => boxes.slice(i + 1).filter(b =>
          a.rect.left < b.rect.right && a.rect.right > b.rect.left && a.rect.top < b.rect.bottom && a.rect.bottom > b.rect.top
        ).map(b => [a.id, b.id]));
      });
      assert.deepEqual(overlaps, [], '2x overlays must not overlap');
      await page.evaluate(() => { window.__liveAssetProof.character = false; window.__liveAssetProof.bundledFloor = false; });
      await page.waitForFunction(() => window.__liveAssetProof.character && window.__liveAssetProof.bundledFloor);
      await assertAssetDiagnostics();
      await page.screenshot({ path: path.join(out, `live-${viewport.width}x${viewport.height}.png`) });
      const observedCall = (id, name, agentType, parent, description = 'Inspect fixture safely') => event('tool.execution_start', {
        toolName: 'task', toolCallId: id, parentToolCallId: parent,
        arguments: { name, agent_type: agentType, mode: 'background', description, prompt: secret, credentials: secret },
        arbitrary: secret,
      }) + event('subagent.started', { toolCallId: id, agentName: agentType, output: secret });
      fixture.append(observedCall('unknown-one', 'Concurrent review', 'explore', 'member-run')
        + observedCall('unknown-two', 'Concurrent review', 'research', 'absent-parent', 'd'.repeat(1000))
        + observedCall('exact-name-other-type', 'ada', 'explore', undefined));
      await page.getByRole('button', { name: /^Telemetry/ }).click();
      const inventory = page.getByRole('region', { name: 'Observed transient tasks', exact: true });
      await inventory.locator('[data-observed-task="unknown-two"]').waitFor();
      assert.equal(await inventory.locator('[data-observed-task]').count(), 4);
      assert.equal(await inventory.getByText('Concurrent review', { exact: false }).count(), 2);
      assert.match(await inventory.locator('[data-observed-task="unknown-one"]').innerText(), /Unattributed.*explore.*Parent: task #1/s);
      assert.match(await inventory.locator('[data-observed-task="unknown-two"]').innerText(), /Unattributed.*research.*Parent: unknown/s);
      assert.match(await inventory.locator('[data-observed-task="unknown-two"]').innerText(), /metadata truncated or omitted/);
      assert.match(await inventory.locator('[data-observed-task="exact-name-other-type"]').innerText(), /Unattributed.*explore/s);
      assert.equal(await page.locator('[data-agent-label]').count(), 1, 'transient tasks must not create characters');
      const inventoryBounds = await inventory.boundingBox();
      assert.ok(inventoryBounds.x >= 0 && inventoryBounds.x + inventoryBounds.width <= viewport.width
        && inventoryBounds.y >= 0 && inventoryBounds.y + inventoryBounds.height <= viewport.height);
      assert.ok(await inventory.evaluate(element => element.scrollWidth <= element.clientWidth),
        'long metadata must wrap without horizontal overflow');
      await inventory.evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: path.join(out, `observed-tasks-${viewport.width}.png`) });
      await inventory.locator('[data-observed-task="unknown-two"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, `observed-task-detail-${viewport.width}.png`) });
      fixture.append(event('subagent.failed', { toolCallId: 'unknown-two', result: secret }));
      await inventory.locator('[data-observed-task="unknown-two"]').filter({ hasText: 'failed' }).waitFor();
      fixture.stale();
      await inventory.getByText('Searching for a current session.', { exact: false }).waitFor();
      assert.equal(await inventory.locator('[data-observed-task]').count(), 0, 'stale state clears inventory');
      await page.screenshot({ path: path.join(out, `observed-stale-${viewport.width}.png`) });
      fixture.append('\n');
      await inventory.locator('[data-observed-task="unknown-one"]').waitFor();
      assert.equal(await inventory.locator('[data-observed-task="unknown-two"]').count(), 0,
        'stale reconnect seeds only in-flight tasks');
      fixture.lose();
      await inventory.getByText('Searching for a current session.', { exact: false }).waitFor();
      assert.equal(await inventory.locator('[data-observed-task]').count(), 0, 'lost source clears inventory');
      await page.screenshot({ path: path.join(out, `observed-lost-${viewport.width}.png`) });
      fixture.replace(event('subagent.selected', { agentName: 'Squad' }) + spawn());
      await inventory.locator('[data-observed-task="member-run"]').waitFor();
      assert.equal(await inventory.locator('[data-observed-task]').count(), 1, 'replacement cannot retain prior tasks');
      fixture.fail();
      await inventory.getByText('Live source unavailable. Task state cleared.', { exact: true }).waitFor();
      assert.equal(await inventory.locator('[data-observed-task]').count(), 0, 'source errors clear inventory');
      await page.screenshot({ path: path.join(out, `observed-error-${viewport.width}.png`) });
      fs.rmdirSync(path.join(fixture.home, 'session-state', 'fixture-session', 'events.jsonl'));
      fixture.replace(event('subagent.selected', { agentName: 'Squad' }) + spawn()
        + tool('reconnect', 'view', { path: 'fixture.ts' }) + done('reconnect', 800));
      await inventory.locator('[data-observed-task="member-run"]').waitFor();
      await page.getByRole('button', { name: /^Telemetry/ }).click();
      fixture.send({ type: 'webviewReady' });
      await page.getByRole('progressbar').waitFor();
      fixture.append(event('subagent.completed', { toolCallId: 'member-run', agentName: 'general-purpose', prompt: secret }));
      await page.locator('[data-agent-label="ada"] [aria-label="Idle"]').waitFor();
      await page.getByRole('progressbar').waitFor({ state: 'detached' });
      assert.equal(await page.locator('[data-agent-tools]').count(), 0, 'member completion clears tools');
      fixture.append(spawn().replaceAll('member-run', 'member-again')
        + tool('again', 'view', { path: 'fixture.ts' }).replaceAll('member-run', 'member-again') + done('again', 800));
      await page.getByRole('progressbar').waitFor();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.locator('#squad-pod-live-activity').click();
      await page.waitForFunction(() => !document.querySelector('#squad-pod-live-activity').checked);
      await page.getByRole('button', { name: '×', exact: true }).click();
      await page.getByRole('progressbar').waitFor({ state: 'detached' });
      await page.locator('[data-agent-label="ada"] [aria-label="Idle"]').waitFor();
      await page.getByRole('button', { name: /^Telemetry/ }).click();
      await page.getByText('Live member started', { exact: true }).first().waitFor();
      assert.ok(!(await page.locator('body').innerText()).includes(secret), 'telemetry drawer must not contain the sentinel');
      assert.ok(!JSON.stringify({ messages: fixture.messages, output: fixture.output }).includes(secret), 'host sinks must not contain the sentinel');
      assert.deepEqual(errors, [], 'zero page errors');
      assert.deepEqual(failedAssets, [], 'zero failed packaged-asset requests');
      await assertAssetDiagnostics();
      const assetProof = await page.evaluate(() => window.__liveAssetProof);
      fs.writeFileSync(path.join(out, `browser-${viewport.width}.json`), JSON.stringify({
        viewport, errors, failedAssets, guardProof, decodedAssets, assetProof, expectedWarnings, overlaps, toolBounds,
        observedTasks: { inventoryBounds, unattributedConcurrentCalls: 3, explicitParent: true,
          metadataTruncation: true, stale: true, loss: true, error: true, reconnect: 'in-flight only' },
        sequentialCalls: 120, concurrentCalls: 12, confirmations: fixture.confirmations.length,
        source: fixture.messages.filter(m => m.type === 'sourceStatus').at(-1),
      }, null, 2));
      await page.close();
      fixture.dispose();
      fixture = undefined;
      console.log(`PASS production Edge ${viewport.width}x${viewport.height}, device scale 2`);
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (fixture) fixture.dispose();
  }
}

module.exports = { createLiveFixture, spawn, tool, done, event, secret };
if (require.main === module) {
  const index = process.argv.indexOf('--out');
  assert.ok(index >= 0, 'Supply --out <evidence directory>');
  const out = path.resolve(process.argv[index + 1]);
  fs.mkdirSync(out, { recursive: true });
  Promise.resolve().then(() => process.argv.includes('--mutations') ? mutations(out) : browserAcceptance(out))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
