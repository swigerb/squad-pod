const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
require('tsx/cjs');
const { loadAssetSnapshot } = require('../src/manifestAssets.ts');
const { createDefaultOfficeLayout } = require('../src/defaultOfficeLayout.ts');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const bundleRoot = path.resolve(process.env.ACCEPTANCE_BUNDLE_ROOT || root);
const output = process.env.ACCEPTANCE_OUTPUT_DIR;
assert.ok(output, 'Set ACCEPTANCE_OUTPUT_DIR to a local evidence directory');
fs.mkdirSync(output, { recursive: true });
const baseline = process.argv.includes('--baseline');
const label = baseline ? 'before' : 'after';
const bundle = path.join(bundleRoot, 'dist', 'webview', 'assets', 'index.js');
const layout = createDefaultOfficeLayout();
const snapshot = loadAssetSnapshot(path.join(bundleRoot, 'webview-ui', 'public', 'assets'));
assert.deepEqual(snapshot.diagnostics, []);
const fixtures = JSON.stringify([
  { type: 'settingsLoaded', settings: { soundEnabled: false, debugEnabled: false, showAreas: false } },
  { type: 'manifestAssetsLoaded', snapshot },
  { type: 'layoutLoaded', layout, revision: 'conference-fixture', source: 'external' },
  { type: 'existingAgents', agents: [] },
  { type: 'directoryCatalog', catalog: { workspaceDirectories: [], savedDirectories: [], recentLaunches: [] } },
]).replace(/</g, '\\u003c');
const html = `<!doctype html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-fixture'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'">
<link rel="stylesheet" href="/assets/index.css">
<style>body{margin:0;--vscode-editor-background:#1e1e1e;--vscode-foreground:#ccc;--vscode-button-background:#0e639c;--vscode-button-foreground:white;--vscode-button-secondaryBackground:#3a3d41;--vscode-button-secondaryForeground:white;--vscode-errorForeground:#f48771}</style>
</head><body><div id="root"></div><script nonce="fixture">
window.__conference = { replayed: false, outbound: [], state: null };
window.acquireVsCodeApi = () => ({
  getState: () => undefined,
  setState: (state) => { window.__conference.state = state; return state; },
  postMessage(message) {
    window.__conference.outbound.push(message);
    if(message.type === 'webviewReady' && !window.__conference.replayed) {
      window.__conference.replayed = true;
      setTimeout(() => ${fixtures}.forEach(data => window.dispatchEvent(new MessageEvent('message', {data}))), 100);
    }
    if(message.type === 'saveLayout') setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
      data: {type:'layoutSaved',layout:message.layout,revision:'conference-saved'}
    })), 25);
  }
});
</script><script nonce="fixture" type="module" src="/assets/index.js"></script></body></html>`;

async function main() {
  const result = {
    label,
    source: baseline ? '134f1d82f94cdae1a8181e76610075ba790cfdda'
      : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    bundleSha256: crypto.createHash('sha256').update(fs.readFileSync(bundle)).digest('hex'),
    boundary: 'Actual Vite production webview, bundled manifest pixels, synthetic host boundary and no agents; not native VS Code or real Squad acceptance',
    pageErrors: [], pcs: [],
  };
  const server = http.createServer((request, response) => {
    const files = {
      '/assets/index.js': [bundle, 'application/javascript'],
      '/assets/index.css': [path.join(bundleRoot, 'dist', 'webview', 'assets', 'index.css'), 'text/css'],
    };
    const file = files[request.url];
    if (file) { response.writeHead(200, { 'Content-Type': file[1] }); response.end(fs.readFileSync(file[0])); }
    else if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); }
    else { response.writeHead(404); response.end(); }
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    result.browser = browser.version();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => result.pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.__conference.state?.draft?.furniture?.length > 20);
    await page.waitForTimeout(300);
    const geometry = await page.evaluate(({ cols, rows }) => {
      const canvas = document.querySelector('canvas');
      const zoom = Number(document.querySelector('[aria-label="Office zoom"]').textContent.match(/\d+/)[0]);
      return { x: (canvas.width - cols * 16 * zoom) / 2, y: (canvas.height - rows * 16 * zoom) / 2, zoom };
    }, layout);
    for (const pc of layout.furniture.filter(item => item.uid.startsWith('computer-side-'))) {
      const source = snapshot.furniture.find(item => item.type === pc.type.replace(':left', '')).sprite;
      const sprite = pc.type.endsWith(':left') ? source.map(row => [...row].reverse()) : source;
      const samples = sprite.flatMap((row, y) => row.flatMap((color, x) =>
        color && (color.length === 7 || color.slice(7) === 'ff') ? [{ x, y, color: color.slice(0, 7) }] : []));
      const actual = await page.evaluate(({ pc, samples, geometry }) => {
        const ctx = document.querySelector('canvas').getContext('2d', { willReadFrequently: true });
        return samples.map(({ x, y }) => {
          const pixel = ctx.getImageData(
            geometry.x + (pc.col * 16 + x) * geometry.zoom,
            geometry.y + (pc.row * 16 + y) * geometry.zoom, 1, 1).data;
          return '#' + Array.from(pixel).slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
        });
      }, { pc, samples, geometry });
      const matching = samples.filter((sample, index) => sample.color === actual[index]).length;
      result.pcs.push({ uid: pc.uid, opaquePixels: samples.length, matching });
    }
    await page.screenshot({ path: path.join(output, `${label}-office.png`) });
    const canvasBounds = await page.locator('canvas').boundingBox();
    await page.screenshot({
      path: path.join(output, `${label}-conference.png`),
      clip: {
        x: canvasBounds.x + geometry.x + 3 * 16 * geometry.zoom,
        y: canvasBounds.y + geometry.y + 6 * 16 * geometry.zoom,
        width: 5 * 16 * geometry.zoom, height: 6 * 16 * geometry.zoom,
      },
    });
    assert.deepEqual(result.pageErrors, []);
    for (const pc of result.pcs) {
      if (baseline && ['computer-side-1', 'computer-side-3'].includes(pc.uid)) {
        assert.ok(pc.matching < pc.opaquePixels / 2, `${pc.uid}: baseline must reproduce obscured rear PC`);
      } else {
        assert.equal(pc.matching, pc.opaquePixels, `${pc.uid}: every opaque source pixel must be visible`);
      }
    }
    result.passed = true;
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    result.error = error.message;
    throw error;
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(output, `${label}-results.json`), JSON.stringify(result, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
