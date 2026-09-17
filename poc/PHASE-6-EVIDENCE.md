# Frontend Phase 6 – futtatási jegyzőkönyv

2026-09-17 · Node 24.20.0 · valódi PostgreSQL, NATS JetStream, Meilisearch A/B,
Authentik és NestJS backend

## Eredmény

A Phase 6 kész. A korábbi imperatív demóoldalt verziózott, Zoddal futásidőben
validált, allowlist-alapú scenario runner váltotta fel. A runner nem fogad
felhasználói URL-t, headert, request body-t vagy parancsot; kizárólag a registryben
név szerint engedélyezett műveleteket hajtja végre.

Elkészült:

- S01 publisher életciklus új UUID-val, katalógus/search pollinggal és v1–v6 audittal;
- S02 egzakt 422/409/413 negatív szerződések;
- S03 viewer/editor/publisher mátrix és explicit auth fejléc nélküli 401 próba;
- S04 kézi A/B fault-injection checkpoint, fallback, teljes kiesés, CMS-write és recovery;
- S05 vezetett reindex, quarantine/replay és repair runbook a dedikált Operations UI-hoz;
- megszakítható motor, bounded read-only polling, safe session recovery;
- hozzáférhető timeline safe HTTP/problem/version/correlation metaadattal;
- explicit mező-allowlistes JSON és Markdown evidence export.

## Biztonsági állítások

- A teljes request/response body csak átmenetileg él az assertion határon; nem kerül
  state-be, sessionStorage-be vagy exportba.
- Token, auth header, subject, password, credential, API key és teljes DB URL nem
  része az evidence sémának. A secret-canary teszt tiltott kulcsot és Bearer mintát is ellenőriz.
- Futó mutation után történt reload nem indít automatikus újraküldést: a lépés
  `inconclusive`. Más subject fingerprintjével a futás szintén nem folytatódik automatikusan.
- A várttól eltérő status, problem code vagy fields lista FAIL; a 401/403/503 és
  hálózati hiba nem válhat más negatív próba hamis PASS eredményévé.
- A fault injection kizárólag kézi checkpoint; a böngésző nem indít shell- vagy
  Docker-parancsot.

## Automatizált kapuk

Frontend teljes kapu:

```text
npm run verify
build: PASS
React Compiler: PASS
lint: PASS
Vitest: 28 fájl, 127/127 PASS
```

E2E típuskapu:

```text
npm run e2e:typecheck
PASS
```

Az S01–S04 registry + engine + assertion + checkpoint integráció négy külön
tesztben PASS. A schema, exact assertion, false-positive regresszió, export
redakció, persistence/reload és manual checkpoint külön unit/komponenstesztet kapott.

## Valódi full-stack bizonyítás

Végleges kódon, valódi Authentik Authorization Code + PKCE belépéssel:

```text
E2E_DOCKER_CONTROL=true npm run e2e -- demo-scenarios.spec.ts
2 passed / 0 failed / 0 skipped (1.0 min)
```

- S01: 14/14 timeline-lépés PASS; draft → edit → publish → catalog/search →
  withdraw → eltűnés → edit → republish → audit; a letöltött JSON exportban nincs
  token-, header-, subject- vagy Bearer-minta.
- S04: az A index tényleges leállítása után B fallback, mindkét index leállítása
  után egzakt `503 search_unavailable`, közben sikeres CMS draft írás, majd mindkét
  index visszaindítása és teljes recovery.
- A futás után mindkét Meilisearch konténer `healthy` állapotú.

## Ismert határ

Az S03 identitásváltás és az S05 operátori beavatkozások szándékosan vezetett,
kézi checkpointok. Az S05 műveletek saját teljes-stack bizonyítékát a
[Phase 5 jegyzőkönyv](PHASE-5-EVIDENCE.md) tartalmazza. A teljes Release C kapu
következő nyitott része a Fázis 7.
