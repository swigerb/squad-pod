const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Reuse an existing Playwright installation; this check never installs a browser or package.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:4173/';
const output = process.env.ACCEPTANCE_OUTPUT_DIR;
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const results = {
  head, url, boundary: 'Production bundles; mocked VS Code boundary, not native-host proof',
  channel: 'msedge', cases: [],
};

async function main() {
  if (output) fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  results.browser = browser.version();
  try {
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 360, height: 640 },
      { width: 240, height: 480 },
      { width: 320, height: 240 },
    ]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const record = { viewport, hits: [] };
      results.cases.push(record);
      try {
        await page.goto(url);
        const zoom = page.getByRole('group', { name: 'Office zoom' });
        const zoomIn = page.getByRole('button', { name: 'Zoom in', exact: true });
        const zoomOut = page.getByRole('button', { name: 'Zoom out', exact: true });
        const editor = page.getByRole('region', { name: 'Layout editor' });
        const select = page.getByRole('button', { name: 'Select', exact: true });
        const pets = page.getByRole('button', { name: 'Pets', exact: true });
        const canvas = page.locator('canvas').first();

        async function hitClick(locator, name) {
          await locator.scrollIntoViewIfNeeded();
          const hit = await locator.evaluate((element) => {
            const r = element.getBoundingClientRect();
            const x = r.x + r.width / 2;
            const y = r.y + r.height / 2;
            const stack = document.elementsFromPoint(x, y);
            return {
              rect: { x: r.x, y: r.y, width: r.width, height: r.height },
              x, y, target: stack[0]?.outerHTML.slice(0, 300),
              hit: stack[0] === element || element.contains(stack[0]),
              stack: stack.slice(0, 5).map((node) => `${node.tagName}:${node.getAttribute('aria-label') || node.getAttribute('title') || node.className}`),
            };
          });
          record.hits.push({ name, ...hit });
          assert.equal(hit.hit, true, `${name}: center intercepted by ${hit.target}`);
          // A normal click must pass Playwright's own visibility/stability/hit-target checks.
          await locator.click({ timeout: 5000 });
        }

        await zoom.waitFor();
        const canvasBefore = await canvas.boundingBox();
        const normalZoom = await zoom.boundingBox();
        assert.equal(normalZoom.x, 16);
        assert.equal(normalZoom.y, 16);
        await hitClick(zoomIn, 'normal Zoom in');
        const normalLevel = await zoom.textContent();
        await hitClick(zoomOut, 'normal Zoom out');
        assert.notEqual(await zoom.textContent(), normalLevel);
        await hitClick(page.getByRole('button', { name: 'Edit Layout', exact: true }), 'Edit Layout');
        assert.deepEqual(await canvas.boundingBox(), canvasBefore, 'editor must not resize/reposition the canvas');
        const editorBox = await editor.boundingBox();
        const zoomBox = await zoom.boundingBox();
        record.editor = editorBox;
        record.zoom = zoomBox;
        assert.ok(zoomBox.y + zoomBox.height <= editorBox.y, 'zoom strip must end above the editor');
        assert.ok(editorBox.x >= 0 && editorBox.x + editorBox.width <= viewport.width, 'editor must fit panel width');
        await hitClick(pets, 'Pets');
        assert.equal(await pets.getAttribute('aria-pressed'), 'true');
        const levelBeforeSelect = await zoom.textContent();
        await hitClick(select, 'Select after Pets');
        assert.equal(await select.getAttribute('aria-pressed'), 'true');
        assert.equal(await pets.getAttribute('aria-pressed'), 'false');
        assert.equal(await zoom.textContent(), levelBeforeSelect, 'Select must not zoom');
        await hitClick(zoomIn, 'editor Zoom in');
        assert.notEqual(await zoom.textContent(), levelBeforeSelect);
        assert.equal(await select.getAttribute('aria-pressed'), 'true');
        await hitClick(zoomOut, 'editor Zoom out');
        assert.equal(await zoom.textContent(), levelBeforeSelect);

        // Expand creates a real dirty draft; overflow must not strand Save or Undo.
        await hitClick(page.getByTitle('Expand Right', { exact: true }), 'Expand Right');
        await hitClick(page.getByRole('button', { name: /Save Layout/ }), 'Save after scrolling');
        await page.getByRole('button', { name: 'Save Layout', exact: true }).waitFor();
        const saved = await page.evaluate(() => window.__petAcceptance.outbound.filter((m) => m.type === 'saveLayout').at(-1)?.layout);
        assert.ok(saved, 'Save must reach the mocked host after scrolling');
        await hitClick(page.getByTitle('Undo (Ctrl+Z)', { exact: true }), 'Undo after scrolling');
        await hitClick(page.getByRole('button', { name: /Save Layout/ }), 'Save undone layout');
        await page.getByRole('button', { name: 'Save Layout', exact: true }).waitFor();
        const undone = await page.evaluate(() => window.__petAcceptance.outbound.filter((m) => m.type === 'saveLayout').at(-1)?.layout);
        assert.equal(undone.cols, saved.cols - 1);
        await hitClick(page.getByTitle('Redo (Ctrl+Y)', { exact: true }), 'Redo after scrolling');
        await hitClick(pets, 'Pets after scrolling');
        await hitClick(select, 'Select after scrolling and Pets');
        assert.equal(await select.getAttribute('aria-pressed'), 'true');
        await hitClick(zoomIn, 'Zoom in with scrolled editor');
        await hitClick(zoomOut, 'Zoom out with scrolled editor');
        assert.deepEqual(await canvas.boundingBox(), canvasBefore);
        assert.deepEqual(errors, [], 'production page errors');
        record.passed = true;
        if (output) await page.screenshot({ path: path.join(output, `controls-${viewport.width}x${viewport.height}.png`) });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    if (output) fs.writeFileSync(path.join(output, 'controls-results.json'), JSON.stringify(results, null, 2));
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
