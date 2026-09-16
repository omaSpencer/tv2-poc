# M4 implementáció – részletes code review

**Utókövetés:** a javítások és új ellenőrzések külön [javítási jegyzőkönyvben](M4-REVIEW-FIXES.md) szerepelnek. Az alábbi riport a javítás előtti állapotot dokumentálja.

**Dátum:** 2026-09-16  
**Minősítés:** változtatások szükségesek; az M4 technikai lezárása még nem javasolt.  
**Megállapítások:** 1 × P1, 6 × P2. P1: magas prioritású működési hiba; P2: javítandó működési vagy elfogadási hiba.

A két külön index, az aktuális PostgreSQL-állapotból képzett projekció, a publikáltság DB-s visszaellenőrzése és a task sikeréhez kötött normál ACK-ág megfelelő alap. A fő problémák a hibák utáni helyreállításban, a routing készültségi ellenőrzésében és a bizonyítékok pontosságában vannak. A célzott review-próbák a buildelt implementációban több olyan vezérlési hibát reprodukáltak, amelyet a meglévő M4 tesztek nem fednek le.

## 1. Vizsgált állapot és módszer

A review a `41243c6` utáni M4 munkakönyvtáron indult. Munka közben elkészült a **`b5a95d7` – Update M4 implementation status and enhance backend configuration** commit; az itt hivatkozott M4 kódrészleteket a lezárás előtt ebben az állapotban is ellenőriztem. A közben megjelent M5-módosítások (`src/schema.ts`, `src/contracts/reindex.ts`) nem részei az értékelésnek.

Átnézett területek: M4 terv és evidence; konfiguráció; Meilisearch adapter és bootstrap; projekció és worker; karantén; search routing és DB-hidratálás; JetStream kapcsolat és consumer-életciklus; processing-status; OpenAPI; M4 tesztek és segédeszközök; smoke és demó. A korábbi M0–M3 review javításait az M4 függőségei szempontjából néztem át, ez nem teljes új M0–M3 audit.

**Alkalmazáskódot nem javítottam.** A [reprodukciós script](/Users/busizoltan/code/tv2-poc/poc/review/m4-reproduce.mjs) a buildelt osztályokat hívja ellenőrzött adapter- és broker-helyettesítőkkel, saját szolgáltatások indítása vagy üzleti adatok módosítása nélkül. A [nyers eredmények](/Users/busizoltan/code/tv2-poc/poc/review/m4-probe-results.jsonl) megőrzik a tényleges számlálókat. Ezek célzott vezérlési bizonyítékok, **nem helyettesítik a valódi PostgreSQL/NATS/két Meilisearch integrációs futást**.

A `scripts` Git-kizárását a felhasználó közben javította. A végső `.gitignore` már nem tartalmazza, ezért **nem nyitott review-megállapítás**.

## 2. Prioritásos megállapítások

### R01 · P1 · NATS-kapcsolatszakadás után a workerek a halott consumeren maradnak

**Hely:** [projection.worker.ts:238](/Users/busizoltan/code/tv2-poc/poc/backend/src/search/projection.worker.ts:238), [projection.worker.ts:259](/Users/busizoltan/code/tv2-poc/poc/backend/src/search/projection.worker.ts:259). Kapcsolat: [jetstream.adapter.ts](/Users/busizoltan/code/tv2-poc/poc/backend/src/messaging/jetstream.adapter.ts).

A consumer handle csak akkor kérődik újra, ha `consumerHandle === null`. A `next()` hibája után a catch kizárólag állapotot és backoffot állít; nem érvényteleníti a handle-t. A broker `reconnect: false` beállítással kapcsolódik, és a kapcsolatépítést a `consumer()` / `consumerInfo()` indítaná újra. Ezeket a már meglevő handle miatt a worker többé nem hívja.

**Hatás:** egy NATS-kapcsolatszakadás mindkét keresőworkert tartósan megállíthatja. A broker helyreállása és a relay saját sikeres újrakapcsolódása nem javítja meg a keresőstack külön kapcsolatát. Az API életben marad, miközben az indexek egyre elavultabbak lesznek; worker- vagy alkalmazás-újraindítás szükséges.

**Reprodukció:** lezárt kapcsolatot jelző consumer-helyettesítőn **4 pull-kísérlet, összesen 1 handle-lekérés**; a retry-k egyike sem próbál új consumert szerezni. Ez a recovery-ág hiányát bizonyítja; valódi broker-restart próbát ebben a review-ban nem futtattam.

**Javítás:** kapcsolat-/consumerhiba esetén a handle érvénytelenítése, új kapcsolat és consumer szerzése, majd a szerződés ismételt ellenőrzése. A közös keresőbroker miatt A/B újrakapcsolódását is koordinálni kell.

**Regresszió:** már működő A/B worker mellett NATS-kapcsolat megszakítása, visszaállítása; új esemény mindkét indexbe kerüljön processz-újraindítás nélkül, az el nem ismert események redelivery-jével együtt.

### R02 · P2 · Task-poll hálózati hibánál elvész az elfogadott task azonosítója

**Hely:** [projection.worker.ts:404](/Users/busizoltan/code/tv2-poc/poc/backend/src/search/projection.worker.ts:404).

A catch minden olyan hibára törli a `pendingTaskUid` értékét, amely nem `MeiliTaskTimeoutError`. Az `awaitTask()` közbeni hálózati hiba vagy HTTP 429/503 más hibát dob, így a következő kör új dokumentumírást küld a még futó task lekérdezése helyett. Ez ellentétes a terv 4.1 pontjával és a kódbeli kommenttel is.

**Reprodukció:** az első submit UID-je 1, az első poll átmenetileg hibázik. Eredmény: **2 submit, pollolt UID-k `[1, 2]`, 1 ACK**. A worker nem tér vissza az 1-es taskhoz.

**Hatás:** egyetlen eseményhez több párhuzamosan sorban álló Meili-task keletkezhet. Tartós pollhiba alatt felesleges írások és indexelési terhelés halmozódik fel. Az upsert/delete idempotenciája miatt ez önmagában nem bizonyít elveszett adatot, de sérti az egy esemény/egy aktív task szerződést.

**Miért maradt rejtve:** T08 folyamatosan sikeresen lekérdezhető, `processing` állapotú taskot modellez. A `submittedTasks` változót nem tényleges submit-számláló tölti; nincs olyan állítás, amely elveszett pollválasz után ellenőrizné az új submit hiányát. T09 főleg beküldéskori kiesést tesztel.

**Javítás:** külön beküldési és poll-fázis; ismert task UID megőrzése minden átmeneti pollhibánál. Új submit csak igazolt terminal failure vagy a beküldési eredmény tényleges ismeretlensége esetén.

**Regresszió:** sikeres submit után kizárólag a `/tasks/<uid>` válaszok hibázzanak 429/503/network módon; submit-szám maradjon 1, minden poll ugyanarra az UID-re menjen, ACK csak siker után.

### R03 · P2 · A keresés nem kész vagy halted indexet is használhat

**Hely:** [search.service.ts:89](/Users/busizoltan/code/tv2-poc/poc/backend/src/search/search.service.ts:89), [search.service.ts:107](/Users/busizoltan/code/tv2-poc/poc/backend/src/search/search.service.ts:107).

B lekérdezése előtt nincs `routable('b')` ellenőrzés. A esetében pedig a `retrying` állapot automatikusan routolható, noha ugyanezt az állapotot egy **első bootstrap előtti** kapcsolat-/settings-hiba is beállítja. A futási állapot nem bizonyítja, hogy az index bootstrapja valaha sikeres volt.

**Reprodukció:** A átmeneti hibája után B külön-külön `off`, `bootstrapping` és `halted` állapotban is kiszolgált egy sikeres választ; **3 B-hívás**. A `retrying` állapotára a routing predikátum szintén igazat adott.

**Hatás:** konfigurációeltérés miatt leállított, még nem ellenőrzött vagy leállított workerhez tartozó index is szolgálhat találatokat. A DB-s publikáltságszűrés megmarad, tehát ez nem adminadat-szivárgás; viszont a relevance, kategóriafilter és kereshetőség szerződése nem igazolt. Az M5-nek ígért kizárható routingfelület sem teljesül B-re.

**Javítás:** explicit, sikeres bootstraphoz kötött készültség mindkét indexen; ezt a routing minden lekérdezés előtt ellenőrizze. Külön kell kezelni a már kész index átmeneti kiesését és az első bootstrap hibáját.

**Regresszió:** A kiesése × B off/bootstrapping/halted; egyik esetben se hívjuk B keresőjét. Első bootstrap közbeni retry alatt A se kapjon keresési kérést.

### R04 · P2 · Létező, alapbeállítású indexen automatikus settings-átírás történik

**Hely:** [index-bootstrap.ts:99](/Users/busizoltan/code/tv2-poc/poc/backend/src/search/index-bootstrap.ts:99).

Az `isUnprovisioned()` pusztán a settings értékeit ellenőrzi. Egy már dokumentumokkal feltöltött, alapbeállítású index ugyanúgy megfelel neki, mint egy frissen létrehozott üres index. A kód nem vizsgál dokumentumszámot vagy tulajdonosi/provisioning bizonyítékot, mégis automatikusan alkalmazza a saját settingset.

**Reprodukció:** létező indexet és alapértelmezett settingset adó adapteren **`created: false`, `settingsApplied: true`, 1 settings-írás**. A dokumentumok létezése nem bemenet a döntésben, így a nem üres index sem kap védelmet.

**Hatás:** egy meglévő index konfigurációja operátori beavatkozás nélkül megváltozhat, teljes újraindexelést kiváltva. A terv 3.1 és 11. pontja létező eltérésre haltot ír elő, a koordinált settings-változást M5-re hagyja.

**Javítás:** kizárólag bizonyítottan az adott bootstrap által újonnan létrehozott index automatikus konfigurálása; a félbeszakadt provisioning helyreállítását külön, ellenőrizhető szabállyal kezelni. Az alapértelmezett settings önmagában nem tulajdonosi bizonyíték.

**Regresszió:** előre létrehozott, dokumentumokat tartalmazó, default settingsű index → `halted/config_mismatch`, settings és dokumentumok változatlanok.

### R05 · P2 · A demó eltérő indexállapot mellett jelent azonos végállapotot

**Hely:** [demo-m4.mjs:309](/Users/busizoltan/code/tv2-poc/poc/backend/scripts/demo-m4.mjs:309); a stale dokumentum visszaírása a megelőző 6. lépésben.

A demó withdraw után szándékosan visszaírja az első dokumentumot B-be, majd ellenőrzi a publikus DB-s szűrést. Ezután nem törli ezt a stale dokumentumot és nem hoz létre hozzá új feldolgozandó eseményt. A végén csak a **második** dokumentum A/B-egyezését hasonlítja össze, mégis `end_state_identical` eseményt és PASS-t ír.

**Hatás:** a demó saját fixture-ei között is eltérő a két index: A-ban nincs az első dokumentum, B-ben ott marad. Az evidence „a két index dokumentuma bájtra azonos” állítása ezért csak a megvizsgált második dokumentumra igaz, a terv szerinti azonos végállapotot nem bizonyítja.

**Bizonyítás:** statikus adatfolyam-elemzés; a teljes demót ebben a review-ban nem futtattam újra.

**Javítás:** a stale-próba után bizonyított konvergencia, majd legalább az összes saját fixture ID-jának és teljes projekciójának összehasonlítása mindkét oldalon. A drain-próba durable pending és ack-pending értékeket is nézzen, ne csak outboxot és memóriabeli in-flight mezőt.

**Regresszió:** extra stale dokumentummal a végállapot-ellenőrzés bukjon; a javított demó végén az első ID mindkét oldalon hiányozzon, a második dokumentum egyezzen.

### R06 · P2 · Bekapcsolt kereső mellett nem kötelező a NATS-konfiguráció

**Hely:** [config.ts:86](/Users/busizoltan/code/tv2-poc/poc/backend/src/config.ts:86), [jetstream.adapter.ts](/Users/busizoltan/code/tv2-poc/poc/backend/src/messaging/jetstream.adapter.ts).

A `NATS_URL` csak `FEATURE_OUTBOX_RELAY=on` mellett kötelező. A kereső saját brokerkapcsolatot használ, a relaytől függetlenül engedélyezhető, de `FEATURE_SEARCH=on` esetén csak a négy Meili-kulcsot kéri a validátor.

**Reprodukció:** search on, relay off, helyes A/B konfiguráció, **NATS_URL nélkül a `validateConfig()` sikeres**.

**Hatás:** a processz determinisztikusan hibás helyi konfigurációval elindulhat; mindkét worker a hiányzó kulcs miatt retryzik, a DB-only readiness közben zöld maradhat.

**Javítás:** NATS_URL legyen kötelező minden olyan engedélyezett feature-nél, amely brokert használ; a hiány még listen előtt, a konkrét kulccsal bukjon.

**Regresszió:** search on/relay off, NATS_URL nélkül → ConfigurationError; helyes URL-lel és elérhetetlen brokerrel az indulás maradjon megengedett, futásidejű retry-val.

### R07 · P2 · Az engedélyezett heartbeat-intervallum túllépheti az ACK-várakozást

**Hely:** [config.ts:49](/Users/busizoltan/code/tv2-poc/poc/backend/src/config.ts:49), [projection.worker.ts:285](/Users/busizoltan/code/tv2-poc/poc/backend/src/search/projection.worker.ts:285).

A `SEARCH_CONSUMER_WORKING_MS` bármilyen pozitív egész lehet. A consumer-ellenőrzés csak azt nézi, hogy az `ack_wait` legalább 30 másodperc, a tényleges heartbeat-intervallumhoz nem hasonlítja. A default 10 másodperc helyes, de például 60 másodperc érvényes konfigurációként elfogadott a default 30 másodperces ACK-határ mellett.

**Reprodukció:** `SEARCH_CONSUMER_WORKING_MS=60000` elfogadott. Az összehasonlítás hiánya a consumer-contract ellenőrzésben statikusan igazolt; hosszú, valódi JetStream-taskkal nem futott külön reprodukció.

**Hatás:** hosszú DB/task-művelet vagy retry alatt lejárhat a kézbesítés az első `working()` előtt. Ez megsérti a dokumentált heartbeat-garanciát és felesleges redelivery-t, több fogyasztó esetén párhuzamos feldolgozást okozhat.

**Javítás:** induláskor és a tényleges consumer-konfiguráció ellenőrzésekor is legyen kötelező a biztonságos időarány; hibás értékre fail-fast vagy consumer-contract halt.

**Regresszió:** heartbeat ≥ ack_wait elutasítása; megfelelő intervallummal ack_wait-nál hosszabb task alatt nincs újrakézbesítés.

## 3. Futtatási eredmények és korlátok

| Ellenőrzés | Saját eredmény | Értelmezés |
| --- | --- | --- |
| Függőségek | Lockfile szerinti `npm ci --ignore-scripts` | A kezdetben hiányzó Meilisearch-csomag telepítve; kezdeti buildhiba környezeti volt. |
| TypeScript build | PASS | M4 build a telepítés után sikeres. |
| Lint | PASS, 0 warning / 0 error, 81 fájl | A vizsgált állapotban. |
| Célzott review-script | PASS: a hibás viselkedéseket reprodukálta | R01–R04 és R06 konfigurációs/vezérlési próbák; R07 konfigurációs elfogadás. |
| Külön M4 tesztfájl | **16 passed, 22 skipped (38)** | A függőségektől független esetek sikeresek; a valódi integrációs esetek kimaradtak. [Log](/Users/busizoltan/code/tv2-poc/poc/review/m4-unit-test-run.log). |
| Teljes Vitest megkísérlése | Nem teljes integrációs bizonyíték | 42 passed, 54 skipped, 4 failed; 6 további suite konfiguráció hiányában nem gyűjtött tesztet. |
| Valódi PostgreSQL + NATS + két Meilisearch | Nem futott újra | Claude 152/153-as állítását ez a review nem hitelesíti új teljes futással. |
| Full smoke és M4 demó | Statikusan átnézve | Saját új teljes futás nincs. |
| Valódi Authentik login → publish → search | Pending | Az evidence is nyitva hagyja; ez nem új M4 kódhiba. |

**A sikertelen általános tesztindítás részlete:** `TEST_DATABASE_URL` nem volt megadva, ezért hat DB-s suite már importkor megállt; az M4 integrációs esetek függőségek hiányában skipeltek. A négy base-hibánál a child API nem adott használható URL-t ebben a futtatási környezetben. Ezeket nem soroltam alkalmazáshibának. A [teljes log](/Users/busizoltan/code/tv2-poc/poc/review/m4-test-run.log) megmaradt, így a sikertelen kísérlet sem veszik el.

**Toolchain:** a helyi npm alapútvonala hibás Homebrew Node-ra mutatott. A sikeres build és a review-probák a beépített **Node 24.19.0** runtime-mal futottak, amely a manifest `>=24.20.0 <25` minimumánál egy patchszinttel régebbi. Ezért nem állítom, hogy a rögzített teljes toolchain-kapu teljesült. A lint korábban explicit Node 22.15.1 útvonallal futott. Alkalmazásfüggőségeket frissítettem a meglévő lockfile alapján, manifestet vagy lockfile-t nem módosítottam.

## 4. Ami megfelelő alap, és ami még nem bizonyított

- A projekció a jelenlegi DB-sorból származik: régi publish-event withdrawn tartalomra delete-et választ.
- A publikus válasz mezői PostgreSQL-ből jönnek, a published/category szűrés SQL-ben történik; az index stale metaadata nem válik válaszforrássá.
- A normál feldolgozási ág a task terminal sikerét ellenőrzi ACK előtt; karantén esetén PubAck-ra vár.
- A retry saját wake-ot használ, így a CMS új eseményei nem rövidítik le az M4-backoffot.
- A keresési query normalizálása és az új OpenAPI-felület lényegesen teljesebb a korábbi állapotnál.
- Az izolált full smoke saját adatbázist és egyedi stream/index neveket használ; az előző review adateltérítési mintája a kódban javítva van. Ennek új dinamikus izolációs auditja nem készült.

**További ellenőrzendő területek, nem önálló bizonyított findingok:** index eltűnése az in-flight projektálás alatt (`indexReady=false` után valóban történik-e bootstrap ugyanannál az üzenetnél); hosszú bootstrap/DB-művelet tényleges megszakítása stop-határnál; több API-processz ugyanazon durable-en; brokerállapot láthatósága search on/relay off mellett.

A dokumentumokban szereplő **152 és 153 teszt** eltérő száma is egységesítendő a következő teljes futás nyers logjával. Ez önmagában nem kódhiba, de a kapubizonyíték legyen egyértelműen egy állapothoz és futáshoz kötve.

## 5. Javasolt javítási és lezárási sorrend

1. **R01:** helyreálló brokerkapcsolat és consumer-életciklus mindkét workerben.
2. **R02–R03:** task UID megőrzése és explicit bootstrap-készültség mindkét routingágon.
3. **R04, R06–R07:** meglévő index védelme és feature/heartbeat konfigurációs határok.
4. **R05:** demó valódi végállapot-ellenőrzése; T08 submit-számláló és pollhiba-regresszió megerősítése.
5. Rögzített Node-verzión, PostgreSQL 17-en, valódi NATS és két külön Meilisearch mellett teljes M0–M4 teszt, smoke és demó; a nyers kimenetekből frissített evidence.

**Lezárási döntés:** az M4 jó alapot ad M5-höz, de a worker-helyreállítás és a routinghibák javítása nélkül nem tekinthető megbízhatóan lezártnak. Az M2 L2 üzleti demó ettől külön, továbbra is pending marad.
