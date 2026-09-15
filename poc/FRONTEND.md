# Frontend playground – high level terv

2026-09-15 · Kezdő dokumentum a Vite + React API-playgroundhoz.

Ez a fájl a backend mellé készülő **fejlesztői playground** célját, határait és a későbbi megvalósítás irányát rögzíti. Nem implementációs backlog, nem UI-wireframe, és nem termelési frontend-terv.

Kiindulópont: [README](README.md), [milestone-terv](MILESTONES.md), [fázisterv](PHASES.md), [döntésnapló](DECISIONS.md), [backend README](backend/README.md).

## 1. Miért van frontend a PoC mellett?

A README szerinti alap-PoC **nem tartalmaz kész szerkesztőfelületet**: a CMS szerkesztői backend, a bemutatáshoz OpenAPI és parancssoros/API-klienses demó is elegendő. Ettől függetlenül hasznos egy vékony, böngészős kliens, amely:

1. ugyanarra a HTTP-szerződésre hív, amit a backend tesztek és a smoke is használ;
2. gyorsan végigjárhatóvá teszi a tartalom-életciklust és a későbbi keresési/kiesési helyzeteket;
3. demó közben láthatóvá teszi a szerepkörök, hibakódok és állapotátmenetek különbségét, anélkül hogy curl-láncot kellene magyarázni.

A playground **integrációs és demóeszköz**, nem termékfelület. A siker az API helyes használata és a forgatókönyvek bemutathatósága; a vizuális minőség, accessibility-audit és design system nem cél.

## 2. Cél és nem-cél

| Cél | Nem cél |
| --- | --- |
| Vite + React alkalmazás a `poc/` fa alatt, a backend mellé | Termelési CMS, nézői app, mobilklient |
| TanStack Query a szerverállapot olvasására és mutációira | Saját globális store az API igazsághelyettesítésére |
| Admin és katalógus végpontok kézi kipróbálása | Teljes tartalomkezelő UX (lista-szűrők, bulk műveletek, rich text) |
| M1 mintafolyamat és negatív esetek demózása, ha van idő | M5 helyreállási bizonyítékok helyettesítése UI-ból |
| M2 után valódi Authentik belépés a böngészőből | Saját jelszókezelés, session-cookie a NestJS-ben |
| problem+json hibák olvasható megjelenítése | Design polish, i18n-rendszer, brand UI |

A backend marad az igazságforrás. A playground nem vezet be párhuzamos üzleti szabályt, nem küld „actor” headert vagy body-mezőt identitásként, és nem kerüli meg a `FEATURE_IDENTITY` / permission szerződést.

## 3. Technológiai keret

| Választás | Szerep a playgroundban |
| --- | --- |
| Vite | Gyors helyi dev szerver, egyszerű proxy a NestJS felé |
| React + TypeScript | Komponensek a forgatókönyv-lépésekhez |
| TanStack Query | GET-ek cache/refetch; POST/PATCH invalidáció; retry csak ahol a szerződés engedi |
| natív `fetch` vagy vékony API-réteg | Egy helyen: base URL, Bearer token, `X-Correlation-Id`, problem+json parse |
| React Router (opcionális, vékony) | Admin / katalógus / demó forgatókönyv oldalak |
| Authentik Authorization Code + PKCE | Csak M2 után; a backend resource server marad, tokencserét a kliens végzi |

**Nem tervezett** a playground első körében: Redux/Zustand az API-állapotra, SSR/Next.js, UI kit kötelező használata, E2E Playwright-csomag a PoC kapujaként, OpenAPI-codegen kötelező előfeltételként. Ha később codegen hasznos, a szerződés forrása továbbra is a backend `contracts/` és az OpenAPI (`/docs-json`).

### 3.1 Könyvtárhely

Javasolt elhelyezés:

```text
poc/
  backend/          # meglévő NestJS PoC
  frontend/         # Vite React playground (scaffold kész: health + katalógus)
  FRONTEND.md       # ez a dokumentum
  README.md
  ...
```

A frontend saját `package.json`-nel és lockfile-lal indul. Nem kerül a backend monorepo workspace-ébe, amíg arra külön döntés nincs. A helyi fejlesztés tipikus képe: backend `localhost:3000`, Vite `localhost:5173`, Vite proxy `/api` → backend, hogy a böngésző ne CORS-problémán akadjon el.

## 4. Viszony a backend mérföldkövekhez

A playground a backend állapotához igazodik; nem előzi meg a szerződéses kapukat.

| Backend állapot | Mit tud a playground? |
| --- | --- |
| **Most (M0–M1 kész, `FEATURE_IDENTITY=off`)** | Health, OpenAPI-link, nyilvános `GET /catalog/contents/:id`. Az egész `/admin` prefix **503** `dependency_unavailable` – ez szándékos, nem bug a UI-ban. |
| **M2 (valódi identity)** | PKCE belépés, `/me`, szerepkörönkénti admin műveletek, 401/403 demó. Itt válik élővé a szerkesztői életciklus a böngészőben. |
| **M3** | Feldolgozási állapot olvasása (`ops:read`), outbox/pending jelzés a demóban – ha a végpont kész. |
| **M4** | `GET /catalog/search`, fallback/lemaradás látható jelzése a találati oldalon. |
| **M5** | A playground segíthet a demó narratívájában; a helyreállási bizonyíték továbbra is a jegyzőkönyv és a futtató script felelőssége. |

Amíg nincs M2, a teljes M1 admin-életciklus **nem** a playground elsődleges bizonyítéka: arra megmarad a `npm run demo:m1` és az integrációs tesztek. A playground scaffoldja és a katalógus/health felület viszont már most felépíthető.

## 5. API-felületek, amelyeket a UI érint

A route-mátrix forrása: `backend/src/contracts/permissions.ts`.

### 5.1 Mindig / hamar elérhető

| Végpont | Playground szerep |
| --- | --- |
| `GET /health/live`, `GET /health/ready` | Kapcsolat- és readiness jelző a fejlécben |
| `GET /docs`, `GET /docs-json` | Link a szerződő OpenAPI-hoz |
| `GET /catalog/contents/:id` | Publikált részlet; nem publikált / ismeretlen → 404 |

### 5.2 M2 után (admin + identity)

| Végpont | Jog | Playground szerep |
| --- | --- | --- |
| `GET /me` | authenticated | Ki vagyok, milyen role/permission látszik |
| `POST /admin/contents` | `content:write` | Draft létrehozás |
| `PATCH /admin/contents/:id` | `content:write` | Draft/withdrawn szerkesztés + `expectedVersion` |
| `POST /admin/contents/:id/publish` | `content:publish` | Publikálás |
| `POST /admin/contents/:id/withdraw` | `content:publish` | Visszavonás |
| `GET /admin/contents/:id` | `content:read` | Szerkesztői nézet (mediaAssetId is) |

### 5.3 Későbbi milestone-ok

| Végpont | Milestone | Playground szerep |
| --- | --- | --- |
| `GET /admin/processing-status` | M3 | Outbox / feldolgozás demópanel |
| `GET /catalog/search?q=...` | M4 | Nézői keresés, stale/fallback magyarázat |

### 5.4 Kliensszerződés-részletek

- Hibák: `application/problem+json` (`code`, `detail`, `correlationId`; konfliktusnál `expectedVersion` / `actualVersion`; validációnál `fields`).
- Minden mutációnál a kliens visszaküldi a legutóbb látott `version` értéket `expectedVersion`-ként.
- Bejövő `X-Correlation-Id` opcionális; a UI megjelenítheti a válasz fejlécét a demó követhetőségéhez.
- Nyilvános katalógusnézet **nem** tartalmaz `mediaAssetId`-t, actort, auditot.
- Publikus keresés és részlet a PoC-ban login nélkül elérhető; a viewer login külön demóelem M2-től.

## 6. Javasolt UI-felületek (váz)

Nem pixelpontos design, hanem demó-navigáció:

1. **Állapot sáv** – backend URL, live/ready, identity be/ki, bejelentkezett role, utolsó `correlationId`.
2. **Belépés** – M2: Authentik PKCE; előtte egyértelmű üzenet, hogy az admin API zárva.
3. **Szerkesztői munkalap** – egy tartalom id alapján: mezők, státusz, verzió, Create / Patch / Publish / Withdraw gombok; a válasz JSON és a problem+json olvashatóan.
4. **Katalógus nézet** – ugyanarra az id-re publikus GET; visszavonás után 404 a demó punchline-ja.
5. **Forgatókönyv panel** – előre definiált lépéssor (lásd 7. szakasz), a mintafixture értékeivel előtöltve.
6. **Keresés** (M4) – query mező, találati lista, rövid magyarázat ha a lista rövidebb a stale szűrés miatt.

A UI lehetőleg **egy tartalom** köré szerveződik (a PoC közös mintatartalma), nem tartalomkatalógus-böngészővé nő.

## 7. Demózható forgatókönyvek

A backend mintafixture (`DEMO_CONTENT` és társai) marad a közös történet. A playground ezeket gombokkal / lépéslistával teszi láthatóvá.

### 7.1 Alap életciklus (M2 után élő HTTP-rel)

Ugyanaz a ív, mint az M1 demó:

1. Draft létrehozás → v1  
2. Szerkesztés → v2  
3. Publikálás → v3; katalógus GET siker  
4. Visszavonás → v4; katalógus GET 404  
5. Withdrawn szerkesztés → v5  
6. Újrapublikálás → v6; katalógus GET ismét siker  

### 7.2 Negatív / szabálybemutató esetek (ha van idő)

| Forgatókönyv | Elvárt jelzés a UI-n |
| --- | --- |
| Hiányos publish (pl. nincs `mediaAssetId`) | 422, tartalom draft marad |
| Published szerkesztése | 409 `content_not_editable` |
| Elavult `expectedVersion` | 409 `version_conflict` + actual/expected |
| Viewer adminírás | 403 `forbidden` |
| Lejárt / rossz token | 401 `unauthenticated` |
| Identity ki, admin hívás | 503 `dependency_unavailable` |
| Keresés mindkét index nélkül (M4) | 503 `search_unavailable` |

### 7.3 Aszinkron demóelemek (M3–M4)

- Publikálás után: „DB-ben published ≠ azonnal kereshető” szöveges jelzés.
- Processing-status panel: pending outbox / lag (ha a végpont kész).
- Egy index kiesése: keresés még megy; mindkettő kiesése: egyértelmű 503 a keresőoldalon, miközben az admin mentés külön ellenőrizhető.

## 8. TanStack Query irányelvek

- **Query key** a erőforrás és a paraméterek körül forogjon: pl. `['health']`, `['me']`, `['admin-content', id]`, `['catalog-content', id]`, `['search', q]`.
- **Mutáció után** invalidálni kell az érintett admin- és katalógus-queryket; a verziószám a válaszból jön, nem kliensoldali tippelésből.
- **Retry:** 4xx (különösen 401/403/404/409/422) ne legyen vakon újrapróbálva. 503/hálózati hiba korlátozott retryvel, demóban látható státusszal.
- **Optimistic update** az első körben kerülendő: a PoC pont az optimista konkurencia és a szerverigazság bemutatásáról szól.
- A problem+json `code` mezője legyen a UI elágazás stabil kulcsa, ne a nyers HTTP status szöveg.

## 9. Identity a böngészőben

A backend M2 után sem tárol sessiont és nem végez tokencserét. A playground:

1. Authorization Code + PKCE flow-val kér access tokent az Authentiktől;
2. az access tokent `Authorization: Bearer` fejlécben küldi;
3. refresh-t a kliens oldalon kezeli a dokumentált élettartamok szerint;
4. ID tokent **nem** használ API-híváshoz.

Három demófiók: viewer / editor / publisher – a jogosultsági mátrix szerint. Token nélküli katalógushívás továbbra is érvényes PoC-szabály.

Amíg `FEATURE_IDENTITY=off`, a playground ne inventáljon „dev actor” bypass-t a böngészőből. Ha később kifejezetten helyi stub kell a UI fejlesztéséhez, az külön, dokumentált backend/test-összeállítás legyen – nem a normál `npm start` útvonal.

## 10. Megvalósítási sorrend

1. **Scaffold** – `poc/frontend` Vite React TS, TanStack Query, env + proxy, health widget. ✅  
2. **Katalógus + hibapanel** – publikus GET, problem+json megjelenítő, correlation id. ✅  
3. **Szerkesztői űrlap váz** – mezők és gombok; M2 előtt disabled + magyarázat a 503-ról. (placeholder kész)  
4. **M2 kötés** – PKCE, `/me`, role-alapú gombok, 401/403 forgatókönyvek.  
5. **Forgatókönyv runner** – a 7.1 lépéssor egy kattintásos / lépésenkénti demója a fixture értékekkel.  
6. **M3/M4 panelek** – processing-status, search, kiesés-magyarázatok idő függvényében.

A futtatás: [frontend/README.md](frontend/README.md).

---

**Következő lépés:** M2 identity bekötése után a szerkesztői űrlap és a PKCE belépés; addig a katalógus/health playground használható a futó backend ellen.

## 11. Elfogadás – mit jelent „kész a playground”?

Minimum:

- [x] Dokumentált parancsokkal indul a Vite app a futó backend mellett.
- [x] Health és legalább egy publikus katalógushívás működik a UI-ból.
- [x] A problem+json hibák kódja és correlation id-ja látszik.
- [x] Nincs identity-bypass a normál backend ellen.

M2 utáni demó-minimum:

- [ ] Editor létrehoz/szerkeszt, publisher publikál/visszavon, viewer tiltott írása 403.
- [ ] A mintatartalom végigjárható; visszavonás után a katalógus 404.
- [ ] A `expectedVersion` konfliktus bemutatható.

M4 utáni bónusz: keresőoldal a dokumentált fallback-viselkedés rövid magyarázatával.

## 12. Kapcsolódó dokumentumok

- Üzleti folyamat és API-tábla: [README](README.md)
- Életciklus és bemutatandó helyzetek: [PHASES](PHASES.md) (különösen M1, M2, M4)
- Szerepek és nyilvános olvasás: [DECISIONS](DECISIONS.md) D04, D06
- Backend futtatás: [backend/README](backend/README.md)
- Identity részletterv: [M2-IMPLEMENTATION](M2-IMPLEMENTATION.md)
