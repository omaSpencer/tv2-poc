# Frontend release quality matrix

2026-09-17 · Release C / Phase 7

Minden kötelező állapothoz tartozik felhasználói megjelenítés és automatizált
ellenőrzés. A táblázatban nincs ismeretlen vagy gazdátlan sor.

| Állapot | Kritikus UI | Automatizált bizonyíték | Státusz |
| --- | --- | --- | --- |
| Initial loading | route Suspense, content/detail, audit, operations preflight | `ContentListPage.test.tsx`, `CatalogDetailPage.test.tsx`, Playwright axe | kész |
| Background refresh | operations snapshot és catalog visibility polling | `OperationsPage.test.tsx`, `useCatalogVisibilityPolling.test.tsx` | kész |
| Empty | content lista, catalog, consumer és quarantine lista | `ContentListPage.test.tsx`, `CatalogSearchPage.test.tsx`, `OperationsPage.test.tsx`, `Phase5Pages.test.tsx` | kész |
| Partial/optional missing | consumers/quarantine/indexek külön „nem elérhető” állapota | `OperationsPage.test.tsx`, `ServiceCards.test.tsx` | kész |
| 400 | malformed JSON/API contract, UI biztonságos általános problem panel | backend `http.test.ts`, `ProblemPanel.test.tsx` | kész |
| 401 | egyszeri GET auth recovery; mutation nincs újraküldve | `client.test.ts`, `AuthProvider.test.tsx`, `auth-role-guard.spec.ts` | kész |
| 403 | permission magyarázat, session megmarad | `RequirePermission.test.tsx`, `OperationsPage.test.tsx`, `auth-role-guard.spec.ts` | kész |
| 404 | publikus domain not-found és withdrawn eltűnés | `CatalogDetailPage.test.tsx`, `content-lifecycle.spec.ts`, Phase 6 S01 | kész |
| 409 | state/slug/version/idempotency konfliktus | `ContentEditPage.test.tsx`, `version-conflict.spec.ts`, `operator-actions.spec.ts` | kész |
| 413 | túl nagy request külön problemként | `ProblemPanel.test.tsx`, Phase 6 S02 registry/integráció | kész |
| 422 | mezőlista és canonical URL/form recovery | `CatalogSearchPage.test.tsx`, `ProblemPanel.test.tsx`, Phase 6 S02 | kész |
| 503 | search/dependency külön retry állapot | `CatalogSearchPage.test.tsx`, `OperationsPage.test.tsx`, S04 full-stack | kész |
| Network/timeout | kapcsolati hiba; mutation retry kikapcsolva | `msw.integration.test.ts`, `CatalogSearchPage.test.tsx`, `queryClient.ts` | kész |
| Stale data | utolsó snapshot, frissítési idő és stale figyelmeztetés | `OperationsPage.test.tsx` | kész |
| Lost response | aktív action visszaállítás vagy scenario `inconclusive`; nincs auto-resubmit | `persistence.test.ts`, `backend-restart.spec.ts`, Phase 5 action E2E | kész |

## Request- és polling invariánsok

- Query retry legfeljebb egyszer, 4xx esetben nulla; mutation retry mindig `false`.
- Operations polling rejtett tabon leáll, visszatéréskor egyszer frissít.
- Folyamatban lévő polling kérésre nem halmozódik új kérés.
- Scenario polling csak read-only műveletnél bounded; mutation nem ismétlődik.
- Catalog projection polling rejtett tabon `paused`, és nem módosítja visszamenőleg
  a sikeres lifecycle mutation eredményét.

