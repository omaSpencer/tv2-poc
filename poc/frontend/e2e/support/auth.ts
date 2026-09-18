/**
 * P7-05 – valódi Authorization Code + PKCE belépés az Authentik UI-ján keresztül.
 *
 * A helper szándékosan nem kerüli meg az IdP-t: nem injektál tokent és nem
 * használja a `VITE_ALLOW_MANUAL_TOKEN` escape hatchet. Ez a különbség az L1
 * (mock JWKS) és az L2 (valódi Authentik) bizonyíték között.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { e2eConfig, type E2eIdentity } from './env';

const AUTHENTIK_FORM_TIMEOUT = 60_000;
const APPLICATION_ORIGIN = new URL(e2eConfig.baseUrl).origin;

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

function isAtApplication(page: Page): boolean {
  return new URL(page.url()).origin === APPLICATION_ORIGIN;
}

/** Az Authentik stage-ek submit gombja (a `Continue`/`Log in` felirat verziónként változik). */
async function submitStage(page: Page, field: Locator): Promise<void> {
  // Az Enter a fókuszban lévő mező saját formját küldi el, ezért nem tud egy
  // animációból visszamaradt, másik shadow-rootbeli submit gombra kattintani.
  // A pointert elfogó Authentik loading overlay sem zavarja.
  await field.press('Enter');
  await page.waitForTimeout(250);

  const returnedToApplication = () => isAtApplication(page);
  if (returnedToApplication() || !(await field.isVisible().catch(() => false))) return;

  const overlay = page.locator('ak-loading-overlay:visible').first();
  if (await overlay.isVisible().catch(() => false)) {
    await overlay.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    // Az előző submit közben az Authentik már átirányíthatott vagy stage-et
    // válthatott. Ilyenkor a régi gombra kattintani egyszerre felesleges és
    // flakey: a loading overlay elfogja a pointer eventet.
    if (returnedToApplication() || !(await field.isVisible().catch(() => false))) return;
    // A submit még dolgozik. A külső ciklus megvárja a stage-váltást, és csak
    // a torlódásvédelmi idő után próbálkozik újra.
    if (await overlay.isVisible().catch(() => false)) return;
  }

  // Régebbi/egyedi flow stage-eknél az Enter nem feltétlen submitol; ilyenkor
  // ugyanannak a formnak a gombja a kontrollált tartalék.
  const formButton = field
    .locator('xpath=ancestor::form[1]')
    .locator('button[type="submit"]:visible')
    .first();
  const button = (await formButton.isVisible().catch(() => false))
    ? formButton
    : page.locator('button[type="submit"]:visible').first();
  if (await button.isVisible().catch(() => false)) {
    try {
      await button.click({ timeout: 5000 });
    } catch {
      if (returnedToApplication() || !(await field.isVisible().catch(() => false))) return;
    }
  }
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
  let noStageSince = Date.now();
  let loadingReloads = 0;

  const canSubmit = (stage: string) => stage !== lastStage || Date.now() - lastSubmitAt > 3000;

  while (Date.now() < deadline) {
    if (await profileLink(page).isVisible().catch(() => false)) return;
    // A callback feldolgozása már a SPA feladata. Ne tartsuk bent az IdP-form
    // ciklusában: a loginAs alább külön megvárja a /me bootstrap végét és a
    // Profil linket.
    const currentUrl = new URL(page.url());
    if (currentUrl.origin === APPLICATION_ORIGIN && currentUrl.pathname === '/auth/callback') return;

    const username = page.locator(USERNAME_INPUT).first();
    const password = page.locator(PASSWORD_INPUT).first();
    const usernameVisible = await username.isVisible().catch(() => false);
    const passwordVisible = await password.isVisible().catch(() => false);

    // A stage sorrendje nem cserélhető fel: az identification oldal a
    // jelszókezelők kedvéért egy `input[name="password"]` mezőt is kirajzol,
    // amit a Playwright láthatónak lát. Ha azt néznénk előbb, üres
    // felhasználónévvel küldenénk be a formot, és a flow körbeérne.
    if (usernameVisible) {
      noStageSince = Date.now();
      if (canSubmit('identification')) {
        if ((await username.inputValue().catch(() => '')) !== identity) {
          await username.fill(identity);
        }
        // Egyesített identification+password stage esetén a jelszó is itt kell.
        if (passwordVisible) {
          await password.fill(e2eConfig.userPassword).catch(() => {});
        }
        await submitStage(page, username);
        lastStage = 'identification';
        lastSubmitAt = Date.now();
      }
      await page.waitForTimeout(500);
      continue;
    }

    if (passwordVisible) {
      noStageSince = Date.now();
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

    // Authentik occasionally leaves its flow web component on the initial
    // loading card even though the URL is valid. Reload the same flow at most
    // twice; `next`, PKCE state and challenge remain in the URL.
    if (Date.now() - noStageSince > 10_000 && loadingReloads < 2) {
      await page.reload({ waitUntil: 'commit', timeout: 10_000 }).catch(() => undefined);
      loadingReloads += 1;
      noStageSince = Date.now();
    }
    await page.waitForTimeout(250);
  }

  // A redirect can land exactly as the loop deadline expires. The callback is
  // already the SPA's responsibility, so accept that terminal URL here too.
  const finalUrl = new URL(page.url());
  if (finalUrl.origin === APPLICATION_ORIGIN && finalUrl.pathname === '/auth/callback') return;

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

const BEARER = /^Bearer\s+(\S+)$/i;

function observeAccessToken(page: Page, sink: { token?: string }): () => void {
  const onRequest = (request: { url: () => string; headers: () => Record<string, string> }) => {
    if (!request.url().includes('/api/')) return;
    const header = request.headers().authorization;
    const match = header ? BEARER.exec(header) : null;
    if (match) sink.token = match[1];
  };
  page.on('request', onRequest);
  return () => page.off('request', onRequest);
}

/**
 * Végigviszi a teljes PKCE folyamatot és megvárja, amíg a `/me` bootstrap lefut.
 * Visszatéréskor az alkalmazás bejelentkezett állapotban van. A megfigyelt
 * Bearer token csak a tesztfolyamat memóriájában él; storage/DOM/log nem kapja.
 */
export async function loginAs(
  page: Page,
  identity: E2eIdentity,
  options: LoginOptions = {},
): Promise<string> {
  const observed: { token?: string } = {};
  const stop = observeAccessToken(page, observed);
  try {
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

    if (!observed.token) {
      throw new Error('A belépés után nem jelent meg Authorization fejléc a /api kéréseken.');
    }
    return observed.token;
  } finally {
    stop();
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
