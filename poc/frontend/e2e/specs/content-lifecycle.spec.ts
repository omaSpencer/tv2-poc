/**
 * E2E-02 / P7-06 – teljes szerkesztői lifecycle valódi backenddel.
 *
 * Lefedett kötelező ellenőrzések (TODO Fázis 2 és 3):
 *  - a publisher UUID másolása nélkül járja végig a v1 → v6 életciklust;
 *  - a published tartalom nem szerkeszthető;
 *  - a no-op patch nem mutat hamis verziónövekedést;
 *  - az audit minden sikeres verziót pontosan egyszer, jó sorrendben mutat;
 *  - a publikálás után a publikus katalógus megtalálja, visszavonás után elveszti;
 *  - az editor nem publikálhat és nem vonhat vissza.
 */
import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import {
  createDraft,
  formField,
  publishFromDetail,
  publishableDraft,
  readVersion,
  uniqueTitle,
  waitForCatalogVisibility,
  withdrawFromDetail,
} from '../support/content';

test.describe('Szerkesztői tartalomkezelés', () => {
  test('a publisher végigviszi a teljes életciklust és az audit pontosan követi', async ({ page }) => {
    test.slow();
    await loginAs(page, 'poc-publisher');

    await page.goto('/contents');
    await expect(page.getByRole('heading', { level: 2, name: 'Tartalmak' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Új tartalom' })).toBeVisible();

    // v1 – létrehozás
    const draft = publishableDraft();
    const id = await createDraft(page, draft);
    await expect(page.getByRole('heading', { level: 2, name: draft.title })).toBeVisible();
    expect(await readVersion(page)).toBe(1);
    await expect(page.getByText('Minden kötelező mező rendelkezésre áll.')).toBeVisible();

    // A listából a tartalom link alapján elérhető: nem kell UUID-t másolni.
    await page.goto('/contents');
    await page.getByRole('textbox', { name: 'Keresés cím, slug vagy pontos UUID alapján' }).fill(draft.title);
    const listRow = page.locator('.content-table').getByRole('link', { name: draft.title });
    await expect(listRow).toBeVisible({ timeout: 20_000 });
    await listRow.click();
    await expect(page).toHaveURL(new RegExp(`/contents/${id}$`));

    // v2 – szerkesztés
    await page.getByRole('link', { name: 'Szerkesztés' }).click();
    await expect(page.getByRole('heading', { level: 2, name: draft.title })).toBeVisible();
    const updatedSummary = `${draft.summary} Szerkesztett változat.`;
    await formField.summary(page).fill(updatedSummary);
    await page.getByRole('button', { name: 'Módosítások mentése' }).click();
    await expect(page.getByText('A módosítások elmentve.')).toBeVisible();
    await page.goto(`/contents/${id}`);
    expect(await readVersion(page)).toBe(2);

    // No-op mentés: nincs hamis verziónövekedés.
    await page.goto(`/contents/${id}/edit`);
    await expect(formField.summary(page)).toHaveValue(updatedSummary);
    await page.getByRole('button', { name: 'Módosítások mentése' }).click();
    await expect(page.getByText('Nincs mentendő változás.')).toBeVisible();
    await page.goto(`/contents/${id}`);
    expect(await readVersion(page)).toBe(2);

    // v3 – publikálás
    await publishFromDetail(page);
    await expect(page.locator('.content-status').first()).toHaveText('Publikált');
    expect(await readVersion(page)).toBe(3);

    // A publikált tartalom csak olvasható.
    await expect(page.getByRole('link', { name: 'Szerkesztés' })).toHaveCount(0);
    await page.goto(`/contents/${id}/edit`);
    await expect(page).toHaveURL(new RegExp(`/contents/${id}$`));
    await expect(
      page.getByText('A publikált tartalom csak olvasható. Vond vissza a szerkesztéshez.'),
    ).toBeVisible();

    // Publikus katalógus: a projekció aszinkron, ezért várunk rá.
    await waitForCatalogVisibility(page, draft.title, 'visible');
    await page.goto(`/catalog/search?q=${encodeURIComponent(draft.title)}&limit=20&offset=0`);
    const card = page.locator('article.catalog-card').getByRole('link', { name: draft.title });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/catalog/${id}$`));
    await expect(page.getByRole('heading', { level: 2, name: draft.title })).toBeVisible();
    await expect(page.getByText(updatedSummary)).toBeVisible();

    // v4 – visszavonás
    await page.goto(`/contents/${id}`);
    await withdrawFromDetail(page);
    await expect(page.locator('.content-status').first()).toHaveText('Visszavont');
    expect(await readVersion(page)).toBe(4);

    await waitForCatalogVisibility(page, draft.title, 'gone');
    await page.goto(`/catalog/${id}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Nem található vagy már nem publikus' })).toBeVisible();

    // v5 – szerkesztés visszavont állapotban
    await page.goto(`/contents/${id}/edit`);
    const republishSummary = `${updatedSummary} Újrapublikálás előtt.`;
    await formField.summary(page).fill(republishSummary);
    await page.getByRole('button', { name: 'Módosítások mentése' }).click();
    await expect(page.getByText('A módosítások elmentve.')).toBeVisible();
    await page.goto(`/contents/${id}`);
    expect(await readVersion(page)).toBe(5);

    // v6 – újrapublikálás
    await publishFromDetail(page);
    expect(await readVersion(page)).toBe(6);
    await expect(page.getByRole('link', { name: 'Publikus nézet megnyitása' })).toBeVisible();

    // Audit: minden verzió pontosan egyszer, legújabb elöl.
    const auditHeadings = page.locator('ol.audit-timeline h3');
    await expect(auditHeadings).toHaveCount(6, { timeout: 20_000 });
    expect(await auditHeadings.allInnerTexts()).toEqual([
      'Publikálva · v6',
      'Módosítva · v5',
      'Visszavonva · v4',
      'Publikálva · v3',
      'Módosítva · v2',
      'Létrehozva · v1',
    ]);

    await waitForCatalogVisibility(page, draft.title, 'visible');
  });

  test('az editor létrehoz és szerkeszt, de a lifecycle műveletek tiltottak', async ({ page }) => {
    await loginAs(page, 'poc-editor');

    const draft = publishableDraft(uniqueTitle('E2E editor'));
    const id = await createDraft(page, draft);

    const publishButton = page.getByRole('button', { name: 'Publikálás' });
    await expect(publishButton).toBeDisabled();
    await expect(publishButton).toHaveAttribute(
      'title',
      'A művelethez content:publish jogosultság szükséges.',
    );
    await expect(
      page.getByText('A lifecycle műveletekhez content:publish jogosultság szükséges.'),
    ).toBeVisible();

    // A szerkesztés viszont engedélyezett.
    await page.goto(`/contents/${id}/edit`);
    await formField.title(page).fill(`${draft.title} (szerkesztve)`);
    await page.getByRole('button', { name: 'Módosítások mentése' }).click();
    await expect(page.getByText('A módosítások elmentve.')).toBeVisible();
    await page.goto(`/contents/${id}`);
    expect(await readVersion(page)).toBe(2);
  });

  test('a hiányos piszkozat publikálása a hiányzó mezőket nevezi meg', async ({ page }) => {
    await loginAs(page, 'poc-publisher');

    const title = uniqueTitle('E2E hiányos');
    await createDraft(page, { title });

    await expect(page.getByText(/^Hiányzik: /)).toBeVisible();
    const publishButton = page.getByRole('button', { name: 'Publikálás' });
    await expect(publishButton).toBeDisabled();
    await expect(publishButton).toHaveAttribute('title', 'A publikálási minimum nem teljes.');
  });
});
