# Frontend implementációs terv az elkészült backendhez

2026-09-16 · A `frontend/` és a `backend/` aktuális forrása alapján.

> Státuszfrissítés: a Fázis 0 és a Fázis 1 P1-01–P1-11 munkacsomagja már
> implementált; a Fázis 2 backend- és frontendcsomagja, valamint a Fázis 3–4 helyi
> implementációja is elkészült. A lentebbi
> audit az indulási baseline-t rögzíti; a valódi Authentik L2 ellenőrzés és az
> arra épülő böngészős E2E továbbra is külső függőségen vár.

## 1. Vezetői összefoglaló

A jelenlegi frontend jó API-playground: eléri a health, identity, tartalom-életciklus,
publikus részlet, keresés és processing végpontokat, kezeli a `problem+json` hibákat,
és végig tud vezetni egy kézi demófolyamaton. Nem alkalmas még arra, hogy a backend
M0–M5 képességeinek teljes, megbízható UI-ja legyen.

A legfontosabb okok:

1. A frontend több helyen még azt jelzi, hogy M3/M4 nincs kész, miközben a backend
   M5 vezérlősíkig implementált.
2. A keresés és a processing frontendtípusai eltérnek a backend tényleges
   szerződésétől.
3. A valódi Authentik PKCE belépés nincs bekötve; a felhasználó kézzel másol be
   Bearer tokent.
4. A tartalomkezelés UUID-alapú fejlesztői munkalap, nem szerkesztői munkafolyamat.
5. Az M5 operátori műveletek — reindex, karantén inspect/replay és célzott indexrepair —
   csak CLI-n érhetők el, így ezekhez előbb biztonságos admin API szükséges.
6. Nincs frontendteszt, és az OpenAPI-ból kézzel tükrözött típusok már el is sodródtak.

Javasolt megközelítés: nyolc egymásra épülő fázis. Először a szerződésdriftet és az
authot kell rendezni, majd a szerkesztői és publikus folyamatokat, ezután az
operációs megfigyelést és végül az M5 beavatkozásokat. A részletes bontás után,
egy fejlesztővel és részidős backend támogatással a reális nagyságrend 36–52
mérnöknap. A korábbi 28–41 napos durva becslést főleg a tartós operátori
idempotency/restart recovery és a teljes release gate emelte meg. Az Authentik
L2 környezet elérhetősége külön külső függőség.

### 1.1 Végrehajtási dokumentumok

| Fázis | Részletezettség | Dokumentum | Állapot |
| --- | --- | --- | --- |
| 0 | ticket-szintű | [Stabilizálás és szerződéshelyreállítás](FRONTEND-PHASE-0-IMPLEMENTATION.md) | implementálva, gate-ek zöldek |
| döntési kapu | rögzített contract | [Identity és UI-glue API-döntések](FRONTEND-IDENTITY-AND-API-DECISIONS.md) | kész; Authentik L2 külső kapu nyitott |
| 1 | ticket-szintű | [Alkalmazásváz és valódi identity](FRONTEND-PHASE-1-IMPLEMENTATION.md) | P1-01–11 implementálva; P1-12 L2 pending |
| 2 | ticket-szintű BE+FE | [Szerkesztői tartalomkezelés](FRONTEND-PHASE-2-IMPLEMENTATION.md) | implementálva; Authentik L2 E2E pending |
| 3 | delivery brief | [Publikus katalógus és keresés](FRONTEND-PHASE-3-DELIVERY-BRIEF.md) | implementálva; full-stack browser E2E pending |
| 4 | delivery brief | [Operációs megfigyelő dashboard](FRONTEND-PHASE-4-DELIVERY-BRIEF.md) | ready for breakdown |
| 5 | közös BE+FE, ticket-szintű | [M5 operátori beavatkozások](FRONTEND-PHASE-5-JOINT-IMPLEMENTATION.md) | dev-ready |
| 6 | ticket-szintű | [Vezetett demó és bizonyíték](FRONTEND-PHASE-6-IMPLEMENTATION.md) | dev-ready a belépési kapuk után |
| 7 | release gate | [Minőségkapu és átadás](FRONTEND-PHASE-7-QUALITY-GATE.md) | rögzített |

## 2. A jelenlegi demo auditja

### 2.1 Ami már jó alap

- Vite + React + TypeScript, React Router és TanStack Query már be van kötve.
- Egy közös API-kliens kezeli a base URL-t, Bearer tokent, correlation ID-t és a
  `problem+json` választ.
- A `StatusBar` külön mutatja a liveness, readiness és identity állapotot.
- A `GET /me` és a szerep/permission mátrix megjelenik.
- A create, read, patch, publish és withdraw műveletek elérhetők.
- A kliens a szervertől kapott verziót küldi vissza `expectedVersion` értékként.
- A publikus részlet login nélkül elérhető, és a withdraw utáni 404 látható.
- A keresés és a processing oldal már rendelkezik loading/error/empty alapállapotokkal.
- A demóoldal a teljes draft → publish → withdraw → republish ívet lefedi.
- A frontend build sikeres a gépen elérhető Node 22 runtime-mal; a lint csak öt
  figyelmeztetést ad. Az alapértelmezett, Homebrew Node 21 telepítés hibás ICU-link
  miatt nem indul, miközben a backend Node 24.20-at követel.

### 2.2 Kritikus eltérések és hiányok

| Terület | Jelenlegi állapot | Következmény | Prioritás |
| --- | --- | --- | --- |
| API-típusok | Kézzel másolt TypeScript típusok | A fordítás nem jelzi a backend szerződésdriftet | P0 |
| Search response | A UI `total`, `source`, `truncatedByDbFilter` mezőket vár | A backend valójában `returned` és `estimatedTotalHits` mezőket ad | P0 |
| Search query | Csak `q`, részben `limit/offset` | A `category`, lapozás és teljes validáció nincs UI-n | P0/P1 |
| Processing response | A UI `oldestAgeSeconds` mezőt vár | A backend `oldestAgeMs` és `oldestOccurredAt` mezőket ad | P0 |
| Processing UI | Csak két outbox mező látható | Relay, broker, consumerek, karantén, A/B runtime és M5 phase rejtve marad | P1 |
| Milestone jelzés | M3/M4 oldalak mindig „még nincs kész” kaput mutatnak | Félrevezető a jelenlegi backend mellett | P0 |
| Identity | Kézi tokenmásolás; a PKCE gomb disabled | Nincs valódi belépés, refresh és callback | P0/P1 |
| Tartalomnavigáció | Kézzel megadott UUID | Nincs szerkesztői tartalomlista vagy közvetlen munkafolyamat | P1 |
| Tartaloműrlap | Nyers API-mezőnevek, kevés kliensvalidáció | Könnyű hibás adatot küldeni; a publish minimum csak hibából derül ki | P1 |
| Lifecycle UX | A gombok főleg permission alapján tiltódnak | A státuszfüggő műveletek és következő lépés nem egyértelműek | P1 |
| Version conflict | Csak nyers 409 panel | Nincs újratöltés, összehasonlítás vagy biztonságos újrapróbálás | P1 |
| Audit | Backend ír auditot, UI/API olvasás nincs | A felhasználó nem látja, ki és mit változtatott | P2 |
| M5 műveletek | Csak CLI | Böngészőből nem indítható reindex/replay/repair | P2 |
| Demo validáció | Több negatív lépés bármilyen hibát elfogad sikerként | Hamis pozitív demóeredmény lehetséges | P0 |
| Tesztek | Nincs frontend unit/component/E2E | A kritikus auth és lifecycle regressziók kézzel derülnek ki | P0/P1 |
| Dokumentáció | `FRONTEND.md` és részben a gyökér README régi státuszt ír | A csapat nem ugyanabból az állapotból tervez | P0 |

### 2.3 Backend-képesség → cél-UI lefedési mátrix

| Backend-képesség | Elérési mód most | Jelenlegi UI | Cél-UI | Kell backend-bővítés? |
| --- | --- | --- | --- | --- |
| Live / ready health | HTTP | Státuszjelző | Globális státusz + részletes függőségi tooltip | Nem |
| OpenAPI | HTTP | Külső link | Marad fejlesztői linkként | Nem |
| OIDC identity és `/me` | HTTP | Kézi Bearer | PKCE login/callback/refresh/logout, lejárati jelzés | Authentik L2 konfiguráció kell, új üzleti API nem |
| Role/permission ellenőrzés | HTTP guard | Mátrix + gombtiltás | Role-aware navigáció és route/action guard | Nem |
| Draft létrehozás | HTTP | Egy munkalap | „Új tartalom” folyamat validált űrlappal | Nem |
| Admin részlet | HTTP | UUID alapján | Tartalomrészlet és szerkesztő nézet | Nem |
| Draft/withdrawn szerkesztés | HTTP | Teljes PATCH | Dirty state, validáció, no-op és conflict UX | Nem |
| Publish/withdraw/republish | HTTP | Közös gombsor | Állapotgép, readiness checklist, megerősítés | Nem |
| Audit trail | Belső repository | Nincs | Tartalom idővonala | Igen: read endpoint |
| Tartalom felfedezése | Nincs admin list endpoint | UUID kézi mező | Lapozott admin lista, státusz- és szövegszűrés | Igen: list endpoint |
| Publikus tartalomrészlet | HTTP | Nyers JSON | Katalóguskártya és technikai részletek disclosure-ben | Nem |
| Publikus keresés | HTTP | Egyszerű query/lista | Kategóriaszűrő, lapozás, returned/estimate magyarázat | Nem |
| Outbox állapot | HTTP processing-status | Részleges | KPI-k: pending, oldest time/age | Nem |
| Relay/broker állapot | HTTP processing-status | Csak nyers JSON | Állapotkártyák, utolsó kézbesítés/hiba | Nem |
| Durable consumerek | HTTP processing-status | Csak nyers JSON | Pending/ack floor/oldest unfinished táblázat | Nem |
| Karantén darabszám | HTTP processing-status | Csak nyers JSON | Riasztás és belépés a karantén képernyőre | Nem |
| A/B worker állapot | HTTP processing-status | Csak nyers JSON | Külön A/B állapot, reachability, in-flight task/event | Nem |
| M5 tartós reindex állapot | HTTP processing-status | Típusszinten sem pontos | Phase, progress, boundaries, route eligibility | Nem |
| Reindex indítás | CLI | Nincs | Vezetett operátori művelet és progress | Igen: async ops endpoint |
| Karantén inspect/replay | CLI | Nincs | Lista, titokmentes részlet, indoklásos replay | Igen: ops endpointok |
| Célzott content repair | CLI | Nincs | UUID + A/B/both javító művelet | Igen: ops endpoint |
| Fault injection, smoke, baseline | CLI/tesztharness | Szöveges narratíva | Vezetett runbook + élő megfigyelés; futtatás marad CLI | Nem javasolt UI-ról futtatni |
| Media/Ant Media | Nincs implementálva, feature flag startuphibát ad | Nincs | Nem része ennek a tervnek | Későbbi M6 |

## 3. Célfelület és információs architektúra

A jelenlegi technikai route-nevek helyett szerepalapú munkaterületek javasoltak.

| Route | Képernyő | Elsődleges célcsoport |
| --- | --- | --- |
| `/` | Áttekintő dashboard: rendszerállapot, saját szerep, gyorsműveletek | mindenki |
| `/login` | Authentik belépés / auth állapot | mindenki |
| `/auth/callback` | PKCE callback, automatikus továbbirányítás | technikai route |
| `/contents` | Admin tartalomlista | editor, publisher |
| `/contents/new` | Új draft | editor, publisher |
| `/contents/:id` | Tartalom áttekintő + audit idővonal | editor, publisher |
| `/contents/:id/edit` | Draft/withdrawn szerkesztés | editor, publisher |
| `/catalog/search` | Publikus keresés | anonim/viewer |
| `/catalog/:id` | Publikus részlet | anonim/viewer |
| `/operations` | Outbox, relay, broker, consumerek, A/B indexek | publisher/ops |
| `/operations/indexes/:alias` | Index részlet, reindex progress és indítás | ops write |
| `/operations/quarantine` | Karantén lista és inspect/replay | ops write |
| `/operations/repair` | Célzott content → index repair | ops write |
| `/demo` | Vezetett üzleti és kiesési demó | fejlesztő/demózó |

Az OpenAPI-link, nyers JSON, correlation ID és technikai mezők megmaradhatnak,
de alaphelyzetben „Technikai részletek” disclosure-be kerüljenek. A fő felület
felhasználói állapotokat és következő lépést mutasson, ne HTTP-végpontokat.

## 4. Frontend célarchitektúra

### 4.1 Javasolt könyvtárszerkezet

```text
frontend/src/
  app/
    router.tsx
    providers.tsx
    queryClient.ts
  api/
    client.ts
    generated/              # OpenAPI-ból generált, nem kézzel szerkesztett
    queryKeys.ts
  auth/
    oidc.ts
    AuthProvider.tsx
    RequireAuth.tsx
    RequirePermission.tsx
  features/
    dashboard/
    contents/
      api.ts
      schemas.ts
      ContentForm.tsx
      ContentStatusBadge.tsx
      VersionConflictDialog.tsx
      AuditTimeline.tsx
    catalog/
    operations/
      ProcessingOverview.tsx
      IndexStatusCard.tsx
      ReindexWizard.tsx
      QuarantineTable.tsx
      RepairForm.tsx
    demo/
      scenarios.ts
      ScenarioRunner.tsx
  components/
    AsyncState.tsx
    ProblemDetails.tsx
    ConfirmDialog.tsx
    TechnicalDetails.tsx
```

### 4.2 API-szerződés

- A backend `/docs-json` dokumentumából generáljunk TypeScript típusokat
  (`openapi-typescript` vagy hasonló, csak típusgenerálás).
- A generált snapshot legyen commitolva, hogy a frontend build ne igényeljen futó
  backendet.
- CI-ben külön contract-drift ellenőrzés generálja újra és bukjon, ha diff marad.
- A kézzel írt API-réteg csak a fetch, auth fejléc, correlation ID, timeout,
  `problem+json` és endpointonkénti kényelmi wrapper felelőse legyen.
- A `ProblemDocument.code` maradjon az UI elágazás stabil kulcsa.
- A retry szabály: 4xx soha; idempotens GET 5xx/hálózati hibára legfeljebb egy
  automatikus retry; mutation soha ne ismétlődjön automatikusan.

### 4.3 Auth és kliensállapot

- Authorization Code + PKCE SPA-kliens, javasoltan `oidc-client-ts`.
- Callback route, state/nonce/PKCE verifikáció, tokenlejárat és refresh kezelése.
- Az access token ne jelenjen meg a normál UI-ban és logban.
- A kézi tokenmező csak explicit `VITE_ALLOW_MANUAL_TOKEN=true` fejlesztői módban
  maradjon elérhető, jól látható „dev only” jelzéssel.
- A `/me` legyen az alkalmazásszerep igazságforrása; a token nyers claimjeiből a
  frontend ne számoljon permissiont.
- Az auth változás törölje a felhasználófüggő query cache-t.
- 401 esetén egyszeri session-helyreállítás vagy login; 403 esetén jogosultsági
  üzenet; 503 identity hibánál külön függőségi állapot.

### 4.4 Űrlap és állapotkezelés

- API server state: TanStack Query marad.
- Űrlap: React Hook Form + Zod, a backend limitekkel azonos klienssémával.
- Nincs optimistic update a content verzióra.
- A mentett szerverválasz azonnal frissítse a form reset-baseline-t és a verziót.
- Navigáció előtt legyen dirty-form figyelmeztetés.
- A publish minimum (`title`, `summary`, `category`, `mediaAssetId`) látható
  checklist legyen, de a szerver maradjon a végső döntéshozó.

## 5. Szükséges backend kiegészítések

A jelenlegi HTTP-végpontok teljes read/write lifecycle UI-jához nincs szükség
üzleti logika újraírására. A használható szerkesztői navigációhoz és az M5
operátori műveletekhez azonban az alábbi vékony API-k szükségesek.

### 5.1 Szerkesztői „UI-glue” endpointok

1. `GET /admin/contents`
   - permission: `content:read`;
   - query: `q`, `status`, `category`, `limit`, `cursor`;
   - stabil, cursoros lapozás `updatedAt + id` alapján;
   - rövid lista-view, de a `version` és `status` legyen benne;
   - alapértelmezett rendezés: legutóbb módosított elöl.
2. `GET /admin/contents/:id/audit`
   - permission: `content:read`;
   - a már meglévő `ContentRepository.listAudit` biztonságos HTTP-kivetítése;
   - actor sub, roles, action, version, changed fields, occurredAt, correlationId;
   - payload és token nem kerülhet a válaszba.

Ezek új olvasási felületek, nem új üzleti képességek. Nélkülük az UUID kézi
másolása maradna a szerkesztői navigáció alapja.

### 5.2 Operátori endpointok

Javasolt új permission: `ops:write`. PoC-ban a publisher szerephez rendelhető,
később külön operator szerepre választható le. A `ops:read` önmagában ne indíthasson
helyreállítási műveletet.

| Endpoint | Cél | Válaszmodell |
| --- | --- | --- |
| `POST /admin/search/reindex-runs` | Reindex indítása `a` vagy `b` indexre | 202 + `runId`, `index` |
| `GET /admin/search/reindex-runs/:runId` | Egy futás tartós állapota | phase, progress, boundaries, error, timestamps |
| `GET /admin/search/quarantine` | Titokmentes, lapozott rekordlista | sequence + inspect summary |
| `GET /admin/search/quarantine/:sequence` | A CLI inspect HTTP megfelelője | payload nélküli locator/metaadat |
| `POST /admin/search/quarantine/:sequence/replays` | Replay kötelező `reason` mezővel | 202/200 + új stream sequence |
| `POST /admin/search/repairs` | Aktuális DB-projekció repair A/B/both célra | task UID-k és végeredmény |

Kötelező biztonsági szabályok:

- Reindex HTTP-kérés ne tartsa nyitva a kapcsolatot percekig. Indítson háttérfutást,
  adjon 202-t, a progress a tartós control state-ből legyen lekérdezhető.
- A coordinator által generált `runId` legyen már az indítási válaszban; ehhez a
  run létrehozását és futtatását két lépésre kell bontani vagy a `runId`-t kívülről
  kell átadni.
- A meglévő advisory lock és „másik index legyen ready” szabály változatlan marad.
- Outage módhoz kötelező typed confirmation és pontos target database név.
- Nincs „cancel” gomb, amíg a backendnek nincs biztonságos cancel szerződése.
- Replayhez kötelező indoklás; a karanténrekord továbbra sem törlődik.
- Minden operátori mutáció strukturáltan naplózza a hitelesített `sub`, művelet,
  target, reason/runId és correlation ID adatokat, secret nélkül.
- A vezérlő ne indítson shell parancsot. A meglévő service/coordinator osztályokat
  hívja közvetlenül.

### 5.3 Ami szándékosan marad CLI/tesztharness

- szolgáltatások leállítása és hálózati hibainjektálás;
- teljes `smoke:full`;
- az 1000 + 100-as M5 baseline generálása;
- adatbázis-migráció és reset;
- titkok vagy infrastruktúra-konfiguráció módosítása.

A UI ezekhez élő státuszt és vezetett runbookot adhat, de nem szabad általános
parancsfuttató felületté válnia.

## 6. Többfázisú megvalósítás

### Fázis 0 — Stabilizálás és szerződéshelyreállítás

**Becslés:** 2–3 mérnöknap · **Függőség:** nincs.

Feladatok:

- frontend Node-verzió egységesítése a backend 24.20-as pinjével (`.nvmrc`,
  `engines`, README, CI);
- OpenAPI snapshot és típusgenerálás bevezetése;
- a search response átállítása `items`, `offset`, `limit`, `returned`,
  `estimatedTotalHits` mezőkre;
- `category` query és pontos limit/offset típusok felvétele;
- a processing típust a backend teljes `ProcessingStatusView` szerződésére cserélni,
  különösen `oldestAgeMs`, relay, broker, consumers, quarantine, indexes;
- a mindig látható M3/M4 „nincs kész” paneleket feature- és válaszfüggő állapotra
  cserélni;
- a demo negatív lépéseiben pontos status + problem code assertion;
- az öt lint warning megszüntetése;
- `FRONTEND.md`, frontend README és gyökér státuszleírás aktualizálása.

Kilépési feltételek:

- build és lint Node 24.20-on sikeres;
- nincs kézzel karbantartott backend response interface;
- a jelenlegi összes HTTP-végpont válasza típusszinten helyesen jeleníthető meg;
- a demo 422-t csak `validation_failed`, a stale verziót csak 409
  `version_conflict`, a withdraw utáni publikus lekérést csak 404
  `content_not_found` esetén jelöli sikeres negatív próbának.

### Fázis 1 — Alkalmazásváz és valódi identity

**Becslés:** 4–5,5 mérnöknap · **Függőség:** Authentik L2 provideradat és redirect beállítás.

Feladatok:

- új route-térkép és role-aware navigáció;
- PKCE login, callback, refresh és logout;
- `/me` alapú session bootstrap és lejárati idő kijelzése;
- `RequireAuth` és `RequirePermission` route/action wrapper;
- tokenhiba, IdP-kiesés és session-expiry külön UX;
- kézi Bearer input dev flag mögé mozgatása;
- globális toast/notification és egységes `ProblemDetails` komponens;
- correlation ID másolható, de nem domináns technikai részletként jelenjen meg.

Kilépési feltételek:

- viewer, editor és publisher valódi PKCE belépéssel helyes `/me` adatot kap;
- refresh után a session él, lejárt/rossz audience tokennél nincs végtelen login loop;
- jogosulatlan route nem villan fel betöltés közben;
- logout után a token és a user-függő cache eltűnik.

Ha az Authentik L2 továbbra is pending, a UI fejlesztése mock issuerrel folytatható,
de a fázis nem jelölhető késznek valódi belépés nélkül.

### Fázis 2 — Szerkesztői tartalomkezelés

**Becslés:** 8–11 mérnöknap frontend + backend együtt · **Függőség:** admin list és audit endpoint.

Feladatok:

- lapozott tartalomlista kereséssel, státusz- és kategóriaszűrővel;
- új draft oldal backendlimitekkel egyező validációval;
- tartalom detail fejléc: status, version, slug, utolsó módosítás, actor;
- szerkesztőoldal dirty-state védelemmel;
- cím 200, summary 500, slug 80, media ID 128, max 20 × 40 karakteres tag
  kliensjelzés, a szerverhiba megtartása végső forrásként;
- publish readiness checklist és generált slug magyarázata;
- állapotfüggő akciók:
  - draft: szerkesztés + publish;
  - published: read-only + withdraw;
  - withdrawn: szerkesztés + republish;
- withdraw megerősítő dialog;
- 409 version conflict dialog: szerververzió betöltése, eltérések mutatása,
  „újratöltöm” vagy módosítások kézi újraalkalmazása; automatikus overwrite nincs;
- audit timeline action/version/actor/changed fields/correlation ID adatokkal;
- permission hiány esetén magyarázott disabled állapot, nem csak eltűnő gomb.

Kilépési feltételek:

- editor létrehoz és szerkeszt, de publish/withdraw műveletet nem tud indítani;
- publisher a teljes v1 → v6 életciklust végig tudja járni UUID másolása nélkül;
- published tartalmat a UI nem enged szerkeszteni;
- no-op patch nem mutat hamis verziónövekedést;
- két böngészőből előállított version conflict adatvesztés nélkül feloldható;
- minden sikeres változás megjelenik az audit idővonalon.

### Fázis 3 — Publikus katalógus és keresés

**Becslés:** 2–3 mérnöknap · **Függőség:** Fázis 0.

**Aktuális állapot:** a typed URL-modell, publikus lista/detail, célzott hiba-UX,
bounded visibility polling és helyi tesztek elkészültek; a valódi backenddel futó
böngészős E2E maradt nyitva.

Feladatok:

- `q`, `category`, `limit`, `offset` teljes querymodell URL search paramsban;
- keresési állapot megosztható/bookmarkolható URL-ben;
- előző/következő lap a backend 0–1000 offset korlátjával;
- `returned` és `estimatedTotalHits` külön, érthető megjelenítése;
- rövidebb oldal magyarázata, ha stale indexhit kiesik a DB-szűrésen;
- 503 `search_unavailable` és 503 `dependency_unavailable` külön üzenet;
- publikus tartalomkártya és detail oldal, adminmezők nélkül;
- „még indexelődik” állapot a publish után: polling csak a demó/szerkesztői
  visszajelzéshez, korlátozott időablakkal.

Kilépési feltételek:

- anonim felhasználó keres és részletet nyit;
- kategória és lapozás a hálózati kérésben is helyes;
- withdrawn tartalom stale index esetén sem jelenik meg;
- egyik index kiesésekor a felhasználói keresés tovább működik, mindkettő
  kiesésekor egyértelmű, újrapróbálható hiba látszik.

### Fázis 4 — Operációs megfigyelő dashboard

**Becslés:** 3–4 mérnöknap · **Függőség:** pontos processing contract.

Feladatok:

- outbox kártya: pending, oldestOccurredAt, emberi age `oldestAgeMs` alapján;
- relay kártya: enabled/state/lastDeliveredAt/lastErrorCode;
- broker kártya: connected/streamPresent/consumersUnavailable;
- consumer tábla: name, pending, ackPending, ack floor, oldest unfinished;
- quarantine riasztás pending darabszámmal;
- külön A és B indexkártya:
  - runtime state, durable, reachable;
  - in-flight event/task;
  - last ack/error;
  - M5 phase és desired worker state;
  - imported/expected progress;
  - S0/H/S1 határok;
  - routeEligible;
- összesített keresési elérhetőség: teljes / fallback / unavailable;
- adaptív polling: normál állapotban 10 s, aktív feldolgozás/reindex alatt 2 s,
  háttérben leállítva;
- relatív idők mellett pontos ISO idő tooltipben;
- technikai nyers JSON csak disclosure-ben.

Kilépési feltételek:

- az M3/M4/M5 processing response minden mezője vagy vizuálisan megjelenik, vagy
  dokumentáltan technikai részletbe kerül;
- A/B kiesés, retrying, halted, paused és reindex phase szemmel azonnal elkülönül;
- a dashboard nem állít „healthy” állapotot, ha mindkét index nem routolható;
- `ops:read` nélkül 403-barát képernyő jelenik meg.

### Fázis 5 — M5 operátori beavatkozások

**Becslés:** 9–12,5 mérnöknap frontend + backend együtt · **Függőség:** 5.2 endpointok, tartós action/idempotency és `ops:write`.

Feladatok:

- reindex wizard indexválasztással és előfeltétel-összefoglalóval;
- normál módban a másik index readiness/reachability ellenőrzése még submit előtt;
- outage mód külön veszélyes ágon, pontos adatbázisnév begépelésével;
- 202 válasz után run progress: phase-stepper, dokumentumszám, boundaries,
  duration és stabil error code;
- megszakadt/failed futásnál runbook-link és új teljes futás lehetősége;
- karantén lista cursoros lapozással;
- inspect panel payload nélkül;
- replay dialog kötelező indoklással és várható következmény leírásával;
- repair form content UUID + index A/B/both célra;
- minden művelet után processing és érintett tartalom/search query invalidáció;
- duplakattintás és elveszett válasz ellen idempotency key vagy szerveroldali
  „active run” felismerés.

Kilépési feltételek:

- két reindex nem indul párhuzamosan;
- nem routolható másik index mellett a normál indítás szerver- és UI-oldalon is blokkolt;
- outage mód rossz target confirmationnel elutasított;
- a UI újratöltése után az aktív run progress visszaállítható a tartós state-ből;
- replay reason nélkül nem indul;
- repair task failure nem jelenik meg sikernek;
- token, Meili key, NATS credential és teljes database URL sehol nem jelenik meg.

### Fázis 6 — Vezetett demó és bizonyíték

**Becslés:** 4,25–6 mérnöknap · **Függőség:** Fázis 1–5 releváns részei.

Feladatok:

- a lépések deklaratív scenario-definícióba költöztetése;
- minden lépéshez pontos expected HTTP status, problem code és üzleti assertion;
- „lépésenként” és „happy path futtatása” mód;
- preflight: auth role, backend ready, feature flag által látható függőségek;
- timeline: request kezdete/vége, correlation ID, content version, indexelési késés;
- pozitív flow: draft → edit → publish → catalog/search → withdraw → 404/search
  eltűnés → edit → republish;
- negatív flow-k:
  - hiányos publish 422 `validation_failed` és pontos fields;
  - published patch 409 `content_not_editable`;
  - stale patch 409 `version_conflict` expected/actual értékkel;
  - viewer írás 403 `forbidden`;
  - hibás/lejárt token 401 `unauthenticated`;
  - mindkét index kiesés 503 `search_unavailable`, miközben CMS write tovább él;
- fault injectionhez csak vezetett kézi/runbook lépés, mellette élő dashboard;
- eredmény exportálható titokmentes JSON/Markdown összefoglalóként a böngészőből.

Kilépési feltételek:

- egy nem várt hibatípus sosem számít sikeres negatív próbának;
- a demó új tartalmat hoz létre és nem függ előző futás UUID-jától;
- refresh után a futási napló és az aktív content ID helyreállítható vagy világosan
  újrakezdhető;
- az export nem tartalmaz tokent vagy secretet.

### Fázis 7 — Minőségkapu és átadás

**Becslés:** 4–6,5 mérnöknap · **Függőség:** az adott release-scope kész.

Feladatok:

- Vitest + React Testing Library komponens- és hooktesztek;
- MSW-alapú API esetek minden stabil problem code-ra;
- OpenAPI drift CI gate;
- Playwright E2E a három fő útra:
  1. PKCE login + role guard;
  2. publisher lifecycle + public visibility;
  3. search fallback + processing dashboard;
- operátori endpointok integrációs tesztjei advisory lockkal és jogosultsággal;
- accessibility: billentyűzet, focus, label, dialog, live region, színkontraszt;
- 360, 768, 1280 px responsive ellenőrzés;
- loading, empty, partial, stale, 401, 403, 404, 409, 422, 503 és network error
  vizuális állapotok;
- README, environment változók, helyi indulás és demo runbook frissítése.

Kilépési feltételek:

- build, lint, unit/component és kijelölt E2E suite zöld;
- friss checkoutból dokumentáltan indul a frontend;
- nincs accessibility blocker a kritikus flow-kon;
- a teljes backend funkciómátrix minden sora `UI`, `guided runbook` vagy
  `intentionally CLI-only` státuszt kap, gazda és indoklás megjelölésével.

## 7. Tesztmátrix

| Réteg | Mit bizonyít | Eszköz |
| --- | --- | --- |
| Unit | query builder, permission döntés, idő/progress formázás, scenario assertion | Vitest |
| Component | formvalidáció, gombállapot, problem details, conflict dialog | RTL + MSW |
| Contract | generált típusok megegyeznek a backend OpenAPI-val | codegen diff CI |
| Frontend integration | cache invalidáció, authváltás, polling, multi-step demo | RTL + MSW |
| Backend integration | új list/audit/ops endpointok, permission és lockok | meglévő Vitest backend suite |
| E2E | valódi browser + backend + függőségek fő üzleti útjai | Playwright |
| Manual fault demo | NATS/Meili kiesés és helyreállás látható a UI-n | runbook + full stack |

Minimum automatizált hibakészlet:

- 400/401/403/404/409/413/422/503;
- nem JSON válasz és hálózati timeout;
- lejárt session és IdP elérhetetlenség;
- stale content version;
- relay off/down;
- broker disconnected és consumers unavailable;
- index A down, B down, mindkettő down;
- worker retrying/halted/paused;
- reindex minden phase és stabil M5 error code;
- karantén not found/original expired/schema invalid/aggregate unknown;
- lost response vagy dupla submit operátori mutationnél.

## 8. Kockázatok és döntési pontok

| Kockázat / döntés | Javaslat |
| --- | --- |
| Authentik L2 továbbra is pending | Fázis 0 és a legtöbb képernyő fejleszthető, de Fázis 1 és teljes E2E nem zárható le |
| Kézzel tükrözött frontend DTO-k | OpenAPI codegen legyen Fázis 0 kötelező kapu |
| Nincs admin content lista | Vékony read endpoint nélkül ne próbáljunk kliensoldali UUID-regisztert építeni |
| Hosszú reindex HTTP-n | 202 + háttérfutás + durable polling; ne legyen percekig nyitott request |
| Operátori jogosultság túl széles | Új `ops:write`; a `ops:read` maradjon csak olvasás |
| Veszélyes outage reindex | Typed DB confirmation + szerveroldali target check + nincs egykattintásos indítás |
| UI „egészséget” számol eltérően | A backend `routeEligible`, phase és runtime state mezőire építsünk; ne találjunk ki második szabályrendszert |
| A demo hamis pozitív | Minden negatív lépés exact status/code/fields assertiont kap |
| PoC túltermékesítése | Először funkcionális, hozzáférhető munkafolyamat; design system, i18n és végleges branding külön scope |
| CLI mindenáron UI-ra vitele | Smoke, fault injection, migráció, baseline maradjon CLI; UI csak megfigyeli és dokumentálja |

## 9. Javasolt release-szeletek

### Release A — „A meglévő HTTP API helyes UI-ja”

Fázis 0 + 1 + a Fázis 2 lista/audit nélküli lifecycle része + Fázis 3 + Fázis 4.

Eredmény: valódi login, helyes tartalomszerkesztés, teljes keresés és teljes
read-only operációs dashboard. M5 beavatkozások még CLI-ről futnak.

### Release B — „Használható szerkesztői workspace”

Admin lista + audit endpoint, Fázis 2 teljes befejezése, konfliktuskezelés és
kritikus E2E tesztek.

Eredmény: UUID másolása nélkül használható szerkesztői folyamat.

### Release C — „M5 operátori konzol és bizonyítható demo”

Fázis 5 + 6 + teljes Fázis 7.

Eredmény: biztonságos reindex/replay/repair UI, pontos scenario runner és
reprodukálható teljes bemutató.

## 10. Teljes „kész” definíció

A frontend akkor fedi le az elkészült backendet, ha:

- minden jelenlegi HTTP route-nak van felhasználói vagy operátori UI-ja;
- nincs frontend/backend response contract eltérés;
- valódi PKCE login működik, a kézi token nem normál felhasználói út;
- a teljes content lifecycle szerepkör- és állapothelyesen végigjárható;
- a publikus detail/search nem mutat adminmezőt és helyesen kezeli a stale/fallback
  viselkedést;
- a processing-status összes M3–M5 jele értelmezhetően látszik;
- a reindex, quarantine replay és repair megfelelő új admin API-n, `ops:write`
  védelemmel érhető el;
- a CLI-only határ dokumentált, és a UI nem válik általános infrastruktúra-
  vezérlővé;
- az üzleti, jogosultsági, konfliktus- és kiesési flow-k automatizált tesztekkel
  védettek;
- a dokumentáció és a demó nem állít késznek olyan Authentik vagy M5 evidence
  kaput, amely a valódi környezetben még pending.
