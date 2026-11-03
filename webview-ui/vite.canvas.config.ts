import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), {
    name: 'canvas-input-inventory',
    generateBundle(_options, bundle) {
      this.emitFile({
        type: 'asset', fileName: 'build-inputs.json',
        source: JSON.stringify(Object.values(bundle).flatMap(chunk =>
          chunk.type === 'chunk' ? Object.keys(chunk.modules) : [])),
      });
    },
  }],
  base: './',
  publicDir: false,
  define: { acquireVsCodeApi: 'undefined' },
  build: {
    outDir: '../standalone/dist/canvas-browser',
    emptyOutDir: true,
    rollupOptions: { input: 'canvas.html' },
  },
});
