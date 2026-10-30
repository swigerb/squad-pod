const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
require('tsx/cjs');
const { loadAssetSnapshot } = require('../src/manifestAssets.ts');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.ACCEPTANCE_OUTPUT_DIR || path.join(os.tmpdir(), 'squad-pod-furniture-states'));
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const bundle = path.resolve(argument('--bundle') || path.join(root, 'dist', 'webview', 'assets', 'index.js'));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (args, cwd, log) => {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: process.env, maxBuffer: 16 * 1024 * 1024 });
  fs.writeFileSync(log, `${result.stdout || ''}\n${result.stderr || ''}`);
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout || ''}\n${result.stderr || ''}` };
};

function createFixture() {
  const snapshot = loadAssetSnapshot(path.join(root, 'webview-ui', 'public', 'assets'), []);
  const off = snapshot.furniture.find((asset) => asset.type === 'pa_PC_FRONT_OFF');
  const frames = ['pa_PC_FRONT_ON_1', 'pa_PC_FRONT_ON_2', 'pa_PC_FRONT_ON_3']
    .map((type) => snapshot.furniture.find((asset) => asset.type === type));
  assert.ok(off && frames.every(Boolean), 'bundled PC state and all animation frames are available');
  assert.equal(off.width, 1);
  assert.equal(off.height, 2);
  assert.notDeepEqual(frames[0].sprite, frames[1].sprite, 'fixture frames have distinct sprite data');
  assert.notDeepEqual(frames[1].sprite, frames[2].sprite, 'fixture frames have distinct sprite data');
  const layout = {
    version: 2,
    cols: 40,
    rows: 20,
    tiles: Array(40 * 20).fill(1),
    furniture: [
      { uid: 'fixture-desk', type: 'desk', col: 22, row: 7, rotation: 0 },
      {
        uid: 'fixture-pc',
        type: off.type,
        col: 22,
        row: 6,
        rotation: 0,
        assetFootprint: { width: off.width, height: off.height },
      },
      { uid: 'fixture-chair', type: 'chair', col: 22, row: 8, rotation: 0 },
      { uid: 'unpaired-bookcase', type: 'bookshelf', col: 23, row: 12, rotation: 0 },
    ],
  };
  return { snapshot, layout, frames: [off, ...frames] };
}

async function poll(page, predicate, arg, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, arg)) return;
    await page.waitForTimeout(30);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function browserAcceptance(script, label) {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const fixture = createFixture();
  const fixtures = JSON.stringify([
    { type: 'settingsLoaded', settings: { soundEnabled: false, debugEnabled: false, showAreas: false } },
    { type: 'manifestAssetsLoaded', snapshot: fixture.snapshot },
    { type: 'layoutLoaded', layout: fixture.layout, revision: 'furniture-states-fixture', source: 'external' },
    { type: 'existingAgents', agents: [{
      id: 'furniture-agent', name: 'Furniture Agent', role: 'Developer', status: 'active',
    }] },
    { type: 'directoryCatalog', catalog: { workspaceDirectories: [], savedDirectories: [], recentLaunches: [] } },
  ]).replace(/</g, '\\u003c');
  const bridge = `
    window.__furnitureAcceptance = { outbound: [], state: null, replayed: false };
    window.__sendHost = (message) => window.dispatchEvent(new MessageEvent('message', { data: message }));
    window.acquireVsCodeApi = () => ({
      getState: () => JSON.parse(localStorage.getItem('vscodeState') || 'null'),
      setState: (state) => {
        window.__furnitureAcceptance.state = state;
        localStorage.setItem('vscodeState', JSON.stringify(state));
        return state;
      },
      postMessage(message) {
        window.__furnitureAcceptance.outbound.push(message);
        if (message.type === 'webviewReady' && !window.__furnitureAcceptance.replayed) {
          window.__furnitureAcceptance.replayed = true;
          setTimeout(() => {
            const saved = localStorage.getItem('savedFurnitureLayout');
            const replay = ${fixtures}.map((item) => item.type === 'layoutLoaded' && saved
              ? { ...item, layout: JSON.parse(saved), revision: 'furniture-states-reloaded' }
              : item);
            replay.forEach((item) => window.__sendHost(item));
          }, 100);
        }
        if (message.type === 'saveLayout') {
          localStorage.setItem('savedFurnitureLayout', JSON.stringify(message.layout));
          setTimeout(() => window.__sendHost({
            type: 'layoutSaved', layout: message.layout, revision: 'furniture-states-saved',
          }), 0);
        }
      }
    });
  `;
  const html = `<!doctype html><html><head><meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-fixture'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'">
    <link rel="stylesheet" href="/assets/index.css">
    <style>body{margin:0;--vscode-editor-background:#1e1e1e;--vscode-foreground:#ccc;--vscode-button-background:#0e639c;--vscode-button-foreground:white;--vscode-button-secondaryBackground:#3a3d41;--vscode-button-secondaryForeground:white;--vscode-errorForeground:#f48771}</style>
    </head><body><div id="root"></div><script nonce="fixture">${bridge}</script>
    <script nonce="fixture" type="module" src="/assets/index.js"></script></body></html>`;
  const server = http.createServer((request, response) => {
    const files = {
      '/assets/index.js': [script, 'application/javascript'],
      '/assets/index.css': [path.join(root, 'dist', 'webview', 'assets', 'index.css'), 'text/css'],
    };
    const file = files[request.url?.split('?')[0]];
    if (file) {
      response.writeHead(200, { 'Content-Type': file[1] });
      response.end(fs.readFileSync(file[0]));
    } else if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(html);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  let browser;
  const result = {
    label,
    head,
    bundleSha256: hash(script),
    boundary: 'Production webview with synthetic host and bundled assets; not native VS Code or real Squad lifecycle evidence',
    cases: [],
  };
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    browser = await chromium.launch({
      executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: true,
    });
    result.browser = browser.version();
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 640 }]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const record = { viewport, pageErrors: [], frames: [], editor: {}, persistence: false };
      result.cases.push(record);
      page.on('pageerror', (error) => record.pageErrors.push(error.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await poll(page, () => window.__furnitureAcceptance?.state?.draft?.cols === 40
          && document.querySelector('canvas')?.width > 0, undefined, 'initial layout and canvas');
        await page.getByRole('button', { name: 'Edit Layout', exact: true }).click();
        await page.getByRole('region', { name: 'Layout editor' }).waitFor();

        const geometry = (col, row) => page.evaluate(({ col, row }) => {
          const canvas = document.querySelector('canvas');
          const rect = canvas.getBoundingClientRect();
          const zoom = Number(document.querySelector('[aria-label="Office zoom"]')?.textContent?.match(/\\d+/)?.[0]) || 2;
          const dpr = canvas.width / rect.width;
          return {
            x: rect.left + ((rect.width - 40 * 16 * zoom) / 2 + (col * 16 + 8) * zoom),
            y: rect.top + ((rect.height - 20 * 16 * zoom) / 2 + (row * 16 + 8) * zoom),
            dpr,
            zoom,
          };
        }, { col, row });
        const clickTile = async (col, row) => {
          const point = await geometry(col, row);
          await page.mouse.click(point.x, point.y);
        };
        const pcPixel = async () => page.evaluate(() => {
          const canvas = document.querySelector('canvas');
          const rect = canvas.getBoundingClientRect();
          const zoom = Number(document.querySelector('[aria-label="Office zoom"]')?.textContent?.match(/\\d+/)?.[0]) || 2;
          const dpr = canvas.width / rect.width;
          const x = Math.round(((rect.width - 40 * 16 * zoom) / 2 + (22 * 16 + 4.5) * zoom) * dpr);
          const y = Math.round(((rect.height - 20 * 16 * zoom) / 2 + (6 * 16 + 6.5) * zoom) * dpr);
          return Array.from(canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data);
        });
        const sourcePixel = (asset) => [...Buffer.from(asset.sprite[6][4].slice(1), 'hex'), 255];
        const distinctFramePixels = fixture.frames.slice(1).map(sourcePixel);

        await poll(page, (expected) => {
          const canvas = document.querySelector('canvas');
          if (!canvas) return false;
          const rect = canvas.getBoundingClientRect();
          const zoom = Number(document.querySelector('[aria-label="Office zoom"]')?.textContent?.match(/\\d+/)?.[0]) || 2;
          const dpr = canvas.width / rect.width;
          const x = Math.round(((rect.width - 40 * 16 * zoom) / 2 + (22 * 16 + 4.5) * zoom) * dpr);
          const y = Math.round(((rect.height - 20 * 16 * zoom) / 2 + (6 * 16 + 6.5) * zoom) * dpr);
          const pixel = Array.from(canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data);
          return JSON.stringify(pixel) === JSON.stringify(expected);
        }, sourcePixel(fixture.frames[1]), 'active PC frame');
        const observed = new Set();
        const frameDeadline = Date.now() + 2500;
        while (Date.now() < frameDeadline && observed.size < distinctFramePixels.length) {
          observed.add(JSON.stringify(await pcPixel()));
          await page.waitForTimeout(35);
        }
        assert.deepEqual([...observed].filter((pixel) => distinctFramePixels.some((expected) => JSON.stringify(expected) === pixel)).length,
          distinctFramePixels.length, 'all animation frame pixels are rendered');
        record.frames = [...observed];
        await page.evaluate(() => window.__sendHost({
          type: 'agentStatus', agentId: 'furniture-agent', status: 'idle',
        }));
        const offPixel = sourcePixel(fixture.frames[0]);
        await poll(page, (expected) => {
          const canvas = document.querySelector('canvas');
          const rect = canvas.getBoundingClientRect();
          const zoom = Number(document.querySelector('[aria-label="Office zoom"]')?.textContent?.match(/\\d+/)?.[0]) || 2;
          const dpr = canvas.width / rect.width;
          const x = Math.round(((rect.width - 40 * 16 * zoom) / 2 + (22 * 16 + 4.5) * zoom) * dpr);
          const y = Math.round(((rect.height - 20 * 16 * zoom) / 2 + (6 * 16 + 6.5) * zoom) * dpr);
          const pixel = Array.from(canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data);
          window.__furnitureAcceptance.lastIdlePixel = { pixel, expected, x, y };
          return JSON.stringify(pixel) === JSON.stringify(expected);
        }, offPixel, 'idle PC off pixel');

        await clickTile(23, 12);
        const toggleButton = page.getByRole('button', { name: 'Turn on selected furniture', exact: true });
        await toggleButton.waitFor();
        assert.equal(await toggleButton.isDisabled(), true, 'unpaired selection disables the manual toggle');
        await clickTile(22, 6);
        await poll(page, () => !document.querySelector('[aria-label="Turn on selected furniture"]')?.disabled
          && document.querySelector('[aria-label="Turn on selected furniture"]') !== null, undefined, 'stateful selection toggle');
        record.editor.disabledWithoutPair = true;

        await page.getByRole('button', { name: 'Turn on selected furniture', exact: true }).click();
        await poll(page, () => window.__furnitureAcceptance.state.draft.furniture
          .find((item) => item.uid === 'fixture-pc')?.type === 'pa_PC_FRONT_ON_1', undefined, 'manual on toggle');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await poll(page, () => window.__furnitureAcceptance.state.draft.furniture
          .find((item) => item.uid === 'fixture-pc')?.type === 'pa_PC_FRONT_OFF', undefined, 'toggle undo');
        await page.keyboard.press('Control+Shift+Z');
        await poll(page, () => window.__furnitureAcceptance.state.draft.furniture
          .find((item) => item.uid === 'fixture-pc')?.type === 'pa_PC_FRONT_ON_1', undefined, 'Ctrl+Shift+Z redo');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await poll(page, () => window.__furnitureAcceptance.state.draft.furniture
          .find((item) => item.uid === 'fixture-pc')?.type === 'pa_PC_FRONT_ON_1', undefined, 'toolbar redo');
        record.editor = { ...record.editor, toggleUndoRedo: true, ctrlShiftZ: true };

        await page.getByRole('button', { name: /Save Layout/ }).click();
        await poll(page, () => {
          const layout = JSON.parse(localStorage.getItem('savedFurnitureLayout') || 'null');
          return layout?.furniture?.find((item) => item.uid === 'fixture-pc')?.type === 'pa_PC_FRONT_ON_1';
        }, undefined, 'saved on variant');
        await page.waitForFunction(() => window.__furnitureAcceptance.outbound.some((message) => message.type === 'saveLayout'));
        await page.reload();
        await poll(page, () => window.__furnitureAcceptance?.state?.draft?.furniture
          ?.find((item) => item.uid === 'fixture-pc')?.type === 'pa_PC_FRONT_ON_1', undefined, 'saved variant after reload');
        record.persistence = true;
        assert.deepEqual(record.pageErrors, [], 'production page has zero errors');
        record.passed = true;
        await page.screenshot({ path: path.join(output, `${label}-${viewport.width}x${viewport.height}.png`) });
      } catch (error) {
        record.error = error.message;
        record.debug = await page.evaluate(() => ({
          lastIdlePixel: window.__furnitureAcceptance?.lastIdlePixel,
          state: window.__furnitureAcceptance?.state,
          toggle: [...document.querySelectorAll('button')].map((button) => ({
            label: button.getAttribute('aria-label'),
            text: button.textContent,
            disabled: button.disabled,
          })).filter((button) => /selected furniture/i.test(`${button.label} ${button.text}`)),
        }));
        await page.screenshot({ path: path.join(output, `${label}-${viewport.width}x${viewport.height}-failed.png`) });
      } finally {
        await page.close();
      }
    }
    assert.ok(result.cases.every((record) => record.passed),
      result.cases.filter((record) => !record.passed)
        .map((record) => `${record.viewport.width}x${record.viewport.height}: ${record.error}`).join('\n'));
    return result;
  } catch (error) {
    result.error = error.message;
    throw error;
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    fs.writeFileSync(path.join(output, `${label}-results.json`), JSON.stringify(result, null, 2));
  }
}

function copySource(ref) {
  const sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-furniture-state-mutant-'));
  try {
    const archive = path.join(directory, 'source.tar');
    fs.writeFileSync(archive, execFileSync('git', ['archive', '--format=tar', sha], {
      cwd: root, maxBuffer: 128 * 1024 * 1024,
    }));
    execFileSync('tar', ['-xf', archive, '-C', directory]);
    fs.rmSync(archive);
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
    fs.symlinkSync(path.join(root, 'webview-ui', 'node_modules'), path.join(directory, 'webview-ui', 'node_modules'), 'junction');
    return { directory, sha };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  if (process.argv.includes('--mutations')) {
    const officeFile = path.join('webview-ui', 'src', 'office', 'engine', 'officeState.ts');
    const hookFile = path.join('webview-ui', 'src', 'hooks', 'useEditorActions.ts');
    const mutants = [
      {
        name: 'ignore-facing',
        file: officeFile,
        pattern: /^      const dCol = seat\.direction === Direction\.RIGHT \? 1 : seat\.direction === Direction\.LEFT \? -1 : 0;\r?\n      const dRow = seat\.direction === Direction\.DOWN \? 1 : seat\.direction === Direction\.UP \? -1 : 0;$/m,
        replacement: '      const dCol = 0;\n      const dRow = 0;',
        killedBy: /turns on only for the facing geometry/,
      },
      {
        name: 'freeze-frame-clock',
        file: officeFile,
        pattern: /^    this\.furnitureAnimTimer \+= dt;$/m,
        replacement: '    this.furnitureAnimTimer += 0;',
        killedBy: /advances animated furniture only at the 0\.2 second boundary/,
      },
      {
        name: 'persist-auto-on',
        file: officeFile,
        pattern: /^        return \{ \.\.\.item, type: frames\[this\.furnitureAnimFrame % frames\.length\] \};$/m,
        replacement: '        item.type = frames[this.furnitureAnimFrame % frames.length];\n        return item;',
        killedBy: /turns on only for the facing geometry/,
      },
      {
        name: 'undo-without-pair',
        file: hookFile,
        pattern: /^    const type = furniture && getToggledType\(furniture\.type\);\r?\n    if \(!furniture \|\| !type\) return;\r?\n    pushUndo\(\);$/m,
        replacement: '    pushUndo();\n    const type = furniture && getToggledType(furniture.type);\n    if (!furniture || !type) return;',
        killedBy: /does not record undo when the selected item has no complete state pair/,
      },
    ];
    const reports = [];
    for (const mutant of mutants) {
      const source = copySource(head);
      try {
        const file = path.join(source.directory, mutant.file);
        const original = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
        const globalPattern = new RegExp(mutant.pattern.source, `${mutant.pattern.flags}g`);
        assert.equal([...original.matchAll(globalPattern)].length, 1, `${mutant.name} source mutation matches exactly once`);
        fs.writeFileSync(file, original.replace(mutant.pattern, mutant.replacement));
        const testFile = path.join(root, 'webview-ui', 'node_modules', 'vitest', 'vitest.mjs');
        const result = run([
          testFile, 'run',
          'src/office/layout/furnitureState.test.ts',
          'src/office/editor/furnitureStateHook.test.tsx',
        ], path.join(source.directory, 'webview-ui'), path.join(output, `${mutant.name}-tests.log`));
        assert.notEqual(result.status, 0, `${mutant.name} must be killed by focused tests`);
        assert.match(result.output, mutant.killedBy, `${mutant.name} fails its intended assertion`);
        reports.push({ name: mutant.name, mutation: mutant.replacement, status: result.status, killedBy: 'focused test' });
      } finally {
        fs.rmSync(source.directory, { recursive: true, force: true });
      }
    }
    fs.writeFileSync(path.join(output, 'mutation-results.json'), JSON.stringify({ head, mutants: reports }, null, 2));
    console.log(JSON.stringify(reports, null, 2));
    return;
  }

  const result = await browserAcceptance(bundle, argument('--label') || 'current');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
