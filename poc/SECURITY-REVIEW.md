# Frontend security és adatminimalizálási review

2026-09-18 · FE-F5 / L1 production posture

## Ellenőrzött határok

- A kliens SPA marad; BFF nincs. A normál OIDC `User`, access token, ID token és
  refresh token kizárólag memóriában él. localStorage, sessionStorage, indexedDB
  és cookie nem tartalmaz tokent. A redirecthez szükséges egyszer használatos
  PKCE state/verifier a `sessionStorage`-ban maradhat, token mező nélkül.
- Authorization header csak a központi fetch boundaryban épül fel. A UI és a
  problem/evidence projection nem kapja meg.
- GET 401 után legfeljebb egy kontrollált session recovery történhet. Mutation
  401, timeout vagy elveszett válasz után nincs automatikus újraküldés. Renewal
  failure törli a Bearer tokent; logout törli a memória-usert és a privát
  Query cache-t.
- Bootstrap: memória-user, hiányában silent Authentik `prompt=none` a
  `/auth/silent-callback` route-on. `login_required` anonim, dependency hiba
  `identity_unavailable`; a login oldal nem indít redirect-loopot.
- A publikus content contract nem tartalmaz `mediaAssetId`, verziót, actor mezőt
  vagy admin timestampet; ezt component és full-stack E2E negatív assertion védi.
- Quarantine inspect locator/metaadatot ad, event payloadot nem. Replay/repair
  eredmény projection nem ad tartalom body-t, Meili kulcsot, NATS credentialt
  vagy teljes adatbázis URL-t.
- Phase 6 evidence explicit mező-allowlistből épül; secret-key és Bearer canary
  teszt fut.
- `returnTo` csak same-origin relatív route lehet; open redirect E2E tesztelt.
- Manuális token mező production/default buildben nincs; csak explicit helyi
  `VITE_ALLOW_MANUAL_TOKEN=true` mellett jelenik meg, és akkor is memóriában.
  Productionben a flag bekapcsolása build/config hiba.
- Minden `VITE_*` érték bundle-public. `VITE_BACKEND_ORIGIN` csak a Vite
  fejlesztői proxy célja.

## Threat model (L1)

A memória-only tárolás megszünteti a tartós tokenlopást (XSS után a session
reloadra eltűnik, és nincs Web Storage másolat). Aktív XSS ellen ez önmagában
nem véd: a futó oldal memóriájában lévő tokent a támadó script ugyanúgy
olvashatja. Ezt a production Nginx CSP (nincs `unsafe-eval`, nincs korlátlan
script-src; `connect-src`/`frame-src` same-origin + explicit OIDC origin;
`frame-ancestors 'none'`) és a dependency hygiene (production audit, lockfile)
szűkíti. A CSP nem helyettesít sanitizationt; a UI nem renderel tokent.

A valódi silent-recovery/renew Playwright kapu a BE-F5 Authentik redirect
bővítés után az integrációs gate-en fut. Ezen az ágon unit/component/build
bizonyíték van, a böngészős token-életciklus `E2E_AUTHENTIK_SILENT_REDIRECT=true`
mögött pending.

## Deployment-határ

A production frontend image Nginx adja a CSP-t, HSTS-t, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy` és COOP/CORP headereket. A Vite
fejlesztői szerver nem tekintendő production hostingnak. A `connect-src` és a
silent iframe `frame-src` a buildben konfigurált OIDC origint kapja.

## Dependency triage

2026-09-17-én a frontend és backend production-only auditja egyaránt **0
vulnerability** eredményű. A teljes, fejlesztői dependency fa két ismert
eszközlánc-találatot ad:

- frontend: 1 low, `@babel/core` source-map alapú tetszőleges fájlolvasás; csak a
  helyi/CI buildben fut, a production bundle függősége nem;
- backend: 4 moderate, a pinelt `drizzle-kit` tranzitív, régi `esbuild`
  dev-server ága. A backend nem indít esbuild dev servert; az audit által ajánlott
  `--force` javítás a Drizzle Kitet visszaléptetné `0.18.1`-re, ezért elutasítva.

High/critical találat release blocker. A két dev-only figyelmeztetés célzott
upstream frissítésig nyilvántartott, nem futásidejű release blocker; vak
`npm audit fix --force` vagy breaking visszalépés nem része a kapunak.

## Ismert külső korlátok

- Offline JWT validation mellett a token visszavonása nem azonnali.
- A PoC helyi stack nem bizonyít production failure domaint vagy HA-t.
- Az Authentik silent redirect allowlist a Codex BE-F5 ág feladata; nélküle a
  reload utáni `prompt=none` full-stack bizonyíték pending.
