/**
 * P7-04 – full-stack böngészős E2E konfiguráció (Release A scope).
 *
 * Előfeltétel: futó `docker compose --profile full` stack (PostgreSQL, NATS,
 * Meilisearch A/B, Authentik) és futó backend. A Vite dev szervert a Playwright
 * indítja, mert az Authentik blueprint strict redirectje a 127.0.0.1:5173
 * originre szól. Runbook: `e2e/README.md`.
 */
import { defineConfig, devices } from '@playwright/test';
import { e2eConfig, frontendServerEnv } from './e2e/support/env';

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e/specs',
  outputDir: './e2e/.artifacts',
  globalSetup: './e2e/support/global-setup.ts',
  // A suite közös backendet és közös Authentik munkamenetet használ; a
  // determinisztikus sorrend fontosabb, mint a nyers sebesség.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e/.report/html', open: 'never' }],
    ['json', { outputFile: 'e2e/.report/results.json' }],
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
  projects: [
    {
      name: 'chromium-1280',
      testIgnore: /responsive\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'chromium-360',
      testMatch: /responsive\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 } },
    },
    {
      name: 'chromium-768',
      testMatch: /responsive\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'chromium-responsive-1280',
      testMatch: /responsive\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox-smoke',
      testMatch: /cross-browser\.spec\.ts$/,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit-smoke',
      testMatch: /cross-browser\.spec\.ts$/,
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: e2eConfig.startFrontend
    ? {
        // A `--host 127.0.0.1` kötelező: a default `localhost` bind macOS-en
        // gyakran csak ::1-re áll fel, a baseURL és az Authentik strict redirect
        // viszont a 127.0.0.1 IPv4 címre szól – ilyenkor a webServer vár, majd
        // időtúllépéssel elszáll.
        command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
        url: e2eConfig.baseUrl,
        reuseExistingServer: !isCi,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: frontendServerEnv(),
      }
    : undefined,
});
