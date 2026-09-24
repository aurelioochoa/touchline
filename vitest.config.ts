import { defineConfig } from 'vitest/config';

// The simulation under src/sim/ imports no rendering library, so the tests that
// matter need no DOM (design doc §12: sim is pure, rendering is a client).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // A full match is ~58,000 ticks of simulation and the plausibility tests run a dozen
    // of them, so the 5s default fails on work that is doing exactly what it should.
    testTimeout: 300_000,
  },
});
