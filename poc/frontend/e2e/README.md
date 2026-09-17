# Full-stack E2E runbook (Release A)

2026-09-17 · A Fázis 7 P7-04/P7-05/P7-06/P7-07/P7-08 kapuk végrehajtása a
Release A scope-ra: valódi Authentik, valódi backend, valódi Meilisearch A/B.

Ez a suite szándékosan **nem** használ mockot és nem használja a
`VITE_ALLOW_MANUAL_TOKEN` fejlesztői escape hatchet. A belépés a valódi
Authorization Code + PKCE folyamaton megy át, ez adja az M2 L2 bizonyítékot.

## Mit bizonyít

| Spec | Lefedett kötelező ellenőrzés |
| --- | --- |
| `specs/auth-role-guard.spec.ts` | viewer/editor/publisher PKCE belépés, `/me` szerinti navigáció, reload utáni session, 403 megtartott munkamenettel, logout, returnTo open-redirect védelem |
| `specs/content-lifecycle.spec.ts` | v1 → v6 életciklus UUID másolása nélkül, published read-only, no-op verzió, audit sorrend, katalógus megjelenés és eltűnés, editor tiltott lifecycle |
| `specs/version-conflict.spec.ts` | két browser context 409-e, helyi/szerver diff, kézi reapply, nincs automatikus újraküldés |
| `specs/search-operations.spec.ts` | anonymous keresés → szűrés → lapozás → detail → vissza, bookmarkolható URL, `returned` vs `estimatedTotalHits`, operations kártyák, A/B fallback és teljes kiesés (`@outage`) |
| `specs/responsive.spec.ts` | 360 px kártyanézet és vízszintes túlcsordulás-mentesség |

## Előfeltételek

- Node **24.20.x** (a `package.json` engines mezője ezt köti ki).
- Docker, futó `--profile full` stack: PostgreSQL, NATS, Meilisearch A és B, Authentik.
- Első futás előtt:

```bash
cd poc/frontend
npm ci                # a @playwright/test a package.jsonban van
npm run e2e:install   # chromium letöltése
```

Ezután hozd létre a `frontend/.env.e2e` fájlt (nincs verziózva). Minden kulcsnak
van értelmes defaultja, egyedül az `E2E_USER_PASSWORD` kötelező:

| Kulcs | Default | Mire való |
| --- | --- | --- |
| `E2E_USER_PASSWORD` | – | **kötelező**; ugyanaz, mint a compose `AUTHENTIK_POC_USER_PASSWORD` |
| `E2E_BASE_URL` | `http://127.0.0.1:5173` | a frontend origin; az Authentik strict redirectje miatt nem változtatható |
| `E2E_BACKEND_ORIGIN` | `http://127.0.0.1:3000` | a futó NestJS backend |
| `E2E_AUTHENTIK_URL` | `http://127.0.0.1:9000` | Authentik publikus URL (compose `AUTHENTIK_PORT`) |
| `E2E_START_FRONTEND` | `true` | `false`, ha magad futtatod a Vite dev szervert |
| `E2E_DOCKER_CONTROL` | `false` | `true` esetén az `@outage` teszt leállíthatja a Meili konténereket |
| `E2E_COMPOSE_FILE` / `E2E_COMPOSE_PROJECT` | `../backend/compose.yaml` / `indaplay-poc` | csak eltérő compose setupnál |
| `E2E_OIDC_*` | az `E2E_AUTHENTIK_URL`-ből képződik | issuer, client ID, redirect URI felülbírálás |

Minimális fájl:

```dotenv
E2E_USER_PASSWORD=<ugyanaz, mint az AUTHENTIK_POC_USER_PASSWORD>
```

## 1. Infrastruktúra

```bash
cd poc/backend
# a compose a saját könyvtárában lévő .env fájlból olvas
docker compose --profile full config -q
docker compose --profile full up -d
```

Az Authentik első indulása több percig tart (migráció + blueprint). Készenlét:

```bash
curl -fsS http://127.0.0.1:9000/application/o/poc-backend/.well-known/openid-configuration | head -c 200
```

A blueprint a `poc-viewer`, `poc-editor` és `poc-publisher` felhasználót az
`AUTHENTIK_POC_USER_PASSWORD` jelszóval hozza létre; ugyanezt kell az
`E2E_USER_PASSWORD` mezőbe írni.

A blueprint a `http://127.0.0.1:5173/auth/callback` és a
`http://127.0.0.1:5173/login` redirectet strict módban engedi, ezért a frontendnek
pontosan ezen az originen kell futnia. A Playwright emiatt `--strictPort --port 5173`
kapcsolókkal indítja a Vite dev szervert.

## 2. Backend

A backend E2E env fájlja (`poc/backend/.env.e2e`, nincs verziózva) a
`.env.example` alapján készül, ezekkel a kulcskülönbségekkel. A PostgreSQL
portnak egyeznie kell a `backend/.env` `POSTGRES_PORT` értékével – a compose
azon a porton teszi közzé az adatbázist, és a `DATABASE_URL`-ben is át kell írni:

```dotenv
FEATURE_IDENTITY=on
FEATURE_OUTBOX_RELAY=on
FEATURE_SEARCH=on
OIDC_ISSUER_URL=http://127.0.0.1:9000/application/o/poc-backend/
OIDC_AUDIENCE=poc-backend-api
NATS_URL=nats://127.0.0.1:4222
MEILI_A_URL=http://127.0.0.1:7700
MEILI_B_URL=http://127.0.0.1:7701
```

```bash
cd poc/backend
npm ci
ENV_FILE=.env.e2e npm run db:migrate
npm run build
ENV_FILE=.env.e2e npm start
```

## 3. A suite futtatása

```bash
cd poc/frontend
npm run e2e                 # típusellenőrzés + teljes suite
npm run e2e -- --grep-invert @outage   # a konténerleállítós eset nélkül
npm run e2e:report          # HTML riport
```

A futás elején a global setup kiírja az előfeltételek állapotát. Hiányzó
előfeltétel esetén a suite **nem** fut le és nem ad csendes passt: a hiányzó
Authentik L2 release blocker, nem automatikus siker.

### Valódi A/B kiesés

Az `@outage` teszt leállítja, majd visszaindítja a Meilisearch konténereket.
Opt-in, mert idegen stacket nem állítunk le kérés nélkül:

```dotenv
E2E_DOCKER_CONTROL=true
```

Enélkül a teszt `skip` státuszt kap a magyarázattal együtt, és a kiesési
bizonyíték pending marad.

## Tesztadat

Minden futás saját, egyedi című tartalmakat hoz létre; seedre nincs szükség és a
suite nem törli más adatát. A lifecycle és a konfliktus teszt a UI-n keresztül
dolgozik. A katalógus lapozásához 12 publikált elem kell, ezt a HTTP API-n
készíti el a fixture (`seedPublishedContents`), mert UI-ból percekig tartana; a
*vizsgált* viselkedés továbbra is a böngészőben fut.

A tartalmak a futás után az adatbázisban maradnak. Tiszta állapothoz:

```bash
cd poc/backend && ENV_FILE=.env.e2e npm run db:reset
```

## Ismert korlátok

- A publikus keresés **422** ága E2E-ből nem váltható ki: a frontend a
  `limit`/`offset`/`category` értékeket kliensoldalon kanonizálja, így hibás URL
  sem jut el a backendig. Ezt az ágat a `CatalogSearchPage` komponensteszt fedi.
- A polling háttértab-leállása böngészőből nem determinisztikus; ezt az
  `OperationsPage` komponensteszt bizonyítja.
- Az access token élettartama 5 perc; a refresh ág valós lejárattal nincs
  E2E-ben mérve (a reload utáni helyreállás igen).
- Az axe/WCAG automata ellenőrzés (P7-11) még nem része a suite-nak.

## Hibaelhárítás

| Tünet | Ok és megoldás |
| --- | --- |
| `Timed out waiting 120000ms from config.webServer` | A Vite dev szerver nem a `127.0.0.1` címen hallgat (a default `localhost` bind macOS-en gyakran csak `::1`). A config már `--host 127.0.0.1`-gyel indítja; ha magad futtatod a szervert, ugyanezt a kapcsolót add meg. |
| `BLOCKER frontend` | Ugyanaz, mint fent: a `E2E_BASE_URL` címen nincs válaszoló frontend. |
| `BLOCKER authentik` | A full profile nem fut, vagy a blueprint még nem alkalmazódott. Nézd meg: `docker compose --profile full logs authentik-worker`. |
| `BLOCKER backend` + `leállt indikátor: postgres` | Futtasd: `cd poc/backend && ENV_FILE=.env.e2e node scripts/check-e2e-db.mjs` – megmondja, hogy port, jelszó, adatbázisnév vagy hiányzó migráció az ok. Ha a DB önmagában rendben van, a backend process fut még a régi env fájllal: állítsd le (a 3000-es portot foglaló processzt) és indítsd újra. |
| `BLOCKER identity` | A backend `FEATURE_IDENTITY=off`, vagy nem éri el az OIDC discoveryt. |
| `BLOCKER search` | `FEATURE_SEARCH=off`, vagy egyik Meilisearch instance sem routolható. |
| Az Authentik `redirect_uri` hibát ad | A frontend nem a `127.0.0.1:5173` originen fut (a `localhost` nem ugyanaz). |
| A bejelentkezés időtúllépéssel áll meg | Rossz `E2E_USER_PASSWORD`, vagy a blueprint nem hozta létre a felhasználókat. |
| A backend indulásakor DB kapcsolati hiba | A `.env.e2e` `DATABASE_URL` portja nem egyezik a `backend/.env` `POSTGRES_PORT` értékével. |
| A katalógus teszt nem találja a tartalmat | A projekció még indexel; a helper 90 s-ig vár. Tartósan: nézd meg az operations dashboard Outbox/Relay kártyáját. |
