import { build } from 'esbuild';
import { cpSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const browser = spawnSync(process.execPath, [
  'node_modules/vite/bin/vite.js', 'build', '--config', 'vite.standalone.config.ts',
], { cwd: `${root}webview-ui`, stdio: 'inherit' });
if (browser.status !== 0) process.exit(browser.status ?? 1);
renameSync(new URL('dist/browser/standalone.html', import.meta.url), new URL('dist/browser/index.html', import.meta.url));
await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['src/cli.ts'], outfile: 'dist/cli.mjs', platform: 'node',
  format: 'esm', bundle: true, packages: 'external',
  banner: { js: '#!/usr/bin/env node' },
});
await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['src/fixture.ts', 'src/ptyHost.ts'], outdir: 'dist', outExtension: { '.js': '.mjs' }, platform: 'node',
  format: 'esm', bundle: true, packages: 'external',
});
rmSync(new URL('dist/assets', import.meta.url), { recursive: true, force: true });
mkdirSync(new URL('dist/assets', import.meta.url), { recursive: true });
cpSync(new URL('../webview-ui/public/assets', import.meta.url), new URL('dist/assets', import.meta.url), { recursive: true });
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  cpSync(new URL(`../${name}`, import.meta.url), new URL(name, import.meta.url));
}
mkdirSync(new URL('dist/terminal-licenses', import.meta.url), { recursive: true });
for (const [component, filename] of [['xterm', 'xterm-LICENSE'], ['addon-fit', 'addon-fit-LICENSE']]) {
  cpSync(new URL(`../webview-ui/node_modules/@xterm/${component}/LICENSE`, import.meta.url),
    new URL(`dist/terminal-licenses/${filename}`, import.meta.url));
}
