import { defineConfig } from 'vite';

// `base` is overridden per-deploy by the Pages workflow via `--base=/<repo>/<slug>/`
// so assets resolve correctly inside each branch subfolder. Local dev stays at '/'.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: { target: 'es2022' },
});
