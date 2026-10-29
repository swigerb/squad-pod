const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const output = process.env.ACCEPTANCE_OUTPUT_DIR;
const results = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  boundary: 'Production webview and compiled-provider snapshots; mocked VS Code boundary, no native host or CLI launch.',
  cases: [],
};

async function main() {
  if (output) fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  results.browser = browser.version();
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 640 }, { width: 240, height: 480 }]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(process.env.ACCEPTANCE_URL || 'http://127.0.0.1:4173/');
        await page.evaluate(() => {
          for (const [name, value] of Object.entries({
            'editor-background': '#1e1e1e', foreground: '#cccccc', 'descriptionForeground': '#aaaaaa',
            'button-background': '#0e639c', 'button-foreground': '#ffffff',
            'panel-border': '#80808059',
          })) document.documentElement.style.setProperty(`--vscode-${name}`, value);
        });
        await page.getByRole('group', { name: 'Office zoom' }).waitFor();
        const telemetry = page.getByRole('button', { name: 'Telemetry', exact: true });
        await telemetry.scrollIntoViewIfNeeded();
        await telemetry.click();
        const section = page.getByRole('region', { name: 'Recorded Squad usage', exact: true });
        await section.waitFor({ state: 'visible' });
        await section.locator('summary').first().click();
        await page.waitForFunction(() => document.querySelector('[aria-label="Recorded Squad usage"]')?.textContent.includes('1,400 input / 400 output'));
        const text = await section.textContent();
        for (const expected of [
          'Local source: partial', 'Partial sums (valid records only): 1,400 input / 400 output',
          '1 / 2 recorded starts', 'Rejected lines: 1; unsupported: 1; pending final line: yes',
          'runtime bus not connected', 'Parent-child hierarchy / roster promotion: unavailable',
          'not current model, live context or billing-grade accounting',
        ]) assert.ok(text.includes(expected), `Missing production usage text: ${expected}`);
        const summary = section.locator('summary').filter({ hasText: 'Recent historical reports' });
        await summary.scrollIntoViewIfNeeded();
        await summary.click();
        for (const expected of [
          'historical roster match: Ada', 'unattributed (ambiguous roster identity)', 'Not on roster - unattributed',
          'Reported model: recorded-model-a', 'Reported model: recorded-model-b', 'Reported model: unknown',
        ]) assert.ok((await section.textContent()).includes(expected), expected);
        assert.equal(await section.evaluate(element => element.scrollWidth > element.clientWidth), false, 'usage content must wrap in narrow panels');
        await section.locator('strong').first().scrollIntoViewIfNeeded();
        if (output) await page.screenshot({ path: path.join(output, `usage-${viewport.width}.png`) });
        const color = await section.evaluate(element => getComputedStyle(element).color);
        assert.equal(color, 'rgb(204, 204, 204)', 'recorded history must use the theme foreground instead of black-on-dark default text');
        const outbound = await page.evaluate(() => window.__petAcceptance.outbound);
        assert.equal(outbound.some(message => message.type === 'launchDirectory'), false, 'fixture must never launch a terminal');
        assert.equal(await page.getByText('Telemetry (0)', { exact: true }).count(), 1, 'historical ingestion must not add live telemetry');
        assert.deepEqual(errors, [], 'production page errors');
        results.cases.push({ viewport, partialSums: '1400 / 400', coverage: '1 / 2', attribution: ['roster-match', 'unattributed', 'ambiguous'], pageErrors: errors });
      } finally {
        await page.close();
      }
    }
    console.log(JSON.stringify(results, null, 2));
    if (output) fs.writeFileSync(path.join(output, 'usage-results.json'), JSON.stringify(results, null, 2) + '\n');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
