/**
 * P7-05 – valódi Authorization Code + PKCE belépés az Authentik UI-ján keresztül.
 *
 * A helper szándékosan nem kerüli meg az IdP-t: nem injektál tokent és nem
 * használja a `VITE_ALLOW_MANUAL_TOKEN` escape hatchet. Ez a különbség az L1
 * (mock JWKS) és az L2 (valódi Authentik) bizonyíték között.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { e2eConfig, type E2eIdentity } from './env';

const AUTHENTIK_FORM_TIMEOUT = 30_000;

/** Az Authentik flow-executor web componentjei nyílt shadow rootot használnak; a CSS selector átlát rajtuk. */
const USERNAME_INPUT = 'input[name="uidField"]';
const PASSWORD_INPUT = 'input[name="password"]';

/** Igaz, ha az alkalmazás bejelentkezett állapotot mutat (a navigációban `Profil` látszik). */
export function profileLink(page: Page) {
  return page.getByRole('navigation', { name: 'Elsődleges navigáció' }).getByRole('link', { name: 'Profil' });
}

export function loginLink(page: Page) {
  return page.getByRole('navigation', { name: 'Elsődleges navigáció' }).getByRole('link', { name: 'Belépés' });
}

/** Az Authentik stage-ek submit gombja (a `Continue`/`Log in` felirat verziónként változik). */
async function submitStage(page: Page, field: Locator): Promise<void> {
  const button = page.locator('button[type="submit"]').first();
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    return;
  }
  // Tartalék: néhány stage az Enterre is elküldi magát.
  await field.press('Enter');
}

/**
 * Végigkíséri az IdP oldalát: kitölti az identification és a password stage-et,
 * ahogy megjelennek. Ha az Authentik munkamenet már él, a folyamat form nélkül,
 * csendes redirecttel fut le – ezért a ciklus kilépési feltétele az
 * alkalmazásban látható bejelentkezett állapot, nem egy konkrét űrlap.
 *
 * A stage-eket nem egyszer töltjük ki és felejtjük el: amíg ugyanaz a mező
 * látszik, a submit ismételhető (3 s-os torlódásvédelemmel). Enélkül egy le nem
 * adott form némán kifutna a határidőből.
 */
export async function completeAuthentikForm(page: Page, identity: E2eIdentity): Promise<void> {
  const deadline = Date.now() + AUTHENTIK_FORM_TIMEOUT;
  let lastSubmitAt = 0;
  let lastStage = '';

  const canSubmit = (stage: string) => stage !== lastStage || Date.now() - lastSubmitAt > 3000;

  while (Date.now() < deadline) {
    if (await profileLink(page).isVisible().catch(() => false)) return;

    const password = page.locator(PASSWORD_INPUT).first();
    if (await password.isVisible().catch(() => false)) {
      if (canSubmit('password')) {
        if ((await password.inputValue().catch(() => '')) !== e2eConfig.userPassword) {
          await password.fill(e2eConfig.userPassword);
        }
        await submitStage(page, password);
        lastStage = 'password';
        lastSubmitAt = Date.now();
      }
      await page.waitForTimeout(500);
      continue;
    }

    const username = page.locator(USERNAME_INPUT).first();
    if (await username.isVisible().catch(() => false)) {
      if (canSubmit('identification')) {
        if ((await username.inputValue().catch(() => '')) !== identity) {
          await username.fill(identity);
        }
        await submitStage(page, username);
        lastStage = 'identification';
        lastSubmitAt = Date.now();
      }
      await page.waitForTimeout(500);
      continue;
    }

    await page.waitForTimeout(250);
  }

  throw new Error(
    `Az Authentik bejelentkezés nem fejeződött be ${AUTHENTIK_FORM_TIMEOUT} ms alatt (identitás: ${identity}, utolsó stage: ${lastStage || 'nincs felismert stage'}, utolsó URL: ${page.url()}).`,
  );
}

export type LoginOptions = {
  /** Ide navigál a teszt a belépés előtt; a guard `returnTo`-val a /login oldalra küldi. */
  startPath?: string;
  /** Ahol a belépés után kikötünk. Default: `startPath` vagy `/`. */
  expectedPath?: string;
};

/**
 * Végigviszi a teljes PKCE folyamatot és megvárja, amíg a `/me` bootstrap lefut.
 * Visszatéréskor az alkalmazás bejelentkezett állapotban van.
 */
export async function loginAs(
  page: Page,
  identity: E2eIdentity,
  options: LoginOptions = {},
): Promise<void> {
  const startPath = options.startPath ?? '/login';
  await page.goto(startPath);

  if (startPath !== '/login') {
    // A RequireAuth/RequirePermission guard átirányít a /login?returnTo=... címre.
    await page.waitForURL(/\/login(\?|$)/, { timeout: 15_000 });
  }

  const loginButton = page.getByRole('button', { name: 'Belépés Authentikkal' });
  await expect(loginButton).toBeEnabled({ timeout: 15_000 });
  await loginButton.click();

  await completeAuthentikForm(page, identity);

  await expect(profileLink(page)).toBeVisible({ timeout: 20_000 });

  const expectedPath = options.expectedPath ?? (startPath === '/login' ? undefined : startPath);
  if (expectedPath) {
    await page.waitForURL((url) => `${url.pathname}${url.search}` === expectedPath, { timeout: 15_000 });
  }
}

/** Kijelentkezés a `/login` oldalról; a végén az alkalmazás anonim állapotban van. */
export async function logout(page: Page): Promise<void> {
  await page.goto('/login');
  const logoutButton = page.getByRole('button', { name: 'Kijelentkezés' });
  await expect(logoutButton).toBeVisible({ timeout: 15_000 });
  await logoutButton.click();
  await expect(loginLink(page)).toBeVisible({ timeout: 20_000 });
}
