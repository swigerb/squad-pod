const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const output = process.env.ACCEPTANCE_OUTPUT_DIR;
const results = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  boundary: 'Fixture evidence: production webview and compiled-provider snapshots; mocked VS Code boundary, no native host or CLI launch.',
  cases: [],
};
async function poll(page, predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await page.evaluate(predicate)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for fixture state');
}

async function main() {
  if (output) fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  results.browser = browser.version();
  try {
    for (const theme of ['dark', 'light']) {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 640 }, { width: 240, height: 480 }]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(process.env.ACCEPTANCE_URL || 'http://127.0.0.1:4173/');
        await page.evaluate(theme => {
          for (const [name, value] of Object.entries({
            'editor-background': theme === 'dark' ? '#1e1e1e' : '#ffffff',
            foreground: theme === 'dark' ? '#cccccc' : '#333333',
            'descriptionForeground': theme === 'dark' ? '#aaaaaa' : '#555555',
            'button-background': '#0e639c', 'button-foreground': '#ffffff',
            'panel-border': '#80808059',
          })) document.documentElement.style.setProperty(`--vscode-${name}`, value);
          const label = document.createElement('p');
          label.textContent = 'FIXTURE EVIDENCE - mocked host, no native VS Code or Squad session';
          label.style.cssText = 'position:fixed;top:0;left:8px;z-index:2000;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:12px monospace;max-width:90%';
          document.body.append(label);
        }, theme);
        await page.getByRole('group', { name: 'Office zoom' }).waitFor();
        const telemetry = page.getByRole('button', { name: 'Telemetry', exact: true });
        await telemetry.scrollIntoViewIfNeeded();
        await telemetry.click();
        const section = page.getByRole('region', { name: 'Recorded Squad usage', exact: true });
        await section.waitFor({ state: 'visible' });
        await poll(page, () => document.querySelector('[aria-label="Recorded Squad usage"]')?.textContent.includes('1,400 input / 400 output'));
        const text = await section.textContent();
        for (const expected of [
          'Local source: partial', 'Partial sums (valid records only): 1,400 input / 400 output',
          '1 / 2 recorded starts', 'Rejected lines: 1; unsupported: 1; pending final line: yes',
          'runtime bus not connected', 'Parent-child hierarchy / roster promotion: unavailable',
          'not current model, live context or billing-grade accounting',
        ]) assert.ok(text.includes(expected), `Missing production usage text: ${expected}`);
        await section.locator('summary').filter({ hasText: 'Usage coverage and source diagnostics' }).click();
        const summary = section.locator('summary').filter({ hasText: 'Recent historical reports' });
        await summary.scrollIntoViewIfNeeded();
        await summary.click();
        for (const expected of [
          'historical roster match: Ada', 'unattributed (ambiguous roster identity)', 'Not on roster - unattributed',
          'Reported model: recorded-model-a', 'Reported model: recorded-model-b', 'Reported model: unknown',
        ]) assert.ok((await section.textContent()).includes(expected), expected);
        assert.equal(await section.evaluate(element => element.scrollWidth > element.clientWidth), false, 'usage content must wrap in narrow panels');
        await section.locator('h3').evaluate(element => element.scrollIntoView({ block: 'start' }));
        await poll(page, () => {
          const heading = document.querySelector('[aria-label="Recorded Squad usage"] h3').getBoundingClientRect();
          const content = document.querySelector('[aria-label="Telemetry content"]').getBoundingClientRect();
          return Math.abs(heading.top - content.top) < 20;
        });
        if (output) await page.screenshot({ path: path.join(output, `usage-${theme}-${viewport.width}.png`) });
        const color = await section.evaluate(element => getComputedStyle(element).color);
        assert.equal(color, theme === 'dark' ? 'rgb(204, 204, 204)' : 'rgb(51, 51, 51)', 'recorded history must use the theme foreground');
        assert.equal(await page.getByText('Activity events (0)', { exact: true }).count(), 1, 'historical ingestion must not add activity');
        const historical = await section.textContent();
        await page.evaluate(() => window.__sendHost({ type: 'telemetryEvent', event: {
          id: 'fixture-new', timestamp: Date.now(), category: 'log', agentId: null, agentName: null,
          summary: 'Fixture evidence: newly observed event', detail: null,
        } }));
        await page.getByText('Activity events (1)', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Clear activity', exact: true }).click();
        await page.getByText('Activity events (0)', { exact: true }).waitFor();
        assert.equal(await section.textContent(), historical, 'clearing activity must preserve recorded usage');
        await page.evaluate(() => {
          const original = window.__petAcceptance.fixtures.find(m => m.type === 'recordedUsage').snapshot;
          window.__sendHost({ type: 'recordedUsage', snapshot: { ...original, state: 'missing',
            totals: null, history: [], usageRecords: 0, attemptedTurns: 0, coveredTurns: 0,
            unlinkedUsageRecords: 0, invalidLines: 0, unsupportedLines: 0, pendingFinalLine: false,
            diagnostic: 'Fixture evidence: no local ledger', lastUsageAt: null, lastRecordAt: null,
          } });
        });
        await section.getByText('No usage totals available.', { exact: false }).waitFor();
        assert.ok((await section.innerText()).includes('not recorded zero consumption'));
        const emptyGuidance = page.getByText('No activity events observed since', { exact: false });
        await section.locator('summary').filter({ hasText: 'Usage coverage and source diagnostics' }).click();
        await emptyGuidance.scrollIntoViewIfNeeded();
        assert.equal(await emptyGuidance.evaluate(element => !!element.closest('details')), false);
        assert.equal(await page.getByText('Activity events (0)', { exact: true }).evaluate(element => getComputedStyle(element).color), color);
        if (output) await page.screenshot({ path: path.join(output, `empty-${theme}-${viewport.width}.png`) });
        await page.getByText('Activity source diagnostics', { exact: true }).click();
        await page.getByText('File observer: Watching', { exact: false }).waitFor();
        await page.getByText('Live CLI observer: off', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Observation settings and consent', exact: true }).click();
        assert.equal(await page.locator('#squad-pod-live-activity').isChecked(), false);
        await page.getByRole('button', { name: '×', exact: true }).click();
        const outbound = await page.evaluate(() => window.__petAcceptance.outbound);
        assert.equal(outbound.some(message => message.type === 'launchDirectory'), false, 'fixture must never launch a terminal');
        assert.equal(outbound.some(message => message.type === 'setLiveActivity'), false, 'opening settings must not enable observation');
        assert.deepEqual(errors, [], 'production page errors');
        results.cases.push({ theme, viewport, fixtureEvidence: true, partialSums: '1400 / 400', coverage: '1 / 2',
          missingLedger: true, newEvent: true, clearPreservesUsage: true, settingsDoesNotEnable: true,
          attribution: ['roster-match', 'unattributed', 'ambiguous'], pageErrors: errors });
      } finally {
        await page.close();
      }
      }
    }
    console.log(JSON.stringify(results, null, 2));
    if (output) fs.writeFileSync(path.join(output, 'usage-results.json'), JSON.stringify(results, null, 2) + '\n');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
