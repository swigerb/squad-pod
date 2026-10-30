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
      version: 2, cols: 10, rows: 10, tiles: Array(100).fill(1),
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
  const monitoredFs = new Proxy(fs, {
    get(target, property) {
      const method = target[property];
      if (!['openSync', 'readFileSync', 'readdirSync', 'opendirSync', 'statSync', 'lstatSync', 'existsSync', 'realpathSync'].includes(property)) return method;
      const wrapped = (...args) => {
        const file = String(args[0]);
        if (file.startsWith(home)) reads.push([property, file]);
        assert.ok(!file.startsWith(path.join(os.homedir(), '.copilot')), 'must never read the real Copilot home');
        return method(...args);
      };
      if (property === 'realpathSync') wrapped.native = (...args) => {
        const file = String(args[0]);
        assert.ok(!file.startsWith(path.join(os.homedir(), '.copilot')), 'must never resolve the real Copilot home');
        return method.native(...args);
      };
      return wrapped;
    },
  });
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
      const file = path.resolve(root, '.' + decodeURIComponent(request.url.split('?')[0]));
      if (!file.startsWith(path.join(root, 'dist') + path.sep) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
      response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'image/png');
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
      page.on('pageerror', error => errors.push(String(error)));
      await page.goto(baseUrl);
      await page.locator('[data-agent-label="ada"]').waitFor();
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
        tool(`parallel-${index}`, 'view', { path: `parallel-${index}.ts` })).join(''));
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
      await page.screenshot({ path: path.join(out, `live-${viewport.width}x${viewport.height}.png`) });
      fixture.send({ type: 'webviewReady' });
      await page.getByRole('progressbar').waitFor();
      fixture.append(event('subagent.completed', { toolCallId: 'member-run', agentName: 'general-purpose', prompt: secret }));
      await page.locator('[data-agent-label="ada"] [aria-label="Idle"]').waitFor();
      await page.getByRole('progressbar').waitFor({ state: 'detached' });
      assert.equal(await page.locator('[data-agent-tools]').count(), 0, 'member completion clears tools');
      fixture.append(spawn() + tool('again', 'view', { path: 'fixture.ts' }) + done('again', 800));
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
      fs.writeFileSync(path.join(out, `browser-${viewport.width}.json`), JSON.stringify({ viewport, errors, overlaps, toolBounds, sequentialCalls: 120, concurrentCalls: 12, confirmations: fixture.confirmations.length, source: fixture.messages.filter(m => m.type === 'sourceStatus').at(-1) }, null, 2));
      await page.close();
      fixture.dispose();
      fixture = undefined;
      console.log(`PASS production Edge ${viewport.width}x${viewport.height}, device scale 2`);
    }
  } finally {
    if (fixture) fixture.dispose();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
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
