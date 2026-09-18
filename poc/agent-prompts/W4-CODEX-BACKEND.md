# W4 Codex feladatlap – BE-F4 eseményút, reindex és skálázás

A koordinátor a `/private/tmp/tv2-poc-be-f4` worktree-ben, a
`codex/final-be-f4` branchen valósítja meg a BE-F4 fázist. A baseline a W3
integrációs kapuját lezáró tiszta `main`, commit: `98dc729`.

## Kizárólagos scope

Audit-ID-k: **C3, C4, C5, C9, D1**. Backend production forrás, backend teszt,
Drizzle schema és migráció, backend runbook/ADR/performance dokumentáció,
`poc/FINAL-BACKEND-EVIDENCE.md`, valamint kizárólag a BE-F4 checklist a
`poc/FINAL-BACKEND-MILESTONE.md` fájlban módosítható. Frontend, OpenAPI
snapshot, frontend generated contract, Compose, koordinációs dokumentum és
milestone-összesítés nem módosítható. A publikus HTTP/OpenAPI alak nem változik.

## Kötelező megoldási szerződés

1. **C3 – at-least-once és consumer-idempotencia**
   - Az eseménycontract és az operátori dokumentáció mondja ki: a JetStream
     kétperces dedupe-ablaka optimalizáció, nem exactly-once garancia. Elveszett
     PubAck vagy késői újraküldés ugyanazzal az `eventId`-val az ablakon túl új
     streamrekordot hozhat létre.
   - A search consumer minden kézbesítésnél az `aggregateId` aktuális DB-sorát
     olvassa; upsert/delete művelete ugyanarra az aktuális végállapotra
     konvergál. Az envelope `aggregateVersion` értéke megfigyelési adat, nem
     jogosít elavult projekció visszaírására.
   - Két külön bizonyíték kerülje a kétperces faliórás várakozást. Egy rövidre
     konfigurált, izolált duplicate-window topology/adapter harness ugyanazzal
     a broker `msgID`-val két külön stream sequence-et igazoljon az ablak két
     oldalán. Egy worker harness ugyanazt az envelope `eventId`-t kétszer
     kézbesítve, közben újabb aggregátumállapottal igazolja, hogy mindkét index
     végül pontosan a DB aktuális állapotát/verzióját tartalmazza, extra
     dokumentum nélkül.
2. **C4 – konstans round-trip retention check**
   - A `hasSequenceRange(first, last)` ne hívjon `getMessage`-et sequence-enként.
     Egyetlen stream-state olvasásból vagy igazoltan konstans számú brokerhívásból
     döntsön a Limits-retention invariáns alapján.
   - Az üres tartomány igaz, az üres stream, levágott alsó/felső határ és a kért
     intervallumot metsző explicit törlés/lost sequence hamis. Ha a broker-state
     nem bizonyítja teljesen, hogy nincs belső rés, az eredmény fail-closed.
   - Adapterteszt nagy (legalább százezres) logikai range-nél is ugyanannyi
     brokerhívást várjon, és fedje a határ-, hole- és bizonytalan metadata-ágat.
3. **C5 – korlátos verifier és mért write barrier**
   - A verifier ne materializálja a teljes PostgreSQL- és Meilisearch-halmazt két
     `Map`-be. Oldalanként, determinisztikus sorrendben vagy más bizonyítottan
     korlátos memóriájú algoritmussal hasonlítson; a memóriaköltség legfeljebb
     az oldalmérettel és egy fix diagnosztikai mintával nőhet.
   - A belső `VerificationResult` külön `missingCount`, `extraCount` és
     `versionMismatchCount` mezőben tartsa meg a pontos darabszámokat. A konkrét
     sample ID-tömbök dokumentált fix plafont és `diagnosticsTruncated` jelzést
     kaphatnak, de a plafon elérése nem tehet hamis `matches: true` eredményt.
     Ez belső verifier contract; HTTP/OpenAPI-változás nem készül. Offset-alapú,
     növekvő költségű teljes bejárás helyett keyset vagy más stabil, mért
     stratégia szükséges.
   - A W4-ben bizonyítandó PoC-plafon **1000 publikált dokumentum**; ezt csak a
     sikeres W4 mérés után mondhatja bizonyítottnak a README/runbook. Az efölötti
     út algoritmikusan továbbra is memóriakorlátos, de csak új kapacitásmérés
     után nevezhető támogatottnak. A reprodukálható 1000 dokumentumos teljes
     verifier/reindex futás rögzítse a maximum rezidens batch/sample méretet, a
     teljes verify időt és a write-barrier megszerzésétől a commit/rollbackig
     tartó tényleges freeze-ablakot. Ez a C5-mérés nem helyettesíti és nem nevezi
     késznek a korábbi 1000+100 M5 kapacitásbaseline-t. Timeout/abort továbbra is
     fail-closed, a barrier minden ágon felszabadul.
4. **C9 – orphaned relay stop/start**
   - A `stop()` fast path csak akkor zárhatja le a relét, ha nincs aktív loop,
     nincs folyamatban stop és nincs még unwindoló `orphanedLoop`. Egy orphan
     mellett a broker `close()` és az `off` állapot nem takarhatja el a futó
     munkát.
   - Determinisztikus, kézzel oldható publish/mark promise-szal bizonyítsd:
     grace timeout után az azonnali második `stop()`/`start()` nem indít második
     loopot, nem zárja le idő előtt a shared brokert és nem publikál kétszer;
     az orphan rendeződése után a normál restart működik.
5. **D1 – admin keresés indexstratégia**
   - Forward-only migráció telepítse a `pg_trgm` extensiont és a tényleges
     `title ILIKE` / `slug ILIKE` predikátumokhoz illeszkedő GIN trigram
     indexet/indexeket. A Drizzle schema és migrációs metadata ne drifteljen.
   - A query szemantikája, escape-kezelése, keyset cursorja és publikus contractja
     nem változhat. Rövid keresőkifejezésnél se állítsunk hamis indexhasználati
     garanciát.
   - Izolált, eldobható adatbázisban legalább 10 000, determinisztikusan generált
     soron készüljön `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` evidence. Legalább
     egy mérés pontosan a `ContentRepository.listForAdmin` production alakját
     reprodukálja: `title ILIKE ... OR slug ILIKE ...`, az alkalmazható
     status/category/cursor filterekkel, `ORDER BY updated_at DESC, id DESC` és
     valódi `LIMIT` mellett. A title- és slug-szelektivitás külön tervvel is
     mérhető, de nem helyettesíti a tényleges OR query elfogadott tervét.
     Rögzítsd a plan node-okat, sorbecslést, tényleges sorokat, sort/index
     viselkedést és futási időt; production adathoz a mérés nem nyúlhat. A
     runbook nevezze meg a production `CREATE EXTENSION`
     jogosultság/preprovision előfeltételét és a forward-fix hibautat.

## Tesztek és kapuk

- Külön topology/adapter teszt az ablakon túli, azonos msgID-jú második stream
  sequence-re, és külön contract/worker teszt a DB-aktuális konvergenciára.
- JetStream adapter unit/integrációs teszt a konstans round-tripra, retention
  boundsra, explicit gapre és fail-closed metadata-ágra.
- Verifier unit/integrációs teszt több oldalra, missing/extra/version mismatchre,
  fix diagnosztikai plafonra, memória-invariánsra és barrier rollbackre.
- Relay lifecycle versenyteszt kontrollált pending promise-okkal.
- Az 1000 publikált dokumentumos teljes verifier/reindex mérés raw vagy
  reprodukálható kivonata tartalmazza a batch/sample maximumot, verify időt és
  write-freeze időt.
- Migrációs kapu: friss adatbázis teljes felépítése; külön már `0005`-ön álló,
  feltöltött adatbázis forward upgrade-je; indexdefiníció és production alakú
  10k-s EXPLAIN harness; végül ismételt migrate no-op. A nyers mérési eredmény
  vagy tömör, reprodukálható kivonata evidence-be kerül.
- Célzott tesztek után `npm run verify` Node 24.20.0-n, healthy
  PostgreSQL/NATS/Meilisearch stackkel. OpenAPI drift nem lehet.

## Evidence, review és átadás

- Evidence-ben ID-nként: módosított fájl, invariáns, futtatott parancs, pontos
  eredmény és mérés. Checklist csak tényleges teljesülésre frissülhet.
- Egy review-zható commit vagy világosan indokolt, kis commitsor; nincs merge,
  rebase vagy push.
- Átadás: branch, commit SHA, audit-ID-k, fájlok/viselkedés,
  parancsok/eredmények, nem futtatott kapuk, mérési környezet, kockázat és
  scope-nyilatkozat.
- Cursor az FE-F4 átadása után read-only review-t végez. Backend találatot ezen
  az ágon kizárólag Codex javíthat.
