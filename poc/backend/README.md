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

A backend alkalmazás konténere szándékosan **nincs** ebben a fájlban: az a
`compose.prod.yaml` overlay `app` profilja. A `full` profil a CI
dependency-profilja, ahol a backend a hoston fut; egy backend konténer ott
portütközést okozna. Lásd „Production image és profil”.

## Böngésző-topológia és CORS (BE-F1 S2)

A támogatott topológia **same-origin**. A böngésző mindig relatív `/api/...`
útra kér, és a böngésző soha nem beszél közvetlenül a backend originnel. A
backend ezért **CORS nélkül fut**: nincs `enableCors`, nincs
`Access-Control-Allow-Origin`, és preflightra sem válaszol. Wildcard origin
sosem volt és nem is lehet opció.

| Környezet | Ki továbbít | Szerződés |
| --- | --- | --- |
| Fejlesztés | Vite dev proxy (`poc/frontend/vite.config.ts`) | A böngésző `http://127.0.0.1:5173/api/...` útra kér; a proxy levágja az `/api` prefixet és a `VITE_BACKEND_ORIGIN` (alap: `http://127.0.0.1:3000`) felé továbbít |
| Production (célállapot; még nincs repóban implementálva) | Reverse proxy / ingress | Egy origin szolgálja ki az SPA-t és az API-t. Az `/api/*` útvonal a backendre megy, az `/api` prefix levágásával, a `Host`, `X-Forwarded-For` és `X-Forwarded-Proto` headerök továbbításával. Minden más út az SPA-ra megy |

Az ingress-szerződés kötelező elemei:

- **Prefix.** A böngésző `/api/<útvonal>` alakot lát, a backend `<útvonal>`-at
  kap. A frontend `VITE_API_BASE` alapértéke `/api`; abszolút URL-re állítva
  megszűnik a same-origin feltétel, tehát nem támogatott.
- **Kliens IP.** A proxy írja a saját `X-Forwarded-For` bejegyzését, és a
  backend `RATE_LIMIT_TRUSTED_PROXY_HOPS` értéke pontosan ennyi megbízható
  hopot engedélyez (production overlay: `1`). Lásd lent.
- **TLS.** A TLS a proxyn terminál; a backend továbbra is `127.0.0.1`-en
  publikált HTTP listener.

Külön-originű (cross-origin) deployment **nem a jelenlegi döntés**. Ha valaha
mégis kell, az nem ennek a fájlnak a felpuhítása, hanem külön, explicit
allowlist: zárt origin-, method- és header-lista, `Access-Control-Max-Age`,
credentials nélkül. A regressziót a `test/integration/public-edge.test.ts`
`S2 same-origin contract` esetei őrzik: cross-origin kérésre nem jön CORS
header, preflightra nincs válasz, és a shipped bootstrap nem tartalmaz
`enableCors` hívást.

## Publikus perem rate limit (BE-F1 S1)

`GET /catalog/search` és `GET /catalog/contents/:id` – a route matrix két
publikusan elérhető útvonala – alkalmazásszintű limitet kap. A limiter a
request boundary után, de a tokenellenőrzés és a controller **előtt** fut, így
egy publikus útvonal elárasztása nem tud JWKS- vagy adatbázis-munkát elkölteni.
Health és `/admin` soha nem limitált: egy readiness próbát nem lehet kizárni a
saját ellenőrzéséből, az admin pedig identity-döntés, nem forgalmi.

| Kulcs | Alap | Jelentés |
| --- | --- | --- |
| `RATE_LIMIT_PUBLIC` | `on` | A limiter be/ki. Kikapcsolva a publikus perem korlátlan |
| `RATE_LIMIT_PUBLIC_MAX` | `120` | Kérés / ablak / route / kliens |
| `RATE_LIMIT_PUBLIC_WINDOW_MS` | `60000` | Fix ablak hossza |
| `RATE_LIMIT_TRUSTED_PROXY_HOPS` | `0` | Hány `X-Forwarded-For` bejegyzés származik megbízható proxytól |

**Proxy/IP feltételezés.** Alapértelmezésben az `X-Forwarded-For` **teljesen
figyelmen kívül marad**, és a transport peer címe számít: ezt a kliens nem
tudja hamisítani. Csak `RATE_LIMIT_TRUSTED_PROXY_HOPS > 0` esetén olvassuk a
headert, és akkor is jobbról a megadott számú bejegyzést visszaszámolva – azt a
címet, amit a legkülső megbízható proxy látott. A vártnál rövidebb lánc nem
részleges bizalom, hanem visszaesés a peer címre.

**Szerződés.** Limittúllépéskor `429`, `application/problem+json`,
`code: rate_limited`, `type: urn:indaplay:poc:error:rate_limited`, valamint
`Retry-After` egész másodpercben. A `rate_limited` stabil külső kód: az
`ERROR_CODES` része, és az exception filter a `429`-et is erre képezi, nem
`500 internal_error`-ra. Mindkét route OpenAPI-ban is `429`-et hirdet a
`Retry-After` headerrel.

**Korlát.** A számláló ebben a processzben él. Két alkalmazáspéldány együtt a
konfigurált limit kétszeresét engedi át. A nyilvántartott kliens-kulcsok száma
felülről korlátos (`10 000`); telítettségnél az új kulcsok a legrégebbi aktív
ablak lejártáig `429` választ kapnak. Aktív számláló nem esik ki, a lejárt
ablakok takarítása amortizált O(1). Több példánynál az ingress tegyen rá saját
peremlimitet, vagy kerüljön a számláló megosztott tárolóba.

## Production image és profil (BE-F1 O1, S7)

A backend image `Dockerfile`-ból épül: három stage (build, production
dependency, runtime), `npm ci` a commitolt lockfile-ból, és a base image
`NODE_IMAGE` build argumentum, hogy pontos tag vagy digest kívülről jöjjön
(digest pinelés az E01 registry-hozzáférésig nyitott). A runtime stage a
`node` felhasználóként (uid 1000) fut, a futtatott fájlokat nem birtokolja,
migrációt nem tartalmaz, és `HEALTHCHECK`-ként a saját `/health/live`
végpontját kérdezi (`scripts/container-healthcheck.mjs`). Secret nem kerül
build argumentumba, `ENV`-be vagy image layerbe; a `.dockerignore` a
`.env*` fájlokat már a build contextből kizárja.

Az indítás külön overlay és külön `app` profil – **nem** a CI által
dependency-khez használt `full` profil, ahol a hoston futó backenddel
portütközést okozna:

```bash
docker compose -f compose.yaml -f compose.prod.yaml \
  --env-file .env.production --profile app --profile full up -d --wait
docker compose -f compose.yaml -f compose.prod.yaml \
  --env-file .env.production --profile app ps
curl -s 127.0.0.1:3000/health/live
curl -s 127.0.0.1:3000/health/ready
```

Az overlay egyben a Meilisearch production posture (S7): mindkét példány
`MEILI_ENV=production`, kötelező, nem repóban tárolt master kulccsal. A helyi
`compose.yaml` tudatosan marad `MEILI_ENV=${MEILI_ENV:-development}`. Minta:
[.env.production.example](.env.production.example) – csupa `REPLACE_ME`, valós
érték nélkül.

## Host-kitettség (BE-F1 S4)

A `compose.yaml` minden publikált portja `${HOST_BIND_ADDRESS:-127.0.0.1}`-re
kötődik: PostgreSQL, NATS (kliens és monitor), mindkét Meilisearch és az
Authentik. Ezek fejlesztői hitelesítő adatokkal futó függőségek, amiket nem
tesz elérhetővé a helyi hálózat felé az, hogy a Compose portot publikált. A
konténerek közti feloldás változatlanul service néven megy a Compose hálózaton,
tehát a belső service discovery nem sérült. A bind cím szándékos tágítása
(`HOST_BIND_ADDRESS=0.0.0.0`) explicit döntés, nem alapállapot.

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

A publikus perem limitje `429 rate_limited` problem dokumentumot ad
`Retry-After` headerrel; a `429`-et az exception filter sem képezheti
`500 internal_error`-ra. Lásd „Publikus perem rate limit”.

Bejövő `X-Correlation-Id` csak `[A-Za-z0-9._-]{1,128}` alakban használható, egyébként
a szerver UUID-t generál. A log soha nem tartalmaz tokent, jelszót vagy teljes
adatbázis-URL-t; ezt a smoke 5.6 esete sentinel értékekkel ellenőrzi.
