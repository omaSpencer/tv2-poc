# PoC – a fázisok részletes működési terve

2026-09-15 · Rendezett működési terv; az M0–M1 döntési kör lezárva.

Kiindulópont: [PoC README](README.md) és [milestone-áttekintés](MILESTONES.md). Ez a dokumentum az egyes fázisok üzleti és rendszerbeli viselkedését, döntési pontjait és bizonyítási igényét részletezi. Nem oszt fel kódolási feladatokat, nem választ adatbázis-hozzáférési könyvtárat, és nem ír elő konkrét osztályokat, táblasémákat vagy tesztimplementációt.

**Státusz:** a működési szabályok a [DECISIONS](DECISIONS.md) alapján rögzítettek. A megvalósítás és a futási bizonyíték még hátravan. A későbbi fázisokhoz rendelt technikai ellenőrzés és külső hozzáférés feladatot jelöl, nem elfogadásra váró alapdöntést.

## Közös működési alapelvek

- A PostgreSQL aktuális tartalomállapota határozza meg a publikáltságot. A keresőindex származtatott adat.
- A sikeres publikálás és a kereshetőség két külön időpont. A kereső frissítése aszinkron.
- A keresési kiesés és az eseménykézbesítés késése önmagában nem akadályozza a CMS sikeres mentését. PostgreSQL nélkül a CMS-mentés nem tekinthető sikeresnek.
- A kézbesített esemény és a sikeresen frissített index külön feldolgozási állapot. Egyikből sem következik automatikusan a másik.
- A rendszer újrakézbesítés mellett is a helyes aktuális állapotra jut. A PoC nem ígér minden részfolyamatra egyszeri végrehajtást.
- A belépés és a szerkesztői jogok nem jelentenek előfizetési vagy lejátszási jogosultságot.
- Minden fázishoz tartozik megfigyelhető eredmény. A helyreállási bizonyítékokat menet közben gyűjtjük; M5-ben az összesített elfogadás történik.

## M0 – Közös alap, scope és indíthatóság

Feladatokra bontva, rögzített döntésekkel: [M0 implementációs terv](M0-IMPLEMENTATION.md).

### Mit old meg?

A résztvevők ugyanazt értsék tartalom, publikálás, feldolgozottság és siker alatt. Legyen ismert, melyik komponens melyik adatért felel, és milyen környezetben lesz a folyamat bemutatható.

### A fázis tartalma

| Terület | Rögzítendő eredmény |
| --- | --- |
| Üzleti történet | Egy tesztvideó végigjárható útja drafttól visszavonásig és újrapublikálásig |
| Tartalom és média határa | A CMS metaadatot és médiaazonosítót kezel; a feltöltés és transzkódolás külön folyamat |
| Adatgazdák | Tartalomállapot: PostgreSQL; identitás: Authentik; eseménykézbesítés: JetStream; keresési projekció: Meilisearch |
| Környezet | Helyi PoC, egy alkalmazásfolyamat, valódi alapfüggőségek, két keresőpéldány |
| Hozzáférések | Tesztidentitások és OIDC tesztkliens; opcionális média-/DRM-hozzáférések külön listán |
| Közös fogalmak | Tartalomverzió, sikeres mentés, publikált állapot, kézbesítés, indexfrissítés, lemaradás |
| Munkamegosztás | A közös szerződések és konfiguráció felelősei; a másik résztvevőnek átadandó információ |

### Bemutatandó helyzetek

1. Új résztvevő a dokumentációból elindítja az alapalkalmazást és a PostgreSQL-t, és meg tudja állapítani, hogy azok használhatók-e.
2. Hiányzó kötelező konfiguráció esetén világos, mi akadályozza az indulást.
3. Egy opcionális médiahozzáférés hiánya látható, de nem teszi bizonytalanná az alap-PoC scope-ját.

### Döntési pontok és határok

**Rögzített:** helyi integrációs PoC; a alap-scope nem tartalmaz frontendet, termelési HA-t, Kubernetes/GitOps bevezetést vagy teljes média-előkészítést.

**Rögzített:** ugyanazt az egy mintatartalmat használjuk az összes fázis demójában, kiegészítve célzott hibás és konkurens példákkal. Ettől könnyebben követhető, hogyan épülnek egymásra az eredmények.

**Rögzített:** a minimumok, slug, jogosultsági mátrix és gazdák a DECISIONS D01/D04–D06 szerint. A tényleges providerértékek M2, a mérési eredmények M5 kimenetei.

### Mikor zárható le?

Az alap indulása reprodukálható, a kötelező és opcionális függőségek elkülönülnek, és a közös üzleti történet, fogalmak és felelősségek review-zhatók. M0 nem feltételezi az összes integráció működését; M1 üzleti döntései viszont nem maradhatnak meghatározatlanok.

## M1 – Tartalom-életciklus és mentési garanciák

### Mit old meg?

A szerkesztő megbízhatóan kezeljen egy videómetaadatot, a publikáló pedig egyértelmű szabályok szerint változtassa annak nyilvános elérhetőségét. Két egyidejű módosítás ne írja felül észrevétlenül egymást.

### A tartalom három nézete

| Nézet | Jelentés |
| --- | --- |
| Szerkesztői tartalom | A mentett metaadat és életciklusállapot; draft és withdrawn is elérhető megfelelő adminjoggal |
| Nyilvános tartalom | Kizárólag az aktuálisan published állapotú rekord nyilvános mezői |
| Keresési dokumentum | Később előállított, átmenetileg lemaradó projekció; M1-ben még nem szükséges |

### Életciklus

| Kiinduló állapot | Művelet | Eredmény | Szabály státusza |
| --- | --- | --- | --- |
| Nincs tartalom | Létrehozás | Draft | Rögzített |
| Draft | Szerkesztés | Módosított draft | Rögzített |
| Draft | Publikálás | Published, ha a minimumfeltételek teljesülnek | Rögzített |
| Published | Szerkesztés | Elutasítás | Rögzített |
| Published | Visszavonás | Withdrawn | Rögzített |
| Withdrawn | Szerkesztés | Módosított withdrawn | Rögzített |
| Withdrawn | Újrapublikálás | Published, ismételt validálással | Rögzített |
| Published | Újabb publikálás | Elutasítás, 409 content_already_published | Rögzített |
| Draft / withdrawn | Visszavonás | Elutasítás, 409 content_not_published | Rögzített |

### Mentés és nyomon követhetőség

**Rögzített:** a kliens módosításkor megadja a várt verziót. Eltéréskor `409 Conflict`, és a kérés nem hoz létre részleges változást. Sikeres állapotváltáskor a tartalom, az audit és az outbox együtt rögzül vagy együtt gördül vissza.

**Rögzített:** minden tényleges változás auditált; létrehozás v1, utána tényleges mentésenként +1. Auditactor, művelet, időpont, contentVersion, correlationId és megváltozott mezőnevek rögzülnek. Aktuális verzió és szerkeszthető állapot mellett no-op nem változtat sem verziót, sem auditot, sem időbélyeget.

**Rögzített:** draft létrehozás és draft/withdrawn szerkesztés nem bocsát ki eseményt. Publish/withdraw/republish igen. Kezdeti verzió 1; minden sikeres állapotváltás auditja és outboxa ugyanabban a tranzakcióban rögzül.

### Bemutatandó helyzetek

1. A mintatartalom létrejön, módosítható, majd a publikálási minimum teljesülése után publikálható.
2. Hiányos tartalom publikálása sikertelen; az állapot draft marad, sikeres állapotváltás auditja és eseménye nem keletkezik.
3. Két szerkesztő ugyanazt a verziót olvassa. Az első mentése sikeres, a második konfliktust kap, és újra kell olvasnia a tartalmat.
4. Mentési hiba esetén nincs félig rögzült állapotváltás, audit vagy outbox-esemény.
5. Visszavont tartalom adminoldalon megmarad, nyilvános részletként `404`; később szerkeszthető és újrapublikálható.

### Döntési pontok és határok

**Rögzített:** drafthoz cím kell; publikáláshoz cím, slug, rövid leírás, kategória és médiaazonosító. Tagek opcionálisak. A pontos hossz- és normalizálási szabályokat az M1 implementációs terv 2. szakasza rögzíti.

**Rögzített:** slug csak publikáláskor generálódik, ha null; globálisan egyedi, üres generált érték hibás. Hat kötött kategória és szabad, normalizált tagek. A mediaAssetId kizárólag adminmező; puszta jelenléte nem igazolja az asset létezését vagy lejátszhatóságát. Részletek DECISIONS D04.

**Határ:** nincs párhuzamos draft/published revíziórendszer. Videófájl-feltöltés, tartalomtörlés, időzített publikálás és többlépcsős jóváhagyás nem kerül automatikusan a scope-ba.

### Mikor zárható le?

Az életciklus, a validálás, a konkurens módosítás és a rollback eredménye ellenőrizhető PostgreSQL-en. M2 előtt ez kontrollált integrációs ellenőrzés; a valódi felhasználói demó M2-ben válik teljessé. Nincs implicit admin auth bypass.

## M2 – Identitás és szerkesztői jogosultságok

### Mit old meg?

A rendszer bizonyíthatóan megkülönböztesse, ki hívja az API-t és mire jogosult. A szerkesztői jogot az ellenőrzött identitás alkalmazásjogai igazolják.

### Jogosultsági mátrix

| Művelet | Viewer | Editor | Publisher |
| --- | --- | --- | --- |
| Saját identitás lekérése | Igen | Igen | Igen |
| Admin tartalom olvasása | Nem | Igen | Igen |
| Draft létrehozás és szerkesztés | Nem | Igen | Igen |
| Publikálás és visszavonás | Nem | Nem | Igen |
| Feldolgozási állapot olvasása | Nem | Nem | Igen |

A mátrix rögzített. Editor: content:read + content:write; publisher: ezek és content:publish + ops:read. A processing-status publishernek elérhető, editornak és viewernek nem. A konkrét ellenőrzött claim mapping M2 feladata.

**Rögzített:** a nyilvános metaadatkeresés és részletlekérés a PoC-ban login nélkül is elérhető legyen. A viewer loginját ettől függetlenül bemutatjuk. A termék későbbi nézői belépési vagy entitlement-szabályait ez nem dönti el.

### Belépési és tokenéletciklus

**Rögzített:** valódi Authentik-belépés Authorization Code + PKCE folyamatban; API-híváshoz aláírt access token, ellenőrzött issuer, audience és lejárat. Az ID token nem API access token. Kért OAuth scope önmagában nem igazolja az alkalmazásjogot.

Érvénytelen vagy hiányzó hitelesítés és hiányzó permission külön hibahelyzet. A felhasználó azonosítható lehet úgy is, hogy egy adott adminműveletre nincs joga.

### Bemutatandó helyzetek

1. Mindhárom tesztidentitás belép, és a saját ellenőrzött alkalmazásjogai láthatók.
2. Editor szerkeszt, publisher publikál, viewer tiltott adminírása `403`.
3. Lejárt, idegen issuer/audience értékű, hamis aláírású vagy rossz típusú token nem nyitja meg az API-t.
4. Refresh után az új access token használható; a token-élettartam dokumentált.
5. IdP-kieséskor korábban cache-elt ismert kulccsal ellenőrizhető egy még érvényes token. Új belépés és ismeretlen kulcs esetén ezt nem feltételezzük; nincs ellenőrzést megkerülő fallback.
6. Aláírókulcs-rotációnál ellenőrizzük az új kulcs megismerését és az átmenet tokenkezelését. Ennek végleges bizonyítéka M5-re készül el.

### Döntési pontok és határok

**Rögzített:** csoportok és jogok, access token 5 perces és refresh session 1 órás cél-élettartama a DECISIONS D06 szerint. A tényleges issuer/audience/JWKS URI, beállítható élettartamok és kulcsrotáció tokenpróbával M2-ben igazolandók. Offline visszavonás célablaka legfeljebb 5 perc 30 másodperc a már kiadott tokenre.

**Határ:** nincs saját jelszókezelés, teljes felhasználókezelő UI, fizetős előfizetés vagy lejátszási engedélyezés.

### Mikor zárható le?

M1 folyamata valódi identitásokkal végigjárható, és a pozitív/negatív jogosultsági eredmények megfelelnek az egyeztetett mátrixnak. A refresh és alap tokenhibák bizonyítottak; a M5-re átvitt rotációs és kiesési ellenőrzések név szerint követhetők.

## M3 – Tartós eseménykézbesítés

### Mit old meg?

A sikeres tartalommentésből származó feldolgozási igény túlélje az átmeneti infrastruktúrahibát. A CMS-válasz és a háttérfeldolgozás előrehaladása külön megfigyelhető legyen.

### Feldolgozási jelentések

| Állapot | Mit bizonyít? | Mit nem bizonyít még? |
| --- | --- | --- |
| Tranzakció rögzítve | A tartalom és a hozzá tartozó kötelező audit/outbox együtt mentve | Esemény kézbesítése |
| Outbox függőben | A kézbesítési igény megvan, még nincs kézbesítettnek jelölve | JetStream vagy index állapota |
| JetStream publish ACK megvan | Az esemény elfogadását a JetStream visszaigazolta | Fogyasztói feldolgozás |
| Outbox kézbesített | A relay ACK után rögzítette a kézbesítést | Mindkét kereső frissessége |
| Fogyasztói ACK | Az adott index művelete sikeresen befejeződött | A másik index állapota |

M3 az első négy állapotot bizonyítja; az indexeredményhez kötött fogyasztói ACK M4-ben kap teljes jelentést.

### Az esemény tartalmi szerződése

**Rögzített:** egyértelmű eventId, sémaverzió, művelettípus, tartalomazonosító, tartalomverzió, időpont és correlation ID. Token, e-mail és médiakulcs nem kerül az eseménybe.

A keresési fogyasztó az azonosító alapján az aktuális PostgreSQL-állapotot projektálja. Az esemény ezért változási jelzés, és nem egy történeti állapot teljes másolata. A későbbi fogyasztók ettől eltérő adatigénye külön szerződésmódosítást kívánhat.

### Bemutatandó helyzetek

1. Normál publikáláskor az outbox-bejegyzés létrejön, a JetStream elfogadja az eseményt, majd a relay kézbesítettnek jelöli.
2. NATS-kiesés alatt a publikálás menthető, az esemény függőben marad. Visszatéréskor a feldolgozás folytatódik.
3. A relay publish ACK után, a kézbesítettnek jelölés előtt leáll. Újrainduláskor ugyanaz az esemény újraküldhető ugyanazzal az eventId-val.
4. Növekvő outbox és legöregebb függő esemény alapján látható a feldolgozás elakadása; az esemény correlation ID-val követhető.

### Döntési pontok és határok

**Rögzített:** egy relay, tartós CONTENT stream, külön A/B durable fogyasztók, helyi R1. A deduplikációs időablak nem váltja ki az idempotens feldolgozást.

**Rögzített:** retention 7 nap, 1 GiB és 1 millió üzenet; kapacitáskorlátnál új publikálás elutasítása, outbox megőrzése. Publish ACK timeout 5 másodperc; fokozatos retry 1–30 másodperc között. A pontos konfiguráció és további paraméterek a DECISIONS D08-ban, működésük bizonyítása M3-ban.

**Határ:** átmeneti kiesés és újraindítás vizsgálata; teljes NATS-adatvesztés, több relay és termelési redundancia nem kap automatikus garanciát.

### Mikor zárható le?

A normál kézbesítés, a kiesés alatti mentés és a relay bizonytalan befejezés utáni újraküldése reprodukálható. A kézbesített és még feldolgozatlan állapotot a demó nem keveri össze. Az újraküldés keresőre gyakorolt hatását M4–M5 bizonyítja.

## M4 – Nyilvános keresés és két független projekció

### Mit old meg?

A néző megtalálja a publikált tartalmat, egy keresőpéldány kiesése mellett is. A kereső lemaradása ne tegye a már visszavont tartalmat nyilvános találattá.

### Két együttműködő folyamat

**Indexelés:** A és B külön előrehaladással dolgozza fel a változásokat. Az aktuálisan published tartalom bekerül az indexbe, más állapot törlést eredményez. Indexenként soros feldolgozás indul, és a Meilisearch task sikeres befejezése szükséges a fogyasztói ACK-hoz.

**Olvasás:** az API A-n keres, meghatározott időkorlátos hiba esetén B-re vált. A találatazonosítókat PostgreSQL-ben visszaellenőrzi, és onnan adja a nyilvános metaadatokat. Ha egyik kereső sem használható, `503`; az adatbázis-ellenőrzés elmaradása nem jogosít stale metaadat kiszolgálására.

### Láthatóság és elfogadott lemaradás

| Helyzet | Elvárt nézői eredmény |
| --- | --- |
| Frissen publikált, még nem indexelt tartalom | Részletként elérhető; keresésből átmenetileg hiányozhat |
| Visszavont, indexben még szereplő tartalom | Az aktuális DB-ellenőrzés kiszűri; részletlekérés `404` |
| Lemaradó B-re váltott olvasás | Hiányos vagy rövidebb találati oldal elfogadható, visszavont tartalom kiszolgálása nem |
| Mindkét index kiesett | Keresés `503`; CMS-mentés a többi szükséges függőség állapotától függően működik |

A láthatósági ellenőrzés az olvasáskor megfigyelt adatbázis-állapotra vonatkozik. Egy már folyamatban lévő válasz és egy vele párhuzamos visszavonás pontos időbeli viszonyát ez nem teszi globálisan atomivá. A demó külön igazolja a visszavonás mentése után indított olvasások viselkedését.

### Bemutatandó helyzetek

1. A mintatartalom publikálás után mindkét indexben megjelenik; mérhető a kereshetőség késése.
2. B leáll; A tovább frissül és kereshető. B visszatér, és saját lemaradását behozza.
3. A leáll; B-re történik olvasási fallback. A visszatérése után saját feldolgozása folytatódik.
4. Visszavonás alatt az egyik index lemarad; onnan származó találat is kiesik a DB-alapú szűrésen.
5. Egy indexművelet taskja sikertelen. Nem történik sikeres consumer ACK; átmeneti hibánál késleltetett retry következik.
6. Értelmezhetetlen esemény karanténba kerül. Az eredeti üzenet csak a karanténpublikálás ACK-ja után nyugtázható.

### Döntési pontok és határok

**Rögzített:** title/tags/summary sorrend, kategória egyenlőségszűrő, query 1–200 karakter, oldal alap 20/max 100, offset max 1000. A/B kérésenként 1 másodperces timeout; hálózati, timeout, 429/5xx hiba fallbacket indít, üres találat és hibás klienskérés nem. Retry és karantén a DECISIONS D08 szerint.

**Rögzített:** az első demó cím-, leírás- és tagalapú keresést ellenőrizzen néhány előre rögzített magyar példán. A relevancia finomhangolása és összetett facetták későbbi bővítés legyen.

**Határ:** a rangsor és az indexből származó találatszám átmenetileg elavulhat. Két helyi konténer alkalmazásoldali hibakezelést bizonyít; független hibazónákat és termelési HA-t nem.

### Mikor zárható le?

A teljes üzleti út és a két index független kiesési/felzárkózási viselkedése bemutatható. A keresési találat és a nyilvános részlet mindegyik vizsgált állapotban megfelel a publikálási szabálynak. A retry és a karantén külön igazolt helyzet.

## M5 – Helyreállási bizonyítékok és PoC-elfogadás

### Mit old meg?

A PoC értékelése megismételhető tapasztalatra épüljön. Legyen világos, mely hibákból áll helyre, mennyi ideig tart a feldolgozás, és mely állításokhoz nincs még bizonyíték.

### Bizonyítási területek

| Terület | Bizonyítandó állítás |
| --- | --- |
| Tranzakció | Sikertelen műveletből nincs félkész tartalom/audit/outbox |
| Relay-újraindítás | Publish ACK utáni megszakítás nem veszti el a kézbesítési igényt |
| Fogyasztó-újraindítás | Indexírás utáni, ACK előtti megszakítás és redelivery helyes végállapothoz vezet |
| Régi esemény | Visszavonás utáni régi publish replay nem teszi újra láthatóvá a tartalmat |
| Függőségkiesések | NATS, A, B és A+B kiesésére a korábbi fázisokban leírt eredmény következik |
| Identity-hibák | Refresh, kulcsrotáció és IdP-kiesés nem nyit jogosulatlan hozzáférést |
| Hibás üzenet | Retry és karantén eltérő helyzetekre alkalmazva, visszakövethető eredménnyel |
| Teljes reindex | Üres indexből az aktuális publikált állomány felépíthető, közben érkező változásokkal együtt |
| Megfigyelhetőség | Események és lemaradások követhetők, tokenek és secretek nem jelennek meg a logban |
| Reprodukálhatóság | Új környezetből dokumentáltan végigjárható a normál és a hibás folyamat |

### Újraépítés elvárt viselkedése

Az érintett index élő fogyasztójának koordinált megállítása után PostgreSQL-ből felépül a projekció, majd a közben felgyűlt változások feldolgozása következik. A végállapotnak az aktuális publikált tartalmakhoz kell konvergálnia.

**Rögzített:** reindex alatt tartós rebuilding jelzés, az érintett index kimarad a routingból. Teljes import és rögzített catch-up határ feldolgozása után, függő task nélkül, a demóban szüneteltetett írások melletti DB/index egyezéssel kerül vissza. Megszakítás után rebuilding marad és új teljes futás indul. A konkrét snapshot/stream-határ koordináció M5 implementációs feladata; működési feltételek DECISIONS D09.

### Mérés és értelmezés

Kiinduló minta a README-ből: 1000 szintetikus tartalom és 100 publikálási/visszavonási ciklus. Rögzítjük a gépet, verziókat, adatmennyiséget, párhuzamosságot, hibaarányt és az idők eloszlását.

- Publikálás → kereshetőség: a sikeres mentéstől az adott indexből elérhető találatig, A-ra és B-re külön.
- Outbox pending és oldest-age: a ki nem kézbesített igény mennyisége és legöregebb elemének kora.
- Indexenkénti lemaradás: broker pending + in-flight, valamint a legöregebb ismert be nem fejezett esemény kora; outbox külön. Catch-up idő: a visszatéréstől a rögzített feldolgozási határ eléréséig. Ezek nem globális tranzakciós snapshotok; részletek DECISIONS D09.
- Reindexidő: az újraépítés kezdete és az elfogadott aktuális végállapot között eltelt idő, a catch-upot is figyelembe véve.

**Rögzített:** nincs numerikus teljesítmény-SLO a PoC lezárásához. Helyes végállapot, a kötelező helyreállási esetek sikere és a p50/p95/max/hibaarány jegyzőkönyve szükséges. Öt percen belül helyre nem álló hibapróba sikertelen/befejezetlen eredmény, nem kihagyható mérés.

### Mikor zárható le?

A README PoC-zárási checklistje teljes egészében bizonyítékhoz rendelhető. Minden forgatókönyvnél szerepel kiinduló állapot, beavatkozás, elvárt és megfigyelt eredmény, valamint a helyreállás ellenőrzése. Sikertelen kötelező esetnél a lezárás nyitva marad.

Az átadás része a futtatási és helyreállási útmutató, a demó, a bizonyítékjegyzék, a mérési eredmény és a következő kör prioritásai. Az éles infrastruktúra, mentés/DR, biztonsági felülvizsgálat és kapacitástervezés külön következő munkák; a PoC lezárása ezeket nem helyettesíti.

## M6 – Opcionális média-, DRM- és playback-kör

### Mit old meg?

Az alapfolyamatra építve pontosítja, hol csatlakozik a tartalom a valódi médiafolyamathoz és a későbbi lejátszási engedélyezéshez. Három külön részterület; egyik sikere sem igazolja automatikusan a másikat.

| Részterület | Elérendő eredmény | Külső előfeltétel |
| --- | --- | --- |
| Ant Media | Valódi tesztasset állapot és manifest-hivatkozás, külön saját/szolgáltatói azonosító | Tesztkörnyezet, hozzáférés és ismert tesztasset |
| DRM / delivery policy | A README AES-128 és későbbi multi-DRM fázisainak szerződése; tényleges próba külön kijelölt scope-pal | Valódi próbához packager, kulcs-/licencszolgáltatás, megfelelő manifest és player |
| Playback-authorize | Bemenet/kimenet és entitlement snapshot minta a későbbi Go szolgáltatáshoz | Egyeztetett üzleti jogosultsági szabályok |

### Bemutatandó helyzetek

1. A CMS azonosító és szolgáltatói médiaazonosító egyértelműen összerendelhető; valódi adapterrel a kész és nem kész asset állapota megkülönböztethető.
2. Médiaellenőrzéssel bővített publikálás csak kész assetnél sikeres; nem kész állapot 422, szolgáltatói kiesés 503, állapotváltás nélkül. Külső ellenőrzés nem tarthat content sorzárat. A szolgáltatói készállapot tényleges leképezése az adapterpróba kimenete.
3. A delivery policyból világos, mely lejátszási mód elvárt, és milyen külső szolgáltatások kellenek hozzá. A feature flag önmagában nem bizonyít titkosítást.
4. A playback-szerződés példáin külön értelmezhető a nem publikált tartalom, a hiányzó entitlement és a megfelelő üzleti engedély. A DRM-licenc kiadása ettől külön lépés.

### Döntési pontok és lezárás

**Külső előfeltétel:** sandbox és tényleges entitlement-szabályok Zolitól M6 előtt. Rögzített scope: Ant Media állapot/manifest adapter és delivery/playback szerződés; valódi DRM-próba külön későbbi kör. Addig csak egyértelműen szintetikus jogosultságpélda használható, DECISIONS D10 szerint.

A részterületek önállóan értékelhetők. Szerződés, fake/szimulált működés és valódi adapterpróba külön státuszt kap. M6 nem akadályozza az alap-PoC lezárását; a NestJS-be nem kerül végleges playback hot path.

## A tervezési kör lezárása

A működési döntések és az M0–M1 review eltérései a [DECISIONS](DECISIONS.md) alapján rendezettek. A [milestone-terv](MILESTONES.md) 17 munkanap + 2 nap tartalék keretet ad. A konkrét M0/M1 feladatok a két implementációs tervben követhetők.

A tényleges dependency-kompatibilitás, OIDC provideradat, mért feldolgozási idők és külső hozzáférések a megvalósítás kijelölt kimenetei. Ezeket futási bizonyíték nélkül nem minősítjük teljesítettnek.
