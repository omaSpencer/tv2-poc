/** P7-09 – a futó operátori művelet valós backend-crash utáni recoveryje. */
import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../support/auth';
import { crashOwnedBackend, startOwnedBackend, stopOwnedBackend } from '../support/backend-process';
import { waitForTerminalStatus } from '../support/operator-actions';

const enabled = process.env.E2E_BACKEND_PROCESS_CONTROL === 'true';

async function actionState(page: Page, runId: string, token: string) {
  const response = await page.request.get(`/api/admin/search/reindex-runs/${runId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok()) throw new Error(`A reindex állapota nem olvasható: HTTP ${response.status()}`);
  return response.json() as Promise<{ state: string; errorCode: string | null }>;
}

async function waitForState(page: Page, runId: string, token: string, expected: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await actionState(page, runId, token);
    if (state.state === expected) return state;
    await page.waitForTimeout(100);
  }
  throw new Error(`A reindex nem érte el a(z) ${expected} állapotot ${timeoutMs} ms alatt.`);
}

test.describe('Backend restart recovery @backend-restart', () => {
  test.skip(!enabled, 'A teszt csak az E2E_BACKEND_PROCESS_CONTROL=true dedikált hámban birtokolhatja a backend folyamatot.');

  test.beforeAll(async () => {
    await startOwnedBackend();
  });

  test.afterAll(async () => {
    await stopOwnedBackend();
  });

  test('a megszakadt futás aborted lesz, utána új teljes reindex sikeresen indul', async ({ page }) => {
    const token = await loginAs(page, 'poc-publisher');
    await page.goto('/operations/reindex');
    await expect(page.getByText('Akadályok: nincs')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('textbox', { name: 'Indoklás' }).fill('Backend crash recovery ellenőrzése');
    await page.getByRole('button', { name: 'Teljes reindex indítása' }).click();
    await page.waitForURL(/\/operations\/reindex\/[0-9a-fA-F-]{36}$/);
    const interruptedRunId = page.url().split('/').at(-1)!;
    await waitForState(page, interruptedRunId, token, 'running', 30_000);

    await crashOwnedBackend();
    // A production stale threshold 30 s. A valódi crash nem írhat terminális
    // állapotot, ezért az új folyamat csak e határ után veheti recoverybe.
    await page.waitForTimeout(31_000);
    await startOwnedBackend();

    const recovered = await waitForState(page, interruptedRunId, token, 'failed', 30_000);
    expect(recovered.errorCode).toBe('aborted');
    await page.reload();
    expect(await waitForTerminalStatus(page.locator('.operator-action-panel .ops-status'))).toBe('failed');
    await expect(page.getByText('Hibakód').locator('xpath=following-sibling::dd[1]')).toHaveText('aborted');

    await page.getByRole('link', { name: 'Új teljes futás' }).click();
    await expect(page.getByText('Akadályok: nincs')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('textbox', { name: 'Indoklás' }).fill('Recovery utáni teljes újrafuttatás');
    await page.getByRole('button', { name: 'Teljes reindex indítása' }).click();
    await page.waitForURL(/\/operations\/reindex\/[0-9a-fA-F-]{36}$/);
    const terminal = await waitForTerminalStatus(page.locator('.operator-action-panel .ops-status'), 240_000);
    expect(terminal).toContain('succeeded');
  });
});
