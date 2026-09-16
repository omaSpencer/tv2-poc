# M5 – Helyreállás és bizonyítékok: részletes implementációs terv

2026-09-16 · Codex · Rögzített terv.

**Státusz: tervezett, még nincs implementálva.** Ez a dokumentum az alap-PoC
utolsó kötelező milestone-jának megvalósítási szerződése. Az M5 csak akkor kész,
ha a teljes M0–M5 út valódi PostgreSQL 17, Authentik, JetStream és két külön
Meilisearch-példány ellen reprodukálható, a kötelező hibapróbák sikeresek, és a
mért eredmények az `M5-EVIDENCE.md` jegyzőkönyvben szerepelnek. Tervezett,
szimulált vagy külső előfeltétel miatt pending eredmény nem számít teljesítésnek.

Kiindulópont: [README](README.md), [milestone-terv](MILESTONES.md),
[fázisterv](PHASES.md), [döntésnapló](DECISIONS.md), az
[M4-terv](M4-IMPLEMENTATION.md), az [M2-jegyzőkönyv](M2-EVIDENCE.md), valamint
az [M0–M3 code review](M0-M3-CODE-REVIEW.md).

## 1. Szállítandó eredmény és belépési kapu

M5 végén az A és B keresőindex egymástól függetlenül, PostgreSQL-ből teljesen
újraépíthető. Az érintett index a művelet teljes ideje alatt kimarad az olvasási
routingból, a másik index kiszolgálhat. Az import konzisztens DB-snapshotból
készül, majd a megőrzött durable consumer egy rögzített JetStream sequence-ig
behozza a snapshot után szükséges változásokat. Az index csak sikeres
Meilisearch-taskok, pontos DB/index id+verzió összevetés és tartós állapotváltás
után kerülhet vissza az olvasásba.

Az M5 emellett egyetlen reprodukálható zárócsomagba rendezi a relay-, consumer-,
retry-, karantén-, identity- és függőségkiesési próbákat, valamint az 1000
szintetikus tartalmas és 100 publish/withdraw ciklusos fejlesztői baseline-t.

| Belépési feltétel | Kötelező állapot |
| --- | --- |
| M0–M1 | Izolált adatbázis-kezelés, atomi content/audit/outbox írás, reprodukálható core smoke |
| M2 | L1 kész; az L2 valódi Authentik belépés, refresh és provideradat rendelkezésre áll a záró identity-próbákhoz |
| M3 | Stabil eventId, relay PubAck-szabály, CONTENT stream, két durable és karanténstream működik |
| M4 | Két soros worker, task sikeréhez kötött ACK, A→B fallback, DB-hidratálás és indexenkénti állapot működik |
| Infrastruktúra | PostgreSQL 17, Authentik, NATS JetStream és két külön Meilisearch-példány pinelt verzióval indítható |
| Review-kapu | Az M4 1.1 szakaszában örökölt R01/R02/R05/R06/R09/R10/R12 hibák lezártak |

Az M5 implementációs részei fejleszthetők részben kész M4 mellett, de a milestone
nem zárható le egyetlen nyitott korábbi kapuval sem. Az M2 L2 jelenlegi pending
állapota különösen fontos: helyi JWKS-mock nem bizonyít valódi signing-key
rotációt vagy új login viselkedést.

**Nem M5 feladata:** termelési HA, automatikus többpéldányos reindex scheduler,
mentés/DR, Kubernetes-operátor, folyamatos nagyterhelés, végleges SLO, SIEM vagy
teljes observability stack. Az M5 fejlesztői baseline-t és operátori runbookot
ad; termelési kapacitást vagy hibazóna-függetlenséget nem állít.

## 2. Rögzített M4–M5 szerződés

| Terület | M5 döntés |
| --- | --- |
| Reindex egysége | Egyszerre pontosan egy index (`a` vagy `b`); globális operátori lock tiltja a párhuzamos A/B reindexet |
| Routing | Minden nem `ready` állapotú index kimarad; ha egyik sem routolható, a keresés `503 search_unavailable` |
| Worker | Az érintett worker befejezi az in-flight Meili-taskot és ACK-ot, majd új üzenet kérése nélkül pausál |
| Snapshot | PostgreSQL `REPEATABLE READ READ ONLY` tranzakció, keyset lapozással; az összes importoldal ugyanazt a snapshotot látja |
| Határ | Snapshot előtt rögzített stream sequence, snapshotban rögzített outbox high-water, majd relay-drain után rögzített catch-up stream sequence |
| Import | Ugyanazon Meili-példány staging indexe, M4 settings-szerződéssel; batchenként task success szükséges |
| Aktiválás | A staging és a logikai live index atomikus Meili index swapja; a swap task sikerét is meg kell várni |
| Catch-up | A megőrzött durable consumer a live UID-ra dolgozik, amíg az ACK-floor el nem éri a rögzített határt |
| Ellenőrzés | Rövid publish/withdraw írási korlát alatt pontos DB/index `id + aggregateVersion` halmazegyezés |
| Megszakítás | A tartós állapot nem lesz `ready`; újraindítás után az index kimarad a routingból és új teljes futás szükséges |
| Karantén | Nincs automatikus replay. Operátori inspect, validált célzott replay vagy DB-alapú tartalomjavítás készül |
| Mérés | 1000 szintetikus tartalom, 100 publish/withdraw ciklus; p50/p95/max és hibaarány, numerikus SLO nélkül |
| Hibapróba | Legfeljebb 5 perc alatt helyreáll vagy a próba failed/incomplete; nincs csendes kihagyás |

## 3. Tartós reindexállapot és migráció

### 3.1 `search_index_control`

Új migráció két, előre ismert sort hoz létre `a` és `b` aliasra. Ez operációs
állapot, nem üzleti tartalom. A route és a worker ugyanebből az igazságforrásból
dolgozik.

| Oszlop | Típus / szabály | Jelentés |
| --- | --- | --- |
| `index_alias` | text PK, `a` vagy `b` | Stabil alkalmazásoldali indexnév |
| `phase` | text, kötött érték | `ready`, `draining`, `importing`, `swapping`, `catching_up`, `verifying`, `failed` |
| `desired_worker_state` | text | `running` vagy `paused` |
| `run_id` | uuid nullable | Az aktuális/utolsó teljes reindex azonosítója |
| `owner_id` | text nullable | A CLI folyamat nem titkos, véletlen példányazonosítója |
| `owner_heartbeat_at` | timestamptz nullable | Diagnosztika; nem önmagában lock |
| `worker_paused_at` | timestamptz nullable | A worker drain-nyugtája |
| `snapshot_stream_sequence` | bigint nullable | A DB-snapshot első olvasása előtt mért `S0` |
| `outbox_high_water` | bigint nullable | A snapshotban látható legnagyobb outbox-sorszám `H` |
| `catch_up_stream_sequence` | bigint nullable | A relay-drain után mért `S1`, később a verify-határ `S2` |
| `imported_documents` | integer not null default 0 | Sikeresen befejezett import dokumentumszám |
| `expected_documents` | integer nullable | A snapshot published darabszáma |
| `last_error_code` | text nullable | Stabil, titokmentes operátori kód |
| `started_at`, `updated_at`, `completed_at` | timestamptz | Életciklus és mérés |

`phase='ready'` esetén `desired_worker_state='running'`, `completed_at` nem null,
és nincs aktív owner. A migráció a meglévő, M4-ben kész indexeket `ready`
állapotban veszi fel; friss adatbázisban ugyanígy indulnak, mert az M4 bootstrap
felel az üres index létrehozásáért. Ha bootstrap/config mismatch van, a worker
M4 szerinti `halted` állapota ettől függetlenül kizárja a routingot.

A `processing-status` a tartós phase/határok és az M4 runtime workerállapot
összefésült nézetét adja. Ellentmondásnál a szigorúbb állapot nyer: a DB szerint
nem ready index akkor sem routolható, ha a folyamat memóriája még `idle`.

### 3.2 Monoton outbox high-water

Az `outbox_event` új `outbox_sequence bigint` mezőt kap adatbázis-szekvenciából,
egyedi és nem null megszorítással. A migráció a korábbi sorokat determinisztikusan
`occurred_at, event_id` sorrendben tölti fel, majd az új események a DB-szekvencia
következő értékét kapják. A sorszám nem eseményverzió és nem JetStream sequence;
csak egy rögzített DB-high-water kijelölésére szolgál.

A relay sikeres PubAck után a meglévő `delivered_at` mellett elmenti a kapott
`stream_sequence` értéket is. Az update továbbra is idempotens: már rögzített,
azonos stream sequence ismétlése sikeres; eltérő sequence duplikált újraküldésnél
diagnosztikaként naplózható, de az első igazolt kézbesítés marad a soron.

A sequence értékekben lehet rés visszagörgetett tranzakció miatt; folytonosságot
nem feltételezünk. Egy korábban sorszámot foglaló, később commitoló tranzakció
vagy bekerül a rögzített stream-határba, vagy a worker normál, határ utáni
eseményként dolgozza fel. A correctness nem épül időbélyeg- vagy UUID-sorrendre.

### 3.3 Lock és worker-handshake

A reindex CLI PostgreSQL session advisory lockot kér a teljes műveletre. Egy
globális kulcs biztosítja, hogy A és B ne épüljön egyszerre; az indexenkénti
kulcs a téves dupla indítást is kizárja. Lockhiány azonnali, jól olvasható
`reindex_already_running` hiba, nem várakozó második futás.

A CLI alapértelmezésben csak akkor indul, ha a másik index `ready + reachable`.
Ha egyik index sem routolható, az első helyreállítás explicit
`--allow-search-outage --confirm-target=<database-name>` kapcsolókkal engedhető;
ilyenkor a keresés dokumentáltan 503 marad, amíg az első index vissza nem kerül.
Az engedmény nem oldja fel a globális lockot és nem indíthat két reindexet.

A CLI egy tranzakcióban `draining` phase-re és `paused` desired state-re vált.
Ettől az index azonnal kiesik a routingból. Az M4 worker minden új fetch előtt
és retry-határnál ellenőrzi a desired state-et. Már futó DB-/Meili-műveletét és
ACK-ját befejezi, majd `worker_paused_at` értékkel nyugtáz; új üzenetet nem kér.

Ha nincs élő worker, a CLI csak akkor léphet tovább, ha a runtime heartbeat
hiányzik vagy a dokumentált 15 másodperces küszöbnél régebbi, és nincs ismert
in-flight esemény. Aktív, de a grace alatt nem pausáló workerre a reindex
`worker_drain_timeout` állapotban megáll. A CLI nem öli meg a folyamatot.

### 3.4 Konfigurációs alapértékek

| Kulcs | Alapérték / szabály |
| --- | --- |
| `REINDEX_BATCH_SIZE` | 500; 1–5000 közötti egész |
| `REINDEX_DRAIN_TIMEOUT_MS` | 30000 |
| `REINDEX_IMPORT_TIMEOUT_MS` | 300000 a teljes snapshot/import szakaszra |
| `REINDEX_TASK_POLL_MS` | az M4 `MEILI_TASK_POLL_MS` értéke |
| `REINDEX_OWNER_HEARTBEAT_MS` | 5000 |
| `REINDEX_WORKER_STALE_MS` | 15000; nagyobb a heartbeatnél |
| `REINDEX_VERIFY_TIMEOUT_MS` | 30000 a teljes exclusive verify-szakaszra |
| `CONTENT_WRITE_BARRIER_WAIT_MS` | 5000; publish/withdraw lock-várakozás felső korlátja |

Minden idő pozitív egész és listen/CLI-indulás előtt validált. Publish/withdraw
tranzakcióban `SET LOCAL lock_timeout` érvényesíti a barrier várakozási korlátját;
timeoutkor a tranzakció változtatás nélkül rollbackel és stabil
`503 dependency_unavailable` választ ad. A reindex verifier saját teljes
határideje rövidebb nem lehet a content lock-várakozásnál. A CLI cél- és timeout
adatai logolhatók, kulcsok és URL-ek nem.

## 4. A teljes reindex algoritmusa

### 4.1 Snapshot- és stream-határ

Az alábbi sorrend kötelező egy `run_id` alatt:

1. Advisory lock, másik index `ready + reachable` ellenőrzése, majd az érintett
   index `draining` és routingból kizárása.
2. Worker drain és pause megvárása; a folyamatban lévő Meili-tasknak success vagy
   dokumentált failure végállapota kell legyen.
3. CONTENT stream info lekérése; aktuális `last_seq` rögzítése `S0` értékként.
4. `REPEATABLE READ READ ONLY` tranzakció indítása. Az első lekérdezés rögzíti a
   snapshotot, benne `H = max(outbox_sequence)` és a published darabszámot.
5. Ugyanebben a tranzakcióban UUID szerinti keyset lapozással olvassuk az M4
   teljes keresőprojekcióját. Offset lapozás nincs.
6. A snapshot-tranzakció lezárása után megvárjuk, hogy minden látható
   `outbox_sequence <= H` sorhoz legyen PubAck-kal igazolt `delivered_at` és
   `stream_sequence`.
7. Új stream info adja `S1` értékét. Ha `S1 > S0`, akkor a streamnek meg kell
   őriznie az `S0 + 1 … S1` szükséges tartományt. Retention gap esetén a futás
   `stream_history_gap` hibával megáll; részleges catch-up nem minősül sikernek.

Az import alatt commitolt publish/withdraw esemény nincs veszélyben. Ha a DB
snapshot már látta, az import tartalmazza és a catch-up legfeljebb idempotensen
megismétli. Ha a snapshot még nem látta, az esemény vagy `S1`-ig bekerül a
catch-upba, vagy későbbi normál workerüzenetként érkezik.

A read-only snapshot Meilisearch-hálózati várakozás alatt nyitva marad. Ez a
PoC 1000 dokumentumos méreténél elfogadott, de időkorlátos: a CLI beállít
`statement_timeout` és teljes import timeout értéket, a runbook pedig jelzi a
hosszú MVCC snapshot korlátját. A DB-transaction nem tart content sorzárat.

### 4.2 Staging index és atomikus csere

A staging UID alakja `<liveUid>__rebuild__<runIdNodash>`, és kizárólag az adott
Meili-példányon jön létre. A CLI:

1. törli ugyanennek a runId-nak a félbehagyott staging indexét, ha a törlési
   task sikeresen befejezhető;
2. létrehozza `id` primary key-jel;
3. alkalmazza és visszaolvassa az M4 searchable/filterable/displayed settingset;
4. alapérték szerint 500 dokumentumos batchenként teljes replace műveletet kér;
5. minden task UID-t `succeeded` végállapotig követ, és csak ezután növeli az
   `imported_documents` számlálót;
6. összeveti a staging stats dokumentumszámát a snapshot darabszámával;
7. taskként kéri a staging/live index atomikus swapját, majd megvárja a success
   állapotot.

A swap után a logikai live UID az új snapshotot tartalmazza, a staging UID alatt
pedig a korábbi live index marad. Ezt a CLI a teljes verify sikeréig nem törli,
így diagnosztikára vagy explicit operátori rollbackre rendelkezésre áll. A
reindex nem hajt automatikus rollbacket, mert a közben beérkező catch-up már az
új live indexre kerülhetett. Siker után a régi staging index törlése külön
task, amelynek hibája warning és takarítási tétel, nem teszi újra hibássá az
ellenőrzött live indexet.

A Meilisearch swap atomi az indexpárra, de maga is aszinkron task; a 202 válasz
nem aktiválási bizonyíték. Technikai támpontok:

- [Meilisearch index swap](https://www.meilisearch.com/docs/reference/api/indexes/swap-indexes)
- [Nagy adathalmaz importja](https://www.meilisearch.com/docs/capabilities/indexing/how_to/import_large_datasets)
- [Index statisztika](https://www.meilisearch.com/docs/reference/api/indexes/get-stats-of-index)
- [PostgreSQL 17 Repeatable Read](https://www.postgresql.org/docs/17/transaction-iso.html)

### 4.3 Catch-up, pontos összevetés és visszaengedés

A swap task sikere után a worker ugyanazzal a megőrzött durable consumerrel és
ugyanazzal a logikai live UID-val indul újra. A phase `catching_up`. A worker az
M4 szabályai szerint továbbra is a PostgreSQL aktuális állapotából upsertel vagy
töröl, és csak task success után ACK-ol.

Az első catch-up kapu akkor teljesül, ha:

- a consumer folytonosan feldolgozta az `S0 + 1 … S1` szükséges tartományt;
- az ACK-floor stream sequence elérte legalább `S1` értékét;
- nincs `S1`-hez vagy korábbi eseményhez tartozó helyi in-flight task;
- nincs worker `retrying`, `halted` vagy karanténpublish-függés.

Folyamatos forgalomnál az `S1` után érkező események nem tolják el a kaput a
végtelenbe. A worker feldolgozhatja őket is, de az elfogadás rögzített határhoz
kötött.

A pontos végső összevetéshez a publish/withdraw tranzakciók közös PostgreSQL
shared transaction advisory lockot vesznek fel. A reindex verifier rövid időre
exclusive lockot kér ugyanarra a kulcsra. Draft létrehozás és nem publikált
tartalom szerkesztése nem változtat indexet, ezért nem igényli ezt a lockot.

Az exclusive verify-szakasz:

1. megvárja a már futó publish/withdraw tranzakciókat;
2. rögzíti `H2` outbox high-watert, megvárja annak relay-kézbesítését, majd
   rögzíti `S2` stream sequence-et;
3. megvárja, hogy a worker ACK-floor elérje `S2`-t, majd újra pausálja a workert;
4. DB-ből és Meiliből lapozva kiolvassa a teljes `id + aggregateVersion`
   halmazt, és pontosan összeveti a countot, a hiányzó, extra és eltérő verziókat;
5. egyezéskor egy tranzakcióban `ready/running` állapotra vált, törli az aktív
   ownert és rögzíti a completion időt;
6. elengedi az írási korlátot, majd a worker normál üzemre áll.

Az exclusive szakasz alapértelmezett felső korlátja 30 másodperc. Timeout vagy
eltérés esetén az írási lock felszabadul, de az index `failed/paused` és routingon
kívül marad. A CMS-írás nem maradhat tartósan blokkolva. A másik index a teljes
folyamat alatt szolgálhat ki.

### 4.4 Megszakítás és újraindítás

A phase minden lépés előtt tartósan frissül. SIGTERM esetén a CLI nem kezd új
taskot, a már ismert taskot a közös grace határig követi, majd `failed` kóddal
kilép. SIGKILL vagy hosthiba esetén a nem ready állapot önmagában kizárja az
indexet. Az advisory lock a DB-kapcsolattal felszabadul, de a phase nem változik
automatikusan ready-re.

Új futás csak explicit ugyanarra az indexre kiadott reindex parancs lehet. Új
`run_id` készül és a teljes snapshot/import folyamat elölről indul; félbehagyott
importot nem folytatunk dokumentumszám alapján. A korábbi staging UID-k listázva
és csak a live/staging azonosság ellenőrzése után takaríthatók. Startupkor az
alkalmazás minden `draining…failed` sort routolhatatlannak és worker-pausednak
tekint.

## 5. Operátori parancsok és karanténkezelés

M5 nem ad destruktív HTTP admin-végpontot. Az operátori felület dokumentált CLI:

```text
npm run search:reindex -- --index=a
npm run search:reindex -- --index=b
npm run search:reindex -- --index=a --allow-search-outage --confirm-target=<database-name>
npm run search:reindex:status
npm run search:quarantine:inspect -- --sequence=<quarantine-stream-sequence>
npm run search:quarantine:replay -- --sequence=<quarantine-stream-sequence>
npm run search:repair-content -- --id=<content-uuid> --index=a|b|both
npm run baseline:m5 -- --output=<directory>
npm run demo:m5
```

A parancsok explicit konfigurációt és nem nulla exit kódot használnak pending,
failed, timeout vagy hibás argumentum esetén. Normál `DATABASE_URL`, stream vagy
index nem válhat implicit tesztcéllá. A reindex élesnek tűnő adatbázison kiírja
a célokat és `--confirm-target=<database-name>` egyezést kér; automatizált izolált
tesztben a futásazonosítós marker helyettesíti ezt.

### 5.1 Célzott karantén-replay

Az inspect parancs a karanténrekord locatorából beolvassa az eredeti CONTENT
stream üzenetet, kiírja a stabil hibakódot, eventId-t, subjectet és sequence-et,
de nem logolja a nyers payloadot. A replay csak akkor engedélyezett, ha:

- az eredeti streamüzenet retention miatt még elérhető;
- a nyers adat a jelenlegi v1 eseménysémával már validálható;
- az aggregateId létezik vagy a jelenlegi állapota szabályos delete-et indokol;
- az operátor megad egy jegyzőkönyvi indokot.

A replay új, stabil `replay:<quarantineId>` msgID-val visszapublikálja az eredeti
valid eseményt a CONTENT subjectre, PubAck után pedig rögzíti a replay sequence-et
az operátori kimenetben. Mindkét durable megkaphatja; az aktuális DB-projekció
miatt ez idempotens.

`invalid_json` vagy továbbra is hibás séma nem replayelhető változtatás nélkül.
Ilyenkor a `search:repair-content` explicit content UUID alapján a DB aktuális
állapotát projektálja a kijelölt indexre ugyanazzal a task-success szabállyal.
Ha az aggregate nem azonosítható, teljes indexreindex szükséges. A parancs nem
hamisít új audit/outbox üzleti eseményt. Karanténüzenet automatikus törlése M5-ben
sincs; a retention és a jegyzőkönyv őrzi a bizonyítékot.

## 6. Kötelező helyreállási hibapróbák

A hibainjektálás kizárólag teszt-assemblyben elérhető, injektált barrier/hook
felületekkel. Normál buildben nincs crash HTTP-végpont, különleges fejléc vagy
`NODE_ENV` alapján aktiválható jogosultságkerülő út.

| Próba | Injektálási pont | Elvárt végállapot |
| --- | --- | --- |
| Relay ACK-rés | JetStream PubAck után, `delivered_at` előtt folyamatleállítás | Outbox pending marad, újraküldés azonos eventId-val; indexek helyesek |
| Consumer ACK-rés | Meili task success után, consumer ACK előtt leállítás | Redelivery és idempotens újraírás; durable végül ACK-ol |
| Régi publish replay | Withdraw ACK-ja után korábbi publish esemény újraküldése | Aktuális DB miatt delete; tartalom nem válik láthatóvá |
| Átmeneti Meili-hiba | 429/5xx/timeout több retrylépcsőn át | Mért D08 backoff, nincs ACK és nincs sorrendcsere |
| Poison message | Invalid JSON/séma, majd projection reject | Karantén PubAck után eredeti ACK; locator és hibakód visszakövethető |
| Karanténkiesés | DLQ stream elérhetetlen vagy tele | Eredeti üzenet ACK nélkül marad |
| Retention gap | Reindex közben szükséges sequence eltávolítása | `stream_history_gap`, nincs ready állapot |
| Reindex crash | Import, swap és catch-up fázisban külön SIGKILL | Újraindítás után routingból kizárt; új teljes futás állítja helyre |
| A/B kiesés | A, B, majd mindkettő külön leállítása | Egészséges index szolgál; mindkettő nélkül search 503, CMS írható |

Minden próba saját runId-val, izolált adatbázissal, streammel, durable nevekkel
és index UID-kkel fut. A runner feltételre vár, nem vak időzítésre. Öt perc után
failed/incomplete eredményt és diagnosztikai snapshotot ír, majd korlátosan
takarít.

## 7. Identity zárópróbák

Az M5 átveszi az M2 végleges, valódi Authentik bizonyítását. Ezek nem mock
tesztek:

1. Három valódi identitás Authorization Code + PKCE belépése és refresh.
2. Publisher token kulcsának cache-be töltése, majd signing-key rotáció.
3. Új `kid` megismerése a dokumentált cooldown után; a régi és új kulcs
   átfedési viselkedésének rögzítése.
4. IdP/JWKS kiesés ismert, cache-elt kulccsal: meglévő, még érvényes access token
   működik, readiness 200 marad.
5. Ugyanez ismeretlen `kid`-del: nincs bypass; az eredmény a rögzített
   401/503-osztályozás szerint történik.
6. Kiesés alatt új login és refresh nem minősül backend-sikernek; a provider
   tényleges hibája és a kliens eredménye a jegyzőkönyvbe kerül.
7. Csoportváltozás után refresh: az új token új jogokat hordoz, a régi token a
   lejáratáig a mért visszavonási ablak része.

A teszt rögzíti az issuer, audience, JWKS URI, tokenélettartam, cacheMaxAge,
cooldownDuration és a provider/image verzióját, de tokent, authorization code-ot,
jelszót, client secretet vagy teljes JWKS-választ nem. E01–E05 hiánya esetén a
próbák pendingek, és az M2/M5 milestone nyitva marad.

## 8. Megfigyelhetőség és baseline mérés

### 8.1 Processing-status és napló

A védett processing-status indexenként megjeleníti:

- tartós phase, runId, started/updated/completed idő;
- S0/S1/S2 és outbox high-water, ahol már ismert;
- expected/imported documents;
- worker runtime state, in-flight eventId és task UID;
- durable pending, ACK-floor stream sequence és legöregebb ismert feldolgozatlan
  esemény kora;
- reachability, lastErrorCode és route eligibility.

Outbox pending és oldest-age külön marad. A broker pending + in-flight becslés,
nem globális tranzakciós snapshot. A végpont broker-, Meili- vagy identity
providerkiesés miatt sem dob nyers `500`-at; a rendelkezésre álló résznézetet
adja `ops:read` jogosultsággal.

A záró logaudit canary tokeneket, API-kulcsokat, adatbázis-jelszót, client
secretet és jellegzetes keresőkifejezést használ, majd a teljes strukturált
logot ellenőrzi. Engedélyezett az eventId, correlationId, aggregateId, index
alias, runId, phase, stream sequence, task UID és stabil hibakód. Tiltott a
Bearer token, cookie, jelszó, kulcs, teljes payload és nyers provider-válasz.

### 8.2 Fixture és mérési módszer

A `baseline:m5` saját izolált környezetében hoz létre 1000 szintetikus tartalmat
magyar címekkel, summarykkal és tagekkel. A fixture az üzleti service/API utat
használja, így audit és outbox is keletkezik; közvetlen SQL insert nem mérési
gyorsítás. A seed és a mérés külön szakasz, hogy a kezdeti feltöltés ne keveredjen
a ciklusmintába.

Alapértékek:

| Paraméter | Érték |
| --- | --- |
| Tartalom | 1000, determinisztikus seedből |
| Publish/withdraw ciklus | 100 teljes pár, külön tartalmakon |
| Írói párhuzamosság | 4, konfigurálható és kötelezően jegyzőkönyvezett |
| Poll periódus | 50 ms mérő kliensben; nem termék-konfiguráció |
| Lag mintavétel | 1 másodperc |
| Egyedi mérési timeout | 30 másodperc; timeout hibaminta |
| Hibapróba timeout | 5 perc |
| Percentilis | nearest-rank p50 és p95, továbbá min/max és darabszám |

A commitidő a sikeres publish/withdraw HTTP-válasz beérkezésének monotonic
időpontja. A kereshetőség indexenként közvetlen diagnosztikai Meili-queryvel
mérendő, hogy az A→B fallback ne rejtse el a célpéldányt. A publikus API útját
külön funkcionális próba méri. Az órák ugyanabban a runner folyamatban futnak;
falióra-eltérés nem kerül a latencybe.

Rögzítendő sorozatok:

- publish → találat A és B példányon külön;
- withdraw → eltűnés A és B példányon külön;
- outbox pending és oldest-age idősort;
- indexenként durable pending + in-flight és oldest unfinished age idősort;
- egy index kiesése utáni catch-up időt a visszaindítástól a rögzített határig;
- A és B teljes reindexidejét a `draining` kezdettől `ready` commitig;
- request-, task- és próbahibák számát/osztályát.

A nyers eredmény JSON, az összegzés Markdown. Mindkettő tartalmazza a runId-t,
git commitot és dirty jelzést, gép OS/arch/CPU/memória adatait, Node/npm,
PostgreSQL/NATS/Meili/Authentik és klienskönyvtár-verziókat, Compose limiteket,
adatmennyiséget, párhuzamosságot és konfigurált timeoutokat. Nincs numerikus
pass/fail SLO; a correctness és a hibátlan mintagyűjtés kötelező.

## 9. Fejlesztési csomagok, függőségek és becslés

| # | Csomag | Gazda / review | Függőség | Nettó becslés | Kész eredmény |
| --- | --- | --- | --- | --- | --- |
| M5-00 | M0–M4 belépési kapu | korábbi milestone-gazdák | M4 lezárási lista, M2 L2 hozzáférés | korábbi terv szerint | Nyitott előfeltétel nem kerül M5-ként újrabecslésre |
| M5-01 | Reindex/outbox migráció és repository | Codex / Claude | M1, M3 | 120 p | Tartós A/B control, outbox high-water és stream sequence |
| M5-02 | Worker drain és routing-koordináció | Claude / Codex | M4, M5-01 | 150 p | DB desired state, pause handshake, advisory lock, route exclusion |
| M5-03 | Snapshot- és stream-határ | Codex / Claude | M5-01…02 | 180 p | Repeatable-read pager, S0/H/S1, relay-drain és gap detection |
| M5-04 | Staging import és atomikus swap | Claude / Codex | M4 adapter, M5-03 | 180 p | Batch task success, stats, swap, staging lifecycle |
| M5-05 | Catch-up, verify barrier és összevetés | Codex / Claude | M5-02…04 | 210 p | S1/S2 ACK-floor, rövid write barrier, teljes id+verzió egyezés |
| M5-06 | Operátori CLI-k és karantén-runbook | Codex / Claude | M5-03…05 | 150 p | Reindex/status/inspect/replay/repair parancsok biztonságos célválasztással |
| M5-07 | Hibainjektálási tesztkeret | Codex / Claude | M3, M4 | 150 p | Relay/consumer barrier, crashpontok, retention-gap és titokmentes diagnosztika |
| M5-08 | Valódi Authentik zárópróbák | Claude / Codex | M2 L2, E01–E05 | 150 p | Rotáció, ismert/ismeretlen kulcs, IdP-kiesés és visszavonási ablak |
| M5-09 | Fixture és baseline recorder | Codex / Claude | M5-05 | 180 p | 1000 + 100 ciklus, latency/lag/reindex JSON és Markdown |
| M5-10 | M5-T01–T32 integrációs próbák | Codex / Claude | M5-01…09 | 300 p | Izolált teljes helyreállási és biztonsági regresszió |
| M5-11 | Friss környezet, smoke és `demo:m5` | Codex / Claude | M5-10 | 180 p | Teljes normál és hibás üzleti út, A/B reindex és identity demo |
| M5-12 | Evidence, runbook és prioritásos backlog | Claude / Codex | M5-11 | 120 p | M5-EVIDENCE, recovery guide, átadás és következő kör |

**M5 saját munka:** 2070 perc = 34 óra 30 perc. A korábbi milestone-ok nyitott
implementációja és az Authentik külső hozzáférés biztosítása nincs újra beleszámolva.

A milestone-terv M5-re két, napi körülbelül hatórás munkanapot, azaz 12 órát
adott. A részletes becslés ezt 22 óra 30 perccel túllépi. A D01 alapján az
ütemezést módosítani kell; a pontos reindexhatár, a valódi identity-próba, a
hibainjektálás vagy a mérési jegyzőkönyv nem hagyható el. Az eredeti közös két
nap tartalék a korábbi milestone-ok ismert túlfutása mellett önmagában nem fedi
ezt a különbözetet.

**Tervezett fájlterületek:** `migrations/` és `src/schema.ts`,
`src/search/reindex/` (`control.repository.ts`, `coordinator.ts`,
`snapshot-reader.ts`, `boundary.ts`, `importer.ts`, `verifier.ts`, `cli.ts`),
az M4 `projection.worker.ts`, `search.service.ts` és `meili.adapter.ts`,
`src/outbox/outbox.repository.ts`, `src/messaging/jetstream.adapter.ts`,
`src/content/content.service.ts` (shared verify lock),
`src/ops/processing-status.controller.ts`, `src/config.ts`, `src/main.ts`,
`scripts/quarantine.mjs`, `scripts/baseline-m5.mjs`, `scripts/demo-m5.mjs`,
`test/integration/reindex.test.ts`, `test/integration/recovery.test.ts`,
`test/integration/identity-live.test.ts`, `test/support/fault-barriers.ts`,
`test/support/baseline.ts`, `package.json`, `.env.example`, `README.md`,
`VERSIONS.md`, `docs/recovery.md`, `docs/external-access.md` és
`M5-EVIDENCE.md`.

## 10. Ellenőrzési terv

| # | Helyzet | Ellenőrizendő eredmény |
| --- | --- | --- |
| M5-T01 | Migráció friss és M4-adatot tartalmazó DB-n | A/B control sor, egyedi outbox sequence és visszatölthető migráció; üzleti adat nem vész el |
| M5-T02 | Két reindex parancs egyszerre | Pontosan egy kap lockot; a másik `reindex_already_running`, nem módosít állapotot |
| M5-T03 | Reindex A indítása aktív keresésekkel | A azonnal kiesik routingból, B szolgál; nincs félkész A-válasz |
| M5-T04 | Workernek taskja van drain kéréskor | Task és ACK befejeződik, utána pause; következő üzenetet nem kéri le |
| M5-T05 | S0/H/S1 normál forgalomban | Határok tartósan rögzülnek, snapshot minden oldala ugyanazt az állapotot látja |
| M5-T06 | 1000 dokumentumos staging import | Settings és minden batch task success; imported=expected és stats count egyezik |
| M5-T07 | Publish és withdraw az import alatt | Snapshot + catch-up után a jelenlegi DB-állapot jelenik meg, esemény nem vész el |
| M5-T08 | Staging/live swap | Task success előtt nincs catch-up/ready; success után a live UID az új snapshot |
| M5-T09 | Import- vagy swap-task failed/canceled | Phase failed, routing kizárt, durable nem veszít eseményt |
| M5-T10 | `S0+1…S1` retention gap | `stream_history_gap`; részleges index nem kap ready állapotot |
| M5-T11 | S1 után folyamatos új írások | A rögzített határ elérhető; nem várunk végtelen nulla pendingre |
| M5-T12 | Verify barrier alatt publish/withdraw kérés | Bounded várakozás után folytatódik; barrier release mindig megtörténik |
| M5-T13 | Hiányzó, extra vagy rossz verziójú indexdokumentum | Pontos mismatch lista/összegzés, failed állapot, nincs routing |
| M5-T14 | SIGKILL importing/swapping/catching_up fázisban | DB phase megmarad, restart után index kizárt és worker paused |
| M5-T15 | Félbehagyott futás újraindítása | Új runId és teljes új import; régi staging biztonságosan felismerhető/takarítható |
| M5-T16 | A teljes reindexe, majd B teljes reindexe | Mindig legalább a másik szolgál; végül mindkét id+verzió halmaz egyezik a DB-vel |
| M5-T17 | Mindkét index nem routolható | Search 503; alapból reindex-refusal, explicit outage-confirmationnel az egyik helyreállítható; CMS írható |
| M5-T18 | Relay PubAck után, DB mark előtt crash | Azonos eventId redelivery/duplicate mellett helyes végállapot és delivered mark |
| M5-T19 | Consumer task success után, ACK előtt crash | Redelivery, idempotens projekció, végül ACK és helyes durable állapot |
| M5-T20 | Withdraw után régi publish replay | DB aktuális állapota miatt delete; public search és detail nem mutatja |
| M5-T21 | Átmeneti hiba több retrylépcsőn | 1/2/4/8/16/30 s ±20%, sorrend megtartva, nincs idő előtti ACK |
| M5-T22 | Poison message | Karantén PubAck, locator, eventId/hibakód, majd eredeti ACK durable-önként |
| M5-T23 | Karanténstream tele/elérhetetlen | Eredeti nincs ACK-olva, retry/állapot megfigyelhető |
| M5-T24 | Karantén inspect/replay/repair | Valid replay új msgID-val sikerül; invalid schema replay megtagadva; DB-repair taskhoz kötött |
| M5-T25 | Valódi Authentik signing-key rotáció | Új kid megismerhető, régi/új token viselkedése és cooldown dokumentált |
| M5-T26 | IdP/JWKS kiesés ismert és ismeretlen kulccsal | Cache-elt ismert token működik; ismeretlen nincs bypass; ready 200 |
| M5-T27 | Live/ready/processing-status minden függőségállapotban | Dokumentált 200/503 és authmátrix; részállapot nyers 500 nélkül |
| M5-T28 | Canary secretekkel teljes normál és hibaút | Event/correlation/runId követhető; token, key, password, payload nincs logban |
| M5-T29 | Baseline fixture | Pontosan 1000 tartalom és 100 teljes cycle, determinisztikus seed, izolált erőforrások |
| M5-T30 | Baseline recorder | A/B publish és withdraw p50/p95/max/error, lag/outbox/catch-up/reindex adatok hiánytalanok |
| M5-T31 | Teljes indulás friss környezetből | Pinelt függőségek, migráció, Authentik, NATS, A/B Meili, app, smoke és demo dokumentáltan indul |
| M5-T32 | Teljes M0–M5 regresszió és evidence audit | Minden állítás konkrét parancshoz/eredményhez kötött; pending nem pass |

Az integrációs teszt képes mesterségesen rövid retentiont használni T10-hez, de
a normál konfigurációs defaultot nem írja át. Az időzítési állítások fake timerrel
egységszinten és valós órával legalább egy integrációs próbában is bizonyítandók.

## 11. Smoke, záródemó és bizonyíték

### 11.1 `smoke:full`

A záró smoke friss, eldobható, futásazonosítós környezetet hoz létre. Nem használ
implicit fejlesztői DB-t, streamet vagy indexet. Kötelező szakaszai:

1. migráció és valamennyi dependency readiness;
2. valódi tokenes publisher út;
3. draft → publish → A/B search → withdraw;
4. NATS-kiesés és outbox-helyreállás;
5. A és B külön kiesése/felzárkózása;
6. A reindex közben B-ről kiszolgálás, közben új publish/withdraw, majd pontos
   A-egyezés; ezután szimmetrikusan B;
7. health/status és titokmentes log ellenőrzése;
8. finally cleanup kizárólag a saját runId erőforrásaira.

Az Authentik interaktív login külön előkészített tesztidentitást igényelhet. A
runner ilyenkor explicit token-inputot vagy dokumentált PKCE helper eredményt
fogad; token hiányában az identity szakasz és a teljes smoke pending, nem pass.

### 11.2 `demo:m5`

A 30–45 perces bemutató rövidített, de valódi üzleti és helyreállási út:

1. Valódi publisher login, publikálás, A/B keresés és correlation követés.
2. A leállítása: B fallback; A visszaindítása és catch-up.
3. Consumer ACK-rés reprodukciója és helyes redelivery.
4. A teljes reindexe staging/swap/catch-up lépésekkel, miközben B kiszolgál és
   új publish/withdraw történik.
5. Verify barrier alatt írások rövid szüneteltetése, pontos id+verzió egyezés és
   A visszaengedése.
6. Poison message karantén és inspect; egy javítható célzott repair.
7. Signing-key rotáció és IdP-kiesés ismert kulccsal.
8. Baseline összegzés megnyitása, korlátainak kimondása.

### 11.3 `M5-EVIDENCE.md`

A jegyzőkönyv minden M5-Txx sorhoz rögzíti a parancsot, kezdőállapotot,
beavatkozást, elvárt és megfigyelt eredményt, runId-t, időtartamot és a
helyreállás ellenőrzését. Külön táblázatban szerepel:

- verzió- és környezetleltár;
- M0–M5 regressziós eredmény;
- identity L2 és kulcsrotáció;
- A/B reindex fázisidők és határértékek;
- baseline p50/p95/max/hibaarány;
- megvalósított, szimulált, tervezett, pending és nem tesztelt állítások;
- ismert korlátok és prioritásos következő backlog.

Nyers log vagy mérési fájl csak akkor linkelhető, ha nem tartalmaz secretet és a
reprodukcióhoz szükséges. A kézzel szerkesztett összegzés nem helyettesíti a
gépileg előállított raw JSON-t.

## 12. Lezárási lista és átadás

- [ ] A tartós reindexállapot, outbox high-water és stream sequence migráció friss és upgrade adatbázison működik. (T01)
- [ ] A/B egyszerre nem építhető, az érintett index minden nem ready fázisban kimarad a routingból. (T02–T04)
- [ ] Snapshot, staging import, swap és rögzített catch-up határ közben érkező írásokkal együtt helyes. (T05–T11)
- [ ] A bounded verify barrier után a DB és az index teljes id+verzió halmaza egyezik. (T12–T13)
- [ ] Megszakadt reindex nem kerül automatikusan routingba; új teljes futással helyreállítható. (T14–T17)
- [ ] Relay/consumer crash, régi replay, retry és karantén végállapota bizonyított. (T18–T24)
- [ ] Valódi Authentik rotáció és IdP-kiesés nem nyit jogosulatlan hozzáférést. (T25–T26)
- [ ] Health, védett status, correlation és titokmentes log teljes úton ellenőrzött. (T27–T28)
- [ ] Az 1000 + 100 baseline hiánytalan raw és összesített eredményt ad, SLO-állítás nélkül. (T29–T30)
- [ ] Friss környezetből a teljes regresszió, smoke és záródemó reprodukálható. (T31–T32)
- [ ] A recovery runbook és a prioritásos backlog review-zható, minden pending elem név szerint szerepel.

**Átadandó:** backend futtatási útmutató; identity és search konfiguráció;
normál és hibaút demó; indexreindex, karantén és függőségkiesés recovery runbook;
M5 evidence és raw baseline; migrációs/upgrade utasítás; verzióleltár; valamint
prioritásos backlog legalább security hardening, backup/DR, production HA,
kapacitás/SLO, observability és az opcionális M6 média/playback kör számára.

## 13. Kockázatok és rögzített eljárás

| Kockázat | Rögzített eljárás |
| --- | --- |
| DB-snapshot és stream-határ között esemény vész el | S0/H/S1 protokoll, relay-drain, szükséges streamtartomány ellenőrzése és durable catch-up |
| Közvetlenül a live indexet ürítjük | Staging import és task-successhez kötött atomikus swap |
| Folyamatos írás miatt sosem nulla a lag | Rögzített S1/S2 határ; az utána érkező esemény normál forgalom |
| Verify közben új publish változtatja a halmazt | Rövid, bounded PostgreSQL exclusive advisory barrier a publish/withdraw shared lockjaival |
| Barrier miatt a CMS tartósan áll | 30 másodperces felső korlát és kötelező finally unlock; hiba esetén index marad kint, írás folytatódik |
| Crash után fél index routolható | Tartós phase az első lépés előtt; kizárólag `ready` routolható |
| Régi staging indexet live-ként törlünk | UID/runId és swapállapot ellenőrzése; automatikus globális wildcard cleanup nincs |
| Karantén replay újra poison | Aktuális séma validálása; invalid adatnál explicit DB-projekció vagy teljes reindex |
| Baseline termelési ígéretnek látszik | Környezet és korlátok kötelezőek; nincs numerikus SLO vagy TV2-méretezési állítás |
| Mock identityt valódi rotációnak tekintjük | M5-T25/T26 kizárólag valós Authentik L2; hiány pending és nyitott milestone |
| Hibainjektáló hook bekerül normál buildbe | Csak DI teszt-assembly, build-artifact regressziós ellenőrzés |
| M5 túllépi a kétnapos keretet | Ütemezés módosul; reindex correctness, identity és evidence nem hagyható el |

## 14. Következő lépés

Az első végrehajtási csomag az M5-00 belépési kapu auditja, majd az M5-01
migráció és az M5-02 worker/routing handshake. Ezután külön egységként építhető
az S0/H/S1 snapshotprotokoll és a staging importer, majd integrálható a swap,
catch-up és verify barrier. A hibainjektálási keretnek a koordinátorral együtt
kell készülnie, mert az ACK- és crash-rések utólagos, forráskód-szintű imitálása
nem elfogadható bizonyíték. Az identity L2 és a baseline csak a működő teljes
környezetben zárható, de a runner és a jegyzőkönyv sémája korábban elkészíthető.
