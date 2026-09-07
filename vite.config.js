import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src',
  publicDir: resolve(__dirname, 'src/public'),
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        popup: resolve(__dirname, 'src/popup.html'),
        region: resolve(__dirname, 'src/region.html'),
        status: resolve(__dirname, 'src/status.html'),
        dictionary: resolve(__dirname, 'src/dictionary.html'),
        ask: resolve(__dirname, 'src/ask.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
