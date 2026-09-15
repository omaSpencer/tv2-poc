# M0 – Közös alap, scope és indíthatóság: részletes implementációs terv

2026-09-15 · Egyeztetésre szánt tervezési változat. Futási bizonyíték még nincs.

Kapcsolódó felülvizsgálat: [M0 review és v2 utóellenőrzés](M0-REVIEW.md). Következő terv: [M1 implementáció](M1-IMPLEMENTATION.md). Az átvezetett javítások mellett fennmaradó ellentmondásokat és az M0–M1 szerződéseltéréseket az utóellenőrzés követi.

Kiindulópont: [PoC README](README.md), [milestone-terv](MILESTONES.md), [fázisterv](PHASES.md). Ez a dokumentum az M0 fázist bontja konkrét fejlesztési feladatokra, döntésre kész javaslatokkal és futtatható ellenőrző listával. Kód még nem készül el ebből a dokumentumból.

**Változat:** 2. — a [Codex review](M0-REVIEW.md) P1 és P2 pontjaira adott módosítások a 9. szakaszban szerepelnek; a fennmaradó eltéréseket a review utóellenőrzése sorolja fel. A következő fázis terve: [M1 implementációs terv](M1-IMPLEMENTATION.md).

**Státuszjelölés** a korábbi doksikkal azonos: **rögzített** = a README-ből következik; **javaslat** = döntésre szánt, még nem elfogadott; **nyitott** = szándékosan M0 utánra hagyva. A javaslatok leírása nem jelenti az elfogadásukat.

---

## 1. Mit szállít M0 és mit nem

| Szállít | Nem szállít |
| --- | --- |
| Futtatható NestJS-váz, konfigvalidációval és fail-fast indulással | Content-tábla, üzleti logika, publikálási folyamat (M1) |
| Helyi PostgreSQL Compose-ból, migrációs kerettel | Valódi tokenellenőrzés, guardok (M2) |
| HTTP-, esemény- és jogosultsági szerződés első, review-zható változata | Outbox relay, JetStream-kapcsolat (M3) |
| Hibaválasz-formátum, hibakódtábla, correlation ID, titokmentes logolás | Keresési projekció, fallback (M4) |
| Authentik provider, tesztkliens és három tesztidentitás előkészítése | Tokenkiadás API-hívásokhoz bekötve (M2) |
| Compose-profilok a később bekötendő szolgáltatásokhoz, verziópinnel | Reindex, mérés, bizonyítékjegyzék (M5) |
| Indítási és hibaindukálási útmutató, smoke-check lista | Médiaadapter, DRM, playback (M6) |

M0 nem feltételezi az összes integráció működését. Amit viszont nem hagyhat nyitva: az M1-et blokkoló üzleti döntéseket (2. szakasz) és a közös fájlok gazdáit.

---

## 2. Döntésre kész javaslatok

Ezek a PHASES.md és MILESTONES.md „nyitott” pontjai, mindegyikhez egy-egy konkrét javaslattal. A döntési kör (M0-01 feladat) mindegyiket **elfogadja, módosítja vagy elhalasztja**.

**A válasz hiánya nem elfogadás.** Ha egy sorra a döntési körig nem érkezik válasz, a fejlesztés **explicit munkafeltételezésként** dolgozik tovább a javaslattal, hogy ne álljon meg — de a sor státusza „nem elfogadott, munkafeltételezés” marad, és így is szerepel az M5 jegyzőkönyvében. Ez a megkülönböztetés azért fontos, mert a PoC egyik átadandója éppen az, hogy mi bizonyított, mi tervezett és mi eldöntetlen.

> **Review-státusz:** a [Codex review](M0-REVIEW.md) P1 és P2 pontjai átvezetve. Ahol a review javítást kért, a szöveg ezt jelöli.

### D-M0-01 · Runtime és keretrendszer verziók

**Javaslat:** Node.js 24 (Active LTS) + NestJS 12.0.3 az ESM starter alapértelmezésével (`"type": "module"`, TypeScript 6.0.3, Vitest 4.x, oxlint). Minden verzió pontosan pinelve, `^` nélkül, lockfile commitolva.

| Csomag / futtatókörnyezet | Pin | Megjegyzés |
| --- | --- | --- |
| Node.js | **≥ 24.15**, a 24-es soron (Krypton, Active LTS) | A NestJS 12 migrációs útmutatója a CLI-generáláshoz külön minimumot ír; a puszta `24.x` túl tág. Node 26 még Current, nem PoC-célpont |
| `@nestjs/core`, `/common`, `/platform-express` | 12.0.3 | v12 kiadva 2026-08-28 |
| `@nestjs/cli`, `/schematics` | 12.0.1 / 12.0.2 | |
| `@nestjs/config` | 12.0.0 | zod-sémás validációval |
| `@nestjs/swagger` | 12.0.1 | OpenAPI |
| `@nestjs/terminus` | 12.0.0 | health indicators |
| `typescript` | 6.0.3 | **nem** 7.x: a v12 starter a 6-os sorra hivatkozik |
| `vitest` | 4.1.x | ESM-projekt alapértelmezése v12-ben |
| `zod` | 4.6.5 | config + Standard Schema route-validáció |
| `pino` / `nestjs-pino` | 10.3.1 / 5.2.0 | strukturált log, redact |
| `@nats-io/transport-node`, `@nats-io/jetstream` | 3.4.0 | M3-ban aktiválódik, de M0-ban pinelve |
| `meilisearch` (JS kliens) | 0.62.0 | M4-ben aktiválódik |
| `jose` | 6.2.12 | JWKS + JWT verify (M2) |

**A tábla nem installal bizonyított.** A verziók npm- és registry-lekérdezésből származnak; hogy ez a készlet együtt telepíthető és peer-kompatibilis-e, azt az M0-02 spike dönti el. Addig ez javaslat, nem tény.

**Kockázat és kilépési út** (a [review](M0-REVIEW.md) 7. pontja alapján átdolgozva): a NestJS 12 alig három hete jelent meg és ESM-re váltott, de a **CommonJS projektformátumot a v12 is támogatja** megfelelő Node mellett. Ezért a fallback-lépcső három fokú, nem kettő:

| Lépcső | Mit változtatunk | Mikor lépünk rá |
| --- | --- | --- |
| 1 | NestJS 12 + ESM + TS 6.0.3 + Vitest (alapeset) | — |
| 2 | NestJS 12 + **CommonJS** + TS 6.0.3 + Jest | ha az ESM-interop akad, de a v12 maga rendben van |
| 3 | NestJS 11.2.5 + CommonJS + TS 5.9.3 + Jest | ha maga a v12 akad |

A 3. lépcső **nem** csak a core, a TS és a test runner cseréje: a teljes kompatibilis csomagkészletet újra kell pinelni (`@nestjs/*` mind a 11-es sorra, `@nestjs/swagger`, `@nestjs/config`, `@nestjs/terminus` megfelelő majorja, `@types/node`, lint-lánc). Ezt az M0-02 kimenete rögzíti, nem a későbbi improvizáció.

**Alternatíva (elvetve, de rögzítve):** azonnal NestJS 11.2.5 CJS. Előny: érett ökoszisztéma, kevesebb interop-kockázat. Hátrány: a PoC nem ad információt arról, hogy a termék célverziója életképes-e; egy későbbi migráció külön munka.

### D-M0-02 · Adatbázis-hozzáférés és migrációk

**Javaslat:** `drizzle-orm` 0.45.2 + `drizzle-kit` 0.31.10, `pg` 8.23.0 driverrel; migrációk **kézzel írt SQL-fájlok**, sorszámozva (`0001_...sql`), a drizzle-kit migrátorral futtatva.

Indoklás: az M1 tranzakciós határa (tartalom + audit + outbox egy tranzakcióban) és az M3 outbox-relay `FOR UPDATE SKIP LOCKED` jellegű lekérdezései explicit SQL-közelséget kívánnak. A drizzle nem használ dekorátort és metaadat-emissziót, ami az ESM/TS6 sávban egy kockázattal kevesebb. A `db.transaction()` egyetlen kapcsolaton tartja a műveleteket, ami az atomi rollback bizonyításának előfeltétele. A `FOR UPDATE SKIP LOCKED` itt **csak indoklás arra, miért kell SQL-közelség** — a README egy relayt ír elő, és a több relayhez szükséges rekordfoglalást későbbre hagyja, tehát ez nem válik M1-követelménnyé.

**Alternatíva:** TypeORM 1.1.1 + `@nestjs/typeorm` 12.0.1. Előny: hivatalos Nest-integráció, ismertebb. Hátrány: dekorátoralapú, nehezebb a pontos tranzakciókezelés, és a 0.3 → 1.x váltás saját migrációs teher.

**Migrációs keret** (a [review](M0-REVIEW.md) 2. pontja alapján átdolgozva): a `drizzle-kit` **custom migration** keretét használjuk, a saját generált fájlnevével és saját alkalmazási nyilvántartásával. Nem írunk párhuzamos, kézzel sorszámozott sémát és nem hozunk létre saját `schema_migrations` táblát — ez a két nyilvántartás összeakadna.

**A migrációk előrefelé alkalmazottak.** Általános `down` parancsot a PoC **nem ígér**, mert a drizzle-kit migrátorához nincs kiválasztott és bizonyított visszaállító megoldás. Helyette:

- fejlesztés és teszt közben a visszaállítás = **eldobható adatbázis újraépítése** a migrációk elejéről (`npm run db:reset`);
- ahol egy migráció valóban visszafordítható, a repóban ott is csak *dokumentált* visszaállítási lépés áll, nem automatizmus.

**Ez nem keverendő össze a tranzakciós rollbackkel.** Az M1 atomi rollback-garanciája (tartalom + audit + outbox együtt gördül vissza) futásidejű tranzakciókezelés, és attól függetlenül kötelező, hogy a sémamigrációnak van-e `down` útja.

A migrációs sorrend gazdája egy fő (lásd D-M0-12), és a migrációs fájlokat sosem írjuk át visszamenőleg, csak újat adunk hozzá.

### D-M0-03 · Konfiguráció, feature flagek és titokkezelés

**Javaslat:** `@nestjs/config` + zod séma; ismeretlen kulcs nem hiba, hiányzó **kötelező** kulcs indulási hiba, amely néven nevezi a hiányzó kulcsot és nem írja ki az értékét.

| Kulcs | M0-ban | Megjegyzés |
| --- | --- | --- |
| `NODE_ENV`, `PORT`, `LOG_LEVEL` | kötelező | |
| `DATABASE_URL` | kötelező | az egyetlen kötelező külső függőség M0-ban |
| `OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI` | opcionális | M2-től kötelező, ha `FEATURE_IDENTITY=on` |
| `NATS_URL`, `NATS_STREAM`, `NATS_SUBJECT` | opcionális | M3-tól |
| `MEILI_A_URL`, `MEILI_A_KEY`, `MEILI_B_URL`, `MEILI_B_KEY`, `SEARCH_TIMEOUT_MS` | opcionális | M4-től |
| `ANTMEDIA_BASE_URL`, `ANTMEDIA_TOKEN` | opcionális | M6; hiánya sosem blokkol |

**Feature flagek:** `FEATURE_IDENTITY`, `FEATURE_OUTBOX_RELAY`, `FEATURE_SEARCH`, `FEATURE_MEDIA` — mind `off` M0-ban, és milestone-onként kapcsolnak be. Egy flag `on` állapota kötelezővé teszi a hozzá tartozó konfigkulcsokat; `off` állapotban a kulcsok hiánya nem indulási hiba.

**Fontos kikötés:** `FEATURE_IDENTITY=off` mellett az `/admin/*` útvonalak HTTP-n **nem kiszolgáltak** (`503 dependency_unavailable`), nem pedig védtelenek. Az M1 üzleti működését integrációs tesztből, a szolgáltatásrétegen keresztül mutatjuk be. Ezzel teljesül a README „nincs implicit auth bypass” feltétele.

**Kiegészítés** (a [review](M0-REVIEW.md) 5. pontja alapján szigorítva): hogy az M1 HTTP-szerződése (`409` verzióütközés, `404` visszavont tartalomra) ne maradjon verifikálatlanul M2-ig, az **integrációs tesztprofil** `FEATURE_IDENTITY=on` értékkel, egy teszt-JWKS-szel és helyben aláírt tokennel indul.

Három kikötés ehhez:

- A `FEATURE_IDENTITY=on` önmagában **nem nyit utat**. Ha nincs működő tokenellenőrző adapter (discovery/JWKS elérhető vagy teszt-JWKS beinjektálva), az alkalmazás **el sem indul**. Bekapcsolt identity, ellenőrzés nélkül: indulási hiba.
- A tesztactor kizárólag a tesztkörnyezet aláírt tokenjéből származhat. **HTTP body mezőből vagy `X-Actor`-szerű headerből soha.** Ilyen bemenet nem kerül a kódba, még feltételesen sem.
- A teszt-JWKS és a hozzá tartozó privát kulcs a tesztfixture-ök között él, nem az `.env.example`-ben és nem a futtatott alkalmazás konfigurációjában.

**Titkok:** `.env` gitignore-olt, `.env.example` kizárólag placeholder értékekkel. A logban `pino` redact: `req.headers.authorization`, `*.token`, `*.password`, `*.apiKey`, `*.secret`, `DATABASE_URL` jelszórésze.

### D-M0-03b · Readiness és a háttérfeldolgozás állapota külön

**Javaslat** (a [review](M0-REVIEW.md) 1. pontja alapján): az `/health/ready` **nem** a bekapcsolt integrációk összege.

| Függőség | Hatás a `/health/ready`-re | Hol jelenik meg a hibája |
| --- | --- | --- |
| PostgreSQL | **igen** — kiesésekor `503` | readiness + minden érintett végpont |
| NATS / JetStream | **nem** | `/admin/processing-status`: outbox pending, oldest-age |
| Meilisearch A és B | **nem** | `/catalog/search` → `503 search_unavailable`; processing-status: indexenkénti lemaradás |
| Authentik (IdP hálózati elérhetősége) | **nem** | a tokenellenőrzés eredménye; cache-elt JWKS mellett a még érvényes token ellenőrizhető |
| Identity **helyi** konfigurációja és kulcsállapota | **igen**, ha `FEATURE_IDENTITY=on` | indulási hiba, nem futásidejű readiness-váltás |

Indoklás: a README kimondja, hogy NATS nélkül és mindkét index kiesésekor is sikeres a CMS-írás. Ha a readiness ezeket is figyelné, egy forgalmat readiness alapján irányító környezet éppen a működő CMS-t tenné elérhetetlenné. A helyi kulcs-/konfigállapot viszont más eset: azzal az alkalmazás nem tud helyesen működni, ezért az **indulást** blokkolja, nem a readinesst billegteti.

### D-M0-04 · Content-mezők, draft- és publikálási minimum

**Javaslat:** a `Content` M1-ben létrejövő alakja és a két külön minimum.

| Mező | Típus | Draft-minimum | Publikálási minimum | Megjegyzés |
| --- | --- | --- | --- | --- |
| `id` | uuid, pk | szerver adja | — | |
| `title` | text, 1–200 | **kötelező** | **kötelező** | trim után nem üres |
| `slug` | text, unique | opcionális | **kötelező** | lásd D-M0-05 |
| `summary` | text, 0–500 | opcionális | **kötelező** | publikáláskor trim után 1–500 |
| `category` | text + CHECK | opcionális | **kötelező** | kötött értékkészlet |
| `tags` | text[] | opcionális | opcionális | max 20 elem, elemenként max 40 karakter |
| `mediaAssetId` | text, max 128 | opcionális | **kötelező** | M1-ben puszta string, létezést nem igazol |
| `status` | enum | `draft` | — | `draft` / `published` / `withdrawn` |
| `version` | int | 1 | — | lásd D-M0-06 |
| `createdAt`, `updatedAt` | timestamptz | szerver adja | — | |
| `publishedAt`, `withdrawnAt` | timestamptz null | — | — | utolsó állapotváltás ideje |
| `createdBy`, `updatedBy` | text | actor `sub` | — | M2-ig `system` |

**Kategória kötött értékkészlete (javaslat):** `film`, `sorozat`, `hir`, `sport`, `szorakozas`, `egyeb`. Alkalmazásszinten zod enum, adatbázisban `text` + `CHECK`. Indoklás: enum-típus bővítése migrációt igényel; a `CHECK` a PoC alatt olcsóbban módosítható.

**Tagek:** szabad szöveg, normalizálva (trim, kisbetűsítés, duplikátumszűrés, sorrend megőrzése). Nincs külön tag-tábla a PoC-ban.

### D-M0-04b · Admin és nyilvános mezőkör

**Javaslat:** a `GET /admin/contents/:id` a teljes rekordot adja, a `GET /catalog/contents/:id` és a keresési találat ennél szűkebb nézetet.

| Mező | Admin nézet | Nyilvános nézet | Keresési dokumentum (M4) |
| --- | --- | --- | --- |
| `id`, `title`, `slug`, `summary`, `category`, `tags` | igen | igen | igen |
| `mediaAssetId` | igen | igen | nem |
| `publishedAt` | igen | igen | nem |
| `version` | igen | **nem** | igen (`aggregateVersion`) |
| `status`, `withdrawnAt` | igen | **nem** | nem |
| `createdAt`, `updatedAt`, `createdBy`, `updatedBy` | igen | **nem** | nem |
| Audit-bejegyzések | külön végponton, M0-ban nincs | **nem** | nem |

Indoklás: a `version` az optimista konkurenciakezelés eszköze, szerkesztői adat; a `status` a nyilvános nézetben mindig `published` lenne, tehát nem hordoz információt. A keresési dokumentum a README-ben rögzített mezőkészletet követi (id, cím, leírás, kategória, tagek, aggregate-verzió).

### D-M0-05 · Slug generálása, egyedisége és módosíthatósága

**Javaslat:**

- **Generálás:** ha a kliens nem ad slugot publikálásig, a szerver a címből generálja. Magyar ékezetek transzliterálva (`á→a`, `é→e`, `í→i`, `ó/ö/ő→o`, `ú/ü/ű→u`), kisbetűsítés, minden nem `[a-z0-9]` karakter `-`, ismétlődő `-` összevonva, vezető/záró `-` levágva, maximum 80 karakter.
- **Ütközés:** `-2`, `-3` … numerikus utótag, legfeljebb 50 kísérlet; utána `409 slug_conflict`.
- **Egyediség tartománya:** **globális**, a teljes `content` táblán, állapottól függetlenül (unique index). Visszavont tartalom slugja **nem szabadul fel** — így az újrapublikálás ugyanazon a nyilvános úton történik, és nincs néma URL-átvétel.
- **Kliens által megadott slug:** elfogadott, ha megfelel a formátumnak; ilyenkor a szerver nem generál, csak validál és ütközést jelez.
- **Módosíthatóság:** `draft` és `withdrawn` állapotban módosítható; `published` állapotban nem — de a publikált tartalom szerkesztése M1-ben amúgy is tiltott, így ez csak a jövőbeli bővítést köti meg.

A [review](M0-REVIEW.md) alapján négy pontosítás:

- **Generálás időpontja:** a szerver a slugot **minden mentéskor** generálja, ha a mező üres, nem csak publikáláskor. Így a draft már látható slugot kap, és a publikálás nem hoz meglepetést.
- **Üres transzliteráció:** ha a címből csak elhagyható karakter marad (pl. `„???”`), a generált slug üres lenne. Ilyenkor a szerver `content-<id első 8 karaktere>` alakot ad, és ezt naplózza. Nem dob hibát, mert a draft mentése nem akadhat el a címen.
- **Hosszlimit az utótaggal együtt:** a 80 karakteres korlát a **végleges** slugra vonatkozik. Ütközés esetén a törzset vágjuk vissza, hogy a `-2`, `-37` utótaggal együtt is beleférjen.
- **Konkurenciabiztos ütközéskezelés:** az egyediséget a **unique index** garantálja, nem az előzetes `SELECT`. A kód megkísérli a beszúrást, és unique-violation esetén emeli az utótagot; így két egyidejű kérés sem hozhat létre két azonos slugot.

**A slug M1-ben nem publikus útvonal.** A README végpontjai UUID-alapúak (`/catalog/contents/:id`). A slug megőrzése és egyedisége előkészítés, nem egy már megvalósított slugos nyilvános URL.

### D-M0-06 · Verzió, audit és esemény szabálya

**Javaslat:**

| Művelet | Verzió | Audit | Outbox-esemény |
| --- | --- | --- | --- |
| Draft létrehozás | `1` lesz | igen (`created`) | **nem** |
| Draft / withdrawn szerkesztés, tényleges változással | `+1` | igen (`updated`) | **nem** |
| Szerkesztés változás nélkül (no-op) | nem nő | nem | nem |
| Publikálás | `+1` | igen (`published`) | **igen** (`content.published`) |
| Visszavonás | `+1` | igen (`withdrawn`) | **igen** (`content.withdrawn`) |

**Kezdeti verzió: 1.** A létrehozás válaszában a kliens már `version: 1`-et kap, és ezt küldi vissza `expectedVersion`-ként.

**No-op mentés – kötött ellenőrzési sorrend** (a [review](M0-REVIEW.md) 4. pontja alapján pontosítva):

1. létezik-e a rekord → `404 content_not_found`;
2. `expectedVersion` egyezik-e az aktuális verzióval → `409 version_conflict`;
3. az állapot megengedi-e a műveletet → `409 content_not_editable` / `content_already_published` / `content_not_published`;
4. **csak ezután** a normalizált mezők összehasonlítása → egyezés esetén `200 OK`, változatlan verzióval, audit és esemény nélkül.

A sorrend nem cserélhető fel. Ha a mezőegyezést vizsgálnánk előbb, akkor az a kliens, amelyik v3-ról módosított, a mentés v4-ként sikerült, de a válasz elveszett, az ismételt v3-as kérésére sikert kapna — ezzel megkerülnénk a README-ben rögzített vártverzió-szabályt. **Elveszett válasz után a helyes viselkedés az újraolvasás.** Kérésazonosító-alapú idempotencia külön bővítés, nem M1-scope.

**Draft-események:** M0–M4-ben **nem** bocsátunk ki eseményt draft létrehozásra és szerkesztésre. Indoklás: a keresési projekció kizárólag publikált tartalmat indexel, a draft változás nem befolyásolja az indexet; a felesleges forgalom félrevezetné az outbox pending és lag mérést. Ha később admin-oldali kereső kell, a szerződés `content.updated` eventType-pal bővíthető — mivel ez a `payload.status` értékkészletét is érinti, sémaverzió-emeléssel (v2) jár.

**Audit tartalma:** `id`, `contentId`, `contentVersion`, `action`, `actorSub`, `actorRoles`, `occurredAt`, `correlationId`, `changedFields` (mezőnevek listája, **érték nélkül**).

**Az actor M2 előtt sem `system` fallback** (a [review](M0-REVIEW.md) alapján javítva). Az integrációs tesztprofil aláírt teszttokenje ad explicit tesztactort (D-M0-03). A futtatott alkalmazásban a hiányzó actor **hiba**, nem `system`-re csendesedő alapérték — különben M2 után is megmaradhatna egy út, amelyen azonosítatlan írás keletkezik.

**v1 eventType-készlet:** `content.published`, `content.withdrawn`. Ezen kívül M0 nem vezet be újat.

**Bővítési figyelmeztetés** (a [review](M0-REVIEW.md) alapján): zárt v1 eventType-készlet mellett egy új `content.updated` érték **nem automatikusan kompatibilis**. Az M4 fogyasztója az ismeretlen típust a szerződés szerint karanténba teheti — vagyis a „csak hozzáadunk egy típust” lépés éles rendszerben karanténhullámot okozna. Új eventType bevezetése ezért mindig külön **kompatibilitási és rollout-döntés**, azonos envelope és változatlan `schemaVersion` mellett is: előbb a fogyasztó tanulja meg az ismeretlen típus tűrését, csak utána indul a kibocsátás.

### D-M0-07 · Ismételt és értelmetlen műveletek

**Javaslat:** mindkét eset **elutasítás**, nem csendes siker.

| Kiinduló állapot | Művelet | Válasz | Hibakód |
| --- | --- | --- | --- |
| `published` | publikálás | `409` | `content_already_published` |
| `draft` vagy `withdrawn` | visszavonás | `409` | `content_not_published` |
| `published` | szerkesztés | `409` | `content_not_editable` |

Indoklás: a publikálás validál és eseményt bocsát ki. A változtatás nélküli „siker” elrejtené a kliensoldali állapottévesztést, és az `expectedVersion` ellenőrzés mellett amúgy is ritkán fordul elő jóhiszeműen. A no-op engedékenység a szerkesztésnél (D-M0-06) más eset: ott az adat tényleg azonos.

### D-M0-08 · Jogosultsági mátrix és permission-nevek

**Javaslat:** négy permission és három szerep.

| Permission | Jelentés |
| --- | --- |
| `content:read` | Admin tartalomolvasás minden állapotban |
| `content:write` | Draft létrehozás, draft/withdrawn szerkesztés |
| `content:publish` | Publikálás és visszavonás |
| `ops:read` | Védett feldolgozási állapot (`/admin/processing-status`) |

| Művelet | viewer | editor | publisher |
| --- | --- | --- | --- |
| `GET /me` | igen | igen | igen |
| `GET /admin/contents/:id` | nem | igen | igen |
| `POST /admin/contents`, `PATCH /admin/contents/:id` | nem | igen | **igen** |
| `POST .../publish`, `POST .../withdraw` | nem | nem | igen |
| `GET /admin/processing-status` | nem | **nem** | **igen** |
| `GET /catalog/*` | belépés nélkül is | | |

Két korábban nyitott pont javasolt lezárása:

- **A publisher szerkeszthet is** (`content:write` benne van). Indoklás: a PoC-ban a publikáló tipikusan javít is publikálás előtt; külön editor-átadás nem mutat semmi újat, viszont demólépéseket hoz be.
- **A processing-status csak publishernek** (`ops:read`). Indoklás: a feldolgozási állapot üzemeltetési adat, nem szerkesztői; szűkebb kezdő kör könnyebben bővíthető, mint fordítva.

**Authentik-leképezés:** `poc-viewer`, `poc-editor`, `poc-publisher` csoportok; egy property mapping állítja elő a `permissions` claimet (string tömb) és a `roles` claimet (audit célra). A kért OAuth scope önmagában nem ad permissiont — ez a README-ben rögzített.

### D-M0-09 · Hibaválasz-formátum és a várt verzió átadása

**Javaslat:** RFC 9457 `application/problem+json`, minden hibaválaszra, stabil `code` mezővel.

```json
{
  "type": "https://poc.indaplay.local/errors/version-conflict",
  "title": "Version conflict",
  "status": 409,
  "code": "version_conflict",
  "detail": "A tartalom időközben megváltozott.",
  "instance": "/admin/contents/fbbf8b73-151f-4931-817c-f5a10a9f31ec",
  "correlationId": "80696510-55ce-4b83-988b-d271021b9813",
  "expectedVersion": 3,
  "actualVersion": 4
}
```

Kezdeti hibakódtábla: `validation_failed` (422), `version_conflict` (409), `content_already_published` (409), `content_not_published` (409), `content_not_editable` (409), `slug_conflict` (409), `content_not_found` (404), `unauthenticated` (401), `forbidden` (403), `search_unavailable` (503), `dependency_unavailable` (503).

**Kivétel:** a `/health/live` és `/health/ready` a `@nestjs/terminus` saját `{status, info, error, details}` formátumát adja, nem problem+json-t. Indoklás: a health-válaszokat külső eszközök (compose healthcheck, később k8s probe) olvassák, és a terminus-formátum a megszokott. Ezt a kivételt az OpenAPI is jelöli.

**A 401 és a 403 külön eset:** hiányzó vagy érvénytelen token `401`; érvényes identitás hiányzó permissionnel `403`. Ez a PHASES M2 szakaszának kikötése, és már M0-ban a hibatáblába kerül.

**Várt verzió átadása:** a kérés **body-jában**, `expectedVersion` mezőként, a `PATCH`, `publish` és `withdraw` hívásoknál. Alternatíva: `If-Match` ETag header — szabványosabb, de a demóban több curl-kapcsolót és egy ETag-kiadási réteget igényel. Ha később HTTP-szintű cache-elés kerül be, az átállás egy külön feladat.

### D-M0-10 · Eseményburkolat v1 és NATS-topológia

**Rögzített** (README): `eventId`, `schemaVersion`, `eventType`, `aggregateId`, `aggregateVersion`, `occurredAt`, `correlationId`, `payload`. Token, e-mail és médiakulcs nem kerül bele.

**M0-ban rögzítendő javaslat:**

| Elem | Érték |
| --- | --- |
| Stream | `CONTENT`, file storage, limits retention, R1 |
| Subject | `poc.content.changed.v1` |
| Karantén stream / subject | `CONTENT_DLQ` / `poc.content.quarantine.v1` |
| Durable consumerek | `search-a-v1`, `search-b-v1` (pull, explicit ACK) |
| Dedup header | `Nats-Msg-Id` = `eventId` |
| `payload` v1 | `{"status":"published"}` vagy `{"status":"withdrawn"}` — a fogyasztó az `aggregateId`-val a PostgreSQL aktuális állapotát olvassa |
| Séma | JSON Schema a `src/contracts/events/` alatt, a TS típus ebből származik |

A konkrét retention-, retry- és timeout-értékek **nyitottak** maradnak, M3–M4 rögzíti őket. M0 annyit köt, hogy hol vannak konfigurálva.

### D-M0-11 · Nyilvános katalógus belépés nélkül

**Javaslat:** a `/catalog/contents/:id` és `/catalog/search` a PoC-ban belépés nélkül elérhető. A viewer belépését ettől függetlenül bemutatjuk (`GET /me`). Ez nem dönt a termék későbbi nézői belépési vagy entitlement-szabályairól.

### D-M0-12 · Közös fájlok gazdái és munkamegosztás

**Javaslat:** minden közös fájlnak egy gazdája van; a másik fél PR-ben kér változtatást, nem ír bele közvetlenül.

| Közös fájl / terület | Gazda | Review |
| --- | --- | --- |
| `src/contracts/http/` (DTO-k, hibaséma) | Codex | Claude |
| `src/contracts/events/` (eseményséma) | Codex | Claude |
| `src/contracts/permissions.md` | Claude | Codex |
| `package.json`, lockfile | Codex | Claude |
| `migrations/` sorrend | Codex | Claude |
| `compose.yaml` | Claude | Codex |
| `.env.example` | **Codex** (a config-séma gazdája) | Claude — a compose által interpolált kulcsokra |
| `health/`, config-modul | Codex | Claude |
| Authentik-konfiguráció és export | Claude | Zoli |
| `poc/backend/README.md` | Claude | Codex |

Az `.env.example` gazdája szándékosan Codex, mert a kulcskészletet a zod config-séma határozza meg (M0-04); Claude a compose-interpolációhoz szükséges kulcsokat review-ban kéri. Így egy szerző és egy review-felelős van, nem két író.

Branch-séma **példaként**: `feat/m0-base` (Codex), `feat/m0-infra` (Claude), napi integráció a `main`-be. A tényleges nevek a repószabályból következnek. A kis, napi merge-ök a README-ben már javasolt módszer.

### D-M0-13 · Demó-mintatartalom

**Javaslat:** egy fix mintatartalom végigkíséri az összes fázist, mert így a demólépések összehasonlíthatók.

| Mező | Érték |
| --- | --- |
| `title` | `Vadon élő Magyarország – Őrségi ősz` |
| `slug` | `vadon-elo-magyarorszag-orsegi-osz` (generált, ékezet-transzliterációt bizonyít) |
| `summary` | `Természetfilm az Őrség őszi élővilágáról.` |
| `category` | `film` |
| `tags` | `["természetfilm", "őrség", "ősz"]` |
| `mediaAssetId` | `vod-demo-0001` |

Mellé két negatív és egy konkurens példa: (a) hiányzó `mediaAssetId` → publikálás elutasítva, (b) 201 karakteres cím → `validation_failed`, (c) két kliens ugyanazt a `version`-t küldi → a második `409`. Fixture helye: `test/fixtures/demo-content.json`, seed script: `scripts/seed-demo.ts`.

---

## 3. Mi jön létre M0-ban a repóban

A README tervezett struktúrájából M0 ezeket hozza létre ténylegesen. A többi könyvtár üres modulvázként készül el, hogy a modulhatár már látható legyen.

| Útvonal | M0 állapota |
| --- | --- |
| `poc/backend/package.json`, lockfile, `tsconfig.json` | kész, pinelt verziókkal |
| `poc/backend/src/app.module.ts` | kész |
| `poc/backend/src/config/` | kész: zod séma, fail-fast, feature flagek |
| `poc/backend/src/database/` | kész: pool, drizzle, `withTransaction()`, shutdown |
| `poc/backend/src/health/` | kész: `/health/live`, `/health/ready` |
| `poc/backend/src/common/` | kész: problem+json filter, correlation ID middleware, logger |
| `poc/backend/src/contracts/` | kész: HTTP DTO-k, hibakódok, esemény-JSON Schema |
| `poc/backend/src/content/` | üres modulváz + DDL-vázlat a contractsban (migráció M1-ben) |
| `poc/backend/src/identity/`, `outbox/`, `messaging/`, `search/`, `media/` | üres modulváz, `FEATURE_*=off` |
| `poc/backend/migrations/` | migrációs keret + `0001_baseline.sql` |
| `poc/backend/test/integration/` | keret + egy induló smoke-teszt |
| `poc/backend/test/fixtures/demo-content.json` | kész: demó-mintatartalom (D-M0-13) |
| `poc/backend/scripts/seed-demo.ts` | seed script váza, futtatás M1-től |
| `poc/backend/docs/external-access.md` | külső hozzáférés-igények jegyzéke (M0-19) |
| `poc/backend/compose.yaml` | `core` és `full` profillal |
| `poc/backend/.env.example` | minden kulcs, kötelező/opcionális jelöléssel |
| `poc/backend/README.md` | indítás, parancsok, hibaindukálás |
| `poc/backend/VERSIONS.md` | pinelt csomag- és konténerverziók, digestekkel |

**Szándékos határ:** a `content` tábla migrációja **nem** M0, hanem M1-01. M0 csak a DDL-vázlatot rögzíti a szerződésben, hogy a döntési kör tárgyalható legyen anélkül, hogy már migrációt kellene visszaírni.

---

## 4. Feladatlebontás

Felelősök a README javasolt felosztása szerint: **Codex** (adatmodell, tranzakció, outbox), **Claude** (identity, search, infra), **Zoli** (üzleti döntések, hozzáférések, elfogadás). A becslés fejlesztői nettó idő, egyeztetés és review nélkül.

### Sáv A – Döntések

| # | Feladat | Felelős | Függ | Becslés | Definition of Done |
| --- | --- | --- | --- | --- | --- |
| M0-01 | Döntési kör a D-M0-01…13 táblán | Zoli + Codex + Claude | — | 60 p | Minden D sor státusza: elfogadva / módosítva / elhalasztva. A D-M0-01 és D-M0-02 „feltételesen elfogadva” státuszt kap, amíg az M0-02 spike go/no-go-ja meg nem érkezik — ezt a két sort a spike zárja, nem a döntési kör. A dokumentum frissítve, a módosított javaslatok indoklással. |

### Sáv B – Váz és futtathatóság (Codex)

| # | Feladat | Felelős | Függ | Becslés | Definition of Done |
| --- | --- | --- | --- | --- | --- |
| M0-02 | Toolchain-spike (timebox) | Codex | — | 120 p | Nem puszta import-smoke. Bizonyítandó egy menetben, Node ≥ 24.15-ön: (a) `npm ci` a pinelt készlettel, peer-hiba nélkül; (b) valódi **build**; (c) **DI-bootstrap** egy triviális modullal; (d) **tesztfuttatás** (Vitest vagy Jest, a lépcső szerint); (e) egy **validált HTTP-kérés** (zod/Standard Schema) végigmegy; (f) **OpenAPI-előállítás** működik; (g) `drizzle-orm` + `pg`, `@nats-io/jetstream`, `meilisearch`, `jose` importálható és példányosítható. Kimenet: a D-M0-01 lépcsőjének kiválasztása és a **teljes** pinelt csomagkészlet, írásban. |
| M0-03 | `poc/backend` scaffold | Codex | M0-02 | 45 p | `npm ci && npm run build && npm start` fut. Verziók pinelve, lockfile commitolva, oxlint/prettier konfigurálva, npm scriptek: `start`, `start:dev`, `build`, `test`, `test:integration`, `lint`, `db:migrate`. |
| M0-04 | Config-modul zod-sémával + `.env.example` | Codex | M0-03 | 60 p | Hiányzó kötelező kulcsra az app nem indul, a hiányzó kulcsot néven nevezi, az értéket nem írja ki, exit kód ≠ 0. Opcionális kulcs hiánya warn log, de indul. Feature flagek működnek. |
| M0-05 | DatabaseModule | Codex | M0-04 | 60 p | Pool konfigurálva (max, timeoutok), `withTransaction()` helper egy kapcsolaton, hibára rollback, `SIGTERM`-re graceful shutdown. Integrációs teszt: szándékos hiba után nincs részleges írás. |
| M0-06 | Migrációs keret + baseline | Codex | M0-05 | 60 p | A `drizzle-kit` custom migration keretével készül egy triviális baseline-migráció, és **bizonyítottan lefut**: `npm run db:migrate` idempotens (kétszer futtatva nem hibázik), a nyilvántartást a migrátor kezeli, nem mi. `npm run db:reset` üres adatbázisból újraépít. Általános `down` nincs, és nem is ígérünk (D-M0-02). |
| M0-07 | DDL-vázlat a contractsban | Codex | M0-01 | 45 p | `src/contracts/schema/content.md`: `content`, `content_audit`, `outbox_event` táblák mezői, indexei, `CHECK`-jei, unique constraintjei — D-M0-04, D-M0-04b, D-M0-05 és D-M0-06 szerint. Migrációvá M1-ben válik. Review: Claude. |
| M0-08 | HealthModule | Codex | M0-05 | 45 p | `/health/live` mindig 200, ha a process él. `/health/ready` **kizárólag az API kiszolgálhatóságához szükséges** függőségeket nézi — M0–M5-ben ez a PostgreSQL. NATS-, Meilisearch- és IdP-hálózati hiba **soha nem** rontja a readinesst, az a feldolgozási állapot és az érintett végpont dolga (D-M0-03b). Leállított adatbázisnál `503`. A health-végpontok a `@nestjs/terminus` saját `{status, info, error, details}` formátumát adják, és **kivételt képeznek** a problem+json alól (lásd D-M0-09). |
| M0-09 | Hibakezelés és correlation ID | Codex | M0-03 | 60 p | Globális exception filter minden hibára problem+json-t ad a D-M0-09 kódtáblából. `X-Correlation-Id` header elfogadva vagy generálva, a válaszban és minden log sorban megjelenik. Külön elem: `/admin/*` prefix-middleware, amely `FEATURE_IDENTITY=off` mellett `503 dependency_unavailable`-t ad **a route regisztrációjától függetlenül** — tehát nem létező admin útvonalra is 503, nem 404. |
| M0-10 | Strukturált logolás | Codex | M0-09 | 45 p | `pino` JSON kimenettel, redact-listával. A **teljes `DATABASE_URL` sosem kerül logba**, hibaüzenet belsejében sem — a kapcsolathibát sémára, hostra és portra redukálva logoljuk. Bizonyíték: sentinel tokennel és a helyi `.env` jelszavával futtatott 5.6 ellenőrzés nulla találata. |
| M0-11 | OpenAPI | Codex | M0-09 | 30 p | `/docs` és `/docs-json` elérhető, a hibaséma és a health végpontok szerepelnek benne. |

### Sáv C – Szerződések (közös)

| # | Feladat | Felelős | Függ | Becslés | Definition of Done |
| --- | --- | --- | --- | --- | --- |
| M0-12 | HTTP-szerződés | Codex | M0-01 | 60 p | `src/contracts/http/`: Content request/response DTO-k (admin és nyilvános nézet külön), `expectedVersion` konvenció, hibaséma. Review: Claude. |
| M0-13 | Eseményszerződés v1 | Codex | M0-01 | 45 p | `src/contracts/events/content-changed.v1.schema.json` + generált TS típus + két példa payload (`published`, `withdrawn`). Séma-validátor teszt a példákra. Review: Claude. |
| M0-14 | Jogosultsági szerződés | Claude | M0-01 | 30 p | `src/contracts/permissions.md`: permission-nevek, szerep→permission leképezés, végpont→permission táblázat, Authentik csoport- és claim-nevek. Review: Codex. |

### Sáv D – Infrastruktúra (Claude)

| # | Feladat | Felelős | Függ | Becslés | Definition of Done |
| --- | --- | --- | --- | --- | --- |
| M0-15 | Compose `core` profil | Claude | — | 45 p | `docker compose --profile core up -d` elindítja a PostgreSQL 17-et healthcheckkel, névvel ellátott volume-mal. `pg_isready` zölden. |
| M0-16 | Compose `full` profil | Claude | M0-15 | 75 p | `nats` (JetStream + monitoring port), `natsio/nats-box` kliensszolgáltatás, `meili-a`, `meili-b` külön porton és volume-mal, `authentik` a saját függőségeivel. Mind healthcheckkel. A `core` profil ettől függetlenül működik. |
| M0-17 | Verziók rögzítése | Claude | M0-16 | 30 p | `VERSIONS.md` és a compose image-ek: `postgres:17.11`, `nats:2.14.6`, `getmeili/meilisearch:v1.53.1`, `ghcr.io/goauthentik/server:2026.8.1` — mind digesttel is. Node és npm csomagverziók listája. |
| M0-18 | Authentik előkészítés | Claude | M0-16 | 90 p | OAuth2/OIDC provider (`poc`), Authorization Code + PKCE public tesztkliens, `poc-viewer` / `poc-editor` / `poc-publisher` csoport, három tesztfelhasználó, property mapping a `permissions` és `roles` claimhez. Kimenet: a **tényleges** `issuer` és JWKS URI feljegyezve, discovery dokumentum curl-lel lekérhető, konfiguráció exportálva a repóba. Az access-token `audience` értéke **nem** itt zár: azt a README rögzített szabálya szerint kiadott teszttokennel, M2-ben rögzítjük. |
| M0-19 | Külső hozzáférés-igények jegyzéke | Zoli + Claude | — | 20 p | `docs/external-access.md`: Ant Media sandbox, DRMaaS, player — kitől, mit, mikorra. M6 belépési feltételéhez rendelve. Hiányuk M0–M5-öt nem blokkolja. |

### Sáv E – Indíthatóság és bizonyíték

| # | Feladat | Felelős | Függ | Becslés | Definition of Done |
| --- | --- | --- | --- | --- | --- |
| M0-20 | `poc/backend/README.md` | Claude | M0-04, M0-15 | 45 p | Friss gépen végigjárható indítás, az 5. szakasz parancsaival, valamint a szándékos hibaindukálás lépéseivel. |
| M0-21 | Smoke-check lefuttatása friss klónból | Codex + Claude | mind | 45 p | Az 5. szakasz minden sora lefut, az elvárt eredménnyel. Eltérés esetén jegyzőkönyvben rögzítve. |
| M0-22 | Mintatartalom és seed-terv | Codex | M0-01, M0-07 | 30 p | `test/fixtures/demo-content.json` és a seed script váza; a negatív és konkurens példák leírva. Futtatás M1-től. |

**Összesen:** 1145 perc ≈ 19 óra (az M0-02, M0-06 és M0-16 megnövelt becslésével). A [review](M0-REVIEW.md) 8. pontja alapján a becslés két részre bontva:

| Csomag | Feladatok | Idő |
| --- | --- | --- |
| **Kötelező core alap** (az M0-kapu) | M0-01…M0-15, M0-17, M0-19…M0-22 | 980 perc ≈ **16,5 óra** |
| **Előrehozott full / Authentik** | M0-16, M0-18 | 165 perc ≈ **2,75 óra** |

Sávonként: Codex ≈ 12 óra (728 perc), Claude ≈ 6 óra (358 perc), Zoli 80 perc (az M0-01 és M0-19 közös része).

**Ez nem fér a MILESTONES-ban szereplő „1. nap eleje” keretbe, és egy teljes munkanapba sem.** A Codex-sáv önmagában másfél fejlesztői nap soros munka. Három reális út: (a) az M0-09, M0-10, M0-11 (135 perc) átkerül Claude-hoz; (b) a full/Authentik csomag (M0-16, M0-18) M2 elejére csúszik; (c) M0 két fejlesztői napot kap, és az M1–M5 célütemezés ehhez igazodik. Egyik esetben sem blokkolódik az M1-01 migráció, mert az M0-04…M0-07 addigra kész.

A MILESTONES.md időpontjai a README ötnapos célját követik, nem vállalt határidők — ez a becslés ezt a különbséget teszi számszerűvé, nem írja felül a heti scope-ot.

**Kritikus út:** `M0-02 → M0-03 → M0-04 → M0-05 → M0-06`. Ezzel párhuzamosan fut `M0-01` (a spike nem várja meg a döntési kört, és fordítva sem) és `M0-15 → M0-16 → M0-18`. Minden más ezekre épül vagy független.

---

## 5. Futtatható ellenőrző lista

Ez a lista a lezárás bizonyítéka: friss klónból, dokumentált parancsokkal, elvárt eredményekkel. A `<repo>` és a portok az M0-20-ban véglegesednek.

### 5.0 Előfeltételek és futtatási szabályok

**A hoston szükséges eszközök** (az M0-20 runbook is felsorolja): `git`, `node` ≥ 24.15, `npm`, `docker` + `docker compose`, `curl`, `jq`, `timeout` (coreutils). A NATS CLI **nincs** a `nats:2.x` szerverimage-ben; ahol kliensre van szükség, külön `natsio/nats-box` szolgáltatás a `full` profilban (M0-16), vagy a monitoring HTTP-végpont.

**Konfiguráció:** az `.env.example` placeholderei nem működő értékek. Az M0-20 runbook ad egy **működő helyi `.env` blokkot** (helyi PostgreSQL-jelszó, portok, `FEATURE_*=off`), amit a lista első lépése másol be. Az egyes alszakaszok nem a shell `unset`-jével, hanem **külön `.env` fájllal** állítanak elő eltérő konfigurációt — a shellbeli `unset` nem hat a `.env`-ből betöltött kulcsokra.

**Folyamatgazda:** minden alszakasz maga indítja és maga állítja le az alkalmazást; egyszerre egy példány fut. Enélkül a 3000-es porton `EADDRINUSE` jön, egy korábbi példány válaszolhat egy új teszt helyett, és az 5.2 „nem indul el” elvárása hamisan is teljesülhet.

**Titokellenőrzés:** ismert, nem éles **sentinel** értékekkel dolgozunk (`teszt-token-ne-kerulj-logba`, a helyi `.env` jelszava), és géppel értékelt találatmentességet várunk. A redact-útvonalak önmagukban nem szűrnek részszöveget URL-ek vagy hibaüzenetek belsejéből, ezért **a teljes `DATABASE_URL` sosem kerül logba** — ezt az M0-10 DoD-ja külön kimondja.

### 5.1 Alapindulás

```bash
git clone <repo> tv2-poc
cd tv2-poc/poc/backend

node -v                 # elvárt: v24.x
npm ci                  # elvárt: lockfile-ból, feloldatlan függőség nincs

cp .env.example .env    # ELŐBB, mint a compose: a compose innen interpolál
docker compose --profile core up -d
docker compose ps       # elvárt: postgres  ...  (healthy)
docker compose exec -T postgres pg_isready -U poc
                        # elvárt: accepting connections

npm run db:migrate      # elvárt: alkalmazott migrációk listája
npm run db:migrate      # másodszor: "nincs alkalmazandó migráció", nem hiba

npm run start > /tmp/poc-app.log 2>&1 &
APP_PID=$!
timeout 30 bash -c 'until curl -sf localhost:3000/health/live >/dev/null; do sleep 1; done'
echo "bootstrap=$?"                              # elvárt: 0

curl -s localhost:3000/health/live  | jq .       # elvárt: {"status":"ok", ...}
curl -s localhost:3000/health/ready | jq .       # elvárt: status ok, details.postgres up
curl -s localhost:3000/docs-json    | jq .info   # elvárt: cím és verzió

# az 5.2–5.6 mindegyike saját példányt indít, ezért itt leállítjuk:
kill $APP_PID; wait $APP_PID 2>/dev/null
```

Minden további alszakasz ugyanezt a mintát követi: indítás háttérben, `timeout`-os readiness-várakozás, a végén `kill`. Enélkül a 3000-es porton `EADDRINUSE` jön, és az 5.2 „nem indul el” elvárása hamisan is teljesülhet.

### 5.2 Hiányzó kötelező konfiguráció – érthető indítási hiba

```bash
PORT=3001 DATABASE_URL= npm run start; echo "exit=$?"
# elvárt: az app nem indul el, a hibaüzenet néven nevezi a DATABASE_URL kulcsot,
#         az értéket nem írja ki, exit != 0

PORT=3001 FEATURE_IDENTITY=on OIDC_ISSUER_URL= npm run start; echo "exit=$?"
# elvárt: a bekapcsolt feature kötelezővé teszi a saját kulcsait; nem indul, exit != 0
```

Az eltérő `PORT` szándékos: így egy véletlenül futva maradt példány `EADDRINUSE`-a nem tűnhet konfigvalidációs hibának.

### 5.3 Elérhetetlen kötelező függőség – readiness, nem hamis siker

```bash
docker compose stop postgres
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/health/live   # elvárt: 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/health/ready  # elvárt: 503
curl -s localhost:3000/health/ready | jq '.status, .error'            # elvárt: "error", benne a postgres indikátor
# figyelem: a health-végpontok terminus-formátumot adnak, NEM problem+json-t (D-M0-09, M0-08)
docker compose start postgres
sleep 5
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/health/ready  # elvárt: 200
```

### 5.4 Opcionális függőség hiánya nem bizonytalanítja el a scope-ot

```bash
grep -v '^ANTMEDIA_' .env > .env.nomedia
ENV_FILE=.env.nomedia npm run start > /tmp/poc-nomedia.log 2>&1 &
timeout 30 bash -c 'until curl -sf localhost:3000/health/live >/dev/null; do sleep 1; done'

grep -c 'MediaModule' /tmp/poc-nomedia.log   # elvárt: >= 1 warn sor a kikapcsolt modulról
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/health/ready   # elvárt: 200
pkill -f 'node .*dist/main'
```

A `.env` szerkesztése azért kell, mert a shellbeli `unset` nem hat a `.env`-ből betöltött kulcsokra — az 5.1 óta ott vannak.

### 5.5 Admin API auth nélkül nem kiszolgált

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST localhost:3000/admin/contents -H 'Content-Type: application/json' -d '{}'
# elvárt FEATURE_IDENTITY=off mellett: 503, NEM 200, nem 401 és nem 404

curl -s -o /dev/null -w '%{http_code}\n' \
  localhost:3000/admin/contents/00000000-0000-0000-0000-000000000000
# elvárt: 503 — a prefix-kapu a route regisztrációjától függetlenül zár (M0-09)

curl -s -X POST localhost:3000/admin/contents -d '{}' | jq .code
# elvárt: "dependency_unavailable"
```

M0-ban a `content` modul még üres váz, tehát ezek a route-ok nem is léteznek. Ezért fontos, hogy a kapu **prefix-middleware** legyen és 503-at adjon, ne a Nest alapértelmezett 404-ét — különben a teszt akkor is „zöld” lenne, ha a kapu nincs bekötve.

### 5.6 Titokmentes logolás

```bash
set -a; . ./.env; set +a          # a jelszó a .env-ben él, a shellben nincs exportálva
PGPASS=$(printf '%s' "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
[ -n "$PGPASS" ] || { echo "nincs jelszó a DATABASE_URL-ben, ez a lépés kihagyva"; }

npm run start > /tmp/poc-app.log 2>&1 &
timeout 30 bash -c 'until curl -sf localhost:3000/health/live >/dev/null; do sleep 1; done'

curl -s -H 'Authorization: Bearer teszt-token-ne-kerulj-logba' \
     -H 'X-Correlation-Id: smoke-0001' localhost:3000/health/live > /dev/null

grep -c 'teszt-token-ne-kerulj-logba' /tmp/poc-app.log      # elvárt: 0
grep -c 'smoke-0001'                  /tmp/poc-app.log      # elvárt: >= 1
[ -n "$PGPASS" ] && grep -Fc -- "$PGPASS" /tmp/poc-app.log  # elvárt: 0
pkill -f 'node .*dist/main'
```

A `grep -F` és a nem üres `$PGPASS` ellenőrzése egyaránt lényeges: üres mintára a `grep -c` minden sorra illeszkedik, egy regex-metakaraktert tartalmazó jelszó pedig hamis negatívot adna.

### 5.7 Későbbi szolgáltatások elérhetők (M1+ előkészítés)

```bash
docker compose --profile full up -d

curl -s localhost:7700/health | jq .          # Meilisearch A – elvárt: available
curl -s localhost:7701/health | jq .          # Meilisearch B – elvárt: available
curl -s localhost:8222/healthz | jq -e '.status=="ok"'   # NATS monitoring
curl -s localhost:8222/jsz     | jq '.streams'           # elvárt: 0 — JetStream él, stream még nincs

curl -sk https://localhost:9443/application/o/poc/.well-known/openid-configuration \
  | jq '{issuer, jwks_uri, authorization_endpoint, token_endpoint}'
# elvárt: a tényleges issuer és JWKS URI — ezek kerülnek a .env.example mellé.
# Az access-token AUDIENCE tényleges értéke ebből NEM derül ki: azt a README szerint
# kiadott teszttokennel kell rögzíteni, ami M2 feladata.
curl -sk "$(curl -sk https://localhost:9443/application/o/poc/.well-known/openid-configuration | jq -r .jwks_uri)" | jq '.keys | length'
# elvárt: >= 1 kulcs

docker compose --profile full down
```

### 5.8 Elvárt eredmények összefoglalója

| Ellenőrzés | Elvárt eredmény | Melyik lezárási feltételt bizonyítja |
| --- | --- | --- |
| 5.1 | Friss klónból dokumentált parancsokkal indul az app és a PostgreSQL | MILESTONES M0 lezárás, 1. mondat első fele |
| 5.2 | Hiányzó kötelező kulcsra érthető, néven nevező indítási hiba | MILESTONES M0 lezárás, 1. mondat második fele; PHASES „Bemutatandó helyzetek” 2. |
| 5.3 | Kiesett kötelező függőségnél `ready` 503, `live` 200 | PHASES „Bemutatandó helyzetek” 1. |
| 5.4 | Opcionális hozzáférés hiánya nem blokkol | PHASES „Bemutatandó helyzetek” 3. |
| 5.5 | Nincs implicit auth bypass | README hét végi lista, 1. pont |
| 5.6 | Token nem kerül a logba | README hét végi lista, 12. pont (korai részbizonyíték) |
| 5.7 | A később bekötendő szolgáltatások konfigurációs helye ismert és él | MILESTONES M0 lezárás, 3. mondat |

---

## 6. M0 lezárási feltételei

- [ ] A D-M0-01…13 döntési tábla minden sora lezárt státuszú (elfogadva / módosítva / tudatosan elhalasztva, indoklással).
- [ ] Friss klónból, dokumentált parancsokkal elindul az alkalmazás és a helyi PostgreSQL (5.1).
- [ ] Hibás vagy hiányzó kötelező konfigurációra érthető, néven nevező indítási hiba keletkezik (5.2).
- [ ] A kötelező és opcionális függőségek elkülönülnek: opcionális hiánya nem blokkol, kötelezőé readinesst rontja (5.3, 5.4).
- [ ] Az adat-, HTTP- és eseményszerződés első változata review-zható és review-zott (M0-07, M0-12, M0-13, M0-14).
- [ ] A később bekötendő szolgáltatások **konfigurációs helye** ismert: a kulcsok az `.env.example`-ben vannak, a `full` profil összeállt (5.7). A profil tényleges elindulása **követett eredmény, nem kapu** — lásd alább.
- [ ] A közös fájloknak van gazdája, és a munkamegosztás írásban rögzített (D-M0-12).
- [ ] A csomag- és konténerverziók pinelve, lockfile és digestek commitolva (M0-17).
- [ ] Nincs implicit auth bypass: az admin API nem kiszolgált hitelesítés nélkül (5.5).
- [ ] Az üzleti mintatartalom és a negatív/konkurens példák rögzítettek (M0-22).

**Nem feltétel M0-hoz:** működő tokenellenőrzés, outbox relay, keresés, reindex, mérés. Ezek a saját milestone-jukban zárnak.

**A kötelező M0-kapu a `core` környezet és a szerződések** (a [review](M0-REVIEW.md) 3. pontja alapján). A `full` profil és az M0-18 Authentik-előkészítés **külön követett eredmény**, amely M2-be átvihető:

| Eredmény | Státusz M0-ban |
| --- | --- |
| `core` profil, migráció, indulás, konfighiba, readiness | **kapu** — enélkül M0 nem zárható |
| Adat-, HTTP-, esemény- és jogosultsági szerződés | **kapu** |
| `full` profil összeállítása (`.env.example`, compose, verziópin) | **kapu** |
| `full` profil tényleges elindulása, Authentik provider és tesztidentitások | követett eredmény; hiánya M2 belépési feltételeként jelenik meg |
| Kiadott teszttokennel igazolt `audience` | **M2**, a README rögzített szabálya szerint |

Ez feloldja a korábbi ellentmondást: az R2 kockázat és a lezárási feltétel ugyanazt mondja.

---

## 7. Kockázatok és kilépési utak

| # | Kockázat | Hatás | Kilépési út |
| --- | --- | --- | --- |
| R1 | NestJS 12 ESM-interop a drizzle / `pg` / nats.js / meilisearch csomagokkal | A nap eleje elmegy a build-lel | M0-02 timebox 90 perc; utána fallback NestJS 11.2.5 + CommonJS + TS 5.9.3 + Jest. A döntést a spike zárja, nem a preferencia. |
| R2 | Az Authentik első beállítása hosszabb a tervezettnél | M2 startja csúszik | M0-18 párhuzamos sávban fut. M0 lezárásához csak annyi kell, hogy az Authentik konténer a `full` profilban elinduljon; a provider, a tesztidentitások és a claim mapping hiánya M2 belépési feltételeként jelenik meg, nem M0 blokkolójaként. |
| R3 | TypeScript 6 vs 7 körüli tooling-zaj | Nehezen értelmezhető fordítási hibák | Pontos verziópin (`6.0.3`), `latest` tag sehol; az oxlint és a Vitest is pinelve. |
| R4 | A döntési kör elhúzódik, M1 nem tud indulni | A hét kritikus útja csúszik | Minden D sornak van alapértelmezése: válasz hiányában a javaslat lép életbe, és a doksi jelöli, hogy jóváhagyás nélkül hatályos. |
| R5 | Konténerimage-ek hét közbeni elcsúszása | „Nálam működik” jellegű eltérés | Digestre pinelt tagek a compose-ban és a `VERSIONS.md`-ben. |
| R6 | A `content` séma a döntési kör után változik | Visszaírt migráció | A `content` migráció szándékosan M1-01; M0 csak DDL-vázlatot rögzít. |

---

## 8. Amit M0 szándékosan nem dönt el

- Stream retention végleges limitekkel, retry- és timeout-paraméterek (M3–M4).
- Kereshető mezők súlya, keresési beállítások, a magyar példák elvárt találatai, oldalhatárok (M4).
- A fallbackre jogosító hibák köre és a karantén megfigyelése (M4).
- Reindex alatti olvashatóság feltétele és a reindex megszakításának kezelése (M5).
- Számszerű késleltetési vagy felzárkózási elfogadási küszöb (M5).
- Média-készállapot fogalma, delivery policy részletei, entitlement-szabályok (M6).
- A `content.updated` eventType bevezetése, ha admin-oldali keresés is kell.

---

## 9. A review átvezetése

A [Codex review](M0-REVIEW.md) nyolc számozott pontja és a szerződéspontosításai így kerültek át. A review nem minősíti elfogadottnak az M0 üzleti javaslatait; az elfogadás továbbra is az M0-01 döntési kör dolga.

| Review-pont | Hol javítva | Mi változott |
| --- | --- | --- |
| 1 [P1] Readiness nem függhet minden integrációtól | **D-M0-03b** (új), M0-08 DoD | Az `/health/ready` csak a PostgreSQL-től függ. NATS, Meilisearch és az IdP hálózati elérhetősége a processing-statusban és az érintett végpont válaszában jelenik meg. A helyi identity-konfiguráció viszont az indulást blokkolja, nem a readinesst. |
| 2 [P1] Migrációs keret és up/down | D-M0-02, M0-06 | Drizzle-kit **custom migration** keret és annak saját nyilvántartása; saját `schema_migrations` tábla nincs. Általános `down` **törölve**; helyette `db:reset` eldobható adatbázisra. A tranzakciós rollback ettől külön, kötelező M1-garancia. |
| 3 [P2] Authentik-kapu ellentmondás | 6. szakasz, R2, M0-18 DoD, 5.7 | A kötelező M0-kapu a `core` környezet és a szerződések. A `full` profil elindulása és az Authentik-előkészítés követett eredmény, M2-be átvihető. Az `audience` M2-ben, kiadott teszttokennel zár. |
| 4 [P2] No-op és elveszett válasz | D-M0-06 | Kötött ellenőrzési sorrend: létezés → `expectedVersion` → állapot → **csak azután** mezőegyezés. Elveszett válasz után újraolvasás; kérésazonosító-alapú idempotencia külön bővítés. |
| 5 [P2] Auth smoke nem létező végpontra | 5.5, D-M0-03, M0-09 DoD | A próba `POST /admin/contents`-re és egy UUID-s admin GET-re megy; a kapu **prefix-middleware**, ezért nem létező route-on is 503. `FEATURE_IDENTITY=on` ellenőrző adapter nélkül **indulási hiba**. Tesztactor csak aláírt teszttokenből, bodyból/headerből soha. |
| 6 [P2] A smoke-lista nem reprodukálható | **5.0** (új), 5.1–5.7, M0-10 DoD | Előfeltétel-lista, működő `.env` blokk, folyamatgazda és cleanup minden alszakaszban, külön `.env` fájl az `unset` helyett, sentinel-alapú titokellenőrzés, a teljes `DATABASE_URL` sosem kerül logba, `nats-box` kliensszolgáltatás a szerverimage helyett. |
| 7 [P2] A spike nem elég | D-M0-01, M0-02 | Node-pin **≥ 24.15**. Háromfokú fallback-lépcső (v12 ESM → v12 CJS → v11 CJS), mert a v12 a CommonJS-t is támogatja. A spike 120 perc, és build + DI + teszt + validált HTTP + OpenAPI bizonyítását kéri. A verziótábla **nem installal bizonyított** — ezt a szöveg kimondja. |
| 8 [P2] Becslés és ütemezés | 4. szakasz zárása | Az összeg **1145 perc ≈ 19 óra**, core és full/Authentik csomagra bontva. A szöveg kimondja, hogy ez nem fér az „1. nap eleje” keretbe, és három kilépési utat ad. |
| Döntési státusz | 2. szakasz bevezetője | A válasz hiánya **nem** tesz elfogadottá egy javaslatot: explicit munkafeltételezés lesz belőle, „nem elfogadott” státusszal, és így kerül az M5 jegyzőkönyvébe. |
| Slug pontosítások | D-M0-05 | Generálás minden mentéskor; üres transzliteráció `content-<id8>`; a 80 karakter a végleges, utótagos slugra vonatkozik; az egyediséget unique index garantálja, nem előzetes `SELECT`. A slug M1-ben nem publikus útvonal. |
| Sémabővítés | D-M0-06 | Új eventType nem automatikusan kompatibilis: a fogyasztó karanténba teheti, ezért külön kompatibilitási és rollout-döntés kell. |
| Auditactor | D-M0-06 | Nincs `system` fallback a futtatott alkalmazásban; hiányzó actor hiba. Tesztactor a tesztprofil aláírt tokenjéből. |
| `SKIP LOCKED` | D-M0-02 | Csak az SQL-közelség indoklása, nem M1-követelmény. |
| Tulajdonosok | D-M0-12 | Az `.env.example` gazdája Codex (a config-séma gazdája), review Claude. A branchnevek példák. |

**Amit a review felvetett, de itt nem zárunk le:** az M1–M5 célütemezés újraértékelése. A 4. szakasz megadja a számot és a három kilépési utat, de az ütemezés a MILESTONES.md dolga, és az M0-01 döntési körben érdemes eldönteni.

## 10. Következő lépés

M0-01: a 2. szakasz döntési tábláját végigvenni. Ez a [fázisterv](PHASES.md) „A döntések következő köre” első sora, kiegészítve a technológiai pinnel és a munkamegosztással. Amint a tábla lezárt, az M0-02 spike indulhat, és vele párhuzamosan az M0-15 Compose-sáv.
