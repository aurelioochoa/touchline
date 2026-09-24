// Run a TypeScript module in node, using Vite's own SSR loader.
//
//   node scripts/run-ts.mjs src/sim/match/calibrate.ts [args...]
//
// The dev harnesses (calibration, balance sweeps, the headless match runner) are written
// in TypeScript against the same sources the game uses, so they cannot drift from it. This
// is the smallest way to run those without adding a dependency: Vite is already here, and
// its SSR loader compiles on demand with the project's own config.
import { createServer } from 'vite';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const entry = process.argv[2];
if (!entry) {
  console.error('usage: node scripts/run-ts.mjs <entry.ts> [args...]');
  process.exit(2);
}

const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'warn',
});

try {
  const mod = await server.ssrLoadModule('/' + entry.replace(/^\.?\//, ''));
  const main = mod.default ?? mod.main;
  if (typeof main !== 'function') {
    throw new Error(`${entry} must export a default function`);
  }
  await main(process.argv.slice(3));
} finally {
  await server.close();
}
// Vite's SSR server keeps handles alive; nothing else is pending by here.
process.exit(0);
