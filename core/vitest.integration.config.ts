// `npm run test:integration`: the tests that need anvil and the real Payments.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['src/anvil.setup.ts'],
    // Every file shares the one anvil the setup starts, and each test reverts it to a snapshot:
    // two files at once would revert each other's chain.
    fileParallelism: false,
  },
});
