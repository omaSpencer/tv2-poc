# IndaPlay / TV2 PoC backend

NestJS moduláris monolit. Jelen állapot: **M0 alap + M1 tranzakciós CMS + M3
outbox→JetStream relay implementálva**, valódi PostgreSQL 17 és NATS JetStream
elleni futási bizonyítékkal. Identity (M2), kereső (M4) és média (M6) még nincs
bekötve.

A terv és a döntések: [../README.md](../README.md), [../DECISIONS.md](../DECISIONS.md),
[../M0-IMPLEMENTATION.md](../M0-IMPLEMENTATION.md), [../M1-IMPLEMENTATION.md](../M1-IMPLEMENTATION.md),
[../M3-IMPLEMENTATION.md](../M3-IMPLEMENTATION.md), [../M3-EVIDENCE.md](../M3-EVIDENCE.md).

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
| `npm run test:integration:m1` | M1 T01–T23 integrációs próbák |
| `npm run test:integration:m3` | M3 T01–T20 relay próbák (NATS_URL + TEST_DATABASE_URL) |
| `npm run db:migrate` | A hiányzó migrációk alkalmazása a `DATABASE_URL`-en |
| `npm run db:generate` | Új migráció generálása a `src/schema.ts` alapján |
| `npm run db:reset` | **Csak** a `TEST_DATABASE_URL` eldobható adatbázisának újraépítése |
| `npm run contracts:emit` | A v1 esemény JSON Schema újragenerálása |
| `npm run smoke:m0` | Az M0 core smoke (izolált Compose-projekt, saját childok) |
| `npm run smoke:full` | Full-profil smoke: NATS szakasz; kereső pending (M4) |
| `npm run demo:m1` | Az M1 mintafolyamat HTTP-listener nélkül |
| `npm run demo:m3` | Outbox → publish ACK → kézbesítés, relay stop/start mellett |

## Migráció

A pinelt Drizzle Kit birtokolja a migrációk fájlnevét és a saját
`drizzle.__drizzle_migrations` naplóját. Nincs kézi sorszámozó és nincs külön
alkalmazásoldali migrációs napló. A migráció előrefelé alkalmazott; általános
`down` nincs.

- `migrations/0000_baseline.sql` – M0: csak az alkalmazás névterét alapozza meg,
  üzleti táblát nem hoz létre.
- `migrations/0001_content_audit_outbox.sql` – M1-02: `content`, `content_audit`,
  `outbox_event` a korlátaikkal és egyediségeikkel.

Séma módosításakor `src/schema.ts` változik, majd `npm run db:generate` állítja
elő a következő fájlt. A már alkalmazott fájlt nem írjuk át.

### Teszt-adatbázis

```bash
export TEST_DATABASE_URL=postgresql://poc:...@127.0.0.1:5432/poc_test
npm run db:reset
npm test
```

A `db:reset` visszautasít minden olyan célt, amelynek a neve nem `_test`
végződésű, és azt is, ha a cél megegyezik a `DATABASE_URL`-lel. A `DATABASE_URL`
soha nem implicit célpont.

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
  identity/               actor kontextus; valódi tokenellenőrzés M2
```

A `ContentModule` birtokolja a tartalom életciklusát. Az outbox csak rögzít: a
`delivered_at` mezőt kizárólag az M3 relay írhatja, publish ACK után.

## Identity-határ

`FEATURE_IDENTITY=off` mellett a teljes `/admin` prefix – a nem létező
útvonalakkal együtt – `503 dependency_unavailable` választ ad, a route
létezésétől és a kérés methodjától függetlenül. Bodyban vagy headerben küldött
hamis actor nem segít. `FEATURE_IDENTITY=on` ellenőrző adapter nélkül indítási
hiba, tehát a flag bekapcsolása nem nyit utat.

Az M1 tesztek saját összeállítást használnak (`test/support/test-app.ts`),
amelybe az actort a teszt injektálja. Ez a fájl a `test/` fa alatt él, a `dist/`
buildbe nem kerül bele. A valódi tokenellenőrzést M2 adja hozzá.

## Hibaformátum

Üzleti és API-hiba `application/problem+json`: `type`, `title`, `status`, `code`,
`detail`, `instance`, `correlationId`; verzióütközésnél `expectedVersion` és
`actualVersion`, validációs hibánál a `fields` mezőnévlista is. A health-válasz
dokumentált kivétel, a Terminus alakját követi.

Bejövő `X-Correlation-Id` csak `[A-Za-z0-9._-]{1,128}` alakban használható, egyébként
a szerver UUID-t generál. A log soha nem tartalmaz tokent, jelszót vagy teljes
adatbázis-URL-t; ezt a smoke 5.6 esete sentinel értékekkel ellenőrzi.
