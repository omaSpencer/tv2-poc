/** Phase 6 – declarative runner on the real PKCE/full-stack environment. */
import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../support/auth';
import {
  dockerControlAvailable, restoreSearchInstances, startSearchInstance, stopSearchInstance,
} from '../support/docker';

async function selectScenario(page: Page, id: string) {
  await page.getByRole('button', { name: new RegExp(`^${id} ·`) }).click();
}

test.describe('Phase 6 scenario runner', () => {
  test('S01 végigfut, minden egzakt assertion PASS és a JSON evidence redaktált', async ({ page }) => {
    test.setTimeout(180_000);
    await loginAs(page, 'poc-publisher', { startPath: '/demo', expectedPath: '/demo' });

    await selectScenario(page, 'S01');
    await page.getByRole('button', { name: 'Új futás indítása' }).click();
    await expect(page.getByText('Sikeres', { exact: true })).toBeVisible({ timeout: 120_000 });

    const timeline = page.getByRole('heading', { name: 'Lépés-idővonal' }).locator('xpath=ancestor::section[1]');
    await expect(timeline.locator('.step-passed')).toHaveCount(14);
    await expect(timeline.locator('.step-failed')).toHaveCount(0);
    await expect(timeline).toContainText('published v6');
    await expect(timeline).toContainText('audit: published:6');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSON letöltése' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let json = '';
    for await (const chunk of stream) json += chunk.toString();
    expect(json).toContain('"id": "S01"');
    expect(json).toContain('"status": "passed"');
    expect(json).not.toMatch(/accessToken|refreshToken|authorization|subjectHash|actorSub|Bearer /i);
  });
});

test.describe('Phase 6 S04 outage @phase6-outage', () => {
  const control = dockerControlAvailable();
  test.skip(!control.ok, control.reason);

  test.afterEach(() => {
    restoreSearchInstances();
  });

  test('a manuális fault injection checkpointokon át fallbacket, teljes kiesést és recoveryt bizonyít', async ({ page }) => {
    test.setTimeout(300_000);
    await loginAs(page, 'poc-publisher', { startPath: '/demo', expectedPath: '/demo' });
    await selectScenario(page, 'S04');
    await page.getByRole('button', { name: 'Új futás indítása' }).click();
    await expect(page.getByRole('heading', { name: 'A index leállítása' })).toBeVisible({ timeout: 60_000 });

    stopSearchInstance('a');
    await page.getByRole('button', { name: 'Elvégeztem, ellenőrzés és folytatás' }).click();
    await expect(page.getByRole('heading', { name: 'B index leállítása' })).toBeVisible({ timeout: 90_000 });

    stopSearchInstance('b');
    await page.getByRole('button', { name: 'Elvégeztem, ellenőrzés és folytatás' }).click();
    await expect(page.getByRole('heading', { name: 'Indexek visszaállítása' })).toBeVisible({ timeout: 90_000 });

    startSearchInstance('a');
    startSearchInstance('b');
    await page.getByRole('button', { name: 'Elvégeztem, ellenőrzés és folytatás' }).click();
    await expect(page.getByText('Sikeres', { exact: true })).toBeVisible({ timeout: 150_000 });

    const timeline = page.getByRole('heading', { name: 'Lépés-idővonal' }).locator('xpath=ancestor::section[1]');
    await expect(timeline.locator('.step-passed')).toHaveCount(9);
    await expect(timeline).toContainText('HTTP 503');
    await expect(timeline).toContainText('search_unavailable');
  });
});
