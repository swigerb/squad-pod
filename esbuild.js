const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const copyAssetsPlugin = {
  name: 'copy-assets',
  setup(build) {
    build.onEnd(() => {
      const sourceDir = path.join(__dirname, 'webview-ui', 'public', 'assets');
      const targetDir = path.join(__dirname, 'dist', 'assets');
      
      if (fs.existsSync(sourceDir)) {
        fs.cpSync(sourceDir, targetDir, { recursive: true });
        console.log('✓ Copied webview assets to dist/assets');
      }
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: true,
    sourcesContent: !production,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [
      copyAssetsPlugin,
      {
        name: 'esbuild-problem-matcher',
        setup(build) {
          build.onStart(() => {
            console.log('[watch] build started');
          });
          build.onEnd(result => {
            result.errors.forEach(({ text, location }) => {
              console.error(`✘ [ERROR] ${text}`);
              console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log('[watch] build finished');
          });
        },
      },
    ],
  });

  if (watch) {
    await ctx.watch();
    console.log('👀 Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('✓ Build complete');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
