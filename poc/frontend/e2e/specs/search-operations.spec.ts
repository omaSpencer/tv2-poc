/**
 * E2E-04 / P7-08 – publikus katalógus és operations dashboard valódi stacken.
 *
 * Lefedett kötelező ellenőrzések (TODO Fázis 3 és 4):
 *  - anonymous keresés → szűrés → lapozás → detail → vissza;
 *  - a query, category, limit és offset bookmarkolható URL-ben marad;
 *  - a `returned` és az `estimatedTotalHits` külön jelenik meg;
 *  - a dashboard minden kártyája és az összesített A/B állapot látszik;
 *  - egy index kiesése fallbackot, mindkettőé `search_unavailable`-t ad (@outage).
 */
import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../support/auth';
import { seedPublishedContents, waitForCatalogVisibility } from '../support/content';
import { dockerControlAvailable, restoreSearchInstances, startSearchInstance, stopSearchInstance } from '../support/docker';

const TERM = `e2ekatalogus${Math.random().toString(36).slice(2, 7)}`;
const SEED_COUNT = 12;
let seededTitles: string[] = [];

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const token = await loginAs(page, 'poc-publisher');
  seededTitles = await seedPublishedContents(page, { count: SEED_COUNT, term: TERM, category: 'sorozat' }, token);
  // A projekció aszinkron: megvárjuk, amíg az utolsó elem is megjelenik az indexben.
  await waitForCatalogVisibility(page, seededTitles[seededTitles.length - 1], 'visible', 90_000);
  await context.close();
});

function results(page: Page) {
  return page.locator('article.catalog-card');
}

test.describe('Publikus katalógus', () => {
  test('anonymous keresés, szűrés, lapozás, detail és visszatérés', async ({ page }) => {
    await page.goto('/catalog/search');
    await expect(page.getByRole('heading', { level: 2, name: 'Keress a műsorok között' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Kezdj egy kereséssel' })).toBeVisible();
    // A publikus flow-hoz nincs belépés.
    await expect(page.getByRole('navigation', { name: 'Elsődleges navigáció' }).getByRole('link', { name: 'Belépés' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Keresett kifejezés' }).fill(TERM);
    await page.getByRole('combobox', { name: 'Kategória' }).selectOption('sorozat');
    await page.getByRole('combobox', { name: 'Találat oldalanként' }).selectOption('10');
    await page.getByRole('button', { name: 'Keresés' }).click();

    await expect(page).toHaveURL(
      new RegExp(`/catalog/search\\?q=${TERM}&category=sorozat&limit=10&offset=0$`),
    );
    await expect(results(page)).toHaveCount(10, { timeout: 30_000 });
    await expect(page.getByText(/^Az index becslése: \d+$/)).toBeVisible();
    await expect(page.getByText(/^Ezen az oldalon: 10$/)).toBeVisible();

    const pager = page.getByRole('navigation', { name: 'Keresési találatok lapozása' });
    await expect(pager.getByRole('button', { name: 'Előző oldal' })).toBeDisabled();
    await pager.getByRole('button', { name: 'Következő oldal' }).click();

    await expect(page).toHaveURL(
      new RegExp(`/catalog/search\\?q=${TERM}&category=sorozat&limit=10&offset=10$`),
    );
    const secondPageUrl = page.url();
    await expect(results(page)).toHaveCount(SEED_COUNT - 10, { timeout: 30_000 });
    await expect(page.getByText(`Ezen az oldalon: ${SEED_COUNT - 10}`)).toBeVisible();

    const firstResult = results(page).first().getByRole('link').first();
    const detailTitle = (await firstResult.innerText()).trim();
    await firstResult.click();
    await expect(page).toHaveURL(/\/catalog\/[0-9a-fA-F-]{36}$/);
    await expect(page.getByRole('heading', { level: 2, name: detailTitle })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Összefoglaló' })).toBeVisible();
    // Publikus nézet: nincs adminmező.
    await expect(page.getByText('Módosító')).toHaveCount(0);
    await expect(page.getByText('Verzió')).toHaveCount(0);

    await page.getByRole('link', { name: 'Vissza a kereséshez' }).click();
    await expect(page).toHaveURL(secondPageUrl);
    await expect(results(page)).toHaveCount(SEED_COUNT - 10, { timeout: 30_000 });
  });

  test('a megosztott URL ugyanazt a találati oldalt adja vissza', async ({ page }) => {
    await page.goto(`/catalog/search?q=${TERM}&category=sorozat&limit=10&offset=10`);
    await expect(page.getByRole('textbox', { name: 'Keresett kifejezés' })).toHaveValue(TERM);
    await expect(page.getByRole('combobox', { name: 'Kategória' })).toHaveValue('sorozat');
    await expect(page.getByRole('combobox', { name: 'Találat oldalanként' })).toHaveValue('10');
    await expect(results(page)).toHaveCount(SEED_COUNT - 10, { timeout: 30_000 });
  });

  test('az ismeretlen publikus azonosító külön not-found üzenetet kap', async ({ page }) => {
    await page.goto('/catalog/00000000-0000-4000-8000-000000000000');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Nem található vagy már nem publikus' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Vissza a kereséshez' })).toBeVisible();
  });
});

test.describe('Operációs áttekintő', () => {
  test('a publisher minden feldolgozási kártyát és az A/B állapotot látja', async ({ page }) => {
    await loginAs(page, 'poc-publisher');
    await page.goto('/operations');

    await expect(page.getByRole('heading', { level: 2, name: 'Operációs áttekintő' })).toBeVisible();
    for (const card of ['Outbox', 'Relay', 'Broker', 'Karantén']) {
      await expect(page.getByRole('heading', { level: 2, name: card })).toBeVisible();
    }

    await expect(page.getByRole('heading', { level: 2, name: 'Index A' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Index B' })).toBeVisible();
    await expect(page.locator('#search-availability-title')).toHaveText('Teljes A/B rendelkezésre állás');
    await expect(page.getByText('Mindkét keresőindex routolható.')).toBeVisible();

    await expect(page.getByRole('heading', { level: 2, name: 'Tartós fogyasztók' })).toBeVisible();
    await expect(page.locator('table').getByRole('columnheader', { name: 'Pending', exact: true })).toBeVisible();

    const refresh = page.getByRole('button', { name: 'Frissítés most' });
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect(page.getByText(/^Utolsó sikeres frissítés: /)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Elavult adatok' })).toHaveCount(0);
  });
});

test.describe('A/B kiesés @outage', () => {
  const control = dockerControlAvailable();
  test.skip(!control.ok, control.reason);

  test.afterEach(() => {
    restoreSearchInstances();
  });

  test('egy index kiesése fallback, mindkettőé nem routolható keresés', async ({ page }) => {
    test.slow();
    await loginAs(page, 'poc-publisher');
    await page.goto('/operations');
    await expect(page.locator('#search-availability-title')).toHaveText('Teljes A/B rendelkezésre állás');

    stopSearchInstance('a');
    await expect(page.locator('#search-availability-title')).toHaveText('Tartalék üzem – csökkent redundancia', {
      timeout: 60_000,
    });
    await expect(page.getByText('Egy keresőindex routolható; a másik nem tud forgalmat fogadni.')).toBeVisible();

    // A publikus keresés egyetlen routolható indexszel is kiszolgál.
    const searchPage = await page.context().newPage();
    await searchPage.goto(`/catalog/search?q=${TERM}&limit=10&offset=0`);
    await expect(searchPage.locator('article.catalog-card').first()).toBeVisible({ timeout: 30_000 });

    stopSearchInstance('b');
    await expect(page.locator('#search-availability-title')).toHaveText('A keresés nem routolható', {
      timeout: 60_000,
    });

    await searchPage.goto(`/catalog/search?q=${TERM}&limit=10&offset=0`);
    await expect(
      searchPage.getByRole('heading', { level: 2, name: 'A keresés átmenetileg nem elérhető' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      searchPage.getByText('Egyik keresőindex sem tudja most kiszolgálni a kérést. A katalógus tartalma ettől nem veszett el.'),
    ).toBeVisible();

    startSearchInstance('a');
    startSearchInstance('b');
    await expect(page.locator('#search-availability-title')).toHaveText('Teljes A/B rendelkezésre állás', {
      timeout: 120_000,
    });

    await searchPage.getByRole('button', { name: 'Újrapróbálás' }).click();
    await expect(searchPage.locator('article.catalog-card').first()).toBeVisible({ timeout: 60_000 });
    await searchPage.close();
  });
});
