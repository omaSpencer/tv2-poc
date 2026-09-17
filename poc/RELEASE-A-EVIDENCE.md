# Release A futtatási jegyzőkönyv

2026-09-17 · Full-stack böngészős E2E a Release A scope-ra (Fázis 0–4).

Runbook: [frontend/e2e/README.md](frontend/e2e/README.md).

## Környezet

| Elem | Érték |
| --- | --- |
| Node | 24.20.x (frontend `engines`) |
| Playwright | 1.63.0, Chromium |
| Viewport | 1280×800 és 360×800 |
| Backend | NestJS, `ENV_FILE=.env.e2e`, `FEATURE_IDENTITY|OUTBOX_RELAY|SEARCH=on` |
| Infrastruktúra | `docker compose --profile full`: PostgreSQL 17, NATS JetStream, Meilisearch A/B, Authentik 2025.8 |
| Identitások | `poc-viewer`, `poc-editor`, `poc-publisher` (blueprint, group-backed role) |

## Parancsok

```bash
cd poc/frontend
npm run verify   # contract + build + React Compiler + lint + unit/component
npm run e2e      # típusellenőrzés + full-stack Playwright suite
E2E_DOCKER_CONTROL=true npm run e2e -- --grep @outage
```

## Eredmény

| Kapu | Eredmény |
| --- | --- |
| Frontend fast gate (`npm run verify`) | **zöld** – 19 fájl, 106/106 teszt, 0 lint warning |
| Alap full-stack E2E (`npm run e2e`) | **17 passed, 1 skipped, 0 failed** (134 s); az opt-in outage eset itt szándékosan skip |
| Valódi kiesési E2E (`@outage`) | **1 passed, 0 skipped, 0 failed**; teszt 38,4 s, teljes külön futás 61,0 s |
| Release A összes kijelölt E2E esete | **18 passed, 0 nyitott, 0 failed**, két szándékosan külön futtatott invokációban |

### Lefedett kötelező ellenőrzések

| Teszt | Bizonyított viselkedés |
| --- | --- |
| E2E-01 (6 eset) | viewer/editor/publisher valódi PKCE belépés; `/me` szerinti navigáció és route-hozzáférés; hard reload után megmaradó munkamenet; 403 külön UX megtartott munkamenettel; logout; `returnTo` nem irányít idegen originre |
| E2E-02 (3 eset) | v1 → v6 életciklus UUID másolása nélkül; published tartalom csak olvasható; no-op mentés nem növel verziót; audit 6 bejegyzése pontos sorrendben; publikálás után katalógusban megjelenik, visszavonás után eltűnik és a detail 404-et ad; editor nem publikálhat; hiányos piszkozat megnevezi a hiányzó mezőket |
| E2E-03 (1 eset) | két browser context 409-e; helyi és szerverérték összevetése; kézi újraalkalmazás adatvesztés nélkül; pontosan 2 PATCH, automatikus újraküldés nélkül |
| E2E-04 (4 eset) | anonymous keresés → szűrés → lapozás → detail → vissza; bookmarkolható URL; `returned` és `estimatedTotalHits` külön; operations kártyák és „Teljes A/B rendelkezésre állás” |
| P7-12 (3 eset) | 360 px kártyanézet és vízszintes túlcsordulás-mentesség a katalóguson, a listán és az operations dashboardon |

### Valódi A/B kiesési bizonyíték

| Eset | Eredmény |
| --- | --- |
| Egy index kiesése | **pass** – az operations dashboard fallback/csökkent redundancia állapotot mutat, a publikus keresés az egészséges indexről tovább működik |
| Mindkét index kiesése | **pass** – a dashboard nem routolható állapotot, a katalógus `search_unavailable` UX-et mutat; a CMS-adat nem vész el |
| A és B visszaindítása | **pass** – a dashboard visszaáll teljes A/B rendelkezésre állásra, az újrapróbált keresés ismét találatot ad |

Az alap suite-ban az `@outage` szándékosan skipelt, mert ott
`E2E_DOCKER_CONTROL=false` volt. A release-kaput a külön, opt-in futás zárta le;
a riport szerint 1/1 eset sikeres, skip és hiba nélkül.

## A futás során talált és javított hibák

| Hiba | Hol | Javítás |
| --- | --- | --- |
| Sikeres mentés után a dirty guard blokkolta a saját átirányítást (valódi UX-hiba: a felhasználó „elvesznek a módosítások” kérdést kap egy már elmentett tartalomra, és a Mégse duplikálást okozhat) | `ContentCreatePage`, `ContentEditPage` konfliktus-ágak | az átirányítás effektben fut le, miután a guard lefegyverződött |
| A Vite watcher a Playwright trace fájljaira HMR reloadot küldött futás közben | `vite.config.ts` | `server.watch.ignored` kizárja az `e2e/.artifacts` és `e2e/.report` fát |
| A Vitest default include-ja felszedte volna a Playwright specifikációkat | `vitest.config.ts` | `include: ['src/**/*.{test,spec}.{ts,tsx}']` |

## Környezeti buktatók (a runbookba is bekerültek)

- A Vite dev szervernek `--host 127.0.0.1`-gyel kell indulnia: a default `localhost` bind macOS-en gyakran csak `::1`-re áll fel, az Authentik strict redirect viszont IPv4-re szól.
- Egy helyi (nem dockeres) PostgreSQL elfedheti a Docker publikált portját `127.0.0.1`-en; a tünet „role does not exist”, miközben a konténerben létezik a role.
- A postgres és az authentik jelszavak csak a kötet első inicializálásakor íródnak be; későbbi env-módosítás nem hat rájuk (`scripts/check-e2e-db.mjs`, `scripts/authentik-poc-users.mjs`).

## Ismert korlátok

- Az access token 5 perces lejárta utáni refresh valós L2 méréssel nincs bizonyítva (a hard reload igen).
- A csoportváltozás és signing-key rotation valós L2 mérése még nyitott.
- Az IdP-kiesés hibamátrixa valós Authentik leállítással nincs bizonyítva.
- A publikus keresés 422 ága E2E-ből nem váltható ki (a frontend kliensoldalon kanonizálja a query paramétereket); komponensteszt fedi.
- Az axe/WCAG automata kapu (P7-11), a 768 px viewport és a Firefox/WebKit smoke még nyitott.
- CI job még nincs; a suite lokálisan futtatható.

## Release-döntés

**Release A: KÉSZ (2026-09-17).** A scope összes lezárási lépése (RA-01–RA-06)
teljesült. Bizonyított a valódi PKCE belépés és jogosultságkezelés, a content
lifecycle és konfliktusfeloldás, a publikus katalógus, az operations dashboard,
valamint az egy- és kétindexes kiesésből való helyreállás.

A fenti ismert korlátok nem maradt Release A blokkerek: a tokenlejárat utáni
refresh, a csoportváltozás/key rotation, az IdP-kiesési hibamátrix, a további
böngészők/viewportok, az axe-kapu és a CI automatizálása a későbbi
minőségkapuhoz követett munka.
