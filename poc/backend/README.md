# IndaPlay / TV2 PoC backend

NestJS moduláris monolit. Jelen állapot: **M0 alap + M1 tranzakciós CMS + M2 L1
identity + M3 outbox→JetStream relay + M4 kétindexes kereső + M5 helyreállítási
vezérlősík implementálva**,
valódi PostgreSQL, NATS JetStream és két külön Meilisearch példány elleni futási
bizonyítékkal. Az M2 L2 (valódi Authentik tokenek) és a média (M6) nyitott.

A terv és a döntések: [../README.md](../README.md), [../DECISIONS.md](../DECISIONS.md),
[../M0-IMPLEMENTATION.md](../M0-IMPLEMENTATION.md), [../M1-IMPLEMENTATION.md](../M1-IMPLEMENTATION.md),
[../M3-IMPLEMENTATION.md](../M3-IMPLEMENTATION.md), [../M3-EVIDENCE.md](../M3-EVIDENCE.md),
[../M4-IMPLEMENTATION.md](../M4-IMPLEMENTATION.md), [../M4-EVIDENCE.md](../M4-EVIDENCE.md).

## Előfeltételek

| Eszköz | Elvárás | Miért |
| --- | --- | --- |
| Node.js | 24.20.0 (`.nvmrc`) | Az `engines` mező ezt írja elő; a build és a tesztek ezen futottak |
| npm | 10.9+ | `npm ci` a commitolt lockfile-ból |
| Docker + Compose plugin | Bármelyik friss kiadás | A helyi PostgreSQL és később a full profil |
| PostgreSQL kliens (`psql`) | Opcionális | Kézi ellenőrzéshez; a scriptek nem igénylik |

`jq`, GNU `timeout` és NATS CLI **nem kell**: a smoke-runner minden HTTP- és
időkorlát-ellenőrzést Node-ban végez.

## Első indítás

```bash
cd poc/backend
cp .env.example .env            # majd írd át minden REPLACE_ME értéket
npm ci
npm run build
docker compose up -d --wait postgres
npm run db:migrate
npm start
```

Az alkalmazás a `.env` fájlból olvas, hacsak az `ENV_FILE` nem jelöl ki másikat.
Kijelölt, de hiányzó `ENV_FILE` indítási hiba; másik `.env`-re **nincs** csendes
visszaesés. A `.env.example` placeholder, nem indításra kész konfiguráció.

A `HOST` alapértéke `127.0.0.1`; konténeres futtatáshoz állítsd `0.0.0.0`-ra.
A 256 KB feletti JSON request body `413 payload_too_large` választ kap.

Ellenőrzés:

```bash
curl -s localhost:3000/health/live
curl -s localhost:3000/health/ready
curl -s localhost:3000/docs-json | head -c 200
open http://localhost:3000/docs
```

## Parancsok

| Parancs | Mit csinál |
| --- | --- |
| `npm run build` | TypeScript fordítás `dist/`-be |
| `npm start` | A lefordított alkalmazás indítása |
| `npm run lint` | oxlint a `src`, `scripts` és `test` fákon |
| `npm test` | Teljes Vitest futás (alap + integrációs próbák) |
| `npm run verify` | Build + lint + OpenAPI drift + teljes tesztkapu |
| `npm run test:integration:m1` | M1 T01–T23 integrációs próbák |
| `npm run test:integration:m2` | M2 L1 identity próbák (mock JWKS + TEST_DATABASE_URL) |
| `npm run test:integration:m3` | M3 T01–T20 relay próbák (NATS_URL + TEST_DATABASE_URL) |
| `npm run test:integration:m4` | M4 T01–T25 kereső próbák (NATS_URL + TEST_DATABASE_URL + két Meili) |
| `npm run test:integration:m5` | M5 tartós state/lock szerződések; live tesztekhez full stack szükséges |
| `npm run db:migrate` | A hiányzó migrációk alkalmazása a `DATABASE_URL`-en |
| `npm run db:generate` | Új migráció generálása a `src/schema.ts` alapján |
| `npm run db:reset` | **Csak** a `TEST_DATABASE_URL` eldobható adatbázisának újraépítése |
| `npm run contracts:emit` | A v1 esemény JSON Schema újragenerálása |
| `npm run smoke:m0` | Az M0 core smoke (izolált Compose-projekt, saját childok) |
| `npm run smoke:full` | Identity + NATS + kétindexes kereső smoke; az Authentik L2 pending marad |
| `npm run demo:m1` | Az M1 mintafolyamat HTTP-listener nélkül |
| `npm run demo:m2` | Bearer tokenes admin út (`OIDC_ACCESS_TOKEN` + `OIDC_ISSUER_URL`) |
| `npm run demo:m3` | Outbox → publish ACK → kézbesítés, relay stop/start mellett |
| `npm run demo:m4` | Publikálás → A/B index → keresés, egy példány kiesésével és felzárkózásával |
| `npm run search:reindex -- --index=a` | A index teljes snapshot/import/swap/catch-up/verify újraépítése |
| `npm run search:reindex:status` | A tartós A/B reindexállapot kiírása |
| `npm run search:quarantine:inspect -- --sequence=N` | Karanténrekord titokmentes vizsgálata |
| `npm run search:quarantine:replay -- --sequence=N --reason=...` | Validált eredeti esemény célzott replaye |
| `npm run search:repair-content -- --id=UUID --index=a\|b\|both` | Aktuális DB-projekció célzott javítása |
| `npm run baseline:m5 -- --output=DIR` | 1000 tartalom + 100 ciklus raw JSON/Markdown baseline |
| `npm run demo:m5` | M4 üzleti demó, majd A és B teljes reindexe |

## Migráció

A pinelt Drizzle Kit birtokolja a migrációk fájlnevét és a saját
`drizzle.__drizzle_migrations` naplóját. Nincs kézi sorszámozó és nincs külön
alkalmazásoldali migrációs napló. A migráció előrefelé alkalmazott; általános
`down` nincs.

- `migrations/0000_baseline.sql` – M0: csak az alkalmazás névterét alapozza meg,
  üzleti táblát nem hoz létre.
- `migrations/0001_content_audit_outbox.sql` – M1-02: `content`, `content_audit`,
  `outbox_event` a korlátaikkal és egyediségeikkel.
- `migrations/0002_reindex_control.sql` – M5: monoton outbox high-water,
  PubAck stream sequence és a két tartós `search_index_control` sor.

Séma módosításakor `src/schema.ts` változik, majd `npm run db:generate` állítja
elő a következő fájlt. A már alkalmazott fájlt nem írjuk át.

### Teszt-adatbázis

```bash
export TEST_DATABASE_URL=postgresql://poc:...@127.0.0.1:5432/poc_test
npm run db:reset
npm test
```

A teljes integrációs futáshoz add meg a `NATS_URL`/`TEST_NATS_URL` és a két
`MEILI_*` kapcsolatot is, de ne töltsd be globálisan az alkalmazás
`FEATURE_*`/`OIDC_*` runtime kapcsolóit: az identity-tesztek saját, izolált JWKS
szervert indítanak. Ezt a szétválasztást a CI release gate is megtartja.

A `db:reset` visszautasít minden olyan célt, amelynek a neve nem `_test`
végződésű, és azt is, ha a cél megegyezik a `DATABASE_URL`-lel. A `DATABASE_URL`
soha nem implicit célpont.

A HTTP- és CLI-képességek átadási besorolása, tulajdonosa és teszthivatkozása:
[../BACKEND-CAPABILITY-MATRIX.md](../BACKEND-CAPABILITY-MATRIX.md).

## Smoke és demó

```bash
npm ci && npm run build && npm run smoke:m0
```

A runner saját Compose-projektet (`indaplay-smoke-<id>`), saját volume-ot,
dinamikus portot és esetenként külön alkalmazás-childot használ, majd `finally`
ágban mindent eltakarít. Nincs globális `pkill`, nincs shellből source-olt
`.env`, nincs vak `sleep`. Hiba esetén nem nulla exit kóddal áll meg, és a
jegyzőkönyvbe kiírja az egyedi projektnevet.

Ha külső SIGKILL szakította félbe, kizárólag azt a projektet kell eltávolítani:

```bash
docker compose -p indaplay-smoke-<id> down -v
```

Registry nélküli gépen a runner külső PostgreSQL-lel is futtatható. Ekkor saját,
egyedi nevű adatbázist hoz létre és ejt el, a kiesési próbát pedig egy elé tett
TCP-kapuval végzi; a jegyzőkönyv kiírja, melyik módban futott:

```bash
SMOKE_EXTERNAL_DATABASE_URL=postgresql://poc:...@127.0.0.1:5432/postgres npm run smoke:m0
```

Az M1 demó a rögzített mintafolyamatot járja végig (draft v1 → szerkesztés v2 →
publish v3 → withdraw v4 → szerkesztés v5 → republish v6, 6 audit és 3 függő
esemény), HTTP-listener nélkül, explicit demó-actorral:

```bash
npm run db:migrate && npm run demo:m1
```

## Compose profilok

`docker compose up -d --wait postgres` csak a core PostgreSQL-t indítja. A full
profil definíciója elkészült, indítása az adott integráció fázisának feladata:

```bash
docker compose --profile full config -q     # definíció validálása, indítás nélkül
docker compose --profile full up -d         # M2/M3/M4 munkája
```

Minden image változón keresztül hivatkozott, így pontos tag vagy digest a
környezeti fájlból jön. Lásd [VERSIONS.md](VERSIONS.md) és
[docs/external-access.md](docs/external-access.md).

## Modulhatárok

```text
src/
  main.ts                 indulás, OpenAPI, request boundary, hibafilter
  app.module.ts           konfiguráció, adatbázis, content
  config.ts               séma, ENV_FILE szabály, feature-kulcsok
  database.ts             pool, drizzle, egy kapcsolaton futó tranzakció
  schema.ts               content / content_audit / outbox_event
  health.ts               live és ready (ready = csak PostgreSQL)
  http.ts                 correlation id, admin prefixvédelem, problem+json
  contracts/              errors, http (DTO + normalizálás), events, permissions
  content/                szolgáltatás, repository, slug, admin és katalógus route
  outbox/                 eseményrögzítés; kézbesítés M3
  identity/               OIDC verifier, boundary, /me, szerepleképezés (M2)
  messaging/              JetStream adapter, topológia, outbox relay (M3)
  search/                 Meili adapter és bootstrap, projekció, két worker,
                          karantén, A→B olvasási út (M4), reindex koordinátor (M5)
  ops/                    processing-status: outbox, relay, broker, A/B index
```

A `ContentModule` birtokolja a tartalom életciklusát. Az outbox csak rögzít: a
`delivered_at` mezőt kizárólag az M3 relay írhatja, publish ACK után.

## Szerkesztői read model

Az admin workspace két adatminimalizált, `content:read` jogosultságú olvasási
végpontot használ:

- `GET /admin/contents`: `q`, `status`, `category`, `limit`, `cursor`; stabil
  `updated_at DESC, id DESC` sorrend, opaque cursor és összesített találatszám
  nélkül;
- `GET /admin/contents/:id/audit`: `limit`, `cursor`; `content_version DESC`
  sorrend, request body és mezőérték-diff nélkül.

Ismeretlen, ismételt vagy hibás query `422 validation_failed`. A lista
title/slug részszöveget és pontos UUID-t keres, az SQL wildcardokat escape-eli.
Az `0003_steady_leader.sql` migráció 5000 szintetikus soros mérés alapján adja a
`content(updated_at, id)` indexet; a végső terv `Index Scan Backward` volt teljes
sort helyett.

## Kereső-határ (M4)

`FEATURE_SEARCH=off` mellett a `GET /catalog/search` stabil
`503 search_unavailable` választ ad: nincs worker, nincs Meilisearch-kliens és
nincs hálózati hívás. A query-validálás ilyenkor is előbb fut, tehát a hibás
kérés továbbra is `422`.

`FEATURE_SEARCH=on` kötelezővé teszi mind a négy `MEILI_*` kulcsot, és **két
különböző endpointot követel**: azonos A és B URL indulási hiba, mert egyetlen
példány nem tudja bizonyítani az A/B kiesést.

Bekapcsolva két egymástól független, soros worker indul (`search-a-v1`,
`search-b-v1` durable). Mindkettő minden eseménynél újraolvassa az aggregátum
**aktuális** PostgreSQL-állapotát, és abból dönt: publikált → dokumentum-upsert,
minden más (draft, visszavont, törölt) → törlés. Az esemény változási jelzés, nem
adatforrás, ezért egy régi publish esemény visszajátszása nem hozza vissza a
közben visszavont tartalmat.

Az üzenet ACK-ja **kizárólag** a hozzá tartozó Meilisearch-task `succeeded`
végállapota után történik. Hosszú task alatt a worker `working()` jelzéssel
tartja életben a kézbesítést, és nem kér új üzenetet. Átmeneti hibánál helyben
retryzik (1, 2, 4, 8, 16, 30 s, ±20% jitter), és ezt a várakozást új CMS-esemény
nem rövidítheti le. Hibás JSON, érvénytelen v1 séma vagy tartósan
visszautasított projekció karanténba kerül (`CONTENT_DLQ`), és az eredeti üzenet
csak a karantén PubAck után ACK-olódik. Hibás kulcs vagy eltérő indexbeállítás
nem karantén és nem csendes fallback: az adott példány `halted` állapotba kerül
és operátori beavatkozást vár.

Az olvasási úton a Meilisearch **csak rendezett azonosítólistát** ad
(`displayedAttributes: ['id']`). A válasz minden mezője és a publikáltság egyetlen
PostgreSQL-lekérdezésből származik, ezért egy elavult indextalálat legfeljebb
rövidebb oldalt okoz, adatszivárgást soha. A-ról B-re csak hálózati hiba,
timeout, 429 és 5xx esetén esünk vissza, példányonként egyetlen próbával; 4xx,
401/403 és konfigurációs eltérés nem fallback, hanem `503 search_unavailable`.
A Meilisearch állapota nem része a `/health/ready` válaszának — az továbbra is
csak PostgreSQL —, hanem a keresési válaszban és a
`GET /admin/processing-status` `indexes.a` / `indexes.b` mezőiben látszik.

## Helyreállítás és reindex (M5)

Minden nem `ready` tartós indexfázis azonnal kimarad a keresési routingból. A
reindex globális és indexenkénti PostgreSQL advisory lockot tart, megvárja a
worker drain-nyugtáját, repeatable-read snapshotból run-scoped staging indexet
épít, minden Meilisearch-task végét ellenőrzi, majd atomikusan swapol. A
megőrzött durable consumer a rögzített stream-határig felzárkózik. A visszaengedés
előtt rövid exclusive publish/withdraw barrier alatt a DB és a live index teljes
`id + aggregateVersion` halmaza egyezni köteles.

Megszakadt vagy eltérő futás `failed/paused` marad; induláskor sem válik magától
routolhatóvá. Helyreállítási és karanténeljárás: [docs/recovery.md](docs/recovery.md).

## Identity-határ

`FEATURE_IDENTITY=off` mellett a teljes `/admin` prefix – a nem létező
útvonalakkal együtt – `503 dependency_unavailable` választ ad, a route
létezésétől és a kérés methodjától függetlenül. Bodyban vagy headerben küldött
hamis actor nem segít.

`FEATURE_IDENTITY=on` kötelezővé teszi az `OIDC_ISSUER_URL` és `OIDC_AUDIENCE`
kulcsokat, bekapcsolja a Bearer ellenőrzést (`jose` + discovery/JWKS), és a
prefix-503 helyett hiányzó tokenre `401` + `WWW-Authenticate: Bearer`, hiányzó
jogra `403` válasz jön. Az IdP hálózati állapota nem része a `/health/ready`
vizsgálatnak. Csoportnevek → szerepek: `poc-viewer` / `poc-editor` /
`poc-publisher` (`ROLE_GROUPS`). Audience: `poc-backend-api` (az ID token
`poc-backend` client_id-ja szándékosan elutasított).

Az M1 tesztek saját összeállítást használnak (`test/support/test-app.ts`),
amelybe az actort a teszt injektálja. Az M2 L1 próbák mock JWKS-sel futnak
(`test/support/oidc-mock.ts`); a valódi Authentik (L2) a full Compose blueprinttel
és `demo:m2` / `authentik-login.mjs` scripteken keresztül jön, E01–E05 után.
A blueprint public PKCE kliensének strict redirect allowlistje a meglévő CLI
callback mellett a frontend `http://127.0.0.1:5173/auth/callback` és
`http://127.0.0.1:5173/login` post-logout URL-t tartalmazza; wildcard nincs.

## Hibaformátum

Üzleti és API-hiba `application/problem+json`: `type`, `title`, `status`, `code`,
`detail`, `instance`, `correlationId`; verzióütközésnél `expectedVersion` és
`actualVersion`, validációs hibánál a `fields` mezőnévlista is. A health-válasz
dokumentált kivétel, a Terminus alakját követi.

Bejövő `X-Correlation-Id` csak `[A-Za-z0-9._-]{1,128}` alakban használható, egyébként
a szerver UUID-t generál. A log soha nem tartalmaz tokent, jelszót vagy teljes
adatbázis-URL-t; ezt a smoke 5.6 esete sentinel értékekkel ellenőrzi.
