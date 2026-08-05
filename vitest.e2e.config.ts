import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/smoke.test.ts'],
    testTimeout: 120_000,
  },
});
