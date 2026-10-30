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
  dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  theme: 'VS Code Dark+ variables supplied by browser fixture',
  channel: 'msedge', cases: [],
};

async function main() {
  if (output) fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  results.browser = browser.version();
  try {
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 640, height: 900 },
      { width: 360, height: 640 },
      { width: 320, height: 640 },
      { width: 240, height: 480 },
      { width: 320, height: 240 },
    ]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const record = { viewport, hits: [] };
      results.cases.push(record);
      let expectedRetainedLayout;
      try {
        await page.goto(url);
        assert.equal(await page.evaluate(() => window.__petAcceptance.acquireCount), 1,
          'production webview must acquire the VS Code API once');
        await page.evaluate(() => {
          for (const [name, value] of Object.entries({
            'editor-background': '#1e1e1e', foreground: '#cccccc',
            'button-background': '#0e639c', 'button-foreground': '#ffffff',
            'button-secondaryBackground': '#3a3d41', 'button-secondaryForeground': '#ffffff',
            'panel-border': '#80808059', errorForeground: '#f48771',
          })) document.documentElement.style.setProperty(`--vscode-${name}`, value);
        });
        const zoom = page.getByRole('group', { name: 'Office zoom' });
        const zoomIn = page.getByRole('button', { name: 'Zoom in', exact: true });
        const zoomOut = page.getByRole('button', { name: 'Zoom out', exact: true });
        const editor = page.getByRole('region', { name: 'Layout editor' });
        const select = page.getByTitle('Select', { exact: true });
        const pets = page.getByTitle('Pets', { exact: true });
        const area = page.getByTitle('Area', { exact: true });
        const canvas = page.locator('canvas').first();
        const hostFacts = await page.evaluate(() => {
          const roster = window.__petAcceptance.fixtures.find((message) => message.type === 'existingAgents')?.agents ?? [];
          const catalog = window.__petAcceptance.fixtures.find((message) => message.type === 'directoryCatalog')?.catalog;
          return {
            roster: roster.map(({ id, directoryId, directoryMappingIds }) => ({ id, directoryId, directoryMappingIds })),
            workspaceId: catalog?.workspaceDirectories.find((entry) => entry.name === 'Selected fixture root')?.id,
          };
        });
        assert.deepEqual(hostFacts.roster, [{
          id: 'fixture-agent',
          directoryId: hostFacts.workspaceId,
          directoryMappingIds: [hostFacts.workspaceId, '00000000-0000-4000-8000-000000000001'],
        }]);
        assert.ok(hostFacts.workspaceId?.startsWith('workspace:file:'), 'selected root identity must come from its URI');
        record.observedRoster = hostFacts.roster;
        record.providerMappingIds = hostFacts.roster[0].directoryMappingIds;

        const providerAgent = await page.evaluate(() =>
          window.__petAcceptance.fixtures.find((message) => message.type === 'existingAgents')?.agents
            .find((agent) => agent.id === 'fixture-agent'));
        const renamedAgent = {
          ...providerAgent,
          name: 'Renamed Fixture Agent',
          role: 'Lead Developer',
          status: 'active',
          currentTask: 'Production fixture observed task',
        };
        await page.waitForFunction((name) => [...document.querySelectorAll('button')]
          .some((button) => button.textContent.includes(name)), providerAgent.name);
        await page.evaluate((agent) => window.__sendHost({ type: 'existingAgents', agents: [agent] }), renamedAgent);
        async function expectAgentStatus(status) {
          await page.waitForFunction(({ name, expectedStatus }) => [...document.querySelectorAll('button')].some((button) =>
            button.textContent.includes(name)
              && button.querySelector(`[role="img"][aria-label="${expectedStatus}"]`)),
          { name: renamedAgent.name, expectedStatus: status });
        }
        await expectAgentStatus('Active');
        await page.getByText('Observed task: Production fixture observed task', { exact: true }).waitFor();
        assert.equal(await page.getByText('Observed task: Production fixture observed task', { exact: true }).count(), 1,
          'App must render the reconnect snapshot task as observed task text');
        await page.evaluate(() => window.__sendHost({
          type: 'agentStatus', agentId: 'fixture-agent', status: 'waiting',
        }));
        await expectAgentStatus('Waiting');
        await page.evaluate(() => window.__sendHost({
          type: 'agentStatus', agentId: 'fixture-agent', status: 'active',
        }));
        await expectAgentStatus('Active');
        await page.evaluate(() => window.__sendHost({
          type: 'agentStatus', agentId: 'fixture-agent', status: 'idle',
        }));
        await expectAgentStatus('Idle');
        assert.equal(await page.getByText('Observed task: Production fixture observed task', { exact: true }).count(), 0,
          'idle must clear the stale reconnect task row');
        assert.equal(await page.evaluate(() =>
          window.__petAcceptance.outbound.some((message) => ['agentToolStart', 'telemetryEvent'].includes(message.type))), false,
        'snapshot task text must not create webview tool or telemetry messages');
        record.rosterSnapshot = {
          renamed: renamedAgent.name,
          task: renamedAgent.currentTask,
          statusTransitions: ['Active', 'Waiting', 'Active', 'Idle'],
          evidence: 'Compiled-provider roster payload delivered through the production webview bundle in mocked Edge',
        };

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
              panelScroll: {
                x: document.querySelector('.office-panel').scrollLeft,
                y: document.querySelector('.office-panel').scrollTop,
              },
            };
          });
          record.hits.push({ name, ...hit });
          assert.equal(hit.hit, true, `${name}: center intercepted by ${hit.target}`);
          assert.deepEqual(hit.panelScroll, { x: 0, y: 0 }, `${name}: controls must not scroll the canvas container`);
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
        for (const name of ['Select', 'Floor', 'Wall', 'Carpet', 'Area', 'Furniture', 'Pets', 'Erase', 'Eyedrop']) {
          const tool = page.getByTitle(name, { exact: true });
          const level = await zoom.textContent();
          await hitClick(tool, `Editor tool: ${name}`);
          assert.equal(await tool.getAttribute('aria-pressed'), 'true', `${name} must activate normally`);
          assert.equal(await zoom.textContent(), level, `${name} must not zoom`);
        }
        await hitClick(pets, 'Pets');
        assert.equal(await pets.getAttribute('aria-pressed'), 'true');
        const levelBeforeSelect = await zoom.textContent();
        await hitClick(select, 'Select after Pets');
        assert.equal(await select.getAttribute('aria-pressed'), 'true');
        assert.equal(await pets.getAttribute('aria-pressed'), 'false');
        assert.equal(await zoom.textContent(), levelBeforeSelect, 'Select must not zoom');
        assert.ok(zoomBox.y + zoomBox.height <= editorBox.y, 'zoom strip must end above the editor');
        assert.ok(editorBox.x >= 0 && editorBox.x + editorBox.width <= viewport.width, 'editor must fit panel width');
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
        await hitClick(page.getByRole('button', { name: /Save Layout/ }), 'Save redone layout');
        await page.getByRole('button', { name: 'Save Layout', exact: true }).waitFor();
        const redone = await page.evaluate(() => window.__petAcceptance.outbound.filter((m) => m.type === 'saveLayout').at(-1)?.layout);
        assert.deepEqual(redone, saved, 'controls must preserve the draft and redo contents');
        expectedRetainedLayout = redone;

        if (viewport.height >= 480) {
          await hitClick(area, 'Area tool with scrolling');
          const areaName = page.getByTestId('new-area-name');
          await hitClick(areaName, 'Area name input');
          await areaName.pressSequentially('Engineering Room');
          assert.equal(await areaName.inputValue(), 'Engineering Room', 'normal typing must accept spaces');
          await page.keyboard.press('Control+Z');
          assert.equal(await areaName.inputValue(), '', 'Ctrl+Z must undo text natively in the Area name field');
          record.areaTextUndo = { typed: 'Engineering Room', afterUndo: await areaName.inputValue() };
          await areaName.pressSequentially('Engineering Room');
          await hitClick(page.getByTestId('add-area'), 'Add Area');
          assert.equal(await page.getByTestId('select-area-Engineering Room').count(), 1);

          const areaDirectory = page.getByTestId('area-directory');
          await areaDirectory.scrollIntoViewIfNeeded();
          await areaDirectory.selectOption(hostFacts.workspaceId);
          await areaDirectory.focus();
          await page.keyboard.press('Delete');
          await page.keyboard.press('r');
          await page.keyboard.press('Control+Z');
          assert.equal(await page.getByTestId('select-area-Engineering Room').count(), 1,
            'mapping-control keys must not invoke office delete, rotate or undo shortcuts');

          const rename = page.getByRole('textbox', { name: 'Rename Area Engineering Room' });
          await hitClick(rename, 'Rename Area input');
          await rename.press('Control+A');
          await rename.pressSequentially('Engineering Room East');
          await page.keyboard.press('Control+Z');
          assert.equal(await rename.inputValue(), 'Engineering Room',
            'Ctrl+Z in Area rename must undo the text edit, not the office draft');
          await rename.press('Control+A');
          await rename.pressSequentially('Engineering Room East');
          await rename.press('Tab');

          const areaMapping = page.getByTestId('area-mapping');
          await hitClick(areaMapping, 'Map Area to selected workspace');
          await areaMapping.check();
          await hitClick(page.getByRole('button', { name: /Save Layout/ }), 'Save Area mapping');
          await page.getByRole('button', { name: 'Save Layout', exact: true }).waitFor();
          const mappedLayout = await page.evaluate(() => window.__petAcceptance.outbound.filter((m) => m.type === 'saveLayout').at(-1)?.layout);
          assert.deepEqual(mappedLayout.areas, [{ label: 'Engineering Room East', color: '#50c878' }]);
          assert.deepEqual(mappedLayout.areaMappings, { [hostFacts.workspaceId]: ['Engineering Room East'] });
          assert.equal(mappedLayout.cols, redone.cols, 'Area-field shortcuts must not undo existing layout edits');
          expectedRetainedLayout = mappedLayout;
          record.areaMapping = { directoryId: hostFacts.workspaceId, label: 'Engineering Room East' };
        }

        record.scroll = await editor.evaluate((element) => ({
          clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop,
        }));
        await hitClick(select, 'Select returned to top');
        if (output) await page.screenshot({ path: path.join(output, `controls-${viewport.width}x${viewport.height}.png`) });

        if (viewport.height >= 480) {
          const launchesBefore = await page.evaluate(() => window.__petAcceptance.outbound.filter((m) => m.type === 'launchDirectory').length);
          assert.equal(launchesBefore, 0, 'controls must never auto-launch');
          await hitClick(page.getByRole('button', { name: 'Directories', exact: true }), 'Directories alongside editor');
          const dialog = page.getByRole('dialog', { name: 'Launch directory' });
          await dialog.waitFor();
          const savedDirectoryRow = dialog.getByLabel('Name for Synthetic alternate project').locator('xpath=../../..');
          await hitClick(savedDirectoryRow.getByRole('button', { name: 'Launch Synthetic alternate project', exact: true }), 'Explicit saved-directory Launch request');
          const launch = await page.evaluate(() => window.__petAcceptance.outbound.filter((m) => m.type === 'launchDirectory').at(-1));
          assert.deepEqual(launch, { type: 'launchDirectory', id: '00000000-0000-4000-8000-000000000001', source: 'saved' });
          const rosterAfterRequest = await page.evaluate(() =>
            window.__petAcceptance.fixtures.find((message) => message.type === 'existingAgents')?.agents.map((agent) => agent.id) ?? []);
          assert.deepEqual(rosterAfterRequest, ['fixture-agent'], 'a saved-directory launch request must not attach another observed roster');
          record.directoryLaunch = 'Explicit mocked-boundary request only; no terminal/CLI executed or extra roster attached';
          if (output) await page.screenshot({ path: path.join(output, `directories-${viewport.width}x${viewport.height}.png`) });
          await hitClick(page.getByRole('button', { name: 'Close directories', exact: true }), 'Close directories');
          assert.equal(await select.getAttribute('aria-pressed'), 'true');
          await hitClick(zoomIn, 'Zoom in after directory modal');
          await hitClick(zoomOut, 'Zoom out after directory modal');
          await hitClick(select, 'Select after directory modal');
        }
        await hitClick(page.getByRole('button', { name: 'Exit Layout Editor', exact: true }), 'Exit Layout Editor');
        assert.equal(await editor.count(), 0);
        const restoredZoom = await zoom.boundingBox();
        assert.equal(restoredZoom.x, normalZoom.x);
        assert.equal(restoredZoom.y, normalZoom.y);
        assert.equal(restoredZoom.width, normalZoom.width);
        assert.deepEqual(await canvas.boundingBox(), canvasBefore);
        await hitClick(zoomIn, 'normal Zoom in after editor exit');
        await hitClick(zoomOut, 'normal Zoom out after editor exit');
        const toolbar = page.locator('.bottom-toolbar');
        await page.getByRole('button', { name: 'Settings', exact: true }).scrollIntoViewIfNeeded();
        const settingsTarget = await page.getByRole('button', { name: 'Settings', exact: true }).evaluate((element) => {
          const r = element.getBoundingClientRect();
          return element === document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2)[0];
        });
        assert.equal(settingsTarget, true, 'Settings must remain reachable through toolbar overflow');
        record.bottomScroll = await toolbar.evaluate((element) => ({
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, scrollLeft: element.scrollLeft,
        }));
        if (viewport.width >= 360) {
          await hitClick(page.getByRole('button', { name: 'Settings', exact: true }), 'Settings outside editor');
          await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
          await hitClick(page.getByRole('button', { name: '×', exact: true }), 'Close settings');
        }
        await hitClick(page.getByRole('button', { name: 'Edit Layout', exact: true }), 'Reopen editor after toolbar scrolling');
        assert.equal(await select.getAttribute('aria-pressed'), 'true');
        await hitClick(page.getByRole('button', { name: /Save Layout/ }), 'Save retained draft after editor reopening');
        const reopened = await page.evaluate(() => window.__petAcceptance.outbound.filter((m) => m.type === 'saveLayout').at(-1)?.layout);
        assert.deepEqual(reopened, expectedRetainedLayout ?? saved);

        if (viewport.width === 1280) {
          await hitClick(page.getByTitle('Expand Right', { exact: true }), 'Create dirty local draft for conflict test');
          const localDraft = await page.evaluate(() => structuredClone(window.__petAcceptance.state.draft));
          const recovery = await page.evaluate(() => window.__petAcceptance.state);
          assert.ok(recovery.revision, 'the save acknowledgement must persist the current disk revision');
          const incoming = { ...recovery.baseline, externalMarker: 'browser-incoming-snapshot' };
          await page.evaluate(({ layout, workspaceRoot }) => window.__sendHost({
            type: 'layoutLoaded', layout, source: 'external',
            revision: 'browser-external-revision', workspaceRoot,
          }), { layout: incoming, workspaceRoot: recovery.workspaceRoot });
          const conflict = page.getByRole('region', { name: 'Layout recovery' });
          await conflict.waitFor({ state: 'visible' });
          await page.getByRole('button', { name: /Keep local draft #/ }).click();
          await page.waitForFunction(() => window.__petAcceptance.state.pending.length === 0);
          const resolved = await page.evaluate(() => window.__petAcceptance.state);
          assert.deepEqual(resolved.draft, localDraft, 'local conflict resolution must retain the dirty draft');
          assert.equal(resolved.revision, 'browser-external-revision',
            'local resolution must advance the expected revision to the incoming snapshot');
          await hitClick(page.getByRole('button', { name: /Save Layout/ }), 'Save locally resolved draft');
          await page.waitForFunction(() => window.__petAcceptance.outbound.some((message) =>
            message.type === 'saveLayout' && message.expectedRevision === 'browser-external-revision'));
          await page.waitForFunction(() => window.__petAcceptance.state.revision?.startsWith('browser-ack-'));
          const resolvedSave = await page.evaluate(() => window.__petAcceptance.outbound
            .filter((message) => message.type === 'saveLayout').at(-1));
          assert.equal(resolvedSave.expectedRevision, 'browser-external-revision');
          assert.deepEqual(resolvedSave.layout, localDraft);
          record.conflictResolution = {
            expectedRevision: resolvedSave.expectedRevision,
            acknowledgedRevision: await page.evaluate(() => window.__petAcceptance.state.revision),
            localDraftRetained: true,
          };
        }
        assert.deepEqual(errors, [], 'production page errors');
        record.passed = true;
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
