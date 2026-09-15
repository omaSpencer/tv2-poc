# M0 implementációs terv – review

2026-09-15 · Codex review a [Claude által készített tervről](M0-IMPLEMENTATION.md).

**Eredmény az első változatról:** a felosztás használható alap az M1 megtervezéséhez, de az alábbi pontok pontosítása szükséges a végrehajtás előtt. Dokumentumreview készült, kód-, telepítési és futási ellenőrzés nem. Az eredeti M0-terv döntési javaslatait ez a review nem minősíti elfogadottnak.

## Aktuális státusz – v3 dokumentumlezárás

2026-09-15 · A felhasználó felhatalmazása alapján az M0 v3, M1, README, PHASES és MILESTONES egységesítve; a választott döntések a [DECISIONS](DECISIONS.md) fájlban rögzítve. A nyolc review-pont és a három M0–M1 szerződéseltérés **tervdokumentum-szinten lezárva**.

- Readiness csak PostgreSQL; identity helyi feltétele az indulást kezeli.
- Custom migráció és explicit teszt-reset; régi kézi sorszámozó/up-down maradványok törölve.
- Full definíció és futás külön feladat; core smoke nem függ full indulástól.
- No-op sorrend és explicit actor egységes.
- M1 tesztadapter, JWT/JWKS M2; mediaAssetId adminmező; slug publikáláskor.
- Smoke egy izolált Node-futtatóval, saját childdal, assert/timeout/finally cleanuppal tervezve.
- 120 perces spike és azonos háromlépcsős fallback minden hivatkozásban.
- Becslés a smoke-runner munkájával korrigálva; 17+2 napos soros tervezési keret rögzítve.

A következő szakaszok az első és második változat **történeti review-jai**. A bennük szereplő „nyitott”, „javítandó” és korábbi óraszámok az akkori állapotot írják le; nem az aktuális végrehajtási tervet. Kód és futási bizonyíték továbbra sincs, a megvalósítási checklistet nem zártuk le.

## Utóellenőrzés – az M0 második változata

2026-09-15 · Az átvezetést a dokumentum tényleges szövegén ellenőriztem. A fő javítások megjelentek, de a „mind a 8 pont lezárva” státusz még nem indokolt. Az alábbi státusz dokumentumszintű; futási bizonyítékot nem jelent. Az eredeti nyolc megállapítás történeti review-ként megmarad lent.

| Eredeti pont | Utóellenőrzés eredménye |
| --- | --- |
| 1 – Readiness | A lényegi javítás átvezetve D-M0-03b-ben és M0-08-ban: NATS/Meili nem rontja az API-readinesst. A helyi identity állapotának sorában az „igen” readiness-hatást érdemes „indítási feltételre” pontosítani, ahogy a magyarázat is mondja. |
| 2 – Migráció | A custom migration és az előrefelé alkalmazás megfelelő irány. D-M0-02 első bekezdésében még kézi sorszámozás, a struktúrában `0001_baseline.sql` maradt; ezek ütköznek a későbbi, generált formátumot előíró szöveggel. |
| 3 – Authentik-kapu | Részben átvezetve. A 6. szakasz szerint a full indulás halasztható, R2 szerint az Authentik-konténernek mégis indulnia kell. M0-21 továbbra is „mind”-től függ és az 5. szakasz minden sorát kéri, ezzel az opcionális 5.7-et is visszateszi a kapuba. |
| 4 – No-op | A kötött sorrend és az elveszett válasz utáni újraolvasás átvezetve, M1-gyel összhangban. |
| 5 – Auth smoke | A prefixvédelem és a tényleges adminműveletek ellenőrzése átvezetve. Az új, kötelező teszt-JWKS/token megoldás M1-gyel külön egyeztetendő scope-változás, lásd lent. |
| 6 – Reprodukálhatóság | Részben átvezetve; az 5.0 elvei még nem teljesülnek az 5.1–5.6 konkrét parancsaiban. |
| 7 – Spike | Build/DI/validáció/OpenAPI bekerült. R1 még 90 perces, közvetlen v11 fallbacket ír, miközben M0-02 már 120 perc és D-M0-01 három lépcső. A végleges pontos runtime- és csomagpin továbbra is a spike kimenete. |
| 8 – Becslés | Újraszámolva helyes: 1145 perc = 19 óra 5 perc; a táblázat szerinti core 980 perc, full/Authentik 165 perc. A munkatársankénti 728/358/80 perc felosztás nincs levezetve, együtt 1166 perc; a közös részvétel és a nettó munka fogalmát tisztázni kell. A naptári ütemezés nyitott. |

### Még javítandó futtatási részletek

- Az 5.1 leállítja az appot, de 5.3 és 5.5 nem indít saját példányt. Az 5.0 általános mondata nem teszi végigfuttathatóvá a konkrét blokkokat.
- Az 5.4 és 5.6 `pkill -f 'node .*dist/main'` parancsa a vizsgált példányon kívüli folyamatot is leállíthat. Saját gyermekfolyamat azonosítójához kötött cleanup szükséges; npm wrapper esetén a tényleges alkalmazásfolyamat leállását is ellenőrizni kell.
- Az 5.1 még a placeholder `.env.example` fájlt másolja, az 5.0-ban ígért működő helyi konfiguráció beállítása hiányzik. Az `ENV_FILE` konfigurációválasztásnak az M0-04 szerződésében is szerepelnie kell.
- A várakozás exit kódjának kiírása és a találatok megszámolása nem állítja meg hibára a teljes ellenőrzést. Időtúllépés, hiányzó sentinel vagy érzékeny találat esetén egyértelmű sikertelen eredmény és cleanup kell.

### M0–M1 szerződéseltérések – döntés szükséges

| Téma | M0 v2 javaslata | Jelenlegi M1 javaslata | Javasolt következő döntés |
| --- | --- | --- | --- |
| Slug | Minden mentéskor generálás, ha üres; üres transzliterációnál `content-<id8>` | Csak publikáláskor generálás; üres eredménynél 422 és kézi slug | M1 változatának megtartását javaslom: a draft minimum a cím marad, a slugfoglalás publikáláskor történik. Ez továbbra is javaslat. |
| Nyilvános `mediaAssetId` | D-M0-04b szerint nyilvános | M1 szerint csak adminmező | Maradjon adminmező, amíg nincs konkrét nézői felhasználási célja; a katalógus-PoC nem végez lejátszást. |
| M1 tesztidentity | HTTP-próbához aláírt teszttoken és teszt-JWKS kötelező | Közvetlen service-actor és kontrollált HTTP-tesztadapter; valódi tokenellenőrzés M2 | M1-ben maradjon explicit tesztactor/adapter; token/JWKS-próba M2-ben. Ha előrehozzuk, az ellenőrző adapter munkáját és becslését is át kell hozni. |

A tesztactor szolgáltatáshíváskor nem token, hanem belső kontextus; az M1 HTTP-listener nélküli demójához is ezt kell egyeztetni. M0 D-M0-04 táblájában még `M2-ig system` szerepel, miközben D-M0-06 ezt már tiltja. M0 D-M0-04b a keresési dokumentum slug mezőjét is hozzáadja a README-ben felsorolt készlethez; ezt külön javaslatként kell jelölni.

### Szerkesztési és tervezési maradványok

R4 még „jóváhagyás nélkül hatályos” alapértékről beszél, a 2. szakasz már nem elfogadott munkafeltételezésről. A content-migráció M0-beli hivatkozásai `M1-01`-et mondanak, az M1 tervben ez `M1-02`. Az M0-09 globális hibafilter DoD-jában is fel kell tüntetni a D-M0-09-ben már szereplő health-kivételt.

A full/Authentik csomag teljes M2-be tolása még nem végrehajtható a jelenlegi függőségekkel: a full összeállítás a 6. szakaszban kapu, M0-17 pedig M0-16-tól függ. Az összeállítást/verziórögzítést és a tényleges indulási próbát külön feladatrészre kell bontani. Az M1–M5 célütemezés csak ezután és a közös feladatok kapacitásának tisztázása után zárható le.

**Következő kapu:** a szövegben maradt ellentmondások egységesítése és a három M0–M1 szerződéskülönbség rendezése. A readiness és no-op fő szabályait nem kell újranyitni.

## 1. [P1] A readiness nem függhet minden bekapcsolt integrációtól

**Hely:** M0-08, illetve a 6. szakasz kötelező/opcionális függőségekről szóló feltétele.

M0-08 minden bekapcsolt függőséget a readiness részévé tesz. M3–M4-ben így egy NATS- vagy keresőkiesés miatt az egész API unready lehetne, miközben a README előírja a CMS további írhatóságát. Forgalmat readiness alapján irányító környezetben ez elérhetetlenné tenné az egyébként működő CMS-t.

**Javasolt javítás:** különüljön el az API kiszolgálhatósága és a háttérfeldolgozás állapota. M1-ben a PostgreSQL szükséges a readinesshez; később NATS/Meilisearch hibát a feldolgozási állapot és az érintett végpont jelezzen. Identity esetén külön értékelendő az ellenőrzéshez szükséges helyi konfiguráció/kulcsállapot és az IdP pillanatnyi hálózati elérhetősége.

## 2. [P1] A migrációs keret és az ígért up/down működés nincs meghatározva

**Hely:** D-M0-02, M0-06.

A terv tetszőlegesen sorszámozott, kézzel írt SQL-fájlokat, Drizzle Kit futtatást, saját baseline-ban létrehozott migrációs nyilvántartást és minden migrációhoz `down` műveletet ír elő. Ezek együtt még nem alkotnak végrehajtható szerződést. A Drizzle dokumentált custom SQL útja generált migrációs keretet használ; a migrátor a saját alkalmazási nyilvántartását kezeli. A leírt általános `down` parancshoz nincs kiválasztott és bizonyított megoldás. [Custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations), [Drizzle Kit migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate).

**Javasolt javítás:** M0-ban a kiválasztott pinhez tartozó migrációs formátumot és futtatót bizonyítsuk. Drizzle esetén használjuk annak custom migration keretét és nyilvántartását. M1 javaslata előrefelé alkalmazott migráció és külön, eldobható tesztadatbázis újraépítése. Ha az up/down követelmény marad, előbb konkrét futtatót és visszaállítási ellenőrzést kell választani. A tranzakciós rollback ettől külön, kötelező M1-garancia.

## 3. [P2] Az Authentik lezárási feltétele ellentmond a halasztási szabálynak

**Hely:** M0-18, 5.7, 6. szakasz, R2.

A checklist működő full környezetet, discoveryt és tényleges audience-t követel, R2 viszont kifejezetten nem blokkolónak mondja az Authentik-előkészítést. Emellett a discovery önmagában nem bizonyítja a kiadott access token audience-ét; a README ehhez kiadott teszttokent is kér.

**Javasolt javítás:** M0 kötelező lezárása a core környezet és a szerződések legyenek. A full profil/Authentik előkészítés külön követett eredményként átvihető M2-be. A tényleges audience ellenőrzése a tokenkiadási próbával együtt záruljon. Ha a full környezet mégis M0-kapu marad, R2-t és az ütemezést ehhez kell igazítani.

## 4. [P2] A no-op mentés nem oldja meg az elveszett válasz utáni újrapróbálást

**Hely:** D-M0-06 no-op indoklása.

Ha a kliens v3-ról módosít, a mentés v4-ként sikerül, de a válasz elvész, az ismételt v3-as kérésnek `409`-et kell kapnia. Ha előbb a mezőegyezést vizsgáljuk, és emiatt sikert adunk, megkerüljük a README vártverzió-szabályát.

**Javasolt javítás:** a sorrend legyen rekordlétezés → várt verzió → megengedett állapot → normalizált mezők/no-op. A no-op csak aktuális verzió és szerkeszthető állapot mellett sikeres. Elveszett válasz után újraolvasás szükséges; kérésazonosító-alapú idempotencia külön bővítés.

## 5. [P2] Az authot ellenőrző smoke-próba nem a tervezett adminvégpontot hívja

**Hely:** 5.5; kapcsolódó D-M0-03.

A `GET /admin/contents` nincs a README végpontjai között. A hiányzó útvonal válasza nem bizonyítja, hogy a létrehozás, módosítás vagy publikálás megfelelően blokkolt. M0-ban ezek még csak vázak is lehetnek.

**Javasolt javítás:** M0-ban egy létező, adminvédelemmel ellátott tesztútvonal vagy a globális adminblokkolás ellenőrzése szükséges. M1-ben minden tényleges admin route/method kerüljön negatív HTTP-próbába. Az identity flag bekapcsolása önmagában ne nyisson utat: ellenőrző adapter nélkül az alkalmazás ne induljon el bekapcsolt identityvel. Tesztactor csak a tesztkörnyezetben adható át, HTTP-bodyból vagy actor headerből nem.

## 6. [P2] A smoke-lista jelenleg nem reprodukálható egyetlen sorozatként

**Hely:** 5.1–5.7.

- Többször indul háttérben az alkalmazás leállítás/PID-kezelés nélkül. A későbbi kérés a korábbi folyamatot találhatja meg, miközben az új portütközéssel leállt.
- A `.env.example` placeholderjeinek másolása után hiányzik a működő helyi értékek beállítása. Az `unset` sem zárja ki, hogy az alkalmazás `.env`-ből visszaolvassa a változót.
- A DB-jelszó logtesztje shellben elérhető DATABASE_URL-t feltételez. Üres kinyert mintával a vizsgálat hibás eredményt adhat; a redact útvonalak önmagukban nem garantálnak részszöveg-szűrést URL-ek vagy hibaüzenetek belsejében.
- A `docker compose exec -T nats nats str ls` feltételezi a kliensprogram jelenlétét a szerverkonténerben. A NATS CLI külön eszköz, elérhetőségét a választott image-ben igazolni kell, vagy külön klienskörnyezetet megadni. [NATS eszközök](https://docs.nats.io/concepts/ecosystem).

**Javasolt javítás:** egy folyamatgazdával, cleanup lépéssel és elkülönített konfigurációkkal készüljön a smoke-sorozat. Titokellenőrzéshez ismert, nem éles sentinel értékek és géppel értékelt találatmentesség szükséges. Teljes adatbázis-URL ne kerüljön logolásra. A hoston/klienskonténerben szükséges eszközöket is sorolja fel a runbook.

## 7. [P2] A verzióspike nem elég az M1-ben használt út igazolására

**Hely:** D-M0-01, M0-02.

Az ESM/Vitest irányt a NestJS v12 hivatalos migrációs útmutatója alátámasztja. Ugyanez az útmutató külön Node-minimumot ír a CLI-generáláshoz: a 24-es soron legalább 24.15 szükséges; a `24.x` önmagában túl tág. A CommonJS projektformátumot a v12 is támogatja megfelelő Node mellett, ezért az ESM-probléma önmagában nem teszi szükségessé a teljes v11-re visszalépést. [NestJS migration guide](https://docs.nestjs.com/migration-guide).

**Javasolt javítás:** pontos runtime-pin; a pinelt csomagok létezésének és peer-függőségeinek ellenőrzése; a spike tartalmazzon valódi buildet, DI-bootstrapot, tesztfuttatást, egy validált HTTP-kérést és OpenAPI-előállítást is. Fallbacknél a teljes kompatibilis csomagkészletet kell rögzíteni, nem csak a core/TS/test runner változik. A review nem igazolta tételesen az összes npm- és image-pint; a táblázat nem tekinthető installal bizonyítottnak.

## 8. [P2] A nettó becslés és az egynapos ütemezés eltér a feladattáblától

**Hely:** 4. szakasz összesítése; kapcsolódó MILESTONES M0 időkeret.

A táblázat összege **1085 perc, azaz 18 óra 5 perc**, ebből a döntési kör 60 perc. A döntési kör nélkül is 17 óra 5 perc, nem 15 óra. Csak a Codexhez rendelt B sáv 8 óra 45 perc; erre jön a szerződésmunka, fixture és közös ellenőrzés. A párhuzamosítás ezért a leírt felosztással nem indokol egy nyolcórás munkanapot. A milestone-áttekintés ráadásul M0-ra az első nap elejét szánta.

**Javasolt javítás:** külön becslés a kötelező core alapra és az előrehozott full/Authentik munkára; ezután az M1–M5 célütemezés újraértékelése. Az M1 terv becslése szintén tervezési sáv, nem vállalt határidő.

## További szerződéspontosítások az M1-hez

- **Döntési státusz:** a válasz hiánya ne változtassa az üzleti javaslatot elfogadottá. Tervezni lehet explicit munkafeltételezéssel; az elfogadás státusza ettől külön marad. Ez a dokumentum készítését nem blokkolja.
- **Slug:** kell pontos generálási időpont, üres transzliteráció kezelése, utótaggal együtt érvényes hosszlimit és adatbázisban is konkurenciabiztos ütközéskezelés. A végpontok UUID-alapúak; a slug megőrzése önmagában nem jelent már megvalósított slugos publikus útvonalat.
- **Sémabővítés:** zárt v1 eventType-készlet mellett egy új `content.updated` érték nem automatikusan kompatibilis. A jelenlegi fogyasztó ismeretlen típust karanténba tehet. Új típus előtt kompatibilitási és rollout-döntés szükséges, még azonos envelope mellett is.
- **Auditactor:** M2 előtt is explicit tesztactor legyen; ne legyen a production service-ben hiányzó actorra `system` fallback.
- **Korai rekordfoglalás:** a README egy relayt ír elő, és a több relay rekordfoglalását későbbre hagyja. A D-M0-02 `SKIP LOCKED` említése ne váljon M1-követelménnyé.
- **Tulajdonosok:** D-M0-12 Claude-hoz rendeli a `.env.example` fájlt, M0-04 mégis Codex-módosítást ír elő. Egy szerző és egy review-felelős szerepeljen. A branchnevek példák; a tényleges repószabály alapján választandók.

## Átadás a következő tervnek

Az [M1 implementációs terv](M1-IMPLEMENTATION.md) a fenti javításokat tervezési feltételként viszi tovább. Az M0 üzleti javaslataira támaszkodik, és külön jelöli a pontosításokat. Az eredeti M0 tartalmi átvezetése a közös review következő lépése.
