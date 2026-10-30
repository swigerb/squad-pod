const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createLiveFixture, spawn, tool, done, event, secret } = require('./acceptance-live-activity.cjs');

const root = path.resolve(__dirname, '..');
const outIndex = process.argv.indexOf('--out');
assert.ok(outIndex >= 0, 'Supply --out <owned evidence directory>');
const out = path.resolve(process.argv[outIndex + 1]);
fs.mkdirSync(out, { recursive: true });

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
      response.end(`
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
      `);
    } else if (request.url === '/') {
      const nonce = /script[^>]+nonce="([^"]+)"/.exec(fixture.webview.html)?.[1];
      assert.ok(nonce, 'use the actual production CSP nonce');
      response.setHeader('content-type', 'text/html');
      response.end(fixture.webview.html.replace('</head>',
        `<script nonce="${nonce}" src="/bootstrap.js"></script></head>`));
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
  let browser;
  const results = [];
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      headless: true,
    });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 640 }]) {
      fixture = createLiveFixture({ baseUrl });
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      await page.goto(baseUrl);
      await page.locator('[data-agent-label="ada"]').waitFor();
      const bubble = page.locator('[data-agent-task-bubble="ada"]');
      assert.equal(await bubble.count(), 0, 'default-off source has no invented summary');
      assert.equal(fixture.reads.length, 0, 'default-off does not inspect a home');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.locator('#squad-pod-live-activity').click();
      await page.waitForFunction(() => document.querySelector('#squad-pod-live-activity').checked);
      await page.getByRole('button', { name: '×', exact: true }).click();
      fixture.append(spawn() + tool('read', 'view', { path: `C:\\private\\${secret}.ts` }));
      await page.waitForFunction(() =>
        document.querySelector('[data-agent-task-bubble="ada"]')?.textContent === 'CLI tool: Reading a file');
      assert.equal(await bubble.getAttribute('role'), 'note');
      assert.match(await bubble.getAttribute('aria-label'), /Ada.*CLI tool: Reading a file/);
      assert.ok(!(await bubble.textContent()).includes(secret));
      await page.screenshot({ path: path.join(out, `task-bubble-${viewport.width}.png`) });
      const toggle = page.getByRole('button', { name: 'Task bubbles: On', exact: true });
      await toggle.focus();
      await page.keyboard.press('Space');
      await page.waitForFunction(() => !document.querySelector('[data-agent-task-bubble]'));
      assert.equal(fixture.enabled, true, 'suppression cannot revoke or grant source consent');
      await page.getByRole('button', { name: 'Task bubbles: Off', exact: true }).click();
      await bubble.waitFor();
      fixture.append(done('read'));
      await page.waitForFunction(() =>
        document.querySelector('[data-agent-task-bubble="ada"]')?.textContent === 'CLI task: Task in progress');
      fixture.append(event('subagent.completed', { toolCallId: 'member-run' }, { agentId: 'internal' }));
      await page.waitForFunction(() => !document.querySelector('[data-agent-task-bubble]'));
      fixture.append((spawn() + tool('next', 'edit', { path: 'fixture.ts' })).replaceAll('member-run', 'second-run'));
      await bubble.waitFor();
      fixture.stale();
      await page.waitForFunction(() => !document.querySelector('[data-agent-task-bubble]'));
      assert.deepEqual(errors, [], 'no production page errors');
      results.push({ viewport, fixedText: true, sourceLabel: true, keyboardSuppression: true,
        completionCleared: true, staleCleared: true, pageErrors: errors });
      await page.close();
      fixture.dispose();
      fixture = undefined;
    }
    fs.writeFileSync(path.join(out, 'task-bubbles.json'), JSON.stringify({
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
      products: Object.fromEntries(['dist/extension.js', 'dist/webview/assets/index.js'].map(file => [
        file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
      ])),
      synthetic: true, nativeVsCode: false, realProducer: false, results,
    }, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally {
    fixture?.dispose();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
