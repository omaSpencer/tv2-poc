# M1 – Tranzakciós CMS-életciklus: részletes implementációs terv

2026-09-15 · Codex · Rögzített terv.

**Státusz: implementálva.** A 7. szakasz T01–T23 próbái valódi PostgreSQL 17 ellen futnak és sikeresek, a `demo:m1` mintafolyamat a dokumentált v1→v6 sorrendet, 6 auditot és 3 függő eseményt adja. Bizonyítékok: [M0–M1 futtatási jegyzőkönyv](M0-M1-EVIDENCE.md).

Kiindulópont: [README](README.md), [milestone-terv](MILESTONES.md), [fázisterv](PHASES.md), [Claude M0-terve](M0-IMPLEMENTATION.md) és annak [review-ja](M0-REVIEW.md).

**Státusz:** rögzített implementációs terv a felhasználó döntési felhatalmazása és a [döntésnapló](DECISIONS.md) alapján. A korábbi M0–M1 slug-, publikus médiaazonosító- és tesztidentity-eltérések az itt leírt M1-szabályokkal rendezettek. A checklist még teljesítendő; futási bizonyíték nincs.

## 1. Szállítandó eredmény és belépési feltételek

M1 végén PostgreSQL-en működik a draft létrehozás, szerkesztés, publikálás, visszavonás és újrapublikálás. Minden módosítás verziókezelt, minden tényleges változás auditált; a publikálási állapotváltások outbox-eseménye a tartalommal együtt rögzül. A nyilvános részletlekérés az aktuális publikálási állapotot követi.

| Szükséges M0-eredmény | Miért szükséges? |
| --- | --- |
| Bizonyított build, DI, validáció/OpenAPI és tesztfuttató | A szerződések valóban futtatható HTTP-kezelőkhöz kapcsolódjanak |
| PostgreSQL-kapcsolat és egy kapcsolaton futó tranzakciós keret | Tartalom, audit és outbox atomi mentése |
| Igazolt migrációs formátum és futtató | Az M1-séma friss adatbázisban előállítható legyen |
| Hibaválasz és correlation ID szerződés | Stabil klienshibák, audit és eseménykövetés |
| Admin HTTP működést tiltó alapvédelem | M2 előtt se legyen hitelesítés nélküli adminművelet |
| Tartalom-, permission- és v1 eseményszerződés | Az M1, M2 és M3 illeszkedése |

Az M0-review readiness-, migrációs és authhatár-pontjai az M0 v3 tervben rendezettek; az érintett működés bizonyítása az M0 megvalósításának feladata. A full Compose, működő Authentik, NATS és kereső nem előfeltétele az M1 üzleti integrációs próbáinak. A tényleges runtime/csomagverziók az M0-ban bizonyított készletből jönnek; ez a terv nem vezet be további verziópint.

**M2-határ:** az admin HTTP-végpontok elkészülnek, de valós identity nélkül a normál alkalmazásban blokkoltak. A szolgáltatásréteg és a HTTP-adapter tesztkörnyezetben ellenőrizhető. A valódi belépéses napi demót M1 és M2 együtt teljesíti.

**Későbbi feladat:** relay és JetStream M3; kereső/fallback M4; reindex és teljes helyreállási bizonyíték M5; média-készállapot ellenőrzés M6. M1-ben a médiaazonosító metaadat, nem külső asset-ellenőrzés.

## 2. Rögzített M0–M1 szerződés

| Döntés | M1 döntés | Átvétel / pontosítás |
| --- | --- | --- |
| D-M0-04 – mezők | Drafthoz cím kell; publikáláshoz cím, slug, summary, kategória és médiaazonosító | Rögzített szabály; üres/null viselkedés lent pontosítva |
| D-M0-05 – slug | Globális egyediség, legfeljebb 80 karakter; draft/withdrawn állapotban módosítható | Automatikus generálás csak publikáláskor, ha nincs slug |
| D-M0-06 – változások | Kezdeti verzió 1; tényleges mentés +1; audit minden tényleges változásra | No-op előtt kötelező verzió- és állapotellenőrzés |
| D-M0-06 – esemény | Csak publish/withdraw bocsát ki eseményt | Újrapublikálás is `content.published`; szerkesztés egyik engedett állapotban sem esemény |
| D-M0-07 – ismétlés | Már published publikálása, nem published visszavonása, published szerkesztése `409` | Verzióütközés elsőbbséget élvez az állapothibával szemben |
| D-M0-08/11 – jogok | `content:read`, `content:write`, `content:publish`; publikus részlet login nélkül | M2 köti be az ellenőrzött permissionöket |
| D-M0-09 – hibák | Problem JSON, stabil code, expectedVersion a bodyban | Hibás JSON `400`; helyes JSON, hibás mezőérték `422`; váratlan hiba általános `500` |
| D-M0-10 – esemény | V1 envelope, published/withdrawn típus és megfelelő payload.status | EventType és payload.status összetartozása is validálandó |
| Actor | Auditactor minden író művelethez szükséges | M2 előtt explicit tesztactor; nincs hiányzó actorra `system` alapérték |
| Migráció | M0-ban kiválasztott eszköz által nyilvántartott, előrefelé alkalmazott SQL | Előrefelé migrálás és explicit eldobható teszt-DB újraépítése, DECISIONS D03 szerint |

### 2.1 Mezőkezelés

- `title`: trim után 1–200 karakter. Hiányzó cím létrehozáskor, illetve null vagy üres cím módosításkor `422`.
- `summary`: draft/withdrawn állapotban lehet null; trim után üres érték nullra normalizálódik. Legfeljebb 500 karakter; publikáláskor nem lehet null.
- `category`: null vagy az M0-ban rögzített `film`, `sorozat`, `hir`, `sport`, `szorakozas`, `egyeb` valamelyike. Publikáláskor kötelező.
- `mediaAssetId`: null vagy trim után nem üres, legfeljebb 128 karakteres string; üres érték null. Publikáláskor kötelező. Azonosítóként kis-/nagybetűit megőrizzük.
- `tags`: alapérték `[]`; trim, kisbetűsítés, üres elemek eltávolítása, duplikátumszűrés, első előfordulás sorrendjének megőrzése. Legfeljebb 20 bemeneti elem, normalizált elemenként legfeljebb 40 karakter. Null nem lista, ezért `422`.
- `slug`: null vagy `^[a-z0-9]+(?:-[a-z0-9]+)*$`, legfeljebb 80 karakter. Kézi slugnál trim után validálunk, nem transzliterálunk csendben. Üres string hibás; null kifejezetten törli a szerkeszthető tartalom slugját.
- PATCH-ben a kihagyott mező változatlan. `expectedVersion` nem tartalommező; pozitív egész szám. Tört, nulla, negatív vagy hiányzó érték hibás.
- Ismeretlen vagy csak szerver által írható mező (`status`, `version`, actor, időbélyegek, `id`) nem írható bodyból, és `422`-t eredményez. Ez HTTP-kérésre vonatkozik; az M0 konfiguráció ismeretlen kulcsainak megengedése ettől külön szabály.
- Azonos normalizált mezőértékek aktuális verzió és szerkeszthető állapot mellett no-op mentést adnak. Ekkor az időbélyeg és updatedBy sem változik. Csak expectedVersiont tartalmazó PATCH szintén no-op.

### 2.2 Slug-generálás és időbélyegek

A szerver kizárólag a publikálási tranzakcióban generál slugot, ha az null. A generálási alap az ott olvasott aktuális cím. M0 magyar ékezet-transzliterációját és kötőjeles normalizálását használjuk. A végső csonkolás után a záró kötőjelet is eltávolítjuk. Ha az eredmény üres, `422 validation_failed`; a kliensnek érvényes kézi slugot vagy címet kell megadnia.

Összesen legfeljebb 50 jelölt: alap, majd `-2` … `-50`. Utótag esetén a tövet úgy rövidítjük, hogy a teljes slug maradjon legfeljebb 80 karakter. Kézi slug ütközése közvetlenül `409 slug_conflict`, nem kap automatikus utótagot. Egy címváltozás a meglévő slugot nem módosítja. A visszavonás sem törli azt; a szerkesztő explicit változtathatja vagy nullázhatja. Régi slugok történeti foglalása és átirányítása nem része M1-nek.

A `createdAt` változatlan. Tényleges mentéskor az `updatedAt`, audit `occurredAt` és az esetleges esemény `occurredAt` ugyanazt a műveleti időpontot kapja. `publishedAt` az utolsó sikeres publikálás, `withdrawnAt` az utolsó sikeres visszavonás ideje; egyik nem nullázza a másikat. Az aktuális állapotot mindig a `status` határozza meg.

## 3. Adatmodell és adatbázis-garanciák

A következő séma tervezett. A tényleges migrációazonosító az M0 migrációs nyilvántartásából következik, nem foglalunk előre fájlsorszámot.

### 3.1 `content`

| Mezőcsoport | Tárolás és garancia |
| --- | --- |
| Azonosítás | `id uuid` elsődleges kulcs; nullable `slug` globális unique korláttal |
| Metaadat | `title`, `summary`, `category`, `media_asset_id` text; `tags text[] NOT NULL` |
| Életciklus | `status` a három megengedett értékkel; `version integer NOT NULL`, legalább 1 |
| Időbélyegek | `created_at`, `updated_at` nem null; `published_at`, `withdrawn_at` nullable timestamptz |
| Actor | `created_by`, `updated_by` nem üres stabil subjectazonosító |

DB-korlátok: cím nem üres és legfeljebb 200 karakter; kitöltött opcionális mezők megfelelő hosszúságúak; kategória a megengedett készletben; slug formátum/hossz; tagdarabszám legfeljebb 20; published állapotban minden publikálási minimum teljesül, és published_at nem null. Az elemenkénti tagnormalizálás és -hossz a közös alkalmazásvalidátor feladata; nem állítjuk, hogy minden normalizálási szabályt a DB is ellenőriz.

A nullable slugok nem foglalnak konkrét névértéket, több draftnak lehet hiányzó slugja. A globális unique korlát a végső ütközésvédelem; előzetes keresés önmagában nem elég konkurens publikálásnál.

### 3.2 `content_audit`

| Mező | Jelentés |
| --- | --- |
| `id`, `content_id` | Audit UUID és tartalom FK; nincs automatikus cascade törlés |
| `content_version`, `action` | Sikeres változás utáni verzió; created/updated/published/withdrawn |
| `actor_sub`, `actor_roles` | Explicit actor, szerepnevek listája; nincs token vagy e-mail |
| `occurred_at`, `correlation_id` | Közös műveleti idő és kéréskövetési azonosító |
| `changed_fields` | Megváltozott üzleti mezők nevei, értékek nélkül |

Egyediség: `(content_id, content_version)`. Minden tényleges tartalomverzióhoz egy audit tartozik. Létrehozásnál a beállított üzleti mezőket és a status mezőt soroljuk fel; szerkesztésnél a normalizálás után eltérőket; állapotváltásnál legalább status, valamint a publikáláskor generált slug szerepel. A technikai idő-, actor- és verziómezők nem részei a changed_fields listának. A sorrend determinisztikus.

Az auditot az alkalmazás hozzáfűzi, nem szerkeszti. Ez nyomon követhetőségi napló, nem adatbázis-adminnal szemben megváltoztathatatlan bizonyíték és nem teljes történeti tartalomrekonstrukció.

### 3.3 `outbox_event`

| Mezőcsoport | Jelentés |
| --- | --- |
| `event_id uuid` PK | Az egyszer létrehozott esemény stabil azonosítója |
| `schema_version`, `event_type` | V1; content.published/content.withdrawn |
| `aggregate_id`, `aggregate_version` | Content FK és a sikeres állapotváltás utáni verzió |
| `occurred_at`, `correlation_id`, `payload jsonb` | V1 envelope fennmaradó mezői; payload kizárólag a megfelelő status |
| `delivered_at timestamptz null` | M1-ben mindig null; csak M3 relay írja publish ACK után |

A relay a tárolt envelope-mezőkből képez üzenetet, nem új eventId-val vagy új tartalomverzióval. Egyediség `(aggregate_id, aggregate_version)`; index a függő rekordokra `delivered_at IS NULL`, occurred_at/event_id sorrenddel. M1 nem vezet be foglalási lease-t, több relayt vagy feldolgozott keresőesemény-táblát. A retry diagnosztikai mezőit M3 indokolt migrációval bővítheti.

A séma-validátor és a DB-korlátok biztosítsák az eventType/payload.status párt. A relációs mezők és az envelope között egyetlen leképezés legyen, ne külön tárolt, egymástól eltérhető két eseményváltozat.

## 4. Írási folyamat és konkurenciakezelés

### 4.1 Tranzakcióhatár

A Content szolgáltatás indítja az üzleti tranzakciót. A content repository, az auditírás és az outboxrögzítés ugyanazt a tranzakciós kapcsolatot kapja; egyik sem indít külön commitot, és nem ír a poolból kikért másik kapcsolaton. Az audit és outbox nem utólagos callbackben készül.

Módosítás, publikálás és visszavonás sorrendje:

1. A HTTP-réteg elvégzi a hitelesítési/jogosultsági ellenőrzést és a kérésforma-validálást. M1 normál futásában az adminvédelem blokkol; a további lépések tesztkörnyezetből járhatók végig.
2. Az üzleti szolgáltatás validált commandot és explicit actor/correlation kontextust kap. A szabályok közvetlen szolgáltatáshíváskor is érvényesülnek.
3. Tranzakció indul; az érintett content rekord `SELECT … FOR UPDATE` olvasással zárolódik. Nincs rekord → `404`.
4. Az aktuális verzió összevetése az expectedVersionnel. Eltérés → `409 version_conflict`, actualVersionnel; a művelet nem ír.
5. Az állapot engedélyezi-e a műveletet? Ha nem, a megfelelő `409` következik. Published PATCH akkor is tiltott, ha az értékek azonosak.
6. A normalizált célállapot összeállítása és üzleti validálása. Érvényes no-op esetén változatlan rekordot adunk, írás nélkül.
7. Tényleges változásnál content mentés + verziónövelés, audit hozzáfűzése, állapotváltáskor outbox hozzáfűzése.
8. Commit után sikeres válasz. Bármelyik írás hibájára a teljes művelet rollbackel.

A sorzár a rövid szerveroldali tranzakciót rendezi sorba; a kliens továbbra is optimista verziószerződést használ. A zár alatt nincs NATS-, kereső- vagy média-hálózati hívás. A PostgreSQL sorzár az ugyanazt a rekordot módosító tranzakciókat várakoztatja; az eltérő tartalmak függetlenül kezelhetők. [PostgreSQL 17 locking](https://www.postgresql.org/docs/17/explicit-locking.html).

Létrehozáskor nincs korábbi rekord: validálás után content v1 és created audit készül ugyanabban a tranzakcióban, outbox nélkül. Nincs automatikus HTTP-kérésújrajátszás. Az ismeretlen kimenetelű commit vagy elveszett válasz nem bizonyítható rollbackként; a kliensnek egyeztetnie kell a mentett állapotot. Létrehozási idempotenciakulcs későbbi bővítés.

### 4.2 Slugverseny

Két külön tartalom azonos címből egyszerre publikálható. A már létező slugok előzetes lekérdezése csak segédlet; a unique korlát dönti el, melyik jelölt foglalható.

Automatikus slugnál a jelöltet mentő művelet savepointban fusson. Kizárólag a slug unique korlátjának sérülésekor visszalépünk a savepointra, majd a következő jelölttel próbálkozunk. Audit/outbox csak a végső jelölt sikeres mentése után készül. Más SQL-hiba nem slugütközés, a teljes tranzakció meghiúsul. A PostgreSQL hibás tranzakciója egyszerű catch után nem folytatható; ehhez savepoint-visszaállítás vagy teljes új tranzakció kell. [ROLLBACK TO SAVEPOINT](https://www.postgresql.org/docs/17/sql-rollback-to.html).

Kézi slugnál a unique hiba a teljes művelet rollbackje után `409 slug_conflict`. Az 50 automatikus jelölt kimerülése ugyanezt adja; nincs verziónövelés, audit vagy outbox. A savepoint támogatását a kiválasztott M0-adapteren bizonyítani kell.

## 5. HTTP- és identity-illeszkedés

| Végpont | Permission | Siker | Lényeges hibák |
| --- | --- | --- | --- |
| `POST /admin/contents` | content:write | `201`, admin Content nézet | 422, kézi slugütközés 409 |
| `PATCH /admin/contents/:id` | content:write | `200`, friss vagy no-op admin nézet | 404, 409 verzió/állapot/slug, 422 |
| `POST /admin/contents/:id/publish` | content:publish | `200`, published admin nézet | 404, 409 verzió/állapot/slug, 422 minimum |
| `POST /admin/contents/:id/withdraw` | content:publish | `200`, withdrawn admin nézet | 404, 409 verzió/állapot, 422 |
| `GET /admin/contents/:id` | content:read | `200`, admin nézet minden állapotban | 404, hibás UUID 422 |
| `GET /catalog/contents/:id` | Nyilvános, DECISIONS D06 szerint | `200`, nyilvános nézet | Nem published / nem létezik: 404; hibás UUID: 422 |

Publish/withdraw body csak `{ "expectedVersion": <pozitív egész> }`; ezek nem fogadnak el egyidejű metaadat-szerkesztést. Publikálás sikeres válasza a DB-mentést igazolja, nem állít kereshetőséget.

**Adminválasz:** a Content mezői camelCase nevekkel, időpontok ISO 8601 alakban; nincs auditlista vagy outbox-adat beágyazva. **Nyilvános válasz:** id, title, slug, summary, category, tags, publishedAt. Nem kerül bele actor, belső médiaazonosító, audit, outbox, delivery policy vagy lejátszási engedély. A mezőkör rögzített a DECISIONS D04-ben.

A nyilvános olvasás egy adatbázis-lekérdezésben szűr `status = published` feltétellel; nincs külön ellenőrzés utáni második, szűretlen olvasás. M1 nem használ publikus tartalomcache-t. A visszavonás commitja után indított olvasás `404`; a párhuzamosan már futó olvasásokra a PHASES-ben leírt korlát érvényes.

**M2 előtti védelem:** FEATURE_IDENTITY=off mellett minden létező adminművelet `503 dependency_unavailable`, DB-változás nélkül. FEATURE_IDENTITY=on beállítás ellenőrző adapter hiányában indítási hiba. A tesztben átadott identitás az alkalmazás teszt-összeállításának része; nincs erre környezeti bypass, publikus endpoint vagy megbízhatónak tekintett actor header. M2-ben az actorSub/roles az ellenőrzött identityből érkezik; 401/403 viselkedést ott valódi tokennel is bizonyítjuk.

**Hibakezelési sorrend:** HTTP-hozzáférés → kérésformátum → rekordlétezés → verzió → állapot → üzleti célállapot. Üres/megsértett publikálási minimum mezőhibákat ad, de nem SQL-részleteket. Átmeneti DB-elérhetetlenség `503 dependency_unavailable`; váratlan hiba `500 internal_error` általános szöveggel. A hibasémában mezőnevek szerepelhetnek, visszhangzott érzékeny értékek nem.

## 6. Fejlesztési csomagok és felelősségek

A felelősök a DECISIONS D01 szerinti szerző/review gazdákat jelölik; a táblázat nem indít másik agentet vagy külön feladatot. A pontos fájlnevek a megvalósításkor igazodnak az M0 scaffoldhoz; minden alkalmazásbeli contracts hivatkozás a `poc/backend/src/contracts/` alá értendő.

| # | Csomag | Felelős / review | Függőség | Kész eredmény |
| --- | --- | --- | --- | --- |
| M1-01 | Rögzített döntések átvezetése a contractsba | Codex / Claude | M0 contracts, DECISIONS | A 2. és 5. szakasz szabályai, actor és hibakódok egyeznek a contracts dokumentumokkal |
| M1-02 | Content/audit/outbox migráció | Codex / Claude | M1-01, M0 migrátor | Friss DB-ben helyes séma, korlátok, egyediségek; migráció újrafuttatása nem alkalmazza újra |
| M1-03 | Közös normalizálás és üzleti validálás | Codex / Claude | M1-01 | Azonos szabályok HTTP- és közvetlen service-hívásból; állapot-, null-, no-op- és slughatárok |
| M1-04 | Repository, audit- és outboxrögzítés | Codex / Claude | M1-02 | Explicit közös tranzakció; teljes envelope tartósan rögzíthető, külön commit nélkül |
| M1-05 | Létrehozás és szerkesztés | Codex / Claude | M1-03, M1-04 | v1 létrehozás, konkurens PATCH, no-op és audit; outbox nélkül |
| M1-06 | Publish/withdraw/republish | Codex / Claude | M1-05 | Publikálási minimum, slugverseny, verziónövelés, atomi audit és esemény |
| M1-07 | Admin/public HTTP és OpenAPI | Codex / Claude | M1-05, M1-06, M0 authblokkolás | A hat route dokumentált; adminvédelem, explicit nyilvános mezők és hibák |
| M1-08 | Integrációs és hibapróbák | Codex / Claude | M1-02…07 | A 7. szakasz ellenőrzései valódi PostgreSQL-lel, célzott megszakításokkal |
| M1-09 | Demó, bizonyíték és M2/M3 átadás | Codex / Claude | M1-08 | Reprodukálható fixture, futtatási leírás, teszteredmény és nyitott pontok jegyzéke |

Tervezett érintett területek: `src/content/`, `src/database/`, `src/outbox/` kizárólag rögzítéshez, `src/contracts/`, `migrations/`, `test/integration/`, `test/fixtures/`, backend futtatási útmutató. A Compose/package/lockfile módosítás csak szükséges változás esetén, az M0-ban kijelölt gazdával egyeztetve történik.

**Sorrend:** szerződés → séma és közös validálás → tranzakciós írás → életciklus → HTTP → összesített bizonyítás. A hibapróbák az érintett rész elkészülésével párhuzamosan épülnek, nem csak a fázis végén.

**Előzetes becslés:** szerződés és séma 3–5 óra; üzleti/tranzakciós működés 5–8 óra; HTTP és OpenAPI 2–3 óra; konkurencia-, rollback- és demóellenőrzés 4–6 óra. Összesen 14–22 nettó óra, az M0 javítása és külső egyeztetés nélkül. Ez bizonytalansági sáv, nem vállalás. A relatív munkanapokat a MILESTONES rögzíti; az M1 kerete az 5–8. munkanap. A külső szolgáltatások előkészítése nem kötelező párhuzamos munkafeltétel.

## 7. Ellenőrzési terv

Az adatbázis-garanciákhoz valódi PostgreSQL 17 kell. Mock repository önmagában nem bizonyít tranzakciót, korlátot vagy konkurenciát. A tesztek elkülönített, eldobható adatbázison futnak; a demóadatok törlése nem előfeltétel. A tesztadatbázis kiválasztása explicit, a tesztfuttató téves céladatbázissal megáll.

| # | Helyzet | Ellenőrizendő eredmény |
| --- | --- | --- |
| T01 | Migráció friss DB-n, majd ismét | A három tábla és korlátai megvannak; nincs dupla alkalmazás |
| T02 | Csak címmel létrehozott draft | v1, draft, 1 created audit, 0 outbox; publikus olvasás 404 |
| T03 | Érvényes PATCH, majd azonos normalizált adatok | Első mentés +1 verzió/audit; második változatlan verzió/audit/idő/actor |
| T04 | Kihagyott mező, null, üres string, üres taglista | A 2.1 szerinti eltérő jelentések; tiltott és ismeretlen mezők elutasítva |
| T05 | Két külön DB-kapcsolatról ugyanaz a verzió módosul | Valóban átfedő műveletekből egy siker és egy 409; egyetlen verziólépcső és audit |
| T06 | No-op tartalom, de stale expectedVersion | 409, nem csendes siker; nincs írás |
| T07 | Publikálási minimum hiányzik | 422, teljes korábbi DB-állapot megmarad, nincs új audit/outbox |
| T08 | Érvényes publikálás, majd visszavonás | Műveletenként +1 verzió, 1 audit és 1 helyes v1 esemény; delivered_at null |
| T09 | Withdrawn szerkesztés és újrapublikálás | Szerkesztés auditált, esemény nélkül; újrapublikálás új eventId és új verzió |
| T10 | Published PATCH/publish; draft vagy withdrawn withdraw | Helyes állapothiba; változatlan rekord/audit/outbox |
| T11 | Két konkurens publish ugyanarra a rekordra/verzióra | Egy állapotváltás, egy audit, egy outbox; a vesztes version_conflict |
| T12 | Két külön, azonos című tartalom konkurens publikálása | Külön slugok, mindkét érvényes művelet teljes audit/outboxszal; nincs sérült tranzakció |
| T13 | Kézi slugütközés, 80 karakteres tő, üres generált slug, 50 foglalt jelölt | Dokumentált hossz/422/409; hibánál nincs részleges mentés |
| T14 | Auditírás meghiúsul content mentése után | A content visszaáll, nincs audit/outbox; létrehozásnál rekord sem marad |
| T15 | Outboxírás meghiúsul content és audit írása után | Mindhárom korábbi állapota megmarad; publish és withdraw esetén is |
| T16 | Minden írás után, commit előtt célzott hiba | Az új contentverzió, audit és outbox egyike sem látható külön DB-kapcsolatról |
| T17 | V1 esemény validálása | Típus/status összhang; audit/content verzióval, idővel és correlation ID-val egyezik; tiltott adat nincs |
| T18 | Public GET draft/published/withdrawn/nem létező rekordra | 404/200/404/404; kizárólag a publikus mezők kerülnek válaszba |
| T19 | Normál app identity off; minden tényleges admin route/method | 503, nincs DB-módosulás; hamis actor/permission header sem segít |
| T20 | Identity on, ellenőrző adapter nincs | Indítási hiba, nincs kiszolgált adminfelület |
| T21 | HTTP adapter kontrollált tesztidentityvel | DTO-validáció, hibakód, status, serialization és required permission hozzárendelés; nem valódi OIDC-bizonyíték |
| T22 | NATS/Meili konfiguráció és szolgáltatás nélkül futó M1 | Service-műveletek sikeresek, outbox függőben marad; ready csak a szükséges DB-től függ |
| T23 | Nem létező ID, hibás UUID, hibás JSON, hibás expectedVersion | Következetes 404/422/400/422; nincs belső SQL/adat visszaszivárgás |

A konkurenciapróbák két kapcsolattal és explicit szinkronizációval biztosítják az átfedést; puszta egymás utáni hívás vagy véletlen időzítés nem elég. A rollback-próbák célzott hibát injektálnak a valódi tranzakció adott pontján. Ehhez kizárólag teszt-összeállításban elérhető eszköz használható, üzemi HTTP-hibakapcsoló nem.

A migrációhoz közvetlen negatív DB-próbák is tartoznak: nem megengedett status/kategória, ismételt nem null slug, nem pozitív verzió és published állapot hiányzó minimummal nem tárolható. Az API-validálás ezt nem helyettesíti.

### 7.1 Tervezett futtatási szerződés

A következő parancsok **a megvalósítandó npm scriptek elvárt felületei**, jelenleg nem futtatható vagy lefuttatott bizonyítékok. A backend könyvtár, konfiguráció és M0-eszközök elkészülte szükséges hozzájuk.

| Parancs a backendből | Elvárt feladat |
| --- | --- |
| `npm run build` | Az M0-ban kiválasztott toolchainnel fordít |
| `npm run db:migrate` | A kifejezetten beállított DB-n alkalmazza a hiányzó migrációkat |
| `npm run test:integration:m1` | Elkülönített teszt-DB-n futtatja T01–T23 releváns próbáit, siker/hiba exit kóddal |
| `npm run demo:m1` | Teszt-összeállításban, HTTP-listener nélkül végigjárja a mintafolyamatot, majd lezárja a kapcsolatokat |

A demó M0 mintatartalmát használja, futásonként új contentazonosítóval. Elvárt sorrend: draft v1 → metaadat-módosítás v2 → publish v3 → withdraw v4 → withdrawn módosítás v5 → republish v6. Összesen 6 audit és 3 függő outbox-esemény. A no-op és elutasított mellékpróbák ezeket a darabszámokat nem növelik. A publikus HTTP-olvasást külön T18 ellenőrzi.

A dokumentált eredmény tartalmazza a parancsot, környezetet, verziókat, ellenőrzésazonosítót és eredményt. Titkos értékek, bearer token és teljes adatbázis-URL nem része a jegyzőkönyvnek. Az M1 demo tesztactorral működik; M2 adja hozzá a valódi felhasználói bizonyítékot.

## 8. Lezárás és átadás

- [x] A rögzített M0/M1 döntések a tényleges contracts dokumentumokba átvezetve és azokkal egyeznek. (`src/contracts/`)
- [x] A séma friss adatbázisban létrejön, az újrafuttatás és a fontos DB-korlátok ellenőrzöttek. (T01)
- [x] Létrehozás, szerkesztés, publish, withdraw és republish a definiált verzió/audit/eseményszabályt követi. (T02–T03, T08–T09)
- [x] A no-op, stale verzió, állapothiba és publikálási hiány következetes eredményt ad. (T03, T06, T07, T10)
- [x] A valóban konkurens mentés/publikálás és a külön tartalmak slugversenye bizonyított. (T05, T11, T12, T13)
- [x] Audit- és outboxhiba, valamint commit előtti hiba esetén nincs félkész állapot. (T14–T16)
- [x] A nyilvános részlet csak aktuálisan publikált tartalmat és a kijelölt mezőket adja. (T18)
- [x] Identity nélkül az admin HTTP zárt; tesztactor nem szivárog át a normál alkalmazásba. (T19–T21; a teszt-összeállítás a `test/` fa alatt él, a `dist/` buildbe nem kerül)
- [x] V1 események tartósak és helyesek, delivered_at null; nincs véletlen külső kézbesítés. (T08, T17)
- [x] A dokumentált ellenőrzések és a demó reprodukálhatók; az eredmények és fennmaradó korlátok feljegyezve. ([M0–M1 futtatási jegyzőkönyv](M0-M1-EVIDENCE.md))

**M2-nek átadandó:** tényleges route/permission tábla, actor kontextus, adminblokkolás lecserélésének illesztési pontja, public nézet és HTTP-hibák. A service-réteg explicit actort vár, az identity a megbízható actor előállításáért és a hozzáférés ellenőrzéséért felel.

**M3-nak átadandó:** outbox-séma és envelope-leképezés, stabil eventId és correlation ID, kizárólag publish ACK után módosítható delivered_at, függő rekordok lekérdezési indexe. A tartalom tranzakciója nem várhat brokerhívásra.

**M4-nek átadandó:** PostgreSQL-alapú publikáltsági szabály, a publikus mezők explicit listája és az aktuális tartalomverzió jelentése. Draft/withdrawn szerkesztés nem bocsát ki keresőeseményt; a későbbi publish/withdraw esemény az aktuális állapot projekcióját indítja.

M1 lezárása üzleti/adatbázis- és adaptereredmény. A valódi OIDC-jogosultságot M2, az újrakézbesítés keresőbeli végállapotát M4–M5 bizonyítja.
