# M0 – Közös alap és indíthatóság: implementációs terv

2026-09-15 · 3. változat · A review és az M0–M1 eltérései rendezve a felhasználó döntési felhatalmazása alapján. Implementáció és futási bizonyíték még nincs.

Kiindulópont: [README](README.md), [milestone-terv](MILESTONES.md), [fázisterv](PHASES.md). Irányadó döntési alap: [DECISIONS.md](DECISIONS.md). A [review](M0-REVIEW.md) korábbi megállapításai történeti állapotot rögzítenek; a következő részletes terv az [M1](M1-IMPLEMENTATION.md).

## 1. Szállítandó eredmény és kapu

M0-ban elkészül az indítható NestJS-alap, PostgreSQL-kapcsolat, konfigurációvalidálás, migrációs keret, health, strukturált logolás, hibakezelés, adminblokkolás, OpenAPI és az első közös HTTP/esemény/permission szerződések. A content/audit/outbox tényleges sémája és üzleti működése M1-02-től készül.

| Eredmény | M0 lezárásához szükséges? |
| --- | --- |
| Core Compose PostgreSQL, alkalmazásindítás, migráció, core smoke | Igen |
| Adat-, HTTP-, esemény- és permission szerződések | Igen |
| Full Compose definíció és image-verziók/digestek rögzítése | Igen, konfigurációs ellenőrzéssel; szolgáltatásindítás nélkül |
| Authentik elindítása, provider, tesztidentitás, kiadott token | Nem; M2 eredmény |
| NATS és Meilisearch tényleges indítása | Nem; M3, illetve M4 eredmény |
| Összesített full smoke | Nem; az érintett integrációk elkészülte után követett eredmény |

A full összeállítása és a full futási próbája külön feladat. A core smoke nem függhet az utóbbitól. M0 nem szállít tokenellenőrzést, tartaloméletciklust, relayt, keresőt vagy médiaadaptert.

## 2. Rögzített döntések

### D-M0-01 – Toolchain

Az első választás Node 24 / NestJS 12 / ESM / TypeScript 6 / Vitest, oxlint és formatter. A CLI és alkalmazás pontos Node-követelményét a kiválasztott kiadásokkal együtt ellenőrizzük. M0-02 pontos patchverziót rögzít, nem `24.x`-et. Minden közvetlen dependency pontos verziót és commitolt lockfile-t kap.

A spike ellenőrzi a telepítést és peer-függőségeket, buildet, dependency injection indulást, tesztfuttatást, validált HTTP-kérést, OpenAPI-t, valamint a későbbi kliensek importálhatóságát. A pontos csomaglista a spike eredménye; a korábbi v2 konkrét számai nem telepítéssel bizonyított verziók.

120 perc összesített timebox. Fallback: v12 ESM → v12 CommonJS/Jest → v11 CommonJS/TS5/Jest. Minden váltáskor a teljes csomagcsalád peer-kompatibilis verziói változnak. Sikertelen timebox után dokumentált no-go következik, a tartalékkeretből folytatható; nem minősítjük működőnek a még nem ellenőrzött fallbacket. Technológiai támpont: [Nest migrációs útmutató](https://docs.nestjs.com/migration-guide).

### D-M0-02 – Adatbázis és migráció

Drizzle ORM + pg; a kiválasztott és pinelt Drizzle Kit custom SQL migrációs formátuma, generált fájlneve és saját nyilvántartása. Külön kézi sorszámozó és saját migrációs napló nincs. A baseline az alkalmazás névterét alapozza meg; a migrátor belső naplóját nem az alkalmazás baseline-ja hozza létre. [Drizzle custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations).

A migráció előrefelé alkalmazott, a már alkalmazott fájl változatlan. Általános down nincs. `db:reset` csak explicit eldobható tesztcélt fogad el, újraépíti azt és lefuttatja a migrációkat. Normál DATABASE_URL-re nem alkalmazható alapértelmezetten. Az üzleti tranzakció egy kapcsolaton fut, hibára rollbackel; ez külön követelmény.

### D-M0-03 – Konfiguráció és authhatár

Config-modul + közös validációs séma. Kötelező kulcsok: NODE_ENV, PORT, LOG_LEVEL, DATABASE_URL. A feature flagek alapértéke off. Bekapcsolt integráció a hozzá tartozó kulcsokat kötelezővé teszi. Kikapcsolt integrációról egy strukturált indulási bejegyzés készül, hiányzó kulcsonkénti figyelmeztetés helyett.

Ismeretlen környezeti kulcs megengedett; ezt nem keverjük a HTTP-body ismeretlen mezőinek M1-beli elutasításával. A PORT normál futásban 1–65535; a saját smoke-child tesztmódban 0-t is használhat dinamikus portkiosztáshoz.

Az `ENV_FILE` explicit fájlt választ; csak azt olvassuk be, nincs másik `.env`-re automatikus visszaesés. Hiányzó választott fájl hiba. Normál futásban az explicit process environment felülírhatja a fájlt; a smoke csak engedélyezett rendszerkulcsokat ad tovább, így a felhasználó DATABASE_URL/feature beállításai nem kerülnek bele. A `.env.example` csak placeholder, nem indításra kész konfiguráció.

A későbbi kulcsok helye már ismert: OIDC_ISSUER_URL/OIDC_AUDIENCE és discoveryből ellenőrzött JWKS, NATS_URL/STREAM/SUBJECT, MEILI_A/B_URL/KEY és SEARCH_TIMEOUT_MS, ANTMEDIA_BASE_URL/TOKEN. OIDC_JWKS_URI explicit megadása esetén annak az issuer discoveryjével egyeznie kell. A tényleges providerértékeket M2 rögzíti kiadott token alapján.

Identity off: `/admin` és `/admin/*` prefix middleware minden methodra 503 dependency_unavailable-t ad, a route létezésétől függetlenül. Identity on ellenőrző adapter nélkül indítási hiba. M1 tesztje saját összeállításban belső actort/tesztadaptert injektál; normál appban ilyen adapter, actor header vagy bodyból vett identitás nincs. JWT/JWKS teszt M2.

### D-M0-03b – Readiness

A `/health/ready` PostgreSQL-t ellenőriz; NATS, Meilisearch és IdP hálózati hibája nem rontja. A háttérfeldolgozás állapotát a későbbi processing-status jelzi. A helyi identity konfiguráció/adapter az indulás feltétele, nem további hálózati readiness-probe. A `/health/live` élő folyamatnál 200. Health-válasz Terminus formátumú, dokumentált kivétel a problem+json alól.

### D-M0-04 – Content szerződés

Az [M1 2–3. szakasza](M1-IMPLEMENTATION.md) rögzíti a pontos normalizálást és sémát. Draft: cím 1–200 karakter. Publikálás: cím, slug, summary 1–500, kategória és mediaAssetId legfeljebb 128; tagek opcionálisak, max 20, elemenként max 40. Kategóriák: film, sorozat, hir, sport, szorakozas, egyeb. Várt verzió pozitív egész, kezdetben 1. Actor minden íráshoz explicit, nincs system fallback.

### D-M0-04b – Nézetek

Admin: Content összes szerkesztői mezője, audit/outbox külön beágyazás nélkül. Nyilvános: id, title, slug, summary, category, tags, publishedAt. **mediaAssetId csak adminmező.** Keresőprojekció M4: id, title, summary, category, tags, aggregateVersion. A keresési válasz a DB-ből kapja a publikus mezőket. Új auditolvasó végpont nem része M0–M1-nek.

### D-M0-05 – Slug

Slug legfeljebb 80 karakter, globálisan egyedi, draft/withdrawn állapotban módosítható. Ha null, kizárólag publikáláskor generálódik a címből magyar ékezet-transzliterációval és kötőjeles normalizálással. Üres generált eredmény 422; kézi sluggal javítható. Alap + -2…-50, összesen 50 jelölt; az utótaggal együtt érvényes a hosszlimit. Kézi slugütközés 409, nincs automatikus átnevezés.

A unique korlát ad konkurenciavédelmet. A generált jelölt unique hibáját savepoint-visszaállítás követi, utána új jelölt; más SQL-hiba teljes rollback. A slug végleges mentése előtt nincs audit/outbox. Részletek M1 4.2. Visszavonás nem törli a slugot; explicit szerkesztés felszabadíthatja a régit. Nincs slugtörténet/átirányítás, a nyilvános végpont UUID-alapú.

### D-M0-06 – Audit, verzió és esemény

Létrehozás v1 + created audit; tényleges draft/withdrawn szerkesztés +1 + updated audit, esemény nélkül. Publish/withdraw/republish +1, audit és v1 outbox egy DB-tranzakcióban. Republish = content.published. Nincs külön draft-esemény.

Ellenőrzési sorrend: kérésforma/hozzáférés után létezés → expectedVersion → állapot → normalizált célállapot/no-op. No-op nem változtat verziót, auditot, outboxot, updatedAt/By mezőt. Elveszett válasz után újraolvasás szükséges. Audit: id, contentId/version, action, actorSub/roles, occurredAt, correlationId, changedFields mezőnevek értékek nélkül. Nincs névtelen/system fallback.

### D-M0-07 – Állapothibák

Published újrapublikálása 409 content_already_published; draft/withdrawn visszavonása 409 content_not_published; published szerkesztése 409 content_not_editable. Stale expectedVersion előbb version_conflict hibát ad. Withdrawn → published megengedett, ismételt minimumellenőrzéssel.

### D-M0-08 – Permissionök

Viewer: `/me`. Editor: content:read + content:write. Publisher: ezek + content:publish + ops:read. Processing-status csak ops:read. Csoportok: poc-viewer/editor/publisher; permissions és roles claim. A konkrét Authentik mapping M2-ben készül. OAuth scope önmagában nem ad jogot.

### D-M0-09 – Hibaválasz és correlation ID

Üzleti/API hiba: application/problem+json; type, title, status, code, detail, instance, correlationId. Health-válasz kivétel, a filter nem alakítja át. HTTP-kódok: invalid_json 400, validation_failed 422, version_conflict/állapothibák/slug_conflict 409, content_not_found 404, unauthenticated 401, forbidden 403, dependency_unavailable/search_unavailable 503, internal_error 500. Verzióhibánál expectedVersion/actualVersion is szerepel. Kliensnek SQL és titkos érték nem kerül vissza.

ExpectedVersion a PATCH/publish/withdraw bodyjában. Bejövő X-Correlation-Id csak 1–128 ASCII betű/szám/pont/aláhúzás/kötőjel formátumban használható; különben szerver UUID-t generál. A correlationId eseménysémája ugyanezt engedi, így az M0 logteszt azonosítója M1-ben is érvényes. Időpontok UTC ISO 8601.

### D-M0-10 – Esemény

CONTENT stream, poc.content.changed.v1 subject; eventId, schemaVersion=1, eventType, aggregateId/version, occurredAt, correlationId, payload. Típus/status pár csak content.published/published vagy content.withdrawn/withdrawn. TS típus a közös JSON Schema alapján, a választott generátorral. Nincs token, e-mail vagy médiakulcs. Két durable: search-a-v1/search-b-v1. Karantén: CONTENT_DLQ, poc.content.quarantine.v1. Stabil eventId lesz a dedup azonosító.

A további konfigurációs alapértékeket DECISIONS D08 rögzíti. M0-ban csak a szerződés készül, stream/consumer bootstrap M3. Új eventType v2 és rollout-feladat, jelenleg scope-on kívül.

### D-M0-11…13 – Nyilvánosság, gazdák, demó

A nyilvános katalógus login nélkül elérhető, lejátszási jogot nem ad. A gazdákat DECISIONS D01 rögzíti; `.env.example` Codex, Compose Claude. Minden backend contracts a `src/contracts/` alatt értendő.

Demó: „Vadon élő Magyarország – Őrségi ősz”, summary „Természetfilm az Őrség őszi élővilágáról.”, film kategória, természetfilm/őrség/ősz tagek, vod-demo-0001 médiaazonosító. Slug kezdetben null, publikáláskor vadon-elo-magyarorszag-orsegi-osz. Negatív példák: hiányzó médiaazonosító publikáláskor, 201 karakteres cím, két kliens azonos várt verzióval. Fixture M0, tényleges seed/demó M1.

## 3. Tervezett fájlterületek

`poc/backend/`: package/lockfile/tsconfig, src/app.module, config, database, health, common, contracts; üres content/identity/outbox/messaging/search/media modulhatárok; a migrátor generált migrations struktúrája; test/integration és test/fixtures; scripts/smoke-m0 és seed-váz; compose.yaml, .env.example, README, VERSIONS és docs/external-access.

M0 nem hoz létre content táblát. A baseline csak a migrátort és az alkalmazás névterét igazolja. A smoke script és npm parancsok alább tervezett felületek, még nem létező futási bizonyítékok.

## 4. Feladatlebontás, függőségek és becslés

| # | Feladat | Gazda | Függőség | Nettó becslés | Kész eredmény |
| --- | --- | --- | --- | --- | --- |
| M0-01 | Döntések átadása a contracts munkának | Codex | DECISIONS | 60 p | A rögzített döntésekhez tartozó szerződések és felelősségek átadva; nem új jóváhagyási kör |
| M0-02 | Toolchain-spike | Codex | — | 120 p | Telepítés, build, DI, teszt, validáció/OpenAPI; teljes pinlista, go/no-go |
| M0-03 | Scaffold | Codex | M0-02 go | 45 p | Build/start/test/lint scriptek, lockfile, ESM/CJS konzisztencia |
| M0-04 | Config és .env.example | Codex | M0-03 | 60 p | ENV_FILE és feature szabályok, titokmentes fail-fast |
| M0-05 | DatabaseModule | Codex | M0-04 | 60 p | Pool, közös tranzakciós kapcsolat, rollback, shutdown |
| M0-06 | Migrációs keret és reset | Codex | M0-05 | 60 p | Generált custom baseline, újrafuttatás, kizárólag tesztcélú reset |
| M0-07 | Content DDL-szerződés | Codex | M0-01 | 45 p | Content/audit/outbox mezők és korlátok M1 szerint |
| M0-08 | Health | Codex | M0-05 | 45 p | Live/ready és health-formátum; kieső DB megkülönböztetése |
| M0-09 | Hibafilter, adminprefix, correlation ID | Codex | M0-03 | 60 p | Egységes hibák health-kivétellel, identity nélküli adminblokkolás |
| M0-10 | Logolás | Codex | M0-09 | 45 p | Strukturált log; token/jelszó/teljes DATABASE_URL nem jelenik meg |
| M0-11 | OpenAPI | Codex | M0-09 | 30 p | Health és hibaséma, /docs és /docs-json |
| M0-12 | HTTP-szerződés | Codex | M0-01 | 60 p | Admin/public DTO, expectedVersion, normalizálás |
| M0-13 | Eseményszerződés | Codex | M0-01 | 45 p | V1 JSON Schema, TS típus, két validált példa |
| M0-14 | Permission-szerződés | Claude | M0-01 | 30 p | Role/permission és route mátrix |
| M0-15 | Core Compose | Claude | — | 45 p | PostgreSQL 17 healthcheckkel és izolálható tárolással |
| M0-16a | Full Compose definíció | Claude | M0-15 | 45 p | NATS/A/B/Authentik és szükséges kliens definíció; config validálás, nincs futási kapu |
| M0-16b | Full szolgáltatások futási próbái | Claude | M0-16a; M2/M3/M4 | 30 p | Integrációhoz rendelt indítási eredmények; M0-kapun kívül |
| M0-17 | Verziójegyzék | Claude | M0-02, M0-16a | 30 p | Package-lista és image-digestek; nem függ M0-16b-től |
| M0-18 | Authentik előkészítés | Claude | M0-16a; M2 | 90 p | Provider, identitások, discovery, majd tokennel audience; M2-ben zár |
| M0-19 | Külső előfeltételek jegyzéke | Claude | — | 20 p | Hozzáférés/felelős/célfázis; hiány M6-ra jelölve |
| M0-20 | Runbook | Claude | M0-04, M0-15 | 45 p | Helyi konfiguráció és smoke használata, minden eszköz előfeltétele |
| M0-21 | Smoke-runner és core bizonyítás | Codex | M0-03…15, M0-16a, M0-17, M0-20 | 120 p | 5.1–5.6 automatikus assert/cleanup, friss izolált környezet |
| M0-22 | Demó-fixture | Codex | M0-01, M0-07 | 30 p | Minta és negatív esetek, M1-nek átadás |

**Összeg:** 1220 perc = 20 óra 20 perc, ebből kötelező M0-core/definíció 1100 perc = 18 óra 20 perc; későbbi full futás + Authentik 120 perc = 2 óra, az M2–M4 keretébe számítva. A v2 1145 percéhez a smoke-runner hiányzó implementációjára 75 perc került.

Gazda szerinti, egyszer számolt feladatmunka: Codex 885 perc (14 óra 45 perc), Claude 335 perc (5 óra 35 perc); ebből Claude M0-kapun belüli része 215 perc. A nettó munka nem tartalmazza mindkét fél review-részvételét. Az ütemezés M0-ra négy napot ad, szükség esetén a közös tartalékból folytatva; a nettó munka és a napi hasznos kapacitás közti különbség nem rejtett párhuzamosítás.

Kritikus függőségek: toolchain → scaffold/config → DB → migrátor → core smoke; a core Compose és szerződésmunka ugyancsak a smoke előtt készül. A full indulásnak nincs visszamutató függősége a core kapuba. Az M1 üzleti séma a contracts és a bizonyított migrátor után indulhat.

## 5. Smoke-futtatás: megvalósítandó szerződés

A korábbi kézi shellblokkok helyett **egy Node-alapú smoke-runner** készül. Az alábbi parancsokat M0 hozza létre; most nem futtattuk őket:

```bash
npm ci
npm run build
npm run smoke:m0
```

A telepítés előtt a repo elérhető, az M0-ban pinelt Node/npm és Docker Compose használható. A runner nem igényel jq, GNU timeout vagy NATS CLI telepítést; HTTP- és időkorlát-ellenőrzést Node-ban végez. A Docker Compose parancsok exit kódját is ellenőrzi.

### 5.0 Izoláció és folyamatkezelés

- Friss ideiglenes könyvtár, egyedi Compose-projektnév, külön volume és kizárólag tesztadatbázis. A host portokat a runner szabadon osztja ki; a tényleges DB portot Compose-lekérdezésből veszi. A demó/fejlesztői példányhoz nem nyúl.
- A runner ismert tesztjelszóval generál saját konfigurációt a core Compose és alkalmazás számára. Nem másolja át a placeholder fájlt, nem source-ol shellként .env-t, és nem naplózza a titkos értéket. A helyi emberi induláshoz a runbook külön működő példát ad.
- Tesztesetenként saját alkalmazásfolyamat, közvetlen Node childként, a build által rögzített entrypointtal. A child stdout/stderr külön gyűjtve; figyeljük az exitet. Nincs npm wrapper PID-jének leállítására épített cleanup.
- A child konfigurációjában PORT=0 engedélyezett tesztmódban; az OS oszt szabad portot. A bootstrap csak a tényleges listen után ad strukturált port/indulási jelzést. A runner kizárólag saját childját és annak címét vizsgálja; más folyamat nem adhat hamis zöld eredményt.
- Az indulás és helyreállás legfeljebb 30 másodperces feltételvárás; a HTTP-próbák kérésenként legfeljebb 2 másodpercesek. Korai exit, rossz válasz vagy timeout sikertelen assert. Negatív indulási próba hibakódot is ellenőriz, így a portütközés nem konfigvalidációs siker.
- Minden eset finally ágban leállítja és megvárja a saját childot; 5 másodperc után csak arra a childra alkalmaz kényszerített leállítást. A runner a saját Compose-projektjét volume-mal együtt takarítja, a cleanup hibája is nem nulla exitet eredményez. Nincs globális pkill vagy más projektet érintő compose down.
- SIGINT/SIGTERM szintén cleanupot kér. Külső SIGKILL után automatikus cleanup nem garantálható; a jegyzőkönyvbe kiírt egyedi projektnév alapján a runbook kizárólag azt a tesztprojektet távolítja el.
- Összesített siker csak minden kötelező assert után, exit 0-val. Bármelyik hiba exit nem nulla; a jelentés tesztesetenként eredményt és titokmentes okot tartalmaz.

### 5.1 Core indítás, migráció és OpenAPI

A runner elindítja saját PostgreSQL-jét, healthre vár; migrál, újra migrál és ellenőrzi a migrációs napló változatlanságát. Saját appot indít, live/ready 200 és megfelelő JSON, /docs-json érvényes info és health-séma. A full Compose definíció konfigurációs validálása nem indít full szolgáltatást. A childot a próba végén leállítja.

### 5.2 Negatív konfiguráció

Külön konfiguráció és child minden esetre: üres DATABASE_URL; bekapcsolt identity hiányzó kötelező OIDC-konfiggal; bekapcsolt identity adapter nélkül; hiányzó ENV_FILE. Elvárt: megfelelő, kulcsot/okot néven nevező hiba, nem nulla exit, nincs listen. A titkos értéket nem szabad kiírni. ENV_FILE másik fájlból való csendes pótlását külön tiltott esetként ellenőrizzük.

### 5.3 DB-kiesés és visszatérés

Friss child indul és ready 200. Csak a runner saját postgres szolgáltatása áll le: live 200, ready 503 és postgres hibaindikátor. Ugyanez a DB visszaindul; 30 másodpercen belül ready 200. Nincs vak sleep vagy új appnak tekintett régi process.

### 5.4 Kikapcsolt integrációk

Friss konfiguráció, minden integráció off, OIDC/NATS/Meili/Ant Media kulcs nélkül. Saját child indul, ready 200, a kikapcsolt integrációkról egyszeri diagnosztika. Ez nem értékeli a későbbi integráció működését.

### 5.5 Adminblokkolás

Friss app identity off. POST /admin/contents, GET /admin/contents/<uuid>, PATCH, publish és withdraw minden methodja 503 dependency_unavailable. `/admin` és nem létező admin útvonal szintén blokkolt; bodyban vagy headerben küldött hamis actor nem segít. M0-ban prefixvédelmet, M1-ben tényleges route-védelmet is bizonyítunk. A normál app buildjében nincs tesztidentity-adapter.

### 5.6 Titokmentes log

Ismert nem üres sentinel token és teszt-DB-jelszó; saját childban normál kérés és hibás DB-beállítási próba. Az összegyűjtött stdout/stderr sem nyers tokent, sem jelszót, sem teljes DATABASE_URL-t nem tartalmazhat. Az elvárt correlation ID-nak meg kell jelennie. Hiányzó sentinel vagy hiányzó kéréslog sikertelen próba, nem kihagyott ellenőrzés. A logger teljes URL-eket nem ad át redakcióra reménykedve: előbb engedélyezett diagnosztikai mezőkre szűkít.

### 5.7 Full integrációk – követett eredmény

Külön `npm run smoke:full` futtató készül az M2–M4 munkában ugyanilyen folyamatgazdával. Authentik discovery/token M2, NATS JetStream M3, Meili A/B M4. A futtató csak kifejezetten kiválasztott és elkészült integrációkat ellenőriz; az el nem készült elemet pendingként jelöli, nem sikernek. Az M0-kapuhoz nem fut és nem szükséges.

## 6. M0 lezárási lista

- [ ] Toolchain teljes pinlistával és go eredménnyel bizonyított.
- [ ] Core PostgreSQL/app indítás és migráció friss izolált környezetben sikeres.
- [ ] Konfiguráció, adminvédelem, health, log és OpenAPI core smoke ellenőrzött.
- [ ] Contracts/http, events, permissions, DDL-terv egyezik az M1 és DECISIONS szabályaival.
- [ ] Full Compose definíció és image-verziók rögzítve, a konfiguráció validált; futásuk nem kapu.
- [ ] A közös fájlok gazdái, futtatási útmutató, fixture és külső előfeltételek jegyzéke megvan.
- [ ] A smoke hibára megáll, saját erőforrásait takarítja; a bizonyítékjegyzék reprodukálható.

Ezek teljesítendő futási/fájl-eredmények; a tervezési döntések lezárása nem pipálja ki őket.

## 7. Kockázatok és eljárás

| Kockázat | Rögzített eljárás |
| --- | --- |
| Toolchain-spike sikertelen | 120 perces teljes keret, háromlépcsős fallback; no-go után tartalékkeret és indokolt javítás |
| Authentik nem indul | M2-ben kezeljük; M0 core-kaput nem blokkolja |
| Full szolgáltatás nem indul | Saját M2/M3/M4 kapujában javítandó; a definíció és futás külön feladat |
| Új üzleti igény érkezik | DECISIONS és az érintett contracts/teszt együtt változik; a most rögzített szabályokhoz nem kell újabb döntési kör |
| Image vagy csomag elcsúszik | Pontos pin és digest, a tényleges kompatibilitás M0-02/M0-17 kimenete |
| Content-séma módosul | M1-02-től új migráció; korábban csak DDL-terv |
| Becsült idő túllépése | MILESTONES 17+2 napos keret, majd látható újratervezés; nincs tesztek elhagyásával elért látszólagos lezárás |

## 8. Későbbi fázisoknak átadott feladatok

A döntések rögzítve a DECISIONS D08–D10-ben. A későbbi fázisok feladata a paraméterek konkrét API-konfigurációvá alakítása és működésük bizonyítása, nem új alapértelmezések kitalálása. A provider tényleges adatai, dependency-kompatibilitás, külső hozzáférések és mért idők csak megvalósításból származhatnak.

## 9. Review lezárása

| Review-terület | V3 eredmény |
| --- | --- |
| Readiness | D-M0-03b, M0-08, smoke 5.3: csak DB; identity helyi állapota indítási feltétel |
| Migráció | D-M0-02, M0-06: generált custom migration, saját nyilvántartás nélkül, teszt-reset |
| Core/full kapu | 1., 4. és 6. szakasz: full definíció kötelező, futás külön M0-16b; M0-17 nem függ futástól |
| No-op | D-M0-06: verzió/állapot előbb, nincs system fallback |
| Auth és tesztidentity | D-M0-03, smoke 5.5: prefixvédelem; M1 belső tesztadapter, token M2 |
| Smoke reprodukció | 5. szakasz: egy Node-runner, saját gyermekfolyamat, config, timeout, assert, cleanup |
| Spike | D-M0-01 és M0-02: ugyanaz a 120 perc és fallback-lépcső |
| Becslés | 4. szakasz: 1220 perc, külön 1100 perces kapu és 120 perces későbbi integráció; gazdánként egyszer számolva |
| M0–M1 slug/media/test eltérés | M1 szabályai átvezetve D-M0-03/04b/05-be |
| Státusz és hivatkozások | V3 rögzített döntések, M1-02 migráció, dokumentált health-kivétel |

## 10. Következő lépés

Az M0-02 spike és core alap implementációja kezdhető a rögzített szerződés szerint. Új M0 üzleti döntési kör nem szükséges. Az M1-01 feladata a már eldöntött szabályok kódhoz kötött contractsba átvezetése; az M1-02 a tényleges content/audit/outbox migráció.
