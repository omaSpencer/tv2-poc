# Release B futtatási jegyzőkönyv

2026-09-17 · Használható szerkesztői workspace, valódi Authentik és full-stack
böngészős bizonyítással.

Runbook: [frontend/e2e/README.md](frontend/e2e/README.md).

## Scope

- cursoros admin tartalomlista stabil rendezéssel és URL-szűrőkkel;
- cursoros, newest-first audit timeline minimalizált adattal;
- editor create/edit és publisher teljes v1 → v6 lifecycle UUID másolása nélkül;
- published read-only, no-op mentés és publish-readiness;
- két browser context stale-version konfliktusa kézi, adatvesztésmentes reapply ággal;
- 360 px-es szerkesztői kártyanézet.

## Környezet

| Elem | Érték |
| --- | --- |
| Node | 24.20.0 |
| Playwright | 1.63.0, Chromium |
| Viewport | 1280×800 és 360×800 |
| Backend | NestJS, `ENV_FILE=.env.e2e`, identity/outbox/search bekapcsolva |
| Infrastruktúra | PostgreSQL 17, NATS JetStream, Meilisearch A/B, Authentik 2025.8 |
| Identitások | `poc-editor`, `poc-publisher` valódi Authorization Code + PKCE flow-val |

## Futtatott kapuk

```bash
cd poc/frontend
npm run verify
npm run e2e -- e2e/specs/content-lifecycle.spec.ts e2e/specs/version-conflict.spec.ts
npm run e2e -- e2e/specs/responsive.spec.ts --grep "tartalomlista"

cd ../backend
npm run openapi:check
npm run lint
# ENV_FILE=/dev/null és explicit, _test végű TEST_DATABASE_URL mellett:
npm exec vitest run \
  test/admin-content-read-contract.test.ts \
  test/integration/schema.test.ts test/integration/lifecycle.test.ts \
  test/integration/concurrency.test.ts test/integration/rollback.test.ts \
  test/integration/http.test.ts test/integration/contracts.test.ts \
  test/integration/admin-content-read.test.ts
```

## Eredmény

| Kapu | Eredmény |
| --- | --- |
| Frontend fast gate | **zöld** – 21 fájl, 112/112 teszt; contract, build, React Compiler és lint rendben |
| Backend Release B kapu | **zöld** – 8 fájl, 67/67 contract/integrációs teszt az elkülönített PostgreSQL adatbázison |
| Backend OpenAPI + lint | **zöld** – nincs contract drift, 0 warning/error |
| Kritikus desktop E2E | **zöld** – publisher lifecycle, editor permissionmátrix, hiányos draft és kétcontextes conflict |
| Szerkesztői mobil smoke | **zöld** – 360 px-en kártyanézet, táblázat rejtve, nincs vízszintes túlcsordulás |

A végső helperverzióval mind az öt kijelölt Release B eset sikeresen lefutott.
Három eset egy közös futásban volt zöld; a közben fellépő valós Docker/PostgreSQL
és Meilisearch 503 miatt megszakadt két lifecycle eset stabil infrastruktúráról
külön újrafutott és **2/2 passed** eredménnyel zárt. A hibaképernyők helyesen
`dependency_unavailable`, illetve `search_unavailable` állapotot mutattak; egyik
hiba sem funkcionális assertionből vagy adatsérülésből származott.

## A futás során javított hiba

Az Authentik web component loading overlaye ritkán elfogta a submit gomb pointer
eseményét, illetve a már megérkezett SPA callbacket az IdP-form ciklusa tovább
várta. A login helper most a fókuszált mező saját formját billentyűzettel küldi
el, kontrollált gombos fallbacket használ, megvárja az overlay/stage váltását,
és a `/auth/callback` átadásakor külön a SPA session bootstrapjára vált.

## Release-döntés

**Release B: KÉSZ (2026-09-17).** Az admin lista és audit backend/API/UI rétege,
a teljes szerkesztői flow, a jogosultsági mátrix, a konfliktusfeloldás és a
kritikus valódi Authentik/full-stack böngészős esetek bizonyítottak. A workspace
editor és publisher számára UUID másolása nélkül használható.

A teljes WCAG/böngésző/viewport mátrix, a CI job és az M5 operátori action E2E a
Release C minőségkapujában marad.
