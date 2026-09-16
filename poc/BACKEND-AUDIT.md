# Backend – átfogó code review audit report

**Dátum:** 2026-09-16
**Hatókör:** a `backend/src` teljes forrásállománya (kb. 7000 sor, minden fájl elolvasva), kiegészítve a `backend/scripts` CLI belépési pontjaival. A tesztek (`backend/test`) csak referenciaként szerepelnek.
**Módszer:** kézi, fájlonkénti átolvasás; `npm run lint` (oxlint) lefuttatva: 0 hiba, 0 warning.

> **A dokumentum célja:** minden találat tartalmazza a pontos fájl- és sorhivatkozást, a probléma leírását, az indoklást és a **konkrét javítási utasítást kódrészlettel**, hogy egy kisebb AI modell (vagy junior fejlesztő) önállóan, további kontextus nélkül végre tudja hajtani. A javítás után futtatandó ellenőrzések a dokumentum végén találhatók.

---

## Összefoglaló

A kódbázis összképe kifejezetten jó: egyetlen normalizálási út a HTTP-határon, tranzakcionális outbox, DB-szinten kikényszerített üzleti invariánsok (CHECK constraintek), strukturált és titok-mentes logolás, gondosan felépített ACK-szemantika a search workerben. A találatok többsége ezért nem architekturális hiba, hanem célzott javítás.

| Súlyosság | Darab | Azonosítók |
|---|---|---|
| MAGAS | 1 | F-01 |
| KÖZEPES | 6 | F-02 … F-07 |
| ALACSONY | 6 | F-08 … F-13 |
| INFORMÁCIÓS | 6 | I-01 … I-06 |

**Javasolt javítási sorrend:** F-01 → F-03 → F-02 → F-05 → F-04 → F-06 → F-07 → alacsonyak tetszőleges sorrendben.

---

## MAGAS súlyosságú találatok

### F-01: A pool-szintű `query_timeout: 5500` megöli a hosszú reindex/barrier műveleteket

**Fájlok:**
- `backend/src/database.ts` (60–64. sor, a `Pool` konstruktor)
- Érintett hívók: `backend/src/search/reindex/coordinator.ts` (`verifyUnderBarrier`, 229–247. sor), `backend/src/search/reindex/snapshot-reader.ts` (29–31. sor), `backend/src/content/content.service.ts` (`acquireWriteBarrier`, 232–240. sor)

**Probléma.** A `pg` driver `query_timeout` opciója **kliensoldali** időzítő, amely minden lekérdezésre vonatkozik, és **nem** írható felül `SET LOCAL statement_timeout`-tal (az csak a szerveroldali limitet módosítja). A pool jelenleg így épül:

```ts
// database.ts, jelenlegi állapot
this.pool = new Pool({
  connectionString: config.getOrThrow<string>('DATABASE_URL'),
  max: 10, connectionTimeoutMillis: 1000, idleTimeoutMillis: 10000,
  statement_timeout: 5000, query_timeout: 5500,
});
```

Ugyanebből a poolból jön a `withClient()` session is, amelyen a reindex fut. Következmények:

1. `coordinator.ts verifyUnderBarrier`: a `select pg_advisory_xact_lock($1, $2)` akár `REINDEX_VERIFY_TIMEOUT_MS`-ig (alapból 30 s) blokkolhat, mert épp publish/withdraw tartja a write barriert — de a driver **5,5 s után** kliensoldali hibával megszakítja. A verify fázis tehát terhelés alatt hamisan bukik, és a hiba nem `verify_timeout` kóddal, hanem osztályozatlan `internal_error`-ként jelenik meg.
2. `snapshot-reader.ts`: a `set local statement_timeout = '<REINDEX_IMPORT_TIMEOUT_MS>ms'` (alapból 300 s) hatástalan, mert egy 5,5 s-nál lassabb snapshot-oldal lekérdezést a driver előbb megszakít. Nagyobb adatállománynál a reindex import determinisztikusan elhasal.
3. `content.service.ts acquireWriteBarrier`: a `CONTENT_WRITE_BARRIER_WAIT_MS` konfig bármilyen pozitív egészre állítható; 5500 ms felett a lock-várakozást a driver öli meg `55P03` helyett ismeretlen hibával, így a kliens a dokumentált 503 (`dependency_unavailable`) helyett 500-at (`internal_error`) kap.

**Javítás.** Töröld a `query_timeout` opciót; a szerveroldali `statement_timeout` (amit a hosszú műveletek `SET LOCAL`-lal már ma is felülírnak) és a `connectionTimeoutMillis` együtt lefedi a védelmet:

```ts
// database.ts – a Pool konstruktor cseréje
this.pool = new Pool({
  connectionString: config.getOrThrow<string>('DATABASE_URL'),
  max: 10, connectionTimeoutMillis: 1000, idleTimeoutMillis: 10000,
  // A szerveroldali statement_timeout a védelem; a hosszú műveletek
  // (reindex snapshot, verify barrier) SET LOCAL-lal írják felül.
  // Kliensoldali query_timeout szándékosan nincs: azt a SET LOCAL nem
  // tudná felülírni, és megölné a legitim hosszú lekérdezéseket.
  statement_timeout: 5000,
});
```

**Ellenőrzés:** `npm run test:integration:m5` (reindex tesztek), valamint `npm run test:integration:m1` (write path).

---

## KÖZEPES súlyosságú találatok

### F-02: Az OpenAPI séma elmaradt a tényleges `ProcessingStatusView` választól (kontraktus-drift)

**Fájl:** `backend/src/contracts/openapi.ts` (105–141. sor)
**Referencia a tényleges válaszhoz:** `backend/src/ops/processing-status.controller.ts` (36–68. és 141–174. sor), `backend/src/search/worker.state.ts` (12–29. sor)

**Probléma.** A `GET /admin/processing-status` tényleges válasza az M5 óta jóval több mezőt tartalmaz, mint amit a publikált séma dokumentál:

- `searchIndexStatusSchema`-ból hiányzik a `paused` state (a `SearchIndexRunState` unió tartalmazza), az `inFlightTaskUid`, továbbá az M5-ben hozzáfésült durable mezők mind: `phase`, `desiredWorkerState`, `runId`, `snapshotStreamSequence`, `outboxHighWater`, `catchUpStreamSequence`, `importedDocuments`, `expectedDocuments`, `startedAt`, `updatedAt`, `completedAt`, `routeEligible`.
- A `processingStatusViewSchema.consumers` elemei csak `name` + `pending` mezővel vannak dokumentálva, miközben a válasz `ackPending`, `ackFloorStreamSequence`, `oldestUnfinishedAt`, `oldestUnfinishedAgeMs` mezőket is hordoz.

Mivel a sémák `strictObject`-ek, egy generált kliens vagy egy séma-validátor a valós választ **érvénytelennek** ítéli. Ez pontosan az a drift, amit a kódbázis másutt (`R10`) kifejezetten tilt.

**Javítás.** Bővítsd a két sémát a tényleges válaszra. Az importokhoz vedd fel a `REINDEX_PHASES`, `WORKER_DESIRED_STATES` konstansokat:

```ts
// contracts/openapi.ts – import bővítése
import { CONTENT_CATEGORIES, CONTENT_STATUSES, REINDEX_PHASES, WORKER_DESIRED_STATES } from '../schema.js';
```

```ts
// contracts/openapi.ts – searchIndexStatusSchema cseréje
export const searchIndexStatusSchema = z.strictObject({
  state: z.enum(['off', 'bootstrapping', 'idle', 'processing', 'retrying', 'paused', 'halted']),
  durable: z.string(),
  inFlightEventId: z.uuid().nullable()
    .describe('Not necessarily included in the durable pending count.'),
  inFlightTaskUid: z.number().int().nullable(),
  lastAckedAt: isoDateTime.nullable(),
  lastErrorCode: z.string().nullable(),
  reachable: z.boolean().nullable().describe('Null until the endpoint has been probed.'),
  // M5 – a search_index_control sorból hozzáfésült durable állapot.
  phase: z.enum(REINDEX_PHASES).nullable(),
  desiredWorkerState: z.enum(WORKER_DESIRED_STATES).nullable(),
  runId: z.uuid().nullable(),
  snapshotStreamSequence: z.number().int().nullable(),
  outboxHighWater: z.number().int().nullable(),
  catchUpStreamSequence: z.number().int().nullable(),
  importedDocuments: z.number().int().nonnegative(),
  expectedDocuments: z.number().int().nullable(),
  startedAt: isoDateTime.nullable(),
  updatedAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
  routeEligible: z.boolean().describe('phase === ready AND the runtime state is routable.'),
});
```

```ts
// contracts/openapi.ts – a processingStatusViewSchema `consumers` mezőjének cseréje
  consumers: z.array(z.strictObject({
    name: z.string(),
    pending: z.number().int().nonnegative(),
    ackPending: z.number().int().nonnegative(),
    ackFloorStreamSequence: z.number().int().nonnegative(),
    oldestUnfinishedAt: isoDateTime.nullable(),
    oldestUnfinishedAgeMs: z.number().int().nonnegative().nullable(),
  })).optional(),
```

**Ellenőrzés:** `npm run contracts:emit`, majd `npm run test:integration:m1` (contracts teszt) és kézi diff a `/docs-json` kimeneten.

### F-03: Sikertelen reindex futás árván hagyja a staging indexet a Meilisearchben

**Fájlok:**
- `backend/src/search/reindex/coordinator.ts` (146–152. sor, `catch` ág)
- `backend/src/search/reindex/importer.ts` (`prepare`, 38–50. sor; `cleanupOldIndex`, 68–71. sor)
- `backend/src/contracts/reindex.ts` (121–123. sor: az `isStagingIndexUid` guard **sehol nincs használva** a src-ben)

**Probléma.** A staging index UID-je run-onként egyedi (`contents__rebuild__<runId>`). A `prepare()` csak a *saját* UID-ját törli (ami új runId miatt sosem létezik), a koordinátor hibaága pedig egyáltalán nem takarít. Következmény: minden elbukott futás (import_timeout, verify_mismatch, aborted stb.) után egy teljes méretű, soha nem törölt index marad a Meilisearch-ben. Ismételt hibázásnál ezek felhalmozódnak és tárhelyet emésztenek.

**Javítás.** Két lépés:

1. A koordinátorban jegyezd meg, hogy megtörtént-e már a swap, és hiba esetén — **csak swap előtt** — töröld a staginget. (Swap után a staging UID alatt a *régi éles* index van; azt hiba esetén meg kell őrizni visszaállítási anyagként.)

```ts
// coordinator.ts – a run() törzsében, az importer létrehozása után
const importer = new StagingImporter(adapter, this.control, options.index, runId);
let swapped = false;
```

```ts
// coordinator.ts – a swap hívás cseréje
await this.control.setPhase(options.index, 'swapping');
await importer.swap();
swapped = true;
```

```ts
// coordinator.ts – a catch ág cseréje
} catch (error) {
  // Swap előtt a staging a félkész új index: nyugodtan törölhető. Swap
  // után a régi éles adat van alatta — hibánál azt meg kell őrizni.
  if (began && !swapped) await importer.cleanupOldIndex().catch(() => undefined);
  if (began) await this.control.fail(options.index, this.errorCode(error)).catch(() => undefined);
  throw error;
}
```

2. (Opcionális, de ajánlott) Régi árva stagingek söprése a `prepare()`-ben az eddig kihasználatlan `isStagingIndexUid` guarddal. Ehhez az adapternek kell egy index-listázó metódus:

```ts
// meili.adapter.ts – új metódus a MeiliIndexAdapter osztályban
async listIndexUids(): Promise<string[]> {
  const response = await this.client.getIndexes({ limit: 1000 });
  return response.results.map(index => index.uid);
}
```

```ts
// importer.ts – a prepare() elejére, az import bővítésével:
// import { isStagingIndexUid, stagingIndexUid, type ReindexErrorCode } from '../../contracts/reindex.js';
async prepare(): Promise<void> {
  // Korábbi, elbukott futások árva staging indexeinek söprése. A guard
  // garantálja, hogy csak az e milestone által létrehozott UID törölhető.
  for (const uid of await this.adapter.listIndexUids()) {
    if (uid !== this.stagingUid && isStagingIndexUid(uid, this.adapter.indexUid)) {
      const sweep = await this.adapter.deleteNamedIndex(uid);
      if (sweep !== null) await this.adapter.awaitTask(sweep);
    }
  }
  const deletion = await this.adapter.deleteNamedIndex(this.stagingUid);
  // ... a metódus többi része változatlan
```

**Ellenőrzés:** `npm run test:integration:m5` és `npm run test -- test/m5-reindex.test.ts`.

### F-04: Meilisearch filter-injektálás lehetősége az adapter határán (defense-in-depth)

**Fájl:** `backend/src/search/meili.adapter.ts` (356–360. sor)

**Probléma.** A keresési filter string-interpolációval épül:

```ts
...(options.category === null ? {} : { filter: `category = "${options.category}"` }),
```

Ma ez nem kihasználható, mert a `normalizeCatalogSearchQuery` a kategóriát a `CONTENT_CATEGORIES` enumra szűkíti. De az adapter publikus API, és a védelem egy *távoli* fájlban lakik: egy későbbi hívó (pl. új CLI vagy másik service) validálatlan értéket adhat át, és `foo" OR category != "` jellegű filterkifejezést injektálhat. A határvédelem elve („boundary validates") itt sérül.

**Javítás.** Escape-eld az értéket az adapterben — a `JSON.stringify` pontosan a Meilisearch által elvárt idézőjelezést és escape-elést adja:

```ts
// meili.adapter.ts – a search() metódusban a filter sor cseréje
...(options.category === null ? {} : { filter: `category = ${JSON.stringify(options.category)}` }),
```

**Ellenőrzés:** `npm run test:integration:m4`.

### F-05: A relay `start()` közvetlenül olvassa a `process.env`-et, megkerülve a validált konfigurációt

**Fájl:** `backend/src/messaging/relay.ts` (111–112. sor)

**Probléma.**

```ts
const enabled = this.config.getOrThrow<string>('FEATURE_OUTBOX_RELAY') === 'on'
  || process.env.FEATURE_OUTBOX_RELAY === 'on';
```

A kódbázis szabálya (lásd `search.config.ts` fejkommentje), hogy semmi nem olvas `process.env`-et a validált ConfigService mellett. Itt egy teszt-kényelmi vagy-ág maradt bent: ha a validált konfigban `off` a flag, de a nyers env-ben `on`, a relay úgy indul el, hogy a `validateConfig` a NATS kulcsokat **nem követelte meg** — a hiányzó `NATS_URL` így nem induláskori, megnevezett konfighiba, hanem futásidejű broker-hiba lesz. Ez pont az az osztályú hiba, amit a config réteg megelőzni hivatott.

**Javítás.** Töröld a vagy-ágat:

```ts
// relay.ts – a start() metódusban
const enabled = this.config.getOrThrow<string>('FEATURE_OUTBOX_RELAY') === 'on';
```

**Ellenőrzés:** `npm run test:integration:m3`. Ha egy teszt erre az env-ágra épült, a teszt assembly-t kell a saját ConfigService-én keresztül `on`-ra állítani (a test/support/relay-test-config.mjs mintájára), nem a nyers env-en át.

### F-06: Némán elnyelt hibák: pg pool `error` esemény és a reindex cleanup

**Fájlok:**
- `backend/src/database.ts` (65–66. sor)
- `backend/src/search/reindex/coordinator.ts` (136. sor)

**Probléma.**

1. `this.pool.on('error', () => {});` — az idle kapcsolatok hibái nyomtalanul eltűnnek. A komment szándéka („never log the raw connection/error object") helyes, de a *stabil hibakód* logolása nem sértené; jelenleg egy szakadozó DB-kapcsolat semmilyen diagnosztikai nyomot nem hagy.
2. `await importer.cleanupOldIndex().catch(() => undefined);` — a komment szerint a cleanup-hiba „maintenance warning", de valójában **semmilyen** warning nem íródik ki, így az operátor sosem tudja meg, hogy kézi törlés vár rá.

**Javítás.**

```ts
// database.ts – az error handler cseréje (a raw error objektum továbbra sem kerül logba)
this.pool.on('error', error => {
  const code = typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : 'unknown';
  process.stderr.write(JSON.stringify({ event: 'pg_pool_error', code }) + '\n');
});
```

```ts
// coordinator.ts – logger felvétele az osztályba (a meglévő pino mintára):
// import { pino, type Logger } from 'pino';
// a konstruktor törzsében: this.log = pino({ level: this.config.get<string>('LOG_LEVEL') ?? 'info' });
// majd a cleanup sor cseréje:
await importer.cleanupOldIndex().catch(() => {
  this.log.warn({ event: 'reindex_cleanup_failed', runId, stagingUid: importer.stagingUid });
});
```

**Ellenőrzés:** `npm run lint && npm run build`.

### F-07: A quarantine CLI `repair --id` nem validálja az UUID-t, nyers driver-hibát ír ki

**Fájl:** `backend/src/search/reindex/quarantine-cli.ts` (75–86. sor)

**Probléma.** A `--id` érték validálatlanul megy a `repository.findById`-ba. Nem-UUID inputnál a PostgreSQL `22P02 invalid input syntax for type uuid` hibája dobódik, és a CLI a **nyers driver-üzenetet** írja stderr-re — miközben a kódbázis mindenhol máshol stabil, titok-mentes hibakódokat használ (`QUARANTINE_OPERATION_CODES`).

**Javítás.** Validáld az UUID-t a lekérdezés előtt, a már meglévő zod-dal:

```ts
// quarantine-cli.ts – import bővítése
import { z } from 'zod';

// a repair ágban, az `if (!id) throw ...` sor cseréje:
if (!id || !z.uuid().safeParse(id).success) throw new Error('repair_target_unknown');
```

**Ellenőrzés:** `npm run build`, majd kézi futtatás: `node dist/search/reindex/quarantine-cli.js repair --id=nem-uuid --index=a` → a kimenet `repair_target_unknown` legyen.

---

## ALACSONY súlyosságú találatok

### F-08: Halott kód két helyen

**Fájlok:** `backend/src/messaging/relay.ts` (256–263. sor), `backend/src/search/reindex/coordinator.ts` (274–279. sor)

**Probléma és javítás.**

1. A relay `cycle()`-jében a catch mindkét ága ugyanazt csinálja:

```ts
// relay.ts – jelenlegi
let published;
try {
  published = await this.broker.publish(payload, row.eventId);
} catch (error) {
  const kind = classifyBrokerError(error);
  if (kind === 'fatal') throw error;
  throw error;
}
```

Csere:

```ts
// relay.ts – javított: a külső runLoop catch osztályoz, itt nincs teendő
const published = await this.broker.publish(payload, row.eventId);
```

2. A koordinátor `errorCode()`-jában a regex-ág eredménye azonos a fallbackkel:

```ts
// coordinator.ts – jelenlegi
private errorCode(error: unknown): ReindexErrorCode {
  if (error instanceof ReindexRunError) return error.code;
  const message = error instanceof Error ? error.message : '';
  if (/timeout/i.test(message)) return 'internal_error';
  return 'internal_error';
}
```

Csere:

```ts
// coordinator.ts – javított
private errorCode(error: unknown): ReindexErrorCode {
  return error instanceof ReindexRunError ? error.code : 'internal_error';
}
```

### F-09: A Bearer séma kis-nagybetű érzékenyen illeszkedik (RFC 7235 eltérés)

**Fájl:** `backend/src/identity/token-verifier.ts` (178–185. sor)

**Probléma.** Az RFC 7235 szerint az auth-séma kis-nagybetű független (`bearer x` is érvényes), a jelenlegi `/^(Bearer) (.+)$/` viszont csak a pontos `Bearer` alakot fogadja el. Ez szigorítás, nem biztonsági hiba, és a meglévő tesztek erre a viselkedésre épülhetnek.

**Javítás (viselkedésváltozás nélkül).** Dokumentáld a szándékot, hogy egy későbbi olvasó ne bugként kezelje:

```ts
// token-verifier.ts – az extractBearer fölé:
/**
 * Deliberately stricter than RFC 7235: only the exact `Bearer ` prefix is
 * accepted (case-sensitive, single space). Every client we issue tokens to
 * sends this form; anything else is treated as malformed.
 */
private extractBearer(header: string | undefined): string {
```

### F-10: A `mapJoseError` üzenet-regex ága ellentmond a saját „soha nem üzenet alapján" elvének

**Fájl:** `backend/src/identity/token-verifier.ts` (248–251. sor)

**Probléma.** A fájl elve (236–238. sor kommentje): a JWKS-elérhetetlenség **strukturálisan** dől el, sosem üzenet-regexszel. Ennek ellenére a 248. sor üzenetre illeszt: egy olyan hiba, amelynek üzenetében véletlenül szerepel a „timeout" szó, tévesen 503-at ad a helyes 401 helyett. A JWKS fetch hibáit a `customFetch` (`jwksFetch`) már típusosan lefedi (`JwksUnavailableError`, `JWKSTimeout`), így a regex-ág redundáns.

**Javítás.** Szűkítsd az ágat a strukturális esetre:

```ts
// token-verifier.ts – a 248–251. sor cseréje
if (error instanceof TypeError) {
  // fetch() TypeError-je: hálózati réteg, nem a token hibája.
  this.log.warn({ event: 'token_rejected', reason: 'idp_unavailable' });
  throw new ApiError('dependency_unavailable', 'The identity provider is currently unavailable.');
}
```

**Ellenőrzés:** `npm run test:integration:m2`.

### F-11: A bindelt host `127.0.0.1`-re van égetve

**Fájl:** `backend/src/main.ts` (30. sor)

**Probléma.** `await app.listen(config.getOrThrow<number>('PORT'), '127.0.0.1');` — lokális PoC-hoz helyes és biztonságos alapértelmezés, de konténerben (Docker) a folyamat kívülről elérhetetlen lesz, és ez nehezen diagnosztizálható.

**Javítás.** Vezess be egy validált `HOST` kulcsot, `127.0.0.1` defaulttal (a jelenlegi viselkedés változatlan marad):

```ts
// config.ts – a schema objektumba, a PORT után:
HOST: z.string().min(1).default('127.0.0.1'),
```

```ts
// main.ts – a listen sor cseréje:
await app.listen(config.getOrThrow<number>('PORT'), config.getOrThrow<string>('HOST'));
```

### F-12: A routolhatósági logika két helyen, kézzel duplikálva él

**Fájlok:** `backend/src/search/search.service.ts` (119–121. sor), `backend/src/ops/processing-status.controller.ts` (143. sor)

**Probléma.** Ugyanaz a szabály („a runtime state akkor routolható, ha `idle`/`processing`/`retrying`") két fájlban, kézzel felsorolva szerepel. Ha egy új state kerül a rendszerbe (ahogy az M5-ben a `paused` bekerült), a két hely széttarthat — az egyik a keresési útvonalat, a másik az operátori `routeEligible` mezőt vezérli, tehát a drift nehezen észrevehető hibát okoz.

**Javítás.** Egyetlen helper a state modulban, mindkét hívó erre álljon át:

```ts
// worker.state.ts – új export a fájl aljára:
/** A runtime state that may answer a public search (the durable phase is checked separately). */
export function runtimeStateIsRoutable(state: SearchIndexRunState): boolean {
  return state === 'idle' || state === 'processing' || state === 'retrying';
}
```

```ts
// search.service.ts – a routable() visszatérésének cseréje:
return (this.control === null || phaseIsRoutable(control?.phase as import('../schema.js').ReindexPhase | undefined))
  && index.bootstrapped
  && runtimeStateIsRoutable(index.state);
```

```ts
// processing-status.controller.ts – a merged() belsejében:
const runtimeRoutable = runtimeStateIsRoutable(current.state);
```

(Mindkét fájlban importáld: `import { runtimeStateIsRoutable } from './worker.state.js';` ill. `from '../search/worker.state.js'`.)

### F-13: 256 KB feletti request body: 422 `validation_failed` a szabványos 413 helyett

**Fájl:** `backend/src/http.ts` (123–137. sor), `backend/src/contracts/errors.ts`

**Probléma.** Az `entity.too.large` eset ma `validation_failed`(422)-re képződik le. HTTP-szemantikailag ez 413 `Payload Too Large` lenne; a 422 azt sugallja a kliensnek, hogy mező-szintű hibát kell keresnie, miközben a `fields` tömb üres.

**Javítás (döntést igényel — kontraktusbővítés).** Ha a stabil hibakód-szótár bővíthető:

```ts
// contracts/errors.ts – az ERROR_CODES-ba:
payload_too_large: 413,
```

```ts
// http.ts – a jsonBodyErrors()-ben a code sor cseréje:
const code: ErrorCode = candidate.type === 'entity.parse.failed' ? 'invalid_json' : 'payload_too_large';
const detail = code === 'invalid_json'
  ? 'The request body is not valid JSON.'
  : 'The request body exceeds the accepted size.';
```

Ha a hibakód-szótár az evidencia-dokumentumok miatt befagyott, akkor **ne** változtass kódot, csak dokumentáld a döntést a `DECISIONS.md`-ben. A kapcsolódó teszteket (`http.test.ts`) a kódváltozás esetén frissíteni kell.

---

## INFORMÁCIÓS megjegyzések (nem igényelnek azonnali javítást)

- **I-01 – Több független pino instance.** A `main.ts`, `relay.ts`, `token-verifier.ts`, `search.service.ts` és a workerek mind saját `pino()`-t hoznak létre azonos LOG_LEVEL-lel. Működik, de egy közös, DI-n át injektált logger provider egységesítené a konfigurációt (pl. később redaction, transport).
- **I-02 – `schema.ts inList` (71–72. sor).** A `sql.raw` sztring-interpolációval épít IN-listát. Jelenleg kizárólag fordítási idejű konstansokkal hívott, tehát biztonságos — de érdemes kommenttel jelezni, hogy futásidejű értékkel tilos hívni.
- **I-03 – `hasSequenceRange` üzenetenkénti lekérés** (`jetstream.adapter.ts` 203–214. sor). Az S0+1…S1 tartomány minden egyes sequence-ét külön `getMessage`-dzsel ellenőrzi; nagy catch-up tartománynál lassú. PoC-ban elfogadható; nagyobb terhelésnél elég lenne a `first_seq`/`last_seq` határellenőrzés + szúrópróba.
- **I-04 – Control-row írásterhelés.** A worker `pauseWhenRequested` minden fetch-ciklusban (kb. 1/s, pause alatt 4/s) UPDATE-eli a `search_index_control` sort (`observeWorker`). Két workerrel ez állandó, de kis terhelés; nagyobb skálán throttle-t érdemel.
- **I-05 – Nincs CORS/helmet.** A frontend dev-proxyn (Vite) keresztül hívja a backendet, így CORS most nem szükséges. Éles, külön originű deploy előtt `app.enableCors()` allowlisttel és biztonsági fejlécek (helmet) szükségesek lesznek.
- **I-06 – Rate limiting nincs** a publikus végpontokon (`/catalog/search`, `/catalog/contents/:id`). PoC-ban elfogadott; a search végpont Meilisearch-hívást gerjeszt, éles környezetben throttling nélkül olcsó DoS-felület.

---

## Erősségek (megtartandó minták)

- **Egyetlen normalizálási út:** a `@Body() body: unknown` + `normalize*Command` minta kizárja a kettős validációs szabályrendszert; az OpenAPI ugyanabból a Zod-ból generálódik.
- **DB-szinten kikényszerített invariánsok:** a publish-minimum, a státusz/payload párosítás és a `ready` fázis alakja CHECK constraint, nem csak alkalmazáslogika.
- **Helyes outbox/ACK szemantika:** `delivered_at` csak PubAck után, `msgID` alapú dedup, a search worker csak `succeeded` task vagy durable quarantine után ACK-ol.
- **Titok-mentes hibakezelés:** stabil hibakódok, a kliens felé generikus részletek, a logokba sosem kerül token, URL vagy API-kulcs.
- **Strukturális hibaosztályozás:** a `classifyMeiliError` / `JwksUnavailableError` minta (típus + státuszkód, nem üzenet-regex) — az F-10 az egyetlen kivétel ez alól.

---

## Javítás utáni ellenőrzőlista

Minden javítás után, a `backend/` könyvtárban:

```bash
npm run lint          # oxlint – 0 hibának kell maradnia
npm run build         # tsc – típushibák
npm run test          # teljes vitest suite (futó Postgres/NATS/Meili infrát igényel, lásd compose.yaml)
```

Célzott suite-ok találatonként:

| Találat | Ellenőrzés |
|---|---|
| F-01 | `npm run test:integration:m5` és `npm run test:integration:m1` |
| F-02 | `npm run contracts:emit` + `npm run test:integration:m1` |
| F-03 | `npm run test:integration:m5`, `test/m5-reindex.test.ts` |
| F-04 | `npm run test:integration:m4` |
| F-05 | `npm run test:integration:m3` |
| F-07 | kézi CLI futtatás (lásd a találatnál) |
| F-10 | `npm run test:integration:m2` |
| F-13 | `test/integration/http.test.ts` frissítése is szükséges |

---

## Javítási napló – 2026-09-16

Az F-01–F-13 találatok kezelve:

- **F-01:** kliensoldali query timeout eltávolítva; a verify szerveroldali statement timeout is `verify_timeout`. Valódi DB-próba igazolja a 6 másodperces, lokálisan megemelt limitű lekérdezést.
- **F-02:** teljes M5 index- és consumerállapot az OpenAPI-ban; a tényleges státuszválaszra és a `paused` állapotra regressziós ellenőrzés készült.
- **F-03, F-06:** swap előtti saját staging takarítása; swap indításától megőrzés bizonytalan kimenetelnél is. Sikeres ready után cleanup, sikertelen delete task esetén is warning. Korábbi stagingek automatikus söprése szándékosan kimarad, mert helyreállítási adatot törölhetne.
- **F-04, F-05:** adapteroldali filter-escape; a relay indítása kizárólag a konfigurált feature flagre épül.
- **F-06:** titokmentes, strukturált pg pool hibajelzés és reindex cleanup warning.
- **F-07:** UUID-validáció az alkalmazás indítása előtt; hibás inputra `repair_target_unknown`.
- **F-08–F-10:** redundáns hibakezelési ágak törölve, a szigorú Bearer-kontraktus dokumentálva, JOSE-hibaosztályozás üzenetregex nélkül.
- **F-11, F-12:** validált `HOST` loopback alapértékkel; közös runtime routolhatósági helper.
- **F-13:** `413 payload_too_large`, frissített OpenAPI, HTTP-regressziós teszt és D11 döntés.
- **I-02:** a raw SQL-helper kizárólag konstansokkal hívható; ez a forrásban dokumentált. **I-01, I-03–I-06** továbbra is későbbi feladat, az audit eredeti besorolásának megfelelően.

Kapcsolódó döntések: [DECISIONS.md – D11](DECISIONS.md#d11--backend-audit-javítások-2026-09-16).

### Ellenőrzési eredmény

- Node.js 24.20.0; `npm run lint`: **0 hiba, 0 warning**; `npm run build` és `npm run contracts:emit`: sikeres.
- Teljes `npm test` valódi PostgreSQL/NATS és két izolált Meilisearch példánnyal: **181 sikeres, 8 sikertelen / 189** az első végigfutásban. A hibákból két elavult sématesztet és egy A/B fogyasztási versenyhelyzetet javítottunk; az indítási timeout/DB-kapcsolati hibák célzott ismétléskor nem jelentkeztek.
- Javítás utáni célzott ellenőrzés: base + concurrency + schema **21/21**, reindex persistence **4/4** (köztük a 6 másodperces DB-lekérdezés), M4-T06 + M4-T25 **2/2**, új audit-/boundary-regressziók **11/11**. A teljes futás és célzott ismétlések együtt a jelenlegi **193 tesztet** fedik le sikeresen; nem állítunk újabb, egyetlen teljesen zöld monolit futást.
- Az ismétlések felfedtek egy további tesztizolációs hibát: az M5 failed/paused próbájának teardownja nem állította vissza a vezérlősorokat. Ez javítva; az utána futó keresőpróbák sikeresek.
- `repair --id=nem-uuid --index=a`: **1-es kilépési kód**, kizárólag `repair_target_unknown`, adatbázis-kapcsolat nélkül.
- `git diff --check`: sikeres.
