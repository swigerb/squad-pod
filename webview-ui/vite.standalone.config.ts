import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: '../standalone/dist/browser',
    emptyOutDir: true,
    rollupOptions: { input: 'standalone.html' },
  },
});
