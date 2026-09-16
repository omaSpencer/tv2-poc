# Frontend Fázis 2 – Szerkesztői tartalomkezelés

2026-09-16 · Ticket-szintű frontend + backend implementációs specifikáció.

**Implementációs állapot (2026-09-16):** P2-BE-01–06 és P2-FE-01–11
elkészült, a helyi contract/build/lint/unit/component és valódi PostgreSQL
integrációs kapuk zöldek. A valódi editor/publisher Authentik böngészős E2E a
P1-12-höz hasonlóan külső L2 függőségen vár.

Kapcsolódó döntések:
[FRONTEND-IDENTITY-AND-API-DECISIONS.md](FRONTEND-IDENTITY-AND-API-DECISIONS.md).

## 1. Cél és határ

Az editor és publisher UUID másolása nélkül talál, létrehoz, megnyit és szerkeszt
tartalmat. A státusz- és verziószabályok láthatók, a konfliktus nem ír felül
adatot, minden sikeres változás audit idővonalon követhető.

Nem része: tömeges művelet, törlés, rich-text editor, autosave, audit értékdiff,
media picker, i18n vagy operátori M5 beavatkozás.

## 2. Backend munkacsomagok

### P2-BE-01 — Query és cursor contract

Új `contracts/admin-content-list.ts` vagy azonos felelősségű modul:

- `q`, `status`, `category`, `limit`, `cursor` egyetlen strict parserben;
- repeated/unknown paraméter elutasítás;
- verziózott base64url cursor encode/decode;
- cursor date/UUID/version alak ellenőrzés;
- stabil `validation_failed` mezőnevek;
- OpenAPI query limitek ugyanebből a konstansból.

Unit: minden határérték, unicode q, wildcard escape, hibás base64/JSON/verzió,
ismételt paraméter.

### P2-BE-02 — Admin content list repository és service

Repository:

- `updatedAt DESC, id DESC`;
- `limit + 1`;
- cursor predikátum;
- opcionális status/category;
- title/slug case-insensitive escaped contains és UUID exact match;
- csak listanézethez szükséges oszlopok.

Service:

- DB connection hiba → `dependency_unavailable`;
- következő cursor csak plusz sor esetén;
- row → `AdminContentListItem` explicit mapper.

DB indexet `EXPLAIN` alapján adjunk hozzá, ne találgatásból. Legalább az alap
`updated_at, id` rendezés reális seed mellett ne igényeljen teljes sortot.

### P2-BE-03 — `GET /admin/contents`

- a statikus `@Get()` route a `@Get(':id')` mellett egyértelműen regisztrált;
- `content:read`;
- 200/401/403/422/503 OpenAPI;
- response `AdminContentListView` schema;
- `ROUTE_MATRIX` frissítés.

Integráció: anonymous 401, viewer 403, editor/publisher 200, filterkombinációk,
két oldal között nincs duplikáció, azonos timestampnél ID tie-break.

### P2-BE-04 — Audit cursoros repository és service

- a jelenlegi `listAudit` helyett vagy mellett lapozott read;
- sorrend `contentVersion DESC`;
- `limit + 1`, cursor `< contentVersion`;
- előzetes content existence check;
- explicit `ContentAuditView` mapper;
- actor roles és changed fields csak a rögzített enumértékekből.

A write path meglévő audit invariánsai változatlanok.

### P2-BE-05 — `GET /admin/contents/:id/audit`

- `content:read`;
- 200/401/403/404/422/503;
- `ContentAuditListView` OpenAPI schema;
- `ROUTE_MATRIX` frissítés;
- audit payload adatminimalizálási contract teszt.

### P2-BE-06 — Contract snapshot és regresszió

- backend OpenAPI snapshot újragenerálás;
- frontend generált típus újragenerálás;
- lifecycle integrációs suite változatlanul zöld;
- list/audit nem hoz létre audit- vagy outbox-sort;
- lekérdezések SQL injection/wildcard inputra biztonságosak.

## 3. Frontend munkacsomagok

### P2-FE-01 — Feature-szerkezet és query key factory

```text
frontend/src/features/contents/
  api.ts
  queryKeys.ts
  schemas.ts
  routes/
  components/
```

Query key tartalmaz minden normalizált filtert/cursort. Detail, list és audit
külön névtér. Mutation után célzott invalidáció, nem teljes app cache clear.

### P2-FE-02 — Tartalomlista

Route: `/contents`.

- debounced q, status és category filter;
- filterek URL search paramsban;
- cursor history kliensoldali stackkel: előző/következő;
- filterváltás törli a cursor stacket;
- oszlop/kártya: title, status, category, version, updatedAt, updatedBy;
- üres, loading, refresh, 403, 503 és retry állapot;
- sor kattintás `/contents/:id`;
- `content:write` esetén „Új tartalom”.

A UI nem mutat total találatszámot, mert a contract nem ad ilyet.

### P2-FE-03 — Közös content form és kliensvalidáció

React Hook Form + Zod vagy azonos képességű megoldás. Szabályok:

| Mező | UI szabály |
| --- | --- |
| title | kötelező, trim, 1–200 |
| slug | opcionális/null, max 80, `^[a-z0-9]+(-[a-z0-9]+)*$` |
| summary | opcionális/null, trim, max 500 |
| category | backend enum vagy null |
| mediaAssetId | opcionális/null, trim, max 128 |
| tags | max 20, egyenként max 40, trim + lowercase + dedupe előnézet |

Karakter- és taglimit látható. A kliensjelzés nem helyettesíti a szerver 422-t;
a szerver `fields` visszajelzése mezőhöz kötve jelenik meg.

### P2-FE-04 — Új draft

Route: `/contents/new`, `content:write`.

- submit alatt egyszeri kérés, gomb tiltva;
- success után toast és `replace('/contents/:id')`;
- visszanavigálás dirty formnál megerősítés;
- 409 `slug_conflict`, 413 és 422 célzott hiba;
- hálózati/5xx hibára nincs automatikus mutation retry;
- elveszett válasz esetén nincs automatikus újraküldés.

### P2-FE-05 — Detail áttekintő

Route: `/contents/:id`, `content:read`.

- title, status badge, version, slug;
- updatedAt/updatedBy, publishedAt/withdrawnAt;
- publish readiness checklist;
- status + permission alapján következő akciók;
- publikus detail link csak published állapotnál;
- technikai mezők disclosure-ben;
- „Szerkesztés” csak draft/withdrawn + `content:write`.

### P2-FE-06 — Szerkesztés és no-op

Route: `/contents/:id/edit`, `content:write`.

- published státusz read-only detailre irányít, magyarázattal;
- form baseline a betöltött szerververzió;
- PATCH csak dirty mezőket + `expectedVersion` küld;
- success után a szerverválasz lesz az új baseline;
- no-op válasznál nem állít verziónövekedést és nem ad hamis „módosult” jelzést;
- dirty-state védelem route- és browser unload esetén.

### P2-FE-07 — Publish és withdraw

- publish csak `content:publish`, draft/withdrawn állapot és readiness mellett
  aktív; a backend döntése marad végső;
- generált slug esetén előzetes magyarázat, a tényleges slug a válaszból;
- 422 fields visszavezeti a felhasználót a szerkesztéshez;
- withdraw csak published + `content:publish`;
- withdraw confirm dialog tartalomcímmel, fókuszcsapdával;
- mutation közben duplakattintás blokkolt;
- success után detail/list/audit invalidáció.

### P2-FE-08 — Version conflict dialog

409 `version_conflict` esetén:

1. a helyi draft érintetlen marad;
2. detail friss lekérése indul;
3. dialog mutat expected/actual verziót és mezőnként local/server értéket;
4. „Szerververzió betöltése” eldobja a draftot explicit megerősítéssel;
5. „Saját változtatások megtartása” új baseline-ra helyezi a local dirty mezőket,
   de nem küld automatikusan PATCH-et;
6. nincs force/overwrite végpont és nincs automatikus retry.

Publishedre váltott friss szerververziónél a reapply tiltott és detailre visz.

### P2-FE-09 — Audit idővonal

A detail alatt vagy tabon:

- action, version, actorSub, actorRoles, occurredAt, changedFields;
- legújabb felül;
- „Korábbi események” next cursorral;
- correlation ID másolható technikai disclosure-ben;
- üres audit meglévő contentnél külön inkonzisztenciajelzés;
- audit 404 esetén a detail cache is invalidálódik.

### P2-FE-10 — Permission és állapot UX

| Állapot | Editor | Publisher |
| --- | --- | --- |
| draft | edit | edit + publish |
| published | read-only | read-only + withdraw |
| withdrawn | edit | edit + republish |

Hiányzó jog esetén kritikus akció magyarázott disabled állapotban maradhat;
tiltott route közvetlen URL-lel 403-barát képernyőt ad. A frontend soha nem
helyettesíti a backend permission guardot.

### P2-FE-11 — Responsive és accessibility

- 360 px-en lista kártyás, 768/1280-on tábla;
- minden input labellel és hiba `aria-describedby` kapcsolattal;
- dialog focus trap + restore;
- mutation eredmény live region;
- status nem csak színnel;
- dátum lokalizált, pontos ISO tooltip/disclosure-ben.

## 4. Tesztmátrix

### Backend

1. default lista és stabil sorrend;
2. q/title/slug/UUID;
3. status + category kombináció;
4. cursor tie-break azonos timestampnél;
5. invalid/unknown/repeated query 422;
6. anonymous/viewer/editor/publisher access;
7. audit newest-first és több oldal;
8. audit 404 vs létező üres;
9. DB unavailable 503;
10. read nem ír audit/outbox rekordot.

### Frontend component/integration

1. URL filter round-trip és cursor reset;
2. create 201 → detail;
3. server 422 mezőhiba;
4. dirty navigation cancel/confirm;
5. no-op version változatlan;
6. state/permission action matrix;
7. publish readiness és server override;
8. withdraw confirm keyboarddel;
9. conflict reload/reapply/published ág;
10. audit pagination;
11. 401/403/404/409/413/422/503/network állapot;
12. mobile lista és dialog fókusz.

### E2E

- editor: list → create → edit; publish/withdraw nem indítható;
- publisher: create → edit → publish → withdraw → edit → republish;
- két browser context: stale patch → conflict → kézi reapply adatvesztés nélkül;
- audit minden sikeres verziót egyszer, helyes sorrendben mutat.

## 5. Függőségi sorrend

```text
P2-BE-01 -> P2-BE-02 -> P2-BE-03 -> P2-BE-06
         \-> P2-BE-04 -> P2-BE-05 -/

P2-FE-01 -> P2-FE-02
         \-> P2-FE-03 -> P2-FE-04 -> P2-FE-05 -> P2-FE-06
                                            \-> P2-FE-07 -> P2-FE-08
P2-BE-05 --------------------------------------> P2-FE-09
P2-FE-10/11 minden képernyő része, nem utólagos csomag.
```

A frontend lista/audit MSW mockkal elkezdhető, de integrációs készre csak a
generált, tényleges OpenAPI contract után jelölhető.

## 6. Becslés

| Terület | Becslés |
| --- | ---: |
| Backend list + audit + contract + teszt | 2.5–3.5 nap |
| Frontend lista + form + detail/lifecycle | 3–4 nap |
| Conflict + audit + a11y/responsive | 2–2.5 nap |
| E2E és dokumentáció | 0.5–1 nap |
| **Összesen** | **8–11 mérnöknap** |

## 7. Definition of Done

- [x] Admin lista és audit OpenAPI-contracttal elérhető.
- [x] UUID másolása nélkül bejárható a workspace.
- [x] Editor/publisher permission- és státuszmátrixa helyes a komponens- és
  backend integrációs tesztekben.
- [~] Create/edit/publish/withdraw/republish teljes flow működik — backend
  PostgreSQL integrációval igazolt; valódi Authentik böngészős E2E pending.
- [x] Published tartalom nem szerkeszthető.
- [x] No-op nem jelez hamis verziónövekedést.
- [x] Version conflict adatvesztés és automatikus overwrite nélkül feloldható.
- [x] Audit minden verziót helyesen mutat.
- [x] Loading/empty/error/permission állapotok készek.
- [x] Backend és frontend tesztek, build, lint, migration és contract gate zöld.

## 8. Helyi ellenőrzési eredmény

2026-09-16:

- backend contract unit: 15/15 sikeres;
- friss, eldobható PostgreSQL 17 adatbázison az új admin read-model és a teljes
  M1 regresszió együtt: 52/52 sikeres;
- backend build, OpenAPI drift check és lint: sikeres, 0 warning/error;
- frontend contract check, production build, lint és 37/37 unit/component
  teszt: sikeres;
- 5000 soros `EXPLAIN (ANALYZE, BUFFERS)` az index előtt teljes sortot mutatott;
  az `0003_steady_leader.sql` után `Index Scan Backward using
  content_admin_updated_id_idx` szolgálta ki a lapot;
- a teszthez létrehozott `indaplay-phase2-test-postgres` konténer a futás után
  eltávolítva; kizárólag szintetikus adata volt;
- a viewer/editor/publisher valódi böngészős E2E az Authentik L2 hiánya miatt
  pending, ezért a teljes fázis külső validáció nélkül nem kap végleges „kész”
  státuszt.
