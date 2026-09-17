# Fázis 5 – M5 operátori beavatkozások közös backend–frontend terve

2026-09-16 · Dev-ready közös implementációs specifikáció.

## 1. Cél és biztonsági határ

Az operátor böngészőből, auditálható és idempotens API-n keresztül tud:

1. A vagy B indexre teljes reindexet indítani és követni;
2. karanténrekordot listázni, payload nélküli részletét megnyitni és indoklással
   replayelni;
3. egy content aktuális DB-állapotát A/B/both indexre kijavítani.

A controller nem futtat CLI-t vagy shellt. A meglévő `ReindexCoordinator`,
projection és JetStream/Meili adapterek service-ként használódnak újra.

Nem része:

- reindex cancel/rollback gomb;
- infrastruktúra leállítása vagy fault injection;
- szabad SQL/parancsfuttatás;
- event payload, credential, URL/API key megjelenítése;
- migráció, DB reset, baseline és smoke futtatása UI-ból.

## 2. Permission modell

Új permission: `ops:write`.

```text
viewer    -> []
editor    -> content:read, content:write
publisher -> content:read, content:write, content:publish, ops:read, ops:write
```

- Minden új mutation `ops:write`.
- A quarantine lista/detail és reindex action detail legalább `ops:read`.
- A veszélyes űrlapok megnyitásához is `ops:write`; nincs „elküldöm és majd a
  backend elutasítja” UX.
- A backend guard minden esetben kötelező; frontend guard csak felhasználói UX.

Később az `ops:write` külön operator role-ra leválasztható a route contract
változtatása nélkül.

## 3. Tartós operátori action modell

### 3.1 Új tábla

`operator_action`:

| Oszlop | Típus / szabály |
| --- | --- |
| `id` | UUID PK; a kliens `Idempotency-Key` értéke |
| `kind` | `reindex`, `quarantine_replay`, `content_repair` |
| `state` | `queued`, `running`, `succeeded`, `failed` |
| `request_fingerprint` | SHA-256 a normalizált, titokmentes requestből |
| `requested_by` | verifikált `actor.sub` |
| `requested_roles` | alkalmazásszerepek |
| `correlation_id` | kérés correlation ID |
| `reason` | trimelt 3–500 karakter |
| `target` | szűk, kind-specifikus JSON; secret/payload nélkül |
| `result` | szűk, kind-specifikus JSON; secret/payload nélkül, nullable |
| `error_code` | stabil operator/reindex kód, nullable |
| `created_at` | timestamptz |
| `started_at` | timestamptz, nullable |
| `heartbeat_at` | timestamptz, nullable |
| `completed_at` | timestamptz, nullable |

Indexek: `state, created_at`, valamint `kind, created_at`. A JSON mezők előtt
Zod schema áll; tetszőleges request vagy exception nem menthető beléjük.

### 3.2 Idempotency

- Minden mutation kötelező `Idempotency-Key: <uuid>` fejlécet kér.
- Első kérés atomikusan létrehozza az actiont és `202` választ ad.
- Ugyanaz a kulcs + azonos fingerprint a meglévő actiont adja vissza; nem indul
  második művelet.
- Ugyanaz a kulcs + más request `409 idempotency_conflict`.
- A reindex `runId` értéke az action `id`; a `ReindexCoordinator` kívülről kapja,
  nem generál második UUID-t.
- A kliens submit előtt generál és a befejezett/egyértelműen elutasított kérésig
  memóriában tartja a kulcsot.

### 3.3 Háttérfuttató

Új `OperatorActionRunner`:

- rövid polling/wakeup alapján claimeli a `queued` rekordot `FOR UPDATE SKIP LOCKED`
  vagy egyenértékű atomikus update-tel;
- futás közben heartbeatet ír;
- sikerre csak safe resultet, hibára stabil error code-ot ment;
- exception szöveg csak strukturált szerverlogba kerülhet, token/secret nélkül;
- shutdownkor új actiont nem claimel, az aktív reindexet abort signallal lezárja;
- nincs automatikus mutation retry ismeretlen hiba után.

Restart recovery:

- stale `running` replay/repair action `failed/internal_error`; a felhasználó új
  idempotency key-jel tudja újraindítani;
- stale aktív reindex action `failed/aborted`, a control row is `failed/aborted`;
- félbeszakadt reindex nem folytatódik középről; csak új teljes futás indítható;
- `queued` action új processzben futtatható;
- advisory lock marad a tényleges reindex-kizárás végső forrása.

## 4. Backend service-extrakció

### P5-BE-01 — Quarantine service

A `quarantine-cli.ts` üzleti része új injektálható service-be kerül:

- `list(options)`;
- `inspect(sequence)`;
- `replay(sequence, reason, actionId)`.

A CLI ugyanazt a service-t hívja, így nem alakul ki két eltérő replay szabály.

Lista:

- a dedikált quarantine stream stream-sequence szerint legújabb elöl;
- cursor opaque base64url `{v:1,beforeSequence:number}`;
- limit alap 50, max 100;
- minden item: quarantine stream sequence, quarantineId, failedAt, errorCode,
  originalEventId, original stream/sequence, subject és durable;
- schemahibás rekord is látható legalább sequence + `schemaValid=false` alakban;
- event payload nincs a válaszban;
- stream gap/retention biztonságosan átugorható, bounded scan mellett.

Replay:

- eredeti stored message meglétének és sémájának ellenőrzése;
- aggregate létezésének ellenőrzése;
- publish msgID `replay:<quarantineId>`, ezért broker-szinten is deduplikált;
- safe result: quarantine sequence/ID, original sequence, replay stream sequence,
  `duplicate`; payload nincs;
- a quarantine rekord nem törlődik.

### P5-BE-02 — Content repair service

A CLI repair ága új `ContentRepairService`-be kerül:

- UUID validáció;
- aktuális content DB-ből;
- `projectionFor` az egyetlen döntési út;
- target `a | b | both`;
- Meili taskok megvárása a meglévő adapter budgetjével;
- safe result: content ID és `{alias, taskUid}` lista;
- részleges hiba esetén action failed és a sikerült taskok safe metaadata a logban;
  automatikus rollback nincs, mert az upsert/delete idempotens és új repairrel
  konvergálható.

A CLI ezt a service-t hívja.

### P5-BE-03 — Reindex start/run szétválasztás

A `ReindexCoordinator` kap külső `runId`-t. A run továbbra is:

- globális + index advisory lockot használ;
- ellenőrzi a másik index ready/reachable állapotát;
- outage/production módban pontos DB target confirmationt kér;
- a meglévő draining → importing → swapping → catching_up → verifying → ready
  sorrendet és write barriert tartja;
- hibára durable `failed` control állapotot ír.

A runner tartja életben a teljes hívást; a HTTP kérés nem várja meg. A
`processing-status` control mezői maradnak a részletes progress forrásai, az
`operator_action` az idempotency/audit/terminal result forrása.

### P5-BE-04 — Reindex preflight

`GET /admin/search/reindex-preflight?index=a&allowSearchOutage=false`

Permission: `ops:write`.

Válasz:

```ts
type ReindexPreflightView = {
  index: 'a' | 'b';
  otherIndex: 'a' | 'b';
  otherIndexReady: boolean;
  otherIndexReachable: boolean | null;
  activeRunId: string | null;
  canStartNormally: boolean;
  confirmationRequired: boolean;
  confirmationTarget: string | null;
  blockers: Array<'active_run' | 'other_index_unavailable' | 'search_disabled'>;
};
```

A `confirmationTarget` csak a DB neve, soha nem teljes URL. A POST minden
preflight feltételt újraellenőriz; a GET nem foglal lockot és nem garancia.

### P5-BE-05 — Reindex API

`POST /admin/search/reindex-runs`

```ts
type StartReindexBody = {
  index: 'a' | 'b';
  reason: string;
  allowSearchOutage?: boolean;
  confirmTarget?: string;
};
```

- `ops:write`, Idempotency-Key;
- sikeres admission: `202 OperatorActionView`;
- normalizált requestben `confirmTarget` nem kerül resultba/logba;
- request actiont queue-z; runnernél minden precondition újraellenőrződik;
- nincs cancel endpoint.

`GET /admin/search/reindex-runs/:runId`

- `ops:read`;
- action state + index + reason/requestedBy/timestamps;
- ha aktuális control `runId` egyezik: phase/progress/boundaries;
- terminal result/error code későbbi reindex után is lekérhető az action rekordból;
- ismeretlen run `404 operation_not_found`.

### P5-BE-06 — Quarantine API

| Endpoint | Permission | Eredmény |
| --- | --- | --- |
| `GET /admin/search/quarantine` | `ops:read` | cursoros, payload nélküli lista |
| `GET /admin/search/quarantine/:sequence` | `ops:read` | payload nélküli inspect |
| `POST /admin/search/quarantine/:sequence/replays` | `ops:write` | 202 action |

Replay body `{ reason: string }`, kötelező Idempotency-Key.

### P5-BE-07 — Repair API

`POST /admin/search/repairs`

```ts
type StartContentRepairBody = {
  contentId: string;
  target: 'a' | 'b' | 'both';
  reason: string;
};
```

- `ops:write`, Idempotency-Key, 202 action;
- action detail a közös `GET /admin/operator-actions/:id` végponton;
- a válasz nem tartalmaz content payloadot vagy Meili endpointot.

### P5-BE-08 — Action detail

`GET /admin/operator-actions/:id`, `ops:read`.

Közös mezők: id, kind, state, requestedBy, requestedRoles, reason, target safe
projection, correlationId, errorCode, timestamps, kind-specifikus safe result.

Az action lista nem szükséges a Fázis 5 minimumához; reindex history későbbi
bővítés. A UI a saját action ID-ját és az aktuális reindex run ID-t követi.

## 5. HTTP hibaszerződés

| Helyzet | HTTP / code |
| --- | --- |
| hiányzó/hibás Idempotency-Key | 422 `validation_failed` |
| azonos key, eltérő request | 409 `idempotency_conflict` |
| aktív reindex | action async `failed/reindex_already_running`, vagy admissionkor 409 |
| másik index nem elérhető normál módban | `failed/other_index_unavailable` |
| hiányzó target confirmation | 422 `target_confirmation_required` |
| quarantine sequence nincs | 404 `quarantine_not_found` |
| eredeti event lejárt | action `failed/quarantine_original_expired` |
| hibás quarantine/event schema | 409 `quarantine_schema_invalid` |
| aggregate nincs | 404/failed `quarantine_aggregate_unknown` |
| repair content nincs | 404/failed `repair_target_unknown` |
| Meili task failed | action `failed/repair_task_failed` |
| broker/DB/index nem elérhető | stabil domain code + 503 csak sync read/admission hibánál |

Az async action üzleti hibája 202 után nem változtatja meg az eredeti HTTP
státuszt; a detail `state=failed` + stabil `errorCode` mezőt ad.

## 6. Frontend munkacsomagok

### P5-FE-01 — Operations API és action polling

- generált request/response típusok;
- idempotency UUID helper;
- közös `useOperatorAction(id)` 2 s polling running, 10 s queued, terminalnál stop;
- visibility hidden alatt stop, fókuszban refetch;
- mutation response elvesztésekor ugyanazzal a key-jel explicit retry;
- action ID sessionStorage-ban csak az aktív wizard helyreállításához, token nélkül.

### P5-FE-02 — Reindex wizard

Lépések:

1. index A/B kiválasztás;
2. élő preflight és másik index összefoglaló;
3. normál vagy külön „keresési kiesést engedélyező” veszélyes ág;
4. kötelező reason;
5. ha kell, exact DB név begépelése, paste engedhető;
6. összegzés és egyszeri submit;
7. progress oldal.

Normál mód blokkolt, ha a másik index nem ready+reachable. Outage mód külön
veszélyszínnel, kétlépcsős megerősítéssel. A POST utáni backend újraellenőrzés
hibája action failure-ként látszik.

### P5-FE-03 — Reindex progress

- queued/running/succeeded/failed action állapot;
- phase stepper a backend rögzített sorrendjével;
- imported/expected, S0/H/S1, elapsed time;
- index routeEligible és másik index állapota;
- stabil error code → runbook magyarázat;
- refresh után runId route-ból (`/operations/reindex/:runId`) helyreáll;
- failed/interrupted esetén csak „Új teljes futás”, nincs resume/cancel;
- success után processing/search query invalidáció.

### P5-FE-04 — Quarantine lista és inspect

- `/operations/quarantine` cursoros lista;
- error code, failedAt, durable, event ID, original sequence;
- schema invalid rekord külön jelzéssel;
- inspect drawer/dialog payload nélkül;
- replay csak `ops:write`;
- retention miatt eltűnt rekord 404-barát állapot.

### P5-FE-05 — Replay dialog

- kötelező 3–500 karakteres reason;
- következmény: az eredeti event újra a projection streamre kerül, quarantine
  rekord nem törlődik;
- submit duplakattintás ellen tiltott;
- action progress és terminal result;
- duplicate publish is success-with-deduplication, nem új esemény;
- success után quarantine count/processing invalidáció, de listaelemet nem töröl.

### P5-FE-06 — Repair form

- `/operations/repair`;
- content UUID + A/B/both + reason;
- opcionális admin content summary előnézet read permissionnel;
- nincs teljes content payload az ops response-ban;
- action progress, task UID-k technikai disclosure-ben;
- részleges/failed nem jelenhet meg sikerként;
- success után érintett content/search/processing invalidáció.

### P5-FE-07 — Permission, secret és accessibility review

- `ops:read` csak megfigyel és inspectál;
- `ops:write` indít;
- confirm dialog focus trap, destructive action pontos névvel;
- status live region, polling nem rángatja a fókuszt;
- DOM/screenshot/export nem tartalmaz token, API key, NATS URL, Meili URL,
  teljes DB URL vagy event payload adatot;
- target DB név csak a confirmation lépésben, disclosure nélkül.

## 7. Tesztmátrix

### Backend unit/integration

1. permission matrix `ops:read` vs `ops:write`;
2. idempotency same/same és same/different;
3. action claim két runnerrel, egyszeri végrehajtás;
4. queued restart, stale running recovery;
5. reindex external runId és advisory lock;
6. other index guard és exact confirmation;
7. minden reindex phase/error code;
8. quarantine list cursor/gap/schema-invalid;
9. inspect payload-free contract;
10. replay original expired/schema invalid/aggregate unknown/deduplicated;
11. repair A/B/both/upsert/delete/task failure;
12. structured log secret- és payloadmentesség;
13. CLI regresszió: ugyanazok a service-ek;
14. OpenAPI/ROUTE_MATRIX contract gate.

### Frontend component/integration

1. reindex preflight változik submit előtt;
2. normál/outage wizard és confirmation mismatch;
3. queued → phases → success;
4. minden failed code runbook mapping;
5. refresh/runId restore;
6. nincs cancel/resume action;
7. quarantine pagination/inspect/replay;
8. duplicate replay eredmény;
9. repair partial failure;
10. lost HTTP response ugyanazzal idempotency key-jel;
11. `ops:read`/`ops:write` UI-mátrix;
12. token/payload/secret absence DOM-ban.

### Full-stack E2E

- A reindex, B végig routol; progress készre fut;
- másik index down: normál blokk, outage mód exact confirmationnel indul;
- párhuzamos reindex elutasított;
- quarantine inspect + replay reasonnel;
- content repair both targetre;
- app refresh aktív run közben;
- backend restart után megszakadt run failed/aborted, új teljes run indítható.

## 8. Implementációs sorrend

```text
ops:write + schema/migration
  -> action repository + runner + recovery
  -> CLI service-extrakció (quarantine, repair)
  -> ReindexCoordinator külső runId
  -> preflight + HTTP endpointok + OpenAPI
  -> frontend action polling
  -> reindex wizard/progress
  -> quarantine/replay
  -> repair
  -> integration/E2E/evidence
```

A UI mock contracttal csak az OpenAPI sémák véglegesítése után induljon; az async
állapotgép és hibatérkép változása különben drága újraírást okozna.

## 9. Becslés

| Terület | Becslés |
| --- | ---: |
| Permission, migration, action runner/idempotency | 2–3 nap |
| Service-extrakció + reindex/ops endpointok | 2.5–3.5 nap |
| Frontend wizard/quarantine/repair | 3–4 nap |
| Integráció, E2E, runbook/evidence | 1.5–2 nap |
| **Összesen** | **9–12.5 mérnöknap** |

Ez magasabb a roadmap első 5–8 napos durva becslésénél. A különbség oka a valódi
tartós idempotency, restart recovery és operátori audit; ezek elhagyásával a UI
gyorsabban elkészülne, de veszélyes lost-response és dupla-submit rést hagyna.

## 10. Definition of Done

- [x] `ops:write` külön permissionként él és minden mutationt véd.
- [x] Minden mutation tartósan idempotens és auditált.
- [x] Controller nem futtat shellt/CLI-t.
- [x] Reindex 202 + durable progress, refresh után folytatható megfigyelés.
- [x] Nincs párhuzamos reindex és nincs nem biztonságos cancel.
- [~] Outage mód exact DB confirmationnel és backend oldali újraellenőrzéssel
  implementált; valódi outage full-stack E2E nyitott.
- [x] Quarantine lista/inspect payloadmentes, replay reason kötelező.
- [x] Repair A/B/both célra konvergál és failure nem látszik successnek.
- [x] Restart recovery tranzakciós, a megszakadt reindex nem auto-resume.
- [~] Secret/token/payload allowlistelt projectionökből ki van zárva; a teljes
  Fázis 7 security/screenshot review nyitott.
- [~] Backend/frontend célzott teszt és OpenAPI gate zöld; a Phase 5 full-stack
  E2E és evidence nyitott.
