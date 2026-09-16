# M3 – Tartós eseményút: részletes implementációs terv

2026-09-15 · Claude · Rögzített terv.

**Státusz: implementálva; a code review javításai átvezetve.** A checklist a
`M3-EVIDENCE.md` jegyzőkönyv szerint ellenőrzött. A [M0–M3 code review](M0-M3-CODE-REVIEW.md)
R01, R02, R05, R06, R09 és R12 megállapításai javítva, regressziós tesztekkel
([javítási jegyzőkönyv](M0-M3-REVIEW-FIXES.md)). Az M2 identity L1 szinten kész,
L2 (valódi Authentik) nyitott: a `processing-status` jogosultsági próbák (T12–T13)
továbbra is a teszt-assembly actor injektálásával futnak; a valódi Bearer + bekapcsolt
relay + pending processing-status összekötött út L2 után zárható.

Kiindulópont: [README](README.md), [milestone-terv](MILESTONES.md), [fázisterv](PHASES.md), [döntésnapló](DECISIONS.md), [M0-terv](M0-IMPLEMENTATION.md), [M1-terv](M1-IMPLEMENTATION.md), [M2-terv](M2-IMPLEMENTATION.md) és az [M0–M1 futtatási jegyzőkönyv](M0-M1-EVIDENCE.md).

## 1. Szállítandó eredmény és belépési feltételek

M3 végén az M1-ben tranzakcionálisan rögzített outbox-esemény eljut a JetStreambe, és kizárólag a publish ACK után jelölődik kézbesítettnek. A CMS írása változatlanul sikeres NATS-kiesés alatt is; a függő események a broker visszatérésekor sorrendben kézbesítődnek. A feldolgozás előrehaladása hitelesített végponton megfigyelhető.

| Szükséges eredmény | Miért szükséges? | Hol van? |
| --- | --- | --- |
| Outbox-séma és a `delivered_at IS NULL` függő index | A relay olvasási felülete | `src/schema.ts`, `migrations/0001_content_audit_outbox.sql` |
| `OutboxRepository.pending` és `pendingStats` | Kötegolvasás és a megfigyelési mérőszámok | `src/outbox/outbox.repository.ts` |
| Stabil `eventId` és az egyszer tárolt envelope-leképezés | A publish dedup azonosítója; nincs két eseményváltozat | `src/outbox/outbox.repository.ts`, `src/contracts/events.ts` |
| V1 eseményszerződés és generált JSON Schema | A drótformátum nem csúszhat el a tárolt sortól | `src/contracts/events.ts`, `contracts/events.v1.schema.json` |
| Stream-, subject-, durable- és karanténnevek | A topológia nem találgatásból jön | `src/contracts/events.ts` (`NATS_STREAM`, `NATS_SUBJECT`, `NATS_DURABLES`, `NATS_QUARANTINE_*`) |
| `MAX_EVENT_BYTES` | A D08 64 KiB-os üzenethatára | `src/contracts/events.ts` |
| `ops:read` permission és a route-mátrix M3-ra jelölt sora | A `processing-status` jogosultsága | `src/contracts/permissions.ts` |
| Verifikált actor és `PermissionGuard` | A `processing-status` hitelesített végpont | M2 eredménye |
| NATS full Compose definíció | A broker futtatható helyben | `compose.yaml`, `--profile full` |

**M2-függés, pontosan.** A relay maga nem függ az identitytól: nem HTTP-kérésből indul, és nem használ actort. Az M3 egyetlen identity-függő eleme a `GET /admin/processing-status`, amelyhez verifikált actor és `ops:read` kell. Ha M2 nem készült el, a relay és a T01–T11, T14–T19 próbák futtathatók, a T12–T13 nem. Az M3 lezárása viszont M2-t feltételez, mert a PHASES az eseményút megfigyelhetőségét a lezárási feltételek közé teszi.

**Külső előfeltétel.** A NATS image húzásához konténerregiszter-elérés kell (E01, nyitott). Az M0 smoke precedense szerint a próbák **külső broker módot** is támogatnak: megadott `NATS_URL` esetén a futtató nem indít Compose-szolgáltatást, hanem a megadott brokert használja. Valódi JetStream nélkül M3 **nem zárható le**: mock broker nem bizonyít publish ACK-ot, deduplikációt, kapacitáskorlátot és tartósságot, ezért M3-ban nincs az M2-höz hasonló kétszintű bizonyítás.

**Nem M3 feladata:** keresőindex-írás, fogyasztói ACK indexeredményhez kötése, karanténba publikálás, reindex, több relay, termelési redundancia és teljes NATS-adatvesztés utáni garancia. A durable fogyasztók elkészülnek és gyűlik bennük a lemaradás, de M3 egyetlen üzenetet sem nyugtáz.

## 2. Rögzített M1–M3 szerződés

| Döntés | M3 döntés | Átvétel / pontosítás |
| --- | --- | --- |
| D-M0-10 – topológia | `CONTENT` stream, `poc.content.changed.v1` subject, file storage, limits retention, R1 | A nevek a contracts konstansaiból jönnek, nem beégetett stringből |
| D08 – retention | 7 nap, 1 GiB, 1 000 000 üzenet, üzenetenként 64 KiB | A „korlát elérésekor új publikálás elutasítása” a `discard: new` policy, **nem** `old` – lásd 3.1 |
| D08 – ACK és dedup | Publish ACK timeout 5 másodperc; deduplikációs ablak 2 perc | A `msgID` az `eventId`; a dedup nem váltja ki az idempotens fogyasztót |
| D08 – retry | 1, 2, 4, 8, 16, majd 30 másodperc, legfeljebb ±20% jitter | Átmeneti hibánál nincs végleges eldobás; a backoff memóriában él, nincs migráció |
| D-M0-06 – esemény | Csak publish/withdraw bocsát ki eseményt, a tárolt envelope-ból | A relay nem gyárt új `eventId`-t és nem növel tartalomverziót |
| D-M0-03b – readiness | A NATS hálózati hibája nem rontja a `/health/ready` állapotot | A broker állapota a `processing-status` felelőssége |
| D-M0-08 / M2 – jogok | `GET /admin/processing-status` `ops:read`, azaz csak publisher | Editor és viewer `403`, hitelesítetlen `401` |
| D-M0-09 – hibák | A relay nem HTTP-úton hibázik; a `processing-status` a szokásos problem+json hibákat adja | Broker-hiba nem `500` a végponton, hanem jelzett állapot a válaszban |
| M1 – tranzakcióhatár | A tartalom tranzakciója nem vár brokerhívásra | A relay külön kapcsolaton, a sorzáron kívül fut |
| D01 – gazdák | Alkalmazásmag, adapter és tesztfuttató: Codex; Compose, runbook és megfigyelhetőség: Claude | Kölcsönös review |

### 2.1 Feldolgozási állapotok

A PHASES öt állapotot különböztet meg; M3 az első négyet bizonyítja, és a végpont pontosan ezeket jelenti:

| Állapot | Forrás | Mit bizonyít? |
| --- | --- | --- |
| Tranzakció rögzítve | `outbox_event` sor létezik | A tartalom és az esemény együtt mentve |
| Outbox függőben | `delivered_at IS NULL` | Kézbesítési igény, még nincs ACK |
| Publish ACK megvan | `PubAck` a JetStreamtől | A stream elfogadta az üzenetet |
| Outbox kézbesített | `delivered_at` kitöltve | A relay ACK után rögzítette |
| Fogyasztói ACK | M4 | **M3-ban soha nem következik be** |

A `pending` és a `oldest-age` becslés, nem globális tranzakciós pillanatkép; a D09 ugyanezt a fenntartást rögzíti a lag-mérésre.

## 3. Topológia és bootstrap

### 3.1 CONTENT stream

| Mező | Érték | Indok |
| --- | --- | --- |
| `name` | `CONTENT` | `NATS_STREAM` konstans |
| `subjects` | `["poc.content.changed.v1"]` | `NATS_SUBJECT` konstans |
| `storage` | `file` | Tartósság újraindítás után |
| `retention` | `limits` | Nem interest és nem workqueue: két független durable olvassa ugyanazt |
| `num_replicas` | `1` | Helyi PoC, R1 |
| `max_age` | 7 nap | D08. **Nanoszekundumban** adandó meg, a kliens `nanos()` segédjével |
| `max_bytes` | 1 GiB | D08 |
| `max_msgs` | 1 000 000 | D08 |
| `max_msg_size` | 65 536 | D08; a relay ennél nagyobb envelope-ot nem is próbál publikálni |
| `discard` | `new` | **A D08 döntés fordítása.** „Korlát elérésekor új publikálás elutasítása, az outbox függőben marad” – ezt a `new` adja; a `old` a régi üzeneteket dobná el, azaz csendes adatvesztést okozna |
| `duplicate_window` | 2 perc | D08; szintén nanoszekundum |

A `max_age` és a `duplicate_window` nanoszekundumos egysége a JetStream API szerződése, nem a kliens sajátossága; ezért a konfiguráció egyetlen helyen, milliszekundumból konvertálva készül. ([Create Stream API](https://docs.nats.io/reference/2.11/jetstream/api/stream/create))

### 3.2 Durable fogyasztók és karantén

Két pull consumer készül: `search-a-v1` és `search-b-v1`, `ack_policy: Explicit`, ugyanarra a subjectre szűrve, példányonként külön előrehaladással. M3 **létrehozza** őket, hogy a publikált események az első perctől gyűljenek, de egyetlen üzenetet sem kér le és nem nyugtáz. Ez szándékos: M4 induláskor nem veszít eseményt, és az M3 demója láthatóan mutatja a két független, növekvő lemaradást.

A `CONTENT_DLQ` stream (`poc.content.quarantine.v1`) szintén a bootstrap része, hogy M4 ne kelljen topológiát módosítson. M3 nem publikál bele; ha egy próba mégis nem üres karantént talál, az hiba.

### 3.3 Bootstrap-szabályok

- A topológia létrehozása **idempotens**: nem létező stream/consumer létrejön, létező változatlan marad.
- Létező, de a tervtől eltérő konfigurációt **nem írunk felül csendben**. Az eltérő mezők nevét strukturált hibába írjuk, és a relay nem indul el. Indok: a `max_age` vagy a `retention` csendes felülírása üzeneteket dobhat el.
- A bootstrap **nem indulási feltétel**. A NATS elérhetetlensége mellett az alkalmazás elindul, a `/health/ready` 200, a relay pedig újrapróbálkozik a D08 backoff szerint. Ezt a D-M0-03b írja elő.
- A teszt- és smoke-futtatók saját, egyedi stream- és durable-nevet kapnak a `NATS_STREAM`/`NATS_SUBJECT` környezeti felülbírálással, hogy egymást és a demókörnyezetet ne zavarják. Ez a két kulcs elsődlegesen erre való.

### 3.4 Kliens- és szerververzió

A hivatalos JavaScript kliens modularizált 3.x ága: `@nats-io/transport-node` a kapcsolathoz és `@nats-io/jetstream` a `jetstream()` / `jetstreamManager()` belépési pontokhoz. A régi egybecsomagolt `nats` 2.x a dokumentált visszalépési út, ha a modularizált ág valamelyik szükséges felületet nem adja; váltás esetén a teljes kliens-készlet együtt változik, az M0-02 spike mintájára.

A kliens 3.x és a **szerver** 2.x számozása független: nincs szükség „NATS 3” szerverre. A jelenlegi `NATS_IMAGE` alapérték `nats:2-alpine`; M3-10 feladata a pontos patchverzióra pinelés és – registryeléréssel – a digest rögzítése. ([nats.js JetStream](https://github.com/nats-io/nats.js/blob/main/jetstream/README.md))

## 4. A relay

### 4.1 Ciklus

Egyetlen relay példány fut, kizárólag `FEATURE_OUTBOX_RELAY=on` mellett. Egy kör:

1. Kötegolvasás a `delivered_at IS NULL` sorokra, **sorrendben** (4.2), a konfigurált kötegmérettel. Külön kapcsolaton, az üzleti tranzakción kívül.
2. Soronként: envelope összeállítása a tárolt oszlopokból ugyanazzal a leképezéssel, amit az `OutboxRepository` ír; validálás a v1 séma ellen; méretellenőrzés `MAX_EVENT_BYTES` ellen.
3. `publish(subject, payload, { msgID: eventId })`, ACK-ra várás a konfigurált időkorláttal.
4. ACK után – és **csak** utána – `UPDATE outbox_event SET delivered_at = now() WHERE event_id = $1 AND delivered_at IS NULL`. A feltételes `WHERE` miatt a kétszeri jelölés no-op.
5. A köteg végén: ha volt munka, azonnal új kör; ha nem, várakozás a lekérdezési intervallumig vagy egy belső ébresztésig.

**Ébresztés.** Egy sikeres tartalomtranzakció commitja után a folyamaton belüli relay ébresztőjelzést kap. Ez kizárólag késleltetéscsökkentő optimalizáció: a helyesség egyedül a lekérdezésen áll, elveszett jelzés legfeljebb egy intervallumnyi késést okoz. Az ébresztés nem a tranzakción belül, hanem a commit után történik.

**A zár alatt nincs hálózat.** A relay nem fut az M1 `SELECT … FOR UPDATE` sorzára alatt, és a tartalomtranzakció soha nem vár brokerhívásra. Ez az M1 4.1 szabálya, és M3 nem lazít rajta.

### 4.2 Sorrend

Az olvasás rendezése `occurred_at`, majd `aggregate_version`, majd `event_id`. A meglévő részleges index vezető oszlopa `occurred_at`, tehát az index továbbra is szolgál. Az `aggregate_version` azért kerül be másodikként, mert ugyanannak a tartalomnak a `published` és a `withdrawn` eseménye csak akkor megkülönböztethető biztosan, ha az azonos időbélyeg esetére is van determinisztikus döntő. Mikroszekundumos felbontás mellett az ütközés gyakorlatilag kizárt, de a sorrendet nem a valószínűségre alapozzuk.

**Hibára a köteg megáll**, nem ugrik a következő sorra. Így egy aggregate `published → withdrawn` párja nem fordulhat meg azzal, hogy az elsőre hiba jött, a másodikra nem. A sorrendgarancia a stream **beírási** sorrendjére vonatkozik; a két durable ettől függetlenül a saját tempójában halad.

### 4.3 Bizonytalan befejezés és deduplikáció

Ha a relay a publish ACK után, a jelölés előtt áll le, az újraindulás ugyanazt az eseményt ugyanazzal a `msgID`-val küldi el újra. A deduplikációs ablakon belül a JetStream ezt duplikátumnak ismeri fel, és a `PubAck` `duplicate` jelzéssel tér vissza. A relay a duplikátum-ACK-ot **sikernek** tekinti és kitölti a `delivered_at` mezőt: az üzenet igazoltan a streamben van.

Az ablakon túli újraküldés valódi második példányt hoz létre a streamben. Ezt nem tekintjük hibának, hanem a PoC dokumentált viselkedésének: a keresési fogyasztó az azonosítóból a PostgreSQL **aktuális** állapotát projektálja, ezért egy ismételt esemény ugyanarra a végállapotra vezet. A D08 kimondja, hogy a dedup nem helyettesíti az idempotenciát; ennek keresőoldali bizonyítása M4–M5 feladata.

### 4.4 Hibaosztályok

| Hiba | Kezelés |
| --- | --- |
| Kapcsolat nincs, publish időtúllépés, átmeneti szerverhiba | Retry a D08 ütemezés szerint, ±20% jitterrel; nincs végleges eldobás; az outbox függőben marad |
| Kapacitáskorlát (`discard: new` elutasítás) | Ugyanúgy újrapróbálható: a `max_age` lejártával felszabadulhat hely. A CMS írása közben zavartalan |
| Az envelope nem validál vagy meghaladja a 64 KiB-ot | **Végleges hiba.** A relay strukturált hibával megáll, nem jelöl kézbesítettnek és nem ugrik a következő sorra |
| Adatbázis elérhetetlen | A relay szünetel és újrapróbál; a `/health/ready` ettől függetlenül a saját DB-ellenőrzését jelenti |

Az envelope-hiba azért végleges és azért állítja meg a relayt, mert az M1 írási útja validál és a DB-korlátok is ellenőrzik a típus/status párt: ilyen sor csak közvetlen adatbázis-beavatkozásból keletkezhet. A csendes átugrás megbontaná a sorrendet és elrejtené a sérülést; a megállás a növekvő `pending` értéken azonnal látszik. A karanténstream ezt a helyzetet **nem** kezeli: az M4 keresőoldali poison message-ére való, nem a relay bemenetére.

**A retry állapota memóriában él**, nincs hozzá új oszlop és nincs M3-migráció. Újraindításkor a backoff nullázódik, ami elfogadható: a tartós állapot a `delivered_at IS NULL`, és az elakadást a `pending`/`oldest-age` mutatja. Az M1 terve a retry diagnosztikai mezőit „indokolt migrációval” engedi; M3-ban nincs ilyen indok.

### 4.5 Egy relay, leállás, indulás

Egyetlen relay fut. A rekordfoglalás (`FOR UPDATE SKIP LOCKED` alapú lease) és a több párhuzamos relay kifejezetten **scope-on kívül**; a feltételes `delivered_at IS NULL` jelölés csak a kétszeri jelölés ellen véd, nem tesz biztonságossá két egyidejű relayt.

Leálláskor (`OnApplicationShutdown`) a ciklus leáll, a folyamatban lévő publish–jelölés pár korlátos ideig befejezhető, majd a NATS-kapcsolat lezárul. Ha a határidő letelik, a félbehagyott esemény függőben marad – ez biztonságos állapot, a következő indulás folytatja.

## 5. Konfiguráció és megfigyelhetőség

### 5.1 Konfiguráció

A `FEATURE_OUTBOX_RELAY=on` már ma kötelezővé teszi a `NATS_URL` kulcsot. M3 három új, alapértékkel rendelkező alkalmazáskulcsot ad: `NATS_PUBLISH_ACK_TIMEOUT_MS` (5000), `NATS_RELAY_BATCH` (100) és `NATS_RELAY_POLL_MS` (1000). A `NATS_STREAM` és `NATS_SUBJECT` meglévő opcionális kulcsok maradnak; megadás hiányában a contracts konstansai érvényesek.

Az M2 bevezette az „implementált adapterrel rendelkező integrációk” listáját a `validateConfig`-ban. M3 ebbe felveszi a `FEATURE_OUTBOX_RELAY` értéket, és ezzel – az M2 4.3 táblázatával azonos módon – **ugyanaz a három meglévő ellenőrzés íródik át**: a `test/base.test.ts` `validateConfig` egységpróbája, a `test/base.test.ts` indítási próbája és az M0 smoke 5.4 esete (a kikapcsolt integrációk dinamikus listája). Egyiket sem töröljük.

### 5.2 `GET /admin/processing-status`

Az M2 tervének átadási pontja szerint ez a végpont `ops:read` jogot kíván, azaz publisher éri el; editor és viewer `403`, hitelesítetlen hívó `401`. A válasz mezői:

| Mező | Tartalom |
| --- | --- |
| `outbox.pending` | Függő események száma |
| `outbox.oldestOccurredAt`, `outbox.oldestAgeMs` | A legöregebb függő esemény ideje és kora |
| `relay.enabled`, `relay.state` | `off` / `idle` / `publishing` / `retrying` / `halted` |
| `relay.lastDeliveredAt`, `relay.lastErrorCode` | Utolsó sikeres jelölés; hibaosztály kód, üzenet és részlet nélkül |
| `broker.connected`, `broker.streamPresent` | Kapcsolat és a stream megléte; legjobb tudás szerinti pillanatkép |
| `consumers[].name`, `consumers[].pending` | A két durable broker-oldali lemaradása, ha lekérdezhető |

A végpont **nem** ad `500`-at azért, mert a broker kiesett: a `broker.connected: false` a válasz része. A DB elérhetetlensége a szokásos `503 dependency_unavailable`. A `consumers` blokk legjobb tudás szerinti becslés: ha a broker nem válaszol, a mező hiányzik, és ezt a válasz jelzi ahelyett, hogy nullát állítana.

A `/health/ready` változatlanul kizárólag a PostgreSQL-t vizsgálja. Ez a D-M0-03b és a D02 kifejezett szabálya: a háttérfeldolgozás állapota a `processing-status` dolga, nem a readinessé.

### 5.3 Log és követhetőség

A relay strukturált bejegyzései az esemény `correlationId` és `eventId` értékét hordozzák, így egy HTTP-kérés a publikálástól a kézbesítésig követhető. A logba nem kerül payload, `DATABASE_URL`, NATS-hitelesítő adat vagy nyers hibaobjektum – az M0 5.6 szabálya a relayre is érvényes. Az események: `relay_started`, `relay_published` (eventId, correlationId, streamSeq, duplicate), `relay_delivered`, `relay_retry` (kísérletszám, következő késleltetés), `relay_halted` (ok-kód), `relay_stopped`.

## 6. Fejlesztési csomagok és felelősségek

| # | Csomag | Felelős / review | Függőség | Becslés | Kész eredmény |
| --- | --- | --- | --- | --- | --- |
| M3-01 | Konfiguráció és topológia-bootstrap | Codex / Claude | — | 90 p | Három új kulcs, idempotens stream/DLQ/durable létrehozás, eltérő konfigurációra néven nevezett hiba |
| M3-02 | JetStream adapter | Codex / Claude | M3-01 | 120 p | Kapcsolat backoffal, publish ACK időkorláttal, duplikátum-jelzés, korlátos drain |
| M3-03 | Relay ciklus | Codex / Claude | M3-02 | 120 p | Sorrendezett kötegolvasás, feltételes jelölés, retry, hibaosztályok, `markDelivered` az `OutboxRepository`-ban |
| M3-04 | Kiesés, ébresztés és leállás | Codex / Claude | M3-03 | 60 p | Commit utáni ébresztőjelzés, újracsatlakozás, `OnApplicationShutdown` korlátos leállás |
| M3-05 | `processing-status` végpont | Claude / Codex | M3-03, M2 | 60 p | Route, DTO, `ops:read` guard, broker-hiba jelzése hibakód nélkül |
| M3-06 | Megfigyelhetőség | Claude / Codex | M3-03 | 45 p | Relay-logesemények, correlation ID követés, titokmentesség |
| M3-07 | Teszt-infrastruktúra | Codex / Claude | M3-02 | 75 p | Izolált stream/durable nevek, Compose és külső broker mód, célzott megszakítási pontok |
| M3-08 | M3-T01–T20 integrációs próbák | Codex / Claude | M3-04…07 | 150 p | Valódi JetStream ellen, célzott hibainjektálással |
| M3-09 | `smoke:full` NATS szakasz és `demo:m3` | Codex / Claude | M3-08 | 75 p | Az M0 5. szakasz folyamatgazdájával; a kereső szakasz pendingként marad |
| M3-10 | Compose/VERSIONS, runbook, jegyzőkönyv, M4 átadás | Claude / Codex | M3-09 | 75 p | NATS image-pin, `VERSIONS.md` kliensverziók, README identity/relay szakasz, M3 jegyzőkönyv |

**Összeg: 870 perc = 14 óra 30 perc.** Codex 690 perc (11 óra 30 perc), Claude 180 perc (3 óra).

**Eltérés az ütemtervtől.** A MILESTONES az M3-ra a 11–12. munkanapot adja, azaz körülbelül 12 órát; a részletes becslés 2 óra 30 perccel több. Az M2 terve ugyanezt az ellenőrzést végezte el 2 óra 45 perces túllépéssel. A kettő együtt 5 óra 15 perc, nagyjából 0,9 munkanap, ami a 2 napos tartalék fele. A javasolt kezelés változatlan: a tartalékból fedezzük, az M4 kezdete csúszik, a kötelező hibapróbák nem maradnak el. A DECISIONS D01 pontosan ezt az ellenőrzést írja elő az M2–M5 tervezési keretére.

**Tervezett fájlterületek:** `src/messaging/` (`messaging.module.ts`, `jetstream.adapter.ts`, `topology.ts`, `relay.ts`, `relay.state.ts`), `src/outbox/outbox.repository.ts` (`markDelivered` és a köteglekérdezés rendezése), `src/ops/processing-status.controller.ts`, `src/config.ts`, `src/app.module.ts`, `src/main.ts`, `test/base.test.ts` (az 5.1 szerint átírt két állítás), `test/support/nats.ts`, `test/integration/relay.test.ts`, `scripts/smoke-m0.mjs` (5.4 esete), `scripts/smoke-full.mjs`, `scripts/demo-m3.mjs`, `compose.yaml`, `.env.example`, `README.md`, `docs/external-access.md`.

A `package.json`, a `package-lock.json` és a `VERSIONS.md` a DECISIONS D01 szerint Codex gazdája alatt változik: `@nats-io/transport-node` és `@nats-io/jetstream` pontos verzióval és commitolt lockfile-lal, új `VERSIONS.md` sorokkal, valamint két új script (`test:integration:m3`, `demo:m3`). A `smoke:full` az M2-ben létrejött futtató bővül, nem új script. **M3 nem hoz migrációt**, tehát a `migrations/` fa érintetlen.

**Sorrend:** konfiguráció és topológia → adapter → relay → kiesés és leállás → végpont és log → tesztkeret → próbák → smoke és demó → jegyzőkönyv. A `processing-status` az egyetlen M2-t feltételező csomag, ezért utolsóként is beilleszthető.

## 7. Ellenőrzési terv

Valódi NATS JetStream és valódi PostgreSQL 17 szükséges. A próbák saját, egyedi nevű streamet és durable-öket használnak, és a futás végén elbontják őket; a demókörnyezet streamjéhez nem nyúlnak. A kapacitás- és időkorlátos esetekhez a próbák szándékosan **kicsi** határokkal hoznak létre saját streamet, hogy a korlát másodpercek alatt elérhető legyen.

| # | Helyzet | Ellenőrizendő eredmény |
| --- | --- | --- |
| M3-T01 | Bootstrap friss brokeren, majd ismét | Stream, DLQ és a két durable létrejön a 3.1 szerinti konfigurációval; az ismételt futás nem változtat |
| M3-T02 | Létező stream eltérő `max_age`/`retention`/`discard` értékkel | A relay nem indul el, a hiba **néven nevezi** az eltérő mezőket; a stream változatlan, nincs csendes felülírás |
| M3-T03 | Normál publikálás relayjel | Egy üzenet a streamben, `delivered_at` kitöltve, a tárolt envelope és a stream tartalma azonos; a v1 séma validál |
| M3-T04 | NATS leállítva, majd CMS publish és withdraw | A HTTP-válaszok sikeresek, a sorok függőben maradnak, `/health/ready` 200 marad |
| M3-T05 | NATS visszatér | A függő sorok sorrendben kézbesítődnek; a stream sorszámai a 4.2 rendezését követik |
| M3-T06 | Relay leállítása publish ACK után, jelölés előtt; majd újraindítás | Ugyanaz a `msgID` megy ki, a `PubAck` duplikátumot jelez, a streamben **egy** üzenet marad, `delivered_at` kitöltve |
| M3-T07 | Ugyanaz a helyzet a deduplikációs ablakon **túl** | Második példány kerül a streambe; ez dokumentált viselkedés, nem hiba; a `delivered_at` kitöltve |
| M3-T08 | Több aggregate és egy `published → withdrawn` pár egy körben | A stream beírási sorrendje megegyezik a 4.2 rendezésével; a pár nem fordul meg |
| M3-T09 | Publish ACK időtúllépés kikényszerítése | A relay a D08 ütemezés szerint próbálkozik újra (1, 2, 4, 8, 16, 30 s, ±20% jitter); nincs végleges eldobás, nincs átugrott sor |
| M3-T10 | Szándékosan kicsi `max_bytes`/`max_msgs` és `discard: new` | A publish elutasítva, az outbox függőben marad, a CMS írása közben sikeres |
| M3-T11 | Közvetlenül a DB-be írt érvénytelen vagy 64 KiB feletti envelope | A relay strukturált hibával megáll, nem jelöl kézbesítettnek, nem ugrik tovább; a `pending` nő |
| M3-T12 | `processing-status` publisherként | 200; `pending`, `oldestAgeMs`, relay- és broker-állapot, a két durable lemaradása |
| M3-T13 | `processing-status` editorként, viewerként és token nélkül | `403`, `403`, `401`; a válasz nem szivárogtat brokeradatot |
| M3-T14 | `processing-status` leállított NATS mellett | `broker.connected: false`, a végpont nem `500`; `/health/ready` továbbra is 200 |
| M3-T15 | Kétszeri jelölési kísérlet ugyanarra az eseményre | A második `UPDATE` no-op; a `delivered_at` értéke nem változik |
| M3-T16 | `FEATURE_OUTBOX_RELAY=off` mellett teljes M1 folyamat | A relay nem fut, az outbox gyűlik; az M1 viselkedése bitre változatlan |
| M3-T17 | `FEATURE_OUTBOX_RELAY=on` `NATS_URL` nélkül | Indítási hiba, a **kulcsot** nevezi meg; nincs listen |
| M3-T18 | Publikálás közbeni tartalomtranzakció vizsgálata | A tartalom sorzára alatt nem történik brokerhívás; a CMS válaszideje nem függ a broker válaszától |
| M3-T19 | Leállítás publikálás közben, majd újraindítás | Korlátos leállás, nincs félkész állapot; a függőben maradt esemény a következő körben megy ki |
| M3-T20 | Correlation ID és titokmentes log a teljes úton | A HTTP-kérés correlation ID-ja a relay bejegyzésein is megjelenik; nincs payload, `DATABASE_URL`, NATS-hitelesítő vagy nyers hibaobjektum a logban |

A két durable M3 végén **nem üres** lemaradást mutat, és a `CONTENT_DLQ` üres. Ezt az M3-T12 ellenőrzi; ha a karanténban üzenet van, az hiba.

Az M1 T01–T23 és az M2 ellenőrzései regresszió nélkül futnak. Az egyetlen szándékos változás az 5.1-ben leírt három konfigurációs állítás, az M2-ben már alkalmazott módon; ez nem az M1 integrációs próbáit érinti.

### 7.1 Tervezett futtatási szerződés

| Parancs a backendből | Elvárt feladat |
| --- | --- |
| `npm run test:integration:m3` | Elkülönített teszt-DB-n és izolált streamen futtatja az M3-T próbákat, siker/hiba exit kóddal |
| `npm run smoke:full` | Az M2-ben létrehozott futtató NATS szakasza; a kereső szakasz továbbra is pending |
| `npm run demo:m3` | Publikálás → outbox → publish ACK → kézbesített jelölés, közben leállított és visszatérő brokerrel |

A `demo:m3` a dokumentált sorrendet adja: publikálás relay nélkül (függő esemény) → relay indítása (kézbesítés) → broker leállítása → újabb publikálás és visszavonás (két függő esemény) → broker visszatérése → mindkettő kézbesítése az eredeti sorrendben. A jegyzőkönyvbe a parancs, a környezet, a verziók, a stream neve, az ellenőrzésazonosító és az eredmény kerül; NATS-hitelesítő adat, teljes `DATABASE_URL` és payload nem.

## 8. Lezárás és átadás

- [ ] A topológia idempotensen létrejön a D08 paramétereivel, és eltérő létező konfigurációt nem ír felül csendben. (M3-T01, M3-T02)
- [ ] Normál publikálás után az esemény a streamben van, és a `delivered_at` kizárólag a publish ACK után íródik. (M3-T03)
- [ ] NATS-kiesés alatt a CMS-írás sikeres, az esemény függőben marad, a readiness nem romlik el; visszatéréskor sorrendben kézbesítődik. (M3-T04, M3-T05)
- [ ] A publish ACK utáni megszakítás után ugyanaz az `eventId` újraküldhető; az ablakon belül duplikátum, azon túl dokumentált második példány. (M3-T06, M3-T07)
- [ ] A beírási sorrend és a `published → withdrawn` pár sorrendje bizonyított. (M3-T08)
- [ ] Az átmeneti hiba retryja és a kapacitáskorlát viselkedése megfelel a D08-nak; végleges eldobás nincs. (M3-T09, M3-T10)
- [ ] Az érvénytelen envelope megállítja a relayt, nem okoz csendes átugrást vagy hamis kézbesítést. (M3-T11)
- [ ] Az eseményút előrehaladása hitelesített végponton megfigyelhető, a jogosultsági mátrix szerint, és broker-kiesés nem `500`. (M3-T12, M3-T13, M3-T14)
- [ ] A relay kikapcsolt állapotban nem változtat az M1 viselkedésén, bekapcsolva pedig megköveteli a saját kulcsát. (M3-T16, M3-T17)
- [ ] A tartalom tranzakciója nem vár brokerhívásra, és a leállás korlátos, félkész állapot nélkül. (M3-T18, M3-T19)
- [ ] Az `eventId` és a correlation ID végig követhető, a log titokmentes. (M3-T20)

**M4-nek átadandó:** a létrehozott `search-a-v1` és `search-b-v1` durable, a bennük álló lemaradással; a `CONTENT_DLQ` stream üresen, a karanténpublikálás implementálásához; a JetStream adapter kapcsolat- és backoff-kezelése; a `processing-status` váz, amelybe az indexenkénti feldolgozási állapot bekerül; és az a szabály, hogy a fogyasztói ACK kizárólag sikeresen befejezett indexművelet után adható.

**M5-nek átadandó:** a relay megszakítási pontjai és a hozzájuk tartozó tesztkapcsolók a helyreállási próbákhoz; az `outbox pending`/`oldest-age` mérőszám a mérési jegyzőkönyvhöz; a deduplikációs ablakon túli újraküldés dokumentált viselkedése a replay-próbához.

## 9. Kockázatok és eljárás

| Kockázat | Rögzített eljárás |
| --- | --- |
| Konténerregiszter nem elérhető (E01), a NATS image nem húzható | A próbák külső broker módot is támogatnak az M0 smoke precedense szerint. Valódi JetStream nélkül M3 nem zárható le; mock brokerrel nem jelölünk késznek semmit |
| A modularizált 3.x kliens hiányzó felülete | Dokumentált visszalépés a `nats` 2.x egybecsomagolt kliensre, a teljes készlet együtt váltva; a döntés a `VERSIONS.md`-be kerül |
| A `discard` policy félreolvasása | A 3.1 kimondja: `new`, nem `old`. A `old` csendes adatvesztést okozna, amit a D08 kifejezetten kizár |
| A nanoszekundumos időmezők milliszekundumként megadása | Egyetlen konverziós hely a topológiában; az M3-T01 a visszaolvasott stream-konfigurációt ellenőrzi, nem a beküldött objektumot |
| A relay megállása észrevétlen marad | A `pending`/`oldest-age` és a `relay.state: halted` a végponton látszik; az M3-T11 és M3-T12 ezt ellenőrzi |
| Két relay véletlen egyidejű futása | A feltételes jelölés csak a kétszeri jelölés ellen véd. A több relay scope-on kívül; a lease-alapú megoldás külön bővítés |
| A becslés túllépi a 2 napos keretet | A 6. szakasz kimondja: tartalékkeret és csúszó M4-kezdés, nem tesztelhagyás |

## 10. Következő lépés

Az M3-01 konfiguráció és topológia, valamint az M3-02 adapter az M2 elkészültétől függetlenül kezdhető; egyedül az M3-05 `processing-status` igényel verifikált identitást. Az M3 kapuja viszont valódi NATS-t kíván, tehát az E01 külső előfeltétel a fázis indításának gyakorlati feltétele. Új üzleti döntési kör nem szükséges: a topológia, a retention, a retry és a dedup a DECISIONS D08 szerint rögzített.
