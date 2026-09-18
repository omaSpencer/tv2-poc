import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // A Playwright E2E specek nem a Vitest futtatójába valók.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    clearMocks: true,
    restoreMocks: true,
    // Coverage instrumentation plus jsdom setup can push heavy component
    // tests past Vitest's 5s default without a real hang. Limit workers so
    // 50+ jsdom environments do not starve waitFor/Query notifications.
    testTimeout: 15_000,
    maxWorkers: 4,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/test/**',
        // Generated OpenAPI contract; not hand-maintained production logic.
        'src/api/generated/**',
        // Ambient type-only declarations, no runtime.
        'src/vite-env.d.ts',
        // Bootstrap entry: mounts React or the silent iframe handler. The
        // callback helper and auth state machine are covered in oidc/AuthProvider.
        'src/main.tsx',
      ],
      thresholds: {
        // Measured 2026-09-18 on Node 24.20.0: 71.03 / 68.36 / 70.48 / 73.43.
        // Rounded down with a 2-point stability margin. Do not auto-update.
        statements: 69,
        branches: 66,
        functions: 68,
        lines: 71,
      },
    },
  },
});
