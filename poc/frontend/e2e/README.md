# Full-stack E2E runbook (Release A–C)

2026-09-17 · A Fázis 7 P7-04/P7-05/P7-06/P7-07/P7-08 kapuk végrehajtása a
Release A–B és Fázis 5–6 scope-ra: valódi Authentik, valódi backend, valódi
PostgreSQL/NATS és valódi Meilisearch A/B.

Ez a suite szándékosan **nem** használ mockot és nem használja a
`VITE_ALLOW_MANUAL_TOKEN` fejlesztői escape hatchet. A belépés a valódi
Authorization Code + PKCE folyamaton megy át, ez adja az M2 L2 bizonyítékot.

## Mit bizonyít

| Spec | Lefedett kötelező ellenőrzés |
| --- | --- |
| `specs/auth-role-guard.spec.ts` | viewer/editor/publisher PKCE belépés, `/me` szerinti navigáció, reload utáni session, 403 megtartott munkamenettel, logout, returnTo open-redirect védelem |
| `specs/auth-token-lifecycle.spec.ts` | release-only: storage-mentes token, valódi 5 perces megújulás, silent reload és logout; a közös release workflow kötelezően `E2E_AUTHENTIK_SILENT_REDIRECT=true` értékkel futtatja |
| `specs/content-lifecycle.spec.ts` | v1 → v6 életciklus UUID másolása nélkül, published read-only, no-op verzió, audit sorrend, katalógus megjelenés és eltűnés, editor tiltott lifecycle |
| `specs/version-conflict.spec.ts` | két browser context 409-e, helyi/szerver diff, kézi reapply, nincs automatikus újraküldés |
| `specs/search-operations.spec.ts` | anonymous keresés → szűrés → lapozás → detail → vissza, bookmarkolható URL, `returned` vs `estimatedTotalHits`, operations kártyák, A/B fallback és teljes kiesés (`@outage`) |
| `specs/operator-actions.spec.ts` | reindex idempotencia és párhuzamos tiltás, reload utáni progress, repair both, payloadmentes quarantine inspect/replay, exact DB-névvel engedélyezett valódi kiesési reindex (`@operator-outage`) |
| `specs/backend-restart.spec.ts` | saját backend process SIGKILL, stale `failed/aborted` recovery, majd UI-ból indított új teljes reindex (`npm run e2e:backend-restart`) |
| `specs/demo-scenarios.spec.ts` | Phase 6 S01 teljes lifecycle + redaktált export, valamint opt-in S04 manual checkpoint, A/B fallback, teljes kiesés, CMS-write és recovery |
| `specs/accessibility.spec.ts` | Axe serious/critical nulla a kritikus route-okon, skip link, dialog keyboard/fókusz |
| `specs/responsive.spec.ts` | 360×800, 768×1024 és 1280×800 layout, kártya/tábla váltás, túlcsordulás |
| `specs/cross-browser.spec.ts` | Firefox/WebKit publikus katalógus és keyboard skip-link smoke |

## Előfeltételek

- Node **24.20.0** / npm **11.19.0** (a `package.json` engines mezője ezt köti ki).
- Docker, futó `--profile full` stack: PostgreSQL, NATS, Meilisearch A és B, Authentik.
- Első futás előtt:

```bash
cd poc/frontend
npm ci                # a @playwright/test a package.jsonban van
npm run e2e:install   # Chromium, Firefox és WebKit letöltése
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
| `E2E_BACKEND_PROCESS_CONTROL` | `false` | csak a dedikált restart-hámhoz; a teszt saját backend processt indít és szakít meg |
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

A blueprint a `http://127.0.0.1:5173/auth/callback`,
`http://127.0.0.1:5173/auth/silent-callback` és
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
npm run e2e:a11y            # axe + keyboard/fókusz kapu
npm run e2e:responsive      # három kötelező viewport
npm run e2e:cross-browser   # Firefox + WebKit smoke
npm run e2e -- --grep-invert @outage   # a konténerleállítós eset nélkül
E2E_DOCKER_CONTROL=true npm run e2e -- demo-scenarios.spec.ts  # Phase 6 S01 + S04
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

### Valódi backend-crash és restart recovery

Ehhez a próbához a normál, kézzel indított backendet előbb állítsd le. A
dedikált hám maga indítja a `dist/main.js` folyamatot, futó reindex közben
`SIGKILL`-lel megszakítja, kivárja a produkciós 30 másodperces stale határt,
majd újraindítja. A teszt végén kontrolláltan leállítja a saját processt.

```bash
cd poc/backend && npm run build
cd ../frontend
E2E_BACKEND_PROCESS_CONTROL=true npm run e2e:backend-restart
```

A restart-hám trace/video kimenete `/tmp/tv2-poc-playwright-restart-*` alatt
van, hogy a Vite fájlfigyelője ne tölthesse újra a PKCE oldalt futás közben.

## Tesztadat

Minden futás saját, egyedi című tartalmakat hoz létre; seedre nincs szükség és a
suite nem törli más adatát. A lifecycle és a konfliktus teszt a UI-n keresztül
dolgozik. A katalógus lapozásához 12 publikált elem kell, ezt a HTTP API-n
készíti el a fixture (`seedPublishedContents`), a Bearer tokent a `loginAs` a
belépés során megfigyelt Authorization fejlécből adja a tesztfolyamat
memóriájába; storage-ból, DOM-ból, logból nem olvassuk. A *vizsgált* viselkedés
továbbra is a böngészőben fut.

A Phase 5 karantén-fixture egy valóban publikált content eseményre mutató,
payloadmentes DLQ-locatort ír; a replay ugyanazt a tárolt JetStream-üzenetet
olvassa és validálja, mint produkcióban. A tartalmak és a karanténrekordok a
futás után megmaradnak. Tiszta állapothoz:

```bash
cd poc/backend && ENV_FILE=.env.e2e npm run db:reset
```

## Ismert korlátok

- A publikus keresés **422** ága E2E-ből nem váltható ki: a frontend a
  `limit`/`offset`/`category` értékeket kliensoldalon kanonizálja, így hibás URL
  sem jut el a backendig. Ezt az ágat a `CatalogSearchPage` komponensteszt fedi.
- A polling háttértab-leállása böngészőből nem determinisztikus; ezt az
  `OperationsPage` komponensteszt bizonyítja.
- Az access token élettartama 5 perc; emiatt az `auth-token-lifecycle` release
  spec szándékosan több perces, és nem használ time travelt vagy mock JWKS-t.
- A kézi screen-reader smoke négy állomása: login oldal és hibaüzenet; create
  form label/mezőhiba; conflict dialog cím/leírás/fókusz; reindex confirm dialog
  és élő progress. A programozott név, live region és keyboard viselkedés
  automatizált; a beszéd természetessége kiadásonként kézi ellenőrzés.

## Hibaelhárítás

| Tünet | Ok és megoldás |
| --- | --- |
| `Timed out waiting 120000ms from config.webServer` | A Vite dev szerver nem a `127.0.0.1` címen hallgat (a default `localhost` bind macOS-en gyakran csak `::1`). A config már `--host 127.0.0.1`-gyel indítja; ha magad futtatod a szervert, ugyanezt a kapcsolót add meg. |
| `BLOCKER frontend` | Ugyanaz, mint fent: a `E2E_BASE_URL` címen nincs válaszoló frontend. |
| `BLOCKER authentik` | A full profile nem fut, vagy a blueprint még nem alkalmazódott. Nézd meg: `docker compose --profile full logs authentik-worker`. |
| `role "poc" does not exist`, miközben a konténerben létezik | Egy helyi (nem dockeres) PostgreSQL foglalja ugyanazt a portot `127.0.0.1`-en. macOS-en a specifikus bind elfedi a Docker `*:port` bindjét, így a kapcsolat a helyi szerverre fut. Ellenőrzés: `lsof -nP -iTCP:<port> -sTCP:LISTEN` – ha két listener van, válassz szabad portot a compose-nak (`POSTGRES_PORT` a `backend/.env`-ben), és a `DATABASE_URL`-t is írd át mindkét env fájlban. |
| `BLOCKER backend` + `leállt indikátor: postgres` | Futtasd: `cd poc/backend && ENV_FILE=.env.e2e node scripts/check-e2e-db.mjs` – megmondja, hogy port, jelszó, adatbázisnév vagy hiányzó migráció az ok. Ha a DB önmagában rendben van, a backend process fut még a régi env fájllal: állítsd le (a 3000-es portot foglaló processzt) és indítsd újra. |
| `BLOCKER identity` | A backend `FEATURE_IDENTITY=off`, vagy nem éri el az OIDC discoveryt. |
| `BLOCKER search` | `FEATURE_SEARCH=off`, vagy egyik Meilisearch instance sem routolható. |
| Az Authentik `redirect_uri` hibát ad | A frontend nem a `127.0.0.1:5173` originen fut (a `localhost` nem ugyanaz). |
| A bejelentkezés időtúllépéssel áll meg (`utolsó stage: password`) | Az Authentik elutasította a jelszót, és visszadobta a flow-t az első stage-re. Ellenőrzés: `cd poc/backend && ENV_FILE=.env.e2e node scripts/authentik-poc-users.mjs`; szinkronizálás az env fájlhoz: ugyanez `--set-password` kapcsolóval. A blueprint csak a felhasználó létrehozásakor írja be a jelszót, ezért egy régebbi authentik kötet jelszava eltérhet. |
| A backend indulásakor DB kapcsolati hiba | A `.env.e2e` `DATABASE_URL` portja nem egyezik a `backend/.env` `POSTGRES_PORT` értékével. |
| A katalógus teszt nem találja a tartalmat | A projekció még indexel; a helper 90 s-ig vár. Tartósan: nézd meg az operations dashboard Outbox/Relay kártyáját. |
