const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createLiveFixture, spawn, event, secret } = require('./acceptance-live-activity.cjs');

const root = path.resolve(__dirname, '..');
const outIndex = process.argv.indexOf('--out');
assert.ok(outIndex >= 0, 'Supply --out <owned evidence directory>');
const out = path.resolve(process.argv[outIndex + 1]);
fs.mkdirSync(out, { recursive: true });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const call = (id, parent = 'member-run', name = 'Research') => event('tool.execution_start', {
  toolCallId: id, parentToolCallId: parent, toolName: 'task',
  arguments: { name, agent_type: 'explore', mode: 'background', description: 'Synthetic child', prompt: secret },
});
const started = (id, instance) => event('subagent.started', {
  toolCallId: id, agentName: 'explore', agentDisplayName: 'Explore', agentDescription: 'Synthetic',
}, { agentId: instance });
const selected = (instance, name) => event('subagent.selected', {
  agentName: name, agentDisplayName: 'Not an identity', tools: null,
}, { agentId: instance });
const bootstrap = `
  let received = 0;
  window.acquireVsCodeApi = () => ({
    postMessage: message => fetch('/send', {method: 'POST', body: JSON.stringify(message)}),
    getState: () => undefined, setState() {}
  });
  setInterval(async () => {
    const messages = await (await fetch('/messages')).json();
    messages.slice(received).forEach(data => window.dispatchEvent(new MessageEvent('message', {data})));
    received = messages.length;
  }, 50);
`;

async function main() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  let fixture;
  const server = http.createServer((request, response) => {
    if (request.url === '/messages') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(fixture.messages));
    } else if (request.url === '/send' && request.method === 'POST') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => { fixture.send(JSON.parse(body)); response.end('{}'); });
    } else if (request.url === '/bootstrap.js') {
      response.setHeader('content-type', 'text/javascript');
      response.end(bootstrap);
    } else if (request.url === '/') {
      const nonce = /script[^>]+nonce="([^"]+)"/.exec(fixture.webview.html)?.[1];
      assert.ok(nonce, 'retain production CSP and use its actual nonce');
      response.setHeader('content-type', 'text/html');
      response.end(fixture.webview.html.replace('</head>', `<script nonce="${nonce}" src="/bootstrap.js"></script></head>`));
    } else {
      const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
      if (!file.startsWith(path.join(root, 'dist') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404); response.end(); return;
      }
      response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript'
        : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'image/png');
      response.end(fs.readFileSync(file));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({
      executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: true,
    });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 640 }]) {
      fixture = createLiveFixture({ baseUrl });
      const page = await browser.newPage({ viewport, recordVideo: { dir: out, size: viewport } });
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      await page.addInitScript(() => {
        window.__spriteFrames = [];
        const draw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
          if (this.canvas.isConnected && source instanceof HTMLCanvasElement
            && source.width === 112 && source.height === 96 && args.length === 8) {
            window.__spriteFrames.push({ crop: args.slice(0, 4), dest: args.slice(4), at: performance.now() });
            if (window.__spriteFrames.length > 1000) window.__spriteFrames.shift();
          }
          return draw.call(this, source, ...args);
        };
      });
      await page.goto(baseUrl);
      await page.locator('[data-agent-label="ada"]').waitFor();
      await page.evaluate(() => {
        for (const [name, value] of Object.entries({
          'editor-background': '#1e1e1e', foreground: '#cccccc', 'button-background': '#0e639c',
          'button-foreground': '#ffffff', 'button-secondaryBackground': '#3a3d41',
          'button-secondaryForeground': '#ffffff', 'panel-border': '#80808059',
        })) document.documentElement.style.setProperty('--vscode-' + name, value);
      });
      while (await page.getByRole('button', { name: 'Zoom out', exact: true }).isEnabled()) {
        await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      assert.equal(fixture.reads.length, 0, 'default-off must read no home');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.locator('#squad-pod-live-activity').click();
      await page.waitForFunction(() => document.querySelector('#squad-pod-live-activity').checked);
      await page.getByRole('button', { name: '×', exact: true }).click();
      fixture.append(spawn());
      await page.locator('[data-agent-label="ada"] [aria-label="Active"]').waitFor();
      fixture.append(call('child'));
      await page.waitForTimeout(1200);
      assert.equal(await page.locator('[data-subagent-label]').count(), 0, 'dispatch is not start');
      fixture.append(started('child', 'instance'));
      const sub = page.locator('[data-subagent-label]');
      await sub.waitFor();
      assert.match(await sub.innerText(), /Subtask: Research.*Parent: Ada/s);
      assert.equal(await sub.getAttribute('data-parent-agent'), 'ada');
      await page.evaluate(() => { window.__spriteFrames = []; });
      await page.waitForTimeout(1100);
      const frames = await page.evaluate(() => window.__spriteFrames);
      const byPosition = new Map();
      for (const frame of frames) {
        const key = JSON.stringify(frame.dest);
        if (!byPosition.has(key)) byPosition.set(key, new Set());
        byPosition.get(key).add(JSON.stringify(frame.crop));
      }
      assert.equal(byPosition.size, 2, 'production canvas draws exactly roster + temporary sprite');
      assert.ok([...byPosition.values()].every(crops => crops.size >= 2),
        'both distinct sprite positions advance actual PNG animation frames, not only parent motion');
      await page.screenshot({ path: path.join(out, `subagent-running-${viewport.width}.png`) });
      fixture.append(call('alias') + started('alias', 'instance')
        + call('unlinked', 'unknown-parent', 'Unlinked')
        + started('unlinked', 'unlinked-instance'));
      await page.waitForTimeout(1200);
      assert.equal(await sub.count(), 1, 'same instance deduplicates; unknown parent never guesses');
      fixture.send({ type: 'webviewReady' });
      await page.waitForTimeout(500);
      assert.equal(await sub.count(), 1, 'roster/reconnect replay never duplicates');
      fixture.append(selected('instance', 'ada-ish'));
      await page.waitForTimeout(1200);
      assert.equal(await sub.count(), 1, 'near-match name cannot promote');
      fixture.append(selected('instance', 'ada'));
      await sub.waitFor({ state: 'detached' });
      assert.equal(await page.locator('[data-agent-label]').count(), 1, 'selected roster identity reuses member');
      fixture.append(call('second', 'member-run', 'Research') + started('second', 'second-instance'));
      await sub.waitFor();
      fixture.append(event('subagent.completed', { toolCallId: 'second', cancelled: true }, { agentId: 'second-instance' }));
      await sub.waitFor({ state: 'detached' });
      for (const [id, terminal] of [['third', 'subagent.failed'], ['fourth', 'subagent.completed']]) {
        fixture.append(call(id) + started(id, id + '-instance'));
        await sub.waitFor();
        fixture.append(event(terminal, { toolCallId: id }, { agentId: id + '-instance' }));
        await sub.waitFor({ state: 'detached' });
      }
      fixture.append(call('stale') + started('stale', 'stale-instance'));
      await sub.waitFor();
      fixture.stale();
      await sub.waitFor({ state: 'detached' });
      await page.screenshot({ path: path.join(out, `subagent-stale-${viewport.width}.png`) });
      assert.equal(await page.locator('[data-agent-label]').count(), 1, 'roster survives all transient lifecycle events');
      assert.ok(!JSON.stringify({ messages: fixture.messages, output: fixture.output }).includes(secret),
        'only projected metadata reaches sinks');
      assert.deepEqual(errors, [], 'zero production page errors');
      const video = page.video();
      await page.close();
      await video.saveAs(path.join(out, `subagent-lifecycle-${viewport.width}.webm`));
      fs.unlinkSync(await video.path());
      results.push({ viewport, spritePositions: byPosition.size, animatedCrops: [...byPosition.values()].map(set => set.size),
        cases: ['dispatch-before-start', 'explicit-parent', 'instance-dedup', 'missing-parent', 'reconnect',
          'near-match-rejected', 'selected-roster-reused', 'cancelled', 'failed', 'completed', 'stale', 'no-secret-leak'],
        errors });
      fixture.dispose();
      fixture = undefined;
    }
    fs.writeFileSync(path.join(out, 'subagents-results.json'), JSON.stringify({
      head, classification: 'compiled provider + production webview, strict CSP, synthetic sources; not native/real-session',
      results,
    }, null, 2));
    console.log(JSON.stringify({ head, results }));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fixture?.dispose();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
