# Phase 7 – Minőségkapu és átadási evidence

2026-09-17 · Release C

## Eredmény

A közös release gate Node **24.20.0** runtime-mal, valódi PostgreSQL/NATS/
Meilisearch A/B/Authentik stackkel és három Playwright browser engine-nel futott.
A production dependency fákban nincs ismert sérülékenység; a két dev-only
eszközlánc-találat triage-ja a security review része.

## Automatizált kapuk

| Kapu | Eredmény |
| --- | --- |
| Frontend contract + build + compiler + lint + Vitest/RTL/MSW | **31 fájl / 139 teszt zöld** |
| Production bundle | **685 462 B JS**, **19 358 B CSS**, legnagyobb JS chunk **337 029 B** |
| Bundle budget | JS 800 KiB, CSS 64 KiB – **zöld** |
| Backend build/lint/OpenAPI | **zöld**, lint 0 warning / 0 error |
| Backend teljes integrációs kapu | **21 fájl / 232 teszt zöld** |
| Phase 7 browser suite | **17/17 zöld**: axe, keyboard/fókusz, 360/768/1280, Chromium/Firefox/WebKit |
| Fresh checkout | új temp könyvtár, env és korábbi `node_modules` nélkül: `npm ci` + **139/139** |
| Frontend production audit | **0 vulnerability** |
| Backend production audit | **0 vulnerability** |

Az accessibility futás minden kritikus route-on nulla serious/critical axe
találatot követel. A futás közben talált 4,08:1 semleges státuszcímke-kontraszt
4,5:1 fölé javult. A skip link, dialog első fókusz/focus trap/Escape/restore,
landmarkok, programozott nevek és live regionök automatikus keyboard és
screen-reader szemantikai smoke-ban szerepelnek. A macOS WebKit rendszer-
beállításból nem tabulál linkre; ott a fókuszált skip-link Enter-viselkedése,
Firefoxon és Chromiumon a tényleges Tab-sorrend fut.

A backend gate közben két korábban környezetfüggő tesztprobléma vált láthatóvá
és javult: az AppModule csak a teszthám saját envjének beállítása után töltődik
be, a tartós reindex A/B vezérlősorokat pedig minden integrációs eset
`ready/running` alapállapotba állítja. A végső, frissen migrált futás 232/232.

## Szállított release-artifactok

- PR/push fast frontend és backend gate, valamint kézzel indítható teljes-stack
  GitHub Actions job: `.github/workflows/release-gates.yml`;
- MSW typed fixture/server/handler infrastruktúra, exact problem- és network
  tesztek;
- axe, responsive és cross-browser Playwright projektek;
- route-szintű code splitting és mért bundle budget;
- [állapotmátrix](FRONTEND-QUALITY-MATRIX.md),
  [security review](SECURITY-REVIEW.md),
  [capability-mátrix](BACKEND-CAPABILITY-MATRIX.md) és
  [fresh-checkout runbook](FRESH-CHECKOUT-RUNBOOK.md).

## Ismert, release-en kívüli hardening

- access-token refresh, signing-key rotation és teljes IdP-kiesés hosszú L2
  mérése;
- M5 1000+100 kapacitásbaseline és production hosting headerek;
- M6 media/DRM/playback authorization.

Ezek nem ismeretlen capabilityk: a mátrixban és a security review-ban explicit
scope-határral szerepelnek.
