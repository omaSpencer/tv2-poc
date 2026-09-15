import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest 4 / Vite 8 use Oxc. Legacy TS decorators must be configured here or
  // parameter decorators in Nest providers under test/ fail to parse.
  oxc: {
    decorator: {
      legacy: true,
      emitDecoratorMetadata: true,
    },
  },
  test: {
    // Integration files share one disposable PostgreSQL database and truncate
    // between cases, so they must not run at the same time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['test/**/*.test.ts'],
  },
});
