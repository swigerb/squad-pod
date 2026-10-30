const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
require('tsx/cjs');
const { PNG } = require('pngjs');
const { loadAssetSnapshot } = require('../src/manifestAssets.ts');
const { getColorizedSprite } = require('../webview-ui/src/office/colorize.ts');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.ACCEPTANCE_OUTPUT_DIR || path.join(os.tmpdir(), 'squad-pod-furniture-groups'));
const baseline = process.env.ACCEPTANCE_BASELINE_REF || '949972fc94558bbf0efd041174259f4df3dfc29f';
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
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
  return result.status;
};

function copySource(ref) {
  let sha;
  try {
    sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error(`Cannot resolve furniture-groups baseline/source ${ref}. Fetch that explicit commit before running acceptance.`);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-groups-source-'));
  try {
    const archive = path.join(directory, 'source.tar');
    fs.writeFileSync(archive, execFileSync('git', ['archive', '--format=tar', sha], { cwd: root, maxBuffer: 128 * 1024 * 1024 }));
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

function createFixture(directory) {
  const folder = path.join(directory, 'fixture');
  fs.mkdirSync(folder);
  const members = ['front', 'side', 'back'].map((orientation) => ({
    id: orientation.toUpperCase(), type: 'asset', file: `${orientation}.png`,
    width: 16, height: 16, footprintW: 1, footprintH: 1, orientation,
    ...(orientation === 'side' ? { mirrorSide: true } : {}),
  }));
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({
    id: 'GROUP', name: 'Group Fixture - Front', category: 'chairs',
    type: 'group', groupType: 'rotation', rotationScheme: '3-way-mirror',
    canPlaceOnWalls: false, canPlaceOnSurfaces: false, backgroundTiles: 0, members,
  }));
  const patterns = { front: ['#c04020', '#e0b060'], side: ['#2070c0', '#40c080'], back: ['#8040c0', '#c04080'] };
  for (const [orientation, colors] of Object.entries(patterns)) {
    const png = new PNG({ width: 16, height: 16 });
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const offset = (y * 16 + x) * 4;
      const rgb = Buffer.from(colors[x < 8 ? 0 : 1].slice(1), 'hex');
      png.data.set([...rgb, 255], offset);
    }
    fs.writeFileSync(path.join(folder, `${orientation}.png`), PNG.sync.write(png));
  }
  const snapshot = loadAssetSnapshot(path.join(root, 'webview-ui', 'public', 'assets'), [directory]);
  assert.deepEqual(snapshot.diagnostics, []);
  const furniture = snapshot.furniture.filter((entry) => entry.type.startsWith('local_GROUP_'));
  snapshot.furniture = furniture;
  const color = (h) => ({ h, s: 80, b: 0, c: 0, colorize: true });
  const fixtureLayout = {
    version: 2, cols: 8, rows: 5, tiles: Array(40).fill(1),
    furniture: [30, 210].map((h, index) => ({
      uid: `cache-${h}`, type: 'local_GROUP_FRONT', col: 1 + index * 2, row: 3, rotation: 0,
      assetFootprint: { width: 1, height: 1 }, assetRole: 'seat', color: color(h),
    })),
  };
  return { snapshot, layout: fixtureLayout };
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
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-groups-fixture-'));
  const fixture = createFixture(fixtureDir);
  const fixtures = JSON.stringify([
    { type: 'settingsLoaded', settings: { soundEnabled: false, debugEnabled: false, showAreas: false } },
    { type: 'manifestAssetsLoaded', snapshot: fixture.snapshot },
    { type: 'layoutLoaded', layout: fixture.layout, revision: 'groups-fixture', source: 'external' },
    { type: 'existingAgents', agents: [] },
    { type: 'directoryCatalog', catalog: { workspaceDirectories: [], savedDirectories: [], recentLaunches: [] } },
  ]).replace(/</g, '\\u003c');
  const bridge = `
    window.__groups = { replayed: false, outbound: [], state: null };
    window.acquireVsCodeApi = () => ({
      getState: () => undefined,
      setState: (state) => { window.__groups.state = state; return state; },
      postMessage(message) {
        window.__groups.outbound.push(message);
        if (message.type === 'webviewReady' && !window.__groups.replayed) {
          window.__groups.replayed = true;
          setTimeout(() => ${fixtures}.forEach(data => window.dispatchEvent(new MessageEvent('message', { data }))), 100);
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
    if (file) { response.writeHead(200, { 'Content-Type': file[1] }); response.end(fs.readFileSync(file[0])); }
    else if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); }
    else { response.writeHead(404); response.end(); }
  });
  let browser;
  const result = { label, head, bundleSha256: hash(script), boundary: 'Production webview with synthetic host and validated local manifest; not native VS Code or real Squad evidence', cases: [] };
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    browser = await chromium.launch({
      executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true,
    });
    result.browser = browser.version();
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 640 }]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const record = { viewport, pageErrors: [], variants: [] };
      result.cases.push(record);
      page.on('pageerror', (error) => record.pageErrors.push(error.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await poll(page, () => window.__groups?.state?.draft?.cols === 8 && document.querySelector('canvas')?.width > 0, undefined, 'fixture replay');
        await page.getByRole('button', { name: 'Edit Layout', exact: true }).click();
        await page.getByRole('region', { name: 'Layout editor' }).waitFor();
        const geometry = await page.evaluate(() => {
          const c = document.querySelector('canvas');
          const rect = c.getBoundingClientRect();
          const zoom = Number(document.querySelector('[aria-label="Office zoom"]')?.textContent?.match(/\d+/)?.[0]);
          const x = (c.width - 8 * 16 * zoom) / 2;
          const y = (c.height - 5 * 16 * zoom) / 2;
          return { x, y, zoom, left: rect.left, top: rect.top };
        });
        const clickTile = async (col, row) => page.mouse.click(
          geometry.left + geometry.x + (col * 16 + 8) * geometry.zoom,
          geometry.top + geometry.y + (row * 16 + 8) * geometry.zoom,
        );
        const pixels = async (col, row) => {
          await page.mouse.move(0, 0);
          await page.waitForTimeout(80);
          return page.evaluate(({ geometry, col, row }) => {
            const ctx = document.querySelector('canvas').getContext('2d', { willReadFrequently: true });
            return [4, 12].map((x) => Array.from(ctx.getImageData(
              Math.round(geometry.x + (col * 16 + x) * geometry.zoom),
              Math.round(geometry.y + (row * 16 + 8) * geometry.zoom), 1, 1,
            ).data));
          }, { geometry, col, row });
        };
        const expected = (sprite) => [4, 12].map((x) => [...Buffer.from(sprite[8][x].slice(1), 'hex'), 255]);
        const front = fixture.snapshot.furniture.find((entry) => entry.type === 'local_GROUP_FRONT');
        for (const [index, item] of fixture.layout.furniture.entries()) {
          assert.deepEqual(await pixels(item.col, item.row),
            expected(getColorizedSprite(`expected-cache-${index}`, front.sprite, item.color)),
            'simultaneous color cache entries must retain their own hue');
        }
        await page.getByTitle('Furniture', { exact: true }).click();
        assert.equal(await page.getByTitle(/^Group Fixture/).count(), 1, 'palette contains one representative per rotation group');
        await page.getByTitle('Group Fixture', { exact: true }).click();
        await clickTile(6, 1);
        await poll(page, () => window.__groups.state.draft.furniture.length === 3, undefined, 'palette placement');
        await page.getByTitle('Select', { exact: true }).click();
        await clickTile(6, 1);
        const cycle = ['FRONT', 'SIDE', 'BACK', 'SIDE:left', 'FRONT'];
        for (let index = 0; index < cycle.length; index++) {
          const type = `local_GROUP_${cycle[index]}`;
          if (index > 0) {
            if (index % 2) await page.getByTitle('Rotate (R)', { exact: true }).click();
            else await page.keyboard.press('r');
          }
          await poll(page, (type) => window.__groups.state.draft.furniture.at(-1)?.type === type, type, `variant ${type}`);
          const item = await page.evaluate(() => window.__groups.state.draft.furniture.at(-1));
          assert.equal(item.rotation, 0, 'grouped variants never geometrically rotate');
          assert.deepEqual(item.assetFootprint, { width: 1, height: 1 });
          const sourceType = type.replace(':left', '');
          const source = fixture.snapshot.furniture.find((entry) => entry.type === sourceType).sprite;
          const sprite = type.endsWith(':left') ? source.map((row) => [...row].reverse()) : source;
          const actual = await pixels(6, 1);
          assert.deepEqual(actual, expected(sprite), `exact ${type} canvas pixels`);
          record.variants.push({ type, pixels: actual });
        }
        await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
        await poll(page, () => window.__groups.state.draft.furniture.at(-1)?.type.endsWith(':left'), undefined, 'one rotation undo');
        const mirrored = await pixels(6, 1);
        const hue = page.getByRole('slider', { name: 'Selected Furniture Color hue' });
        await hue.scrollIntoViewIfNeeded();
        await hue.dispatchEvent('pointerdown', { bubbles: true });
        await hue.evaluate((element) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '120');
          element.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await hue.dispatchEvent('pointerup', { bubbles: true });
        await poll(page, () => window.__groups.state.draft.furniture.at(-1)?.color?.h === 120, undefined, 'mirrored tint');
        const tinted = await pixels(6, 1);
        assert.notDeepEqual(tinted, mirrored, 'tint changes mirrored variant pixels');
        const color = await page.evaluate(() => window.__groups.state.draft.furniture.at(-1).color);
        const side = fixture.snapshot.furniture.find((entry) => entry.type === 'local_GROUP_SIDE').sprite;
        assert.deepEqual(tinted, expected(getColorizedSprite('expected-mirrored-tint', side.map((row) => [...row].reverse()), color)),
          'exact tinted mirror canvas pixels');
        await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
        assert.deepEqual(await pixels(6, 1), mirrored, 'tint undo restores exact mirrored pixels');
        record.tintUndo = true;
        assert.deepEqual(record.pageErrors, [], 'zero production page errors');
        record.passed = true;
        await page.screenshot({ path: path.join(output, `${label}-${viewport.width}x${viewport.height}.png`) });
      } catch (error) {
        record.error = error.message;
        await page.screenshot({ path: path.join(output, `${label}-${viewport.width}x${viewport.height}-failed.png`) });
      } finally { await page.close(); }
    }
    assert.ok(result.cases.every((record) => record.passed),
      result.cases.filter((record) => !record.passed).map((record) => `${record.viewport.width}x${record.viewport.height}: ${record.error}`).join('\n'));
    return result;
  } catch (error) {
    result.error = error.message;
    throw error;
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.writeFileSync(path.join(output, `${label}-results.json`), JSON.stringify(result, null, 2));
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  if (process.argv.includes('--negative')) {
    const source = copySource(baseline);
    try {
      assert.equal(run([npmCli, 'run', 'build:webview'], source.directory, path.join(output, 'baseline-build.log')), 0);
      await assert.rejects(
        browserAcceptance(path.join(source.directory, 'dist', 'webview', 'assets', 'index.js'), 'baseline'),
        /palette contains one representative/,
        'the explicit pre-feature baseline must fail the new group assertion, not an incidental setup error',
      );
      console.log(`Negative control killed ${source.sha}: palette dedup assertion`);
    } finally { fs.rmSync(source.directory, { recursive: true, force: true }); }
    return;
  }
  if (process.argv.includes('--mutations')) {
    const catalogFile = path.join('webview-ui', 'src', 'office', 'layout', 'furnitureCatalog.ts');
    const mutants = [
      { name: 'variant-order', file: catalogFile,
        pattern: /^      const order = scheme === '2-way' \? \['front', 'right'\] : \['front', 'right', 'back', 'left'\];$/gm,
        replacement: "      const order = scheme === '2-way' ? ['front', 'right'] : ['front', 'back', 'right', 'left'];" },
      { name: 'mirror-flip', file: catalogFile,
        pattern: /^          sprite: asset\.sprite\.map\(\(row\) => \[\.\.\.row\]\.reverse\(\)\),$/gm,
        replacement: '          sprite: asset.sprite.map((row) => [...row]),' },
      { name: 'palette-dedup', file: catalogFile,
        pattern: /^    paletteCatalog = dynamicCatalog\.filter\(\(entry\) => !hidden\.has\(entry\.type\)\)\.map\(\(entry\) =>$/gm,
        replacement: '    paletteCatalog = dynamicCatalog.filter((entry) => entry.type || !hidden.has(entry.type)).map((entry) =>' },
      { name: 'cache-key', file: path.join('webview-ui', 'src', 'office', 'layout', 'layoutManager.ts'),
        pattern: /^  return `furn-\$\{baseKey\}-\$\{color\.h\}-\$\{color\.s\}-\$\{color\.b\}-\$\{color\.c\}-\$\{color\.colorize \? 1 : 0\}`;$/gm,
        replacement: '  return `furn-${baseKey}-${color.h * 0}-${color.s}-${color.b}-${color.c}-${color.colorize ? 1 : 0}`;' },
    ];
    const report = [];
    for (const mutant of mutants) {
      const source = copySource(head);
      try {
        const file = path.join(source.directory, mutant.file);
        const original = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
        assert.equal([...original.matchAll(mutant.pattern)].length, 1, `${mutant.name} substitution matches exactly once`);
        fs.writeFileSync(file, original.replace(mutant.pattern, mutant.replacement));
        const build = run([npmCli, 'run', 'build:webview'], source.directory, path.join(output, `${mutant.name}-build.log`));
        assert.equal(build, 0, `${mutant.name} must compile`);
        const tests = run([path.join(root, 'webview-ui', 'node_modules', 'vitest', 'vitest.mjs'), 'run',
          'src/office/layout/furnitureGroups.test.ts', 'src/office/editor/furnitureGroupsHook.test.tsx'],
        path.join(source.directory, 'webview-ui'), path.join(output, `${mutant.name}-tests.log`));
        const harness = run([__filename, '--bundle', path.join(source.directory, 'dist', 'webview', 'assets', 'index.js'),
          '--label', mutant.name], root, path.join(output, `${mutant.name}-harness.log`));
        assert.notEqual(tests, 0, `${mutant.name} must be killed by focused tests`);
        report.push({ name: mutant.name, pattern: mutant.pattern.source, replacement: mutant.replacement, build, tests, harness });
      } finally { fs.rmSync(source.directory, { recursive: true, force: true }); }
    }
    fs.writeFileSync(path.join(output, 'mutation-results.json'), JSON.stringify({ head, mutants: report }, null, 2));
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(JSON.stringify(await browserAcceptance(bundle, argument('--label') || 'current'), null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
