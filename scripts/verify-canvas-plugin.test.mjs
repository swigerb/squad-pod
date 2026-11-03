import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, truncateSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyCanvasPlugin } from './verify-canvas-plugin.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const source = join(repo, 'plugins/squad-pod');
const scratch = join(repo, `scripts/.canvas-plugin-checks-${process.pid}`);
const entry = 'com.github.copilot/extensions/squad-pod/extension.mjs';
let index = 0;
mkdirSync(scratch);
after(() => rmSync(scratch, { recursive: true, force: true }));
function fixture() {
  const root = join(scratch, String(index++));
  cpSync(source, root, { recursive: true });
  return root;
}
function update(root, name, mutate) {
  const path = join(root, name);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  mutate(value);
  writeFileSync(path, JSON.stringify(value));
}
function emit(root, code) {
  writeFileSync(join(root, entry), code);
  update(root, 'build-info.json', info => {
    info.extensionSha256 = createHash('sha256').update(code).digest('hex');
  });
}

test('real artifact has checksums, pinned bundled licenses and source identity', async () => {
  const root = fixture();
  const receipt = await verifyCanvasPlugin(root);
  assert.deepEqual(receipt.plugin, { name: 'squad-pod', version: '0.1.0' });
  assert.match(receipt.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(receipt.sdk.providedBy, 'host');
  assert.deepEqual(receipt.dependencies.map(item => item.name), ['pngjs', 'react', 'react-dom', 'scheduler', 'ws']);
  for (const file of receipt.files) {
    const bytes = readFileSync(join(root, file.path));
    assert.equal(file.bytes, bytes.length, file.path);
    assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'), file.path);
  }
  assert.ok(receipt.files.some(item => item.path.endsWith('/characters/char_0.png')));
  assert.ok(receipt.files.some(item => item.path.endsWith('/pets/gitcat/manifest.json')));
  assert.ok(!receipt.files.some(item => item.path === 'checksums.json'));
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'checksums.json'))), receipt);
  assert.deepEqual(await verifyCanvasPlugin(root), receipt, 'receipt is deterministic');
});

for (const [label, mutate, expected] of [
  ['missing entry', root => rmSync(join(root, entry)), /missing resource.*extension.mjs/],
  ['unknown manifest field', root => update(root, 'plugin.json', value => { value.preview = true; }), /manifest fields/],
  ['VSIX version', root => update(root, 'plugin.json', value => { value.version = '1.0.0'; }), /identity\/version/],
  ['schema', root => update(root, 'plugin.json', value => { value.$schema = 'legacy'; }), /schema/],
  ['author type', root => update(root, 'plugin.json', value => { value.author = 'me'; }), /author/],
  ['canvas keyword', root => update(root, 'plugin.json', value => { value.keywords = []; }), /keywords/],
  ['preview traversal', root => update(root, 'plugin.json', value => { value.extensions['com.github.copilot'].logo = '../outside.png'; }), /preview metadata/],
  ['repository build namespace', root => update(root, 'plugin.json', value => { value.extensions['com.github.awesome-copilot'] = {}; }), /preview metadata/],
  ['preview bytes', root => writeFileSync(join(root, 'assets/preview.png'), 'not png'), /preview PNG/],
  ['evidence file', root => writeFileSync(join(root, 'evidence.json'), '{}'), /unexpected\/private/],
  ['evidence disguised as asset', root => writeFileSync(join(root, 'com.github.copilot/extensions/squad-pod/assets/evidence.json'), '{}'), /unexpected asset/],
  ['private file disguised as license', root => writeFileSync(join(root, 'licenses/private.txt'), 'private notes'), /unexpected license/],
  ['source map', root => writeFileSync(join(root, `${entry}.map`), '{}'), /unexpected\/private/],
  ['linked resource', root => symlinkSync(join(source, 'assets'), join(root, 'linked'), 'junction'), /linked resource/],
  ['private key', root => writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), '-----BEGIN PRIVATE KEY-----'), /possible secret/],
  ['oversized artifact', root => truncateSync(join(root, entry), 10 * 1024 * 1024 + 1), /file size limit/],
  ['bad provenance', root => update(root, 'build-info.json', value => { value.sourceCommit = 'master'; }), /provenance/],
  ['bundled SDK', root => update(root, 'build-info.json', value => { value.inputs.push('standalone/node_modules/@github/copilot-sdk/extension.js'); }), /forbidden bundled input/],
  ['native dependency', root => update(root, 'build-info.json', value => { value.inputs.push('standalone/node_modules/node-pty/lib/index.js'); }), /forbidden bundled input/],
  ['external ws', root => update(root, 'build-info.json', value => { value.imports.push({ path: 'ws', external: true }); }), /undeclared runtime import/],
  ['wrong dependency version', root => update(root, 'build-info.json', value => { value.dependencies.find(item => item.name === 'ws').version = '1.0.0'; }), /dependency version\/license.*ws/],
  ['invented dependency', root => update(root, 'build-info.json', value => { value.dependencies.push(value.dependencies[0]); }), /inventory completeness/],
  ['UI bare import', root => {
    const receipt = JSON.parse(readFileSync(join(root, 'checksums.json')));
    const script = receipt.files.find(item => /canvas-browser\/assets\/.*\.js$/.test(item.path)).path;
    writeFileSync(join(root, script), readFileSync(join(root, script), 'utf8') + '\nimport "vscode";');
  }, /forbidden UI import/],
  ['missing license', root => {
    const info = JSON.parse(readFileSync(join(root, 'build-info.json')));
    rmSync(join(root, info.dependencies.find(item => item.name === 'ws').licensePath));
  }, /missing resource.*licenses\/ws/],
  ['sprite mutation', root => writeFileSync(join(root, 'com.github.copilot/extensions/squad-pod/assets/characters/char_0.png'), 'bad'), /sprite\/manifest mismatch/],
  ['absolute UI resource', root => {
    const path = join(root, 'com.github.copilot/extensions/squad-pod/canvas-browser/index.html');
    writeFileSync(path, readFileSync(path, 'utf8').replace('./assets/', '/assets/'));
  }, /non-relative resource/],
  ['missing UI resource', root => {
    const path = join(root, 'com.github.copilot/extensions/squad-pod/canvas-browser/index.html');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/canvas-[\w-]+\.js/, 'missing.js'));
  }, /missing resource.*missing.js/],
  ['tampered extension', root => writeFileSync(join(root, entry), readFileSync(join(root, entry), 'utf8') + '\n// tampered'), /extension build hash/],
  ['hidden vscode import', root => emit(root, readFileSync(join(root, entry), 'utf8') + '\nimport "vscode";'), /forbidden emitted import/],
  ['hidden native require', root => emit(root, readFileSync(join(root, entry), 'utf8') + '\nrequire("node-pty");'), /forbidden emitted import|forbidden emitted require/],
  ['runtime stdout', root => emit(root, readFileSync(join(root, entry), 'utf8') + '\nprocess.stdout.write("noise");'), /runtime stdout/],
]) {
  test(`verifier rejects ${label} in the actual artifact`, async () => {
    const root = fixture();
    mutate(root);
    await assert.rejects(verifyCanvasPlugin(root), expected);
  });
}

test('copied artifact starts ESM, opens synthetic project and serves UI with only injected SDK', () => {
  const root = fixture();
  const project = join(root, 'synthetic-project');
  mkdirSync(join(project, '.squad'), { recursive: true });
  writeFileSync(join(project, '.squad/team.md'), '# Test team\n\n## Members\n\n| Name | Role | Charter | Status |\n|---|---|---|---|\n');
  const sdk = `
    import assert from 'node:assert/strict';
    export class CanvasError extends Error {}
    export const createCanvas = value => value;
    export async function joinSession({ canvases: [canvas] }) {
      setImmediate(async () => {
        const ctx = { sessionId: 'smoke', canvasId: 'squad-pod', instanceId: 'one', extensionId: 'test' };
        try {
          const opened = await canvas.open(ctx);
          const url = new URL(opened.url);
          assert.equal(url.hostname, '127.0.0.1');
          const response = await fetch(url);
          assert.equal(response.status, 200);
          const html = await response.text();
          assert.match(html, /Squad Pod canvas/);
          for (const match of html.matchAll(/(?:src|href)="(\\.\\/assets\\/[^"]+)"/g)) {
            assert.equal((await fetch(new URL(match[1], url))).status, 200, match[1]);
          }
          await canvas.onClose(ctx);
          console.error('package smoke passed');
        } catch { process.exitCode = 1; console.error('package smoke failed'); }
      });
      return { sessionId: 'smoke', on: () => () => {},
        rpc: { metadata: { snapshot: async () => ({ sessionId: 'smoke', workingDirectory: ${JSON.stringify(project)} }) } } };
    }`;
  writeFileSync(join(root, 'loader.mjs'), `
    import { isBuiltin } from 'node:module';
    export function resolve(specifier, context, next) {
      if (specifier === '@github/copilot-sdk/extension') return { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(sdk)}`)}, shortCircuit: true };
      if (!isBuiltin(specifier) && !specifier.startsWith('file:')) throw new Error('Undeclared runtime import: ' + specifier);
      return next(specifier, context);
    }`);
  writeFileSync(join(root, 'smoke.mjs'), `
    import Module, { register, isBuiltin } from 'node:module';
    register('./loader.mjs', import.meta.url);
    const original = Module._resolveFilename;
    Module._resolveFilename = function(specifier, ...args) {
      if (!isBuiltin(specifier)) throw new Error('Undeclared runtime require: ' + specifier);
      return original.call(this, specifier, ...args);
    };
    await import(${JSON.stringify(pathToFileURL(join(root, entry)).href)});
  `);
  const result = spawnSync(process.execPath, [join(root, 'smoke.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '', 'Canvas runtime never writes stdout');
  assert.match(result.stderr, /package smoke passed/);
});

test('Canvas output is gitignored and excluded without changing VSIX receipt implementation', () => {
  const ignored = spawnSync('git', ['check-ignore', 'plugins/squad-pod/plugin.json'], { cwd: repo, encoding: 'utf8' });
  assert.equal(ignored.status, 0);
  assert.match(readFileSync(join(repo, '.vscodeignore'), 'utf8'), /^plugins\/\*\*$/m);
  const baseline = spawnSync('git', ['show', 'HEAD:scripts/verify-package-receipt.cjs'], { cwd: repo });
  assert.equal(baseline.status, 0);
  assert.equal(readFileSync(join(repo, 'scripts/verify-package-receipt.cjs'), 'utf8').replaceAll('\r\n', '\n'),
    baseline.stdout.toString().replaceAll('\r\n', '\n'));
});
