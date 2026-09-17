# Frontend megvalósítási TODO

2026-09-17 · Végrehajtási sorrend és státuszkövető checklist.

Átfogó roadmap: [FRONTEND-IMPLEMENTATION-PLAN.md](FRONTEND-IMPLEMENTATION-PLAN.md).

## Használat

- A fázisokat az itt szereplő sorrendben kell lezárni.
- Egy fázis csak akkor kész, ha a saját Definition of Done listája teljes és a
  kötelező ellenőrzések zöldek.
- A részletes üzleti/API döntések forrása mindig a belinkelt fázisterv; ez a fájl
  a végrehajtási sorrend és a napi státusz követésére szolgál.
- A full-stack böngészős E2E suite futtatása: [frontend/e2e/README.md](frontend/e2e/README.md).
- `[x]` kész, `[ ]` nyitott, `[~]` folyamatban vagy külső függőségen vár.
- Teljes becslés: **36–52 mérnöknap**. A Release A (Fázis 0–4 scope) és a
  Release B szerkesztői workspace, valamint a Release C Fázis 5 operátori
  konzolja kész, valódi Authentik/full-stack böngészős E2E-vel bizonyított.
  A további munka a Release C-be tartozó Fázis 6–7,
  valamint a külön jelölt, release-en kívüli L2 mélytesztek.

## Végrehajtási sorrend

1. Fázis 0 – Stabilizálás és szerződéshelyreállítás — **kész**
2. Identity- és UI-glue API-döntési kapu — **kész; valódi callback bizonyított**
3. Fázis 1 – Alkalmazásváz és valódi identity — **Release A scope kész**
4. Fázis 2 – Szerkesztői tartalomkezelés — **kész**
5. Fázis 3 – Publikus katalógus és keresés — **kész**
6. Fázis 4 – Operációs megfigyelő dashboard — **kész, A/B outage bizonyított**
7. Fázis 5 – M5 operátori beavatkozások — **kész; outage és restart E2E bizonyított**
8. Fázis 6 – Vezetett demó és bizonyíték
9. Fázis 7 – Minőségkapu és átadás

---

## Fázis 0 – Stabilizálás és szerződéshelyreállítás

**Állapot:** kész  
**Becslés:** 2–3 mérnöknap  
**Részletes terv:** [FRONTEND-PHASE-0-IMPLEMENTATION.md](FRONTEND-PHASE-0-IMPLEMENTATION.md)

### Végrehajtási terv

- [x] Node `>=24.20.0 <25` runtime rögzítése.
- [x] Determinisztikus backend OpenAPI snapshot emitter.
- [x] Commitolt `contracts/backend.openapi.json` contract snapshot.
- [x] Frontend `openapi-typescript` generálás és generált API-típusok.
- [x] `contracts:check` drift gate.
- [x] Kézi backend response interface-ek generált aliasokra cserélése.
- [x] Search contract javítása: `returned`, `estimatedTotalHits`, category és lapozás.
- [x] Processing contract javítása: `oldestAgeMs`, relay, broker, consumerek,
  quarantine és A/B indexállapot.
- [x] Elavult statikus M3/M4 milestone gate-ek eltávolítása.
- [x] Demo negatív esetek exact status/problem-code assertionje.
- [x] Frontend lint warningok megszüntetése.
- [x] README-k és aktuális státusz frissítése.

### Lezárási kapu

- [x] Backend `openapi:check` sikeres.
- [x] Backend lint warning nélkül sikeres.
- [x] Frontend `contracts:check` sikeres.
- [x] Frontend build és lint pontos Node 24.20 runtime-mal sikeres.
- [x] Search és Processing alapképernyő vizuálisan ellenőrizve.

---

## Döntési kapu – Identity és UI-glue API

**Állapot:** kész; a valódi Authentik L2 környezet és a strict SPA callback bizonyított

**Részletes döntések:**
[FRONTEND-IDENTITY-AND-API-DECISIONS.md](FRONTEND-IDENTITY-AND-API-DECISIONS.md)

### Rögzített döntések

- [x] Authorization Code + PKCE, `S256`.
- [x] Meglévő public `poc-backend` client ID megtartása.
- [x] Scope: `openid profile offline_access poc-aud`.
- [x] Strict SPA callback: `http://127.0.0.1:5173/auth/callback`.
- [x] OIDC state `sessionStorage`-ban; normál UI nem jelenít meg tokent.
- [x] Jogosultság egyetlen forrása a backend `GET /me` válasza.
- [x] Manual Bearer csak `VITE_ALLOW_MANUAL_TOKEN=true` fejlesztői flag mögött.
- [x] `GET /admin/contents` cursoros lista contract.
- [x] `GET /admin/contents/:id/audit` cursoros audit contract.
- [x] Admin lista stabil sorrendje: `updated_at DESC, id DESC`.
- [x] Lista/audit permission: `content:read`.
- [x] Authentik image és L2 környezet ténylegesen elérhető.
- [x] Blueprint alkalmazva és a browser callback ténylegesen elfogadva.

---

## Fázis 1 – Alkalmazásváz és valódi identity

**Állapot:** Release A scope kész — P1-01–P1-12 teljes; a refresh, key rotation
és IdP-kiesés kibővített L2 mérései külön nyitottak

**Becslés:** 4–5,5 mérnöknap  
**Függőség:** Fázis 0; a Release A lezárásához előírt valódi Authentik L2 teljesült

**Részletes terv:** [FRONTEND-PHASE-1-IMPLEMENTATION.md](FRONTEND-PHASE-1-IMPLEMENTATION.md)

### Végrehajtási terv

- [x] **P1-01:** `oidc-client-ts` dependency, env-normalizálás és validáció.
- [x] **P1-02:** Authentik blueprint strict SPA redirecttel; a meglévő CLI callback
  változatlan, a futtatott CLI/L2 regresszió P1-12 része.
- [x] **P1-03:** OIDC kliensadapter és determinisztikus auth state machine.
- [x] **P1-04:** `/login`, `/auth/callback` és logout flow.
- [x] **P1-05:** `/me` session bootstrap, cache-életciklus és egyszeri 401 recovery.
- [x] **P1-06:** központi API-client auth integráció; komponensek ne adogassanak tokent.
- [x] **P1-07:** `RequireAuth`, `RequirePermission` és magyarázott action guard.
- [x] **P1-08:** cél route-térkép és role-aware navigáció.
- [x] **P1-09:** egységes `ProblemDetails`, notification és correlation ID disclosure.
- [x] **P1-10:** manual token kizárólag dev flag mögött.
- [x] **P1-11:** auth/session/guard unit és component tesztek.
- [x] **P1-12:** valódi Authentik L2 full-stack ellenőrzés mindhárom identitással —
  2026-09-17, böngészős PKCE belépés zölden lefutott mindhárom identitással.

### Kötelező ellenőrzések

- [x] Viewer, editor és publisher PKCE belépése sikeres — valódi Authentik, E2E-01.
- [~] Hard reload és access-token refresh után a session helyreáll — a hard reload
  valódi providerrel bizonyított; az 5 perces lejárat utáni refresh L2 méréssel nyitott.
- [x] Callback kétszeri mountja idempotens.
- [~] Hibás issuer/audience és IdP-kiesés nem okoz login loopot — config-, 401-
  és 503-ág tesztelt; a valós L2 hibamátrix (Authentik leállítása) nyitott.
- [x] 401, 403 és 503 külön UX-et kap.
- [x] Logout törli az OIDC usert, tokent és user-függő cache-t.
- [x] Normál build DOM-jában nincs manual token mező.
- [x] Contract check, build, lint és 25 auth/session/guard teszt zöld.
- [x] M2 L2 evidence valós futással frissítve — [RELEASE-A-EVIDENCE.md](RELEASE-A-EVIDENCE.md), M2-EVIDENCE M2-T20.

---

## Fázis 2 – Szerkesztői tartalomkezelés

**Állapot:** kész — backend, UI, PostgreSQL és valódi Authentik böngészős E2E zöld

**Becslés:** 8–11 mérnöknap frontend + backend együtt  
**Függőség:** Fázis 1; admin list és audit backend API  
**Részletes terv:** [FRONTEND-PHASE-2-IMPLEMENTATION.md](FRONTEND-PHASE-2-IMPLEMENTATION.md)

### Backend végrehajtási terv

- [x] **P2-BE-01:** strict admin list query- és cursorcontract.
- [x] **P2-BE-02:** cursoros admin lista repository/service stabil rendezéssel.
- [x] **P2-BE-03:** `GET /admin/contents`, permission, OpenAPI és integrációs teszt.
- [x] **P2-BE-04:** cursoros, newest-first audit repository/service.
- [x] **P2-BE-05:** `GET /admin/contents/:id/audit`, OpenAPI és adatminimalizálás.
- [x] **P2-BE-06:** OpenAPI snapshot, generated frontend type és lifecycle regresszió.
- [x] Reális, 5000 soros seed mellett listaquery `EXPLAIN`; a mért sort után
  hozzáadott `(updated_at, id)` index `Index Scan Backward` tervet ad.
- [x] Read endpointok nem írnak audit- vagy outbox-rekordot.

### Frontend végrehajtási terv

- [x] **P2-FE-01:** `features/contents` struktúra és query-key factory.
- [x] **P2-FE-02:** `/contents` lista URL filterekkel és cursor historyval.
- [x] **P2-FE-03:** közös validált content form a backend limitekkel.
- [x] **P2-FE-04:** `/contents/new` draft-létrehozási folyamat.
- [x] **P2-FE-05:** detail áttekintő, státusz, verzió és publish readiness.
- [x] **P2-FE-06:** draft/withdrawn szerkesztés, dirty-state védelem és no-op kezelés.
- [x] **P2-FE-07:** publish/withdraw/republish állapot- és permissionhelyesen.
- [x] **P2-FE-08:** version conflict dialog reload/reapply ággal, force overwrite nélkül.
- [x] **P2-FE-09:** cursoros audit timeline.
- [x] **P2-FE-10:** editor/publisher actionmátrix és magyarázott disabled állapotok.
- [x] **P2-FE-11:** 360 px kártyanézet, label/error kapcsolatok és fókuszkezelt dialogok.

### Kötelező ellenőrzések

- [x] Editor listáz, létrehoz és szerkeszt, de nem publishol/withdrawol — valódi
  Authentik böngészős E2E zöld.
- [x] Publisher UUID másolása nélkül végigjárja a teljes v1 → v6 életciklust —
  valódi Authentik böngészős E2E zöld, az audit 6 bejegyzése pontos sorrendben.
- [x] Published content nem szerkeszthető.
- [x] No-op patch nem mutat hamis verziónövekedést.
- [x] Két browser context version conflictja adatvesztés nélkül feloldható —
  valódi kétcontextes E2E zöld, pontosan 2 PATCH automatikus újraküldés nélkül.
- [x] Audit minden sikeres verziót pontosan egyszer, jó sorrendben mutat.
- [x] Backend 67/67 és frontend 37/37 célzott teszt, build, lint és contract gate zöld.

---

## Fázis 3 – Publikus katalógus és keresés

**Állapot:** kész — implementáció, helyi tesztkapuk és full-stack browser E2E zöld

**Becslés:** 2–3 mérnöknap  
**Függőség:** Fázis 0; a publikus flow Fázis 1-től függetlenül fejleszthető  
**Részletes terv:** [FRONTEND-PHASE-3-DELIVERY-BRIEF.md](FRONTEND-PHASE-3-DELIVERY-BRIEF.md)

### Végrehajtási terv

- [x] **P3-01:** `/catalog/search` typed URL-query parse/serialize.
- [x] **P3-02:** találati lista, category filter és limit/offset lapozás.
- [x] **P3-03:** `/catalog/:id` publikus detail adminmezők nélkül.
- [x] **P3-04:** 422, 404, `search_unavailable`, `dependency_unavailable` és network UX.
- [x] **P3-05:** publish/withdraw utáni korlátozott, háttértabon szünetelő polling.
- [x] **P3-06:** 17 új unit/component/integration-style teszt és adatminimalizálás
  zöld; a valódi backend+browser E2E 2026-09-17-én lefutott.

### Kötelező ellenőrzések

- [x] Query, category, limit és offset bookmarkolható URL-ben marad.
- [x] `returned` és `estimatedTotalHits` jelentése külön jelenik meg.
- [x] Rövid oldal stale indexhit esetén érthető magyarázatot kap.
- [x] Anonymous search → filter → next → detail → back — valódi full-stack
  böngészős E2E zöld, bookmarkolható URL-lel.
- [x] Withdrawn tartalom stale index esetén sem jelenik meg — backend M4-T21/T22
  DB-visszaellenőrzési regresszióval védett, a detail 404 UI tesztelt.
- [x] Polling timeout nem mutat hamis publish failure-t.
- [x] Frontend contract, build, React Compiler, warningmentes lint és 54/54 teszt zöld.

---

## Fázis 4 – Operációs megfigyelő dashboard

**Állapot:** kész — implementáció, helyi tesztkapuk és a valódi A/B kiesési E2E zöld

**Becslés:** 3–4 mérnöknap  
**Függőség:** Fázis 0 processing contract és Fázis 1 permission route  
**Részletes terv:** [FRONTEND-PHASE-4-DELIVERY-BRIEF.md](FRONTEND-PHASE-4-DELIVERY-BRIEF.md)

### Végrehajtási terv

- [x] **P4-01:** `/operations` route és `ops:read` permission boundary.
- [x] **P4-02:** normalizált view model, duration/time/progress helper.
- [x] **P4-03:** overview, outbox, relay, broker és quarantine kártyák.
- [x] **P4-04:** consumer tábla mobil kártyanézettel.
- [x] **P4-05:** egységes A/B indexkártyák runtime és tartós állapottal.
- [x] **P4-06:** 10 s/2 s adaptív polling, hidden tab stop és hibabackoff.
- [x] **P4-07:** optional/partial/stale/401/403/503 állapotok.
- [x] **P4-08:** 52 új unit/component/integration-style teszt és hozzáférhető
  natív vezérlők zöldek; a valódi backend+browser E2E 2026-09-17-én lefutott.

### Kötelező ellenőrzések

- [x] Minden processing mező UI-n vagy technikai disclosure-ben látszik.
- [x] Összesített search állapot kizárólag a backend `routeEligible` mezőiből készül.
- [x] Két routolható index = teljes, egy = fallback, nulla = unavailable.
- [x] `off`, `unknown`, `down` és optional-hiány nem mosódik össze.
- [x] Polling háttértabon leáll és requestek nem halmozódnak.
- [x] Egy index down és mindkettő down fixture- és valódi full-stack szinten
  bizonyított; az opt-in `@outage` E2E 1/1 sikeres, 0 skip, 0 hiba (RA-05).
- [x] Frontend contract, build, React Compiler, warningmentes lint és 106/106 teszt zöld.

---

## Fázis 5 – M5 operátori beavatkozások

**Állapot:** kész — backend/frontend implementáció, célzott kapuk és valódi
full-stack operátori E2E zöld; jegyzőkönyv: [PHASE-5-EVIDENCE.md](PHASE-5-EVIDENCE.md)

**Becslés:** 9–12,5 mérnöknap frontend + backend együtt  
**Függőség:** Fázis 1 és 4; új `ops:write`, tartós action/idempotency backend  
**Részletes terv:**
[FRONTEND-PHASE-5-JOINT-IMPLEMENTATION.md](FRONTEND-PHASE-5-JOINT-IMPLEMENTATION.md)

### Backend végrehajtási terv

- [x] Új `ops:write` permission; PoC-ban publisherhez rendelve.
- [x] `operator_action` migration és safe, szűk action schema.
- [x] Tartós Idempotency-Key + request fingerprint kezelés.
- [x] Action repository, background runner, heartbeat és tranzakciós restart recovery.
- [x] Quarantine CLI üzleti logika injektálható service-be emelése.
- [x] Content repair CLI üzleti logika injektálható service-be emelése.
- [x] Reindex coordinator külső `runId`-val, meglévő lock/invariánsok megtartásával.
- [x] `GET /admin/search/reindex-preflight`.
- [x] `POST /admin/search/reindex-runs` és run detail.
- [x] Quarantine lista/detail/replay endpointok payload nélkül.
- [x] Content repair endpoint A/B/both célra.
- [x] Közös operator action detail endpoint.
- [x] Stabil async error-code térkép és OpenAPI/route matrix frissítés.
- [x] CLI regresszió: CLI és HTTP ugyanazokat a service-eket használja.

### Frontend végrehajtási terv

- [x] **P5-FE-01:** közös operator action polling, session-helyreállítás és idempotency helper.
- [x] **P5-FE-02:** reindex wizard preflighttal, reasonnel és outage ággal.
- [x] **P5-FE-03:** refresh után helyreálló reindex phase/progress oldal.
- [x] **P5-FE-04:** cursoros quarantine lista és payload nélküli inspect.
- [x] **P5-FE-05:** reason-köteles replay dialog és action progress.
- [x] **P5-FE-06:** content repair form A/B/both céllal.
- [~] **P5-FE-07:** permission- és secret-review kódszinten és full-stack
  payloadmentességi próbával kész; a teljes axe,
  keyboard/screen-reader és screenshot review a Fázis 7 kapujában nyitott.

### Kötelező ellenőrzések

- [x] Ugyanaz az idempotency key azonos requesttel nem indít második műveletet.
- [x] Azonos key eltérő requesttel `409 idempotency_conflict`.
- [x] Két reindex nem fut párhuzamosan.
- [x] Normál reindex másik routolható index nélkül backend/UI szinten és valódi
  Meilisearch B kieséssel blokkolt.
- [x] Outage mód exact DB-név megerősítést és backend újraellenőrzést kér;
  a valódi outage E2E sikeresen lefutott.
- [x] Reindex cancel/resume gomb nincs biztonságos backend contract nélkül.
- [x] Valódi SIGKILL + backend restart után a megszakadt reindex és control sor
  együtt `failed/aborted`; az UI-ból indított új teljes run sikeresen lefutott.
- [x] Replay reason nélkül nem indul és a quarantine rekord nem törlődik.
- [x] Repair failure nem jelenik meg sikerként.
- [x] Token, payload, API key, NATS/Meili credential és teljes DB URL nem kerül
  action/API/UI projectionbe; inspect, replay és repair E2E ezt tartalmi
  negatív állításokkal is ellenőrzi. A szélesebb Fázis 7 security review külön kapu.
- [x] Backend M5 15/15, frontend 112/112, build/lint/contract gate zöld;
  Phase 5 full-stack: 3/3 normál + 1/1 outage + 1/1 restart recovery.

---

## Fázis 6 – Vezetett demó és bizonyíték

**Állapot:** nyitott  
**Becslés:** 4,25–6 mérnöknap  
**Függőség:** az adott scenario által használt Fázis 1–5 képernyők/API-k stabilak  
**Részletes terv:** [FRONTEND-PHASE-6-IMPLEMENTATION.md](FRONTEND-PHASE-6-IMPLEMENTATION.md)

### Végrehajtási terv

- [ ] **P6-01:** verziózott, allowlistelt scenario registry és runtime validáció.
- [ ] **P6-02:** determinisztikus execution engine aborttal és bounded pollinggal.
- [ ] **P6-03:** exact HTTP/problem/fields/business assertion engine.
- [ ] **P6-04:** auth, permission, health, feature és aktív-run preflight.
- [ ] **P6-05:** hozzáférhető step timeline correlation ID-val és safe metaadattal.
- [ ] **P6-06:** manual runbook checkpoint; nincs UI-ból fault injection.
- [ ] **P6-07:** safe session persistence és lost-response reconciliation.
- [ ] **P6-08:** allowlistelt, titokmentes JSON és Markdown evidence export.
- [ ] **P6-09:** scenario/assertion/redaction/integration/full-stack tesztek.

### Kötelező scenario-k

- [ ] **S01:** publisher draft → edit → publish → catalog/search → withdraw →
  eltűnés → edit → republish → audit.
- [ ] **S02:** pontos 422, published-patch 409 és stale-version 409 negatív contractok.
- [ ] **S03:** viewer/editor/publisher permissionmátrix és 401.
- [ ] **S04:** egyindexes fallback, kétindexes kiesés és CMS-write fennmaradás.
- [ ] **S05:** M5 reindex/replay/repair, ha Release C scope.

### Kötelező ellenőrzések

- [ ] Váratlan hibatípus soha nem számít sikeres negatív próbának.
- [ ] Minden run új content ID-t hoz létre.
- [ ] Mutation lost response nem okoz automatikus duplikálást.
- [ ] Refresh után a run safe módon folytatható vagy `inconclusive`.
- [ ] Export nem tartalmaz tokent, headert, body-t, passwordöt vagy credentialt.
- [ ] Kijelölt scenario-k integration és full-stack szinten zöldek.

---

## Fázis 7 – Minőségkapu és átadás

**Állapot:** nyitott  
**Becslés:** 4–6,5 mérnöknap a közös release-kapura  
**Függőség:** az adott release-scope összes funkciója kész  
**Részletes terv:** [FRONTEND-PHASE-7-QUALITY-GATE.md](FRONTEND-PHASE-7-QUALITY-GATE.md)

### Végrehajtási terv

- [ ] **P7-01:** Vitest + React Testing Library + MSW közös tesztinfrastruktúra.
- [ ] **P7-02:** frontend fast CI: install, contract, build, lint, unit/component.
- [ ] **P7-03:** backend contract/integration/migration gate.
- [~] **P7-04:** Playwright full-stack harness és a valódi stacken futtatás kész
  (`playwright.config.ts`, `e2e/support`, előfeltétel-preflight, `npm run e2e`);
  a CI job még nyitott.
- [x] **P7-05:** PKCE és role guard E2E zöld valódi Authentik ellen (6 eset).
- [x] **P7-06:** publisher lifecycle + audit E2E zöld (3 eset).
- [x] **P7-07:** két browser context version-conflict E2E zöld.
- [x] **P7-08:** search/operations E2E zöld (4 normál + 1 opt-in outage eset);
  egy index kiesése, teljes kiesés és helyreállás valódi Meilisearch A/B stacken bizonyított.
- [x] **P7-09:** operátori action E2E: reindex/idempotencia/párhuzamos tiltás,
  repair both, quarantine inspect/replay, outage opt-in és valódi restart recovery zöld.
- [ ] **P7-10:** loading/empty/partial/stale/401/403/404/409/413/422/503/network mátrix.
- [ ] **P7-11:** WCAG 2.2 AA cél, axe és kézi keyboard/screen-reader smoke.
- [~] **P7-12:** 360 és 1280 px Chromium smoke zöld; 768 px és Firefox/WebKit nyitott.
- [ ] **P7-13:** token/secret/public-data-minimalizálási review.
- [ ] **P7-14:** polling/request-halmozás és production bundle baseline.
- [ ] **P7-15:** README, env, runbook, migration és fresh-checkout átadás.
- [ ] **P7-16:** backend capability lefedési nyilvántartás ownerrel és teszttel.

### Közös Release Definition of Done

A teljes lista a Release C kapuja; a Release A az alább név szerint jelölt,
scope-arányos részhalmazzal zárult.

- [x] Release A frontend fast gate pontos Node 24.20 runtime-mal zöld.
- [x] Release A backend contract/integration gate zöld.
- [x] Kijelölt Release A full-stack E2E suite zöld.
- [x] Authentik L2 belépési és jogosultsági kapu nem pending a Release A-ban.
- [ ] Axe blocker/critical nulla; keyboard és screen-reader smoke kész.
- [ ] 360/768/1280 viewport ellenőrizve.
- [ ] Teljes UI állapotmátrix lefedve.
- [ ] Security és adatminimalizálási review kész.
- [ ] Friss checkoutból dokumentált indulás bizonyított.
- [ ] Backend funkciómátrix minden sora `UI`, `guided runbook`,
  `intentionally CLI-only` vagy `not implemented backend` státuszú.
- [x] Release A evidence és ismert korlátok verziózva.

---

## Release-szeletek

### Release A – A meglévő HTTP API helyes UI-ja

**Állapot: KÉSZ.** A full-stack bizonyítás 2026-09-17-én megtörtént: `npm run
verify` zöld (106/106); az alap E2E **17 passed / 1 skipped / 0 failed**, majd az
opt-in `@outage` futás **1 passed / 0 skipped / 0 failed** valódi Authentik,
backend és Meilisearch A/B stacken.
Jegyzőkönyv: [RELEASE-A-EVIDENCE.md](RELEASE-A-EVIDENCE.md).

- [x] Fázis 0 kész.
- [x] Fázis 1 Release A scope kész — az L2 belépés mindhárom identitással zöld;
  a token refresh, key rotation és IdP-kiesés mélytesztje ismert, release-en kívüli korlát.
- [x] Fázis 2 lifecycle része legalább lista/audit nélkül használható.
- [x] Fázis 3 kész.
- [x] Fázis 4 kész — a dashboard, az egyindexes fallback, a teljes kiesés és a
  helyreállás valódi `@outage` futással zöld.

#### Lezárási lépések

- [x] **RA-01:** `docker compose --profile full up -d` (PostgreSQL, NATS,
  Meilisearch A/B, Authentik) és az Authentik blueprint tényleges alkalmazása.
- [x] **RA-02:** backend `.env.e2e` a `.env.example` alapján
  (`FEATURE_IDENTITY|OUTBOX_RELAY|SEARCH=on`, a `POSTGRES_PORT` egyezzen a
  `backend/.env` értékével), migráció és indítás.
- [x] **RA-03:** frontend `.env.e2e` (kulcsok: `frontend/e2e/README.md`),
  `npm ci` (a `@playwright/test` már a `package.json`-ban van) és
  `npm run e2e:install`.
- [x] **RA-04:** `npm run e2e` zöld a `@outage` eset nélkül (17 passed, 0 failed).
- [x] **RA-05:** `E2E_DOCKER_CONTROL=true` mellett az `@outage` eset zöld
  (1 passed, 0 skipped, 0 failed; teljes futás 61,0 s).
- [x] **RA-06:** M2-EVIDENCE L2 sorai és a Fázis 1–4 ellenőrzései átvezetve;
  jegyzőkönyv: [RELEASE-A-EVIDENCE.md](RELEASE-A-EVIDENCE.md).

Eredmény: valódi login, helyes content lifecycle, teljes publikus keresés és
read-only operations dashboard. Az M5 műveletek még CLI-ről futnak.

### Release B – Használható szerkesztői workspace

**Állapot: KÉSZ.** A release-kapu 2026-09-17-én pontos Node 24.20.0 runtime-mal,
elkülönített PostgreSQL tesztadatbázissal és valódi Authentik/full-stack
böngészős futással lezárult. Jegyzőkönyv:
[RELEASE-B-EVIDENCE.md](RELEASE-B-EVIDENCE.md).

- [x] Admin lista backend/API/UI kész.
- [x] Audit backend/API/UI kész.
- [x] Fázis 2 conflict és teljes szerkesztői flow kész.
- [x] Kritikus szerkesztői E2E zöld.

Eredmény: UUID másolása nélkül használható editor/publisher workspace.

### Release C – M5 operátori konzol és bizonyítható demo

- [x] Fázis 5 kész.
- [ ] Fázis 6 kész.
- [ ] Fázis 7 teljes release gate kész.

Eredmény: biztonságos reindex/replay/repair UI, pontos scenario runner és
reprodukálható full-stack evidence.
