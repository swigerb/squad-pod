import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, truncateSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyCanvasPlugin } from './verify-canvas-plugin.mjs';
import { readCanvasVersion } from './canvas-version.mjs';

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
  assert.deepEqual(receipt.plugin, { name: 'squad-pod', version: readCanvasVersion() });
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

function versionFixture(version) {
  const path = join(scratch, `version-${index++}.json`);
  writeFileSync(path, JSON.stringify({ version }));
  return path;
}

function isolatedBuildFixture(version) {
  const root = join(scratch, `isolated-build-${index++}`);
  const put = (name, contents) => {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents);
  };
  for (const name of ['standalone/build.canvas.mjs', 'scripts/canvas-version.mjs',
    'scripts/verify-canvas-plugin.mjs', 'package.json', 'standalone/package.json',
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'assets/squad-pod-icon.png']) {
    put(name, readFileSync(join(repo, name)));
  }
  put('standalone/canvas-plugin.json', JSON.stringify({ version }));
  put('webview-ui/public/assets/pixel-agents-source.json', '{}');
  for (const name of ['ws', 'react']) {
    put(`standalone/node_modules/${name}/package.json`,
      JSON.stringify({ name, version: '1.2.3', license: 'MIT', main: 'index.js' }));
    put(`standalone/node_modules/${name}/index.js`, '');
    put(`standalone/node_modules/${name}/LICENSE`, 'Fixture dependency license. '.repeat(8));
  }
  put('standalone/node_modules/pngjs/package.json', '{"main":"index.js"}');
  put('standalone/node_modules/pngjs/index.js', '');
  // Stub only the bundlers; execute the real manifest writer and complete verifier.
  put('standalone/node_modules/esbuild/package.json', '{"main":"index.cjs"}');
  put('standalone/node_modules/esbuild/index.cjs', `
    const { mkdirSync, writeFileSync } = require('node:fs');
    const { dirname, resolve } = require('node:path');
    exports.build = async options => {
      const imports = [{ path: '@github/copilot-sdk/extension', external: true }];
      if (options.outfile) {
        const path = resolve(options.absWorkingDir, options.outfile);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, 'import "@github/copilot-sdk/extension";\\n'
          + 'new URL("./canvas-browser", import.meta.url);\\n'
          + 'new URL("./assets", import.meta.url);\\n');
      }
      return { metafile: {
        inputs: { 'node_modules/ws/index.js': {}, 'node_modules/react/index.js': {} },
        outputs: { 'extension.mjs': { imports: options.entryPoints && !options.outfile ? [] : imports } },
      } };
    };
  `);
  put('webview-ui/node_modules/vite/bin/vite.js', `
    const { mkdirSync, writeFileSync } = require('node:fs');
    const { resolve } = require('node:path');
    const output = resolve('../standalone/dist/canvas-browser');
    mkdirSync(output, { recursive: true });
    writeFileSync(resolve(output, 'canvas.html'), '<!doctype html><title>Fixture</title>');
    writeFileSync(resolve(output, 'build-inputs.json'), '[]');
  `);
  const result = spawnSync(process.execPath, [join(root, 'standalone/build.canvas.mjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return root;
}

test('Canvas version source preserves independent current package identities', () => {
  const pkg = path => JSON.parse(readFileSync(join(repo, path), 'utf8'));
  assert.equal(readCanvasVersion(), '0.1.1');
  assert.equal(pkg('package.json').name, 'squad-pod');
  assert.equal(pkg('package.json').version, '1.0.0');
  assert.equal(pkg('standalone/package.json').name, 'squad-pod-observer');
  assert.equal(pkg('standalone/package.json').version, '0.1.0');
});

test('Canvas version source accepts alternate SemVer fixtures', () => {
  for (const version of ['0.1.1', '2.3.4-rc.1+build.007', '1.0.0']) {
    assert.equal(readCanvasVersion(versionFixture(version)), version);
  }
});

test('Canvas version source rejects invalid SemVer fixtures before artifact inspection', async () => {
  for (const version of [undefined, null, 1, '', 'v0.1.0', '1.2', '01.2.3', '1.02.3',
    '1.2.03', '1.2.3-01', '1.2.3-a.01', '1.2.3-', '1.2.3+', '1.2.3+bad!',
    ' 1.2.3', '1.2.3\n', '1.2.3\r\n']) {
    const path = versionFixture(version);
    assert.throws(() => readCanvasVersion(path), /version source.*valid SemVer/);
    await assert.rejects(verifyCanvasPlugin(join(scratch, 'absent'), path), /version source.*valid SemVer/);
  }
});

test('Canvas build rejects an invalid source before dependencies or output changes', () => {
  const root = join(scratch, `build-${index++}`);
  for (const dir of ['standalone', 'scripts', 'plugins/squad-pod']) mkdirSync(join(root, dir), { recursive: true });
  for (const name of ['standalone/build.canvas.mjs', 'scripts/canvas-version.mjs']) {
    cpSync(join(repo, name), join(root, name));
  }
  writeFileSync(join(root, 'standalone/canvas-plugin.json'), '{"version":"01.2.3"}');
  const sentinel = join(root, 'plugins/squad-pod/plugin.json');
  writeFileSync(sentinel, 'existing output');
  const result = spawnSync(process.execPath, [join(root, 'standalone/build.canvas.mjs')], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version source.*valid SemVer/);
  assert.equal(readFileSync(sentinel, 'utf8'), 'existing output');
});

test('Canvas verifier rejects artifact/source mismatch without build dependencies', async () => {
  const root = join(scratch, `mismatch-${index++}`);
  mkdirSync(root);
  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  writeFileSync(join(root, 'plugin.json'), JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'squad-pod', version: '0.1.0', description: manifest.description,
    author: manifest.author, homepage: manifest.homepage, repository: manifest.repository.url,
    license: manifest.license, keywords: ['canvas'], extensions: {},
  }));
  await assert.rejects(verifyCanvasPlugin(root), /manifest identity\/version\/schema/);
});

test('alternate Canvas source version is required in the artifact and receipt', async () => {
  const version = '2.3.4-rc.1+build.007';
  const buildRoot = isolatedBuildFixture(version);
  const root = join(buildRoot, 'plugins/squad-pod');
  const { verifyCanvasPlugin: verify } = await import(
    pathToFileURL(join(buildRoot, 'scripts/verify-canvas-plugin.mjs')).href);
  const manifest = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'));
  const persisted = JSON.parse(readFileSync(join(root, 'checksums.json'), 'utf8'));
  assert.equal(manifest.version, version, 'production build propagates the Canvas source, not a hardcoded or VSIX version');
  assert.deepEqual(persisted.plugin, { name: 'squad-pod', version }, 'build persists the alternate version receipt');
  const receipt = await verify(root);
  assert.deepEqual(receipt.plugin, { name: 'squad-pod', version });
  assert.deepEqual(receipt, persisted, 'build receipt agrees with independent verification');
  await assert.rejects(verify(root, versionFixture('0.1.0')), /manifest identity\/version\/schema/);
  update(root, 'plugin.json', value => { value.version = '0.1.0'; });
  await assert.rejects(verify(root), /manifest identity\/version\/schema/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'checksums.json'), 'utf8')), persisted,
    'mismatched artifacts never overwrite the accepted receipt');
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
