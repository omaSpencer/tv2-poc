# M0–M3 code review – javítási jegyzőkönyv

**Dátum:** 2026-09-16
**Alap:** [M0–M3 code review](M0-M3-CODE-REVIEW.md) · 2 × P1, 9 × P2, 1 × P3
**Állapot:** mind a 12 megállapítás (R01–R12) javítva, mindegyikhez regressziós próbával.

A javítások a `poc/backend/` fán belül maradtak. Új párhuzamos validációs
szabályrendszer nem került be: a futásidejű szerződés továbbra is a `src/contracts/`
Zod-objektumaiban él, az OpenAPI-sémák ugyanezekből *származnak*.

## 1. Mi változott megállapításonként

### R01 · P1 · A full smoke elvitte a meglévő outbox-eseményeket

`scripts/smoke-full.mjs` újraírva. A kapott URL ezután **kizárólag szerverkoordináta**:
a runner a saját `poc_smoke_<run>_test` adatbázisát hozza létre rajta, migrálja, minden
gyerekalkalmazást ez ellen indít, és a végén `DROP DATABASE … WITH (FORCE)`-szal eldobja.
A normál `DATABASE_URL` így nem lehet implicit, módosítható smoke-cél. A preflight
külön ellenőrzi, hogy a cél a generált adatbázis, hogy különbözik a megadott URL-től,
és hogy frissen üres.

### R02 · P1 · Függő outbox mellett a processing-status 500-ra futott

`src/outbox/outbox.repository.ts`: a `pendingStats` aggregátum értékeit a repository
határán, explicit dekóderrel alakítjuk (`toDate`, `toCount`). A `sql<T>` csak
TypeScript-jelölés; a pg driver a `min(occurred_at)` értéket stringként adja vissza,
és a `count(*)` is érkezhet stringként. A visszatérési típus mostantól a tényleges
futásidejű értéket írja le. A controller változatlan.

### R03 · P2 · Az M2 Compose-kulcsok elrontották az M0 core smoke indulását

`scripts/smoke-m0.mjs`: a saját Compose-env generátor a **`compose.yaml`-ből olvassa ki**
az összes `${VAR:?…}` alakú kötelező változót, és mindegyiknek futásonkénti sentinel
értéket ad. Kézzel karbantartott lista nincs, ezért egy új full-profil titok nem tudja
újra megtörni a core kaput.

### R04 · P2 · A valódi tokenes M2-demó mindig hibás PORT-konfigurációval indult

`scripts/demo-m2.mjs`: `NODE_ENV=test` + `PORT=0`, azaz ugyanaz a smoke-child szerződés,
amit a többi gyerekalkalmazást indító script használ. A `catch` ág már nem hív
`process.exit()`-et – a hibát rögzíti, a `finally` lefuttatja a takarítást, és a
riport utána következik. A `fetch` init GET esetén nem kap bodyt (lint: `unicorn/no-invalid-fetch-options`).

### R05 · P2 · A relay leállítási grace periodja nem volt valódi felső korlát

`src/messaging/relay.ts`: a `stop(graceMs)` határideje a **teljes leállítási folyamatra**
vonatkozik. Lejáratkor a `JetStreamAdapter.abort()` (új, nem drainelő zárás) megszakítja
a függő műveletet, hogy a publish elutasításra fusson a saját ACK-timeoutja helyett.
A határidőn túlnyúló ciklus `orphanedLoop`-ként nyilvántartva marad, és a `start()`
megtagadja mellé egy második ciklus indítását (`relay_start_refused`).

### R06 · P2 · Új CMS-események megszakították a hibák utáni retry-backoffot

`src/outbox/outbox.wake.ts` két külön csatornára bontva:

| Metódus | Mi ébreszti | Hol használjuk |
| --- | --- | --- |
| `wait(ms)` | timeout, `signal()`, `interrupt()` | üres polling |
| `backoff(ms)` | timeout, `interrupt()` | retry-backoff és halted állapot |

A ContentService `signal()`-je így csak az idle pollingot gyorsítja; a brokerhiba utáni
kötelező várakozást kizárólag a leállítás szakítja meg. Az `interrupt()` reteszelt
(`resume()` oldja), ezért egy közvetlenül a `wait()` előtt kért leállás sem veszhet el.

### R07 · P2 · A verifier elfogadta a tolerancián túl jövőbeli `iat` claimet

`src/identity/token-verifier.ts`: explicit `iat <= now + OIDC_CLOCK_TOLERANCE_S`
ellenőrzés a `jwtVerify` után. A `jose` ezt csak a `maxTokenAge` ágon végzi, amit nem
használunk. A hiányzó `iat` a terv 2.3 szerint továbbra is elfogadott – a szerződés
csak a *jelen lévő* `iat` értékét köti.

### R08 · P2 · A JWKS HTTP 503 válasza 401-gyé alakult

Ugyanott: a JWKS-letöltés a `jose` `customFetch` horgán megy át, amely nem 200-as
státuszra, nem JSON törzsre és hálózati hibára tipizált `JwksUnavailableError`-t dob.
A `mapJoseError` ezt **strukturális ellenőrzéssel** – nem message-regexszel – választja
el az aláírás- és claimhibáktól, és `503 dependency_unavailable`-t ad. A hamis aláírás
és a ténylegesen ismeretlen kulcs továbbra is 401.

### R09 · P2 · A full smoke kézbesítés nélkül is sikeres kézbesítést jelentett

A `full.m3 relay delivers one publish` eset saját fixture-eseményt hoz létre, majd
négy dolgot bizonyít: a sor `delivered_at` értéke kitöltődik; nem marad függő esemény;
a stream pontosan egy üzenetet tart, a várt subjecten, és annak envelope-ja
kulcssorrend-független összehasonlításban **azonos a tárolt sorból újraépített
envelope-pal** (ez egyben a terv szerinti teljes DB-envelope ↔ stream-envelope
azonosság célzott assertje); és megjelenik a `relay_delivered` naplósor.

A riport `PASS` / `FAIL` / `PENDING` hármas állapotot kezel. A hiányzó Authentik L2 és
az M4 kereső pending sorként jelenik meg, külön felsorolva, és nem számít bele a
sikeres ellenőrzésekbe.

### R10 · P2 · Az OpenAPI-ból hiányoztak a kérés- és válaszsémák

Új `src/contracts/openapi.ts`: a kérés-sémák a `normalize*Command` által használt
**ugyanazon Zod-objektumokból** generálódnak (`z.toJSONSchema`, `target: 'openapi-3.0'`),
így a publikált dokumentum nem tud elcsúszni a kikényszerített szabálytól. A
válasznézetek, a problem+json dokumentum, a health-törzs és a processing-status nézet
nevesített `components.schemas` bejegyzést kapnak; a controllerek `$ref`-fel hivatkoznak
rájuk. A `@Body() body: unknown` szándékosan megmarad: egy DTO-osztály második,
másképp viselkedő validátor lenne.

Új `src/openapi-document.ts` az egyetlen dokumentum-összeállítási pont, hogy a kiszolgált
`/docs-json`, a smoke-kapu és a tesztek ugyanazt bírálják el.

### R11 · P2 · Hibás issuer URL mellett a bekapcsolt identity elindult

`src/config.ts`: bekapcsolt `FEATURE_IDENTITY` mellett az `OIDC_ISSUER_URL` és a megadott
`OIDC_JWKS_URI` abszolút `http`/`https` URL-ként validálódik, `listen` előtt, a kulcsot
néven nevező `ConfigurationError`-ral. A megadott érték nem kerül bele a hibaüzenetbe.
A `http` szándékosan megengedett: a PoC helyi hosztnéven futtatja az Authentiket.
A discovery/JWKS hálózati lekérése továbbra is lusta.

### R12 · P3 · Az idle wake-várakozások timeout után callbackeket tartottak életben

Az `OutboxWake` minden várakozása egyetlen, egyszer lefutó cleanupot regisztrál, amely
törli a saját időzítőjét és eltávolítja a saját bejegyzését a halmazból – akármelyik
oldal sül el előbb. Nincs több közös, feloldatlan belső promise, amire minden poll új
`.then()`-t akasztana. A `pendingWaiters` getter teszi mérhetővé.

## 2. Regressziós próbák

Új fájl: `test/integration/review-fixes.test.ts` (29 eset). Mindegyik a review
„Regressziós próba" bekezdését követi, és a javítás előtti kódon elbukik.

| Megállapítás | Amit a próba bizonyít |
| --- | --- |
| R01 | Külön létrehozott függő esemény a smoke után változatlan; a runner a generált adatbázist célozza |
| R02 | `pendingStats` valódi `Date`-et ad; a végpont 200, érvényes ISO-idő, nem negatív `oldestAgeMs`, relay off és broker-kiesés mellett is; üres outboxnál `null` |
| R03 | A `compose.yaml` kötelező változói mind bekerülnek a generált env fájlba |
| R04 | A demó által írt konfiguráció érvényes; a `catch` ág nem kerüli meg a takarítást |
| R05 | A grace lejárta után is blokkolt művelet mellett a `stop()` határidőn belül visszatér; a megszakított ciklus mellé nem indul második |
| R06 | Hibázó broker mellett öt wake-jel nem rövidíti a backoffot; `signal()` az idle pollingot igen |
| R07 | Tolerancián kívüli `iat` 401, toleranciánbelüli 200, hiányzó `iat` elfogadott |
| R08 | JWKS HTTP 500/503 és nem-JSON törzs 503; hamis aláírás és ismeretlen `kid` 401 |
| R09 | A smoke bizonyított publish ACK-ot, DB-jelölést és stream-envelope egyezést állít; PASS/PENDING elkülönül |
| R10 | Kötelező mezők, `expectedVersion` típusa, public/admin különbség, hibaválaszok sémája; valódi 201-es válasz validál a publikált sémára |
| R11 | Hibás issuer és JWKS URI titokmentes `ConfigurationError`, a megfelelő kulccsal; feature off mellett nincs ellenőrzés |
| R12 | Sok timeout után nem marad nyilvántartott waiter; a későbbi `signal()` nem futtat régi callbacket |

A review saját `review/m0-m3-reproduce.mjs` scriptje **szándékosan érintetlen** maradt –
az a javítás előtti állapot bizonyítéka, és az első próbájánál ma már kivétellel áll le,
pontosan azért, mert az R07 javítva van. Mellé készült a `review/m0-m3-verify.mjs`,
amely ugyanazokat a próbákat futtatja, de a javított viselkedést **assertálja**.

## 3. Friss futási bizonyíték

| Elem | Érték |
| --- | --- |
| Node | **24.20.0** (a manifest `>=24.20.0 <25` minimuma; a review még 24.19.0-n futott) |
| PostgreSQL | 17.4 (eldobható `poc_review_test` adatbázis) |
| NATS | nats-server 2.12.2, JetStream |
| Docker Compose | v5.1.3 (csak `config -q` interpolációs ellenőrzéshez) |

| Ellenőrzés | Eredmény |
| --- | --- |
| `npm run build` | PASS |
| `npm run lint` | **PASS** (0 warning, 0 error – a review FAIL-t jelzett) |
| `npm run db:migrate` | PASS |
| `npm test` | **114/114 PASS, 10 fájl** (85 korábbi + 29 új regressziós) |
| `npm run smoke:m0` (external) | **6/6 PASS**, benne az új OpenAPI-séma-ellenőrzésekkel |
| `npm run smoke:full` | **3 PASS, 0 FAIL, 2 PENDING** (Authentik L2, M4 kereső) |
| R01 célzott próba | A smoke előtt létrehozott függő esemény `delivered_at`-ja utána is `null`; smoke-adatbázis eldobva |
| `compose config -q` core és full | PASS a generált env fájllal; a javítás előtti env fájllal reprodukálható a `AUTHENTIK_BOOTSTRAP_PASSWORD is missing a value` hiba |
| `demo:m2` dummy tokennel | Elindul és a `/me` 401-nél áll meg (`token_rejected / malformed_jwt`); ideiglenes könyvtár takarítva |
| `review/m0-m3-verify.mjs` | **12/12 PASS** |

Reprodukció:

```sh
cd poc/backend
export NODE_ENV=test PORT=0 LOG_LEVEL=silent
export FEATURE_IDENTITY=off FEATURE_OUTBOX_RELAY=off
export FEATURE_SEARCH=off FEATURE_MEDIA=off
export DATABASE_URL='<eldobható _test adatbázis URL-je>'
export TEST_DATABASE_URL="$DATABASE_URL"
export NATS_URL='<helyi JetStream broker URL-je>'
npm ci && npm run build && npm run lint && npm run db:migrate && npm test
npm run smoke:full
SMOKE_EXTERNAL_DATABASE_URL='<PostgreSQL szerver URL>' npm run smoke:m0
node ../review/m0-m3-verify.mjs
```

## 4. Ami a review-ból szándékosan nyitva maradt

Ezek a review 6. szakaszának lezárási listájából valók, de **nem hibajavítások**, hanem
hiányzó funkció vagy külső előfeltétel:

- **M2 L2 kapu:** valódi Authentik példány (E01–E05), kiadott access/ID tokenek,
  élettartam- és refresh-mérés. A full smoke ezt pending sorként jelenti.
- **Teljes PKCE/token/refresh kliensfolyamat** a `scripts/authentik-login.mjs`-ben.
  Jelenleg discovery-metaadatot és PKCE-párt ír ki, és a callback port foglalhatóságát
  vizsgálja; a script ezt pendingként nevezi meg.
- **M3 tesztlefedettségi rések**, amiket a review a §4-ben sorol (T07 dedup-ablakon túli
  ismétlés, T09 kikényszerített ACK-timeout, T04/T05 futó relay brokerkiesésből való
  helyreállása, T20 teljes logút-titokmentesség). Az R05/R06 javítás ezek közül a
  vezérlési hibákat megszüntette, de a hiányzó próbák külön feladat.
- **Image-digestek** (M0-17) és a full Compose profil tényleges indulási próbája.
