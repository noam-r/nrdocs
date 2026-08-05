import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

/** Opt-in disposable Cloudflare suite — never part of pnpm verify. */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@nrdocs/persistence/sqlite',
        replacement: path.join(root, 'packages/persistence/src/sqlite-adapter.ts'),
      },
      {
        find: '@nrdocs/persistence',
        replacement: path.join(root, 'packages/persistence/src/index.ts'),
      },
      {
        find: '@nrdocs/contracts',
        replacement: path.join(root, 'packages/contracts/src/index.ts'),
      },
      {
        find: '@nrdocs/renderer',
        replacement: path.join(root, 'packages/renderer/src/index.ts'),
      },
    ],
  },
  test: {
    include: ['tests/e2e/cloudflare.test.ts'],
    testTimeout: 600_000,
  },
});
