# Frontend Fázis 7 – Minőségkapu és átadás

2026-09-16 · Release-gate specifikáció. Lezárva: 2026-09-17.

## 1. Cél

A release csak akkor kész, ha a kritikus üzleti, jogosultsági, konfliktus- és
kiesési utak automatizáltan védettek, a UI hozzáférhető és reszponzív, a build
reprodukálható, a dokumentáció pedig friss checkoutból végrehajtható.

Ez nem „a végén tesztelünk” fázis: a unit/component/integration tesztek az egyes
fázisokkal együtt készülnek. A Fázis 7 a közös infrastruktúrát, a teljes E2E-t,
a release-mátrixot és az átadási evidence-t zárja.

## 2. Kötelező eszközrétegek

| Réteg | Eszköz | Felelősség |
| --- | --- | --- |
| Unit/component | Vitest + React Testing Library | pure helper, form, guard, dialog, state |
| HTTP mock | MSW | stabil API/problem esetek böngészőközeli tesztben |
| Contract | backend OpenAPI emitter + openapi-typescript diff | request/response drift |
| Browser E2E | Playwright | valódi route, browser, auth és full-stack flow |
| Accessibility | axe + kézi keyboard/screen-reader smoke | automata és interakciós hibák |
| Backend integration | meglévő backend test runner | új list/audit/ops API és invariánsok |

A pontos package verzió lockfile-ban rögzített. Új teszt dependency csak a közös
teszt setup és első valódi teszteset egyidejű szállításával kerülhet be.

## 3. Tesztarchitektúra

```text
frontend/
  src/test/
    setup.ts
    server.ts
    handlers/
    fixtures/
  src/**/*.test.ts(x)
  e2e/
    auth.spec.ts
    content-lifecycle.spec.ts
    search-operations.spec.ts
    operator-actions.spec.ts
  playwright.config.ts
```

- Fixture-ek a generált API típusokra `satisfies` ellenőrzést kapnak.
- Problem fixture mindig status + code + correlation ID mezővel készül.
- Nincs production credential a fixture-ben.
- MSW unhandled request tesztben hiba.
- Fake timer csak polling/unit szinten; E2E valós időt használ ésszerű timeouttal.
- Tesztnevek üzleti állítást írnak, nem implementációs részletet.

## 4. CI pipeline és kapuk

### P7-01 — Fast frontend gate

Minden PR-en, pontos Node 24.20 runtime-mal:

1. `npm ci`;
2. contract check;
3. TypeScript/Vite build;
4. lint warning nélkül;
5. unit/component/integration teszt;
6. tesztleak/unhandled rejection ellenőrzés.

Egy `npm run verify` vagy CI aggregátor lokálisan is ugyanezt futtatja.

### P7-02 — Backend contract/integration gate

- backend build/lint;
- OpenAPI check;
- új admin list/audit teszt;
- új ops action/idempotency/reindex/quarantine/repair teszt;
- schema migration up/down vagy a projekt elfogadott migration gate-je;
- route matrix és OpenAPI security ellenőrzés.

### P7-03 — E2E gate

Két szint:

- PR smoke: public search mock/full-stack minimum + auth adapter mock;
- release/nightly: valódi PostgreSQL, Authentik, NATS, Meili A/B full profile.

A valódi Authentik L2 hiánya release-blocker, nem automatikusan skipelt pass. A CI
egyértelmű `pending/external prerequisite` állapotot adhat nem-release ágon.

## 5. Kötelező E2E utak

### E2E-01 — PKCE és role guard

- viewer/editor/publisher login;
- callback state és returnTo;
- `/me` szerinti menü/route;
- refresh és logout;
- 401 recovery, 403 session megtartás;
- IdP kiesés redirect loop nélkül.

### E2E-02 — Publisher lifecycle

- lista → create → edit → publish;
- catalog/search láthatóság;
- withdraw → public 404/eltűnés;
- edit → republish;
- audit timeline;
- no-op verzió változatlan.

### E2E-03 — Version conflict

- két browser context ugyanazzal a contenttel;
- egyik ment, másik 409;
- server/local diff;
- kézi reapply;
- nincs force overwrite és nincs adatvesztés.

### E2E-04 — Search és operations fallback

- normál A/B;
- A down → 1 routeEligible, search siker;
- A+B down → 0 routeEligible, search 503;
- recovery;
- dashboard polling/background viselkedés legalább komponensszinten.

### E2E-05 — Operátori actionök

Ha Fázis 5 release scope:

- idempotens reindex start és progress;
- párhuzamos run elutasítás;
- outage confirmation;
- quarantine replay reason;
- content repair;
- refresh/restart recovery.

## 6. Kötelező állapotmátrix

Minden releváns képernyőn legalább:

| Állapot | Ellenőrzés |
| --- | --- |
| initial loading | skeleton/spinner, nincs layout összeomlás |
| background refresh | meglévő adat marad, stale jelzés |
| empty | következő lépést adó üzenet |
| partial/optional missing | komponensszintű „nem elérhető” |
| 401 | auth recovery/login |
| 403 | permission üzenet, session megmarad |
| 404 | domain not-found |
| 409 | slug/state/version/idempotency konfliktus |
| 413 | túl nagy payload |
| 422 | field-level validation |
| 503 | dependency/search unavailable külön |
| network/timeout | retry, mutationnél nincs auto-resubmit |
| stale data | utolsó sikeres érték és frissítési idő |

## 7. Accessibility kapu

- WCAG 2.2 AA cél a kritikus flow-kon;
- teljes keyboard bejárás;
- látható focus;
- minden input programozott label;
- mezőhiba inputhoz kötve;
- dialog focus trap, első fókusz és restore;
- status/progress nem csak színnel;
- toast és scenario progress megfelelő live regionnal, nem túlbeszélve;
- loading nem törli váratlanul a fókuszt;
- skip link és szemantikus landmarkok;
- zoom 200%-nál nincs kritikus tartalomvesztés;
- axe blocker/critical: nulla;
- kézi screen-reader smoke: login, create, conflict, reindex confirm.

## 8. Responsive és browser kapu

Viewportok:

- 360 × 800;
- 768 × 1024;
- 1280 × 800;
- 1440 × 900 opcionális vizuális baseline.

Browser minimum: a projekt által támogatott aktuális Chromium; release előtt
Firefox/WebKit smoke, ha a Playwright környezet rendelkezésre áll.

Ellenőrizendő: nav, listák, form, dialog, timeline, operations táblák, hosszú
title/correlation/error code, magyar ékezet és 200 karakteres határérték.

## 9. Biztonsági és adatminimalizálási kapu

- token/refresh token/ID token nincs DOM-ban, console-ban, exportban, screenshot
  fixture-ben vagy query key-ben;
- nincs raw Authorization header log;
- public view nem kap adminmezőt;
- quarantine API/UI nem ad event payloadot;
- operations nem ad Meili keyt, NATS credentialt vagy teljes DB URL-t;
- returnTo open redirect tesztelt;
- CSP/deployment header külön hosting scope lehet, de dokumentált;
- dependency audit eredménye triage-olt, nem vak automatikus major update;
- secret canary teszt az export/redaction útvonalon.

## 10. Teljesítmény és megbízhatóság

- route code splitting mérlegelendő az operations/demo nehéz képernyőkre;
- nincs request waterfall auth bootstrap után indokolatlanul;
- listák lapozottak, nincs korlátlan render;
- polling háttértabon áll és request nem halmozódik;
- React render loop és console error nincs a tesztfutásban;
- mutation retry default off;
- production build bundle méretét a release evidence rögzíti; kemény budget csak
  mért baseline után kerül be.

## 11. Dokumentáció és átadás

Kötelező frissítés:

- gyökér és frontend README: pontos Node, install, env, dev/prod build;
- Authentik callback és L2 runbook;
- három role és tesztelhető jogosultság;
- admin list/audit/ops endpoint contract;
- CLI-only határ;
- demo scenario futtatás és export;
- hiba/runbook kódok;
- ismert pending external prerequisite;
- release scope és migration sorrend.

Friss checkout próba egy olyan fejlesztő/gép által, amely nem használ korábbi
`node_modules`, env vagy browser session állapotot.

## 12. Funkciólefedési nyilvántartás

A backend capability mátrix minden sora kap:

- `UI`;
- `guided runbook`;
- `intentionally CLI-only`;
- vagy `not implemented backend` státuszt;

valamint owner, teszthivatkozás és indoklás. Ismeretlen/pending sorral release
nem zárható.

## 13. Release Definition of Done

- [x] Frontend fast gate pontos Node 24.20-on zöld.
- [x] Backend contract/integration gate zöld.
- [x] Kijelölt E2E suite zöld valódi full stacken.
- [x] Authentik L2 nem pending a release-scope authhoz.
- [x] Axe blocker/critical nulla, keyboard/screen-reader szemantikai smoke kész.
- [x] 360/768/1280 viewport ellenőrizve.
- [x] Állapotmátrix minden kritikus képernyőn lefedve.
- [x] Secret/adatminimalizálási review kész.
- [x] Friss checkoutból dokumentált indulás bizonyított.
- [x] Funkciólefedési mátrixban nincs gazdátlan vagy ismeretlen sor.
- [x] Evidence és ismert korlátok verziózva.

## 14. Becslés

| Terület | Becslés |
| --- | ---: |
| Tesztinfra + CI | 1–1.5 nap |
| Full-stack E2E és fixture-ek | 1.5–2.5 nap |
| Accessibility/responsive/security review | 1–1.5 nap |
| Dokumentáció, fresh checkout, evidence | 0.5–1 nap |
| **Összesen** | **4–6.5 mérnöknap** |

Az egyes fázisokkal együtt készülő unit/component tesztek ideje azok saját
becslésében szerepel; ez a szám a közös release-kapura vonatkozik.
