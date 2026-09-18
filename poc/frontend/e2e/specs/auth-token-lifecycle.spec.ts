/**
 * FE-F5 L1 – valódi Authentik token-életciklus (release-only).
 *
 * A release gate a BE-F5 Authentik blueprint `/auth/silent-callback` strict
 * redirectjével fut. Bekapcsolás:
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
    for (const cookie of document.cookie.split(';')) {
      const separator = cookie.indexOf('=');
      if (separator < 0) continue;
      const name = cookie.slice(0, separator).trim();
      const value = cookie.slice(separator + 1);
      // Cookies are host-scoped, not port-scoped: in the local topology the
      // Authentik device cookie set on 127.0.0.1:9000 is also visible on the
      // SPA port. It is IdP device metadata, not an OIDC access/ID/refresh
      // token owned by the application.
      if (name === 'authentik_device') continue;
      if (looksLike(name) || looksLike(value)) leaks.push(`document.cookie:${name}`);
    }
    if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases();
      for (const info of databases) {
        if (info.name && looksLike(info.name)) leaks.push(`indexedDB:${info.name}`);
      }
    }
    return leaks;
  });
}

// Playwright traces contain request headers. This test observes Bearer changes
// in process memory, so a failed run must not persist the raw header either.
test.use({ trace: 'off' });

test.describe('Valódi OIDC token-életciklus @auth-lifecycle', () => {
  test.skip(
    !silentRedirectReady,
    'A valódi token-életciklus release gate csak E2E_AUTHENTIK_SILENT_REDIRECT=true mellett futhat.',
  );

  test('publisher session, storage-mentes token, renewal, silent reload és logout', async ({ page }) => {
    test.setTimeout(ACCESS_TOKEN_LIFETIME_MS + RENEW_MARGIN_MS + 60_000);

    const meResponses: Array<{ token: string; status: number }> = [];
    page.on('response', (response) => {
      if (!response.url().includes('/api/me')) return;
      const header = response.request().headers().authorization;
      const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
      if (match) meResponses.push({ token: match[1], status: response.status() });
    });

    const loginToken = await loginAs(page, 'poc-publisher');
    await expect(profileLink(page)).toBeVisible();
    await page.goto('/login');
    await expect(page.getByRole('row', { name: /^Kiadó/ })).toContainText('aktív');
    await expect(page.getByRole('navigation', { name: 'Elsődleges navigáció' }).getByRole('link', { name: 'Operáció' })).toBeVisible();
    expect(await browserStoresLeakTokens(page)).toEqual([]);
    expect(meResponses.length).toBeGreaterThan(0);
    const activeToken = meResponses.at(-1)?.token ?? loginToken;
    meResponses.length = 0;

    await expect.poll(() => meResponses.some(response => (
      response.token !== activeToken && response.status === 200
    )), {
      timeout: ACCESS_TOKEN_LIFETIME_MS + RENEW_MARGIN_MS,
      intervals: [5_000, 10_000, 15_000],
    }).toBe(true);
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
