const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const webviewScript = path.join(root, 'dist', 'webview', 'assets', 'index.js');
const url = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:4173/';
const output = process.env.ACCEPTANCE_OUTPUT_DIR;
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const results = {
  head,
  url,
  boundary: 'Production bundles; compiled provider and synthetic host fixtures, not native VS Code or live Squad evidence',
  bundle: {
    path: path.relative(root, webviewScript),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(webviewScript)).digest('hex'),
  },
  channel: 'msedge',
  cases: [],
};

function assertPixelsEqual(actual, expected, message) {
  assert.equal(actual.length, expected.length, `${message}: region dimensions`);
  assert.deepEqual(actual, expected, message);
}

function changedPixelCount(actual, expected) {
  let count = 0;
  for (let index = 0; index < actual.length; index += 4) {
    if (actual[index] !== expected[index] || actual[index + 1] !== expected[index + 1]
      || actual[index + 2] !== expected[index + 2] || actual[index + 3] !== expected[index + 3]) count++;
  }
  return count;
}

async function main() {
  assert.ok(fs.existsSync(webviewScript), 'production webview bundle must exist');
  if (output) fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  results.browser = browser.version();
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 640 }]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const record = { viewport, pageErrors: errors };
      results.cases.push(record);
      try {
        await page.goto(url);
        await page.waitForFunction(() => window.__petAcceptance?.replayed
          && document.querySelector('canvas')?.width > 0);
        await page.evaluate(() => {
          for (const [name, value] of Object.entries({
            'editor-background': '#1e1e1e', foreground: '#cccccc',
            'button-background': '#0e639c', 'button-foreground': '#ffffff',
            'button-secondaryBackground': '#3a3d41', 'button-secondaryForeground': '#ffffff',
            'panel-border': '#80808059', errorForeground: '#f48771',
          })) document.documentElement.style.setProperty(`--vscode-${name}`, value);
        });
        const fixture = await page.evaluate(() => {
          const layout = window.__petAcceptance.fixtures.find((message) => message.type === 'layoutLoaded')?.layout;
          const assets = window.__petAcceptance.fixtures.find((message) => message.type === 'manifestAssetsLoaded')?.snapshot;
          const desk = assets?.furniture.find((asset) => asset.type === 'pa_DESK_FRONT');
          return {
            furniture: layout?.furniture?.map(({ uid, type, col, row, color }) => ({ uid, type, col, row, color })),
            cols: layout?.cols,
            rows: layout?.rows,
            deskSprite: desk && {
              width: desk.sprite[0].length,
              height: desk.sprite.length,
              serializedBytes: new TextEncoder().encode(JSON.stringify(desk.sprite)).length,
            },
          };
        });
        assert.deepEqual(fixture.furniture.map(({ uid }) => uid), ['color-desk', 'color-pc', 'colorless-chair']);
        assert.deepEqual(fixture.furniture[1].color, { h: 205, s: 85, b: 5, c: 0, colorize: true });
        assert.equal(fixture.furniture[0].color, undefined);
        assert.equal(fixture.furniture[2].color, undefined);
        assert.deepEqual(fixture.deskSprite && [fixture.deskSprite.width, fixture.deskSprite.height], [48, 32]);
        record.fixture = 'Compiled provider served synthetic layout with manifest desk, overlapping PC, and colorless chair';
        record.cacheSweep = {
          hueValues: 360,
          cumulativeFurnitureVariantsGenerated: 360,
          maximumRetainedFurnitureColorEntries: 1,
          approximateRetainedDeskSpritePayloadBytes: fixture.deskSprite.serializedBytes,
          accounting: 'Sprite JSON UTF-8 bytes; excludes JS array/string headers and floor/wall cache entries. clearColorizeCache runs before each selected-color rebuild.',
        };

        const canvas = page.locator('canvas').first();
        const editor = page.getByRole('region', { name: 'Layout editor' });
        await page.getByRole('button', { name: 'Edit Layout', exact: true }).click();
        await editor.waitFor();
        await page.waitForFunction(() => {
          const c = document.querySelector('canvas');
          const ctx = c?.getContext('2d');
          return !!ctx && c.width > 0 && c.height > 0;
        });

        const geometry = await page.evaluate(({ cols, rows }) => {
          const c = document.querySelector('canvas');
          const rect = c.getBoundingClientRect();
          const zoom = Number(document.querySelector('[aria-label="Office zoom"]')?.textContent?.match(/\d+/)?.[0]);
          const dpr = window.devicePixelRatio || 1;
          const cssWidth = c.width / dpr;
          const cssHeight = c.height / dpr;
          const mapWidth = cols * 16 * zoom;
          const mapHeight = rows * 16 * zoom;
          if (mapWidth > cssWidth || mapHeight > cssHeight) throw new Error('Acceptance fixture must fit without panning');
          return {
            x: rect.x + (cssWidth - mapWidth) / 2,
            y: rect.y + (cssHeight - mapHeight) / 2,
            zoom, dpr, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        }, fixture);
        record.canvas = geometry;
        record.editorBounds = await editor.boundingBox();
        record.toolbarOverflow = await editor.evaluate((element) => ({
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
        }));

        const sample = async (col, row, width, height) => page.evaluate(
          async ({ col, row, width, height, geometry }) => {
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const canvas = document.querySelector('canvas');
            const context = canvas.getContext('2d', { willReadFrequently: true });
            const dpr = window.devicePixelRatio || 1;
            const x = Math.round(((geometry.x - geometry.rect.x) + col * 16 * geometry.zoom) * dpr);
            const y = Math.round(((geometry.y - geometry.rect.y) + row * 16 * geometry.zoom) * dpr);
            const w = width * 16 * geometry.zoom * dpr;
            const h = height * 16 * geometry.zoom * dpr;
            return Array.from(context.getImageData(x, y, w, h).data);
          },
          { col, row, width, height, geometry },
        );
        const clickTile = async (col, row) => {
          await page.mouse.click(
            geometry.x + (col * 16 + 8) * geometry.zoom,
            geometry.y + (row * 16 + 8) * geometry.zoom,
          );
        };
        const beforeDesk = await sample(6, 2, 3, 2);
        const beforeControl = await sample(7, 5, 1, 1);
        const pixelSummary = (pixels) => ({
          rgbaBytes: pixels.length,
          opaquePixels: pixels.filter((value, index) => index % 4 === 3 && value > 0).length,
          colors: [...new Set(Array.from({ length: pixels.length / 4 }, (_, index) =>
            pixels.slice(index * 4, index * 4 + 3).join(',')))].slice(0, 8),
        });
        record.baselinePixels = { desk: pixelSummary(beforeDesk), chair: pixelSummary(beforeControl) };
        if (output) await page.screenshot({ path: path.join(output, `furniture-before-${viewport.width}x${viewport.height}.png`) });
        assert.ok(beforeDesk.some((value, index) => index % 4 === 3 && value > 0), 'desk footprint must contain visible pixels');
        assert.ok(beforeControl.some((value, index) => index % 4 === 3 && value > 0), 'colorless chair control must contain visible pixels');
        await page.mouse.move(0, 0);

        await clickTile(6, 2);
        const hue = page.getByRole('slider', { name: 'Selected Furniture Color hue' });
        await hue.scrollIntoViewIfNeeded();
        await hue.waitFor();
        const editColor = async (value) => {
          await hue.dispatchEvent('pointerdown', { bubbles: true });
          await hue.evaluate((element, next) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(element, String(next));
            element.dispatchEvent(new Event('input', { bubbles: true }));
          }, value);
          await hue.dispatchEvent('pointerup', { bubbles: true });
          await page.waitForFunction((expected) =>
            document.querySelector('[aria-label="Selected Furniture Color hue"]')?.value === String(expected), value);
        };
        await editColor(120);
        await page.waitForTimeout(100);
        await page.mouse.move(0, 0);
        const tintedDesk = await sample(6, 2, 3, 2);
        const selectedColorChangedPixels = changedPixelCount(tintedDesk, beforeDesk);
        record.changedPixels = pixelSummary(tintedDesk);
        record.draftAfterHue = await page.evaluate(() => window.__petAcceptance.state?.draft?.furniture
          ?.map(({ uid, color }) => ({ uid, color })));
        if (output) await page.screenshot({ path: path.join(output, `furniture-after-${viewport.width}x${viewport.height}.png`) });
        assert.ok(selectedColorChangedPixels > 0, 'selected color control must change real canvas pixels over the desk');
        assertPixelsEqual(await sample(7, 5, 1, 1), beforeControl,
          'colorless chair pixels must remain unchanged while desk color changes');
        record.selectedColor = { changedDeskPixels: selectedColorChangedPixels, colorlessControlUnchanged: true };
        if (output) await page.screenshot({ path: path.join(output, `furniture-tinted-${viewport.width}x${viewport.height}.png`) });

        await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
        await page.mouse.move(0, 0);
        assertPixelsEqual(await sample(6, 2, 3, 2), beforeDesk, 'Undo must restore exact untinted desk pixels');
        record.selectedColor.undoRestoresExactPixels = true;

        await page.getByTestId('furniture-color-pick-selected').click();
        await clickTile(7, 2);
        await page.waitForFunction(() =>
          document.querySelector('[aria-label="Selected Furniture Color hue"]')?.value === '205');
        const copiedDesk = await sample(6, 2, 3, 2);
        const eyedropChangedPixels = changedPixelCount(copiedDesk, beforeDesk);
        assert.ok(eyedropChangedPixels > 0, 'surface-item eyedrop must render copied furniture color on the desk');
        assert.equal(await page.getByRole('slider', { name: 'Selected Furniture Color saturation' }).inputValue(), '85');
        assert.equal(await page.locator('#colorize-Selected\\ Furniture\\ Color').isChecked(), true);
        record.eyedrop = {
          sampledSurfaceItem: 'color-pc', selectedHue: 205, selectedSaturation: 85,
          selectedColorize: true, changedDeskPixels: eyedropChangedPixels,
        };
        if (output) await page.screenshot({ path: path.join(output, `furniture-eyedrop-${viewport.width}x${viewport.height}.png`) });

        await page.getByTitle('Undo (Ctrl+Z)', { exact: true }).click();
        await page.mouse.move(0, 0);
        assertPixelsEqual(await sample(6, 2, 3, 2), beforeDesk,
          'the furniture eyedrop must be its own undo entry and restore exact baseline pixels');
        record.eyedrop.undoRestoresExactPixels = true;
        assert.deepEqual(errors, [], 'production page errors');
        record.passed = true;
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    if (output) fs.writeFileSync(path.join(output, 'furniture-color-results.json'), JSON.stringify(results, null, 2));
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
