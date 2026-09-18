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
    // A developer's runtime .env may enable every integration. Test workers
    // read an intentionally empty env file; individual harnesses install the
    // database and adapter configuration they own, while service URLs remain
    // explicit opt-in inputs.
    env: { ENV_FILE: 'test/test.env' },
    // Integration files share one disposable PostgreSQL database and truncate
    // between cases, so they must not run at the same time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        statements: 79,
        branches: 70,
        functions: 78,
        lines: 82,
      },
    },
  },
});
