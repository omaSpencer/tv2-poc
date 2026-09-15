# M0 + M1 – futtatási jegyzőkönyv

2026-09-15 · Az M0 infrastruktúra és az M1 tranzakciós CMS-életciklus
implementációjának bizonyítékai. A jegyzőkönyv elkülöníti a megvalósított,
szimulált és még nem tesztelt elemeket.

Kód: [`poc/backend/`](backend/). Futtatási útmutató: [`poc/backend/README.md`](backend/README.md).

## 1. Környezet

| Elem | Érték |
| --- | --- |
| Node.js | 24.20.0 |
| npm | 10.9.7 |
| PostgreSQL | 17.10, `--encoding=UTF8 --locale=C` |
| Futtatás helye | Izolált Linux munkakörnyezet, saját PostgreSQL-példány |
| Konténerregiszter | **Nem elérhető** – lásd 6. szakasz |

A verziópinek és bizonyítékuk: [`poc/backend/VERSIONS.md`](backend/VERSIONS.md).

## 2. Parancsok és eredményük

| Parancs | Eredmény |
| --- | --- |
| `npm ci` | Sikeres, commitolt lockfile-ból |
| `npm run build` | Sikeres, hiba nélkül (TypeScript 6, ESM, NodeNext) |
| `npm run lint` | 0 hiba, 0 figyelmeztetés, 36 fájl |
| `npm run db:migrate` | Két migráció alkalmazva; ismételt futás nem alkalmazza újra |
| `npm test` | **50 teszt / 7 fájl, mind sikeres** |
| `npm run smoke:m0` | **6 / 6 eset sikeres**, exit 0, takarítás után nincs maradék |
| `npm run demo:m1` | Sikeres; v1→v6, 6 audit, 3 függő esemény |

A smoke hibaviselkedése is ellenőrzött: szándékosan rossz adatbázis-jelszóval
exit 1, és nem maradt utána se adatbázis, se folyamat.

## 3. M1 ellenőrzési terv lefedettsége

| # | Próba | Állapot |
| --- | --- | --- |
| T01 | Migráció friss DB-n, majd ismét | Kész – táblák, korlátok, egyediségek, függő outbox index; napló nem változik |
| T02 | Csak címmel létrehozott draft | Kész – v1, 1 created audit, 0 esemény, publikus 404 |
| T03 | Érvényes PATCH, majd azonos adatok | Kész – +1 verzió, majd változatlan verzió/audit/idő/actor |
| T04 | Kihagyott/null/üres/üres lista | Kész – a 2.1 szerinti jelentések; ismeretlen és szerveroldali mező 422 |
| T05 | Két kapcsolat, azonos verzió | Kész – tényleges átfedés lock-kapuval; 1 siker, 1 `version_conflict` |
| T06 | No-op tartalom, stale verzió | Kész – `version_conflict`, nincs írás |
| T07 | Hiányzó publikálási minimum | Kész – 422, változatlan DB-állapot |
| T08 | Publikálás, majd visszavonás | Kész – műveletenként +1 verzió, 1 audit, 1 v1 esemény, `delivered_at` null |
| T09 | Withdrawn szerkesztés, újrapublikálás | Kész – szerkesztés esemény nélkül; republish új eventId, új verzió, megtartott slug |
| T10 | Tiltott állapotátmenetek | Kész – `content_already_published`, `content_not_published`, `content_not_editable` |
| T11 | Két konkurens publish egy rekordra | Kész – 1 állapotváltás, 1 audit, 1 esemény |
| T12 | Két azonos című tartalom konkurens publikálása | Kész – `alap` és `alap-2`, mindkettő teljes audit/outboxszal |
| T13 | Slug határesetek | Kész – kézi ütközés 409, 80 karakteres tő, üres transzliteráció 422, 50 jelölt kimerülése 409 |
| T14 | Auditírás hibája content mentése után | Kész – teljes rollback; létrehozásnál rekord sem marad |
| T15 | Outboxírás hibája | Kész – publish és withdraw esetén is korábbi állapot |
| T16 | Commit előtti célzott hiba | Kész – más kapcsolatról semmi nem látszik |
| T17 | V1 esemény validálása | Kész – típus/status pár, verzió, idő, correlation ID egyezik; tiltott adat nincs |
| T18 | Publikus GET négy esetre | Kész – 404/200/404/404, csak a publikus mezőkkel |
| T19 | Normál app identity off | Kész – minden admin route és method 503, DB változatlan |
| T20 | Identity on adapter nélkül | Kész – indítási hiba; előbb a hiányzó OIDC-kulcsokat nevezi meg |
| T21 | HTTP adapter tesztidentityvel | Kész – DTO, hibakód, státusz, szerializáció, permission; nem OIDC-bizonyíték |
| T22 | NATS/Meili nélkül futó M1 | Kész – szolgáltatás működik, outbox függőben, ready csak DB-től függ |
| T23 | Hibás id/UUID/JSON/verzió | Kész – 404/422/400/422, SQL- és adatszivárgás nélkül |

A konkurenciapróbák nem véletlen időzítésre épülnek: egy kapuzó kapcsolat
ütköző zárat tart, a futtató a `pg_stat_activity` alapján megvárja, amíg
mindkét író ténylegesen a záron áll, és csak ezután enged.

## 4. M0 smoke esetek

| Eset | Eredmény |
| --- | --- |
| 5.1 Core indítás, migráció, health, OpenAPI | PASS – ismételt migráció nem változtat naplót; `/docs-json` dokumentálja a health, admin és katalógus route-okat |
| 5.2 Negatív konfiguráció | PASS – üres `DATABASE_URL`, identity kulcsok nélkül, identity adapter nélkül, hiányzó `ENV_FILE`; egyik sem listen-el, jelszó nem jelenik meg, `.env` csendes pótlása kizárva |
| 5.3 DB-kiesés és visszatérés | PASS – live 200 marad, ready 503 `postgres: down`, majd 30 s-on belül 200 |
| 5.4 Kikapcsolt integrációk | PASS – ready 200, pontosan egy `integrations_disabled` diagnosztika mind a négy integrációval |
| 5.5 Adminblokkolás | PASS – 9 útvonal/method, nem létező admin útvonal és hamis actor is 503; a publikus katalógus közben elérhető |
| 5.6 Titokmentes log | PASS – sentinel token, DB-jelszó és teljes `DATABASE_URL` sehol; correlation ID megjelenik |

## 5. Rögzített döntések, amelyek implementációja eltér a tervszövegtől

| Téma | Terv | Megvalósítás | Indok |
| --- | --- | --- | --- |
| Migrációs forma | „Drizzle Kit custom SQL migráció" | Drizzle Kit `generate` a `src/schema.ts`-ből, kézzel átnézett SQL-lel | Ugyanaz a generált fájlnév és ugyanaz a `drizzle.__drizzle_migrations` napló, de a TS-séma és az SQL nem tud elcsúszni egymástól |
| Body parser | Nem volt kifejtve | Saját `express.json()` és hibahatár, `bodyParser: false` mellett | A keretrendszer alapértelmezése a hibás JSON-t általános 400-ra alakította; így lett belőle a dokumentált `invalid_json` |
| `DATABASE_URL` validálás | – | Védett URL-parsolás | A korábbi változat érvénytelen értéknél nyers `Invalid URL` hibát dobott, amely **visszaadta volna a megadott értéket** |
| Feature-kulcsok | „Bekapcsolt integráció a kulcsait kötelezővé teszi" | Kulcsonkénti hiba, majd külön adapterhiba | Így a hiányzó kulcs a kulcs nevét kapja, nem a flagét |
| Smoke futtatókörnyezet | Izolált Compose-projekt | Compose mód + külső PostgreSQL mód TCP-kapuval | Registry nélkül a Compose mód nem futtatható; a jegyzőkönyv kiírja, melyik módban futott |

## 6. Ami nem készült el, és miért

| Elem | Állapot | Ok |
| --- | --- | --- |
| Image-digestek rögzítése (M0-17 része) | **Nyitott** | A munkakörnyezetből a konténerregiszter nem érhető el; a `VERSIONS.md` megadja a pontos parancsot és a helyet, ahová kerül |
| Full Compose profil indulási próbája (M0-16b) | **Nyitott, nem M0-kapu** | Ugyanaz az ok; a definíció elkészült és `docker compose --profile full config -q` alatt validál |
| Smoke Compose módban futtatva | **Nem futott** | Ugyanaz az ok; a Compose-ág kódja megvan, a külső mód futott le |
| Authentik provider, tesztidentitások, token (M0-18) | M2 feladata | Külső hozzáférés hiánya, lásd `docs/external-access.md` |
| Relay, JetStream, kereső, médiaadapter | M3–M6 | Szándékos scope-határ; az outbox `delivered_at` mezőjét M1 soha nem írja |

Egyetlen elem sem szimulált úgy, hogy közben késznek lenne jelölve. A
`test/support/test-app.ts` tesztidentitás kifejezetten jelölt, a `test/` fa alatt
él, és a `dist/` buildbe nem kerül bele.

## 7. Átadás a következő fázisnak

- **M2** megkapja: a tényleges route/permission táblát (`src/contracts/permissions.ts`),
  az actor kontextust (`src/identity/actor.ts`), az adminblokkolás cserepontját
  (`requestBoundary` `blockAdmin` kapcsolója), a publikus nézetet és a hibakódokat.
- **M3** megkapja: az outbox-sémát és az envelope-leképezést, a stabil `eventId`-t
  és correlation ID-t, a `delivered_at IS NULL` függő indexet és a
  `OutboxRepository.pending`/`pendingStats` olvasási felületét. A tartalom
  tranzakciója nem vár brokerhívásra.
- **M4** megkapja: a PostgreSQL-alapú publikáltsági szabályt, a publikus mezők
  explicit listáját és az aktuális tartalomverzió jelentését.
