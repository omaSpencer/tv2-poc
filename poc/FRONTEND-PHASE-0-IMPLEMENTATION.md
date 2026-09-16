# Frontend Fázis 0 – Stabilizálás és szerződéshelyreállítás

2026-09-16 · Végrehajtható implementációs specifikáció.

Kapcsolódó roadmap: [FRONTEND-IMPLEMENTATION-PLAN.md](FRONTEND-IMPLEMENTATION-PLAN.md).

## 1. Cél

A frontend a backend jelenlegi M0–M5 HTTP-szerződését pontosan használja, a
fordítás és a CI észlelje a későbbi contract driftet, és a demo ne jelezzen
hamis sikert vagy már elkészült milestone-ra vonatkozó „hamarosan” állapotot.

Ez a fázis nem alakítja át a playgroundot végleges termékfelületté. Nem tartalmaz
PKCE-logint, új admin endpointot, tartalomlistát, új operations képernyőt vagy
M5 mutációt.

## 2. Rögzített döntések

| Téma | Döntés |
| --- | --- |
| Node | Frontend és backend egyaránt Node `>=24.20.0 <25` |
| OpenAPI snapshot | `poc/contracts/backend.openapi.json` |
| Snapshot gazdája | Backend generálja ugyanazzal a `createOpenApiDocument` függvénnyel, mint a `/docs-json` route |
| Generált frontend típus | `frontend/src/api/generated/backend.ts` |
| Generátor | `openapi-typescript`, dev dependencyként, lockfile-ban |
| Frontend TypeScript | `~5.9.3`, mert az aktuális `openapi-typescript` peer szerződése `^5.x`; a backend ettől marad TypeScript 6-on |
| Build függőség | A normál frontend build a commitolt generált fájlt használja, nem indít backendet |
| Drift gate | `npm run contracts:check`: újragenerál és `git diff --exit-code` a snapshotra és a generált típusra |
| Kézi típusok | Csak frontend-specifikus helper/union maradhat; backend response/request shape generált alias |
| Search total | `estimatedTotalHits`; az oldal tényleges darabszáma `returned` |
| Processing age | Backend ms-ban adja: `oldestAgeMs`, `oldestUnfinishedAgeMs` |
| Milestone gate | Csak tényleges `dependency_unavailable`, `search_unavailable` vagy kikapcsolt feature válasz után jelenik meg; nem statikus tartalomként |
| Demo negatív eset | Csak a pontos HTTP status + `problem.code` (+ ahol releváns `fields`) számít sikernek |

## 3. Feladatok implementációs sorrendben

### P0-01 — Runtime pin

Érintett fájlok:

- `frontend/.nvmrc` — új, `24.20.0`;
- `frontend/package.json` — `engines.node`;
- `frontend/README.md` — előfeltétel és ellenőrzés.

Elfogadás:

- Node 24.20 alatt `npm ci`, build és lint fut;
- rossz major verzióra az npm legalább engine warningot ad.

### P0-02 — Backend OpenAPI snapshot emitter

Érintett fájlok:

- `backend/scripts/emit-openapi.mjs` — új;
- `backend/package.json` — `openapi:emit` script;
- `contracts/backend.openapi.json` — generált snapshot.

Szabályok:

- a script a lefordított `AppModule` és `createOpenApiDocument` kódot használja;
- identity/outbox/search/media feature off mellett generál, hálózati kapcsolat nélkül;
- dummy, szintaktikailag érvényes DB URL használható, de query nem futhat;
- a JSON stabilan formázott, rendezett top-level route sorrend nem követelmény;
- a Nest alkalmazás mindig lezáródik `finally` ágban.

### P0-03 — Frontend type generation

Érintett fájlok:

- `frontend/package.json`, `package-lock.json` — `openapi-typescript`;
- `frontend/src/api/generated/backend.ts` — generált típus;
- frontend scriptek:
  - `contracts:generate`;
  - `contracts:check`;
  - opcionális `verify` = contracts check + build + lint.

A generált fájlt nem szerkesztjük kézzel.

### P0-04 — API type aliasok

Érintett fájl: `frontend/src/api/types.ts`.

Generált alias legyen legalább:

- `ProblemDocument`;
- `HealthBody`;
- `AdminContentView`;
- `PublicContentView`;
- `MeResponse`;
- `CreateContentBody`;
- `PatchContentBody`;
- `VersionedBody`;
- `SearchResponse`;
- `ProcessingStatus`.

Frontend helperként maradhat:

- `ApiProblemError`;
- `isApiProblemError`;
- `hasPermission`;
- kényelmi `ContentCategory`, `ContentStatus`, `AppRole`, `AppPermission` alias.

### P0-05 — Search contract és UI

Érintett fájlok:

- `frontend/src/api/search.ts`;
- `frontend/src/pages/SearchPage.tsx`.

Változások:

- API wrapper fogad `category`, `limit`, `offset` paramétert;
- a page jelenleg még csak egyszerű vezérlést kap, de a válasz már a valós
  `returned` és `estimatedTotalHits` mezőket használja;
- a rövid oldal jelzése: `returned < min(limit, estimatedTotalHits - offset)`,
  negatív alsó korlát nélkül;
- megszűnik a nem létező `source` és `truncatedByDbFilter` mező.

### P0-06 — Processing contract korrekció

Érintett fájlok:

- `frontend/src/api/types.ts`;
- `frontend/src/pages/ProcessingPage.tsx`.

Változások:

- `oldestAgeSeconds` helyett `oldestAgeMs`;
- a jelenlegi oldalon legalább relay, broker, consumer, quarantine és A/B index
  rövid összefoglaló megjelenik;
- a teljes vizuális operations dashboard továbbra is Fázis 4;
- időértékek kliensoldali másodpercre formázása csak prezentáció.

### P0-07 — Dinamikus milestone állapot

Érintett fájlok:

- `AuthPage.tsx` — PKCE gate maradhat, mert ténylegesen nincs bekötve;
- `EditorialPage.tsx` — csak tokenhiány vagy identity dependency esetén;
- `SearchPage.tsx` — statikus M4 gate törlése;
- `ProcessingPage.tsx` — statikus M3 gate törlése;
- `HomePage.tsx`, `FRONTEND.md` — aktuális backend státusz.

### P0-08 — Exact demo assertionök

Érintett fájl: `frontend/src/pages/DemoPage.tsx`.

Közös helper:

```ts
expectProblem(error, {
  status: 409,
  code: 'version_conflict',
  fields?: [...]
})
```

Kötelező esetek:

- katalógus withdraw után: 404 `content_not_found`;
- hiányos publish: 422 `validation_failed`, `mediaAssetId` a fieldsben;
- stale patch: 409 `version_conflict`;
- más hiba logban `ok: false`.

### P0-09 — Lint warningok

- context hookok és provider komponensek külön fájlba kerülnek, hogy a Fast
  Refresh szabály teljesüljön;
- `ContentIdBar` draft szinkronizálása effect nélküli vagy kulcsolt megoldás;
- `EditorialPage` form feltöltése query success eseményből/explicit resetből,
  nem szinkron `setState` effectből.

### P0-10 — Dokumentáció és ellenőrzés

Frissítendő:

- `FRONTEND.md`;
- `frontend/README.md`;
- ahol a gyökér README M5 státusza tényszerűen eltér a backend README/evidence
  állapotától, rövid státuszkorrekció.

Futtatandó:

```bash
cd poc/backend
npm run openapi:emit

cd ../frontend
npm run contracts:generate
npm run contracts:check
npm run build
npm run lint
```

## 4. Fájlszintű végállapot

```text
poc/
  contracts/
    backend.openapi.json
  backend/
    scripts/emit-openapi.mjs
  frontend/
    .nvmrc
    src/api/generated/backend.ts
```

## 5. Tesztesetek

1. Search 200: `returned=1`, `estimatedTotalHits=2` → rövid oldal jelzés.
2. Search 200 nulla találattal → nem fallback hiba.
3. Search 422 `fields=['category']` → pontos problem panel.
4. Processing teljes response → nincs `undefined`-ből származó hibás szám.
5. Processing relay off → `off`, nem „down”.
6. Processing index A retrying, B idle → degraded/fallback összefoglaló.
7. Demo várt 404 helyett hálózati hiba → failed.
8. Demo várt 422 helyett 401 → failed.
9. OpenAPI schema változás → `contracts:check` failed, amíg a generált fájl nincs frissítve.
10. Normál build nem próbál hálózatot vagy futó backendet elérni.

## 6. Definition of Done

- [x] Node runtime pin egységes.
- [x] A backend egyetlen paranccsal determinisztikus OpenAPI snapshotot ír.
- [x] A frontend egyetlen paranccsal generál típust a snapshotból.
- [x] Contract drift ellenőrzés létezik.
- [x] Search és processing a tényleges backend mezőket használja.
- [x] Statikus, elavult M3/M4 gate nincs.
- [x] A demo negatív esetei exact assertiont használnak.
- [x] Frontend build sikeres.
- [x] Frontend lint warning nélkül sikeres.
- [x] A dokumentáció a jelenlegi M0–M5 implementációt és a pending evidence/Auth L2 határt pontosan írja le.

## 7. Megvalósítási eredmény

2026-09-16:

- `npm run openapi:check` — pass;
- `npm run contracts:check` — pass;
- `npm run verify` — pass az ideiglenes, pontos Node 24.20.0 runtime-mal;
- backend `npm run lint` — 0 warning, 0 error;
- frontend `npm run lint` — 0 warning;
- Search és Processing képernyő vizuálisan ellenőrizve helyi Vite builddel;
- a backend nem futott a vizuális ellenőrzés alatt, ezért a live API-adatok teljes
  képernyős ellenőrzése a későbbi full-stack E2E kapu része.
