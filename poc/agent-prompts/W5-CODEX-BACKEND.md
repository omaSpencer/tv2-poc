# W5 Codex feladatlap – BE-F5 közös infrastruktúra és minőségkapu

A koordinátor a `/private/tmp/tv2-poc-be-f5` worktree-ben, a
`codex/final-be-f5` branchen valósítja meg a BE-F5 fázist. A baseline a W4
integrációs kapuját lezáró tiszta `main`, commit: `8dfcfd8`.

## Kizárólagos scope

Audit-ID-k: **A1, A2, A3, T1, T2**. Módosítható a backend production
forrás, backend teszt és segédszkript, backend package/coverage konfiguráció,
backend README/runbook, a backend alatt lévő Authentik blueprint és production
Compose overlay, `poc/FINAL-BACKEND-EVIDENCE.md`, valamint kizárólag a BE-F5
checklist a `poc/FINAL-BACKEND-MILESTONE.md` fájlban.

Frontend forrás, frontend package-lock, OpenAPI/generated contract, a közös
`.github/workflows/release-gates.yml`, a koordinációs dokumentum és a
milestone-összesítés nem módosítható. Publikus HTTP/OpenAPI szerződés csak
bizonyítottan szükséges security változással bővülhet; ilyen igénynél előbb a
koordinátor dönt.

## Rögzített cross-stack szerződés

- A production kliens SPA marad, W5-ben nem épül új BFF/session-szerver.
- A frontend normál OIDC user/access/refresh tokenje csak memóriában élhet. A
  PKCE redirect egyszer használatos state/verifier adata továbbra is kerülhet
  sessionStorage-ba, de token nem.
- Az Authentik blueprint tartsa meg a jelenlegi issuer/audience és 5 perc / 1
  óra access/refresh élettartamot, és vegye fel a strict
  `http://127.0.0.1:5173/auth/silent-callback` redirectet. A frontend ezen
  keresztül, `prompt=none` silent flow-val állítja helyre a memóriában elveszett
  munkamenetet oldal-újratöltés után.
- A production Compose web build a Cursor ág által biztosított publikus
  build-arg contractot köti be: `VITE_API_BASE=/api`,
  `VITE_OIDC_ISSUER_URL`, `VITE_OIDC_CLIENT_ID`,
  `VITE_OIDC_REDIRECT_URI`, `VITE_OIDC_POST_LOGOUT_REDIRECT_URI`,
  `VITE_OIDC_SILENT_REDIRECT_URI`, valamint
  `VITE_ALLOW_MANUAL_TOKEN=false`. Ezek egyikében sem lehet titok; a production
  env sample ezt explicit mondja ki.
- A valódi Authentik L2 gate cross-stack kapu: a backend ág előkészíti a
  providert, a backend ellenőrzést és a dokumentációt; a Cursor frontend ága
  adja a valódi böngészős login/renew/reload/logout útat. T2 csak az
  integrált közös futás után jelölhető teljesen késznek.

## Kötelező megoldási szerződés

1. **A1 – közös deadline, backoff és settings util**
   - A relay és projection worker duplikált `raceDeadline` implementációja
     egyetlen, timer-cleanupot garantáló közös modulba kerüljön. Nulla/negatív
     deadline, gyors work, timeout és reject ág fake clockkal legyen tesztelve.
   - A közös D08 retry-létra, attempt-clamp és ±20% jitter tiszta,
     injektálható-random helper legyen; relay és search worker ugyanazt
     használja, de saját attempt state-et tartson. A refaktor nem változtathat
     retry sorrendet, resetpontot vagy shutdown wake szemantikát.
   - A bootstrap és reindex importer managed-settings összehasonlítása egy
     igazságforrásból kezelje a rendezett `searchableAttributes` és a
     halmazként értelmezett filter/display/sort mezőket. Meilisearch újabb
     objektumos filter alakjának normalizálása ne vesszen el.
2. **A2 – egyetlen logger bekötési pont**
   - Production kódban a `pino()` konstrukció egyetlen observability/logger
     modulban maradhat. Bootstrap, relay, search service/worker, reindex és token
     verifier ugyanabból a root loggerből vagy annak komponens-child loggeréből
     dolgozzon; az ad hoc példányok szűnjenek meg.
   - A logger DI/factory tesztben felülírható legyen. A meglévő strukturált
     eventmezők és logszintek maradjanak kompatibilisek.
   - Központi, fail-closed redakció fedje legalább az Authorization/cookie,
     access/id/refresh token, jelszó/secret/api key és DSN credential mezőket,
     mély objektumban és serializer/error ágon is. Regressziós teszt sentinel
     értékkel vizsgálja a bootstrap, HTTP boundary, relay, search és identity
     logokat. Nyers request, response vagy error objektum továbbra sem logolható.
3. **A3 – production forrásnyelv**
   - A `poc/backend/src/**` production kommentjei és JSDocjai legyenek angolul.
     Magyar operátori/user dokumentáció, felhasználói hibaüzenet és tesztleírás
     maradhat magyar; runtime viselkedés vagy szerződés nem változhat emiatt.
   - Készüljön dokumentált inventory a megtalált és lefordított production
     kommentekről. Ne kerüljön be törékeny, teljes természetes nyelvet
     „felismerő” regex-kapu.
4. **T1 – backend coverage gate**
   - A backend saját Vitest-verziójához pontosan illeszkedő
     `@vitest/coverage-v8` verzió, commitolt konfiguráció és `test:coverage`
     script készüljön. A `verify` ugyanazt a teljes suite-ot egyszer,
     coverage-del futtassa; ne fusson előbb külön `npm test`. A mérés a
     production `src/**` kódot célozza; generált,
     deklaratív vagy valóban nem futtatható fájl csak indoklással zárható ki.
   - Előbb rögzítsd a valódi lines/functions/branches/statements baseline-t,
     majd annak lefelé kerekített, legfeljebb kis stabilitási tartalékkal
     csökkentett globális thresholdját. A gate ne auto-update-eljen és ne
     engedjen coverage-esést.
   - A teljes integrációs szolgáltatásokat igénylő suite-tal mérj; csak
     coverage-szám növeléséért ne írj értéktelen tesztet.
5. **T2 – valódi Authentik L2 release gate**
   - Frissítsd a blueprinteket/runbookokat a silent callback szerződésre, és
     szüntesd meg azokat a „L2 pending” állításokat, amelyeket a W4-ben már
     bizonyított valódi Authentik környezet megcáfol.
   - A release evidence külön nevezze meg: discovery issuer/JWKS, valódi token
     backend audience/issuer elfogadása, mindhárom szerep jogosultságmátrixa,
     401 hibás/lejárt tokenre, az 5 perces access token megújulása, reload utáni
     IdP-session recovery és logout utáni anonimitás.
   - Mock JWKS teszt marad gyors PR-kapu. A valódi Authentik suite nem skipelhet
     csendben: a manuálisan indított release workflowban hiányzó provider,
     identitás vagy jelszó hard failure.

## Tesztek és kapuk

- Célzott unit teszt a deadline/backoff/settings utilra és minden korábbi
  relay/search lifecycle teszt zöld marad.
- Logger topology és redakciós teszt; production `src/**` alatt a központi
  modulon kívül nincs `pino()` konstrukció.
- `npm run verify` (benne coverage threshold) Node 24.20.0-n, healthy
  PostgreSQL/NATS/Meilisearch stackkel.
- OpenAPI drift nem lehet.
- Authentik blueprint ellenőrzés és discovery smoke az ágon; a teljes L2
  login/renew/reload/logout bizonyíték az integrált W5 kapuban fut.

## Evidence és átadás

- Evidence-ben audit-ID-nként: módosított fájl, megőrzött invariáns,
  futtatott parancs és pontos eredmény; T1-nél mind a négy coverage baseline
  és threshold.
- T2 állapotát ne jelöld teljesnek pusztán discovery alapján; az integrált
  böngészős kapuig „integrációs gate pending” maradjon.
- Egy review-zható commit vagy világosan indokolt kis commitsor; nincs merge,
  rebase vagy push.
- Átadás: branch, commit SHA, audit-ID-k, viselkedés, tesztek/coverage,
  nem futtatott kapuk, kockázat és scope-nyilatkozat.
