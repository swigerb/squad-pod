import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  define: { acquireVsCodeApi: 'undefined' },
  build: {
    outDir: '../standalone/dist/canvas-browser',
    emptyOutDir: true,
    rollupOptions: { input: 'canvas.html' },
  },
});
