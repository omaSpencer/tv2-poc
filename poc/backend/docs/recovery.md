# M5 kereső-helyreállítási runbook

## Biztonsági alapelv

Csak a `search_index_control.phase = ready` index routolható. A reindex nem
üríti a live indexet: ugyanazon Meilisearch-példányon staging indexet épít, és
csak sikeres task után swapol. A régi live index a teljes verify végéig megmarad.

Minden parancs előtt ellenőrizd a `DATABASE_URL`, `NATS_STREAM`, durable nevek,
`MEILI_INDEX_UID` és az A/B endpoint célját. API-kulcsot, tokent és teljes
kapcsolati URL-t ne másolj jegyzőkönyvbe.

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
