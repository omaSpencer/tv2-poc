# Frontend security és adatminimalizálási review

2026-09-17 · Release C / Phase 7

## Ellenőrzött határok

- Az access/refresh/ID token kizárólag az `oidc-client-ts` session storage
  rekordjában és az API kliens memóriájában él; React state-be, DOM-ba, query
  key-be, exportba és application logba nem kerül.
- Authorization header csak a központi fetch boundaryban épül fel. A UI és a
  problem/evidence projection nem kapja meg.
- GET 401 után legfeljebb egy kontrollált session recovery történhet. Mutation
  401, timeout vagy elveszett válasz után nincs automatikus újraküldés.
- A publikus content contract nem tartalmaz `mediaAssetId`, verziót, actor mezőt
  vagy admin timestampet; ezt component és full-stack E2E negatív assertion védi.
- Quarantine inspect locator/metaadatot ad, event payloadot nem. Replay/repair
  eredmény projection nem ad tartalom body-t, Meili kulcsot, NATS credentialt
  vagy teljes adatbázis URL-t.
- Phase 6 evidence explicit mező-allowlistből épül; secret-key és Bearer canary
  teszt fut.
- `returnTo` csak same-origin relatív route lehet; open redirect E2E tesztelt.
- Manuális token mező production/default buildben nincs; csak explicit helyi
  `VITE_ALLOW_MANUAL_TOKEN=true` mellett jelenik meg.

## Deployment-határ

CSP, HSTS, frame-ancestor és egyéb edge header a hosting/reverse proxy gazdája.
A Vite fejlesztői szerver nem tekintendő production hostingnak. Javasolt minimum:
`default-src 'self'`, explicit `connect-src` a backend/IdP originre,
`frame-ancestors 'none'`, `object-src 'none'`, HTTPS/HSTS és szigorú Referrer-Policy.

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
- A refresh, signing-key rotation és IdP-kiesés kibővített L2 mélymérései külön
  hardening scope; a release auth/login/role guard L2 kapuja ettől függetlenül zöld.
- A PoC helyi stack nem bizonyít production failure domaint vagy HA-t.
