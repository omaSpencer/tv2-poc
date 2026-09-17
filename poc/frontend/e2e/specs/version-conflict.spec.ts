/**
 * E2E-03 / P7-07 – két browser context version conflictja.
 *
 * Lefedett kötelező ellenőrzés (TODO Fázis 2):
 *  - két browser context ugyanazon a tartalmon dolgozik;
 *  - az egyik ment, a másik 409-et kap;
 *  - a dialog megmutatja a helyi és a szerverértéket;
 *  - nincs automatikus újraküldés és nincs force overwrite;
 *  - a helyi módosítás kézi újraalkalmazás után adatvesztés nélkül menthető.
 */
import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { createDraft, formField, publishableDraft, readVersion, uniqueTitle } from '../support/content';

test('a párhuzamos szerkesztés konfliktusa adatvesztés nélkül oldható fel', async ({ browser }) => {
  test.slow();

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await loginAs(pageA, 'poc-publisher');

  const draft = publishableDraft(uniqueTitle('E2E konfliktus'));
  const id = await createDraft(pageA, draft);

  // A második context ugyanazzal az Authentik munkamenettel indul, de saját
  // alkalmazás-munkamenetet bootstrapel (az OIDC user sessionStorage-ban él).
  const contextB = await browser.newContext({ storageState: await contextA.storageState() });
  const pageB = await contextB.newPage();
  await loginAs(pageB, 'poc-publisher');

  let patchCount = 0;
  pageB.on('request', (request) => {
    if (request.method() === 'PATCH') patchCount += 1;
  });

  await pageA.goto(`/contents/${id}/edit`);
  await pageB.goto(`/contents/${id}/edit`);
  await expect(formField.summary(pageA)).toHaveValue(draft.summary);
  await expect(formField.summary(pageB)).toHaveValue(draft.summary);

  const summaryA = `${draft.summary} A context mentése.`;
  const summaryB = `${draft.summary} B context mentése.`;

  await formField.summary(pageA).fill(summaryA);
  await pageA.getByRole('button', { name: 'Módosítások mentése' }).click();
  await expect(pageA.getByText('A módosítások elmentve.')).toBeVisible();

  await formField.summary(pageB).fill(summaryB);
  await pageB.getByRole('button', { name: 'Módosítások mentése' }).click();

  const dialog = pageB.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole('heading', { name: 'A tartalom időközben megváltozott' })).toBeVisible();
  await expect(dialog.getByText('Várt verzió: 1, szerververzió: 2.')).toBeVisible();
  await expect(dialog.getByRole('table', { name: 'Helyi és szerverértékek' })).toBeVisible();
  await expect(dialog.getByText(summaryB)).toBeVisible();
  await expect(dialog.getByText(summaryA)).toBeVisible();
  await expect(
    dialog.getByText('Egyik lehetőség sem küld automatikusan új PATCH kérést.'),
  ).toBeVisible();

  // A dialog megnyitása óta nem indult újabb mentés.
  const patchesAfterConflict = patchCount;
  await pageB.waitForTimeout(2000);
  expect(patchCount).toBe(patchesAfterConflict);
  expect(patchesAfterConflict).toBe(1);

  await dialog.getByRole('button', { name: 'Saját módosítások megtartása' }).click();
  await expect(
    pageB.getByText('A helyi módosítások az új szerververzióra kerültek. Mentéshez ellenőrizd és küldd el újra.'),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  // A helyi szöveg nem veszett el.
  await expect(formField.summary(pageB)).toHaveValue(summaryB);

  await pageB.getByRole('button', { name: 'Módosítások mentése' }).click();
  await expect(pageB.getByText('A módosítások elmentve.')).toBeVisible();
  expect(patchCount).toBe(2);

  await pageB.goto(`/contents/${id}`);
  expect(await readVersion(pageB)).toBe(3);
  await expect(pageB.getByText(summaryB)).toBeVisible();

  await contextB.close();
  await contextA.close();
});
