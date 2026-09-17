# Backend capability → frontend coverage

2026-09-17 · Owner és automatizált bizonyíték minden publikus capabilityhez.

| Capability | Lefedés | UI / runbook | Owner | Bizonyíték |
| --- | --- | --- | --- | --- |
| `GET /health/live`, `/health/ready` | UI | globális StatusBar | platform | frontend verify + E2E global setup |
| `GET /me` | UI | AuthProvider, Profil, route guard | identity | `AuthProvider.test.tsx`, `auth-role-guard.spec.ts` |
| `GET /admin/contents` | UI | cursoros Tartalmak lista | editorial | `ContentListPage.test.tsx`, lifecycle E2E |
| `POST /admin/contents` | UI | Tartalom létrehozása | editorial | `ContentCreatePage.test.tsx`, lifecycle E2E |
| `GET /admin/contents/{id}` | UI | szerkesztői részlet | editorial | `ContentDetailPage.test.tsx`, lifecycle E2E |
| `PATCH /admin/contents/{id}` | UI | dirty-field editor + conflict dialog | editorial | `ContentEditPage.test.tsx`, conflict E2E |
| publish / withdraw | UI | lifecycle actionök + confirm dialog | editorial | lifecycle E2E, Phase 6 S01 |
| content audit | UI | lapozott audit timeline | editorial | `AuditTimeline.test.tsx`, lifecycle E2E |
| public content detail | UI | `/catalog/{id}` | catalog | `CatalogDetailPage.test.tsx`, catalog E2E |
| public search | UI | bookmarkolható kereső és fallback | catalog | `CatalogSearchPage.test.tsx`, search/outage E2E |
| processing status | UI | Operations dashboard | operations | `OperationsPage.test.tsx`, search/outage E2E |
| reindex preflight/start/progress | UI | Operations / Reindex | operations | `Phase5Pages.test.tsx`, operator E2E |
| quarantine list/inspect/replay | UI | Operations / Karantén | operations | `Phase5Pages.test.tsx`, operator E2E |
| repair | UI | Operations / Repair | operations | `Phase5Pages.test.tsx`, operator E2E |
| generic operator action read | UI | közös progress panel és reload recovery | operations | `useOperatorAction`, operator/restart E2E |
| S01–S05 bizonyítható demo | guided runbook | `/demo`, safe evidence export | release | Phase 6 unit/integration/full-stack |
| DB migráció/reset | intentionally CLI-only | backend README, `db:migrate`, `db:reset` | platform | `schema.test.ts`, CI backend gate |
| M0/full smoke | intentionally CLI-only | `smoke:m0`, `smoke:full` | platform | backend scripts és README |
| NATS/Meili fault injection | intentionally CLI-only | E2E/runbook checkpoint; UI csak megfigyel | operations | S04 és search outage E2E |
| M5 1000+100 baseline | intentionally CLI-only | `baseline:m5` | performance | M5 README/runbook; release-en kívüli kapacitásmérés |
| Ant Media / DRM / playback authorize | not implemented backend | második kör, nincs félrevezető UI | media | README rögzített PoC-határ |

Az OpenAPI snapshot 21 route-jának mindegyike szerepel a fenti összevont sorok
egyikében. Új route csak e mátrix és a contract snapshot egyidejű frissítésével
kerülhet release-be.

