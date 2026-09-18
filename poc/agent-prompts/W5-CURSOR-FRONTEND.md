# W5 Cursor feladatlap – FE-F5 production security és minőségkapu

Te vagy a Wave 5 frontend implementáló agentje. A kijelölt worktree és branch:

- worktree: `/private/tmp/tv2-poc-fe-f5`
- branch: `codex/final-fe-f5`
- baseline: a W4 integrációs kapuját lezáró tiszta `main`, commit `8dfcfd8`;
  ne merge-elj és ne rebase-elj

## Kizárólagos scope

Zárd le a `poc/FINAL-FRONTEND-MILESTONE.md` FE-F5 fázisát: **L1, L14,
I3, I4**. Módosítható a frontend production forrás, frontend teszt/E2E,
frontend Docker/Nginx/config, frontend package/coverage/runtime konfiguráció,
`poc/frontend/README.md`, `poc/FRONTEND-IDENTITY-AND-API-DECISIONS.md`,
`poc/SECURITY-REVIEW.md`, `poc/FINAL-FRONTEND-EVIDENCE.md`, valamint kizárólag
az FE-F5 checklist a `poc/FINAL-FRONTEND-MILESTONE.md` fájlban. A két közös
security/identity dokumentumnak ebben a hullámban Cursor az egyetlen írója.

Backend forrás, Authentik blueprint, backend Compose, OpenAPI snapshot,
generated contract, a közös `.github/workflows/release-gates.yml`, koordinációs
dokumentum és milestone-összesítés nem módosítható. Ha a frontendhez
szükséges backend/Authentik szerződés hiányzik, dokumentáld blokkereként;
ne írj kereszt-scope fájlt.

## Rögzített production auth döntés

W5-ben a kliens **SPA marad; nem épül BFF**. A választott, dokumentálandó
biztonsági modell:

- normál OIDC `User`, access token, ID token és refresh token kizárólag
  memóriában élhet;
- localStorage/sessionStorage/indexedDB/cookie nem tartalmazhat tokent;
- a redirecthez szükséges egyszer használatos PKCE state/verifier maradhat
  sessionStorage-ban, de a teszt bizonyítsa, hogy nem tartalmaz tokent;
- a manual-token escape hatch kizárólag explicit nem-production fejlesztési
  profilban maradhat; productionben a bekapcsolási kísérlet build/config hiba;
- azonos oldalon a memóriában lévő refresh tokennel működik az automatikus
  renewal; teljes reload után a memóriában elveszett sessiont valódi
  Authentik `prompt=none` silent flow állítja helyre a
  `/auth/silent-callback` route-on;
- az Authentik strict redirectet a Codex BE-F5 ág adja. Az ágon unit/
  component teszttel dolgozz; a valódi full-stack gate integráció után fut.

A frontend production Docker build publikus argumentum-szerződése:
`VITE_API_BASE`, `VITE_OIDC_ISSUER_URL`, `VITE_OIDC_CLIENT_ID`,
`VITE_OIDC_REDIRECT_URI`, `VITE_OIDC_POST_LOGOUT_REDIRECT_URI`,
`VITE_OIDC_SILENT_REDIRECT_URI` és `VITE_ALLOW_MANUAL_TOKEN`. A Codex backend
ág ezeket a neveket köti be a production Compose overlayben; ne nevezd át őket.
Minden `VITE_*` érték publikus, egyik sem hordozhat credentialt.

## Kötelező megoldási szerződés

1. **L1 – memória-only OIDC és XSS/CSP védelem**
   - Az `oidc-client-ts` `userStore` ne legyen `window.sessionStorage`; külön,
     tesztelhető memória-state store-t használjon. A tranzakciós `stateStore`
     maradjon külön és csak a redirect befejezéséig éljen.
   - Bootstrapkor előbb a memória-user próbálható; hiányában konfigurált
     silent callbackkel kísérelje meg az IdP session helyreállítását. A
     bejelentkezési oldalon ne keletkezzen redirect-loop, a `login_required`
     anonim eredmény legyen, a dependency hiba pedig maradjon
     `identity_unavailable`.
   - 401 recovery single-flight maradjon; csak idempotens GET ismételhető
     automatikusan. Renewal failure ne tartson stale Bearer tokent, logout
     törölje a memória-user state-et és az alkalmazás privát cache-ét.
   - Unit/component teszt fedje login, callback, refresh, reload-silent recovery,
     401, logout, párhuzamos recovery és redirect-loop megelőzés ágait. Storage
     sentinel teszt vizsgálja, hogy token alakú érték egyik browser storage-ba
     sem kerül.
   - A jelenlegi E2E `accessTokenFromSession` segéd megszűnik. Ha fixture-seedeléshez
     Bearer token kell, a `loginAs` helper a belépés során megfigyelt, valódi
     Authorization requestből adhatja vissza azt kizárólag a tesztfolyamat
     memóriájában; storage, DOM, log vagy artifact nem tartalmazhatja.
   - Production Nginx/image adjon tesztelt CSP és alap security headereket. A
     CSP ne engedjen `unsafe-eval`-t vagy korlátlan script forrást; `connect-src`
     és a silent iframe `frame-src` csak same-origin és a buildben explicit
     konfigurált OIDC origin lehessen, `frame-ancestors 'none'` mellett.
     A threat model rögzítse, hogy a memória-only tárolás csökkenti a tartós
     tokenlopást, de aktív XSS ellen a CSP és a dependency hygiene véd.
2. **L14 – backend origin és same-origin docs policy**
   - Dokumentáld egyértelműen: minden `VITE_*` érték bundle-public, titok nem
     lehet benne. A `VITE_BACKEND_ORIGIN` kizárólag a Vite fejlesztői proxy
     célja, nem production browser secret vagy runtime backend-cím.
   - Productionben a rögzített same-origin ingress miatt az API és a docs link
     relatív `/api` alapot használjon. Hiányzó
     `VITE_BACKEND_ORIGIN` ne képezzen `127.0.0.1:3000` production linket;
     explicit hibás URL fail-fast legyen.
   - Unit/build/image smoke fedje a dev proxy defaultot, explicit dev origint,
     production same-origin docs URL-t és a localhost-fallback hiányát a
     production bundle-ben.
3. **I3 – Node/npm runtime pin kikényszerítése**
   - A frontend package pontosan a repo `.nvmrc` szerinti Node **24.20.0** és a
     bizonyított npm **11.19.0** toolchaint deklarálja (`engines`,
     `packageManager`/`devEngines` ahol támogatott).
   - Frontend `.npmrc` `engine-strict=true`; legyen gyors, titokmentes
     `runtime:check`, amely támogatott környezetben passzol és injektált eltérő
     verzióval determinisztikusan hibázik. Ne támaszkodj csak dokumentációra.
   - A közös workflow-t ne módosítsd; a koordinátor integrációkor teszi a
     runtime és coverage parancsokat a release gate-be.
4. **I4 – frontend coverage és stabilitási gate**
   - A Vitest 5.0.1-hez pontosan illeszkedő `@vitest/coverage-v8`, commitolt
     konfiguráció és `test:coverage` script készüljön. A `verify` ugyanazt a
     suite-ot egyszer, coverage-del futtassa; ne fusson előbb külön `npm test`.
     A mérés a production
     `src/**` kódot célozza; generated contract, puszta típusdeklaráció vagy
     bootstrap entry csak konkrét indokkal zárható ki.
   - Mérd meg a jelenlegi lines/functions/branches/statements baseline-t, majd
     commitolj lefelé kerekített, kis stabilitási tartalékú globális thresholdot.
     Ne auto-update-eld a thresholdot, és ne írj értéktelen tesztet pusztán a
     szám növelésére.
   - Az alap worker-pool maradjon, hacsak a `vmThreads` legalább 10 egymás utáni
     teljes futásban nem bizonyított gyorsabbnak és ugyanolyan stabilnak.
     Pool-váltás nem feltétele I4 lezárásának.

## Valódi böngészős auth evidence

Bővítsd a full-stack Playwright suite-ot egy release-only, valódi Authentik
token-lifecycle esettel. A teszt:

- belép publisherként, a `/me` jogosultságot ellenőrzi;
- bizonyítja, hogy localStorage/sessionStorage nem tartalmaz access/id/refresh
  tokent vagy serializált OIDC `User` objektumot;
- megvárja a valódi 5 perces access token automatikus megújulását, és titok
  kiírása nélkül igazolja, hogy új Bearer tokennel a `/me` továbbra is 200;
- teljes oldal-újratöltés után a silent Authentik sessionnel visszaáll, majd
  logout után anonim marad és a privát route visszakér belépést;
- saját timeoutja illeszkedik a valódi tokenélettartamhoz; nincs time travel,
  tokeninjektálás, mock JWKS vagy manual-token escape hatch.

Az ágon ez a teszt az Authentik redirect bővítés hiányában lehet dokumentáltan
integráció-pending. Unit/component/build/coverage kapu viszont teljesen fusson.

## Tesztek és kapuk

- `npm run runtime:check`, `npm run verify` (benne coverage threshold) és
  `npm run e2e:typecheck` Node 24.20.0 / npm 11.19.0 alatt.
- Célzott auth/config/CSP/storage tesztek; production image smoke a headerre,
  same-origin docs linkre és a bundle titok-/localhost-mentességére.
- A teljes Playwright auth lifecycle az integrált W5 kapuban, valódi
  PostgreSQL/NATS/Meilisearch/Authentik/backend mellett fut.
- Contract drift nem lehet; backend/OpenAPI fájl nem változhat.

## Evidence és átadás

- Evidence-ben ID-nként: threat-model döntés, módosított fájl,
  teszt/parancs, pontos eredmény; I4-nél mind a négy baseline és threshold.
- L1-et ne jelöld teljesnek a valódi silent-recovery/renew Playwright gate
  nélkül; add át „integrációs gate pending” állapotban, ha az ágon a backend
  blueprint még nem érhető el.
- Egy review-zható commit vagy világosan indokolt kis commitsor; nincs merge,
  rebase vagy push.
- Átadás: branch, commit SHA, audit-ID-k, viselkedés, tesztek/coverage,
  nem futtatott kapuk, kockázat és scope-nyilatkozat.
