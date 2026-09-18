# Final review – több-agent koordináció

2026-09-18 · Koordinátor: Codex fő agent.

Ez a dokumentum a [backend](FINAL-BACKEND-MILESTONE.md) és
[frontend](FINAL-FRONTEND-MILESTONE.md) final milestone párhuzamos
végrehajtásának közös állapottáblája. A milestone-dokumentumok a scope és a
Definition of Done forrásai; ez a fájl kizárólag az agent-tulajdonlást, az
átadást és az integrációs sorrendet rögzíti.

## Szabályok

- Egy implementációs fázisnak pontosan egy író agentje van.
- Minden író agent külön branchben és worktree-ben dolgozik.
- Backend és frontend fázis futhat párhuzamosan; ugyanazon milestone következő
  fázisa csak az előző integrálása és zöld kapuja után indul.
- Az agent nem merge-el `main`-re és nem módosít más agent worktree-jében.
- Az agent a saját evidence fájlját frissíti, és egyetlen, review-zható commitot
  vagy világosan felsorolt kis commitsort ad át.
- Merge előtt a koordinátor scope-review-t és célzott teszteket futtat. A két
  ág integrálása után közös contract/build/test kapu következik.
- Konfliktus, bizonytalan architekturális döntés vagy scope-bővülés esetén az
  agent megáll és döntési kérdést ad át; nem választ önkényesen új topológiát.

## Aktuális hullám – W1

| Szerep | Tulajdon | Branch | Worktree | Állapot |
| --- | --- | --- | --- | --- |
| Claude | Backend BE-F1: S1, S2, S4, S7, O1 | `codex/final-be-f1` | `/private/tmp/tv2-poc-be-f1` | kiadható |
| Cursor | Frontend FE-F1: M1, L7, L8, L11 | `codex/final-fe-f1` | `/private/tmp/tv2-poc-fe-f1` | kiadható |
| Codex fő agent | koordináció, baseline, integráció, közös kapu | `main` | repository checkout | folyamatban |
| Codex reviewer | W1 átfedés-, contract- és tesztterv audit | nincs írás | megosztott olvasás | folyamatban |

Kiadandó feladatlapok: [Claude / backend BE-F1](agent-prompts/W1-CLAUDE-BACKEND.md)
és [Cursor / frontend FE-F1](agent-prompts/W1-CURSOR-FRONTEND.md).

### W1 koordinátori döntések

- Production browser/API topológia: same-origin ingress, relatív `/api` proxy;
  backend CORS alapból kikapcsolva.
- Publikus limiter: alkalmazásoldali, route-szintű; stabil `rate_limited` 429,
  `Retry-After`, OpenAPI contract és dokumentált proxy/IP policy.
- Backend application image: külön production Compose overlay/profil, nem a
  dependency-khez használt meglévő `full` profil része.
- `/editorial`: egy release-ciklusig dokumentált redirect marad, a mögöttes
  holtkód teljesen törlendő.
- Frontend runtime igazságforrások: generált permissiontípus, egyetlen lokális
  role-mátrix, kategóriák gazdája `features/contents/schemas.ts`, közös UUID
  helper v1–v8 támogatással és nil elutasítással.

## Kötelező agent-átadás

Minden implementáló agent válasza tartalmazza:

1. branch és commit SHA;
2. lezárt audit-ID-k;
3. módosított fájlok és viselkedés röviden;
4. futtatott parancsok és pontos eredmények;
5. nem futtatott kapuk és az ok;
6. nyitott döntés, kockázat vagy következő fázist érintő megjegyzés;
7. annak kijelentése, hogy nem merge-elt és nem módosított a scope-on kívül.

## Koordinátori integrációs kapu

- [ ] Az agent commitja csak a kiosztott audit-ID-ket és szükséges teszteket érinti.
- [ ] A milestone checklist és a megfelelő evidence minden lezárt ID-re frissült.
- [ ] Nincs elveszett vagy gyengített korábbi teszt/invariáns.
- [ ] Backend contractváltozás esetén az OpenAPI snapshot és a frontend generated
  contract drift ellenőrzött.
- [ ] A branch saját typecheck/lint/teszt kapuja zöld.
- [ ] A két W1 branch együtt, tiszta integrációs állapotban is zöld.
- [ ] Csak ezután jelölhető a fázis késznek és osztható ki BE-F2/FE-F2.

## W1 baseline – 2026-09-18

Runtime: Node `24.20.0`. A dependency stack a Compose healthcheckek szerint
healthy volt.

| Kapu | Eredmény |
| --- | --- |
| Frontend `npm run verify` | PASS – contract, build, compiler, lint; 31 fájl, 139/139 teszt |
| Frontend production bundle | PASS – 685462 byte JS, 19358 byte CSS |
| Backend build/lint/OpenAPI | PASS – 0 warning, 0 error, nincs contract drift |
| Backend teljes Vitest első élő-stack futás | 227/232; 5 dependency/config timeout a search/relay suite-ban |
| Guardolt `poc_test` reset | PASS – minden migráció sikeres |
| Relay célzott újrafutás reset után | PASS – 17/17 |
| Search célzott újrafutás reset után | 37/38; M4-T21/T22 DB connection timeout/dependency_unavailable |
| Közvetlen `poc_test` connectivity a hiba után | PASS – `select current_database(), 1` |

A backend baseline fennmaradó egy esete élő-stack kapcsolat-időzítési zajként
van rögzítve, nem zöldnek minősítve. Integrációkor az érintett M4-T21/T22 esetet
és a teljes suite-ot újra kell futtatni; agent-regresszió csak diff- és ismételt
futási bizonyíték alapján állapítható meg.

## Hullámok

| Hullám | Backend | Frontend | Indítás feltétele |
| --- | --- | --- | --- |
| W1 | BE-F1 | FE-F1 | baseline commit kész |
| W2 | BE-F2 | FE-F2 | W1 integrált és zöld |
| W3 | BE-F3 | FE-F3 | W2 integrált és zöld |
| W4 | BE-F4 | FE-F4 | W3 integrált és zöld |
| W5 | BE-F5 | FE-F5 | W4 integrált és zöld |
| Final | teljes backend evidence | teljes frontend evidence | W5 integrált és zöld |

## Végső közös kapu

- [ ] Backend 25/25 és frontend 21/21 audit-ID lezárt evidence-szel.
- [ ] Backend build/typecheck/lint/OpenAPI/coverage/integráció/Auth L2 zöld.
- [ ] Frontend build/typecheck/lint/contracts/coverage/unit/component/axe/E2E zöld.
- [ ] Friss checkout runbook és production-topológia döntések konzisztensen
  dokumentáltak.
- [ ] Független final diff review nem talál scope-regressziót vagy elhallgatott
  elfogadást.
