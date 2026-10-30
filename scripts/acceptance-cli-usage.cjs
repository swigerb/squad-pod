const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
require('tsx/cjs');
const { parseCliUsage } = require('../src/cliUsage.ts');

const output = process.env.ACCEPTANCE_OUTPUT_DIR;
const fixture = fs.readFileSync(path.resolve('src', '__fixtures__', 'cli-usage-1.0.105.synthetic.json'), 'utf8');
const snapshot = {
  ...parseCliUsage(fixture), sourcePath: 'C:\\synthetic-workspace\\usage.json', canRefresh: true,
  checkedAt: '2026-10-30T12:00:00.000Z',
};
assert.equal(snapshot.state, 'ready');
const results = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  boundary: 'FIXTURE/BROWSER: shipped-declaration synthetic JSON -> real parser -> production App host-message seam. No native VS Code or real CLI export.',
  cases: [],
};
async function main() {
  if (output) fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  results.browser = browser.version();
  try {
    for (const theme of ['dark', 'light']) {
      for (const width of [1280, 360]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.goto(process.env.ACCEPTANCE_URL || 'http://127.0.0.1:4173/');
          await page.evaluate(theme => {
            for (const [key, value] of Object.entries({
              'editor-background': theme === 'dark' ? '#1e1e1e' : '#ffffff',
              foreground: theme === 'dark' ? '#cccccc' : '#333333',
              descriptionForeground: theme === 'dark' ? '#aaaaaa' : '#555555',
              'panel-border': '#80808059',
            })) document.documentElement.style.setProperty(`--vscode-${key}`, value);
            const label = document.createElement('p');
            label.textContent = 'SYNTHETIC FIXTURE - not a real CLI export or native VS Code acceptance';
            label.style.cssText = 'position:fixed;top:0;left:8px;z-index:2000;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:12px monospace;max-width:90%';
            document.body.append(label);
          }, theme);
          await page.getByRole('group', { name: 'Office zoom' }).waitFor();
          await page.getByRole('button', { name: 'Telemetry', exact: true }).click();
          const section = page.getByRole('region', { name: 'Imported CLI usage', exact: true });
          await section.waitFor({ state: 'visible' });
          await page.evaluate(snapshot => window.__sendHost({ type: 'cliUsage', snapshot }), snapshot);
          await section.getByText('Producer-reported session quantities:', { exact: false }).waitFor();
          await section.getByText('Reported model breakdowns', { exact: false }).click();
          const text = await section.textContent();
          for (const value of [
            '0.5 premium-request cost', 'nano-AI units: 450,000', '120 input / 30 output', '40 cache-read / 10 cache-write',
            'reasoning tokens: not reported', 'Session identity: unknown', 'Completion, resumed history and all-agent coverage: unknown',
            'Historical model: synthetic-model', 'never added to Squad ledger totals',
          ]) assert.ok(text.includes(value), `Missing CLI usage text: ${value}`);
          assert.equal(/NOT FOR DISPLAY|not-for-display|synthetic-historical-model/.test(text), false, 'private/irrelevant fields must not render');
          await page.evaluate(snapshot => window.__sendHost({ type: 'cliUsage', snapshot }), snapshot);
          assert.equal(await section.textContent(), text, 'repeated snapshot is replacement, not accumulation');
          assert.equal(await page.getByText('Activity events (0)', { exact: true }).count(), 1);
          await page.getByRole('button', { name: 'Clear activity', exact: true }).click();
          assert.equal(await section.textContent(), text, 'activity clear preserves imported quantities');
          for (const name of ['Select CLI usage JSON...', 'Refresh selected export', 'Forget export']) {
            await section.getByRole('button', { name, exact: true }).click();
          }
          const actions = await page.evaluate(() => window.__petAcceptance.outbound.filter(m => /CliUsage$/.test(m.type)));
          assert.deepEqual(actions, [{ type: 'selectCliUsage' }, { type: 'refreshCliUsage' }, { type: 'clearCliUsage' }]);
          assert.equal(await section.evaluate(el => el.scrollWidth > el.clientWidth), false, 'CLI content must wrap');
          await section.locator('h3').evaluate(el => el.scrollIntoView({ block: 'start' }));
          if (output) await page.screenshot({ path: path.join(output, `cli-usage-${theme}-${width}.png`) });
          await page.evaluate(snapshot => window.__sendHost({ type: 'cliUsage', snapshot: {
            ...snapshot, state: 'error', report: null, diagnostic: 'Synthetic rejection: invalid document',
          } }), snapshot);
          await section.getByRole('alert').waitFor();
          assert.ok(!(await section.textContent()).includes('Historical model: synthetic-model'), 'rejection removes stale report');
          assert.ok((await section.textContent()).includes('not zero consumption'));
          assert.deepEqual(errors, []);
          results.cases.push({ theme, width, replacement: true, explicitActions: true, privacy: true, rejectionClearsReport: true });
        } finally { await page.close(); }
      }
    }
    if (output) fs.writeFileSync(path.join(output, 'cli-usage-results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
