/**
 * P7-06 – szerkesztői lifecycle UI helperek.
 *
 * Minden run saját, egyedi tartalmat hoz létre (a Fázis 6 szabálya: „minden run
 * új content ID-t hoz létre”), így a suite ismételhető és nem függ seedtől.
 */
import { expect, type Page } from '@playwright/test';

export type DraftValues = {
  title: string;
  summary?: string;
  category?: 'film' | 'sorozat' | 'hir' | 'sport' | 'szorakozas' | 'egyeb';
  mediaAssetId?: string;
  tags?: string;
  slug?: string;
};

/** A ContentForm labeljei tartalmazzák a karakterszámlálót is, ezért prefix-regexszel címezzük őket. */
export const formField = {
  title: (page: Page) => page.getByRole('textbox', { name: /^Cím/ }),
  slug: (page: Page) => page.getByRole('textbox', { name: /^Slug/ }),
  summary: (page: Page) => page.getByRole('textbox', { name: /^Összefoglaló/ }),
  category: (page: Page) => page.getByRole('combobox', { name: /^Kategória/ }),
  mediaAssetId: (page: Page) => page.getByRole('textbox', { name: /^Médiaazonosító/ }),
  tags: (page: Page) => page.getByRole('textbox', { name: /^Tagek/ }),
};

/** Ütközésmentes, ékezetes cím: a keresés és a 200 karakteres határ is valós adatot lát. */
export function uniqueTitle(prefix = 'E2E őrség'): string {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const salt = Math.random().toString(36).slice(2, 7);
  return `${prefix} ${stamp}-${salt}`;
}

export function contentIdFromUrl(page: Page): string {
  const match = /\/contents\/([0-9a-fA-F-]{36})/.exec(page.url());
  if (!match) throw new Error(`A megnyitott URL nem tartalmaz content ID-t: ${page.url()}`);
  return match[1];
}

/** Publikálásra kész piszkozat: cím, összefoglaló, kategória és médiaazonosító kitöltve. */
export function publishableDraft(title = uniqueTitle()): Required<Omit<DraftValues, 'slug'>> {
  return {
    title,
    summary: `Automatizált full-stack E2E tartalom: ${title}.`,
    category: 'film',
    mediaAssetId: `e2e-media-${Math.random().toString(36).slice(2, 10)}`,
    tags: 'e2e, release-a',
  };
}

/** Létrehoz egy piszkozatot a `/contents/new` űrlapon és visszaadja az új content ID-t. */
export async function createDraft(page: Page, values: DraftValues): Promise<string> {
  await page.goto('/contents/new');
  await expect(page.getByRole('heading', { level: 2, name: 'Tartalom létrehozása' })).toBeVisible();

  await formField.title(page).fill(values.title);
  if (values.slug !== undefined) await formField.slug(page).fill(values.slug);
  if (values.summary !== undefined) await formField.summary(page).fill(values.summary);
  if (values.category !== undefined) await formField.category(page).selectOption(values.category);
  if (values.mediaAssetId !== undefined) await formField.mediaAssetId(page).fill(values.mediaAssetId);
  if (values.tags !== undefined) await formField.tags(page).fill(values.tags);

  await page.getByRole('button', { name: 'Piszkozat létrehozása' }).click();
  await page.waitForURL(/\/contents\/[0-9a-fA-F-]{36}$/, { timeout: 20_000 });
  return contentIdFromUrl(page);
}

export function statusBadge(page: Page) {
  return page.locator('.content-detail .content-status, .content-status').first();
}

/** A detail fejlécében megjelenő `v{n}` verzió. */
export async function readVersion(page: Page): Promise<number> {
  const text = await page.locator('span.mono', { hasText: /^v\d+$/ }).first().innerText();
  return Number(text.replace('v', ''));
}

export async function publishFromDetail(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: /^(Publikálás|Újrapublikálás)$/ });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByText('A tartalom publikálva lett.')).toBeVisible({ timeout: 20_000 });
}

export async function withdrawFromDetail(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Visszavonás' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Tartalom visszavonása' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Visszavonás' }).click();
  await expect(page.getByText('A tartalom vissza lett vonva.')).toBeVisible({ timeout: 20_000 });
}

/**
 * Megvárja, amíg a publikus keresés megtalálja (vagy elveszti) a címet.
 * A projekció aszinkron (outbox → NATS → Meili), ezért pollingol, nem alszik fixen.
 */
export async function waitForCatalogVisibility(
  page: Page,
  title: string,
  expected: 'visible' | 'gone',
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    const response = await page.request.get(
      `/api/catalog/search?q=${encodeURIComponent(title)}&limit=20&offset=0`,
    );
    lastStatus = response.status();
    if (response.ok()) {
      const body = (await response.json()) as { items?: Array<{ title?: string }> };
      const found = (body.items ?? []).some((item) => item.title === title);
      if (expected === 'visible' && found) return;
      if (expected === 'gone' && !found) return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(
    `A publikus keresés ${timeoutMs} ms alatt nem érte el a(z) "${expected}" állapotot a(z) "${title}" címre (utolsó HTTP státusz: ${lastStatus}).`,
  );
}

/**
 * A bejelentkezett munkamenet access tokenje az oidc-client-ts sessionStorage
 * bejegyzéséből. Csak tesztadat-seedeléshez használjuk; az alkalmazás kódja
 * továbbra sem tesz tokent a DOM-ba.
 */
export async function accessTokenFromSession(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (!key || !key.startsWith('oidc.user:')) continue;
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { access_token?: unknown };
        if (typeof parsed.access_token === 'string') return parsed.access_token;
      } catch {
        // A hibás bejegyzést átugorjuk; a hiányt a hívó jelzi.
      }
    }
    return null;
  });
  if (!token) {
    throw new Error('Nem található access token a munkamenetben; előbb jelentkezz be a loginAs helperrel.');
  }
  return token;
}

/**
 * Lapozáshoz elegendő publikált tartalmat hoz létre a HTTP API-n keresztül.
 *
 * A katalógus lapozás vizsgálatához 10+ publikált elem kell; ezt UI-n keresztül
 * felvinni percekig tartana, ezért a *tesztadat* API-n készül. A vizsgált
 * viselkedés (lapozás, szűrés, detail, vissza) továbbra is a böngészőben fut.
 */
export async function seedPublishedContents(
  page: Page,
  options: { count: number; term: string; category?: DraftValues['category'] },
): Promise<string[]> {
  const token = await accessTokenFromSession(page);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const titles: string[] = [];

  for (let index = 1; index <= options.count; index += 1) {
    const title = `${options.term} epizód ${String(index).padStart(2, '0')}`;
    const created = await page.request.post('/api/admin/contents', {
      headers,
      data: {
        title,
        summary: `Automatizált katalógus fixture (${options.term}), ${index}. elem.`,
        category: options.category ?? 'sorozat',
        mediaAssetId: `${options.term}-media-${index}`,
        tags: ['e2e', options.term],
      },
    });
    if (created.status() !== 201) {
      throw new Error(`A fixture létrehozása sikertelen: HTTP ${created.status()} – ${await created.text()}`);
    }
    const body = (await created.json()) as { id: string; version: number };
    const published = await page.request.post(`/api/admin/contents/${body.id}/publish`, {
      headers,
      data: { expectedVersion: body.version },
    });
    if (!published.ok()) {
      throw new Error(`A fixture publikálása sikertelen: HTTP ${published.status()} – ${await published.text()}`);
    }
    titles.push(title);
  }

  return titles;
}
