import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'tests/fixtures/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
  },
});
