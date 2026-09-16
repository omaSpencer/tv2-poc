# M4 – Kereshető katalógus két indexszel: futási jegyzőkönyv

2026-09-16 · Az [M4-terv](M4-IMPLEMENTATION.md) megvalósításának bizonyítéka.

**Állapot: implementálva és valódi függőségek ellen ellenőrizve.** Az M4-Txx
próbák mind lefutottak valódi PostgreSQL, valódi NATS JetStream és **két külön
Meilisearch-példány** ellen. A teljes „belépés → publikálás → keresés" üzleti
demó `M2 L2 pending` marad, mert valódi Authentik access token nincs; a
keresőút maga hiánytalanul bizonyított.

## 1. Futtatókörnyezet

| Elem | Érték | Honnan |
| --- | --- | --- |
| Node.js | **24.20.0** | `node -v` (a manifest `>=24.20.0 <25` pinje) |
| npm | 10.9.7 | `npm -v` |
| PostgreSQL | **16.13** (lásd az eltérést a 6. szakaszban) | `select version()` |
| NATS | **nats-server 2.12.2**, JetStream fájltárolóval | `nats-server --version` |
| Meilisearch A | **1.15.2**, `127.0.0.1:7700`, saját master key és saját adatkönyvtár | `GET /version` |
| Meilisearch B | **1.15.2**, `127.0.0.1:7701`, **másik** master key és másik adatkönyvtár | `GET /version` |
| Meilisearch kliens | `meilisearch` **0.62.0**, pontos pin, lockfile-ban | `package.json`, `package-lock.json` |

A és B két külön processz, külön porton, külön adatkönyvtárral és külön
kulccsal. Ez az M4 alapfeltétele: egyetlen példány két indexe nem bizonyítja a
szolgáltatáskiesést, és a `validateConfig` ezért utasítja el, ha a két URL
ugyanarra az endpointra mutat.

## 2. Futtatott parancsok és eredményük

| Ellenőrzés | Eredmény |
| --- | --- |
| `npm run build` | PASS |
| `npm run lint` | PASS (0 warning, 0 error, 81 fájl) |
| `npm run db:migrate` | PASS (új M4-migráció nincs; a workerállapot memóriában él) |
| `npm test` | **152/152 PASS, 11 fájl** (114 korábbi + 38 új) |
| `npm run test:integration:m4` | **38/38 PASS** |
| `npm run smoke:full` | **4 PASS, 0 FAIL, 1 PENDING** (Authentik L2) |
| `npm run demo:m4` | PASS, `M2 L2 pending` megjelöléssel |

Reprodukció:

```sh
cd poc/backend
export NODE_ENV=test PORT=0 LOG_LEVEL=silent
export FEATURE_IDENTITY=off FEATURE_OUTBOX_RELAY=off FEATURE_SEARCH=off FEATURE_MEDIA=off
export DATABASE_URL='<eldobható _test adatbázis URL-je>'
export TEST_DATABASE_URL="$DATABASE_URL"
export NATS_URL='nats://127.0.0.1:4222'
export MEILI_A_URL='http://127.0.0.1:7700' MEILI_A_KEY='<A kulcsa>'
export MEILI_B_URL='http://127.0.0.1:7701' MEILI_B_KEY='<B kulcsa>'
npm ci && npm run build && npm run lint && npm run db:migrate && npm test
npm run smoke:full
FEATURE_SEARCH=on FEATURE_OUTBOX_RELAY=on NODE_ENV=development PORT=3000 \
  DATABASE_URL='<eldobható demó adatbázis>' \
  NATS_STREAM=DEMO_M4 NATS_SUBJECT=poc.demo.m4.changed.v1 \
  MEILI_INDEX_UID=contents_demo_m4 npm run demo:m4
```

## 3. Az M4-Txx próbák

Minden sor konkrét teszthez van rendelve. A hibainjektálás a hálózati határon
történik (`test/support/proxy.ts`): a worker és az olvasási út ténylegesen nem
éri el a példányt, nem egy kliensmock ad hamis választ.

| # | Teszt | Megfigyelt eredmény |
| --- | --- | --- |
| T01 | `M4-T01 …` (5 eset) | Hiányzó kulcs a saját nevén bukik (`MEILI_B_URL`, `MEILI_B_KEY`), a hibás URL nem kerül a hibaüzenetbe, az **azonos A/B endpoint** startuphiba (`['MEILI_A_URL','MEILI_B_URL']`), üres kulcs elutasítva, és a dokumentált alapértékek érvényesülnek (`contents`, 1000, 30000, 100, 10000) |
| T02 | `M4-T02 …` | Mindkét üres index létrejön, a settings task sikerrel zárul, és visszaolvasva `['title','tags','summary']` / `['category']` / `['id']`. Az **ismételt** bootstrap `{created:false, settingsApplied:false, primaryKeyApplied:false}` |
| T03 | `M4-T03 …` | Idegen beállítású létező A index: a worker `halted`, `lastErrorCode='config_mismatch'`; a settings és a dokumentumszám **változatlan**; B ettől függetlenül normálisan felállt |
| T04 | `M4-T04 …` | Mindkét index a DB aktuális projekcióját tartalmazza, helyes `aggregateVersion`-nel; `slug` és `mediaAssetId` nincs a dokumentumban |
| T05 | `M4-T05 …` | Withdraw után mindkét indexből törlődik; a delete task beküldésének pillanatában `num_ack_pending = 1`, tehát **ACK nem előzte meg** a tasksikert; utána a durable teljesen kiürül |
| T06 | `M4-T06 …` | Withdraw után visszajátszott eredeti publish esemény **delete-re konvergál**; a tartalom nem válik újra kereshetővé egyik indexben sem |
| T07 | `M4-T07 …` | A `afterTaskSucceeded` ponton megszakított worker: a dokumentum az indexben van, az üzenet **nincs ACK-olva**. Újraindítás után a JetStream az `ack_wait` (30 s) lejártával újrakézbesít, a feldolgozás idempotens, a végállapot 1 dokumentum. Mért lefutás: 31,4 s |
| T08 | `M4-T08 …` | A proxy 34 másodpercig `processing`-nak jelenti a valójában sikeres taskot. Ezalatt `num_ack_pending` végig **1**, `num_pending` **0** → nincs redelivery az `ack_wait` letelte után sem; a worker ≥10 `working()` jelzést küldött, és **nem indított** második indexműveletet. Feloldás után azonnal ACK. Mért lefutás: 35,4 s |
| T09 | `M4-T09 (ladder)` + `M4-T09 …` | A ladder tisztán ellenőrizve: 1, 2, 4, 8, 16, 30 s, az utolsó ismétlődik, és minden lépés ±20% között marad (50–50 mintával lépésenként). Integrációban `status503`, `status429`, `down` és `hang` esetén is: nincs ACK, a megfigyelt újrapróbálkozási rések a ladder lépésén vannak, és **öt új CMS-esemény nem rövidítette le** a folyamatban lévő backoffot |
| T10 | `M4-T10 …` | B kiesése alatt A publish és withdraw eseményt is feldolgoz; B durable-je lemarad (`pending + ack_pending ≥ 1`); visszatérés után saját sorrendjében felzárkózik, és ugyanoda konvergál (0 dokumentum) |
| T11 | `M4-T11 …` | A kiesése mellett B tovább indexel, a publikus keresés B-ről sikeres; A durable-je nem halad, semmi nem ACK-olódik rajta |
| T12 | `M4-T12 (envelope)` + `M4-T12/T13 …` | Hibás JSON és érvénytelen v1 séma is karanténba kerül **durable-önként külön rekorddal** (4 rekord = 2 üzenet × 2 durable), stabil locatorral (`originalStream`, `originalStreamSequence`, `originalSubject`, `durable`). A sémahibánál az eredeti `eventId` visszanyerhető volt, a JSON-hibánál `null`. A karanténüzenet nem tartalmaz payloadot, kulcsot vagy adatbázis-URL-t |
| T13 | ugyanott | Törölt karanténstream mellett a worker `quarantine_publish_failed` kóddal retryzik, az eredeti üzenet **ACK nélkül marad**, `lastAckedAt` továbbra is `null`. A stream visszaállítása után mindkét durable lezárja |
| T14 | `M4-T14 (contract)` + `M4-T14 …` | 13 határeset a pontos mezőnevekkel (üres `q`, 201 karakter, ismeretlen `page`, többszörös `q`, `limit=0/101/1e2/-1`, `offset=1001`); HTTP-n `422`, és a proxy számlálója szerint **egyetlen Meili-hívás sem** történt |
| T15 | `M4-T15 …` | `Őrségi`, `orsegi` (ékezet nélkül), `Vadon`, `élővilágáról` (summary) és `természetfilm` (tag) mind megtalálja a tartalmat. A válaszmezők pontosan a publikus nézet mezői; `mediaAssetId`, `aggregateVersion`, `createdBy` nincs bennük |
| T16 | `M4-T16 …` | `category=film` talál, `category=sport` nem. Ha a DB kategóriája megváltozik, de az index még a régit tartja, a `category=film` szűrés **üres** eredményt ad – a DB dönt |
| T17 | `M4-T17 …` | A sikeres, nulla találatos válasza után B-re **nincs** hívás (`proxyB.searches === 0`), a válasz 200 és üres |
| T18 | `M4-T18 …` | `down`, `hang`, `status429`, `status503`, `status500` mind pontosan **egy** B-próbát vált ki, és a válasz 200 |
| T19 | `M4-T19 …` | `status401` és `status400` esetén nincs fallback (`proxyB.searches === 0`), a válasz `503 search_unavailable`, és a problem body nem tartalmazza az API-kulcsot, a hostot vagy az index UID-ját |
| T20 | `M4-T20 …` | A és B egyszerre kiesve a keresés `503`; közben a `POST /admin/contents` 201, a `POST …/publish` 200, a `/health/ready` 200 |
| T21 | `M4-T21/T22 …` | B-ben maradt stale találat: a DB-szűrés eltávolítja, a publikus részlet `404 content_not_found`, nyilvános mező nem szivárog |
| T22 | ugyanott | A megmaradó elem sorrendje stabil, az oldal rövidebb (`returned = 1`), az `estimatedTotalHits ≥ 2` indexbecslés marad. Adatbázisban nem létező („szellem") ID is kiesik |
| T23 | `M4-T23 …` | A PostgreSQL TCP-proxyjának elvágása után a sikeres Meili-találat **nem** eredményez részleges választ: `503 dependency_unavailable`, a body nem tartalmaz `items` mezőt |
| T24 | `M4-T24 …` (search suite) + `M4-T24 …` (identity suite) | Token nélkül publikus. Valódi identity-határ mellett `Bearer not-a-jwt`, üres Bearer, `Basic …` és lejárt token egyaránt `401` + `WWW-Authenticate: Bearer`; érvényes viewer token nem változtat a publikus viselkedésen; a validálás a routing előtt fut (`422` marad `422`) |
| T25 | `M4-T25 …` | Függő outbox sor mellett is `200`, érvényes ISO idővel és nem negatív korral (R02 regresszió zárva). `indexes.a/b` mind a hat mezőt hozza; egy példány kiesésekor `state='retrying'`, `reachable=false`, `lastErrorCode` kitöltve, a másik `reachable=true`. A válaszban egyik API-kulcs sem szerepel |
| T26 | `smoke:full` → `full.m4 …` | Friss, izolált környezetben (saját `poc_smoke_<run>_test` adatbázis, saját `SMOKE4_<run>` stream, saját `contents_smoke_<run>` index mindkét példányon) a fixture **valóban végigmegy** az outbox → stream → A/B index úton, a keresés megtalálja, B kiesik és felzárkózik, A kiesése mellett a fallback működik, withdraw után a stale találat kiszűrődik, a részlet 404. A runner idegen outboxhoz, streamhez és indexhez **nem nyúl** |

### 3.1 Az izoláció külön igazolása (R01 az M4-re is)

A `smoke:full` futása előtt a normál `poc` adatbázisba külön kézbesítetlen
outbox-sor került. A futás után:

| Megfigyelés | Érték |
| --- | --- |
| Az őrsor `delivered_at` értéke a futás után | `NULL` (változatlan) |
| Az őrsor megmaradt | 1 sor |
| Maradék `poc_smoke%` adatbázis | nincs |
| Maradék index A-n / B-n | 0 / 0 |
| Maradék stream | nincs |

## 4. Az OpenAPI-felület

A publikált dokumentum a `GET /catalog/search`-höz teljes szerződést tartalmaz
(R10 az új végpontra alkalmazva):

- `q` kötelező, `minLength: 1`, `maxLength: 200`;
- `category` opcionális, a hat kategória `enum`-jával;
- `limit` egész, 1–100, alapérték 20; `offset` egész, 0–1000, alapérték 0;
- `200` → `CatalogSearchView` (`items`, `offset`, `limit`, `returned`,
  `estimatedTotalHits`), ahol az `estimatedTotalHits` leírása kimondja, hogy
  indexbecslés és meghaladhatja a visszaadott elemek számát;
- `401`, `422` és `503` → `application/problem+json`, `ProblemDocument` sémával.

Új nevesített sémák: `CatalogSearchView`, `SearchIndexStatus`,
`SearchQuarantineV1`; a `ProcessingStatusView` opcionális `indexes` mezővel bővült.

## 5. A `demo:m4` mért futása

```
workers_ready        indexUid=contents_demo_m4, durables=[DEMO_M4-search-a-v1, DEMO_M4-search-b-v1]
published            version=2
searchable           publishToSearchableMsA=224, publishToSearchableMsB=227
searches_ok          cím, summary, tag és kategória keresés, majd publikus részlet
b_down_a_progressed  B elérhetetlen, A tovább indexel (bState=retrying)
fallback_read_ok     A elérhetetlen, az olvasás B-ről kiszolgálva
b_caught_up          B visszatérése után felzárkózott
withdrawn            version=3
stale_hit_filtered   detailStatus=404, a stale találat nem jutott ki
end_state_identical  a két index dokumentuma bájtra azonos
demo_complete        identity: M2 L2 pending
```

A publikálás commitjától a kereshetőségig **224 ms (A)** és **227 ms (B)** telt
el ebben az egyedi futásban. Ez egyetlen megfigyelés, nem mérés: a formális
p50/p95/max terhelés melletti mérés az M5 feladata.

## 6. Környezeti eltérések és szándékos korlátok

Ezeket nyíltan rögzítjük, mert befolyásolják, mit jelent a fenti PASS.

| Tétel | Állapot |
| --- | --- |
| **PostgreSQL 16.13 a tervezett 17 helyett** | Az ellenőrző környezetből a PostgreSQL 17 csomagforrás nem érhető el. Az M4 egyetlen új SQL-je egy `where id = any(...) and status='published'` szűrés; 17-specifikus elemet sem az M4, sem a séma nem használ. A korábbi milestone-ok bizonyítéka 17-en készült, ezt a futást 16-on célszerű 17 ellen megismételni |
| **Az A/B kiesés hálózati proxyval injektált** | A teszt, a smoke és a demó a példány elé tett kapcsolóval vágja el A-t vagy B-t. Az alkalmazás szemszögéből ez megkülönböztethetetlen a leállított processztől (megszakított kapcsolat, timeout, valódi 4xx/5xx törzs). A processz tényleges leállítása külön, Compose-alapú futáson igazolható; a `demo:m4` `DEMO_MEILI_DIRECT=on` módban közvetlenül az endpointokra megy, hogy a példányok kézzel legyenek leállíthatók |
| **A D08 ladder pontos értékei tisztán ellenőrizve** | Az integrációs próbák rövidített laddert használnak, hogy egy tesztidőkereten belül több teljes backoff megfigyelhető legyen. A valódi 1/2/4/8/16/30 s értékeket és a ±20% jittert a `retryDelayMs` determinisztikus próbája igazolja, a produkciós kód pedig ezt a konstanst használja |
| **M2 L2 pending** | Valódi Authentik access token nincs, ezért a `demo:m4` a content service-t explicit publisher kontextussal hajtja, és az eredményt `M2 L2 pending`-nek jelöli. A `smoke:full` ugyanezt külön pending sorként jelenti, és ez **nem** számít bele a sikeres ellenőrzésekbe |
| **Image-digestek** | Továbbra is nyitottak (M0-17). A Meilisearch futtatása ebben a környezetben hivatalos bináris kiadásból történt, nem konténerimage-ből |
| **Compose full profil tényleges indulása** | Nem futott; a függőségek natív processzként lettek felhúzva |

## 7. Lezárási lista

- [x] A két index bootstrapja task-sikerrel igazolt és konfigurációjuk azonos. (T02–T03)
- [x] Published aktuális állapot upsertet, minden más állapot delete-et eredményez mindkét példányon. (T04–T06)
- [x] Task success előtti ACK lehetetlen; redelivery és duplikáció helyes végállapothoz vezet. (T07–T09)
- [x] A és B külön kiesése nem állítja meg az egészséges workert, a visszatérő durable felzárkózik. (T10–T11)
- [x] Poison message csak igazolt karanténpublikálás után ACK-olódik; DLQ-hibánál megmarad. (T12–T13)
- [x] A publikus API validál, helyesen fallbackel és nem használja a kereső metaadatait válaszforrásként. (T14–T23)
- [x] Public auth-határ, processing-status és titokmentes log megfelel a szerződésnek. (T24–T25)
- [x] A full smoke izolált, valódi keresőutat bizonyít, és nem jelöl pending lépést PASS-nak. (T26)
- [x] Build, lint, teljes M0–M4 regresszió, smoke és demo a pinelt Node-verzión sikeres.
- [x] A dokumentáció külön jelöli az implementált, szimulált, pending és még nem mért eredményeket. (6. szakasz)
- [ ] A teljes „belépés → publikálás → keresés" üzleti demó valódi Authentik tokennel. **M2 L2 pending.**

## 8. Amit M4 átad M5-nek

| Felület | Hol |
| --- | --- |
| Indexenként indítható/leállítható worker | `SearchRegistry.worker(alias).start() / .stop(graceMs)` |
| Index bootstrap- és health-felület | `bootstrapIndex(adapter)`, `MeiliIndexAdapter.reachable()`, `managedSettings()` |
| Aktuális DB-projekció és verzió | `projectionFor(id, row)`, `ContentRepository.findPublishedByIds` |
| Durable pending / in-flight / lastAck | `GET /admin/processing-status` → `consumers[]`, `indexes.a/b` |
| Karantén locator célzott replayhez | `SearchQuarantineV1.originalStream` + `originalStreamSequence` |
| Izolált A/B hibainjektálás | `test/support/proxy.ts`, `test/support/search-app.ts` |
| Routingból kizárható index | `SearchService.routable(alias)` – az `off` és `bootstrapping` állapot ma sem routolható; M5 ide illeszti a tartós `rebuilding` állapotot |

M5 ehhez ad tartós reindexállapotot, snapshot/catch-up határt, teljes importot,
konzisztencia-összevetést és formális p50/p95/max mérést.
