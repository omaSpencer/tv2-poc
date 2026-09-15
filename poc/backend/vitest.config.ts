import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration files share one disposable PostgreSQL database and truncate
    // between cases, so they must not run at the same time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['test/**/*.test.ts'],
  },
});
