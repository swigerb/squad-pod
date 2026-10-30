const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');
const gitRoot = process.env.ACCEPTANCE_GIT_ROOT || root;
const webRoot = path.join(root, 'dist', 'webview');
const output = path.resolve(process.env.ACCEPTANCE_OUTPUT_DIR || path.join(os.tmpdir(), 'squad-character-evidence'));
const baselineRef = process.env.ACCEPTANCE_BASELINE_REF || '949972fc94558bbf0efd041174259f4df3dfc29f';
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(read, label) {
  for (let i = 0; i < 100; i++) {
    const result = await read();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}

function baseline() {
  try {
    execFileSync('git', ['cat-file', '-e', `${baselineRef}^{commit}`], { cwd: gitRoot, stdio: 'pipe' });
  } catch {
    throw new Error(`Cannot fetch acceptance baseline ${baselineRef}: fetch that explicit commit into this repository first.`);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-character-baseline-'));
  try {
    const archive = path.join(directory, 'source.tar');
    fs.writeFileSync(archive, execFileSync('git', ['archive', baselineRef], { cwd: gitRoot, maxBuffer: 128 * 1024 * 1024 }));
    execFileSync('tar', ['-xf', archive, '-C', directory]);
    fs.unlinkSync(archive);
    for (const relative of ['node_modules', path.join('webview-ui', 'node_modules')]) {
      fs.symlinkSync(path.join(root, relative), path.join(directory, relative), 'junction');
    }
    const npm = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const build = spawnSync(process.execPath, [npm, 'run', 'build:webview'], { cwd: directory, stdio: 'inherit' });
    assert.equal(build.status, 0, 'pinned baseline build must pass');
    return { directory, bundle: path.join(directory, 'dist', 'webview', 'assets', 'index.js') };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function sheet(red, green, blue, height = 128) {
  const png = new PNG({ width: 224, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([red, green, blue, 255], i);
  return PNG.sync.write(png);
}

function providerFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-character-provider-'));
  const assetRoot = path.join(directory, 'external');
  fs.mkdirSync(path.join(assetRoot, 'characters'), { recursive: true });
  fs.mkdirSync(path.join(directory, '.squad'), { recursive: true });
  fs.writeFileSync(path.join(directory, '.squad', 'team.md'),
    '## Members\n\n| Name | Role | Charter | Status |\n| --- | --- | --- | --- |\n' +
    '| Legacy | Dev | `.squad/agents/legacy/charter.md` | Active |\n' +
    '| External | Dev | `.squad/agents/external/charter.md` | Active |\n');
  const file = path.join(assetRoot, 'characters', 'char_fixture.png');
  fs.writeFileSync(file, sheet(219, 17, 205));
  const messages = [];
  const values = new Map([
    ['squad-pod.assetDirectories', [assetRoot]],
    ['squad-pod.agents', { legacy: { palette: 7 } }],
  ]);
  const storage = {
    get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    update: async (key, value) => values.set(key, value),
  };
  const disposable = { dispose() {} };
  const uri = (fsPath) => ({ fsPath, toString: () => pathToFileURL(fsPath).toString() });
  let provider, receive, deactivate, html;
  const vscode = {
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    window: {
      registerWebviewViewProvider: (_id, value) => { provider = value; return disposable; },
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
    },
    commands: { registerCommand: () => disposable, executeCommand() {} },
    workspace: {
      workspaceFolders: [{ uri: uri(directory), name: 'Synthetic character fixture' }],
      onDidChangeWorkspaceFolders: () => disposable,
      getConfiguration: () => ({ get: (key, fallback) => key === 'directorySuggestions' ? false : fallback }),
    },
  };
  const load = Module._load;
  try {
    Module._load = function (request, parent, main) {
      return request === 'vscode' ? vscode : load.call(this, request, parent, main);
    };
    const extension = require(path.join(root, 'dist', 'extension.js'));
    deactivate = extension.deactivate;
    extension.activate({
      subscriptions: [], extensionPath: root, globalState: storage, workspaceState: storage,
    });
    return {
      assetRoot, file, messages,
      resolve(port) {
        const webview = {
          options: undefined,
          cspSource: `http://127.0.0.1:${port}`,
          asWebviewUri: (resource) => `http://127.0.0.1:${port}/${path.relative(root, resource.fsPath).replaceAll(path.sep, '/')}`,
          onDidReceiveMessage: (callback) => { receive = callback; return disposable; },
          postMessage: (message) => { messages.push(message); return Promise.resolve(true); },
          set html(value) { html = value; }, get html() { return html; },
        };
        provider.resolveWebviewView({ webview, onDidDispose: () => disposable }, {}, {});
        receive({ type: 'webviewReady' });
        const roster = messages.find((message) => message.type === 'existingAgents')?.agents;
        const characters = messages.find((message) => message.type === 'characterAssetsLoaded')?.characters;
        const manifest = messages.find((message) => message.type === 'manifestAssetsLoaded')?.snapshot;
        assert.deepEqual(manifest?.diagnostics, [], 'reserved characters folder must not produce furniture diagnostics');
        assert.deepEqual(manifest?.furniture.filter((item) => item.type.startsWith('local_')), [],
          'reserved characters folder must not load as furniture');
        assert.equal(characters?.length, 1, 'compiled provider must deliver external characters');
        assert.equal(roster.find((agent) => agent.id === 'external').paletteIndex, characters[0].paletteIndex,
          'new member must receive the external sheet identity from the compiled provider');
        assert.equal(roster.find((agent) => agent.id === 'legacy').paletteIndex, 7,
          'persisted legacy member must keep index 7');
        return html;
      },
      dispose() {
        deactivate?.();
        Module._load = load;
        fs.rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    deactivate?.();
    Module._load = load;
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function bridge(messages) {
  const fixtures = JSON.stringify(messages).replace(/</g, '\\u003c');
  return `
    Math.random = () => 0.25;
    window.__characterProof = { frames: [], errors: [], replayed: false };
    window.__host = data => window.dispatchEvent(new MessageEvent('message', { data }));
    const nativeDraw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
      const builtin = image.width === 112 && image.height === 96;
      const external = image.width === 224 && image.height === 128;
      if ((builtin || external) && args.length === 8) {
        const [, , sourceWidth, sourceHeight] = args;
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = builtin ? 32 : 16;
        const context = canvas.getContext('2d');
        context.filter = this.filter;
        nativeDraw.call(context, image, args[0], args[1], sourceWidth, sourceHeight,
          0, 0, canvas.width, canvas.height);
        window.__characterProof.frames.push({
          rgba: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
          width: canvas.width,
          height: canvas.height,
          filter: this.filter,
        });
        if (window.__characterProof.frames.length > 200) window.__characterProof.frames.shift();
      }
      return nativeDraw.call(this, image, ...args);
    };
    window.acquireVsCodeApi = () => ({
      postMessage(message) {
        if (message.type === 'webviewReady' && !window.__characterProof.replayed) {
          window.__characterProof.replayed = true;
          setTimeout(() => ${fixtures}.forEach(window.__host), 50);
        }
      },
      getState: () => undefined, setState: value => value,
    });
  `;
}

const externalPixels = (rgba, color = [219, 17, 205]) =>
  rgba.every((value, i) => value === (i % 4 === 3 ? 255 : color[i % 4]));

async function collectLegacy(page) {
  const results = [];
  for (let index = 0; index < 64; index++) {
    await page.evaluate((paletteIndex) => {
      window.__host({ type: 'existingAgents', agents: [] });
      window.__characterProof.frames = [];
      window.__host({ type: 'existingAgents', agents: [{
        id: 'golden', name: 'Golden', role: 'Dev', paletteIndex, status: 'active',
      }] });
    }, index);
    const frame = await until(() => page.evaluate(() => window.__characterProof.frames[0]), `legacy index ${index}`);
    results.push(frame.rgba);
  }
  return results;
}

async function send(page, message) {
  await page.evaluate((value) => window.__host(value), message);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const control = baseline();
  let fixture, browser, server;
  try {
    fixture = providerFixture();
    let html = '';
    server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); return;
      }
      if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const base = url.pathname.startsWith('/dist/webview/') ? webRoot : path.join(root, 'dist');
      const relative = decodeURIComponent(url.pathname).replace(/^\/dist\/(?:webview\/)?/, '');
      const target = relative === 'assets/index.js' && url.searchParams.has('baseline')
        ? control.bundle : path.resolve(base, relative);
      if ((target !== control.bundle && !target.startsWith(base + path.sep))
        || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        response.writeHead(404); response.end(); return;
      }
      response.writeHead(200, { 'content-type': target.endsWith('.js') ? 'text/javascript'
        : target.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
      fs.createReadStream(target).pipe(response);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    const providerHtml = fixture.resolve(port);
    const nonce = providerHtml.match(/<script nonce="([^"]+)"/)?.[1];
    assert.ok(nonce, 'provider CSP must use a nonce');
    const accepted = new Set(['settingsLoaded', 'layoutLoaded', 'existingAgents', 'characterAssetsLoaded',
      'manifestAssetsLoaded', 'sourceStatus', 'directoryCatalog']);
    const messages = fixture.messages.filter((message) => accepted.has(message.type));
    const original = messages.find((message) => message.type === 'characterAssetsLoaded');
    const originalRoster = messages.find((message) => message.type === 'existingAgents');
    const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    browser = await playwright.chromium.launch({
      executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: true, args: ['--disable-gpu'],
    });
    const pageErrors = [];
    const checks = [];
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 640 }]) {
      const results = {};
      for (const isBaseline of [false, true]) {
        html = providerHtml.replace('</head>', `<script nonce="${nonce}">${bridge(messages)}</script></head>`);
        if (isBaseline) html = html.replace(/(index\.js\?v=[^"]+)/, '$1&baseline=1');
        const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
        await until(() => page.evaluate(() => window.__characterProof?.frames.length > 0), 'first office draw');
        await delay(200);
        if (viewport.width === 360) {
          const zoomOut = page.getByRole('button', { name: 'Zoom out', exact: true });
          while (await zoomOut.isEnabled()) await zoomOut.click();
          await page.getByText('1x', { exact: true }).waitFor();
        }
        const rendered = await page.evaluate(() => window.__characterProof.frames.map((frame) => frame.rgba));
        if (isBaseline) {
          assert.throws(() => assert.ok(rendered.some((rgba) => externalPixels(rgba)),
            'external member must render fixture sheet pixels'), /fixture sheet pixels/,
          'the new assertion must fail on the pinned old bundle');
        } else {
          assert.ok(rendered.some((rgba) => externalPixels(rgba)), 'external member must render fixture sheet pixels');
          const visible = await page.evaluate(() => {
            const canvas = document.querySelector('canvas');
            const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let count = 0;
            for (let i = 0; i < bytes.length; i += 4) {
              if (bytes[i] === 219 && bytes[i + 1] === 17 && bytes[i + 2] === 205) count++;
            }
            return count;
          });
          await page.screenshot({ path: path.join(output, `characters-${viewport.width}x${viewport.height}.png`) });
          assert.ok(visible > 0, `fixture pixels must reach the ${viewport.width}x${viewport.height} visible office canvas`);
          results.visibleFixturePixels = visible;
        }
        results[isBaseline ? 'baseline' : 'current'] = await collectLegacy(page);
        if (!isBaseline) {
          await send(page, originalRoster);
          const corrupt = path.join(fixture.assetRoot, 'characters', 'char_bad.png');
          const wrongDimensions = path.join(fixture.assetRoot, 'characters', 'char_wrong.png');
          let start = fixture.messages.length;
          fs.writeFileSync(corrupt, Buffer.from('not PNG'));
          fs.writeFileSync(wrongDimensions, sheet(219, 17, 205, 96));
          const bad = await until(() => fixture.messages.slice(start).find((message) =>
            message.type === 'characterAssetsLoaded' && message.diagnostics.some((line) => line.includes('char_bad.png'))),
          'watcher corrupt-sheet diagnostic');
          assert.equal(bad.characters.length, 1, 'corrupt sibling must not drop valid sheet');
          assert.ok(bad.diagnostics.some((line) => line.includes('char_wrong.png') && line.includes('224x128')),
            'wrong frame grid must be diagnosed by the host before webview decode');
          await send(page, bad);
          await page.getByRole('button', { name: 'Settings', exact: true }).click();
          await until(() => page.getByText(/char_bad\.png/).count(), 'visible asset diagnostic');
          await page.screenshot({ path: path.join(output, `characters-diagnostics-${viewport.width}x${viewport.height}.png`) });
          await page.getByRole('button', { name: '\u00d7', exact: true }).click();
          start = fixture.messages.length;
          fs.writeFileSync(fixture.file, sheet(19, 201, 111));
          const edited = await until(() => fixture.messages.slice(start).find((message) =>
            message.type === 'characterAssetsLoaded' && message.characters[0]?.sha256 !== original.characters[0].sha256),
          'watcher same-identity edit');
          await page.evaluate(() => { window.__characterProof.frames = []; });
          await send(page, edited);
          await until(async () => (await page.evaluate(() => window.__characterProof.frames.map((frame) => frame.rgba)))
            .some((rgba) => externalPixels(rgba, [19, 201, 111])), 'edited sheet pixels');
          start = fixture.messages.length;
          fs.unlinkSync(fixture.file);
          const removed = await until(() => fixture.messages.slice(start).find((message) =>
            message.type === 'characterAssetsLoaded' && message.characters.length === 0), 'watcher removal');
          await send(page, removed);
          await page.evaluate(() => { window.__characterProof.frames = []; });
          await until(() => page.evaluate(() => window.__characterProof.frames.length >= 2), 'fallback office draw');
          const fallbackFrames = await page.evaluate(() => window.__characterProof.frames);
          assert.ok(!fallbackFrames
            .some((frame) => externalPixels(frame.rgba, [19, 201, 111])),
          'removed sheet must not continue rendering');
          assert.ok(fallbackFrames.some((frame) => frame.width === 16 && frame.height === 32
            && frame.rgba.some((value, index) => index % 4 === 3 && value > 0)),
          'missing persisted external sheet must draw the built-in 16x32 fallback');
          results.fallback = await collectLegacy(page);
          assert.deepEqual(results.fallback, results.current, 'removal must not change any legacy index 0-63');
          fs.unlinkSync(corrupt);
          fs.unlinkSync(wrongDimensions);
          fs.writeFileSync(fixture.file, sheet(219, 17, 205));
          await until(() => fixture.messages.slice(start).find((message) =>
            message.type === 'characterAssetsLoaded' && message.characters[0]?.sha256 === original.characters[0].sha256),
          'watcher restoration');
        }
        await page.close();
      }
      assert.equal(results.current.length, 64, 'all 64 persisted built-in indices must render');
      assert.equal(new Set(results.current.slice(0, 6).map((rgba) => Buffer.from(rgba).toString('hex'))).size, 6,
        'the six first-use indices must render six distinct authored identities');
      assert.notDeepEqual(results.current[0], results.baseline[0],
        'built-in appearance must intentionally use the six Pixel Agents sheets, not the old A/B sheet');
      checks.push({
        viewport, visibleFixturePixels: results.visibleFixturePixels,
        persistedBuiltInCount: 64, distinctAuthoredCharacters: 6,
        currentRgbaSha256: digest(Buffer.from(results.current.flat())),
        baselineComparison: 'old A/B art differs intentionally; indices remain stable and render from six authored sheets',
        negativeControl: 'same external-pixel assertion failed as required',
        watcher: 'corrupt diagnostic, edit pixels, removal, restoration',
      });
    }
    assert.deepEqual(pageErrors, [], 'zero page errors required');
    const report = {
      result: 'PASS', head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: gitRoot, encoding: 'utf8' }).trim(),
      bundleSha256: digest(fs.readFileSync(path.join(webRoot, 'assets', 'index.js'))),
      baselineRef, baselineSha256: digest(fs.readFileSync(control.bundle)),
      pageErrors, checks,
      limitation: 'Compiled provider with mocked VS Code boundary and synthetic original PNGs; not native VS Code or real Squad evidence.',
    };
    fs.writeFileSync(path.join(output, 'characters-results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ...report, evidence: output }, null, 2));
  } finally {
    await browser?.close();
    fixture?.dispose();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(control.directory, { recursive: true, force: true });
  }
}

function mutations() {
  const definitions = [
    {
      name: 'sheet-order',
      file: 'webview-ui/src/office/sprites/characterSheetRenderer.ts',
      pattern: /^    sheetKey: `builtin:\$\{p % PALETTE_COUNT\}`,$/gm,
      replacement: '    sheetKey: `builtin:${(p + 1) % PALETTE_COUNT}`,',
    },
    {
      name: 'bootstrap-early-return',
      file: 'webview-ui/src/office/sprites/assetLoader.ts',
      pattern: /^\): Promise<string\[\]> \{\r?\n  const generation = \+\+characterGeneration;$/gm,
      replacement: '): Promise<string[]> {\n  if (characterSheets.size > 0) { return []; }\n  const generation = ++characterGeneration;',
    },
    {
      name: 'dimension-bounds',
      file: 'src/characterAssets.ts',
      pattern: /^  if \(buffer\.readUInt32BE\(16\) !== width \|\| buffer\.readUInt32BE\(20\) !== height\) \{$/gm,
      replacement: '  if (buffer.readUInt32BE(16) !== width && buffer.readUInt32BE(20) !== height) {',
    },
    {
      name: 'missing-sheet-fallback',
      file: 'webview-ui/src/office/sprites/characterSheetRenderer.ts',
      pattern: /^    p %= PALETTE_COUNT;$/gm,
      replacement: '    p = 1;',
    },
    {
      name: 'reserved-folder-loader',
      file: 'src/manifestAssets.ts',
      pattern: /^        if \(index !== 0 && \(folder === 'pets' \|\| folder === 'characters'\)\) \{ continue; \}\r?\n        attempt\(`\$\{root\} \/ \$\{folder\}`, \(\) => \{$/gm,
      replacement: "        if (index !== 0 && folder === 'pets') { continue; }\n        attempt(`${root} / ${folder}`, () => {",
    },
    {
      name: 'reserved-folder-fingerprint',
      file: 'src/manifestAssets.ts',
      pattern: /^        if \(index !== 0 && \(folder === 'pets' \|\| folder === 'characters'\)\) \{ continue; \}\r?\n        hash\.update\(folder\);$/gm,
      replacement: "        if (index !== 0 && folder === 'pets') { continue; }\n        hash.update(folder);",
      harnessMayPass: true,
    },
  ];
  fs.mkdirSync(output, { recursive: true });
  const npm = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const reports = [];
  for (const definition of definitions) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `squad-character-mutant-${definition.name}-`));
    const evidence = path.join(output, definition.name);
    fs.mkdirSync(evidence, { recursive: true });
    try {
      const archive = path.join(directory, 'source.tar');
      fs.writeFileSync(archive, execFileSync('git', ['archive', 'HEAD'], { cwd: gitRoot, maxBuffer: 128 * 1024 * 1024 }));
      execFileSync('tar', ['-xf', archive, '-C', directory]);
      fs.unlinkSync(archive);
      for (const relative of ['node_modules', path.join('webview-ui', 'node_modules')]) {
        fs.symlinkSync(path.join(root, relative), path.join(directory, relative), 'junction');
      }
      const file = path.join(directory, ...definition.file.split('/'));
      const source = fs.readFileSync(file, 'utf8');
      assert.equal([...source.matchAll(definition.pattern)].length, 1, `${definition.name} substitution must match exactly once`);
      fs.writeFileSync(file, source.replace(definition.pattern, definition.replacement));
      const run = (label, args, cwd = directory) => {
        const result = spawnSync(process.execPath, args, {
          cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
          env: { ...process.env, ACCEPTANCE_GIT_ROOT: gitRoot, ACCEPTANCE_OUTPUT_DIR: evidence },
        });
        if (result.error) throw result.error;
        fs.writeFileSync(path.join(evidence, `${label}.log`), result.stdout + result.stderr);
        return result.status;
      };
      assert.equal(run('build', [npm, 'run', 'build']), 0, `${definition.name} production build must pass`);
      const host = run('host', [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run',
        'src/characterAssets.test.ts', 'src/characterAssignment.test.ts']);
      const webview = run('webview', [path.join(root, 'webview-ui', 'node_modules', 'vitest', 'vitest.mjs'),
        'run', 'src/office/sprites/externalCharacters.test.ts'], path.join(directory, 'webview-ui'));
      const harness = run('acceptance', [path.join(directory, 'scripts', 'acceptance-characters.cjs')]);
      assert.ok(host !== 0 || webview !== 0, `${definition.name} must be killed by focused tests`);
      if (!definition.harnessMayPass) {
        assert.notEqual(harness, 0, `${definition.name} must also be killed by production acceptance`);
      }
      reports.push({
        name: definition.name, file: definition.file, pattern: String(definition.pattern),
        replacement: definition.replacement, matches: 1, host, webview, harness, evidence,
      });
      console.log(`KILLED ${definition.name}: host=${host}, webview=${webview}, acceptance=${harness}`);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
  fs.writeFileSync(path.join(output, 'mutations.json'), JSON.stringify(reports, null, 2) + '\n');
}

if (process.argv.includes('--mutations')) {
  try { mutations(); } catch (error) { console.error(error); process.exitCode = 1; }
} else {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
