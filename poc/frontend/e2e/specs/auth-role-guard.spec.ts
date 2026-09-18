/**
 * E2E-01 / P7-05 – PKCE belépés és role guard valódi Authentik ellen.
 *
 * Lefedett kötelező ellenőrzések (TODO Fázis 1):
 *  - viewer, editor és publisher PKCE belépése sikeres;
 *  - a `/me` szerinti navigáció és route-hozzáférés;
 *  - hard reload után a munkamenet helyreáll;
 *  - 403 külön UX-et kap és nem dobja el a munkamenetet;
 *  - a logout törli a munkamenetet;
 *  - a returnTo nem használható nyitott átirányításra.
 */
import { expect, test } from '@playwright/test';
import { completeAuthentikForm, loginAs, loginLink, logout, profileLink } from '../support/auth';
import { e2eConfig } from '../support/env';

function nav(page: import('@playwright/test').Page) {
  return page.getByRole('navigation', { name: 'Elsődleges navigáció' });
}

test.describe('PKCE belépés és jogosultsági határok', () => {
  test('a viewer belép, de nem lát szerkesztői és operations felületet', async ({ page }) => {
    await loginAs(page, 'poc-viewer');

    await expect(nav(page).getByRole('link', { name: 'Tartalmak' })).toHaveCount(0);
    await expect(nav(page).getByRole('link', { name: 'Operáció' })).toHaveCount(0);
    await expect(nav(page).getByRole('link', { name: 'Demó' })).toBeVisible();

    await page.goto('/login');
    await expect(page.getByRole('row', { name: /^Megtekintő/ })).toContainText('aktív');
    await expect(page.getByText('nincs / ismeretlen')).toBeVisible();

    await page.goto('/contents');
    await expect(page.getByRole('heading', { name: 'Nincs jogosultság' })).toBeVisible();
    await expect(page.getByText('content:read')).toBeVisible();
    // 403 nem jelentkeztet ki: a munkamenet érvényes marad.
    await expect(profileLink(page)).toBeVisible();
  });

  test('az editor listázhat, de az operations dashboard tiltott marad', async ({ page }) => {
    await loginAs(page, 'poc-editor');

    await expect(nav(page).getByRole('link', { name: 'Tartalmak' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Operáció' })).toHaveCount(0);

    await page.goto('/contents');
    await expect(page.getByRole('heading', { level: 2, name: 'Tartalmak' })).toBeVisible();

    await page.goto('/operations');
    await expect(page.getByRole('heading', { name: 'Nincs jogosultság' })).toBeVisible();
    await expect(page.getByText('ops:read')).toBeVisible();
    await expect(profileLink(page)).toBeVisible();
  });

  test('a publisher minden Release A felületet elér és a reload megtartja a munkamenetet', async ({ page }) => {
    await loginAs(page, 'poc-publisher');

    await expect(nav(page).getByRole('link', { name: 'Tartalmak' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Operáció' })).toBeVisible();

    await page.goto('/operations');
    await expect(page.getByRole('heading', { level: 2, name: 'Operációs dashboard' })).toBeVisible();

    await page.reload();
    await expect(profileLink(page)).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Operációs dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nincs jogosultság' })).toHaveCount(0);
  });

  test('a védett route returnTo-val visszavezet a belépés után', async ({ page }) => {
    await page.goto('/contents');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fcontents/);

    await loginAs(page, 'poc-editor', { startPath: '/contents', expectedPath: '/contents' });
    await expect(page.getByRole('heading', { level: 2, name: 'Tartalmak' })).toBeVisible();
  });

  test('a returnTo nem irányíthat idegen originre', async ({ page }) => {
    await page.goto('/login?returnTo=//example.invalid/phishing');
    await page.getByRole('button', { name: 'Belépés Authentikkal' }).click();
    await completeAuthentikForm(page, 'poc-viewer');

    await expect(profileLink(page)).toBeVisible({ timeout: 30_000 });
    // A safeReturnTo elutasítja a protokollrelatív célt, ezért a gyökérre érkezünk.
    await expect(page).toHaveURL(`${e2eConfig.baseUrl}/`);
  });

  test('a kijelentkezés után a védett route ismét belépést kér', async ({ page }) => {
    await loginAs(page, 'poc-editor');
    await logout(page);

    await expect(loginLink(page)).toBeVisible();
    await page.goto('/contents');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fcontents/);
    await expect(page.getByRole('button', { name: 'Belépés Authentikkal' })).toBeVisible();
  });
});
