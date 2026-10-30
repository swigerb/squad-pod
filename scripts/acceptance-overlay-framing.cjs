// Synthetic browser fixture: production canvas, geometry, overlays and camera controls.
// No native host, private session logs, or device acceptance is implied.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '..');
const output = process.env.ACCEPTANCE_OUTPUT_DIR;
assert.ok(output, 'Set ACCEPTANCE_OUTPUT_DIR to retain evidence outside the checkout');
const baseline = 'becac49fac50cb8e943ed362da5ab2d0f664a13d';
const source = name => JSON.stringify(path.join(root, 'webview-ui', 'src', name));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const entry = `
import React, { useState } from ${JSON.stringify(require.resolve('react', { paths: [path.join(root, 'webview-ui')] }))};
import { createRoot } from ${JSON.stringify(require.resolve('react-dom/client', { paths: [path.join(root, 'webview-ui')] }))};
import { AgentLabels } from ${source('components/AgentLabels.tsx')};
import { ToolOverlay } from ${source('office/components/ToolOverlay.tsx')};
import { ZoomControls } from ${source('components/ZoomControls.tsx')};
import { OfficeCanvas } from ${source('office/components/OfficeCanvas.tsx')};
import { OfficeState } from ${source('office/engine/officeState.ts')};
import { EditorState } from ${source('office/editor/editorState.ts')};
import { HostClientProvider } from ${source('HostClientContext.tsx')};
import { getCharacterScreenBounds } from ${source('office/engine/characterGeometry.ts')};
import { setContextUsage } from ${source('office/toolUtils.ts')};
import { CharacterState } from ${source('office/types.ts')};
const office = new OfficeState({version:2,cols:21,rows:15,tiles:Array(315).fill(1),furniture:[]});
const pan = {current:{x:0,y:0}}, editor = new EditorState(), sent = [];
const client = {send: m=>sent.push(m), subscribe:()=>()=>{}, getState:()=>undefined, setState:s=>s};
const tools = {};
for(let i=0;i<8;i++){
  const id='member-'+i;
  office.addAgent(id,'Member '+i+' Full Name','Developer');
  tools[id] = [{toolId:'read-'+i,status:'Read complete tool description',done:false}];
}
let currentZoom = 3;
const initialLayout = JSON.stringify(office.layout);
function Fixture(){
 const [zoom,setZoom]=useState(3),[request,setRequest]=useState();
 currentZoom=zoom;
 window.fixture = {
   sent, office, pan, setZoom,
   tick(t){
     for(let i=0;i<8;i++){
       const c=office.characters.get('member-'+i);
       Object.assign(c,{x:(innerWidth/2+Math.sin(t/650+i)*140-pan.current.x)/zoom,
         y:(innerHeight/2-pan.current.y)/zoom,state:CharacterState.IDLE,path:[],wanderTimer:1000,active:false});
     }
   },
   sample(){
     return [...document.querySelectorAll('[data-agent-label]')].map(e=>{
       const id=e.dataset.agentLabel,c=office.characters.get(id);
       const r=(e.closest('[data-agent-annotation]')||e).getBoundingClientRect();
       const b=getCharacterScreenBounds(c,currentZoom,pan.current);
       return {id,x:r.x,y:r.y,width:r.width,height:r.height,anchor:b.top-14,
         world:{x:c.x,y:c.y},pan:{...pan.current},zoom:currentZoom,offscreen:e.textContent.includes('Off-screen'),
         text:e.textContent,connector:!!document.querySelector('[data-agent-connector="'+id+'"]')};
     });
   },
   active(){
     office.setAgentActive('member-0',true); office.setAgentTool('member-0','Read file');
     setContextUsage(office,'member-0',{contextTokens:600,maxContextTokens:1000});
   },
   unchanged:()=>JSON.stringify(office.layout)===initialLayout
 };
 return <HostClientProvider client={client}>
   <OfficeCanvas officeState={office} editorState={editor} isEditMode={false} editorTick={0}
     zoom={zoom} onZoomChange={setZoom} panRef={pan} cameraRequest={request}/>
   <AgentLabels officeState={office} zoom={zoom} panRef={pan} agentTools={tools}
     onAgentClick={id=>window.lastDetail=id} onLocateAgent={agentId=>setRequest({id:Date.now(),agentId})}/>
   <ToolOverlay officeState={office} zoom={zoom} panRef={pan} agentTools={tools}/>
   <ZoomControls zoom={zoom} onZoomChange={setZoom} onFitOffice={()=>setRequest({id:Date.now()})}/>
 </HostClientProvider>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let browser, server;
  const evidence = { kind: 'SYNTHETIC_PRODUCTION_COMPONENT_BROWSER', baseline,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    node: process.version, cases: [], errors: [] };
  try {
    for (const variant of ['baseline', 'current']) {
      await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: root }, bundle: true,
        outfile: path.join(output, variant + '.js'), platform: 'browser', format: 'esm', jsx: 'automatic',
        plugins: variant === 'baseline' ? [{ name: 'frozen-overlay-baseline', setup(b) {
          b.onLoad({ filter: /(?:AgentLabels|ToolOverlay)\.tsx$/ }, args => ({
            contents: execFileSync('git', ['show', `${baseline}:${path.relative(root, args.path).replaceAll('\\', '/')}`],
              { cwd: root, encoding: 'utf8' }),
            loader: 'tsx', resolveDir: path.dirname(args.path),
          }));
        } }] : [],
      });
    }
    server = http.createServer((req, res) => {
      if (req.url === '/current.js' || req.url === '/baseline.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(fs.readFileSync(path.join(output, req.url.slice(1))));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
          <style>body{margin:0;background:#252525;color:white;font-family:Arial}#root{position:relative;width:100vw;height:100vh;overflow:hidden}
          button:focus-visible{outline:2px solid #fbbf24;z-index:200!important}</style></head>
          <body><div id="root"></div><script type="module" src="/${req.url.includes('baseline') ? 'baseline' : 'current'}.js"></script></body></html>`);
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const runtime = process.env.PLAYWRIGHT_MODULE || require.resolve('playwright');
    const loaded = await import(pathToFileURL(runtime).href);
    const chromium = loaded.chromium || loaded.default.chromium;
    browser = await chromium.launch({ executablePath: process.env.EDGE_PATH
      || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    evidence.browser = browser.version();
    evidence.runtime = runtime;
    evidence.bundles = { baseline: hash(path.join(output, 'baseline.js')), current: hash(path.join(output, 'current.js')) };
    for (const scenario of [
      { variant: 'baseline', width: 788, dpr: 1.5, zoom: 3, seconds: 8 },
      { variant: 'current', width: 788, dpr: 1.5, zoom: 3, seconds: 60 },
      { variant: 'current', width: 360, dpr: 2, zoom: 1, seconds: 8 },
      { variant: 'current', width: 1400, dpr: 1.5, zoom: 10, seconds: 8 },
    ]) {
      const context = await browser.newContext({ viewport: { width: scenario.width, height: 900 }, deviceScaleFactor: scenario.dpr });
      const page = await context.newPage();
      page.on('pageerror', error => evidence.errors.push(String(error)));
      const record = { ...scenario, samples: [], maxLaneResidual: 0, jumpsOver50: 0, overlapSamples: 0 };
      evidence.cases.push(record);
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/?${scenario.variant}`);
        await page.waitForFunction(() => window.fixture && document.querySelectorAll('[data-agent-label]').length === 8);
        await page.evaluate(zoom => window.fixture.setZoom(zoom), scenario.zoom);
        let previous;
        const start = Date.now();
        while (Date.now() - start < scenario.seconds * 1000) {
          const t = Date.now() - start;
          await page.evaluate(t => window.fixture.tick(t), t);
          await page.waitForTimeout(100);
          const sample = await page.evaluate(() => window.fixture.sample());
          if (previous) for (const item of sample) {
            const last = previous.find(p => p.id === item.id);
            const residual = Math.abs((item.y - last.y) - (item.anchor - last.anchor));
            record.maxLaneResidual = Math.max(record.maxLaneResidual, residual);
            if (residual > 50) record.jumpsOver50++;
          }
          if (sample.some((a, i) => sample.slice(i + 1).some(b =>
            a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y))) record.overlapSamples++;
          record.samples.push({ elapsed: Date.now() - start, labels: sample });
          previous = sample;
        }
        await page.screenshot({ path: path.join(output, `${scenario.variant}-${scenario.width}-zoom${scenario.zoom}.png`) });
        if (scenario.variant === 'current') {
          assert.equal(record.jumpsOver50, 0, 'lane residual must not jump over50 CSSpx/100ms');
          await page.evaluate(() => { window.fixture.pan.current.x = -4000; });
          await page.waitForTimeout(150);
          assert.ok(await page.locator('[data-agent-label]').first().textContent().then(t => t.includes('Off-screen')));
          await page.getByRole('button', { name: 'Locate Member 0 Full Name', exact: true }).focus();
          await page.keyboard.press('Enter');
          await page.waitForTimeout(150);
          assert.ok(!(await page.locator('[data-agent-label]').first().textContent()).includes('Off-screen'));
          await page.getByRole('button', { name: 'Fit and center office' }).click();
          await page.waitForTimeout(150);
          await page.setViewportSize({ width: 500, height: 700 });
          await page.waitForTimeout(150);
          assert.equal(await page.evaluate(() => window.fixture.unchanged()), true);
          assert.equal(await page.evaluate(() => window.fixture.sent.length), 0);
          record.navigation = 'keyboard Locate, Fit, resize; no layout writes';
          assert.equal(record.overlapSamples, 0, 'full annotation stacks must remain readable without overlap');
          await page.setViewportSize({ width: 360, height: 280 });
          await page.waitForTimeout(200);
          assert.equal(await page.locator('[data-label-dock="true"]').count(), 1);
          await page.locator('[data-agent-label="member-7"]').focus();
          await page.keyboard.press('Enter');
          assert.equal(await page.evaluate(() => window.lastDetail), 'member-7');
          await page.evaluate(() => window.fixture.active());
          await page.waitForTimeout(200);
          assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '60');
          record.crowded = 'explicit scrollable list; keyboard member details and context preserved';
        }
      } finally { await context.close(); }
    }
    assert.ok(evidence.cases[0].jumpsOver50 > 0, 'frozen baseline must reproduce >50px lane jumps');
    assert.deepEqual(evidence.errors, []);
  } catch (error) {
    evidence.failure = String(error);
    throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    console.log(JSON.stringify({ ...evidence, cases: evidence.cases.map(({ samples, ...rest }) => ({
      ...rest, sampleCount: samples.length,
    })) }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
