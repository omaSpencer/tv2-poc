# M5 kereső-helyreállítási runbook

## Biztonsági alapelv

Csak a `search_index_control.phase = ready` index routolható. A reindex nem
üríti a live indexet: ugyanazon Meilisearch-példányon staging indexet épít, és
csak sikeres task után swapol. A régi live index a teljes verify végéig megmarad.

Minden parancs előtt ellenőrizd a `DATABASE_URL`, `NATS_STREAM`, durable nevek,
`MEILI_INDEX_UID` és az A/B endpoint célját. API-kulcsot, tokent és teljes
kapcsolati URL-t ne másolj jegyzőkönyvbe.

## Adatbázis-migráció helyreállítása

### Policy és felelősség

A migrációs policy **forward-only**: alkalmazott migrációt nem írunk át, és
nem tartunk fenn általános automatikus `down` utat. A két támogatott
helyreállítás:

1. **forward-fix migráció** – alapértelmezett, ha a hibás migráció után írás
   történt, az új sémát már használta alkalmazás, vagy az adat javítható
   adatvesztés nélkül;
2. **ellenőrzött backup restore** – csak akkor, ha a release leállítható vagy
   read-onlyvá tehető, a visszaállítási pont igazolt, az RPO szerinti elvesző
   írásokat a release owner elfogadta, és van egyeztetési terv az utána
   keletkezett eseményekre.

A release owner mondja ki a go/no-go és restore/forward-fix döntést, kijelöli
az incidens időablakát és őrzi az evidence-et. A migráció szerzője készíti a
forward-fixet; egy másik backend reviewer ellenőrzi az SQL-t és az adatmegőrzési
invariánsokat. A kijelölt adatbázis-operátor készíti/ellenőrzi a backupot és
végzi a restore-t. Ugyanaz a személy több szerepet csak dokumentált
vészhelyzeti eltéréssel vihet.

### Release előtti minimum

- Rögzítsd a release commitot, a célkörnyezet nevét és a
  `drizzle.__drizzle_migrations` aktuális sorait; kapcsolat URL vagy credential
  ne kerüljön a jegyzőkönyvbe.
- Készíts időbélyeges, titkosított backupot, ellenőrizd a mentés kilépési
  kódját és listázhatóságát, majd rögzítsd az artifact azonosítóját és
  checksumját.
- A migráció előbb a friss staging/rehearsal adatbázison fusson. Az
  alkalmazás buildjének, a health checknek és a releváns integrációs
  teszteknek ugyanazon sémán kell zöldnek lenniük.
- Production futtatás előtt legyen ismert stop/read-only út, kommunikációs
  gazda és döntési határidő. Sikertelen vagy bizonytalan migráció után ne
  induljon automatikusan korábbi alkalmazásverzió az új sémára.

### Rehearsal friss, eldobható környezetben

1. Hozz létre egy új, `_test` jelölésű adatbázist; soha ne használd ehhez a
   production `DATABASE_URL` értékét.
2. Állítsd vissza a kiválasztott backupot ebbe az üres célba. A restore ne
   írja felül helyben az eredeti adatbázist.
3. Ellenőrizd a backup checksumját, a migrációs naplót, a kritikus táblák
   rekordszámát és az alapvető content/audit/outbox idegen kulcs- és
   egyediségi invariánsokat.
4. A restore-olt célon futtasd az aktuális `npm run db:migrate` parancsot, majd
   `npm run verify`-t a hozzá tartozó izolált NATS/Meilisearch stackkel.
5. Forward-fix próbánál előbb reprodukáld a hibás állapotot ugyanitt, majd az
   új, append-only migrációt alkalmazd. Bizonyítsd, hogy az ismételt migráció
   no-op, az adatok megmaradtak, és a korábbi build nem indul el tévesen, ha
   nem kompatibilis.
6. Rögzítsd a restore és a migráció idejét, az ellenőrzések eredményét,
   valamint a gyakorlat során talált kézi lépéseket. A rehearsal adatbázist
   csak a jegyzőkönyv lezárása után lehet eltávolítani.

A restore/migráció parancsváza kizárólag az előre létrehozott, üres rehearsal
célt használja:

```bash
test -n "$REHEARSAL_DATABASE_URL"
test -n "$BACKUP_FILE"
pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname="$REHEARSAL_DATABASE_URL" "$BACKUP_FILE"
DATABASE_URL="$REHEARSAL_DATABASE_URL" npm run db:migrate
psql "$REHEARSAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c 'select count(*) from drizzle.__drizzle_migrations' \
  -c 'select count(*) from content' \
  -c 'select count(*) from content_audit' \
  -c 'select count(*) from outbox_event'
```

A parancs előtt külön ellenőrizni kell, hogy a
`REHEARSAL_DATABASE_URL` adatbázisneve `_test` jelölésű, nem egyezik a
production céllal, és a restore-hoz használt szerep nem tud más adatbázist
törölni. A fenti rekordszámok nem önmagukban bizonyítják a helyességet; az
adott migráció adatmegőrzési invariánsait külön, review-zott querykkel kell
ellenőrizni.

Rehearsal kötelező az első production release előtt, utána legalább
negyedévente, továbbá backupformátum-, PostgreSQL major-, migrátor- vagy
topológiaváltás után. Sikertelen gyakorlat production release blocker.

### Incidens evidence minimum

A titokmentes jegyzőkönyv tartalmazza: release commit; érintett migrációk
hash-e; backup artifact azonosító/checksum; restore vagy forward-fix indoka és
jóváhagyója; kezdés/befejezés és kiesés; RPO/RTO tényadat; validációs queryk
és tesztkapuk eredménye; elveszett vagy egyeztetett írások; nyitott utómunka.
Nyers dump, DSN, token vagy személyes adat nem evidence.

## Normál reindex

```bash
npm run db:migrate
npm run search:reindex:status
npm run search:reindex -- --index=a
npm run search:reindex -- --index=b
```

Egyszerre csak az egyik index épülhet. A másiknak alaphelyzetben `ready` és
elérhető állapotban kell lennie. A sikeres kimenet tartalmazza a runId-t, S0/S1
határt, dokumentumszámot, verify-összegzést és futásidőt.

Ha egyik index sem routolható, az első helyreállítás szándékos kereséskiesést
igényel. A cél-adatbázis neve pontosan egyezzen:

```bash
npm run search:reindex -- --index=a \
  --allow-search-outage --confirm-target=poc
```

## Megszakadt futás

SIGTERM/SIGINT után a futás `aborted`, hosthiba után az utolsó nem-ready fázis
marad meg. Ne állítsd kézzel `ready`-re. Ugyanarra az aliasra indíts új teljes
futást; új runId és új snapshot készül. A koordinátor csak a saját, pontos
runId-ból képzett staging UID-ját törli.

Gyakori stabil hibakódok:

- `worker_drain_timeout`: aktív worker nem fejezte be az in-flight taskot;
- `relay_drain_timeout`: a snapshot high-waterig függő outbox maradt;
- `stream_history_gap`: az S0–S1 közötti szükséges brokerelőzmény elveszett;
- `import_task_failed` / `swap_task_failed`: Meilisearch task nem sikerült;
- `catch_up_timeout`: a durable ACK-floor nem érte el a rögzített határt;
- `verify_mismatch`: hiányzó, extra vagy eltérő verziójú dokumentum;
- `verify_timeout`: a bounded exclusive ellenőrzés kifutott az időből.

Hiba után a publish/withdraw barrier felszabadul, a CMS írható marad, de az
érintett index `failed/paused` és routingon kívül marad.

## Karantén

```bash
npm run search:quarantine:inspect -- --sequence=42
npm run search:quarantine:replay -- --sequence=42 --reason="schema javítva"
npm run search:repair-content -- --id=<content-uuid> --index=both
```

Az inspect csak lokátort és stabil metaadatot ír ki, payloadot nem. Replay csak
akkor történik, ha az eredeti CONTENT rekord még megvan, jelenleg valid v1
esemény, az aggregate létezik és van jegyzőkönyvi indok. Invalid JSON/séma
esetén az aktuális DB-projekció célzott repairje, ismeretlen aggregate esetén
teljes reindex szükséges. Karanténrekordot a parancsok nem törölnek.

## Baseline

Izolált erőforrásokon, működő relayjel és két workerrel:

```bash
npm run baseline:m5 -- --output=./artifacts/m5-baseline
```

A raw JSON és Markdown összegzés fejlesztői baseline. Nem termelési SLO és nem
kapacitásígéret. Hibás minta vagy timeout az `errors` tömbben marad, nem lesz
csendesen kihagyva.
