import { defineConfig } from 'vitest/config';

/** Opt-in disposable Cloudflare suite — never part of pnpm verify. */
export default defineConfig({
  test: {
    include: ['tests/e2e/cloudflare.test.ts'],
    testTimeout: 600_000,
  },
});
