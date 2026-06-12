import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// `base` is overridden per-deploy by the Pages workflow via `--base=/<repo>/<slug>/`
// so assets resolve correctly inside each branch subfolder. Local dev stays at '/'.
// Two entry points ship in one static bundle: index.html (lean canvas viewer) and
// bgio.html (boardgame.io React frontend with the Debug panel).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        bgio: resolve(__dirname, 'bgio.html'),
      },
    },
  },
});
