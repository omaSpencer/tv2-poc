/**
 * FE-F5 L1 – valódi Authentik token-életciklus (release-only).
 *
 * Integrációs gate pending, amíg a BE-F5 Authentik blueprint nem engedélyezi a
 * `/auth/silent-callback` strict redirectet. Bekapcsolás:
 * `E2E_AUTHENTIK_SILENT_REDIRECT=true`. Nincs time travel, mock JWKS vagy
 * manual-token escape hatch. A timeout a valódi 5 perces access tokenhez igazodik.
 */
import { expect, test, type Page } from '@playwright/test';
import { loginAs, loginLink, logout, profileLink } from '../support/auth';

const ACCESS_TOKEN_LIFETIME_MS = 5 * 60 * 1000;
const RENEW_MARGIN_MS = 75 * 1000;
const silentRedirectReady = process.env.E2E_AUTHENTIK_SILENT_REDIRECT === 'true';

async function browserStoresLeakTokens(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const jwt = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
    const fields = /"(access_token|refresh_token|id_token|token_type)"\s*:/;
    const looksLike = (value: string) => jwt.test(value) || fields.test(value);
    const leaks: string[] = [];
    const scan = (storage: Storage, label: string) => {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key) continue;
        const raw = storage.getItem(key) ?? '';
        if (looksLike(key) || looksLike(raw)) leaks.push(`${label}:${key}`);
      }
    };
    scan(localStorage, 'localStorage');
    scan(sessionStorage, 'sessionStorage');
    if (document.cookie && looksLike(document.cookie)) leaks.push('document.cookie');
    if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases();
      for (const info of databases) {
        if (info.name && looksLike(info.name)) leaks.push(`indexedDB:${info.name}`);
      }
    }
    return leaks;
  });
}

test.describe('Valódi OIDC token-életciklus @auth-lifecycle', () => {
  test.skip(
    !silentRedirectReady,
    'Integrációs gate pending: az Authentik strict redirect allowlist a BE-F5 ágon kapja meg a /auth/silent-callback URI-t.',
  );

  test('publisher session, storage-mentes token, renewal, silent reload és logout', async ({ page }) => {
    test.setTimeout(ACCESS_TOKEN_LIFETIME_MS + RENEW_MARGIN_MS + 60_000);

    const meTokens: string[] = [];
    const meStatuses: number[] = [];
    page.on('request', (request) => {
      if (!request.url().includes('/api/me')) return;
      const header = request.headers().authorization;
      const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
      if (match) meTokens.push(match[1]);
    });
    page.on('response', (response) => {
      if (!response.url().includes('/api/me')) return;
      if (response.request().headers().authorization) meStatuses.push(response.status());
    });

    await loginAs(page, 'poc-publisher');
    await expect(profileLink(page)).toBeVisible();
    await page.goto('/login');
    await expect(page.getByRole('row', { name: /^Kiadó/ })).toContainText('aktív');
    await expect(page.getByRole('navigation', { name: 'Elsődleges navigáció' }).getByRole('link', { name: 'Operáció' })).toBeVisible();
    expect(await browserStoresLeakTokens(page)).toEqual([]);
    expect(meTokens.length).toBeGreaterThan(0);
    const firstToken = meTokens[0];

    await expect.poll(() => meTokens.some(token => token !== firstToken), {
      timeout: ACCESS_TOKEN_LIFETIME_MS + RENEW_MARGIN_MS,
      intervals: [5_000, 10_000, 15_000],
    }).toBe(true);
    expect(meStatuses.at(-1)).toBe(200);
    expect(await browserStoresLeakTokens(page)).toEqual([]);

    await page.reload();
    await expect(profileLink(page)).toBeVisible({ timeout: 30_000 });
    expect(await browserStoresLeakTokens(page)).toEqual([]);

    await logout(page);
    await expect(loginLink(page)).toBeVisible();
    await page.goto('/contents');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fcontents/);
    await expect(page.getByRole('button', { name: 'Belépés Authentikkal' })).toBeEnabled();
  });
});
