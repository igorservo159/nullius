// `npm test`: the fast tests, with no node and no contract. The integration tests run apart.

import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '**/*.integration.test.ts'] },
});
