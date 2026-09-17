/** P7-12 – Firefox/WebKit minimum smoke, szándékosan publikus és gyors. */
import { expect, test } from '@playwright/test';

test('a publikus katalógus és a skip link támogatott nem-Chromium böngészőben működik', async ({ page }, testInfo) => {
  await page.goto('/catalog/search');
  await expect(page.getByRole('heading', { name: 'Keress a műsorok között' })).toBeVisible();
  const skip = page.getByRole('link', { name: 'Ugrás a fő tartalomra' });
  if (testInfo.project.name === 'webkit-smoke') {
    // macOS WebKit a rendszer Full Keyboard Access beállítását követi, és
    // alapból nem Tab-fókuszol linket. A link fókusz- és Enter-viselkedését
    // ettől függetlenül ugyanazzal a DOM-mal ellenőrizzük.
    await skip.focus();
  } else {
    await page.keyboard.press('Tab');
  }
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Keresett kifejezés' })).toBeVisible();
});
