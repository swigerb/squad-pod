const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const output = process.env.ACCEPTANCE_OUTPUT_DIR || path.join(os.tmpdir(), 'squad-pod-directory-acceptance');
const bundleIndex = process.argv.indexOf('--bundle');
const bundle = bundleIndex < 0 ? path.join(root, 'dist', 'webview', 'assets', 'index.js') : process.argv[bundleIndex + 1];
const catalog = {
  workspaceDirectories: [{ id: 'workspace:fixture', name: 'Workspace fixture', path: 'C:\\Synthetic\\Workspace', valid: true }],
  savedDirectories: [{ id: 'saved:fixture', name: 'Saved fixture', path: 'C:\\Synthetic\\Saved', valid: true }],
  recentLaunches: [],
  squadHistory: Array.from({ length: 10 }, (_, index) => ({
    id: `session:${index}`, name: `Squad fixture ${index}`,
    path: `C:\\Synthetic\\Long parent folder\\Squad fixture ${index}`, valid: true,
    lastLaunchedAt: '2026-10-29T18:00:00.000Z',
  })),
};
const fixtures = JSON.stringify([
  { type: 'settingsLoaded', settings: { soundEnabled: false, debugEnabled: false, showAreas: false } },
  { type: 'directoryCatalog', catalog },
  { type: 'noWorkspace' },
]).replace(/</g, '\\u003c');
const html = `<!doctype html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-fixture'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'">
<link rel="stylesheet" href="/index.css">
<style>body{margin:0;--vscode-editor-background:#1e1e1e;--vscode-foreground:#ccc;--vscode-button-background:#0e639c;--vscode-button-foreground:white;--vscode-panel-border:#666;--vscode-errorForeground:#f48771}</style>
</head><body><div id="root"></div><script nonce="fixture">
window.__directories = { outbound: [], ready: false };
window.acquireVsCodeApi = () => ({
  getState: () => undefined, setState: (state) => state,
  postMessage(message) {
    window.__directories.outbound.push(message);
    if (message.type === 'webviewReady' && !window.__directories.ready) {
      window.__directories.ready = true;
      setTimeout(() => ${fixtures}.forEach(data => window.dispatchEvent(new MessageEvent('message', { data }))), 20);
    }
  }
});
</script><script nonce="fixture" type="module" src="/index.js"></script></body></html>`;
const server = http.createServer((request, response) => {
  const files = {
    '/index.js': [bundle, 'application/javascript'],
    '/index.css': [path.join(root, 'dist', 'webview', 'assets', 'index.css'), 'text/css'],
  };
  if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(html);
  } else if (files[request.url]) {
    const [file, type] = files[request.url];
    response.writeHead(200, { 'Content-Type': type });
    response.end(fs.readFileSync(file));
  } else {
    response.writeHead(404);
    response.end();
  }
});

(async () => {
  const report = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    limitation: 'Production webview with synthetic catalog and mocked host; not native VS Code or real Copilot CLI evidence.',
    cases: [],
  };
  let browser;
  fs.mkdirSync(output, { recursive: true });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    browser = await chromium.launch({
      executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: true,
    });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 640 }]) {
      const page = await browser.newPage({ viewport });
      const record = { viewport, pageErrors: [], assertions: [] };
      report.cases.push(record);
      page.on('pageerror', (error) => record.pageErrors.push(error.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.getByRole('button', { name: 'Manage / Launch Directories', exact: true }).click();
        const suggestions = page.getByRole('region', { name: 'Recent Squad directories', exact: true });
        await suggestions.waitFor();
        assert.equal(await suggestions.getByRole('button').count(), 10);
        const before = await page.evaluate(() => window.__directories.outbound.length);
        const first = suggestions.getByRole('button', { name: 'Squad fixture 0', exact: true });
        assert.equal(await first.getAttribute('title'), catalog.squadHistory[0].path);
        await first.focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.getByRole('textbox', { name: 'Directory path', exact: true }).inputValue(), catalog.squadHistory[0].path);
        assert.equal(await page.getByRole('textbox', { name: 'Directory name', exact: true }).inputValue(), catalog.squadHistory[0].name);
        const second = suggestions.getByRole('button', { name: 'Squad fixture 1', exact: true });
        await second.focus();
        await page.keyboard.press('Space');
        assert.equal(await page.getByRole('textbox', { name: 'Directory path', exact: true }).inputValue(), catalog.squadHistory[1].path);
        assert.equal(await page.evaluate(() => window.__directories.outbound.length), before,
          'keyboard suggestion selection must not send any host message');
        record.assertions.push('10 chips with full-path titles; Enter and Space fill form without any host message');
        const geometry = await page.getByRole('dialog').evaluate((dialog) => {
          const section = dialog.querySelector('section').getBoundingClientRect();
          const list = dialog.querySelector('[aria-label="Directory list"]');
          return {
            left: section.left, right: section.right, top: section.top, bottom: section.bottom,
            listWidth: list.clientWidth, listScrollWidth: list.scrollWidth,
          };
        });
        assert.ok(geometry.left >= 0 && geometry.right <= viewport.width);
        assert.ok(geometry.top >= 0 && geometry.bottom <= viewport.height);
        assert.ok(geometry.listScrollWidth <= geometry.listWidth, 'directory content must not overflow horizontally');
        record.geometry = geometry;
        record.assertions.push('modal fits viewport; directory content has no horizontal overflow');
        await page.getByRole('textbox', { name: 'Directory path', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `directories-${viewport.width}x${viewport.height}.png`) });
        await page.getByRole('button', { name: 'Save directory', exact: true }).click();
        assert.deepEqual(await page.evaluate((offset) => window.__directories.outbound.slice(offset), before), [
          { type: 'addDirectory', path: catalog.squadHistory[1].path, name: catalog.squadHistory[1].name },
        ]);
        record.assertions.push('only explicit Save sends addDirectory; no launch');
        assert.deepEqual(record.pageErrors, []);
      } finally {
        await page.close();
      }
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    fs.writeFileSync(path.join(output, 'directory-suggestions-report.json'), JSON.stringify(report, null, 2) + '\n');
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
