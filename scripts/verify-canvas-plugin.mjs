import { createHash } from 'node:crypto';
import { builtinModules, createRequire } from 'node:module';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lexer, walkTokens } from 'marked';
import { readCanvasVersion } from './canvas-version.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const extensionPath = 'com.github.copilot/extensions/squad-pod';
const sdk = '@github/copilot-sdk/extension';
const schema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`Canvas plugin: ${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };
const safe = path => typeof path === 'string' && /^[A-Za-z0-9_@./-]+$/.test(path)
  && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..');
const builtin = name => builtinModules.includes(name.replace(/^node:/, ''));

function verifyReadme(bytes, files) {
  assert(bytes.length > 0 && bytes.toString().trim(), 'README.md is empty');
  assert(bytes.length <= 512 * 1024, 'README.md exceeds 512 KiB');
  assert(!bytes.includes(13), 'README.md must use LF line endings');
  walkTokens(lexer(bytes.toString()), token => {
    if (token.type !== 'link' && token.type !== 'image') return;
    const target = token.href;
    if (/^https:\/\//i.test(target)) {
      const url = new URL(target);
      assert(url.protocol === 'https:' && url.hostname, `unsafe README.md link: ${target}`);
      return;
    }
    let decoded;
    try { decoded = decodeURIComponent(target); }
    catch { fail(`invalid README.md link encoding: ${target}`); }
    assert(!/[\\:\x00-\x20\x7f]/.test(decoded), `unsafe README.md link: ${target}`);
    const path = decoded.split(/[?#]/)[0].replace(/^\.\//, '');
    assert(safe(path) && files.has(path), `broken/unsafe README.md relative link: ${target}`);
  });
  assert(bytes.equals(readFileSync(join(repo, 'standalone/README.canvas.md'))), 'README.md source mismatch');
}

/** Audit a generated local artifact without executing its extension or installing it. */
export async function verifyCanvasPlugin(directory = join(repo, 'plugins/squad-pod'), versionSource) {
  const version = readCanvasVersion(versionSource);
  const root = resolve(directory);
  const files = new Map();
  let total = 0;
  function walk(path) {
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink(), `linked resource: ${relative(root, path)}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(join(path, name));
      return;
    }
    const name = relative(root, path).replaceAll('\\', '/');
    assert(stat.isFile() && safe(name), `unsafe file: ${name}`);
    assert(stat.size <= 10 * 1024 * 1024, `file size limit: ${name}`);
    total += stat.size;
    assert(total <= 40 * 1024 * 1024, 'total size limit');
    const allowed = /^(plugin\.json|build-info\.json|checksums\.json|README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|assets\/preview\.png|licenses\/[\w@.-]+\.txt)$/.test(name)
      || (name.startsWith(`${extensionPath}/`) && /^(extension\.mjs|canvas-browser\/index\.html|canvas-browser\/assets\/[\w.-]+\.(js|css)|assets\/[\w./-]+\.(png|json))$/.test(name.slice(extensionPath.length + 1)));
    assert(allowed && !/(^|\/)(node_modules|evidence|fixtures|secrets|sessions|artifacts|coverage)(\/|$)/i.test(name),
      `unexpected/private file: ${name}`);
    const bytes = readFileSync(path);
    if (!name.endsWith('.png')) {
      assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9]{32,}/.test(bytes.toString()),
        `possible secret: ${name}`);
    }
    files.set(name, bytes);
  }
  walk(root);
  const get = name => { assert(files.has(name), `missing resource: ${name}`); return files.get(name); };
  const json = name => JSON.parse(get(name).toString());
  const manifest = json('plugin.json');
  const fields = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];
  assert(manifest && fields.every(key => Object.hasOwn(manifest, key))
    && Object.keys(manifest).every(key => fields.includes(key)), 'manifest fields');
  assert(manifest.$schema === schema && manifest.name === 'squad-pod'
    && manifest.version === version,
  'manifest identity/version/schema');
  for (const field of ['description', 'license', 'homepage', 'repository']) {
    assert(typeof manifest[field] === 'string' && manifest[field].trim(), `manifest ${field}`);
  }
  assert(manifest.license === 'MIT' && /^https:\/\//.test(manifest.homepage)
    && /^https:\/\//.test(manifest.repository), 'manifest license/URLs');
  assert(manifest.author && typeof manifest.author.name === 'string' && manifest.author.name.trim()
    && Object.keys(manifest.author).every(key => ['name', 'email', 'url'].includes(key) && typeof manifest.author[key] === 'string'), 'manifest author');
  assert(Array.isArray(manifest.keywords) && manifest.keywords.includes('canvas')
    && manifest.keywords.every(value => typeof value === 'string'), 'manifest keywords');
  assert(Object.keys(manifest.extensions ?? {}).join() === 'com.github.copilot'
    && manifest.extensions['com.github.copilot'].logo === 'assets/preview.png', 'manifest preview metadata');
  assert(get('assets/preview.png').subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'preview PNG');
  assert(get('assets/preview.png').equals(readFileSync(join(repo, 'assets/squad-pod-icon.png'))), 'preview artwork mismatch');
  get('LICENSE'); get('THIRD_PARTY_NOTICES.md');
  verifyReadme(get('README.md'), files);
  // The runtime resolves both directories relative to extension.mjs, never the build cwd.
  const entry = `${extensionPath}/extension.mjs`;
  const code = get(entry).toString();
  for (const directory of ['canvas-browser', 'assets']) {
    assert(code.includes(`new URL("./${directory}", import.meta.url)`), `runtime resource path: ${directory}`);
  }
  for (const [name, bytes] of files) {
    if (!/\.(html|css)$/.test(name)) continue;
    const refs = bytes.toString().matchAll(/(?:src|href)=["']([^"']+)["']|url\(["']?([^"')]+)["']?\)/g);
    for (const match of refs) {
      const ref = (match[1] ?? match[2]).replace(/^\.\//, '');
      if (ref.startsWith('data:')) continue;
      assert(safe(ref), `non-relative resource: ${name}: ${ref}`);
      get(`${dirname(name).replaceAll('\\', '/')}/${ref}`);
    }
  }
  const assetRoot = `${extensionPath}/assets/`;
  const expectedAssets = new Set();
  function sourceAssets(path, prefix = '') {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      const name = `${prefix}${item.name}`;
      if (item.isDirectory()) sourceAssets(join(path, item.name), `${name}/`);
      else {
        expectedAssets.add(`${assetRoot}${name}`);
        assert(get(`${assetRoot}${name}`).equals(readFileSync(join(path, item.name))), `sprite/manifest mismatch: ${name}`);
      }
    }
  }
  sourceAssets(join(repo, 'webview-ui/public/assets'));
  assert([...files.keys()].every(name => !name.startsWith(assetRoot) || expectedAssets.has(name)), 'unexpected asset resource');
  get(`${extensionPath}/canvas-browser/index.html`);
  const info = json('build-info.json');
  assert(/^[a-f0-9]{40}$/.test(info.sourceCommit) && typeof info.sourceDirty === 'boolean', 'source provenance');
  assert(info.sdk?.name === sdk && info.sdk.contract === '1.0.28' && info.sdk.providedBy === 'host', 'host SDK contract');
  assert(Array.isArray(info.inputs) && info.inputs.length > 0
    && info.inputs.every(path => safe(path) && !/(?:node-pty|\/vscode\/|copilot-sdk)/.test(path)), 'forbidden bundled input');
  assert(info.extensionSha256 === sha256(get(entry)), 'extension build hash');
  assert(info.imports.some(value => value.path === sdk && value.external)
    && info.imports.every(value => value.external && (value.path === sdk || builtin(value.path))), 'undeclared runtime import');
  // Inspect the emitted code too, so forged/stale metadata cannot hide a new static import.
  const require = createRequire(new URL('../standalone/package.json', import.meta.url));
  const { build } = require('esbuild');
  const parsed = await build({ stdin: { contents: code, resolveDir: dirname(join(root, entry)), loader: 'js' },
    bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
  const imports = Object.values(parsed.metafile.outputs).flatMap(output => output.imports);
  assert(imports.some(value => value.path === sdk)
    && imports.every(value => value.external && (value.path === sdk || builtin(value.path))), 'forbidden emitted import');
  for (const match of code.matchAll(/(?:\b__require|\brequire)\(["']([^"']+)["']\)/g)) {
    assert(builtin(match[1]), `forbidden emitted require: ${match[1]}`);
  }
  assert(!/\b(?:console\.log|process\.stdout\.write)\s*\(/.test(code), 'runtime stdout write');
  for (const [name] of files) {
    if (!name.startsWith(`${extensionPath}/canvas-browser/`) || !name.endsWith('.js')) continue;
    const ui = await build({ entryPoints: [join(root, name)], bundle: true, packages: 'external',
      platform: 'browser', write: false, metafile: true, logLevel: 'silent' });
    assert(Object.values(ui.metafile.outputs).every(output => output.imports.length === 0), `forbidden UI import: ${name}`);
  }
  assert(Array.isArray(info.dependencies) && info.dependencies.some(item => item.name === 'ws')
    && info.dependencies.some(item => item.name === 'react'), 'dependency inventory');
  for (const item of info.dependencies) {
    assert(typeof item.name === 'string' && /^\d+\.\d+\.\d+/.test(item.version)
      && typeof item.license === 'string' && safe(item.licensePath), 'dependency/license inventory');
    assert(get(item.licensePath).length > 100, `dependency license: ${item.name}`);
  }
  const expectedDependencies = new Set();
  for (const input of info.inputs.filter(path => path.includes('node_modules/'))) {
    const start = input.lastIndexOf('node_modules/') + 'node_modules/'.length;
    const name = input.slice(start).match(/^(?:@[^/]+\/)?[^/]+/)[0];
    expectedDependencies.add(name);
    const packageRoot = join(repo, input.slice(0, start), name);
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    const item = info.dependencies.find(item => item.name === name);
    assert(item?.version === pkg.version && item.license === pkg.license, `dependency version/license: ${name}`);
    assert(get(item.licensePath).equals(readFileSync(join(packageRoot, 'LICENSE'))), `dependency license bytes: ${name}`);
  }
  assert(expectedDependencies.size === info.dependencies.length, 'dependency inventory completeness');
  assert([...files.keys()].every(name => !name.startsWith('licenses/')
    || info.dependencies.some(item => item.licensePath === name)), 'unexpected license resource');
  const receipt = {
    plugin: { name: manifest.name, version: manifest.version }, sourceCommit: info.sourceCommit,
    sourceDirty: info.sourceDirty, sdk: info.sdk, dependencies: info.dependencies,
    assetLicenses: { notices: 'THIRD_PARTY_NOTICES.md', source: `${assetRoot}pixel-agents-source.json` },
    files: [...files].filter(([name]) => name !== 'checksums.json')
      .map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) })),
  };
  writeFileSync(join(root, 'checksums.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await verifyCanvasPlugin(process.argv[2]); console.error('Canvas plugin verified'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
