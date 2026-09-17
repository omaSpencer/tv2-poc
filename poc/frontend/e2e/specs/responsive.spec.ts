/**
 * P7-12 – 360 px viewport smoke a Release A képernyőin.
 *
 * Lefedett kötelező ellenőrzés (TODO Fázis 2 és 4):
 *  - 360 px-en kártyanézet jelenik meg táblázat helyett;
 *  - nincs vízszintes görgetés a kritikus oldalakon.
 */
import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../support/auth';
import { createDraft, publishableDraft, uniqueTitle } from '../support/content';

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  // 1 px tűrés a kerekítésre.
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test('a publikus katalógus 360 px-en is olvasható', async ({ page }) => {
  await page.goto('/catalog/search');
  await expect(page.getByRole('heading', { level: 2, name: 'Keress a műsorok között' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Keresett kifejezés' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a tartalomlista 360 px-en kártyanézetre vált', async ({ page }) => {
  await loginAs(page, 'poc-publisher');
  await createDraft(page, publishableDraft(uniqueTitle('E2E mobil')));

  await page.goto('/contents');
  await expect(page.getByRole('heading', { level: 2, name: 'Tartalmak' })).toBeVisible();

  const cards = page.locator('.content-card-list');
  const table = page.locator('.content-table');
  await expect(cards).toBeVisible();
  await expect(table).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

test('az operations dashboard 360 px-en sem csúszik ki', async ({ page }) => {
  await loginAs(page, 'poc-publisher');
  await page.goto('/operations');
  await expect(page.getByRole('heading', { level: 2, name: 'Operációs dashboard' })).toBeVisible();
  await expect(page.locator('.operations-consumer-cards')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
