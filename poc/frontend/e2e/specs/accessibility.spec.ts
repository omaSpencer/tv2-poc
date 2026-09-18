/** P7-11 – axe és billentyűzet/screen-reader contract smoke a kritikus route-okon. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../support/auth';
import { createDraft, publishableDraft, uniqueTitle } from '../support/content';

async function expectNoHighImpactViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const highImpact = result.violations.filter((violation) =>
    violation.impact === 'critical' || violation.impact === 'serious');
  expect(highImpact, highImpact.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
}

test.describe('Accessibility release gate', () => {
  test('login és publikus katalógus axe + skip-link kapuja zöld', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Belépés Authentikkal' })).toBeVisible();
    await expectNoHighImpactViolations(page);

    await page.goto('/catalog/search');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Ugrás a fő tartalomra' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    await expectNoHighImpactViolations(page);
  });

  test('ismeretlen route 404 a shellben, axe-zöld', async ({ page }) => {
    await page.goto('/nincs-ilyen-oldal');
    await expect(page).toHaveURL(/nincs-ilyen-oldal/);
    await expect(page.getByRole('heading', { name: 'Az oldal nem található' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ugrás a fő tartalomra' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Elsődleges navigáció' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Főoldal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Vissza' })).toBeVisible();
    await expect(page.locator('#main-content')).not.toContainText('nincs-ilyen-oldal');
    await expectNoHighImpactViolations(page);
    await page.getByRole('button', { name: 'Vissza' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Demófelület' })).toBeVisible();
  });

  test('a piszkos szerkesztői űrlap belső navigációját a felhasználó döntése vezérli', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, 'poc-publisher', {
      startPath: '/contents/new',
      expectedPath: '/contents/new',
    });
    await page.getByLabel(/^Cím/).fill(uniqueTitle('Nem mentett navigáció'));

    const cancelled = new Promise<void>((resolve) => {
      page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('A nem mentett módosítások elvesznek. Biztosan elhagyod az oldalt?');
        await dialog.dismiss();
        resolve();
      });
    });
    await page.getByRole('navigation', { name: 'Elsődleges navigáció' })
      .getByRole('link', { name: 'Katalógus' })
      .click();
    await cancelled;
    await expect(page).toHaveURL(/\/contents\/new$/);

    const accepted = new Promise<void>((resolve) => {
      page.once('dialog', async (dialog) => {
        await dialog.accept();
        resolve();
      });
    });
    await page.getByRole('navigation', { name: 'Elsődleges navigáció' })
      .getByRole('link', { name: 'Katalógus' })
      .click();
    await accepted;
    await expect(page).toHaveURL(/\/catalog\/search$/);
  });

  test('create, confirm dialog, operations és demo szemantikus kapuja zöld', async ({ page }) => {
    test.setTimeout(180_000);
    await loginAs(page, 'poc-publisher');
    const id = await createDraft(page, publishableDraft(uniqueTitle('A11y őrség')));
    await expectNoHighImpactViolations(page);

    await page.getByRole('button', { name: 'Publikálás' }).click();
    const publishNotice = page.getByRole('status').filter({ hasText: 'A tartalom publikálva lett.' });
    await expect(publishNotice).toBeVisible();
    await expect(publishNotice.locator('..').getByRole('button', { name: 'Értesítés bezárása' })).toBeVisible();
    await page.getByRole('button', { name: 'Visszavonás' }).click();
    const dialog = page.getByRole('dialog', { name: 'Tartalom visszavonása' });
    await expect(dialog.getByRole('button', { name: 'Mégse' })).toBeFocused();
    await expectNoHighImpactViolations(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Visszavonás' })).toBeFocused();

    await page.goto('/operations');
    await expect(page.getByRole('heading', { name: 'Operációs áttekintő' })).toBeVisible();
    await expectNoHighImpactViolations(page);

    await page.goto('/demo');
    await expect(page.getByRole('heading', { name: 'Forgatókönyv-futtató és bizonyítéktér' })).toBeVisible();
    await expectNoHighImpactViolations(page);
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
