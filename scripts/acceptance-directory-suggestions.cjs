const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const output = process.env.ACCEPTANCE_OUTPUT_DIR;
const bundleIndex = process.argv.indexOf('--bundle');
const bundle = bundleIndex < 0 ? path.join(root, 'dist', 'webview', 'assets', 'index.js') : process.argv[bundleIndex + 1];
const baseCatalog = {
  workspaceDirectories: [{ id: 'workspace:fixture', name: 'Workspace fixture', path: 'C:\\Synthetic\\Workspace', valid: true }],
  savedDirectories: Array.from({ length: 12 }, (_, index) => ({
    id: `saved:fixture:${index}`, name: `Saved fixture ${index}`,
    path: `C:\\Synthetic\\Saved\\${index}`, valid: true,
  })),
  recentLaunches: [{ id: 'recent:fixture', name: 'Recent request', path: 'C:\\Synthetic\\Recent', valid: true, lastLaunchedAt: '2026-10-29T18:00:00.000Z' }],
  squadHistory: Array.from({ length: 10 }, (_, index) => ({
    id: `session:${index}`, name: `Squad fixture ${index}`,
    path: `C:\\Synthetic\\Long parent folder\\Squad fixture ${index}`, valid: true,
    lastLaunchedAt: '2026-10-29T18:00:00.000Z',
  })),
};
const screenshots = {
  invalid: {
    workspaceDirectories: [
      { id: 'workspace:missing', name: 'Unavailable fixture', path: 'C:\\Synthetic\\Unavailable', valid: false, error: 'Directory does not exist or cannot be accessed: C:\\Synthetic\\Unavailable' },
      baseCatalog.workspaceDirectories[0],
    ],
    savedDirectories: [],
    recentLaunches: [],
    squadHistory: [],
  },
  workspace: {
    workspaceDirectories: [baseCatalog.workspaceDirectories[0]],
    savedDirectories: [],
    recentLaunches: [],
    squadHistory: [],
  },
  saved: {
    workspaceDirectories: [],
    savedDirectories: baseCatalog.savedDirectories,
    recentLaunches: [],
    squadHistory: [],
  },
  empty: { workspaceDirectories: [], savedDirectories: [], recentLaunches: [], squadHistory: [] },
};
const fixtures = JSON.stringify([
  { type: 'settingsLoaded', settings: { soundEnabled: false, debugEnabled: false, showAreas: false } },
  { type: 'directoryCatalog', catalog: baseCatalog },
  { type: 'noWorkspace' },
]).replace(/</g, '\\u003c');
const html = `<!doctype html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-fixture'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'">
<link rel="stylesheet" href="/index.css">
<style>body{margin:0;--vscode-editor-background:#1e1e1e;--vscode-foreground:#ccc;--vscode-descriptionForeground:#9da1a6;--vscode-panel-border:#666;--vscode-button-background:#0e639c;--vscode-button-foreground:white;--vscode-button-secondaryBackground:#3a3d41;--vscode-button-secondaryForeground:#fff;--vscode-button-hoverBackground:#1177bb;--vscode-focusBorder:#007fd4;--vscode-input-background:#252526;--vscode-input-foreground:#ccc;--vscode-input-border:#3c3c3c;--vscode-errorForeground:#f48771}</style>
</head><body><div id="root"></div><script nonce="fixture">
window.__directories = { outbound: [], ready: false };
window.__sendDirectoryHost = (data) => window.dispatchEvent(new MessageEvent('message', { data }));
window.acquireVsCodeApi = () => ({
  getState: () => undefined, setState: (state) => state,
  postMessage(message) {
    window.__directories.outbound.push(message);
    if (message.type === 'webviewReady' && !window.__directories.ready) {
      window.__directories.ready = true;
      setTimeout(() => ${fixtures}.forEach(window.__sendDirectoryHost), 20);
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
  if (output) fs.mkdirSync(output, { recursive: true });
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
      const record = { viewport, pageErrors: [], assertions: [], captures: [] };
      report.cases.push(record);
      page.on('pageerror', (error) => record.pageErrors.push(error.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.getByRole('button', { name: 'Manage / Launch Directories', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Launch directory' });
        await dialog.waitFor();
        await dialog.getByRole('button', { name: 'Browse for a directory', exact: true }).waitFor();
        assert.equal(await dialog.evaluate((element) => getComputedStyle(element).textAlign), 'left',
          'dialog content must override the centered no-workspace parent');
        record.assertions.push('dialog content remains left-aligned over the centered no-workspace view');

        const manual = dialog.locator('.directory-manual > summary');
        await manual.click();
        const suggestions = dialog.getByRole('region', { name: 'Recent Squad directories', exact: true });
        await suggestions.waitFor();
        assert.equal(await suggestions.getByRole('button').count(), 10);
        const before = await page.evaluate(() => window.__directories.outbound.length);
        const first = suggestions.getByRole('button', { name: 'Squad fixture 0', exact: true });
        assert.equal(await first.getAttribute('title'), baseCatalog.squadHistory[0].path);
        await first.focus();
        await page.keyboard.press('Enter');
        assert.equal(await dialog.getByRole('textbox', { name: 'Directory path', exact: true }).inputValue(), baseCatalog.squadHistory[0].path);
        assert.equal(await dialog.getByRole('textbox', { name: 'Directory name', exact: true }).inputValue(), baseCatalog.squadHistory[0].name);
        const second = suggestions.getByRole('button', { name: 'Squad fixture 1', exact: true });
        await second.focus();
        await page.keyboard.press('Space');
        assert.equal(await dialog.getByRole('textbox', { name: 'Directory path', exact: true }).inputValue(), baseCatalog.squadHistory[1].path);
        assert.equal(await page.evaluate(() => window.__directories.outbound.length), before,
          'keyboard suggestion selection must not send any host message');
        record.assertions.push('10 chips with full-path titles; Enter and Space fill the manual form without any host message');

        const pathInput = dialog.getByRole('textbox', { name: 'Directory path', exact: true });
        const nameInput = dialog.getByRole('textbox', { name: 'Directory name', exact: true });
        await pathInput.fill('C:\\Synthetic\\Manual');
        await nameInput.fill('Manual fixture');
        const saveBefore = await page.evaluate(() => window.__directories.outbound.length);
        await dialog.getByRole('button', { name: 'Save directory', exact: true }).click();
        assert.deepEqual(await page.evaluate((offset) => window.__directories.outbound.slice(offset), saveBefore), [
          { type: 'addDirectory', path: 'C:\\Synthetic\\Manual', name: 'Manual fixture' },
        ]);
        assert.equal(await page.evaluate(() =>
          window.__directories.outbound.some((message) => message.type === 'launchDirectory')), false);
        record.assertions.push('manual save sends only addDirectory; no automatic launch');
        await manual.click();

        for (const [mode, catalog] of Object.entries(screenshots)) {
          await page.evaluate((nextCatalog) => {
            window.__sendDirectoryHost({ type: 'directoryCatalog', catalog: nextCatalog });
          }, catalog);
          await page.waitForTimeout(20);
          if (mode === 'invalid') {
            const row = dialog.locator('[data-directory-row="workspace:missing"]');
            assert.equal(await row.getByRole('button', { name: 'Launch Unavailable fixture', exact: true }).isDisabled(), true);
            assert.match(await row.textContent(), /Unavailable/);
            assert.match(await row.textContent(), /missing or cannot be accessed/);
            assert.equal(await row.locator('.directory-row__path').getAttribute('title'), 'C:\\Synthetic\\Unavailable');
            record.assertions.push('invalid folder has row-level status and reason; Launch is disabled');
          } else if (mode === 'workspace') {
            assert.equal(await dialog.getByRole('button', { name: 'Launch Workspace fixture', exact: true }).isEnabled(), true);
          } else if (mode === 'saved') {
            if (viewport.width === 360) {
              const footerVisibility = await dialog.evaluate((element) => {
                const footer = element.querySelector('.directory-add');
                const browse = footer?.querySelector('[aria-label="Browse for a directory"]');
                const manual = footer?.querySelector('.directory-manual');
                const summary = manual?.querySelector('summary');
                const footerBounds = footer?.getBoundingClientRect();
                const browseBounds = browse?.getBoundingClientRect();
                const summaryBounds = summary?.getBoundingClientRect();
                const fullyInsideFooterAndViewport = (bounds) => (
                  !!bounds && !!footerBounds
                  && bounds.width > 0 && bounds.height > 0
                  && bounds.top >= footerBounds.top && bounds.bottom <= footerBounds.bottom
                  && bounds.top >= 0 && bounds.bottom <= window.innerHeight
                );
                return {
                  collapsed: manual instanceof HTMLDetailsElement && !manual.open,
                  footerVisible: !!footerBounds && footerBounds.top >= 0 && footerBounds.bottom <= window.innerHeight,
                  browseVisible: fullyInsideFooterAndViewport(browseBounds),
                  manualDisclosureVisible: fullyInsideFooterAndViewport(summaryBounds),
                };
              });
              assert.equal(footerVisibility.collapsed, true, 'manual entry must be collapsed in the long-list state');
              assert.equal(footerVisibility.footerVisible, true, 'the Add footer must remain in the viewport');
              assert.equal(footerVisibility.browseVisible, true, 'Browse must remain visible without locator auto-scroll');
              assert.equal(footerVisibility.manualDisclosureVisible, true,
                'the manual-entry disclosure must remain visible without locator auto-scroll');
              record.assertions.push('collapsed Add footer, Browse, and manual-entry disclosure remain visible with 12 saved rows');
            }
            const lastSavedRow = dialog.locator('[data-directory-row="saved:fixture:11"]');
            await lastSavedRow.scrollIntoViewIfNeeded();
            const manage = dialog.getByLabel('Manage directory actions for Saved fixture 11');
            await manage.click();
            assert.equal(await dialog.getByRole('textbox', { name: 'Name for Saved fixture 11', exact: true }).count(), 1);
            const rename = dialog.getByRole('button', { name: 'Rename Saved fixture 11', exact: true });
            await rename.scrollIntoViewIfNeeded();
            await rename.click({ trial: true });
            await manage.click();
            record.assertions.push('Manage actions on the last saved row remain reachable inside the scrollable list');
          } else {
            assert.equal(await dialog.locator('.directory-empty').count(), 3);
          }
          const geometry = await dialog.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const list = element.querySelector('.directory-list');
            return {
              left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
              dialogWidth: element.clientWidth, dialogScrollWidth: element.scrollWidth,
              listWidth: list.clientWidth, listScrollWidth: list.scrollWidth,
            };
          });
          assert.ok(geometry.left >= 0 && geometry.right <= viewport.width, `${mode}: dialog fits the viewport horizontally`);
          assert.ok(geometry.top >= 0 && geometry.bottom <= viewport.height, `${mode}: dialog fits the viewport vertically`);
          assert.ok(geometry.dialogScrollWidth <= geometry.dialogWidth, `${mode}: dialog has no horizontal overflow`);
          assert.ok(geometry.listScrollWidth <= geometry.listWidth, `${mode}: directory list has no horizontal overflow`);
          assert.equal(await page.evaluate(() => window.__directories.outbound.some((message) => message.type === 'launchDirectory')), false,
            'opening and changing directory data must not launch');
          const screenshotName = `directory-dialog-${mode}-${viewport.width}x${viewport.height}.png`;
          if (output) await page.screenshot({ path: path.join(output, screenshotName) });
          record.captures.push({ mode, file: output ? screenshotName : null, geometry });
        }

        if (viewport.width === 360) {
          await page.evaluate((nextCatalog) => {
            window.__sendDirectoryHost({ type: 'directoryCatalog', catalog: nextCatalog });
            window.__sendDirectoryHost({
              type: 'directoryError',
              error: 'Synthetic action failure at C:\\Synthetic\\Unavailable; review the requested folder before retrying.',
            });
          }, { ...screenshots.invalid, squadHistory: baseCatalog.squadHistory });
          await page.waitForTimeout(20);
          const invalidDetails = dialog.locator('[data-directory-row="workspace:missing"] .directory-row__error');
          await invalidDetails.locator('summary').click();
          await dialog.locator('.directory-global-error details > summary').click();
          await manual.click();
          const suggestionsAfterError = dialog.getByRole('region', { name: 'Recent Squad directories', exact: true });
          assert.equal(await suggestionsAfterError.getByRole('button').count(), 10);
          const pathDraft = dialog.getByRole('textbox', { name: 'Directory path', exact: true });
          const nameDraft = dialog.getByRole('textbox', { name: 'Directory name', exact: true });
          await pathDraft.fill('C:\\Synthetic\\Draft');
          await nameDraft.fill('Draft fixture');
          assert.equal(await pathDraft.inputValue(), 'C:\\Synthetic\\Draft');
          assert.equal(await nameDraft.inputValue(), 'Draft fixture');
          await dialog.getByRole('button', { name: 'Save directory', exact: true }).scrollIntoViewIfNeeded();
          assert.equal(await invalidDetails.evaluate((element) => element.open), true);
          assert.equal(await dialog.locator('.directory-global-error details').evaluate((element) => element.open), true);
          const stressGeometry = await dialog.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const footer = element.querySelector('.directory-add');
            const list = element.querySelector('.directory-list');
            return {
              left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
              dialogWidth: element.clientWidth, dialogScrollWidth: element.scrollWidth,
              footerWidth: footer.clientWidth, footerScrollWidth: footer.scrollWidth,
              listWidth: list.clientWidth, listScrollWidth: list.scrollWidth,
            };
          });
          assert.ok(stressGeometry.right <= viewport.width && stressGeometry.left >= 0);
          assert.ok(stressGeometry.bottom <= viewport.height && stressGeometry.top >= 0);
          assert.ok(stressGeometry.dialogScrollWidth <= stressGeometry.dialogWidth);
          assert.ok(stressGeometry.footerScrollWidth <= stressGeometry.footerWidth);
          assert.ok(stressGeometry.listScrollWidth <= stressGeometry.listWidth);
          const stressName = 'directory-dialog-manual-stress-360x640.png';
          if (output) await page.screenshot({ path: path.join(output, stressName) });
          record.captures.push({ mode: 'manual-stress', file: output ? stressName : null, geometry: stressGeometry });
          record.assertions.push('narrow manual entry, 10 suggestions, expanded row/global error details and preserved draft fit without horizontal overflow');
        }
        assert.deepEqual(record.pageErrors, []);
      } finally {
        await page.close();
      }
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (output) fs.writeFileSync(path.join(output, 'directory-dialog-report.json'), JSON.stringify(report, null, 2) + '\n');
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
