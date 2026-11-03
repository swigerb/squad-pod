import { build } from 'esbuild';
import { cpSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../webview-ui', import.meta.url));
const browser = spawnSync(process.execPath, [
  'node_modules/vite/bin/vite.js', 'build', '--config', 'vite.canvas.config.ts',
], { cwd: root, stdio: 'inherit' });
if (browser.status !== 0) process.exit(browser.status ?? 1);
renameSync(new URL('dist/canvas-browser/canvas.html', import.meta.url),
  new URL('dist/canvas-browser/index.html', import.meta.url));
await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['src/canvas/extension.ts'], outfile: 'dist/extension.mjs',
  platform: 'node', format: 'esm', bundle: true, packages: 'external',
  external: ['@github/copilot-sdk/extension'],
});
rmSync(new URL('dist/assets', import.meta.url), { recursive: true, force: true });
cpSync(new URL('../webview-ui/public/assets', import.meta.url),
  new URL('dist/assets', import.meta.url), { recursive: true });
