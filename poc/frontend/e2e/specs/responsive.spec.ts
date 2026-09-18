/**
 * P7-12 – 360/768/1280 px viewport smoke a kritikus képernyőkön.
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

test('a publikus katalógus a támogatott viewporton olvasható', async ({ page }) => {
  await page.goto('/catalog/search');
  await expect(page.getByRole('heading', { level: 2, name: 'Keress a műsorok között' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Keresett kifejezés' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a tartalomlista a viewporthoz illő nézetet használja', async ({ page }) => {
  await loginAs(page, 'poc-publisher');
  await createDraft(page, publishableDraft(uniqueTitle('E2E mobil')));

  await page.goto('/contents');
  await expect(page.getByRole('heading', { level: 2, name: 'Tartalmak' })).toBeVisible();

  const cards = page.locator('.content-card-list');
  const table = page.locator('.content-table');
  if ((page.viewportSize()?.width ?? 0) <= 720) {
    await expect(cards).toBeVisible();
    await expect(table).toBeHidden();
  } else {
    await expect(cards).toBeHidden();
    await expect(table).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);
});

test('az operations dashboard a támogatott viewporton sem csúszik ki', async ({ page }) => {
  await loginAs(page, 'poc-publisher');
  await page.goto('/operations');
  await expect(page.getByRole('heading', { level: 2, name: 'Operációs dashboard' })).toBeVisible();
  const cards = page.locator('.operations-consumer-cards');
  const table = page.locator('.operations-consumer-table');
  if ((page.viewportSize()?.width ?? 0) <= 720) {
    await expect(cards).toBeVisible();
    await expect(table).toBeHidden();
  } else {
    await expect(cards).toBeHidden();
    await expect(table).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);
});

test('a scenario workspace hosszú tartalommal sem okoz vízszintes túlcsordulást', async ({ page }) => {
  await loginAs(page, 'poc-publisher', { startPath: '/demo', expectedPath: '/demo' });
  await expect(page.getByRole('heading', { name: 'Forgatókönyv-futtató és bizonyítéktér' })).toBeVisible();
  await expect(page.getByRole('button', { name: /S04 · Kereső fallback és kiesés/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
