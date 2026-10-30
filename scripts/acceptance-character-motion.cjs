const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { build } = require('esbuild');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');
const webviewRoot = path.join(root, 'webview-ui');
const output = path.resolve(process.env.ACCEPTANCE_OUTPUT_DIR
  || path.join(os.tmpdir(), 'squad-character-motion'));
const edgePath = process.env.EDGE_PATH
  || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function modulePath(relative) {
  return JSON.stringify(path.join(webviewRoot, 'src', ...relative.split('/')));
}

function createEntry(directory) {
  const entry = path.join(directory, 'motion-entry.ts');
  fs.writeFileSync(entry, `
    export { renderScene } from ${modulePath('office/engine/renderer.ts')};
    export { createCharacter, updateCharacter, getCharacterAnimation } from ${modulePath('office/engine/characters.ts')};
    export { CharacterState, Direction } from ${modulePath('office/types.ts')};
    export { getFullDiagnosticReport } from ${modulePath('office/sprites/assetLoader.ts')};
  `);
  return entry;
}

const pageHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Squad Pod character-motion acceptance</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 18px; color: #eee8dc; background: #1d1b19;
      font: 14px/1.4 system-ui, sans-serif; }
    h1 { margin: 0 0 8px; font-size: 18px; }
    p { margin: 0 0 14px; color: #b7aca0; }
    canvas { display: block; max-width: 100%; height: auto; image-rendering: pixelated;
      border: 1px solid #82776a; background: #51483f; }
  </style>
</head>
<body>
  <h1>Squad Pod character renderer</h1>
  <p>Production renderer and embedded character art; synthetic scene only.</p>
  <canvas id="stage"></canvas>
  <script type="module">
    import { renderScene, createCharacter, updateCharacter, getCharacterAnimation,
      getFullDiagnosticReport, CharacterState, Direction } from '/motion.js';

    const canvas = document.querySelector('#stage');
    const ctx = canvas.getContext('2d');
    const palettes = ['char_0', 'char_1', 'char_2', 'char_3', 'char_4', 'char_5'];
    const directionNames = ['down', 'left', 'right', 'up'];
    const floorColors = ['#574e45', '#60564c', '#5b5249', '#645a50'];
    ctx.imageSmoothingEnabled = false;

    function ground(context, x, y, width, height, zoom) {
      context.fillStyle = '#35302b';
      context.fillRect(x, y, width, height);
      const step = 16 * zoom;
      for (let row = 0; row * step < height; row++) {
        for (let col = 0; col * step < width; col++) {
          context.fillStyle = floorColors[(row * 3 + col) % floorColors.length];
          context.fillRect(x + col * step, y + row * step, step, step);
        }
      }
    }

    function character(palette, state, direction, x, footY, frameIndex, tool) {
      const item = createCharacter('fixture', palettes[palette], 'Synthetic', palette, null, null, 0);
      item.state = state;
      item.direction = direction;
      item.frameIndex = frameIndex;
      item.tool = tool;
      item.x = x;
      item.y = footY;
      return item;
    }

    function stage(width, height, zoom, characters, labels, offsetX = 0, offsetY = 0) {
      canvas.width = width;
      canvas.height = height;
      ctx.imageSmoothingEnabled = false;
      ground(ctx, 0, 0, width, height, zoom);
      renderScene(ctx, [], characters, offsetX, offsetY, zoom, null, null);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = '12px system-ui, sans-serif';
      for (const label of labels) {
        ctx.fillStyle = 'rgba(24, 21, 19, 0.8)';
        ctx.fillRect(label.x - label.width / 2, label.y - 2, label.width, 22);
        ctx.fillStyle = '#f3e8d8';
        ctx.fillText(label.text, label.x, label.y + 2);
      }
    }

    function capture() {
      return canvas.toDataURL('image/png').split(',')[1];
    }

    const directions = [Direction.DOWN, Direction.UP, Direction.RIGHT, Direction.LEFT];
    const poses = ['walk', 'typing', 'reading'];
    const matrix = [];
    const matrixLabels = [];
    for (let row = 0; row < directions.length; row++) {
      for (let col = 0; col < poses.length; col++) {
        const pose = poses[col];
        const screenX = 210 + col * 430;
        const footY = 125 + row * 184;
        const item = character(
          (row * poses.length + col) % 6,
          pose === 'walk' ? CharacterState.WALK : CharacterState.TYPE,
          directions[row],
          screenX / 2,
          footY / 2,
          pose === 'walk' ? row : row % 2,
          pose === 'reading' ? 'view' : pose === 'typing' ? 'Bash' : undefined,
        );
        matrix.push(item);
        matrixLabels.push({ x: screenX, y: row * 184 + 10, width: 140,
          text: \`\${directionNames[directions[row]].toUpperCase()} · \${pose.toUpperCase()}\` });
      }
    }
    stage(1280, 760, 2, matrix, matrixLabels);
    const poseMatrix = capture();

    const lineup = Array.from({ length: 6 }, (_, index) =>
      character(index, CharacterState.IDLE, Direction.DOWN, (95 + index * 205) / 3, 390 / 3, 0));
    stage(1280, 500, 3, lineup, lineup.map((item, index) => ({
      x: 95 + index * 205, y: 145, width: 150, text: palettes[index],
    })));
    const desktop = capture();

    const narrow = [
      character(0, CharacterState.IDLE, Direction.DOWN, 180 / 1.5, 135 / 1.5, 0),
      character(1, CharacterState.WALK, Direction.RIGHT, 180 / 1.5, 300 / 1.5, 2),
      character(2, CharacterState.TYPE, Direction.UP, 180 / 1.5, 465 / 1.5, 1, 'Bash'),
      character(3, CharacterState.TYPE, Direction.LEFT, 180 / 1.5, 615 / 1.5, 1, 'view'),
    ];
    stage(360, 640, 1.5, narrow, ['IDLE', 'WALK · TURN', 'TYPING', 'READING'].map((text, index) => ({
      x: 180, y: index * 160 + 7, width: 125, text,
    })));
    const narrowPanel = capture();

    const moving = character(3, CharacterState.WALK, Direction.RIGHT, 72, 72, 0);
    moving.col = 4;
    moving.row = 4;
    moving.path = [{ col: 5, row: 4 }, { col: 5, row: 3 }, { col: 6, row: 3 }];
    const tiles = Array.from({ length: 12 }, () => Array(12).fill(1));
    const stepCells = [];
    canvas.width = 1200;
    canvas.height = 480;
    ctx.imageSmoothingEnabled = false;
    for (let index = 0; index < 10; index++) {
      updateCharacter(moving, 0.1, new Set(), [], tiles, new Set());
      const cellX = (index % 5) * 240;
      const cellY = Math.floor(index / 5) * 240;
      ground(ctx, cellX, cellY, 240, 240, 2);
      renderScene(ctx, [], [moving], cellX, cellY, 2, null, null);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = '#f3e8d8';
      ctx.fillText(\`t=\${((index + 1) / 10).toFixed(1)}s · \${directionNames[moving.direction]}\`,
        cellX + 8, cellY + 8);
      stepCells.push({ t: (index + 1) / 10, direction: moving.direction,
        col: moving.col, row: moving.row, progress: moving.moveProgress, frameIndex: moving.frameIndex });
    }
    for (let index = 0; moving.path.length > 0 && index < 10; index++) {
      updateCharacter(moving, 0.02, new Set(), [], tiles, new Set());
    }
    if (moving.path.length > 0) throw new Error('Production movement did not finish its three-tile route');
    const walkStrip = capture();

    const transitionFrames = [];
    const seat = { id: 'seat', col: 6, row: 3, direction: Direction.LEFT };
    moving.seatId = seat.id;
    moving.active = true;
    updateCharacter(moving, 0.01, new Set(), [seat], tiles, new Set());
    moving.frameIndex = 0;
    moving.tool = 'Bash';
    const transitionNames = ['typing', 'reading', 'idle'];
    const transitions = [];
    for (const stateName of transitionNames) {
      if (stateName === 'reading') moving.tool = 'view';
      if (stateName === 'idle') {
        moving.active = false;
        moving.seatTimer = 0.05;
        updateCharacter(moving, 0.06, new Set(), [seat], tiles, new Set());
      }
      const stateLabel = stateName.toUpperCase();
      stage(480, 220, 2, [moving], [{ x: 240, y: 10, width: 120, text: stateLabel }]);
      transitionFrames.push(capture());
      transitions.push({ name: stateName, state: moving.state, direction: moving.direction,
        animation: getCharacterAnimation(moving) });
    }

    window.__motionEvidence = {
      desktop, poseMatrix, narrowPanel,
      walkFrames: stepCells,
      walkStrip,
      transitionFrames,
      stepCells,
      transitions,
      loadedBuiltinKeys: getFullDiagnosticReport().characterSheetKeys,
    };
    window.__motionReady = true;
  </script>
</body>
</html>`;

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-character-motion-'));
  let browser;
  let server;
  try {
    const entry = createEntry(temp);
    const bundlePath = path.join(temp, 'motion.js');
    await build({
      entryPoints: [entry],
      outfile: bundlePath,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      logLevel: 'silent',
    });
    server = http.createServer((request, response) => {
      if (request.url === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(pageHtml);
      } else if (request.url === '/motion.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        fs.createReadStream(bundlePath).pipe(response);
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    browser = await playwright.chromium.launch({ executablePath: edgePath, headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__motionReady === true);
    const evidence = await page.evaluate(() => window.__motionEvidence);
    for (const [file, image] of [
      ['character-motion-desktop.png', evidence.desktop],
      ['character-motion-poses.png', evidence.poseMatrix],
      ['character-motion-narrow.png', evidence.narrowPanel],
      ['character-motion-walk-strip.png', evidence.walkStrip],
      ...evidence.transitionFrames.map((image, index) => [`character-motion-transition-${index + 1}.png`, image]),
    ]) {
      fs.writeFileSync(path.join(output, file), Buffer.from(image, 'base64'));
    }

    const poseImage = PNG.sync.read(Buffer.from(evidence.poseMatrix, 'base64'));
    const walkStripImage = PNG.sync.read(Buffer.from(evidence.walkStrip, 'base64'));
    assert.deepEqual([poseImage.width, poseImage.height], [1280, 760]);
    assert.deepEqual([walkStripImage.width, walkStripImage.height], [1200, 480]);
    assert.deepEqual(evidence.loadedBuiltinKeys, [
      'builtin:0', 'builtin:1', 'builtin:2', 'builtin:3', 'builtin:4', 'builtin:5',
    ], 'all six synchronous built-in character sheets must be loaded in the actual browser');
    assert.equal(evidence.stepCells.length, 10, 'temporal strip must contain ten measured 100ms steps');
    assert.ok(new Set(evidence.stepCells.map((frame) => frame.direction)).size >= 2,
      'walk strip must show a production corner turn');
    assert.deepEqual(evidence.transitions.map((frame) => frame.animation), ['typing', 'reading', 'idle'],
      'seat transition and reading/idle state changes must use their authored pose groups');
    assert.deepEqual(pageErrors, [], 'no browser page errors during renderer evidence capture');

    const files = fs.readdirSync(output).filter((file) => file.endsWith('.png')).sort();
    const report = {
      result: 'PASS',
      sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      renderer: 'esbuild-bundled production renderScene/updateCharacter modules with embedded PNG-derived RGBA atlases',
      scene: 'synthetic canvas floor; no VS Code, Squad, Copilot, session logs, or external provider',
      viewportEvidence: ['1280x900 desktop', '360x640 narrow panel'],
      zooms: [1.5, 2, 3],
      walkFrames: evidence.stepCells,
      stateTransitions: evidence.transitions,
      pageErrors,
      screenshots: files.map((file) => ({
        file,
        sha256: sha256(fs.readFileSync(path.join(output, file))),
      })),
      limitation: 'This isolates the production character renderer and motion engine; it does not reproduce the parent-owned starter-office composition or native VS Code chrome.',
    };
    fs.writeFileSync(path.join(output, 'character-motion-results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ result: report.result, sourceSha: report.sourceSha,
      evidenceDirectory: output, screenshots: files, stateTransitions: report.stateTransitions }, null, 2));
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
