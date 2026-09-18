/**
 * P7-09 – Phase 5 operator actions on the real stack.
 *
 * The browser drives the production UI and Authentik session. Direct HTTP is
 * used only for the two admission invariants that cannot be expressed through
 * a single form (same-key replay and a second concurrent reindex request).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import {
  accessTokenFromSession,
  createDraft,
  publishableDraft,
  publishFromDetail,
  uniqueTitle,
} from '../support/content';
import {
  dockerControlAvailable,
  restoreSearchInstances,
  stopSearchInstance,
} from '../support/docker';
import { operatorStatus, seedQuarantine, waitForTerminalStatus } from '../support/operator-actions';

test.describe.serial('Operátori műveletek', () => {
  test('a reindex idempotens, kizárja a párhuzamos futást, reload után is követhető és célba ér', async ({ page }) => {
    test.setTimeout(300_000);
    await loginAs(page, 'poc-publisher');
    await page.goto('/operations/reindex');

    await expect(page.getByRole('heading', { level: 2, name: 'Teljes keresőindex-újraépítés' })).toBeVisible();
    await expect(page.getByText('Akadályok: nincs')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('textbox', { name: 'Indoklás' }).fill('Phase 5 teljes stack ellenőrzés');

    const submitted = page.waitForRequest(request => (
      request.method() === 'POST' && request.url().endsWith('/api/admin/search/reindex-runs')
    ));
    await page.getByRole('button', { name: 'Teljes reindex indítása' }).click();
    const originalRequest = await submitted;
    await page.waitForURL(/\/operations\/reindex\/[0-9a-fA-F-]{36}$/);
    const runId = page.url().split('/').at(-1)!;

    const token = await accessTokenFromSession(page);
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    };
    const originalKey = originalRequest.headers()['idempotency-key'];
    const originalBody = originalRequest.postDataJSON() as Record<string, unknown>;
    expect(originalKey).toBeTruthy();

    const idempotentReplay = await page.request.post('/api/admin/search/reindex-runs', {
      headers: { ...headers, 'idempotency-key': originalKey },
      data: originalBody,
    });
    expect(idempotentReplay.status()).toBe(202);
    expect((await idempotentReplay.json() as { id: string }).id).toBe(runId);

    const parallel = await page.request.post('/api/admin/search/reindex-runs', {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data: {
        index: originalBody.index === 'a' ? 'b' : 'a',
        reason: 'Párhuzamos reindex elutasításának ellenőrzése',
        allowSearchOutage: false,
      },
    });
    expect(parallel.status()).toBe(409);
    expect((await parallel.json() as { code: string }).code).toBe('reindex_already_running');

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/operations/reindex/${runId}$`));
    await expect(page.getByRole('heading', { level: 2, name: 'Reindex folyamat' })).toBeVisible();
    const terminal = await waitForTerminalStatus(page.locator('.operator-action-panel .ops-status'), 240_000);
    expect(terminal).toContain('succeeded');
    await expect(page.locator('.phase-stepper [aria-current="step"]')).toHaveText('ready');
  });

  test('a tartalomjavítás mindkét indexen lefut, és csak biztonságos eredményt mutat', async ({ page }) => {
    await loginAs(page, 'poc-publisher');
    const contentId = await createDraft(page, publishableDraft(uniqueTitle('E2E javítás')));

    await page.goto('/operations/repair');
    await page.getByRole('textbox', { name: 'Tartalom UUID' }).fill(contentId);
    await expect(page.getByRole('combobox', { name: 'Célindex' })).toHaveValue('both');
    await page.getByRole('textbox', { name: 'Indoklás' }).fill('Mindkét index konvergenciájának ellenőrzése');
    await page.getByRole('button', { name: 'Javítás indítása' }).click();

    const terminal = await waitForTerminalStatus(operatorStatus(page, 'Javítás állapota'));
    expect(terminal).toContain('succeeded');
    const result = page.getByText('Biztonságos technikai eredmény');
    await result.click();
    const panel = page.getByRole('heading', { name: 'Javítás állapota' }).locator('xpath=ancestor::section[1]');
    await expect(panel).toContainText('"alias": "a"');
    await expect(panel).toContainText('"alias": "b"');
    await expect(panel).not.toContainText('summary');
    await expect(panel).not.toContainText('mediaAssetId');
    await expect(panel).not.toContainText('apiKey');
  });

  test('a karantén inspect payloadmentes, a reason kötelező, a replay tartósan célba ér', async ({ page }) => {
    test.setTimeout(180_000);
    await loginAs(page, 'poc-publisher');
    const title = uniqueTitle('E2E karantén');
    const draft = publishableDraft(title);
    const contentId = await createDraft(page, draft);
    await publishFromDetail(page);
    const fixture = seedQuarantine(contentId);

    await page.goto('/operations/quarantine');
    await expect(page.getByRole('heading', { level: 2, name: 'Karantén' })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`^#${fixture.sequence} ·`) }).click();
    const detail = page.getByRole('heading', { name: `Karantén #${fixture.sequence}` }).locator('xpath=ancestor::section[1]');
    await expect(detail).toContainText('érvényes');
    await expect(detail).toContainText(fixture.originalEventId);
    await expect(detail).toContainText(String(fixture.originalSequence));
    await expect(detail).not.toContainText(title);
    await expect(detail).not.toContainText(draft.summary);
    await expect(detail).not.toContainText(draft.mediaAssetId);

    const replay = page.getByRole('button', { name: 'Replay indítása' });
    await expect(replay).toBeDisabled();
    await page.getByRole('textbox', { name: 'Indoklás' }).fill('Mérgezett esemény kontrollált újrajátszása');
    await expect(replay).toBeEnabled();
    await replay.click();

    const terminal = await waitForTerminalStatus(operatorStatus(page, 'Replay állapota'));
    expect(terminal).toContain('succeeded');
    await page.getByText('Biztonságos technikai eredmény').click();
    const resultPanel = page.getByRole('heading', { name: 'Replay állapota' }).locator('xpath=ancestor::section[1]');
    await expect(resultPanel).toContainText(fixture.quarantineId);
    await expect(resultPanel).toContainText(`"sequence": ${fixture.sequence}`);
    await expect(resultPanel).not.toContainText(title);
    await expect(resultPanel).not.toContainText(draft.summary);

    await page.reload();
    await expect(page.getByRole('button', { name: new RegExp(`^#${fixture.sequence} ·`) })).toBeVisible();
  });
});

test.describe('Reindex kiesési engedély @operator-outage', () => {
  const control = dockerControlAvailable();
  test.skip(!control.ok, control.reason);

  test.afterEach(() => {
    restoreSearchInstances();
  });

  test('normál módban blokkol, explicit opt-innal és pontos célnévvel lefut', async ({ page }) => {
    test.setTimeout(300_000);
    await loginAs(page, 'poc-publisher');
    stopSearchInstance('b');
    await page.goto('/operations/reindex');

    await expect(page.getByText(/Akadályok: .*másik index nem elérhető/)).toBeVisible({ timeout: 60_000 });
    const submit = page.getByRole('button', { name: 'Teljes reindex indítása' });
    await page.getByRole('textbox', { name: 'Indoklás' }).fill('Kontrollált reindex a tartalék index kiesése mellett');
    await expect(submit).toBeDisabled();

    await page.getByRole('checkbox', { name: /Keresési kiesés engedélyezése/ }).check();
    const confirmation = page.getByRole('textbox', { name: /Pontos adatbázisnév megerősítése:/ });
    await expect(confirmation).toBeVisible({ timeout: 30_000 });
    const confirmationLabel = confirmation.locator('xpath=ancestor::label[1]');
    const exactTarget = (await confirmationLabel.locator('strong.mono').innerText()).trim();
    await confirmation.fill(`${exactTarget}-hibás`);
    await expect(submit).toBeDisabled();
    await confirmation.fill(exactTarget);
    await expect(submit).toBeEnabled();
    await submit.click();

    await page.waitForURL(/\/operations\/reindex\/[0-9a-fA-F-]{36}$/);
    const terminal = await waitForTerminalStatus(page.locator('.operator-action-panel .ops-status'), 240_000);
    expect(terminal).toContain('succeeded');
  });
});
