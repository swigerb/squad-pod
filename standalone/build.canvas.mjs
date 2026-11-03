import { build } from 'esbuild';
import { cpSync, renameSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const repo = fileURLToPath(new URL('../', import.meta.url));
const output = join(repo, 'plugins/squad-pod');
const extension = join(output, 'com.github.copilot/extensions/squad-pod');
const root = fileURLToPath(new URL('../webview-ui', import.meta.url));
rmSync(output, { recursive: true, force: true });
mkdirSync(extension, { recursive: true });
const browser = spawnSync(process.execPath, [
  'node_modules/vite/bin/vite.js', 'build', '--config', 'vite.canvas.config.ts',
], { cwd: root, stdio: 'inherit' });
if (browser.status !== 0) process.exit(browser.status ?? 1);
renameSync(new URL('dist/canvas-browser/canvas.html', import.meta.url),
  new URL('dist/canvas-browser/index.html', import.meta.url));
const result = await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['src/canvas/extension.ts'], outfile: 'dist/extension.mjs',
  platform: 'node', format: 'esm', bundle: true, metafile: true,
  external: ['@github/copilot-sdk/extension'],
  alias: { pngjs: createRequire(import.meta.url).resolve('pngjs') },
  // ws uses require() for Node builtins; keep its pure-JS fallbacks, not native addons.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  define: { 'process.env.WS_NO_BUFFER_UTIL': 'true', 'process.env.WS_NO_UTF_8_VALIDATE': 'true' },
});
rmSync(new URL('dist/assets', import.meta.url), { recursive: true, force: true });
cpSync(new URL('../webview-ui/public/assets', import.meta.url),
  new URL('dist/assets', import.meta.url), { recursive: true });
for (const name of ['extension.mjs', 'canvas-browser', 'assets']) {
  cpSync(new URL(`dist/${name}`, import.meta.url), join(extension, name), { recursive: true });
}
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const inputs = [...Object.keys(result.metafile.inputs).map(path => resolve(repo, 'standalone', path)),
  ...json(join(extension, 'canvas-browser/build-inputs.json'))
    .map(path => path.split('?')[0]).filter(path => !path.startsWith('\0') && existsSync(path))];
rmSync(join(extension, 'canvas-browser/build-inputs.json'));
rmSync(new URL('dist/canvas-browser/build-inputs.json', import.meta.url));
const dependencies = new Map();
for (const input of inputs.filter(path => path.includes('node_modules'))) {
  let directory = dirname(input);
  while (!existsSync(join(directory, 'package.json')) && directory !== dirname(directory)) directory = dirname(directory);
  const pkg = json(join(directory, 'package.json'));
  const key = `${pkg.name}@${pkg.version}`;
  if (dependencies.has(key)) continue;
  const license = join(directory, 'LICENSE');
  if (!pkg.license || !existsSync(license)) throw new Error(`Missing dependency license: ${key}`);
  const licensePath = `licenses/${pkg.name.replaceAll('/', '-')}-${pkg.version}.txt`;
  mkdirSync(join(output, 'licenses'), { recursive: true });
  cpSync(license, join(output, licensePath));
  dependencies.set(key, { name: pkg.name, version: pkg.version, license: pkg.license, licensePath });
}
const pkg = json(join(repo, 'package.json'));
const manifest = {
  $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
  name: 'squad-pod', version: '0.1.0', description: pkg.description,
  author: pkg.author, homepage: pkg.homepage, repository: pkg.repository.url, license: pkg.license,
  keywords: [...pkg.keywords, 'canvas'],
  extensions: { 'com.github.copilot': { logo: 'assets/preview.png' } },
};
mkdirSync(join(output, 'assets'), { recursive: true });
cpSync(join(repo, 'assets/squad-pod-icon.png'), join(output, 'assets/preview.png'));
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) cpSync(join(repo, name), join(output, name));
writeFileSync(join(output, 'THIRD_PARTY_NOTICES.md'),
  readFileSync(join(output, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  + '\n## Canvas plugin distribution\n\nThe Canvas plugin bundles pngjs, ws, React, React DOM and Scheduler. '
  + 'Their exact versions and complete licenses are in `checksums.json` and `licenses/`. '
  + 'The host provides the experimental Copilot SDK; it is not redistributed.\n');
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot determine source provenance');
  return result.stdout.trim();
};
const metadata = {
  sourceCommit: git('rev-parse', 'HEAD'), sourceDirty: Boolean(git('status', '--porcelain', '--untracked-files=normal')),
  sdk: { name: '@github/copilot-sdk/extension', contract: '1.0.28', providedBy: 'host' },
  inputs: inputs.map(path => relative(repo, path).replaceAll('\\', '/')).sort(),
  imports: Object.values(result.metafile.outputs).flatMap(value => value.imports),
  dependencies: [...dependencies.values()].sort((a, b) => a.name.localeCompare(b.name)),
  extensionSha256: createHash('sha256').update(readFileSync(join(extension, 'extension.mjs'))).digest('hex'),
};
writeFileSync(join(output, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(output, 'build-info.json'), JSON.stringify(metadata, null, 2) + '\n');
const { verifyCanvasPlugin } = await import('../scripts/verify-canvas-plugin.mjs');
await verifyCanvasPlugin(output);
