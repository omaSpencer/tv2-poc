import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

export type QuarantineFixture = {
  sequence: number;
  quarantineId: string;
  originalEventId: string;
  originalSequence: number;
};

/** Publikált tartalomhoz érvényes, payloadmentes DLQ-locatort készít. */
export function seedQuarantine(contentId: string): QuarantineFixture {
  const backendRoot = resolve(process.cwd(), '..', 'backend');
  const output = execFileSync(
    process.execPath,
    [resolve(backendRoot, 'scripts/e2e-seed-quarantine.mjs'), `--content-id=${contentId}`],
    {
      cwd: backendRoot,
      env: { ...process.env, ENV_FILE: resolve(backendRoot, '.env.e2e') },
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();
  const fixture = JSON.parse(output) as Partial<QuarantineFixture>;
  if (
    !Number.isSafeInteger(fixture.sequence)
    || !Number.isSafeInteger(fixture.originalSequence)
    || typeof fixture.quarantineId !== 'string'
    || typeof fixture.originalEventId !== 'string'
  ) {
    throw new Error('A karantén-fixture nem adott vissza érvényes, biztonságos metaadatot.');
  }
  return fixture as QuarantineFixture;
}

export async function waitForTerminalStatus(status: Locator, timeout = 180_000): Promise<string> {
  await expect(status).toContainText(/succeeded|failed|Sikeres|Sikertelen/i, { timeout });
  const text = (await status.innerText()).trim();
  if (/Sikertelen|failed/i.test(text)) return 'failed';
  if (/Sikeres|succeeded/i.test(text)) return 'succeeded';
  throw new Error(`Ismeretlen terminális operátori állapot: ${text}`);
}

export function operatorStatus(page: Page, panelHeading: string): Locator {
  return page.getByRole('heading', { name: panelHeading }).locator('xpath=ancestor::section[1]').locator('.ops-status');
}
