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

## Lezárt hullám – W1

| Szerep | Tulajdon | Branch | Worktree | Állapot |
| --- | --- | --- | --- | --- |
| Claude | Backend BE-F1: S1, S2, S4, S7, O1 | `codex/final-be-f1` | `/private/tmp/tv2-poc-be-f1` | integrálva (`f4b4154`) |
| Cursor | Frontend FE-F1: M1, L7, L8, L11 | `codex/final-fe-f1` | `/private/tmp/tv2-poc-fe-f1` | integrálva (`fa65ee2`) |
| Codex fő agent | review-javítás, production ingress, integráció, közös kapu | `main` | repository checkout | kész |
| Codex reviewer | W1 átfedés-, contract- és scope audit | nincs írás | megosztott olvasás | kész |

Átadott feladatlapok: [Claude / backend BE-F1](agent-prompts/W1-CLAUDE-BACKEND.md)
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

- [x] Az agent commitja csak a kiosztott audit-ID-ket és szükséges teszteket érinti.
- [x] A milestone checklist és a megfelelő evidence minden lezárt ID-re frissült.
- [x] Nincs elveszett vagy gyengített korábbi teszt/invariáns.
- [x] Backend contractváltozás esetén az OpenAPI snapshot és a frontend generated
  contract drift ellenőrzött.
- [x] A branch saját typecheck/lint/teszt kapuja zöld.
- [x] A két W1 branch együtt, tiszta integrációs állapotban is zöld.
- [x] Csak ezután jelölhető a fázis késznek és osztható ki BE-F2/FE-F2.

## W1 integrációs eredmény – 2026-09-18

| Kapu | Eredmény |
| --- | --- |
| Backend teljes verify, Node 24.20.0 | PASS – 24 fájl, 267/267 teszt, 0 skip |
| Frontend teljes verify | PASS – 34 fájl, 149/149 teszt |
| Frontend E2E typecheck | PASS |
| OpenAPI → frontend generated contract | PASS – `429` és `rate_limited` integrálva |
| Production backend image | PASS – nem-root, healthy, live/ready 200 |
| Production web/ingress image | PASS – nem-root, healthy, SPA/deep-link/API 200 |
| Same-origin/CORS contract | PASS – `/api` prefix levágva, CORS header nincs |
| Dependency host exposure | PASS – mind a hat tényleges publikáció `127.0.0.1`, minden service healthy |

A smoke-hoz létrehozott izolált Compose projektet és tesztvolume-ot a mérés után
eltávolítottuk. A normál fejlesztői dependency volume-ok megmaradtak.

## Aktuális hullám – W2

| Szerep | Tulajdon | Branch | Worktree | Állapot |
| --- | --- | --- | --- | --- |
| Cursor | Frontend FE-F2: M2, L3, L4, L5, L9 | `codex/final-fe-f2` | `/private/tmp/tv2-poc-fe-f2` | kiosztásra kész |
| Codex | Backend BE-F2: S3, S5, S6, C2, O2 | `codex/final-be-f2` | `/private/tmp/tv2-poc-be-f2` | átadás kész; teljes verify zöld |
| Codex | koordináció, Cursor-review, integrációs kapu | `main` | repository checkout | folyamatban |

Feladatlapok: [Cursor / frontend FE-F2](agent-prompts/W2-CURSOR-FRONTEND.md) és
[Codex / backend BE-F2](agent-prompts/W2-CODEX-BACKEND.md).

### W2 konfliktus- és contract-stratégia

- Cursor kizárólag frontend runtime/request lifecycle fájlokat és frontend
  evidence-et ír; Codex kizárólag backend trust-boundary/logging fájlokat és
  backend evidence-et ír.
- Generated contract és OpenAPI alapértelmezésben egyik ágon sem változik.
- A közös koordinációs fájl és a két milestone összesített státusza a koordinátor
  tulajdona; az agent csak a saját fázis-checklistjét/evidence szakaszát frissíti.
- Integrációs sorrend: backend review+merge, frontend review+merge, contract
  drift ellenőrzés, backend teljes verify, frontend verify+E2E typecheck.

## Tervezett hullám – W3

A W3-ban csak két szereplő vesz részt: Codex és Cursor. Claude nem kap
tulajdont, review-feladatot vagy kapuszerepet. A hullám **nem indulhat el**, amíg
a W2 mindkét ága nincs integrálva, és a közös W2 kapu nem zöld. Mindkét W3
worktree ugyanarról, a W2 utáni tiszta `main` commitról készül.

| Szerep | Tulajdon | Branch | Worktree | Indítási állapot |
| --- | --- | --- | --- | --- |
| Codex | Backend BE-F3: C1, C6, C7, C8, D2; frontend review és integráció | `codex/final-be-f3` | `/private/tmp/tv2-poc-be-f3` | W2 közös kapuja után |
| Cursor | Frontend FE-F3: L2, L6, L10, I2; backend read-only review | `codex/final-fe-f3` | `/private/tmp/tv2-poc-fe-f3` | W2 közös kapuja után |

Feladatlapok: [Codex / backend BE-F3](agent-prompts/W3-CODEX-BACKEND.md) és
[Cursor / frontend FE-F3](agent-prompts/W3-CURSOR-FRONTEND.md).

### W3 döntések és határok

- A backend megtartja a jelenlegi HTTP/OpenAPI alakot. A karanténkurzor
  jelentése pontosodik, de a `nextCursor` mező és a kódolás formája nem
  változik.
- A `capacity` broker-hiba külön kategória marad, mert operátori beavatkozást
  jelez; a W3 ezt a retry logban és a processing statusban bizonyíthatóan
  megkülönbözteti a `transient` hibától. Új publikus hibakód nem készül.
- A frontend health hívásai mindig anonimak. A StatusBar nem használ
  modul-globális, versenyző „utolsó correlation ID” állapotot; a kijelzett
  azonosító egy név szerint megjelölt health válaszhoz tartozik.
- A reindex preflight és a health polling külön policy. Mindkettő megáll
  rejtett lapon, visszatéréskor frissít, és egyik sem indít második kérést
  aktív fetch mellé.
- A backend ág csak backend forrást, tesztet, recovery/ADR dokumentációt és
  backend evidence-et ír. A frontend ág csak frontend forrást, tesztet és
  frontend evidence-et ír. Mindkét agent csak a saját F3 checklistjét
  frissítheti; a milestone összesített státusza és a koordinációs dokumentum
  a koordinátor tulajdona.

### W3 review- és integrációs sorrend

1. Codex és Cursor párhuzamosan implementál a közös W2 utáni baseline-ról.
2. Cursor átadja az FE-F3 commitot; Codex scope-, timer-, auth-header- és
   request-verseny review-t futtat rajta.
3. Codex átadja a BE-F3 commitot; Cursor az FE-F3 lezárása után, írás nélkül
   ellenőrzi a kurzor-kontraktust, az audit fail-closed ágat és a
   dokumentáció reprodukálhatóságát.
4. Találatot mindig az eredeti ág tulajdonosa javít; keresztágas írás nincs.
5. Integrációs sorrend: BE-F3, majd FE-F3; ezután contract drift, backend
   teljes verify, frontend verify és E2E typecheck.
6. W4 csak akkor osztható ki, ha a két evidence fájl teljes, nincs nyitott
   review-találat, és a W3 közös kapuja zöld.

### W3 közös kapu

- [ ] BE-F3 mind az öt, FE-F3 mind a négy audit-ID-je evidence-szel lezárt.
- [ ] A ritka, 2000-nél nagyobb karanténrés lapozása nem hagy ki üzenetet és
  végesen eléri a stream elejét.
- [ ] Ismeretlen audit action belső hibát ad; korlátlan audit repository út
  nincs.
- [ ] A `capacity` és `transient` broker-hiba megfigyelhetően különbözik, a
  forward-only migrációs recovery policy reprodukálható.
- [ ] Health kérés nem hordoz Bearer headert; tartó outage alatt a polling
  ritkul, recovery után 10 másodpercre áll vissza.
- [ ] A reindex preflight látható lapon friss, rejtett lapon szünetel, és a
  submit döntés nem korlátlanul elavult adatra épül.
- [ ] Párhuzamos requestek mellett a StatusBar correlation ID-ja nem
  last-write-wins globális állapotból származik.
- [ ] Backend `npm run verify`, frontend `npm run verify` és
  `npm run e2e:typecheck` Node 24.20.0-n zöld; OpenAPI/generated contract drift
  nincs.

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
