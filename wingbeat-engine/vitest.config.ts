import { defineConfig } from 'vitest/config';

// Pure-logic tests run in plain Node: the router, the arbiter, the engine's
// thresholds, preset validation/migration and the wire validators. Nothing
// here needs a DOM; the one browser global the code touches at import time
// (localStorage) is polyfilled in src/test/setup.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
