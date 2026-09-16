# M4 – Kereshető katalógus két indexszel: részletes implementációs terv

2026-09-16 · Codex · Rögzített terv.

**Státusz: tervezett, még nincs implementálva.** Ez a dokumentum az M4
megvalósítási szerződése. A kész állapotot csak valódi PostgreSQL 17,
JetStream és két külön Meilisearch-példány ellen lefutott ellenőrzések, a teljes
üzleti demó és az `M4-EVIDENCE.md` jegyzőkönyv igazolhatja.

Kiindulópont: [README](README.md), [milestone-terv](MILESTONES.md),
[fázisterv](PHASES.md), [döntésnapló](DECISIONS.md), az
[M3-terv](M3-IMPLEMENTATION.md), valamint az
[M0–M3 code review](M0-M3-CODE-REVIEW.md).

## 1. Szállítandó eredmény és belépési feltételek

M4 végén a `content.published` és `content.withdrawn` eseményeket két egymástól
független, soros worker dolgozza fel. Mindkettő a PostgreSQL aktuális állapotából
építi a saját Meilisearch-projekcióját, és csak sikeresen befejeződött
Meilisearch-task után ACK-olja a saját durable consumerének üzenetét. A publikus
keresési API elsődlegesen A-t használja, meghatározott átmeneti hibánál B-re
vált, majd a találatazonosítókat PostgreSQL-ben visszaellenőrzi és a nyilvános
mezőket onnan adja vissza.

| Szükséges eredmény | Miért szükséges? | Jelenlegi helye |
| --- | --- | --- |
| Atomi content/audit/outbox írás és aktuális publikáltsági szabály | Az index származtatott adat; a DB az igazságforrás | `src/content/`, `src/outbox/`, M1 |
| V1 eseményséma, stabil eventId és aggregateVersion | Fogyasztói validálás és követhetőség | `src/contracts/events.ts` |
| `CONTENT` stream, két külön durable és `CONTENT_DLQ` | A két worker saját előrehaladása és a karantén célja | `src/messaging/topology.ts`, M3 |
| JetStream kapcsolat, explicit ACK és `working()`/NAK felület | A task befejezéséhez kötött tartós feldolgozás | M3 adapter bővítendő |
| Nyilvános content nézet és SQL-ben szűrt publikus olvasás | A keresőből nem adunk vissza adminmezőt vagy stale állapotot | `src/contracts/http.ts`, `src/content/` |
| `search_unavailable` hibakód és `/catalog/search` route-szerződés | A publikus API stabil hibafelülete | `src/contracts/errors.ts`, `src/contracts/permissions.ts` |
| Két Meilisearch Compose-szolgáltatás | Valódi A/B feldolgozás és kiesési próba | `compose.yaml` |
| Hitelesített processing-status | Indexenkénti előrehaladás operátori megfigyelése | `src/ops/processing-status.controller.ts` |

### 1.1 Kötelező javítási kapu az M0–M3 review alapján

Az M4 implementációja részben párhuzamosan készülhet az alábbi javításokkal, de
M4 **nem zárható le**, amíg a rá épülő hibák nyitottak:

| Review-tétel | M4-kapu |
| --- | --- |
| R01 – a full smoke meglévő outboxot kézbesítettnek jelölhet | A full smoke kizárólag saját eldobható DB-t, streamet és indexeket használhat |
| R02 – pending outbox mellett a processing-status 500 | Kötelező a workerállapot bővítése előtt javítani és pending sorral tesztelni |
| R05 – a relay shutdown grace nem felső korlát | A közös NATS-kapcsolat és az M4 workerek korlátos leállása előtt rendezendő |
| R06/R12 – retry-wake és waiter életciklus | Az M4 worker saját retry-várakozása nem épülhet a hibás megszakítási szemantikára |
| R09 – a full smoke kézbesítés nélkül is PASS | M4-ben valódi outbox → stream → A/B index → search állításokra cserélendő |
| R10 – hiányos OpenAPI | Az új keresési végpont csak teljes request/response/problem sémával kész |

Az M4 technikai keresőútja nem függ a valódi Authentik-belépéstől, mert a
keresés publikus, a workerek pedig nem HTTP-actort használnak. A teljes
„belépés → publikálás → keresés” demóhoz viszont az M2 L2 út és az R04/R07/R08/R11
identity-javítások is szükségesek. Enélkül az M4 keresőintegráció külön
bizonyítható, a milestone teljes üzleti demója nyitva marad.

**Külső előfeltétel:** a két Meilisearch image elérhető vagy két külső, külön
tesztpéldány URL-je megadható. Egyetlen példány két indexe nem bizonyítja az A/B
szolgáltatáskiesést. Valódi Meilisearch nélkül nincs M4-kapu; in-memory fake csak
az osztályozási és megszakítási egységpróbákhoz használható.

**Nem M4 feladata:** teljes PostgreSQL-alapú reindex, tartós `rebuilding`
állapot, stream/snapshot catch-up határ, 1000 tartalmas baseline-mérés és
operátori karantén-replay. Ezek az M5 feladatai. M4 elkészíti az adapter- és
állapotfelületeket, amelyekre M5 épít.

## 2. Rögzített M3–M4 szerződés

| Terület | M4 döntés |
| --- | --- |
| Indexek | Két külön Meilisearch-példány, mindkettőn ugyanaz a konfigurálható index UID; alapérték `contents` |
| Projekció | `id`, `title`, `summary`, `category`, `tags`, `aggregateVersion`; slug és mediaAssetId nincs benne |
| Igazságforrás | Minden eseménynél új PostgreSQL-olvasás. Aktuálisan published → upsert; withdrawn/draft/hiányzó → delete |
| Worker | A és B külön durable, külön kliens és külön állapot; indexenként egyszerre pontosan egy esemény és egy Meili-task |
| ACK | Csak sikeres Meilisearch-task után. Task enqueued/processing állapot, HTTP 202 vagy puszta task UID nem siker |
| Redelivery | Az upsert és delete idempotens. Indexírás utáni, ACK előtti leállás ismételt művelethez, de helyes végállapothoz vezet |
| Hosszú task | A worker a consumer `ack_wait` lejárta előtt periodikusan `working()` jelzést küld; következő üzenetet nem kér le |
| Átmeneti hiba | Helyben retry 1, 2, 4, 8, 16, majd 30 másodperccel, ±20% jitterrel; ugyanaz az in-flight üzenet blokkolja az adott index sorrendjét |
| Poison message | Érvénytelen JSON/eseményséma vagy eseményhez kötött végleges projekcióhiba karanténba kerül; eredeti ACK csak a karantén PubAck után |
| Konfigurációs hiba | Meili 401/403, eltérő indexbeállítás vagy hibás klienskonfiguráció worker-halt; nem karantén és nem csendes fallback |
| Keresési fallback | A → B legfeljebb egy-egy 1 másodperces próbával. Üres A-találat nem hiba. Hálózat/timeout/429/5xx fallback; validációs vagy auth/config hiba nem |
| Nyilvános eredmény | Meili csak rendezett ID-listát ad. A válaszmezők és a publikáltság egy PostgreSQL-lekérdezésből származnak |
| Readiness | `/health/ready` továbbra is csak PostgreSQL. Meili/worker állapot a keresési válaszban és processing-statusban látszik |

## 3. Indexszerződés és bootstrap

### 3.1 Index és dokumentum

A két külön példányon ugyanaz az index UID használható, mert a példányok
névtere különálló. Teszt és smoke futás egyedi UID-t kap, például
`contents_m4_<runId>`; a normál alapérték `contents`.

```ts
type SearchProjectionV1 = {
  id: string;
  title: string;
  summary: string;
  category: ContentCategory;
  tags: string[];
  aggregateVersion: number;
};
```

Published projekciónál a summary és category már a publikálási minimum miatt
nem null. A primary key `id`. A beállítások:

| Beállítás | Érték | Indok |
| --- | --- | --- |
| `searchableAttributes` | `title`, `tags`, `summary` | D08 szerinti fontossági sorrend |
| `filterableAttributes` | `category` | Opcionális kategória-egyezőség |
| `displayedAttributes` | `id` | A publikus mezők soha nem a keresőből kerülnek a válaszba |
| `sortableAttributes` | üres | M4-ben nincs felhasználói rendezés |
| primary key | `id` | Stabil content UUID |

A Meilisearch beállításmódosítás és dokumentumírás aszinkron task. A bootstrap
nem tekinti sikernek a 202 választ: minden létrehozó/beállító task végállapotát
ellenőrzi. Az index nem kerül olvasási routingba és a worker nem kér üzenetet,
amíg a beállítások nincsenek sikeresen alkalmazva és visszaolvasva.

Létező indexnél a bootstrap visszaolvassa a primary keyt és az M4 által kezelt
beállításokat. Eltérésnél nem indít automatikus teljes újraindexelést, hanem az
adott példányt `halted/config_mismatch` állapotba teszi. A beállítások
megváltoztatása az összes dokumentum újraindexelését indíthatja; ennek
koordinált kezelése M5. Üres, új index létrehozása idempotens.

### 3.2 Kliens- és szerververzió

Első kompatibilitási jelölt a hivatalos `meilisearch` JavaScript kliens pontosan
pinelt kiadása. A terv készítésekor az npm `0.62.0` verziót jelölt aktuálisnak,
és a csomag Meilisearch v1.x kompatibilitást vállal. A repo jelenlegi image
alapértéke `getmeili/meilisearch:v1.15`; az M4-01 spike a kiválasztott szerver
patch és a kliens együttműködését ellenőrzi Node 24/ESM alatt. A verziót csak
sikeres index-, settings-, task-, delete-, search- és hibakódpróba után rögzítjük
a package/lockfile-ban és a `VERSIONS.md`-ben. Image-digest csak registryből
ellenőrzött érték lehet.

Elsődleges technikai támpontok:

- [Meilisearch JavaScript quick start](https://www.meilisearch.com/docs/getting_started/sdks/javascript)
- [Searchable attributes](https://www.meilisearch.com/docs/capabilities/full_text_search/how_to/configure_searchable_attributes)
- [Settings API](https://www.meilisearch.com/docs/reference/api/settings/list-all-settings)
- [Meilisearch hibák](https://www.meilisearch.com/docs/reference/errors/overview)
- [NATS pull consumer és explicit ACK](https://docs.nats.io/learn/jetstream/pull-consumers)

## 4. Indexelési folyamat

### 4.1 Worker-életciklus

Egy generikus `SearchProjectionWorker` két példánya indul explicit
konfigurációval: `a/search-a-v1` és `b/search-b-v1`. Nem osztanak aktuális
üzenetet, task UID-t, retry-számlálót vagy állapotot. Egyik példány hibája nem
állítja meg a másikat.

Egy worker köre:

1. Biztosítja a NATS-kapcsolatot, a durable consumert és a sikeresen bootstrappolt
   saját Meili-indexet.
2. Pontosan egy üzenetet kér le. A következőt csak az előző ACK-ja vagy
   karanténba helyezése után kéri.
3. A nyers adatot JSON-ként és `contentEventV1Schema` szerint validálja.
4. Egy SQL-lekérdezéssel kiolvassa az aggregate aktuális állapotát és a
   projekciómezőket.
5. Published állapotnál teljes dokumentum-upsertet, minden más állapotnál
   ID-alapú delete-et kér. A historikus esemény payloadja nem választ műveletet.
6. Megőrzi a task UID-t, és ugyanazt a taskot pollolja `succeeded`, `failed` vagy
   `canceled` végállapotig. Poll-hálózati hiba nem hoz létre új taskot.
7. `succeeded` után ACK, állapotfrissítés és strukturált sikerlog következik.

Ha a taskbeküldés válasza elveszik a szerver általi elfogadás után, ugyanaz az
upsert/delete újra beküldhető. A művelet idempotens, a worker továbbra is csak
egy művelet befejezését várja egyszerre.

### 4.2 Aktuális állapot és verzió

Az esemény változási jelzés. Régi publish esemény replay-e egy időközben
withdrawn rekordnál delete-et eredményez. Duplikált esemény published rekordnál
ugyanazt az aktuális projekciót írja vissza. Az `aggregateVersion` az adatbázis
aktuális content-verziója, nem feltétlenül a régi esemény verziója.

A worker nem tart content sorzárat Meilisearch-hálózati hívás alatt. A DB-olvasás
és az index-task között újabb állapotváltozás történhet; annak későbbi eseménye
ugyanazon durable sorrendjében konvergálja az indexet. M4 ezt a soros
feldolgozással bizonyítja. Globálisan atomikus DB/index pillanatkép nem cél.

### 4.3 Taskvárakozás, heartbeat és leállás

Az M3 consumerkonfigurációt M4 explicit módon ellenőrzi: `ack_policy=explicit`,
`deliver_policy=all`, a megfelelő filter subject, valamint legalább 30 másodperces
`ack_wait`. A worker 10 másodpercenként `working()` jelzést küld, amíg DB-,
Meili-task- vagy retry-munka folyamatban van. A pontos értékek egy helyen,
milliszekundumból NATS nanoszekundumba konvertálva élnek.

Leálláskor új üzenetet már nem kér. Az aktuális művelet a közös shutdown grace
határig befejeződhet. Határidőnél az üzenet ACK nélkül marad, a Meili-kliens és a
NATS-kapcsolat megszakad; újraindításkor redelivery következik. A stop promise a
grace lejárta után ténylegesen visszatér, és régi workerloop mellett nem indulhat
új példány. Ez az R05 javításának M4-re is kötelező alkalmazása.

### 4.4 Retry és hibaosztályok

| Hiba | Kezelés |
| --- | --- |
| PostgreSQL/NATS/Meili hálózati hiba, timeout, Meili 429 vagy 5xx | Ugyanazon üzenet helyi retrya D08 backoffal; `working()` fenntartja a kézbesítést |
| Task `failed` belső/system átmeneti okkal | Ugyanaz a task már végleges; késleltetés után új idempotens indexművelet indul |
| Meili 401/403, hibás index UID, primary key vagy settings mismatch | Worker `halted`, nincs ACK, nincs karantén; operátori konfigurációjavítás kell |
| Érvénytelen JSON vagy v1 eseményséma | Karantén, majd az eredeti ACK-ja |
| Érvényes esemény, de a projekció dokumentuma tartós `invalid_request` hibát kap | Karantén `projection_rejected` kóddal, majd ACK |
| Karanténpublish hiba vagy ACK-timeout | Eredeti üzenet nem ACK-olható; a karanténpublikálás retryzik |

A retry-várakozást egy új CMS-esemény nem szakíthatja meg. Csak shutdown vagy a
retry saját határideje oldhatja fel; ezzel az R06-ban reprodukált retry-vihar nem
kerül át a fogyasztókba.

### 4.5 Karanténszerződés

A `poc.content.quarantine.v1` üzenet nem másolja automatikusan a teljes eredeti
payloadot, mert az eredeti már elérheti a stream 64 KiB-os határát. Az eredeti
üzenetet a stream és sequence azonosítja M5 célzott replayéhez:

```ts
type SearchQuarantineV1 = {
  quarantineId: string;
  schemaVersion: 1;
  failedAt: string;
  errorCode: 'invalid_json' | 'invalid_event_schema' | 'projection_rejected';
  originalEventId: string | null;
  originalStream: string;
  originalStreamSequence: number;
  originalSubject: string;
  durable: string;
};
```

Az `originalEventId` csak akkor null, ha a nyers üzenetből nem nyerhető ki
érvényes UUID; a stream sequence ekkor is kötelező locator. A quarantine publish
stabil msgID-ja a durable és az eredeti stream sequence kombinációja, így az ACK
elvesztése utáni ismétlés idempotens. A karanténüzenetben nincs token, API-kulcs,
adatbázis-URL vagy eredeti tartalmi payload. A és B ugyanazt a hibás üzenetet
külön karanténrekorddal jelölheti, mert külön durable feldolgozási állapotáról
van szó.

## 5. Publikus keresési API

### 5.1 Kérés- és válaszszerződés

```http
GET /catalog/search?q=<1..200>&category=<category>&limit=<1..100>&offset=<0..1000>
```

- `q`: kötelező, trim után 1–200 karakter.
- `category`: opcionális, a meglévő `CONTENT_CATEGORIES` egyike.
- `limit`: opcionális pozitív egész, alapérték 20, maximum 100.
- `offset`: opcionális nem negatív egész, alapérték 0, maximum 1000.
- Ismeretlen, többszörös vagy nem skalár query paraméter `422
  validation_failed`, a hibás mezők nevével.

```ts
type CatalogSearchView = {
  items: PublicContentView[];
  offset: number;
  limit: number;
  returned: number;
  estimatedTotalHits: number;
};
```

Az `estimatedTotalHits` az index válaszának becslése, ezért DB-szűrés és indexlag
miatt nagyobb lehet az `items` tényleges számánál. M4 nem tölt utána további
oldalakról; a rövidebb oldal a D08 dokumentált korlátja. A válasz nem árulja el,
hogy A vagy B szolgálta ki. A fallback forrása strukturált, titokmentes logban és
az integrációs teszt vezérelt kiesésében bizonyítható.

Az OpenAPI tartalmazza a négy query paraméter korlátait, a válasz teljes sémáját,
a public content mezőket, valamint a 401/422/503 problem+json válaszokat.
Token nélküli kérés megengedett; jelen lévő, de érvénytelen Authorization fejléc
az M2 szabálya szerint továbbra is 401.

### 5.2 A → B routing és hibaosztályozás

Egy kérés legfeljebb egy A- és szükség esetén egy B-search hívást végez,
példányonként 1000 ms időkorláttal.

| A eredménye | Következő lépés |
| --- | --- |
| Siker, akár nulla találattal | Nincs fallback; DB-hidratálás |
| Hálózati hiba, timeout, 429, 5xx | Egyszeri B-próba |
| 400/422 vagy más hibás klienskérés | Nincs fallback; `503 search_unavailable`, diagnosztikai kód a logban |
| 401/403 vagy bootstrap/config mismatch | Nincs fallback; `503 search_unavailable`, konfigurációs diagnosztika |
| A M5-ben `rebuilding`/nem routolható | Közvetlen B-próba; az állapot tartósságát M5 valósítja meg |

Ha B átmeneti hibával szintén meghiúsul, a válasz `503 search_unavailable`. A
problem body nem tartalmaz URL-t, API-kulcsot, nyers Meili-hibát vagy indexnevet.
Meili-kiesés nem rontja a CMS írását és a `/health/ready` állapotát.

### 5.3 PostgreSQL-visszaellenőrzés

A Meili-hitből csak az ID használható. Egyetlen SQL-lekérdezés:

- csak `status='published'` sorokat ad vissza;
- opcionális kategóriaszűrésnél az aktuális DB-kategóriát is ellenőrzi;
- kizárólag a publikus mezőket választja ki;
- az eredményt az eredeti Meili ID-sorrendbe rendezi vissza alkalmazásoldalon.

Ismeretlen, withdrawn vagy időközben más kategóriába került találat kimarad. Ha
a DB nem elérhető, nincs indexadatból adott részleges válasz: a szokásos
`503 dependency_unavailable` következik.

## 6. Konfiguráció és megfigyelhetőség

### 6.1 Konfiguráció

A meglévő `FEATURE_SEARCH=on` kötelezővé teszi a két URL-t és kulcsot. M4 után a
feature bekerül az implementált adapterek listájába. A konfiguráció:

| Kulcs | Kötelező / alapérték |
| --- | --- |
| `MEILI_A_URL`, `MEILI_A_KEY`, `MEILI_B_URL`, `MEILI_B_KEY` | feature on mellett kötelező |
| `MEILI_INDEX_UID` | `contents` |
| `SEARCH_TIMEOUT_MS` | 1000; pozitív egész |
| `MEILI_TASK_TIMEOUT_MS` | 30000 egy pollolási szakaszra; timeout nem jelent tasksikert |
| `MEILI_TASK_POLL_MS` | 100 |
| `SEARCH_CONSUMER_WORKING_MS` | 10000, az ellenőrzött ack_wait alatt |

A Meili URL-ek abszolút `http(s)` URL-ként validálódnak listen előtt. A kulcsok
nem üresek, de értékük hibaüzenetbe vagy logba nem kerül. A két URL-nek
különbözőnek kell lennie; azonos endpointtal az A/B-kiesési állítás nem
bizonyítható, ezért ez konfigurációs hiba. `FEATURE_SEARCH=off` mellett a route
stabil `503 search_unavailable` választ ad, worker és Meili-hálózati hívás nincs.

### 6.2 Worker- és indexállapot

A `processing-status` meglévő válasza indexenként bővül:

```ts
indexes: {
  a: {
    state: 'off' | 'bootstrapping' | 'idle' | 'processing' | 'retrying' | 'halted';
    durable: string;
    inFlightEventId: string | null;
    lastAckedAt: string | null;
    lastErrorCode: string | null;
    reachable: boolean | null;
  };
  b: { /* ugyanaz */ };
}
```

A broker oldali `consumers[].pending` megmarad. Az in-flight üzenet nincs benne
biztosan a pending számban, ezért a két adat külön jelenik meg. Broker- vagy
Meili-kiesés nem teszi 500-zá a végpontot. Pending outbox mellett is 200-at ad,
ezzel az R02 regresszióját lezárja.

Logesemények: `search_worker_started`, `search_event_received`,
`search_task_submitted`, `search_task_succeeded`, `search_worker_retry`,
`search_event_quarantined`, `search_worker_halted`, `search_fallback`,
`search_worker_stopped`. Eseménylogban eventId/correlationId/index alias és
stabil hibakód szerepelhet; payload, keresőkifejezés, API-kulcs, URL és nyers
hibaobjektum nem.

## 7. Fejlesztési csomagok, függőségek és becslés

| # | Csomag | Gazda / review | Függőség | Nettó becslés | Kész eredmény |
| --- | --- | --- | --- | --- | --- |
| M4-00 | M0–M3 review-kapu javításai | érintett korábbi gazda / kölcsönös review | review R01/R02/R05/R06/R09/R12 | 420 p | Izolált full smoke, működő processing-status, korlátos shutdown és valódi backoff |
| M4-01 | Meili kliens- és szerver-spike, config | Codex / Claude | E01 vagy külső A/B | 90 p | Node 24 ESM kliens, URL/task/error API ellenőrzés, pontos pin |
| M4-02 | Indexadapter és bootstrap | Claude / Codex | M4-01 | 120 p | Két kliens, create/verify settings, taskvárás, mismatch halt |
| M4-03 | DB-projekció és hidratálás | Codex / Claude | M1 | 90 p | Aktuális projekció, published-ID lekérés, Meili-sorrend megőrzése |
| M4-04 | Két soros JetStream worker | Claude / Codex | M3, M4-02, M4-03 | 180 p | Külön durable/state, working heartbeat, taskhoz kötött ACK, shutdown |
| M4-05 | Retry, hibaosztályozás és karantén | Claude / Codex | M4-04 | 120 p | D08 backoff, stabil quarantine envelope/msgID, ACK-sorrend |
| M4-06 | Publikus keresési API és fallback | Codex / Claude | M4-02, M4-03 | 150 p | Query-validálás, A→B routing, DB-szűrt válasz, teljes OpenAPI |
| M4-07 | Processing-status és log | Claude / Codex | M4-04…06, R02 | 60 p | A/B workerállapot, in-flight és hibakód, titokmentes log |
| M4-08 | Izolált teszt-infrastruktúra | Codex / Claude | M4-01…05 | 90 p | Egyedi DB/stream/indexek, A/B stop/start, task- és ACK-megszakítási pontok |
| M4-09 | M4-T01–T26 integrációs próbák | Codex / Claude | M4-06…08 | 240 p | Valódi PostgreSQL + JetStream + két Meili ellen, nem fake sikerrel |
| M4-10 | `smoke:full` és `demo:m4` | Codex / Claude | M4-09, M2 L2 a teljes demóhoz | 120 p | Izolált teljes út, A/B kiesés és catch-up, PASS/PENDING/FAIL külön |
| M4-11 | Compose, runbook, verziók, evidence | Claude / Codex | M4-10 | 75 p | Image/client pin, használati útmutató, `M4-EVIDENCE.md`, M5 átadás |

**M4 saját munka:** 1335 perc = 22 óra 15 perc.  
**Előfeltétel-javításokkal együtt:** 1755 perc = 29 óra 15 perc.

A milestone-terv M4-re három, napi körülbelül hatórás munkanapot, azaz 18 órát
adott. Az M4 saját részletes becslése 4 óra 15 perccel, a kötelező korábbi
javításokkal együtt 11 óra 15 perccel lépi túl ezt. A D01 szerint a helyes
eljárás az ütemezés módosítása; a hibapróbák, az adatizoláció vagy a második
index nem hagyható el. M5 kezdete csak a tényleges M4-kapu után rögzíthető újra.

**Tervezett fájlterületek:** `src/search/` (`search.module.ts`,
`meili.adapter.ts`, `index-bootstrap.ts`, `projection.ts`, `projection.worker.ts`,
`worker.state.ts`, `search.service.ts`, `catalog-search.controller.ts`,
`quarantine.ts`), `src/messaging/` (consumer- és quarantine publish felület),
`src/content/content.repository.ts` (projekció és ordered public hidratálás),
`src/contracts/` (search HTTP és quarantine v1 séma),
`src/ops/processing-status.controller.ts`, `src/config.ts`, `src/app.module.ts`,
`test/integration/search.test.ts`, `test/support/meili.ts`,
`test/support/search-app.ts`, `scripts/demo-m4.mjs`, `scripts/smoke-full.mjs`,
`compose.yaml`, `.env.example`, `README.md`, `VERSIONS.md` és
`docs/external-access.md`.

Új üzleti tábla vagy M4-migráció nem szükséges. A workerállapot M4-ben
memóriában él; a tartós reindexállapot M5 kijelölt migrációs döntése. Ha az
implementáció során mégis tartós M4-adat válik szükségessé, azt külön indokolt
migráció és rollback/upgrade próba nélkül nem vezetjük be.

## 8. Ellenőrzési terv

Az integrációs csomag saját `_test` adatbázist, egyedi NATS stream/durable
neveket és mindkét Meili-példányon egyedi index UID-t használ. A cleanup csak
ezeket törölheti. Ha a tesztfolyamat SIGKILL miatt nem takarít, a futás elején
kiírt runId alapján kizárólag a saját erőforrások távolíthatók el.

| # | Helyzet | Ellenőrizendő eredmény |
| --- | --- | --- |
| M4-T01 | Feature on hiányzó/hibás/azonos Meili URL-lel vagy hiányzó kulccsal | Listen előtti, kulcsot néven nevező, titokmentes konfigurációs hiba |
| M4-T02 | Üres A és B bootstrap, majd ismételt bootstrap | Index, primary key és settings taskjai sikeresek; ismétlés nem indít fölösleges settings taskot |
| M4-T03 | Létező index eltérő searchable/filterable/displayed beállítással | Az érintett worker halted/config_mismatch; beállítás és dokumentumok nem íródnak át |
| M4-T04 | Publish esemény feldolgozása | Mindkét indexben a DB aktuális projekciója jelenik meg, helyes aggregateVersionnel |
| M4-T05 | Withdraw esemény feldolgozása | Mindkét indexből törlés; delete-task success előtt nincs consumer ACK |
| M4-T06 | Withdraw után régi publish replay | A worker az aktuális DB miatt delete-re konvergál; tartalom nem válik újra kereshetővé |
| M4-T07 | Duplikált esemény és leállás task success után, ACK előtt | Redelivery után idempotens végállapot; ACK csak a második feldolgozás végén |
| M4-T08 | Hosszú enqueued/processing task | Periodikus `working()`, nincs redelivery és nincs következő indexművelet a task success előtt |
| M4-T09 | Meili task failed / 429 / 5xx / hálózati timeout | Nincs ACK; mért 1/2/4/8/16/30 s ±20% retry, új CMS wake nem rövidíti le |
| M4-T10 | B leáll, közben publish és withdraw | A halad és kereshető; B durable lemarad, visszatérés után saját sorrendjében felzárkózik |
| M4-T11 | A leáll | B worker halad; publikus olvasás A hibája után B-ről sikeres |
| M4-T12 | Érvénytelen JSON és hibás v1 séma | Durable-önként quarantine PubAck, majd eredeti ACK; stabil locator és hibakód |
| M4-T13 | Karanténstream nem elérhető vagy tele | Eredeti üzenet ACK nélkül marad; nincs csendes átugrás |
| M4-T14 | Search query határok és ismeretlen/többszörös mezők | 422 a pontos mezőnevekkel; nincs Meili-hívás |
| M4-T15 | Magyar cím, ékezetes címrészlet, summary és tag keresése | A dokumentált minta megtalálható; ékezet nélküli viselkedés megfigyelve és jegyzőkönyvezve |
| M4-T16 | Kategóriaszűrés | Meili-filter és DB aktuális kategória együtt érvényesül |
| M4-T17 | A sikeres, de üres találatot ad | Nincs B-fallback; 200 üres lista |
| M4-T18 | A timeout/hálózat/429/5xx | Pontosan egy B-próba; sikerre 200 |
| M4-T19 | A 400/401/403 vagy config mismatch | Nincs B-fallback; 503 search_unavailable, titokmentes diagnosztika |
| M4-T20 | A és B egyszerre kiesik | Search 503; admin draft/publish és ready a saját szükséges függőségei szerint tovább működik |
| M4-T21 | Withdrawn tartalom stale találatként B-ben marad | DB-szűrés eltávolítja; részlet 404; nyilvános mező nem szivárog |
| M4-T22 | Meili-sorrendben stale/hiányzó ID-k vannak | Megmaradó elemek sorrendje stabil, oldal rövidebb lehet, estimatedTotalHits indexbecslés |
| M4-T23 | DB kiesik sikeres Meili-találat után | Nincs indexmezőből fallback válasz; 503 dependency_unavailable |
| M4-T24 | Token nélkül és jelen lévő hibás tokennel végzett keresés | Token nélkül publikus; hibás Authorization minden publikus route-on 401 |
| M4-T25 | Processing-status normál, pending és egyindex-kiesés mellett | 200, A/B state/in-flight/lastAck/error + durable pending; nincs dátumkonverziós 500 |
| M4-T26 | Full smoke friss izolált környezetben | Saját fixture ténylegesen eljut mindkét indexbe, search működik, withdraw után kiszűrődik; idegen outbox/index változatlan |

Az M0–M3 regressziós tesztek ugyanebben a kapuban futnak. A tesztnevek száma nem
helyettesíti az állításokat: a jegyzőkönyv minden M4-Txx sorhoz konkrét tesztet,
parancsot és megfigyelt eredményt rendel.

## 9. Smoke, demó és futási bizonyíték

### 9.1 `smoke:full`

A runner az M0 smoke folyamatgazdai mintáját követi:

- saját ideiglenes konfiguráció, adatbázis, Compose-projektnév/volume, NATS
  stream/durable és A/B index UID;
- dinamikus hostportok és lekérdezett tényleges címek;
- saját application child, korlátos HTTP/task feltételvárás és finally cleanup;
- külső mód csak explicit `SMOKE_EXTERNAL_*` célokkal, eldobható DB markerrel és
  egyedi indexprefixszel;
- normál `DATABASE_URL` nem implicit smoke-cél;
- PASS, FAIL és PENDING külön eredmény; PENDING nem növeli a pass számlálót.

Az M4-szakasz valódi fixture-t publikál, megvárja mindkét consumer ACK-ját és
mindkét Meili task sikerét, keres A-n, leállítja A-t és B fallbacket igazol,
majd withdraw után stale indexhelyzetből is DB-szűrt eltűnést bizonyít. A runner
az általa nem létrehozott outbox-sorokhoz, streamekhez és indexekhez nem nyúl.

### 9.2 `demo:m4`

A teljes demó:

1. Publisher access tokennel draft létrehozás és publikálás.
2. A commit időpontjának rögzítése; mindkét index kereshetőségének megvárása.
3. Cím-, summary-, tag- és kategóriakeresés, majd nyilvános részletlekérés.
4. B leállítása; új tartalomváltozás mellett A továbbhalad.
5. A leállítása/B visszaindítása; fallback és B catch-up.
6. Visszavonás úgy, hogy az egyik indexben még stale hit marad; az API DB-szűrése
   és a részlet 404 bizonyítása.
7. Mindkét index helyreállítása és azonos végállapot ellenőrzése.

Valódi access token hiányában a keresőút külön demója lefuthat explicit
teszt-assemblyvel, de az eredmény `M2 L2 pending`, nem teljes M4 business demo.

Az `M4-EVIDENCE.md` rögzíti a Node/npm, PostgreSQL, NATS, Meili image és kliens
verzióját, a futtatott parancsokat, a runId-kat, az M4-Txx eredményeket, a magyar
keresési megfigyelést és a publish→A/B kereshetőség egyedi demóidejét. A formális
p50/p95/max mérés M5-é.

## 10. Lezárási lista és M5-átadás

- [ ] A két index bootstrapja task-sikerrel igazolt és konfigurációjuk azonos. (T02–T03)
- [ ] Published aktuális állapot upsertet, minden más állapot delete-et eredményez mindkét példányon. (T04–T06)
- [ ] Task success előtti ACK lehetetlen; redelivery és duplikáció helyes végállapothoz vezet. (T07–T09)
- [ ] A és B külön kiesése nem állítja meg az egészséges workert, a visszatérő durable felzárkózik. (T10–T11)
- [ ] Poison message csak igazolt karanténpublikálás után ACK-olódik; DLQ-hibánál megmarad. (T12–T13)
- [ ] A publikus API validál, helyesen fallbackel és nem használja a kereső metaadatait válaszforrásként. (T14–T23)
- [ ] Public auth-határ, processing-status és titokmentes log megfelel a szerződésnek. (T24–T25)
- [ ] A full smoke izolált, valódi keresőutat bizonyít, és nem jelöl pending lépést PASS-nak. (T26)
- [ ] Build, lint, teljes M0–M4 regresszió, smoke és demo a pinelt Node-verzión sikeres.
- [ ] A dokumentáció külön jelöli az implementált, szimulált, pending és még nem mért eredményeket.

**M5-nek átadandó:** indexenként indítható/leállítható worker; index bootstrap- és
healthfelület; aktuális DB-projekció és verzió; durable pending/in-flight/lastAck
állapot; karantén locator és célzott replayhez szükséges eredeti stream sequence;
izolált A/B hibainjektálás; valamint a search routing olyan felülete, amelyből a
tartós `rebuilding` állapotú index kizárható. M5 ehhez ad tartós reindexállapotot,
snapshot/catch-up határt, teljes importot, konzisztencia-összevetést és formális
mérést.

## 11. Kockázatok és rögzített eljárás

| Kockázat | Eljárás |
| --- | --- |
| Egy Meili 202 választ tasksikernek tekintünk | Minden settings/upsert/delete művelet task UID-ját végállapotig ellenőrizzük; külön T08/T09 |
| NAK delay miatt későbbi esemény megelőzi a hibásat | Átmeneti hibánál helyi in-flight retry és `working()`; a worker nem kér következő üzenetet |
| Régi publish replay visszahoz withdrawn tartalmat | Mindig aktuális DB-állapotból projektálunk; T06 és T21 |
| Stale indexből adminmező kerül a publikus válaszba | `displayedAttributes=['id']`, majd explicit public DB-projekció; T21–T23 |
| A fallback elrejti az auth/config hibát | 401/403/4xx nincs fallback, stabil 503 és diagnosztika; T19 |
| Két „index” ugyanazon Meili-folyamatban hamis redundanciát mutat | A és B külön endpoint kötelező; azonos URL startuphiba |
| Full smoke fejlesztői adatot módosít | Saját `_test` DB és egyedi stream/index kötelező; normál DATABASE_URL nincs implicit fallback |
| Meili settings módosítás reindexet indít | Létező eltérésre halt; automatikus settings átírás nincs, koordinált reindex M5 |
| Karanténwrapper túllépi a 64 KiB-ot | Nyers payload helyett stream/sequence locator; eredeti ACK csak quarantine PubAck után |
| A részletes munka túllépi a milestone-keretet | Ütemezés módosul; a második index, hibapróba vagy adatizoláció nem hagyható el |

## 12. Következő lépés

Az első végrehajtási csomag az M4-00 kapu R01/R02 javítása és az M4-01
Meilisearch-kompatibilitási spike. Ezek után a bootstrap és a DB-projekció
párhuzamosítható, majd a worker, retry/karantén, olvasási API, megfigyelhetőség és
az integrációs bizonyítás következik. Új üzleti döntési kör nem szükséges: a
projekció, query-határok, fallback, ACK, retry és karantén alapértékeit a D08 és
ez a terv rögzíti.
