# M0–M3 implementáció – részletes code review

**Dátum:** 2026-09-16  
**Minősítés:** változtatások szükségesek; az M0–M3 együtt még nem tekinthető lezártnak.  
**Megállapítások:** 2 × P1, 9 × P2, 1 × P3. P1: magas prioritású működési/adatintegritási hiba; P2: javítandó működési vagy elfogadási hiba; P3: kisebb, hosszabb távon jelentkező probléma.

A legerősebb rész az M1 tranzakciós életciklus: a valódi PostgreSQL-lel végzett konkurencia- és rollback-próbák sikeresek. A legsúlyosabb hibák az M3 megfigyelhetőségében és a full smoke adatizolációjában vannak. A 85 sikeres meglévő teszt mellett a célzott review-próbák több olyan hibát is reprodukáltak, amelyet a jelenlegi tesztek nem fednek le.

## 1. Vizsgált állapot és módszer

A review alapja a `eebace0057d32fa7afc69e859a7d48db0c303d96` HEAD **és az aktuális munkakönyvtár összes M0–M3-módosítása**, beleértve a még nem követett M2 identity fájlokat és Authentik-blueprintet. Ez nem kizárólag commit- vagy diff-review.

Átnézett területek: backend bootstrap/config/HTTP/health; szerződések és permissionök; content service/repository/controllerek; Drizzle-séma és migrációk; JWT/discovery/JWKS/claim mapping; outbox/relay/JetStream-topológia és processing-status; Compose, reset-, smoke- és demóscriptek; integrációs tesztek és teszt-összeállítások; M0–M3 tervek és bizonyítékjegyzőkönyvek. A frontend, M4 kereső és M6 média nem része ennek a review-nak.

Az alkalmazáskódot nem javítottam. A review mellé készült egy [külön reprodukciós script](/Users/busizoltan/code/tv2-poc/poc/review/m0-m3-reproduce.mjs), amely a buildelt kódot hívja, helyi JWKS-szervert indít, és explicit eldobható tesztadatbázist kér. A leállítás és retry próbája ellenőrzött broker-helyettesítőt használ; a dátumkonverziós próba valódi PostgreSQL-t, a smoke-adateltérítés valódi JetStreamet is használt.

## 2. Prioritásos megállapítások

### R01 · P1 · A full smoke elviszi és utána törli a meglévő outbox-eseményeket

**Hely:** [smoke-full.mjs:156](/Users/busizoltan/code/tv2-poc/poc/backend/scripts/smoke-full.mjs:156), a céladatbázis kiválasztása a 95., a stream törlése a 183. sorban.

A runner a `SMOKE_EXTERNAL_DATABASE_URL` vagy a normál `DATABASE_URL` adatbázisán indít relayt, miközben a célstreamet és subjectet saját `SMOKE_<id>` értékre állítja. Nem hoz létre saját adatbázist, és nem korlátozza a relayt saját fixture-eseményre. A relay ezért az adatbázis **összes függő sorát** elolvashatja, az ideiglenes streambe publikálhatja és kézbesítettnek jelölheti. A cleanup ezután törli ezt a streamet.

**Hatás:** a rendes CONTENT stream és fogyasztói nem kapják meg ezeket az eseményeket; a normál relay sem küldi őket újra, mert `delivered_at` már nem null. A tartalomadat megmarad, de az eseménykézbesítés elveszik. Nem szükséges hozzá hibás broker vagy párhuzamos futás.

**Reprodukció:** kizárólag a review saját adatbázisában egy függő eseményt hagytam. A runner eredménye `PASSED (5 checks)` volt, a függő események száma pedig **1 → 0**, miközben a cleanup törölte az ideiglenes célstreamet.

**Javítás:** saját adatbázis/séma és saját fixture, ellenőrzött eldobható cél; a normál `DATABASE_URL` ne legyen implicit, módosítható smoke-cél. A stream és a DB izolációja együtt szükséges.

**Regressziós próba:** legyen egy, a smoke-on kívül létrehozott függő esemény; a smoke után annak minden mezője és kézbesítési állapota maradjon változatlan.

### R02 · P1 · Függő outbox mellett a processing-status végpont 500-ra fut

**Hely:** [outbox.repository.ts:97](/Users/busizoltan/code/tv2-poc/poc/backend/src/outbox/outbox.repository.ts:97), felhasználás: [processing-status.controller.ts:68](/Users/busizoltan/code/tv2-poc/poc/backend/src/ops/processing-status.controller.ts:68).

A `sql<Date | null>` csak TypeScript-típusjelölés, nem futásidejű dátumkonverzió. A telepített Drizzle PostgreSQL-driver a nyers `min(occurred_at)` eredményét stringként adja vissza. A controller ezen `toISOString()` és `getTime()` metódust hív.

**Reprodukció:** valódi PostgreSQL mellett `pending=1`, `typeof oldestOccurredAt === 'string'`, `instanceof Date === false`. A controller közvetlen hívása `stats.oldestOccurredAt?.toISOString is not a function` hibával állt le; ezt a HTTP filter `500 internal_error` válasszá alakítja.

**Hatás:** éppen lemaradás vagy NATS-kiesés közben nem olvasható az operátori állapot. Üres outboxnál a null érték miatt a hiba rejtve marad. A jelenlegi M3-T12 már kézbesített eseménnyel ellenőrzi a végpontot; a T14 nem hoz létre függő eseményt.

**Javítás:** explicit Drizzle decoder vagy ellenőrzött dátumkonverzió a repository határán. A visszatérési típus a tényleges futásidejű értéket írja le.

**Regressziós próba:** hitelesített publisherrel lekérés legalább egy pending sor mellett, relay off és broker-kiesés esetén is; 200, érvényes ISO-idő és nem negatív oldestAgeMs.

### R03 · P2 · Az M2 Compose-kulcsok elrontották az M0 core smoke indulását

**Hely:** [smoke-m0.mjs:250](/Users/busizoltan/code/tv2-poc/poc/backend/scripts/smoke-m0.mjs:250).

A runner saját Compose-env fájlja nem tartalmazza az új `AUTHENTIK_BOOTSTRAP_PASSWORD`, `AUTHENTIK_BOOTSTRAP_TOKEN` és `AUTHENTIK_POC_USER_PASSWORD` értékeket. A Compose ezeket a teljes fájl interpolálásakor megköveteli akkor is, ha csak a core `postgres` szolgáltatás indulna.

**Reprodukció:** tiszta környezetben a `node scripts/smoke-m0.mjs` még szolgáltatásindítás előtt 1-es exitkóddal leállt: `required variable AUTHENTIK_POC_USER_PASSWORD is missing a value`. Külön `compose config -q` is igazolta a hiányzó új változók problémáját.

**Hatás:** a dokumentált friss M0 smoke nem reprodukálható. A korábbi 6/6 jegyzőkönyv nem bizonyítja a jelenlegi Compose és runner együttműködését.

**Javítás:** a saját env-generátorba kerüljenek be a szükséges, kizárólag tesztcélú értékek, vagy a core Compose-konfiguráció váljon függetlenné a full profil titkaitól.

**Regressziós próba:** core smoke olyan process environmenttel, amelyben semmilyen Authentik-kulcs nincs.

### R04 · P2 · A valódi tokenes M2-demó minden esetben hibás PORT-konfigurációval indul

**Hely:** [demo-m2.mjs:47](/Users/busizoltan/code/tv2-poc/poc/backend/scripts/demo-m2.mjs:47).

A script egyszerre ír `NODE_ENV=development` és `PORT=0` értéket. A közös configvalidátor a nullás portot kizárólag `NODE_ENV=test` mellett engedi. Emiatt a demó az első HTTP-kérés előtt leáll, a token érvényességétől és Authentik elérhetőségétől függetlenül.

**Reprodukció:** megadott issuer és dummy token mellett `startup_failed / invalid_configuration / keys:["PORT"]`. Ehhez nem kellett IdP vagy adatbázis-kapcsolat.

**Javítás:** a smoke-child szerződésének megfelelő tesztmód és dinamikus port, vagy development módban érvényes nem nulla port. A hibaágban hívott `process.exit()` helyett a cleanupot biztosan lefuttató kilépés is szükséges: a jelenlegi `fail()` a `finally` erőforrás-takarítását is megkerülheti.

**Regressziós próba:** script-szintű indulás mock issuerrel, majd külön hibás HTTP-válasz esetén a saját child és ideiglenes konfiguráció takarításának ellenőrzése.

### R05 · P2 · A relay leállítási grace periodja nem valódi felső korlát

**Hely:** [relay.ts:124](/Users/busizoltan/code/tv2-poc/poc/backend/src/messaging/relay.ts:124).

A `Promise.race()` csak az első várakozást korlátozza. Utána a kód feltétel nélkül megvárja a teljes `this.loop` promise-t, amely továbbra is ugyanazon aktív műveletre vár. A broker bezárása is csak ezután következne.

**Reprodukció:** függő publish mellett `stop(20)` 150 ms után sem teljesült; csak a publish kézi elengedése után tért vissza. A 20 ms a tesztben választott grace érték, ugyanaz a vezérlési hiba az 5000 ms-os normál leállítást is érinti. A tényleges késés a függő DB/broker művelettől és annak saját timeoutjától függ.

**Miért maradt rejtve:** M3-T19 közvetlenül a `stop(500)` után elengedi a blokkolt műveletet, és nem mér eltelt időt.

**Javítás:** a határidő a teljes stop-folyamatra vonatkozzon; lejáratkor a broker/függő munka megszakítását is el kell indítani. Ne lehessen a háttérben maradt régi ciklus mellett új ciklust indítani.

**Regressziós próba:** a művelet maradjon blokkolva a grace lejárta után is; ellenőrizni kell a leállás idejét és a késői teljesülés hatását.

### R06 · P2 · Új CMS-események megszakítják a hibák utáni retry-backoffot

**Hely:** [relay.ts:170](/Users/busizoltan/code/tv2-poc/poc/backend/src/messaging/relay.ts:170).

A retry ugyanazt az `OutboxWake.wait()` jelzést használja, mint az üres polling. A ContentService minden sikeres publish/withdraw után `signal()`-t hív. Ezek a jelzések a brokerhiba utáni kötelező várakozást is azonnal befejezik.

**Reprodukció:** folyamatosan hibázó broker és öt új wake-jel mellett körülbelül 60 ms alatt **6 publish-kísérlet** történt. A dokumentált első retry legkorábban 800 ms után következhetne az 1 s ±20% szabályból.

**Hatás:** kiesés vagy streamkapacitás-hiba alatt a CMS-forgalom a backofftól függetlenül újabb próbálkozásokat generál, és a logban megadott delay nem a tényleges várakozás lesz.

**Javítás:** a retry-időzítő csak shutdown által legyen megszakítható, vagy használjon abszolút következő-próbálkozási időpontot. Az új esemény wake-je csak az idle pollingot gyorsítsa.

**Regressziós próba:** hibázó broker mellett közben érkező wake-jelekkel mérni a kísérletek időpontjait.

### R07 · P2 · A verifier elfogadja a tolerancián túl jövőbeli iat claimet

**Hely:** [token-verifier.ts:85](/Users/busizoltan/code/tv2-poc/poc/backend/src/identity/token-verifier.ts:85).

A terv 2.3 szerint a jövőbeli `iat` is elutasítandó. A telepített `jose` a jövőbeli issued-at ellenőrzését a `maxTokenAge` ágon végzi; a jelenlegi `jwtVerify` opciók ezt nem aktiválják, és utólag sincs saját ellenőrzés.

**Reprodukció:** megbízható tesztkulccsal aláírt, megfelelő issuer/audience értékű token `iat=now+3600`, `exp=now+3900` mellett elfogadott lett, publisher szereppel.

**Hatás:** eltérés a rögzített token-időérvényességi szerződéstől. Ez nem aláírás-megkerülés: az elfogadott tokenhez továbbra is megbízható aláírás kell.

**Javítás:** explicit `iat <= now + tolerance` ellenőrzés, vagy a kívánt tokenkor-szabállyal együtt helyesen beállított `maxTokenAge`.

**Regressziós próba:** `iat` a tolerancián belül és kívül; a hiányzó `iat` kezelését is az elfogadott szerződés szerint rögzíteni kell.

### R08 · P2 · A JWKS HTTP 503 válasza hibásan 401 hitelesítési hibává válik

**Hely:** [token-verifier.ts:166](/Users/busizoltan/code/tv2-poc/poc/backend/src/identity/token-verifier.ts:166).

A hálózati kivételek és timeoutok 503-ra képeződnek, de a HTTP-válasszal jelzett JWKS-kiesés nem illeszkedik ezekre az ágakra. A `jose` nem 200-as JWKS-válaszra adott hibája végül a `reject('signature')` ágra jut.

**Reprodukció:** helyi JWKS-szerver üres klienscache mellett HTTP 503-at adott; a verifier eredménye **401 / unauthenticated** lett.

**Hatás:** a kliens érvényes tokent tekinthet hibásnak, új belépést kezdeményezhet, miközben valójában az IdP függőség hibás. A terv discovery/JWKS hálózati hibára 503-at ír elő.

**Javítás:** a JWKS-letöltés/protokoll hibáit strukturáltan külön kell választani az aláírás- és claimhibáktól; ne csak message-regex határozza meg a besorolást.

**Regressziós próba:** JWKS HTTP 500/503, hibás JSON és timeout külön; hamis aláírás és ténylegesen ismeretlen kulcs továbbra is 401.

### R09 · P2 · A full smoke kézbesítés nélkül is sikeres kézbesítést jelent

**Hely:** [smoke-full.mjs:172](/Users/busizoltan/code/tv2-poc/poc/backend/scripts/smoke-full.mjs:172).

A `full.m3 relay delivers one publish` próba nem hoz létre tartalmat/eseményt, nem ellenőriz `delivered_at` értéket, és nem olvas vissza üzenetet a streamből. Csak readiness-t, két általános logszöveg egyikét és fél másodperc múlva a folyamat életben létét nézi. A relay halt állapotban is életben tartja az API-t, ezért ez sem bukna el ezen az ellenőrzésen.

A hiányzó Authentik L2 és M4 kereső is `PASS ... pending` sorral kerül a sikeres ellenőrzések közé. A reprodukált kimenet mindkét pending sort tartalmazta, mégis `PASSED (5 checks)` lett.

**Hatás:** a zöld smoke nem bizonyítja a nevében állított eseményutat. Ez az R01-től külön hiba: az adatizoláció javítása után is megmaradna a hamis siker.

**Javítás:** saját fixture-eseményre bizonyított publish ACK, DB-jelölés és stream-envelope egyezés. A PASS/FAIL/PENDING külön állapot legyen; a teljes kapu eredménye ne számolja a hiányzó próbát sikernek.

**Regressziós próba:** szándékosan hatástalan/halted relay esetén a kézbesítési smoke bukjon; konfigurálatlan L2 maradjon pending.

### R10 · P2 · Az OpenAPI-ból hiányoznak a kérés- és válaszsémák

**Hely:** [admin-content.controller.ts:25](/Users/busizoltan/code/tv2-poc/poc/backend/src/content/admin-content.controller.ts:25); a probléma a többi controlleren és health/problem válaszokon is jelen van.

A `@Body() body: unknown` és a TypeScript-only view típusok alapján a Swagger nem tud sémát készíteni. Az `ApiResponse` dekorátorokban csak leírás van; nincs megfelelő `ApiBody`, válaszschema vagy runtime DTO.

**Reprodukció:** az aktuális buildből generált dokumentumban a `POST /admin/contents` műveletnek nincs `requestBody` mezője, a 201 válaszhoz nincs content/schema, a `components.schemas` értéke `{}`.

**Hatás:** Swagger UI-ból nem derül ki a szükséges body, és a specifikációból nem generálható érdemi típusos kliens. Az expectedVersion, nullability, admin/public mezők és problem+json szerződés sincs géppel feldolgozhatóan dokumentálva. A jelenlegi smoke csak a route létezését ellenőrzi.

**Javítás:** explicit sémák vagy a Zod-szerződésekből előállított OpenAPI request/response definíciók, új párhuzamos validációs szabályrendszer nélkül.

**Regressziós próba:** dokumentumellenőrzés a kötelező mezőkre, expectedVersion típusára, public/admin különbségekre és hibaválaszokra.

### R11 · P2 · Hibás issuer URL mellett a bekapcsolt identity elindul

**Hely:** [config.ts:24](/Users/busizoltan/code/tv2-poc/poc/backend/src/config.ts:24).

Az `OIDC_ISSUER_URL` és az opcionális `OIDC_JWKS_URI` kizárólag nem üres stringként validálódik. A terv kifejezetten helyi indulási URL-formátumellenőrzést ír elő. A `not-a-url` issuer ezért elfogadott config, majd az első tokenellenőrzés során IdP-kiesésként jelentkezik.

**Reprodukció:** `validateConfig` identity on és `OIDC_ISSUER_URL='not-a-url'` mellett sikeres.

**Hatás:** determinisztikus helyi konfigurációs hiba csak futásidőben válik láthatóvá; a PostgreSQL-only readiness közben zöld maradhat.

**Javítás:** URL- és megengedett protokollvalidálás a feature bekapcsolásakor; az esetleges localhost HTTP kivétel tudatos megtartásával. A discovery/JWKS hálózati lekérése ettől még maradjon lusta.

**Regressziós próba:** hibás issuer és explicit JWKS URI → titokmentes ConfigurationError, a megfelelő kulccsal, listen előtt.

### R12 · P3 · Az idle wake-várakozások timeout után callbackeket tartanak életben

**Hely:** [outbox.wake.ts:28](/Users/busizoltan/code/tv2-poc/poc/backend/src/outbox/outbox.wake.ts:28).

Timeoutkor csak a külső promise oldódik fel. A `this.waiter` ugyanarra a feloldatlan belső promise-ra mutat tovább, és minden új poll új `.then()` callbacket csatol hozzá. Új esemény vagy stop nélkül ezek felhalmozódnak; az első későbbi signal mindegyiket lefuttatja.

**Bizonyítás szintje:** statikus vezérlés-/élettartam-elemzés; hosszú idejű heapmérés nem készült.

**Hatás:** hosszú idle futás alatt növekvő memóriahasználat és későbbi egyszeri callback-terhelés. A rövid PoC-demókban várhatóan kevésbé jelentős.

**Javítás:** timeout és signal közös, egyszer lefutó cleanupot használjon, amely eltávolítja az adott waitert; az esetleg párhuzamos waiterek viselkedése legyen egyértelmű.

**Regressziós próba:** sok timeout signal nélkül, majd egy signal; csak aktív várakozások maradjanak nyilvántartva.

## 3. Futtatási eredmények és korlátok

| Ellenőrzés | Eredmény | Értelmezés |
| --- | --- | --- |
| TypeScript build | PASS | A vizsgált munkakönyvtár lefordul. |
| Lint | FAIL | `scripts/demo-m2.mjs:93`, `unicorn/no-invalid-fetch-options`; a kapu jelenleg piros. |
| Migrációk friss review-adatbázison | PASS | Mindkét migráció alkalmazódott. |
| Teljes meglévő Vitest-csomag, teljes alapkonfigurációval | **85/85 PASS, 9 fájl** | M0–M1 50, M2 18, M3 17 eset; valódi PostgreSQL és NATS. |
| Core smoke, Compose mód | FAIL | R03, az indulás előtti Compose-interpolációnál. |
| Full smoke, saját review-adatbázis | Formálisan PASS | R01 és R09 miatt nem elfogadható kapubizonyíték. |
| M2 demó indulása | FAIL | R04, még tokenellenőrzés előtt. |
| Célzott review-próbák | R02, R05–R08, R11 reprodukálva | R05/R06 ellenőrzött broker-helyettesítővel. |
| OpenAPI-generálás | R10 reprodukálva | Üres components.schemas, hiányzó requestBody. |
| Valódi Authentik login/refresh/kiadott tokenek | Nem futott | Az L2 lezárást ez a review sem igazolja. |

A lint megállapítás kapuhiba: önmagában nem bizonyítja, hogy a dinamikus request helper futáskor ténylegesen GET bodyt küld. A javítást a valós GET/POST/PATCH útvonalakhoz igazítva kell elvégezni.

**Környezet:** a gép alapértelmezett Homebrew Node-ja hiányzó ICU könyvtár miatt nem indul. A review az elérhető beépített **Node v24.19.0** runtime-mal futott. Ez a manifest `>=24.20.0 <25` minimumánál egy patchszinttel régebbi, ezért a sikeres teszteket nem minősítem a rögzített toolchain teljes bizonyításának. A PostgreSQL 17 és NATS a már futó helyi szolgáltatás volt; külön `review_m0m3_0916_test` adatbázissal és egyedi tesztstreamekkel dolgoztam.

Az első, szűkebb környezettel indított integrációs futás `PORT, LOG_LEVEL` konfigurációs hibára futott. A teszt-összeállítások az AppModule statikus importjánál már validálnak, ezért a `beforeAll`-ban beállított környezet nem pótolja minden esetben a korai konfigurációt. A teljes környezet megadása után lett 85/85 az eredmény. A sandboxon belüli listener-indítás hibáit nem számoltam alkalmazáshibának; a hálózatot igénylő próbákat engedélyezett helyi futtatással ismételtem meg.

Reprodukció a projekt által előírt Node-verzióval és előzetesen migrált, kizárólag review-célú adatbázison:

```sh
cd /Users/busizoltan/code/tv2-poc/poc/backend
export NODE_ENV=test PORT=0 LOG_LEVEL=silent
export FEATURE_IDENTITY=off FEATURE_OUTBOX_RELAY=off
export FEATURE_SEARCH=off FEATURE_MEDIA=off
export DATABASE_URL='<eldobható review-adatbázis URL-je>'
export TEST_DATABASE_URL="$DATABASE_URL"
export NATS_URL='<helyi tesztbroker URL-je>'
npm run build
npm run lint
npm run db:migrate
npm test
node ../review/m0-m3-reproduce.mjs
```

A review-script megfigyeléseket ír ki, nem a javított viselkedést assertelő regressziós teszt. Saját content/audit/outbox sorokat hoz létre; csak eldobható `_test` adatbázison használható. A full smoke veszélyes reprodukcióját szándékosan nem indítja automatikusan.

Mentett bizonyítékok: [85 teszt futási naplója](/Users/busizoltan/code/tv2-poc/poc/review/m0-m3-test-run.log), [célzott próbák eredményei](/Users/busizoltan/code/tv2-poc/poc/review/m0-m3-probe-results.jsonl). A review saját adatbázisa és adatbázis-felhasználója a futások után eltávolításra került.

## 4. Milestone- és tesztlefedettségi értékelés

| Milestone | Ami érdemben bizonyított | Ami még hiányzik / javítandó |
| --- | --- | --- |
| M0 | Config alapok, auth-off adminvédelem, live/ready különválasztás, hibaszerződés, build, migrációs keret | Core smoke regresszió; OpenAPI-sémák; lint; pinelt runtime-on ismétlés; korábban is nyitott image-pinek. |
| M1 | Draft/edit/publish/withdraw/republish; verzióütközés; slugverseny és 50 jelölt; audit/outbox atomosság; public mezőszűrés | OpenAPI-kapu; a processing-stats aggregátum hibája az M1-ben létrehozott repositoryban van, M3-ban válik felhasználói hibává. |
| M2 | Mock issuerrel aláírás/issuer/audience/exp; csoportból jogképzés; HTTP-jogok és audit actor; ismert kulcs cache-e | R04, R07, R08, R11; valódi Authentik L2 és használható belépési folyamat. |
| M3 | Valódi JetStream publish és ACK utáni jelölés; ablakon belüli dedup; kapacitáselutasítás; invalid envelope halt; topológia create/verify | R01, R02, R05, R06, R09, R12; a tervezett hibaforgatókönyvek teljes bizonyítása. |

**M3-ban a „T01–T20 PASS” megfogalmazás túl erős a tényleges 17 teszthez képest:**

- T07: nincs külön deduplikációs ablakon túli ismételt küldési próba.
- T09: nincs kikényszerített publish-ACK timeout és mért backoff-próba; R06 ezt különösen fontossá teszi.
- T04/T05: a kiesési szakaszban a relay nem indul, majd második alkalmazás indul működő brokerrel. Ez bizonyítja a backlog kézbesíthetőségét újraindítás után, de nem bizonyítja egy futó relay tényleges brokerkiesésből való helyreállását.
- T19: a függő művelet azonnali elengedése miatt nem vizsgálja a grace-limit lejártát.
- T20: a teszt neve is „T20-ish”; csak HTTP correlation round-tripet néz, nem a teljes relay-logút titokmentességét.
- T12/T13: a relay suite tesztactort injektál. M2-ben külön tokenes jogosultsági tesztek vannak, de a valódi token + bekapcsolt relay + pending processing-status összekötött út nincs bizonyítva.
- T03 a DB mezőit és a stream üzenetszámát nézi; a terv szerinti teljes DB-envelope ↔ stream-envelope azonosságra érdemes célzott assertet adni.

**M2 L2 nem kizárólag külső hozzáférés kérdése.** Az [authentik-login.mjs:72](/Users/busizoltan/code/tv2-poc/poc/backend/scripts/authentik-login.mjs:72) jelenleg discovery-metaadatot és PKCE-párt ír ki, majd csak a callback port foglalhatóságát vizsgálja. Nem indít teljes authorization kérelmet, nincs state/callback feldolgozás, code exchange vagy refresh. A script ezt pendingként meg is nevezi, ezért nem állítom róla, hogy kész belépést színlel; viszont a `demo:m2` által javasolt tokenbeszerzési út még nincs megvalósítva. A működő Authentik önmagában ezt nem oldja meg.

## 5. Megtartandó megoldások

- A content, audit és outbox ugyanazon Drizzle-tranzakciót kapja; a rollback-próbák a minden írás utáni, commit előtti hibát is lefedik.
- Az ugyanazon aggregate-et módosító kéréseket sorzár rendezi, majd a várt verzió ellenőrzése előzi meg az állapotszabályokat. A konkurenciatesztek tényleges átfedést kényszerítenek ki.
- A generált slug unique hibájának savepointos kezelése megőrzi a teljes tranzakció használhatóságát.
- A publikus lekérés SQL-ben szűr published állapotra, és explicit publikus nézetet ad vissza médiaazonosító vagy actoradat nélkül.
- A normál HTTP-folyamat nem fogadja el a tesztactor headert; a permissionök a verifikált csoportleképezésből származnak.
- A relay csak PubAck után jelöl; az eventId stabil dedup kulcs, és az eltérő létező topológiát nem írja felül csendben.

## 6. Javítási sorrend és lezárási feltételek

1. **Adatizoláció és megfigyelhetőség:** R01, R02. A full smoke addig csak eldobható adatbázison fusson.
2. **Futó alap és demó:** R03, R04; lint rendezése és OpenAPI-sémák pótlása.
3. **Relay hibautak:** R05, R06, R09; valódi brokerkiesés/visszatérés, ACK-timeout, dedup-ablakon túli ismétlés és teljes logút próbája. R12 ugyanebben a wake-életciklusban javítható.
4. **Identity lezárás:** R07, R08, R11; teljes PKCE/token/refresh kliensfolyamat, majd valódi Authentik L2 a blueprinttel és kiadott access/ID tokenekkel.
5. **Friss bizonyítékjegyzőkönyv:** a rögzített Node-verzión build/lint/tesztek/smoke; a PASS, PENDING és szimulált esetek következetes elválasztása.

A dokumentációs státuszokat is össze kell hangolni: a `poc/README.md` M2/M3-at még nyitottként, a M2 terv „nincs implementálva” állapotban, az M2 evidence L1-készként, a M3 evidence pedig az identityt még nem implementáltként írja le. A teljes M0–M3 lezárásról csak a javítások és a hiányzó kapupróbák után érdemes új állítást tenni.
