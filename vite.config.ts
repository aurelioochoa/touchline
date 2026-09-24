import { defineConfig } from 'vite';

// base: './' is load-bearing — the bundle must run unmodified under /g/touchline/
// on the site as well as at the root in dev (design doc §12).
export default defineConfig({
  base: './',
  server: {
    // 5173-5178 are taken by the other games in this repo; glasshold and starhaven
    // already collide on 5175, so do not add a third to that pile.
    port: 5179,
    host: true,
  },
  build: {
    target: 'es2020',
    // Three.js alone is ~600kB minified; the ~2 MiB total budget is the real gate.
    chunkSizeWarningLimit: 2000,
  },
});
