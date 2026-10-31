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
/* baseline-tool-import */
import { ZoomControls } from ${source('components/ZoomControls.tsx')};
import { OfficeCanvas } from ${source('office/components/OfficeCanvas.tsx')};
import { OfficeState } from ${source('office/engine/officeState.ts')};
import { EditorState } from ${source('office/editor/editorState.ts')};
import { HostClientProvider } from ${source('HostClientContext.tsx')};
import { getCharacterScreenBounds } from ${source('office/engine/characterGeometry.ts')};
import { setContextUsage } from ${source('office/toolUtils.ts')};
import { CharacterState } from ${source('office/types.ts')};
import { createCharacter } from ${source('office/engine/characters.ts')};
const office = new OfficeState({version:2,cols:21,rows:15,tiles:Array(315).fill(1),furniture:[]});
const pan = {current:{x:0,y:0}}, editor = new EditorState(), sent = [];
const client = {send: m=>sent.push(m), subscribe:()=>()=>{}, getState:()=>undefined, setState:s=>s};
const tools = {};
for(let i=0;i<8;i++){
  const id='member-'+i;
  office.addAgent(id,'Member '+i+' Full Name','Developer');
  tools[id] = [{toolId:'read-'+i,status:'Read complete tool description',done:false}];
}
/* transient-fixture */
let currentZoom = 3;
let motionEnabled = true;
const initialLayout = JSON.stringify(office.layout);
function Fixture(){
 const [zoom,setZoom]=useState(3),[request,setRequest]=useState();
 const [,refreshFixture]=useState(0);
 currentZoom=zoom;
 window.fixture = {
   sent, office, pan, setZoom,
   tick(t){
     if(!motionEnabled) return;
     for(let i=0;i<8;i++){
       const c=office.characters.get('member-'+i);
       Object.assign(c,{x:(innerWidth/2+Math.sin(t/650+i)*140-pan.current.x)/zoom,
         y:(innerHeight/2+Math.sin(t/1100+i)*24-pan.current.y)/zoom,
         col:10,row:7,state:CharacterState.IDLE,path:[],wanderTimer:1000,active:false});
     }
     for(const [id,{character:c,parentAgentId}] of office.subagents){
       const parent=office.characters.get(parentAgentId),index=id==='task-0'?0:1;
       Object.assign(c,{x:parent.x+Math.sin(t/800+index)*12/zoom,y:parent.y+4/zoom,
         col:index===0?11:9,row:7,state:CharacterState.IDLE,path:[],wanderTimer:1000});
     }
   },
   sample(){
     return [...document.querySelectorAll('[data-agent-label], [data-subagent-label]')].map(e=>{
       const id=e.dataset.agentLabel||e.dataset.subagentLabel;
       const c=e.dataset.subagentLabel?office.subagents.get(id).character:office.characters.get(id);
       const annotation=e.closest('[data-agent-annotation]')||e;
       const r=annotation.getBoundingClientRect();
       const b=getCharacterScreenBounds(c,currentZoom,pan.current);
       const docked=!!annotation.closest('[data-label-dock="true"]');
       const characterBounds=[...office.characters.values(),...Array.from(office.subagents.values(),item=>item.character)]
         .map(character=>getCharacterScreenBounds(character,currentZoom,pan.current));
       const spriteOverlap=!docked&&characterBounds.some(bounds=>
         r.left<bounds.right&&r.right>bounds.left&&r.top<bounds.bottom&&r.bottom>bounds.top);
       const legacy=new URLSearchParams(location.search).has('baseline');
       return {id,x:r.x,y:r.y,width:r.width,height:r.height,anchor:legacy?b.top-14:b.top-8-r.height,
         world:{x:c.x,y:c.y},pan:{...pan.current},zoom:currentZoom,offscreen:e.textContent.includes('Off-screen'),
         text:e.textContent,annotationText:annotation.textContent,
         toolBubble:!!annotation.querySelector('[data-agent-tool-bubble]'),transient:!!e.dataset.subagentLabel,
         docked,spriteOverlap,associationCue:!!document.querySelector('[data-agent-association="'+id+'"]'),
         whiteLeader:!!document.querySelector('line[data-agent-connector],line[data-subagent-connector]')};
     });
   },
   active(){
     office.setAgentActive('member-0',true); office.setAgentTool('member-0','Read file');
     setContextUsage(office,'member-0',{contextTokens:600,maxContextTokens:1000});
   },
   resizeText(t){
     motionEnabled=false;
     for(const [id,{character:c}] of office.subagents) {
       c.name=t%2?'Short task '+id:'Long transient task description that wraps to several lines '+id;
     }
     office.setAgentActive('member-0',t%2===0);
     office.setAgentTool('member-0','Read file with a measured tool footprint');
   },
   isolateTarget(){
     for(let i=0;i<8;i++) Object.assign(office.characters.get('member-'+i),{
       x:i===7?168:16+i*16,y:i===7?120:16,state:CharacterState.IDLE,path:[],wanderTimer:1000,active:false});
   },
   labelProof(){
     motionEnabled=false;
     office.subagents.clear();
     setZoom(1);
     for(let i=0;i<8;i++) Object.assign(office.characters.get('member-'+i),{
       x:(i%2?innerWidth-90:90)-pan.current.x,
       y:180+(i<2?0:Math.floor(i/2)*160+(i%2)*40)-pan.current.y,
       state:CharacterState.IDLE,path:[],wanderTimer:1000,active:false});
     refreshFixture(value=>value+1);
   },
   toolbarEdgeProof(){
     motionEnabled=false;
     office.subagents.clear();
     setZoom(1);
     for(let i=0;i<8;i++) Object.assign(office.characters.get('member-'+i),{
       x:(i%2?innerWidth-90:90)-pan.current.x,
       y:(i===0?60:180+Math.floor(i/2)*160+(i%2)*40)-pan.current.y,
       state:CharacterState.IDLE,path:[],wanderTimer:1000,active:false});
     refreshFixture(value=>value+1);
   },
   bounds(id){ return getCharacterScreenBounds(office.characters.get(id),currentZoom,pan.current); },
   unchanged:()=>JSON.stringify(office.layout)===initialLayout
 };
 return <HostClientProvider client={client}>
   <OfficeCanvas officeState={office} editorState={editor} isEditMode={false} editorTick={0}
     zoom={zoom} onZoomChange={setZoom} panRef={pan} cameraRequest={request}
     onDeskClick={id=>window.lastCanvasDetail=id}/>
   <AgentLabels officeState={office} zoom={zoom} panRef={pan} agentTools={tools}
     onAgentClick={id=>window.lastDetail=id} onLocateAgent={agentId=>setRequest({id:Date.now(),agentId})}/>
   {/* baseline-tool-render */}
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
      const contents = entry.replace('/* baseline-tool-import */', variant === 'baseline'
        ? "import { ToolOverlay } from 'frozen-tool-overlay';" : '')
        .replace('{/* baseline-tool-render */}', variant === 'baseline'
          ? '<ToolOverlay officeState={office} zoom={zoom} panRef={pan} agentTools={tools}/>' : '')
        .replace('/* transient-fixture */', variant === 'current' ? `
          for(let i=0;i<2;i++){
            const id='task-'+i, character=createCharacter(id,'Test subtask '+i,'Ephemeral',0,null,null,0);
            Object.assign(character,{col:i===0?11:9,row:7,wanderTimer:1000});
            office.subagents.set(id,{character,parentAgentId:'member-'+i});
          }` : '');
      await build({ stdin: { contents, loader: 'tsx', resolveDir: root }, bundle: true,
        outfile: path.join(output, variant + '.js'), platform: 'browser', format: 'esm', jsx: 'automatic',
        plugins: variant === 'baseline' ? [{ name: 'frozen-overlay-baseline', setup(b) {
          b.onResolve({ filter: /^frozen-tool-overlay$/ }, () => ({
            path: 'frozen-tool-overlay', namespace: 'baseline',
          }));
          b.onLoad({ filter: /.*/, namespace: 'baseline' }, () => ({
            contents: execFileSync('git', ['show', `${baseline}:webview-ui/src/office/components/ToolOverlay.tsx`],
              { cwd: root, encoding: 'utf8' }), loader: 'tsx',
            resolveDir: path.join(root, 'webview-ui', 'src', 'office', 'components'),
          }));
          b.onLoad({ filter: /AgentLabels\.tsx$/ }, args => ({
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
      const record = { ...scenario, samples: [], maxLaneResidual: 0, maxWorldStep: 0,
        maxCameraStep: 0, maxLabelStep: 0, jumpsOver50: 0, overlapSamples: 0,
        floatingSamples: 0, spriteOverlapSamples: 0, whiteLeaderLines: 0 };
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
          record.floatingSamples += sample.filter(item => !item.docked).length;
          record.spriteOverlapSamples += sample.filter(item => item.spriteOverlap).length;
          if (previous) for (const item of sample) {
            const last = previous.find(p => p.id === item.id);
            if (!item.docked && last && !last.docked) {
              const residual = Math.abs((item.y - last.y) - (item.anchor - last.anchor));
              record.maxLaneResidual = Math.max(record.maxLaneResidual, residual);
              if (residual > 50) record.jumpsOver50++;
            }
            record.maxWorldStep = Math.max(record.maxWorldStep, Math.hypot(
              item.world.x - last.world.x, item.world.y - last.world.y));
            record.maxCameraStep = Math.max(record.maxCameraStep, Math.hypot(
              item.pan.x - last.pan.x, item.pan.y - last.pan.y));
            record.maxLabelStep = Math.max(record.maxLabelStep, Math.hypot(item.x - last.x, item.y - last.y));
          }
          if (sample.some((a, i) => sample.slice(i + 1).some(b =>
            a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y))) record.overlapSamples++;
          record.samples.push({ elapsed: Date.now() - start, labels: sample });
          previous = sample;
        }
        if (scenario.variant === 'baseline') {
          await page.screenshot({ path: path.join(output, `${scenario.variant}-${scenario.width}-zoom${scenario.zoom}.png`) });
        }
        if (scenario.variant === 'current') {
          record.whiteLeaderLines = await page.locator('line[data-agent-connector], line[data-subagent-connector]').count();
          assert.equal(record.whiteLeaderLines, 0, 'floating labels must not draw long leader lines');
          assert.equal(record.spriteOverlapSamples, 0, 'measured floating label rectangles must not overlap sprite bounds');
          assert.equal(record.jumpsOver50, 0, 'lane residual must not jump over50 CSSpx/100ms');
          assert.equal(record.maxCameraStep, 0, 'fixture must isolate lane motion from camera movement');
          assert.equal(await page.locator('[data-subagent-label]').count(), 2);
          record.transientCount = 2;
          assert.ok(record.samples.every(sample => sample.labels.filter(label => label.transient && !label.offscreen).length === 2),
            'both transient characters must stay on-screen during the motion/collision proof');
          record.measurementChanges = await page.evaluate(async () => {
            const samples=[];
            const committedFrame=async()=>{
              await new Promise(resolve=>requestAnimationFrame(resolve));
              await new Promise(resolve=>setTimeout(resolve,0));
            };
            const capture=(tick,phase)=>{
              const labels=window.fixture.sample();
              const overlaps=labels.some((a,i)=>labels.slice(i+1).some(b=>
                a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y));
              samples.push({tick,phase,labels,overlaps});
            };
            for(let tick=0;tick<36;tick++){
              window.fixture.resizeText(tick);
              // rAF promises resume before React's scheduler task. Hold the
              // state until the expected DOM commit, yielding a task as well.
              let committed=false;
              for(let attempt=0;attempt<30;attempt++){
                await committedFrame();
                const labels=window.fixture.sample(),active=tick%2===0;
                const member=labels.find(label=>label.id==='member-0');
                const tasks=labels.filter(label=>label.transient);
                if(tasks.every(label=>label.text.includes(active?'Long transient task description':'Short task'))
                  && member.toolBubble===active){
                  committed=true;
                  break;
                }
              }
              if(!committed) throw new Error('Expected text/tool state did not commit at tick '+tick);
              capture(tick,'first-committed');
              await committedFrame();
              capture(tick,'next-frame');
            }
            return samples;
          });
          assert.ok(record.measurementChanges.every(sample => !sample.overlaps),
            'member/subtask and subtask/subtask footprints must separate in both committed-frame samples');
          record.measuredSizes = {};
          for (const id of ['task-0', 'task-1', 'member-0']) {
            const states = record.measurementChanges.map(sample => ({
              active: sample.tick % 2 === 0, ...sample.labels.find(label => label.id === id),
            }));
            const sizes = [...new Set(states.map(label => `${label.width}x${label.height}`))];
            assert.ok(sizes.length >= 2, `${id} must have at least two distinct measured sizes`);
            const active = states.filter(label => label.active);
            const inactive = states.filter(label => !label.active);
            assert.ok(Math.min(...active.map(label => label.height)) > Math.max(...inactive.map(label => label.height)),
              `${id} long/active annotation must be strictly taller than its short/inactive state`);
            if (id === 'member-0') {
              assert.ok(active.every(label => label.toolBubble
                && label.annotationText.includes('Read file with a measured tool footprint')),
              'active member must render the measured tool bubble');
              assert.ok(inactive.every(label => !label.toolBubble), 'inactive member must remove its tool bubble');
            } else {
              assert.ok(active.every(label => label.text.includes('Long transient task description')),
                `${id} must actually render long text`);
              assert.ok(inactive.every(label => label.text.includes('Short task')), `${id} must render short text`);
            }
            record.measuredSizes[id] = sizes;
          }
          await page.evaluate(() => { window.fixture.pan.current.x = -4000; });
          await page.waitForTimeout(150);
          assert.ok(await page.locator('[data-agent-label]').first().textContent().then(t => t.includes('Off-screen')));
          await page.getByRole('button', { name: 'Locate Member 0 Full Name', exact: true }).focus();
          await page.keyboard.press('Enter');
          await page.waitForTimeout(150);
          const reopen = page.getByRole('button', { name: 'Show office labels', exact: true });
          if (await reopen.count()) await reopen.click();
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
          await page.evaluate(() => window.fixture.isolateTarget());
          await page.waitForTimeout(100);
          await page.getByRole('button', { name: 'Locate Member 7 Full Name', exact: true }).focus();
          await page.keyboard.press('Enter');
          await page.waitForTimeout(200);
          // Read production geometry through the fixture, not a guessed center point.
          record.locatedTarget = await page.evaluate(() => {
            const bounds=window.fixture.bounds('member-7');
            const x=(bounds.left+bounds.right)/2,y=(bounds.top+bounds.bottom)/2;
            return {x,y,bounds, visibleLabels:
              [...document.querySelectorAll('[data-agent-annotation]')].filter(e=>getComputedStyle(e).visibility!=='hidden').length,
              topElement:document.elementFromPoint(x,y)?.tagName};
          });
          assert.ok(record.locatedTarget.bounds.left >= 0 && record.locatedTarget.bounds.right <= 360
            && record.locatedTarget.bounds.top >= 0 && record.locatedTarget.bounds.bottom <= 280,
          'located target must be wholly visible in the crowded narrow viewport');
          assert.equal(record.locatedTarget.visibleLabels, 0, 'Locate must collapse the dock and reveal the target');
          assert.equal(record.locatedTarget.topElement, 'CANVAS', 'located character must be pointer-accessible');
          assert.equal(await page.getByRole('button', { name: 'Show office labels', exact: true })
            .evaluate(element => element === document.activeElement), true, 'keyboard focus returns to reopen control');
          await page.mouse.click(record.locatedTarget.x, record.locatedTarget.y);
          assert.equal(await page.evaluate(() => window.lastCanvasDetail), 'member-7');
          await page.getByRole('button', { name: 'Show office labels', exact: true }).click();
          assert.equal(await page.getByRole('button', { name: 'Hide office labels', exact: true }).getAttribute('aria-expanded'), 'true');
          record.crowded = 'Locate collapses list; target exposed and canvas-clickable; keyboard focus on reopen control';
          await page.setViewportSize({ width: scenario.width, height: 900 });
          await page.evaluate(() => window.fixture.labelProof());
          await page.waitForFunction(() => {
            if (document.querySelectorAll('[data-subagent-label]').length) return false;
            const proof=window.fixture.sample();
            return proof.length===8&&proof.every(label=>label.zoom===1&&!label.docked
              &&label.width>0&&label.height>0
              &&Math.abs(label.y+label.height-(window.fixture.bounds(label.id).top-8))<2);
          });
          const proof=await page.evaluate(()=>window.fixture.sample());
          assert.ok(proof.every(label=>!label.spriteOverlap),
            'measured DOM rectangles must clear every rendered character bound in the normal layout');
          assert.ok(proof.every(label=>!label.whiteLeader),'normal labels must have no long white leader line');
          const sparse=proof.filter(label=>label.id==='member-0'||label.id==='member-1');
          assert.equal(sparse.length,2);
          assert.equal(sparse[0].y,sparse[1].y,'sparse same-row labels must retain a shared floating anchor');
          assert.ok(sparse[0].x+sparse[0].width<=sparse[1].x||sparse[1].x+sparse[1].width<=sparse[0].x,
            'sparse same-row label rectangles must remain disjoint');
          record.measuredGeometryProof={labels:proof.length,spriteOverlaps:0,whiteLeaderLines:0};
          record.sparseSameRowProof={labels:sparse.length,sharedTop:sparse[0].y};
          await page.screenshot({ path: path.join(output, 'after-wide-1280x900.png') });
          await page.evaluate(() => window.fixture.toolbarEdgeProof());
          await page.waitForFunction(() => document.querySelector('[data-label-dock="true"]'));
          record.toolbarEdgeProof=await page.evaluate(() => {
            const annotation=document.querySelector('[data-agent-annotation="member:member-0"]');
            const bounds=window.fixture.bounds('member-0');
            const dock=document.querySelector('[data-label-dock="true"]');
            return {candidateTop:bounds.top-8-annotation.getBoundingClientRect().height,
              dockTop:dock.getBoundingClientRect().top,
              floatingLabels:[...document.querySelectorAll('[data-agent-annotation]')]
                .filter(element=>!element.closest('[data-label-dock="true"]')).length};
          });
          assert.ok(record.toolbarEdgeProof.candidateTop<56,
            'near-toolbar label must not fit within the reserved top band');
          assert.ok(record.toolbarEdgeProof.dockTop>=56,
            'accessible dock must remain below toolbar controls');
          assert.equal(record.toolbarEdgeProof.floatingLabels,0,
            'near-toolbar labels must use the accessible dock rather than overlap controls');
          await page.screenshot({ path: path.join(output, 'after-toolbar-edge-1280x900.png') });
        }
        await page.screenshot({ path: path.join(output, `${scenario.variant}-${scenario.width}-zoom${scenario.zoom}.png`) });
      } finally { await context.close(); }
    }
    assert.ok(evidence.cases[0].spriteOverlapSamples > 0,
      'frozen baseline must reproduce measured label rectangles intersecting sprite bounds');
    assert.ok(evidence.cases.filter(test => test.variant === 'current')
      .some(test => test.floatingSamples > 0),
    'current layout must prove at least one real measured floating annotation');
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
