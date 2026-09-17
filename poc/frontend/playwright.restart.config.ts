/**
 * Dedicated crash/restart harness for P7-09.
 *
 * Unlike the regular suite, the test owns the backend process itself. Do not
 * run this beside another backend on port 3000.
 */
import { defineConfig, devices } from '@playwright/test';
import { e2eConfig, frontendServerEnv } from './e2e/support/env';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: /backend-restart\.spec\.ts$/,
  // A Vite dev szerver a frontend gyökerét figyeli. A trace/video írása ne
  // váltson ki oldal-reloadot egy folyamatban lévő PKCE redirect közben.
  outputDir: '/tmp/tv2-poc-playwright-restart-artifacts',
  fullyParallel: false,
  workers: 1,
  timeout: 360_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: '/tmp/tv2-poc-playwright-restart-report/html', open: 'never' }],
    ['json', { outputFile: '/tmp/tv2-poc-playwright-restart-report/results.json' }],
  ],
  use: {
    baseURL: e2eConfig.baseUrl,
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    locale: 'hu-HU',
    timezoneId: 'Europe/Budapest',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium-1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
    url: e2eConfig.baseUrl,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: frontendServerEnv(),
  },
});
