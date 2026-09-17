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
    setupFiles: ['./src/test/setup.ts'],
  },
});

