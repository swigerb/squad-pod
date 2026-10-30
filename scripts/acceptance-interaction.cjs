const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const baselineRef = process.env.ACCEPTANCE_BASELINE_REF || '949972fc94558bbf0efd041174259f4df3dfc29f';
const agents = [
  { id: 'ada', name: 'Ada', role: 'Developer', summary: 'Ada builds precise interaction contracts.', activity: 'Ada verified character navigation.' },
  { id: 'grace', name: 'Grace', role: 'Reviewer', summary: 'Grace reviews the complete user transaction.', activity: 'Grace checked charter navigation.' },
];
const layout = {
  version: 2, cols: 10, rows: 12, tiles: Array(120).fill(1),
  furniture: agents.flatMap((agent, index) => [
    { uid: `${agent.id}-desk`, type: 'desk', col: 3 + index * 2, row: 6, rotation: 0 },
    { uid: `${agent.id}-chair`, type: 'chair', col: 3 + index * 2, row: 7, rotation: 0 },
  ]),
};
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Shared by the host and webview suites; only the VS Code boundary is mocked.
function createProviderFixture({ artifactRoot = root, extensionCode, baseUrl = 'http://127.0.0.1', modelMetadata = false } = {}) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-interaction-fixture-'));
  const squad = path.join(workspaceRoot, '.squad');
  fs.mkdirSync(path.join(squad, 'log'), { recursive: true });
  const team = '## Members\n| Name | Role | Charter |\n| --- | --- | --- |\n'
    + agents.map((a) => `| ${a.name} | ${a.role} | .squad/agents/${a.id}/charter.md |\n`).join('')
    + '| Scribe | Scribe | .squad/agents/scribe/charter.md |\n';
  fs.writeFileSync(path.join(squad, 'team.md'), team);
  for (const agent of agents) {
    const directory = path.join(squad, 'agents', agent.id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'charter.md'),
      `# ${agent.name}\n\n${agent.summary}\n\n## Identity\n\n- **Expertise:** ${agent.name} expertise\n\n## Responsibilities\n\n- ${agent.name} responsibilities\n\n## Boundaries\n\n- ${agent.name} boundaries\n${agent.id === 'ada' ? '<img src=x onerror="window.__charterExecuted=true">' : ''}\n`);
    fs.writeFileSync(path.join(directory, 'history.md'), `# ${agent.name} history\n`);
    fs.writeFileSync(path.join(squad, 'log', `2026-10-29-${agent.id}.md`), `# Activity\n${agent.activity}\n`);
  }
  if (modelMetadata) {
    fs.appendFileSync(path.join(squad, 'agents', 'ada', 'charter.md'),
      '\n## Model\n- **Preferred:** auto\n- **Rationale:** Synthetic task policy\n- **Fallback:** synthetic-fallback\n');
    fs.writeFileSync(path.join(squad, 'config.json'), JSON.stringify({
      defaultModel: 'synthetic-default', agentModelOverrides: { Ada: 'synthetic-override', ada: 'not-the-name' },
    }));
    fs.writeFileSync(path.join(workspaceRoot, 'squad.config.ts'), 'throw new Error("never execute")');
  }
  const calls = { documents: [], commands: [], information: [], terminals: [] };
  const messages = [];
  const sent = [];
  let provider;
  let receive;
  let emit = () => {};
  const disposable = { dispose() {} };
  const uri = (fsPath) => ({ fsPath, toString: () => pathToFileURL(fsPath).toString() });
  const terminal = {
    show: (...args) => calls.terminals.push(['show', ...args]),
    sendText: (...args) => calls.terminals.push(['sendText', ...args]),
  };
  const vscode = {
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    workspace: {
      workspaceFolders: [{ uri: uri(workspaceRoot), name: 'Interaction fixture' }],
      getConfiguration: () => ({ get: (key, fallback) => key === 'directorySuggestions' ? false : fallback }),
      onDidChangeWorkspaceFolders: () => disposable,
    },
    window: {
      registerWebviewViewProvider: (_id, value) => { provider = value; return disposable; },
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      showTextDocument: (target) => { calls.documents.push(target.fsPath); return Promise.resolve(); },
      showInformationMessage: (message) => { calls.information.push(message); return Promise.resolve(); },
      createTerminal: (...args) => { calls.terminals.push(['createTerminal', ...args]); return terminal; },
      activeTerminal: terminal, terminals: [terminal],
    },
    commands: {
      registerCommand: () => disposable,
      executeCommand: (command, target) => { calls.commands.push([command, target?.fsPath]); return Promise.resolve(); },
    },
  };
  const values = new Map([
    ['squad-pod.layout', layout],
    ['squad-pod.agentSeats', { ada: 'ada-chair', grace: 'grace-chair' }],
  ]);
  const storage = {
    get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    update: async (key, value) => { values.set(key, value); },
  };
  const code = extensionCode ?? fs.readFileSync(path.join(artifactRoot, 'dist', 'extension.js'), 'utf8');
  const compiled = { exports: {} };
  const nodeRequire = Module.createRequire(path.join(root, 'package.json'));
  const require = (specifier) => specifier === 'vscode' ? vscode : nodeRequire(specifier);
  try {
    new Function('require', 'module', 'exports', code)(require, compiled, compiled.exports);
    compiled.exports.activate({
      subscriptions: [], extensionPath: artifactRoot, globalState: storage, workspaceState: storage,
    });
    assert.ok(provider, 'real compiled extension must register its provider');
    const webview = {
      cspSource: baseUrl, html: '',
      asWebviewUri: (resource) => `${baseUrl}/${path.relative(artifactRoot, resource.fsPath).replaceAll(path.sep, '/')}`,
      onDidReceiveMessage: (listener) => { receive = listener; return disposable; },
      postMessage: (message) => { messages.push(message); emit(message); return Promise.resolve(true); },
    };
    provider.resolveWebviewView({ webview, onDidDispose: () => disposable }, {}, {});
    return {
      workspaceRoot, calls, messages, sent, webview,
      send(message) { sent.push(message); return receive(message); },
      subscribe(listener) { emit = listener; return () => { emit = () => {}; }; },
      removeAgent(id) {
        fs.writeFileSync(path.join(squad, 'team.md'), team.split('\n').filter((line) => !line.includes(`/agents/${id}/`)).join('\n'));
      },
      longDetail(id) {
        fs.writeFileSync(path.join(squad, 'agents', id, 'charter.md'),
          `# Long charter\n\n${'A deliberately long charter paragraph with detailed responsibilities '.repeat(30)}.\n`);
        for (let index = 0; index < 5; index++) {
          fs.writeFileSync(path.join(squad, 'log', `2026-10-30-${id}-${index}.md`),
            `# Activity\n${id}: ${'A long recent activity entry with full context '.repeat(5)}\n`);
        }
      },
      noFocus() {
        assert.deepEqual(sent.filter((m) => m.type === 'focusAgent'), [], 'no focusAgent producer');
        assert.deepEqual(calls.terminals, [], 'no terminal creation, show or sendText');
      },
      dispose() {
        compiled.exports.deactivate();
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    compiled.exports.deactivate?.();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    throw error;
  }
}

function run(command, args, cwd, log) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (log) fs.writeFileSync(log, `${result.stdout || ''}\n${result.stderr || ''}`);
  if (result.error) throw result.error;
  return result.status;
}

function disposableSource(ref) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-interaction-source-'));
  try {
    if (ref) {
      try {
        execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: root, stdio: 'pipe' });
      } catch {
        throw new Error(`Interaction baseline ${ref} is not available. Fetch that exact commit before running --negative-control.`);
      }
      const archive = path.join(directory, 'source.tar');
      fs.writeFileSync(archive, execFileSync('git', ['archive', ref], { cwd: root, maxBuffer: 128 * 1024 * 1024 }));
      execFileSync('tar', ['-xf', archive, '-C', directory]);
      fs.unlinkSync(archive);
    } else {
      const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
      for (const relative of new Set(files)) {
        const source = path.join(root, relative);
        if (!fs.statSync(source).isFile()) continue;
        const target = path.join(directory, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      }
    }
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
    fs.symlinkSync(path.join(root, 'webview-ui', 'node_modules'), path.join(directory, 'webview-ui', 'node_modules'), 'junction');
    return directory;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

const mutants = [
  { name: 'wrong-agent', file: 'webview-ui/src/App.tsx',
    pattern: /^    requestAgentDetail\(agentId\);\r?$/gm,
    replacement: "    requestAgentDetail(agentId === 'ada' ? 'grace' : 'ada');" },
  { name: 'duplicate-request', file: 'webview-ui/src/App.tsx',
    pattern: /^    requestAgentDetail\(agentId\);\r?$/gm,
    replacement: "    requestAgentDetail(agentId);\n    requestAgentDetail(agentId);" },
  { name: 'wrong-charter', file: 'src/SquadPodViewProvider.ts',
    pattern: /^    this\.openAgentFile\(agentId, \['charter\.md', 'history\.md'\]\);\r?$/gm,
    replacement: "    this.openAgentFile(agentId, ['history.md', 'charter.md']);" },
  { name: 'stray-focus', file: 'webview-ui/src/App.tsx',
    pattern: /^    requestAgentDetail\(agentId\);\r?$/gm,
    replacement: "    requestAgentDetail(agentId);\n    client.send({ type: 'focusAgent', agentId });" },
  { name: 'terminal-call', file: 'src/SquadPodViewProvider.ts',
    pattern: /^  private onRequestAgentDetail\(agentId: string \| undefined, requestId\?: string\): void \{\r?$/gm,
    replacement: "  private onRequestAgentDetail(agentId: string | undefined, requestId?: string): void {\n    const terminal = vscode.window.createTerminal('forbidden interaction');\n    terminal.show();\n    terminal.sendText('forbidden');" },
];

function bridge(messages) {
  return `
    window.__interaction = { outbound: [], ready: false };
    window.__sendHost = data => window.dispatchEvent(new MessageEvent('message', { data }));
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        window.__interaction.outbound.push(message);
        if (message.type === 'webviewReady') {
          setTimeout(() => {
            ${JSON.stringify(messages).replace(/</g, '\\u003c')}.forEach(window.__sendHost);
            for (const id of ['ada', 'grace']) {
              window.__sendHost({ type: 'agentStatus', agentId: id, status: 'active' });
              window.__sendHost({ type: 'agentToolStart', agentId: id, tool: 'read',
                status: 'Reading the complete interaction contract for ' + id });
            }
            window.__interaction.ready = true;
          }, 50);
        } else {
          window.interactionHost(message).then(messages => messages.forEach(window.__sendHost));
        }
      },
      getState: () => undefined, setState: value => value,
    });
    Math.random = () => 0;
  `;
}

async function poll(page, predicate, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await page.evaluate(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${description}`);
}

async function acceptance(artifactRoot, outputDir, geometryOnly = false) {
  const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await playwright.chromium.launch({
    executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true, args: ['--disable-gpu'],
  });
  const results = [];
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 640 }]) {
      let html;
      const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (url.pathname === '/') {
          response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); return;
        }
        const file = path.resolve(artifactRoot, `.${decodeURIComponent(url.pathname)}`);
        if (!file.startsWith(`${artifactRoot}${path.sep}dist${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          response.writeHead(404); response.end(); return;
        }
        response.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript'
          : file.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
        fs.createReadStream(file).pipe(response);
      });
      let fixture;
      let page;
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
        });
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        fixture = createProviderFixture({ artifactRoot, baseUrl, modelMetadata: true });
        fixture.send({ type: 'webviewReady' });
        const nonce = fixture.webview.html.match(/<script nonce="([^"]+)"/)?.[1];
        assert.ok(nonce, 'provider HTML retains nonce-gated CSP');
        html = fixture.webview.html.replace('</head>', `<script nonce="${nonce}">${bridge(fixture.messages)}</script></head>`);
        page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.exposeFunction('interactionHost', (message) => {
          const before = fixture.messages.length;
          fixture.send(message);
          return fixture.messages.slice(before);
        });
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        await poll(page, () => window.__interaction?.ready && document.querySelectorAll('button [role="img"]').length === 2, 'two real name labels');
        // Default zoom is 2. Verify it rather than silently testing another scale.
        assert.equal(await page.getByRole('group', { name: 'Office zoom' }).innerText().then((text) => text.includes('2x')), true);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const geometry = await page.evaluate(() => {
          const names = [...document.querySelectorAll('button')].filter((e) => e.querySelector('[role="img"]'));
          // Baseline has no data attributes, so identify the actual status rows by exact text.
          const tools = [...document.querySelectorAll('div')].filter((e) =>
            e.children.length === 1 && e.firstElementChild?.tagName === 'DIV'
            && /^Reading the complete interaction contract for (ada|grace)$/.test(e.firstElementChild?.lastElementChild?.textContent || ''));
          const bubbles = [...document.querySelectorAll('div')].filter((e) => e.textContent === 'read' && e.children.length === 0);
          return [...names, ...tools, ...bubbles].map((e) => {
            const r = e.getBoundingClientRect();
            return { text: e.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
              pointerEvents: getComputedStyle(e).pointerEvents };
          });
        });
        assert.equal(geometry.length, 6, 'two names, two full tool statuses and two tool bubbles');
        const overlaps = [];
        for (let a = 0; a < geometry.length; a++) {
          for (let b = a + 1; b < geometry.length; b++) {
            const x = geometry[a], y = geometry[b];
            if (x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top) {
              overlaps.push([x.text, y.text]);
            }
          }
        }
        const result = { viewport, geometry, overlaps, errors, extensionHash: hash(path.join(artifactRoot, 'dist', 'extension.js')),
          webviewHash: hash(path.join(artifactRoot, 'dist', 'webview', 'assets', 'index.js')) };
        results.push(result);
        await page.screenshot({ path: path.join(outputDir, `labels-${viewport.width}.png`) });
        fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2));
        if (!geometryOnly) {
          assert.deepEqual(overlaps, [], '2x labels must not intersect');
          for (const label of geometry) {
            assert.ok(label.left >= 0 && label.right <= viewport.width && label.top >= 0 && label.bottom <= viewport.height, 'labels fit viewport');
            if (!['AdaDeveloper', 'GraceReviewer'].includes(label.text)) assert.equal(label.pointerEvents, 'none');
          }
          const requests = () => fixture.sent.filter((m) => m.type === 'requestAgentDetail');
          async function checkCard(agent, action) {
            const before = requests().length;
            await action();
            await poll(page, () => Boolean(document.querySelector('[role="dialog"]')), `${agent.id} detail card`);
            const requested = requests().slice(before);
            assert.equal(requested.length, 1, 'detail requested exactly once');
            assert.deepEqual({ type: requested[0].type, agentId: requested[0].agentId },
              { type: 'requestAgentDetail', agentId: agent.id }, 'correct agent requested');
            assert.match(requested[0].requestId, /^\d+$/, 'request is correlated to its response');
            const card = page.getByRole('dialog', { name: `${agent.name} details` });
            const text = await card.innerText();
            for (const expected of [agent.name, agent.role, 'idle', agent.summary, agent.activity]) assert.ok(text.includes(expected), expected);
            const other = agents.find((a) => a.id !== agent.id);
            assert.ok(!text.includes(other.summary) && !text.includes(other.activity), 'no previous agent data');
            const bounds = await card.boundingBox();
            assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height, 'measured card fits viewport');
            const beforeDocuments = fixture.calls.documents.length;
            await card.getByRole('button', { name: 'View Charter' }).click();
            assert.deepEqual(fixture.calls.documents.slice(beforeDocuments), [path.join(fixture.workspaceRoot, '.squad', 'agents', agent.id, 'charter.md')]);
            fixture.noFocus();
            await page.screenshot({ path: path.join(outputDir, `card-${agent.id}-${viewport.width}.png`) });
            await card.getByRole('button', { name: 'Close agent details' }).click();
          }
          const squad = path.join(fixture.workspaceRoot, '.squad');
          await page.getByRole('button', { name: 'Squad Info' }).click();
          const adaDetails = page.getByRole('button', { name: 'Show details for Ada' });
          await adaDetails.focus();
          await page.keyboard.press('Enter');
          await poll(page, () => document.querySelector('#agent-detail-ada')?.textContent.includes('Ada builds precise interaction contracts.'), 'keyboard-opened Squad Info details');
          const squadInfo = page.getByRole('dialog');
          const squadInfoBounds = await squadInfo.boundingBox();
          assert.ok(squadInfoBounds.x >= 0 && squadInfoBounds.y >= 0
            && squadInfoBounds.x + squadInfoBounds.width <= viewport.width
            && squadInfoBounds.y + squadInfoBounds.height <= viewport.height, 'Squad Info dialog fits the viewport');
          const adaPanel = page.locator('#agent-detail-ada');
          assert.ok((await adaPanel.innerText()).includes('Ada expertise'), 'declared expertise is shown');
          assert.ok((await adaPanel.innerText()).includes('Ada responsibilities'), 'declared responsibilities are shown');
          assert.ok((await adaPanel.innerText()).includes('Ada boundaries'), 'declared boundaries are shown');
          const modelText = await adaPanel.locator('section[aria-label="Model metadata"]').innerText();
          for (const expected of ['Current-session model: unavailable', 'not effective runtime selection',
            'Automatic selection (auto; not a concrete model)', 'Rationale: Synthetic task policy',
            'Fallback: synthetic-fallback', 'defaultModel: synthetic-default',
            'agentModelOverrides["Ada"]: synthetic-override', path.join(squad, 'config.json'),
            'Executable/legacy configuration is present; not imported, executed or resolved.']) {
            assert.ok(modelText.includes(expected), `model source evidence: ${expected}`);
          }
          assert.ok(!modelText.includes('not-the-name'), 'no fuzzy agent override matching');
          await adaPanel.locator('section[aria-label="Model metadata"]').screenshot({
            path: path.join(outputDir, `model-metadata-${viewport.width}.png`),
          });
          result.modelMetadata = modelText;
          assert.equal(await adaPanel.locator('img,script').count(), 0, 'charter source is rendered as text, not HTML');
          assert.ok((await adaPanel.innerText()).includes('<img src=x'), 'literal charter markup remains visible as source text');
          const beforeInfoCharter = fixture.calls.documents.length;
          await adaPanel.getByRole('button', { name: 'Open charter' }).click();
          assert.deepEqual(fixture.calls.documents.slice(beforeInfoCharter),
            [path.join(fixture.workspaceRoot, '.squad', 'agents', 'ada', 'charter.md')]);
          fixture.noFocus();
          await page.screenshot({ path: path.join(outputDir, `squad-info-${viewport.width}.png`) });
          await page.getByRole('button', { name: 'Show details for Grace' }).click();
          await poll(page, () => document.querySelector('#agent-detail-grace')?.textContent.includes('Grace reviews the complete user transaction.'), 'distinct roster member detail');
          assert.ok(!(await page.locator('#agent-detail-grace').innerText()).includes('Ada builds'), 'details stay keyed to agent ID');
          await squadInfo.getByRole('button', { name: 'Close Squad Info' }).click();
          // The fixture uses a centered 10x12 map and stable seated characters.
          const point = (index, row, offsetY = 0) => ({
            x: (3 + index * 2) * 32 + 16 + (viewport.width - 320) / 2,
            y: row * 32 + 16 + (viewport.height - 384) / 2 + offsetY,
          });
          for (const [index, agent] of agents.entries()) {
            await checkCard(agent, () => {
              const p = point(index, 7, -16);
              return page.mouse.click(p.x, p.y);
            });
            await checkCard(agent, () => page.getByRole('button').filter({ hasText: agent.name }).first().click());
            // Click the bottom of the occupied chair tile, outside character hit bounds.
            await checkCard(agent, () => {
              const p = point(index, 7, 12);
              return page.mouse.click(p.x, p.y);
            });
            await checkCard(agent, async () => {
              const label = page.getByRole('button').filter({ hasText: agent.name }).first();
              await label.focus(); await page.keyboard.press(index ? 'Space' : 'Enter');
            });
            // Own occupied desk remains an interaction, not a seat move.
            await checkCard(agent, () => {
              const p = point(index, 6, -12);
              return page.mouse.click(p.x, p.y);
            });
          }
          fixture.longDetail('ada');
          await page.getByRole('button').filter({ hasText: 'Ada' }).first().click();
          await poll(page, () => document.querySelector('[role="dialog"]')?.textContent.includes('deliberately long'), 'long compiled-provider detail');
          const longCard = page.getByRole('dialog', { name: 'Ada details' });
          const bounds = await longCard.boundingBox();
          assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width
            && bounds.y + bounds.height <= viewport.height, 'long detail card fits viewport');
          if (viewport.height === 640) {
            assert.ok(await longCard.evaluate((element) => element.scrollHeight > element.clientHeight), 'long narrow card scrolls instead of clipping');
          }
          const beforeLongCharter = fixture.calls.documents.length;
          await longCard.getByRole('button', { name: 'View Charter' }).click();
          assert.deepEqual(fixture.calls.documents.slice(beforeLongCharter),
            [path.join(fixture.workspaceRoot, '.squad', 'agents', 'ada', 'charter.md')]);
          await page.screenshot({ path: path.join(outputDir, `long-card-${viewport.width}.png`) });
          result.requests = requests();
          result.calls = fixture.calls;
        }
        fixture.noFocus();
        assert.deepEqual(errors, [], 'zero page errors');
      } finally {
        await page?.close();
        fixture?.dispose();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2));
  }
  assert.ok(results.every((result) => result.overlaps.length === 0), '2x labels must not intersect');
  return results;
}

async function main() {
  const artifactRoot = path.resolve(option('--artifact-root') || root);
  const outputDir = path.resolve(option('--evidence') || path.join(os.tmpdir(), 'squad-pod-interaction-evidence'));
  fs.mkdirSync(outputDir, { recursive: true });
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (process.argv.includes('--mutations')) {
    const outcomes = [];
    for (const mutant of mutants) {
      const directory = disposableSource();
      const evidence = path.join(outputDir, mutant.name);
      fs.mkdirSync(evidence, { recursive: true });
      try {
        const file = path.join(directory, mutant.file);
        const source = fs.readFileSync(file, 'utf8');
        assert.equal([...source.matchAll(mutant.pattern)].length, 1, `${mutant.name} must match exactly once`);
        fs.writeFileSync(file, source.replace(mutant.pattern, mutant.replacement));
        assert.equal(run(process.execPath, [npmCli, 'run', 'build'], directory, path.join(evidence, 'build.log')), 0, 'mutant must build');
        const host = run(process.execPath, [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'src/agentInteractionProvider.test.ts'],
          directory, path.join(evidence, 'host.log'));
        const webview = run(process.execPath, [path.join(root, 'webview-ui', 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'src/AgentInteraction.test.tsx', 'src/components/AgentLabels.test.tsx'],
          path.join(directory, 'webview-ui'), path.join(evidence, 'webview.log'));
        const browser = run(process.execPath, [__filename, '--artifact-root', directory, '--evidence', evidence],
          root, path.join(evidence, 'browser.log'));
        assert.ok(host !== 0 || webview !== 0, `${mutant.name} survived focused suites`);
        assert.notEqual(browser, 0, `${mutant.name} survived production Edge acceptance`);
        outcomes.push({ name: mutant.name, pattern: mutant.pattern.source, replacement: mutant.replacement, host, webview, browser });
        console.log(`KILLED ${mutant.name}: host=${host}, webview=${webview}, browser=${browser}`);
      } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    }
    fs.writeFileSync(path.join(outputDir, 'mutations.json'), JSON.stringify(outcomes, null, 2));
    return;
  }
  if (process.argv.includes('--negative-control')) {
    const directory = disposableSource(baselineRef);
    try {
      assert.equal(run(process.execPath, [npmCli, 'run', 'build'], directory, path.join(outputDir, 'baseline-build.log')), 0);
      let failed = false;
      try { await acceptance(directory, outputDir, true); } catch (error) {
        assert.match(error.message, /2x labels must not intersect/);
        failed = true;
        console.log(`PASS negative control: ${baselineRef} fails the same geometry assertion: ${error.message}`);
      }
      assert.ok(failed, 'baseline unexpectedly passed label geometry');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    return;
  }
  await acceptance(artifactRoot, outputDir);
  console.log(`PASS compiled-provider interaction and non-overlapping 2x labels at 1280x900 and 360x640; evidence: ${outputDir}`);
}

module.exports = { createProviderFixture, agents, layout };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
