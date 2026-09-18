# Final backend evidence

2026-09-18 · A `FINAL-BACKEND-MILESTONE.md` fázisainak bizonyítékai.
Fázisonként bővül; jelenleg a **BE-F1–BE-F4** zárása szerepel benne.

## Futtatókörnyezet és annak korlátai

| Tétel | Ebben a futásban |
| --- | --- |
| Node | **24.20.0** – a rögzített runtime |
| PostgreSQL | Compose PostgreSQL 17, elkülönített tesztadatbázissal |
| NATS JetStream | Compose szolgáltatás, élő integrációs tesztekkel |
| Meilisearch A/B | Két Compose szolgáltatás, élő integrációs tesztekkel |
| Docker daemon | Docker Desktop; image build, nem-root futtatás és health smoke lefutott |

A koordinátori review-körben a teljes tesztkészlet **skip nélkül**, a backend és
web image, a same-origin ingress és a konténer smoke pedig valódi Docker daemonon
futott. A fejlesztői dependency stacket az új loopback konfigurációval
kontrolláltan újralétrehoztuk.

---

## BE-F1 – Publikus perem és futtatási hardening

### S1 – Rate limiting a publikus végpontokon · **lezárva**

**Döntés.** Alkalmazásszintű, route-onkénti fix ablakos limiter, nem reverse
proxy szabály: a PoC-ban nincs proxy, és egy csak dokumentumban létező limit nem
tesztelhető. Hatálya pontosan a route matrix két publikus útvonala.

**Változtatott fájlok**

- `poc/backend/src/rate-limit.ts` (új) – route-felismerés, kliens-kulcs,
  `FixedWindowRateLimiter`, express middleware;
- `poc/backend/src/contracts/errors.ts` – `rate_limited: 429` a közös hibaszótárban;
- `poc/backend/src/http.ts` – az exception filter a `429`-et `rate_limited`-re képezi,
  nem `internal_error`-ra;
- `poc/backend/src/config.ts` – `RATE_LIMIT_PUBLIC`, `RATE_LIMIT_PUBLIC_MAX`,
  `RATE_LIMIT_PUBLIC_WINDOW_MS`, `RATE_LIMIT_TRUSTED_PROXY_HOPS`;
- `poc/backend/src/main.ts` – bekötés a request boundary után, a tokenellenőrzés előtt;
- `poc/backend/src/contracts/openapi.ts` + a két catalog controller – `429` válasz
  `Retry-After` headerrel;
- `poc/backend/test/support/test-app.ts` – a tesztösszeállítás ugyanazt a limitert
  telepíti, ugyanazokkal az alapokkal;
- `poc/backend/.env.example`, `README.md`.

**Viselkedés.** Túllépéskor `429`, `application/problem+json`,
`code: rate_limited`, `type: urn:indaplay:poc:error:rate_limited`, egész
másodperces `Retry-After`. Health és `/admin` soha nem limitált. A két route
külön büdzsét kap. Alapértelmezésben az `X-Forwarded-For` figyelmen kívül marad;
csak `RATE_LIMIT_TRUSTED_PROXY_HOPS > 0` esetén olvassuk, jobbról visszaszámolva,
rövidebb lánc esetén visszaesve a transport peer címére.

**Bizonyíték – automatikus teszt**

```
npx vitest run test/rate-limit.test.ts test/integration/public-edge.test.ts test/container-posture.test.ts
→ Test Files 3 passed (3) · Tests 35 passed (35)
```

- `test/rate-limit.test.ts` – a limitált route-halmaz megegyezik a `ROUTE_MATRIX`
  publikus catalog útvonalaival; nem limitált route-ok; kliens-kulcs proxy-hopokkal
  és hamisított headerrel; ablakhatár, `Retry-After` felfelé kerekítés, kulcsonként
  külön büdzsé, korlátos memória.
- `test/integration/public-edge.test.ts` – élő adatbázis ellen: a 4. kérés `429` a
  teljes problem+json szerződéssel; a search route saját büdzséje; health és admin
  nem limitált; 30 egymást követő kérés az alapértelmezett `120`-as limit mellett
  mind `404` (normál forgalom nem sérül).

**Bizonyíték – futó listener** (`node dist/main.js`, `RATE_LIMIT_PUBLIC_MAX=5`,
nem root `appsmoke` felhasználó)

```
req1=404 req2=404 req3=404 req4=404 req5=404 req6=429
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/problem+json; charset=utf-8
{"type":"urn:indaplay:poc:error:rate_limited","title":"rate limited","status":429,
 "code":"rate_limited","detail":"Too many requests for this public route.",
 "instance":"/catalog/contents/…","correlationId":"f2beb62f-…"}

hamisított X-Forwarded-For 0 megbízható hop mellett → 429 (nem kerüli meg a limitet)
/health/live a limit kimerülése után → 200
RATE_LIMIT_PUBLIC=off mellett 7 kérés → mind 404
RATE_LIMIT_PUBLIC_MAX=0 → {"event":"startup_failed","code":"invalid_configuration","keys":["RATE_LIMIT_PUBLIC_MAX"]}
```

**Vállalt korlát.** A számláló processzenkénti: két példány a konfigurált limit
kétszeresét engedi át. A nyilvántartás `10 000` kliens-kulcsnál telítődik; ekkor
az új kulcsok fail-closed `429` választ kapnak a legrégebbi aktív ablak
lejártáig. Aktív számláló nem esik ki, a lejárt ablakok eltávolítása amortizált
O(1). Több példány előtt megosztott számláló vagy ingress-limit szükséges.

---

### S2 – Explicit CORS/same-origin döntés · **lezárva**

**Döntés.** A támogatott topológia same-origin ingress. A böngésző relatív
`/api/...` útra kér, azt fejlesztésben a Vite dev proxy, productionben a reverse
proxy továbbítja a backendnek az `/api` prefix levágásával. A backend **CORS
nélkül marad**: nincs `enableCors`, nincs `Access-Control-*` header, preflightra
nincs válasz. Wildcard origin nem opció. Külön-originű deployment csak későbbi,
explicit allowlistes döntésként jöhet szóba.

**Változtatott fájlok.** `poc/frontend/Dockerfile`, `.dockerignore` és
`nginx.conf` – nem-root SPA image és `/api` reverse proxy;
`poc/backend/compose.prod.yaml` – loopbacken publikált `web`, hálózaton belüli
backend; `poc/backend/README.md`, `poc/FRESH-CHECKOUT-RUNBOOK.md`, valamint a
statikus és integrációs regressziós tesztek.

**Bizonyíték**

```
S2 same-origin contract (3 eset, pass)
 · cross-origin GET → 404, access-control-allow-origin: null,
   access-control-allow-credentials: null, Vary nem tartalmaz Origin-t
 · OPTIONS preflight → nem 204, egyetlen access-control-* header sem
 · src/main.ts nem tartalmaz enableCors-t és access-control-allow-origin-t
```

Futó listener ellen `Origin: https://evil.example` header mellett a válasz
egyetlen `access-control-*` headert sem tartalmazott.

**Production ingress smoke – izolált Compose projekt**

```
web image    → nginx:1.29.5-alpine3.23, USER nginx, healthy
backend      → USER node, healthy, host-port nélkül
GET /                         → 200 (SPA)
GET /catalog/search           → 200 (SPA deep-link fallback)
GET /api/health/live          → 200 (prefix levágva, backend válasz)
Origin: https://evil.example  → nincs Access-Control-* header
web host publication          → 127.0.0.1:18080
backend port                  → 3000/tcp, PublishedPort nincs
```

---

### S4 – Dependency-portok loopbackre kötése · **lezárva**

**Változtatott fájlok.** `poc/backend/compose.yaml` – mind a hat publikált port
`${HOST_BIND_ADDRESS:-127.0.0.1}` előtaggal; `poc/backend/.env.example`;
`poc/backend/test/container-posture.test.ts`.

**Bizonyíték – renderelt konfiguráció**

```
docker compose -f compose.yaml --profile full config --format json
authentik-server: host_ip=127.0.0.1 published=9000 target=9000
meilisearch-a:    host_ip=127.0.0.1 published=7700 target=7700
meilisearch-b:    host_ip=127.0.0.1 published=7701 target=7700
nats:             host_ip=127.0.0.1 published=4222 target=4222
nats:             host_ip=127.0.0.1 published=8222 target=8222
postgres:         host_ip=127.0.0.1 published=5432 target=5432
networks declared: ['default']
```

Csak a host publikálás változott: hálózat-definíció, service nevek és a
konténerek közti feloldás érintetlen (`AUTHENTIK_POSTGRESQL__HOST:
authentik-postgres`, `AUTHENTIK_REDIS__HOST: authentik-redis` változatlan; a
`container-posture.test.ts` ezt is állítja).

**Runtime bizonyíték.** A meglévő dependency konténereket a volume-ok megtartása
mellett `--force-recreate --wait` paranccsal újralétrehoztuk. Mindegyik healthy;
a tényleges Docker portkötések: PostgreSQL `127.0.0.1:55433`, NATS
`127.0.0.1:4222/8222`, Meilisearch `127.0.0.1:7700/7701`, Authentik
`127.0.0.1:9000`. `0.0.0.0` és `::` publikáció nincs.

---

### S7 – Meilisearch production posture · **lezárva**

**Döntés.** A helyi profil dokumentáltan `development` marad; a production
posture külön overlay, kötelező és nem repóban tárolt master kulccsal.

**Változtatott fájlok.** `poc/backend/compose.yaml`
(`MEILI_ENV: ${MEILI_ENV:-development}`), `poc/backend/compose.prod.yaml` (új),
`poc/backend/.env.production.example` (új), `poc/backend/.gitignore`
(`!.env.production.example`), `poc/backend/.env.example`, `README.md`,
`poc/FRESH-CHECKOUT-RUNBOOK.md`.

**Bizonyíték**

```
docker compose -f compose.yaml --profile full config              → MEILI_ENV: development (2×)
docker compose -f compose.yaml -f compose.prod.yaml --profile app --profile full config
                                                                  → MEILI_ENV: production (2×)
kulcs nélkül ugyanez:
  error while interpolating services.meilisearch-a.environment.MEILI_MASTER_KEY:
  required variable MEILI_A_KEY is missing a value: set MEILI_A_KEY in the env file
```

A `.env.production.example` minden hitelesítő adata `REPLACE_ME`; ezt a
`container-posture.test.ts` is állítja. Titok nem került a repóba.

---

### O1 – Alkalmazás image · **lezárva**

**Változtatott fájlok.** `poc/backend/Dockerfile` (új),
`poc/backend/.dockerignore` (új), `poc/backend/scripts/container-healthcheck.mjs`
(új), `poc/backend/compose.prod.yaml` (új, `app` profil), `README.md`,
`poc/FRESH-CHECKOUT-RUNBOOK.md`.

**Tartalom.** Három stage (build → production dependency → runtime), `npm ci` a
commitolt lockfile-ból, `NODE_IMAGE` build argumentum a pontos tag/digest
kívülről adásához, `USER node` (uid 1000) a runtime stage-ben root tulajdonú,
csak olvasható alkalmazásfával, `HEALTHCHECK` a saját `/health/live` végpontra,
migráció nélkül (a `drizzle-kit` dev dependency; a séma-változtatás külön lépés).
A `.dockerignore` a `.env*` fájlokat kizárja a build contextből; se build
argumentum, se `ENV` nem hordoz hitelesítő adatot. Az `app` profil külön overlay,
így nem kerül a CI által dependency-khez használt `full` profilba.

**Bizonyíték – ami futott**

```
docker compose -f compose.yaml --profile full config --services
  → authentik-*, meilisearch-a, meilisearch-b, nats, postgres (backend NINCS köztük)
docker compose -f compose.yaml -f compose.prod.yaml --profile app config
  → web: read_only, USER nginx, host_ip 127.0.0.1 published 8080
  → backend: read_only, USER node, expose 3000, host publication nélkül
  → BACKEND_DATABASE_URL nélkül: required variable BACKEND_DATABASE_URL is missing a value

docker build -t indaplay-poc-backend:review-ee72910 . → pass
  image: sha256:6f4c0876075f3163bd51ac53c0606d94948c30d05a8a6b2cc525f771a07d8484
  base: node:24.20.0-alpine3.23

konténer smoke (`--read-only --cap-drop ALL --security-opt no-new-privileges`):
  Config.User → node
  Docker health → healthy
  /health/live  → 200
  /health/ready → {"status":"ok","info":{"postgres":{"status":"up"}}, …}
  DATABASE_URL hiányzik → exit 1,
    {"event":"startup_failed","code":"invalid_configuration","keys":["DATABASE_URL"]}
```

A smoke két implementációs hibát talált és a review-kör javította: a nem létező
`alpine3.22` tag `alpine3.23`-ra változott, a healthcheck script pedig explicit
`0555` módot kapott, hogy a `node` felhasználó olvasni tudja.

`test/container-posture.test.ts` állítja a stage-számot, a `npm ci --omit=dev`-et,
a `USER node` és `CMD` sorrendjét, a `HEALTHCHECK` meglétét, a `.dockerignore`
`.env*` kizárását, valamint azt, hogy a Dockerfile nem tartalmaz
`PASSWORD`/`SECRET`/`TOKEN`/`_KEY` mintát.

**Maradék.** A base image pontos verziótaggal pinelt, digesttel még nem (E01).

---

## BE-F1 – futtatott kapuk

| Parancs | Eredmény |
| --- | --- |
| `npm run build` (tsc) | pass |
| `npm run lint` (oxlint, 121 fájl) | pass – 0 warning, 0 error |
| `npm run openapi:check` | pass (a snapshot az új `429` válaszokkal újragenerálva) |
| `npm test` (teljes Vitest) | 24 fájl pass · **267 teszt pass, 0 skip** |
| `npm run verify` | **exit 0** (Node 24.20.0, élő PostgreSQL/NATS/Meilisearch) |
| `docker compose config` validálás | pass |
| `docker build` / konténer smoke | **pass** – backend `USER node`, web `USER nginx`, mindkettő `healthy`; same-origin live/ready 200 |
| Hiányzó `DATABASE_URL` image-ből | **pass** – exit 1, strukturált `invalid_configuration` |

## Frontend contract hatás

A `poc/contracts/backend.openapi.json` snapshot **kizárólag bővült** (39 sor, 0
törlés):

- `GET /catalog/search` és `GET /catalog/contents/{id}` új `429` válasza a
  `Retry-After` headerrel;
- a `ProblemDocument.code` enum új `rate_limited` értéke.

Meglévő séma, mező és válasz nem változott, tehát a jelenlegi frontend nem törik.
Amit a frontendnek érdemes kezelnie: a publikus catalog hívások `429` ága
(felhasználói üzenet és a `Retry-After` szerinti újrapróbálkozás) – ez a BE-F1
átadás explicit frontend-feladata, nem része ennek az ágnak.

## Nyitott döntések és kockázatok

1. **Processzenkénti limit.** Több backend példány esetén a tényleges limit
   példányszámmal szorzódik. Döntés kell arról, hogy skálázáskor megosztott
   számláló (pl. Redis) vagy ingress-limit legyen a válasz.
2. **Megbízható proxy-hopok.** A production overlay `1`-et feltételez. Ha a
   tényleges topológiában több proxyréteg lesz, ezt az értéket együtt kell
   mozgatni az ingress konfigurációjával; rossz érték hamisítható kliens-IP-t
   jelent.
3. **Image digest.** A base image tag szerint pinelt, digest szerint nem (E01).

---

## BE-F2 – Trust boundary, hibák és operációs diagnosztika

### S3 – Raw SQL timeout helper · **lezárva**

A `database/local-timeout.ts` egyetlen, zárt helperben engedi a
`lock_timeout`/`statement_timeout` neveket. Formázás előtt safe integer,
`1..3 600 000 ms` tartományt ellenőriz; ezt használja a content write barrier,
a snapshot reader és a reindex verify barrier. A unit teszt lefedi az alsó/felső
határt, továbbá a nulla, negatív, tört, `NaN`, végtelen és túl nagy értékeket.

### S5 – OIDC issuer normalizálás és diagnosztika · **lezárva**

Az egyetlen canonical szabály pontosan egy trailing slash; origin/path/case nem
normalizálódik. A discovery ugyanígy hasonlít, majd ezt a canonical issuert adja
a JWT-verifikációnak. Valódi eltérés fail-closed `503 dependency_unavailable`.
Az `OidcDiscoveryError.category` zárt kategória (`issuer_mismatch` stb.), és a
token log csak ezt adja át; teljes issuer/JWKS URL-t nem. Integrációs teszt külön
bizonyítja a slash-drift elfogadását és az origin/path mismatch elutasítását.

### S6 – Titokmentes bootstrap-hiba · **lezárva**

A külső eseménykód változatlanul `bootstrap_failed`. Mellette csak allowlistes
`category` jelenhet meg: listen address/permission, dependency connection vagy
`unknown`. Nyers hibaüzenet, stack, URL, token, DSN és credential nincs a
kimenetben; a regressziós teszt sentinel DSN-nel bizonyítja ezt. A konfigurációs
ág továbbra is csak a hibás kulcsneveket közli.

### C2 – Dependency-read hibaklasszifikáció · **lezárva**

Az operátori read helper a már típusos `ApiError` és
`OperatorActionExecutionError` hibákat megőrzi, és csak az ismert kapcsolat-
hibakódokat alakítja `dependency_unavailable` válasszá. Tetszőleges `TypeError`
változatlanul a globális filterhez jut, amely `500 internal_error` választ ad.
A két ág külön unit tesztben bizonyított.

### O2 – Path nélküli request-log szerződés · **lezárva**

A request log engedélyezett mezői pontosan: `event`, `correlationId`, `method`,
`status`. A teszt érzékeny query/header/body sentinel mellett ellenőrzi, hogy
path, query, Authorization és body nem kerül a logba. A backend README rögzíti
a correlation-ID alapú audit/outbox/relay visszakeresést, valamint azt a vállalt
korlátot, hogy a HTTP-log önmagában nem azonosít route-ot vagy queryt.

## BE-F2 – futtatott kapuk

| Parancs | Eredmény |
| --- | --- |
| Célzott Wave 2 + identity teszt | **26/26 pass** |
| `npm run build` | pass |
| `npm run lint` | pass – 0 warning, 0 error (125 fájl) |
| `npm run openapi:check` | pass – contract drift nincs |
| `npm test` | **25 fájl, 275/275 pass, 0 skip** |
| `npm run verify` | **exit 0**, Node 24.20.0, élő PostgreSQL/NATS/Meilisearch |

Frontend/OpenAPI contract nem változott ebben a fázisban.

---

## BE-F3 – Lekérdezési és adatkezelési korrektség

### C1 – Karanténlista scan-budget kurzor · **lezárva**

A `QuarantineService.list` a sűrű oldalnál továbbra is a legutolsó látható
rekord exkluzív kurzorát adja. Ha viszont a 2000-es scan-budget a stream valódi
alja előtt fogy el, a következő kurzor az utolsó vizsgált sequence-nél folytat;
ez üres közbenső oldalon is igaz. `null` csak üres streamnél vagy a valódi
alsó határ elérésekor keletkezik.

A regressziós teszt 5005 sequence-t, két tárolt rekordot és 2000-nél nagyobb
purge-réseket modellez. A három oldal közül a második üres, mégis továbblép;
az eredmény pontosan `[5005, 1]`, duplikáció nélkül, termináló `null`
kurzorral.

### C6 – Ismeretlen audit action fail-closed · **lezárva**

A content audit view mapper csak az `AUDIT_ACTIONS` zárt készletét fogadja el.
Ismeretlen perzisztált érték többé nem válik csendben `updated` eseménnyé:
titokmentes `TypeError` jut a meglévő globális `internal_error` ágra. A mapper
közvetlen tesztje a PostgreSQL CHECK constraint megkerülésével injektál
ismeretlen actiont, és igazolja a fail-closed viselkedést.

### C7 – Korlátos audit-olvasás · **lezárva**

A `ContentRepository.listAudit` query paramétere kötelező. Az opcionális,
ascending és `2_147_483_647` sentinelt használó bypass megszűnt; minden
production hívás `content_version DESC` keyset feltétellel és `limit + 1`
oldalmérettel fut. Unit teszt igazolja, hogy 50-es kérésnél a repository
pontosan 51 sort kér a következő oldal felismeréséhez.

### C8 – Broker `capacity` osztály · **lezárva**

A `capacity` kategória megmaradt, mert operátori kapacitás-/retention-döntést
jelez. A relay egyszer osztályoz, majd ugyanazt a kódot teszi a strukturált
`relay_retry` logba és a processing status `lastErrorCode` mezőjébe. Az általános
503 többé nem esik a message/byte/resource-limit regexbe, hanem `transient`.

Unit teszt különbözteti a capacity-, 503- és timeout-ágat. A valódi NATS +
PostgreSQL `M3-T10` integrációs teszt igazolja, hogy a capacity-elutasítás után
az outbox rekord függőben marad és a relay status `capacity` kódot ad.
A három kategória (`transient`, `capacity`, `fatal`) és viselkedése a backend
README-ben dokumentált.

### D2 – Forward-only migrációs policy · **lezárva dokumentált elfogadással**

A D12 ADR és a recovery runbook kimondja, hogy alkalmazott migráció nem
írható át, és nincs általános down út. Az alapértelmezett recovery
append-only forward-fix; restore csak igazolt backuppal, elfogadott RPO-val és
írás-egyeztetési tervvel választható. A dokumentum rögzíti a release owner,
migrációs szerző/reviewer és adatbázis-operátor felelősségét, a friss `_test`
célra történő restore/migrate/verify parancsvázat, a negyedéves és
toolchain-váltás utáni rehearsal elvárást, valamint az evidence minimumát.

Production adaton restore-próba nem történt és nem is része ennek a PoC
fázisnak; az első production release előtti rehearsal explicit release blocker.

## BE-F3 – futtatott kapuk

| Parancs | Eredmény |
| --- | --- |
| Célzott C1/C6/C7/C8 unit tesztek | **3 fájl, 32/32 pass** |
| Valódi NATS/PostgreSQL `M3-T10` | **1/1 pass**, 16 nem célzott eset kihagyva |
| `npm run build` | pass |
| `npm run lint` | pass – 0 warning, 0 error (125 fájl) |
| `npm run openapi:check` | pass – contract drift nincs |
| `npm test` a frissen újraindított core stacken | **25 fájl, 279/279 pass, 0 skip** |
| `npm run verify` | **exit 0**, Node 24.20.0 |

A kezdeti teljes futásokban az Authentik server/worker egyenként közel teljes
CPU-magot foglalt, ami széles PostgreSQL/NATS/Meilisearch connection timeoutot
okozott. Az Authentik ideiglenes leállítása és a core stack adatvesztés nélküli
restartja után a teljes verify tisztán zöld lett; az Authentik szolgáltatásokat a
mérés után visszaindítottuk. Frontend/OpenAPI contract nem változott.

---

## BE-F4 – Eseményút, reindex és skálázás

### C3 – Explicit at-least-once contract · **lezárva**

Az eseményszerződés és a PoC leírás most kimondja, hogy a JetStream kétperces
`msgID` dedupe-ablaka csak optimalizáció. Ugyanaz az esemény az ablak után új
stream sequence-ként ismét megjelenhet, ezért a consumer minden kézbesítéskor a
PostgreSQL aktuális aggregate állapotából és verziójából konvergál.

Az élő NATS topológiateszt 100 ms-os dedupe-ablakkal igazolja, hogy az ablakon
belüli azonos `msgID` ugyanazt a sequence-t adja és duplicate, 250 ms után viszont
új sequence keletkezik. A meglévő M4-T06 ugyanazt a régi publish envelope-ot a
withdrawal után friss broker-azonosítóval visszajátssza; mindkét index törölt,
aktuális DB-állapotra konvergál.

### C4 – Konstans round-trip retention proof · **lezárva**

A `JetStreamAdapter.hasSequenceRange` a korábbi sequence-enkénti
`getMessage` ciklus helyett egyetlen, `deleted_details` opciós stream-info
kérést végez. A helper a retained bounds, a teljes delete-lista, a lost metadata
és a stream-span konzisztenciáját együtt ellenőrzi. Hiányos vagy ellentmondó
metadata esetén fail-closed eredményt ad.

Az adapterteszt 100 000 sequence hosszú logikai range-nél pontosan egy info
hívást és nulla üzenetenkénti lekérdezést vár; külön lefedi a prefix retentiont,
belső delete/lost lyukat és a csonkolt metadata ágakat.

### C5 – Korlátos verifier és mért write-freeze · **lezárva**

A verifier UUID keyset lapokban olvassa a publikált DB-sorokat, oldalanként
Meilisearch `ids` lookupot használ, és csak egy lapot plusz három, legfeljebb
20 elemű diagnosztikai mintát tart memóriában. A missing, extra és version
mismatch darabszám ettől függetlenül egzakt. A koordinátor külön méri a verifier
idejét, a legnagyobb batch-et és az advisory write lock megszerzésétől a commitig
tartó freeze-ablakot.

Az izolált evidence runner frissen migrált, üres `*_test` adatbázist, saját NATS
streamet és saját Meilisearch UID-t követel, majd a futás végén csak ezeket a
szintetikus erőforrásokat takarítja. A mért és e fázisban támogatott plafon
**1000 publikált dokumentum**, `REINDEX_BATCH_SIZE=500` mellett:

| Index | Egyezés | Reindex | Verifier | Write-freeze | Max batch |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 1000/1000 | 4 730 ms | 41 ms | 264 ms | 500 |
| B | 1000/1000 | 4 200 ms | 91 ms | 935 ms | 500 |

Mindkét oldalon `missingCount=0`, `extraCount=0`,
`versionMismatchCount=0`. A keysetes algoritmus nagyobb katalógusnál is
korlátos memóriájú, de 1000 fölött e fázis nem vállal mért kapacitásgaranciát.
A külön M5 1000+100 latency baseline továbbra sem ennek a mérésnek a része.

### C9 – Relay orphaned-loop lifecycle guard · **lezárva**

Grace-timeout után a még futó relay loop megtartja a broker tulajdonjogát és a
státusz nem vált hamisan `off` állapotra. Ismételt stop nem zárja le alóla a
kapcsolatot, start nem indít második loopot; a tényleges settle után pontosan egy
broker close történik, majd a restart ismét engedélyezett. A determinisztikus,
fake-timeres teszt mindegyik átmenetet ellenőrzi, a teljes relay integrációs
csomag pedig a korábbi lifecycle invariánsokat is zölden tartja.

### D1 – Trigram admin keresési terv és forward upgrade · **lezárva**

A `pg_trgm` extensiont létrehozó forward-only `0006_parallel_warbird.sql`
migráció külön GIN `gin_trgm_ops` indexet ad a `title` és `slug` mezőhöz. A
schema integrációs teszt az extensiont és mindkét indexdefiníciót ellenőrzi. A
production alkalmazásszerep extension-jogosultságának vagy DBA
preprovisioningjának követelménye a backend README-ben szerepel.

A production alakú query (`status`, `category`, title/slug `ILIKE`, keyset
cursor, rendezés és limit) 10 000 szintetikus sornál még 5,145 ms-os Seq Scant
kapott. 100 000 sornál a planner mindkét trigram indexet `BitmapOr` alatt
használta: planning 3,281 ms, execution 36,621 ms. Ez egyszerre bizonyítja az
index aktiválását és azt, hogy kis lokális adathalmaznál a Seq Scan lehet a
helyesebb terv.

A külön upgrade harness egy garantáltan új, véletlen `_test` adatbázisban
először csak a `0000`–`0005` migrációkat alkalmazta, survivor sort írt, majd a
teljes készlettel `0006`-ra lépett. Eredmény: 6 → 7 migráció, repeat no-op,
extension és két index jelen, a korábbi sor megmaradt. A harness kizárólag a
saját maga által létrehozott adatbázist törölte.

## BE-F4 – futtatott kapuk

| Parancs | Eredmény |
| --- | --- |
| C4/C5/C9 célzott unit tesztek + backend audit | **4 fájl, 15/15 pass** |
| Teljes relay integráció, benne C3 | **1 fájl, 18/18 pass** |
| Search + schema élő integráció | **2 fájl, 45/45 pass** |
| Izolált 1000 dokumentumos C5 mérés | **A/B 1000/1000**, max batch 500 |
| 100 000 soros admin EXPLAIN | **BitmapOr**, mindkét trigram GIN index |
| `0005` → `0006` upgrade + repeat | **pass**, adatmegőrzés igazolva |
| `npm run build` | pass |
| `npm run lint` | pass – 0 warning, 0 error (131 fájl) |
| `npm run openapi:check` | pass – contract drift nincs |
| `npm run verify` | **exit 0**, Node 24.20.0, **28 fájl, 289/289 pass** |

Frontend-fájl és OpenAPI contract nem változott ebben a fázisban.

---

## BE-F5 – Közös infrastruktúra és minőségkapu

### A1 – Közös deadline, retry és managed-settings util · **lezárva**

A relay és a projection worker ugyanazt a `common/deadline.ts` deadline-versenyt
és `common/retry.ts` D08 létrát használja. A létra sorrendje és plafonja változatlan
(1/2/4/8/16/30 másodperc, az utolsó ismétlődik), a jitter továbbra is ±20%, az
attempt state komponensenként külön maradt. A nulla/negatív deadline nem vár, a
gyors resolve és reject ág minden esetben törli a timert.

A bootstrap és a staging importer most ugyanabból a
`search/managed-settings.ts` összehasonlításból dolgozik. A
`searchableAttributes` sorrendérzékeny, a filter/display/sort mezők halmazként
egyeznek. Az újabb Meilisearch objektumos attribútumbejegyzése nem vész el és nem
válik hamis egyezéssé, hanem látható mismatch marad.

Megőrzött invariánsok: shutdown grace/abort sorrend, retry attempt resetpont,
CMS wake által nem rövidíthető backoff és a bootstrap tulajdonjogi szabályai.

### A2 – Közös logger és fail-closed redakció · **lezárva**

A production `src/**` fájljaiban a Pino konstrukció kizárólag az
`observability/logger.ts` modulban maradt. A bootstrap, HTTP boundary, relay,
search registry/worker/service, reindex és token verifier ugyanazon DI-ből kapott
root logger komponens-childját használja; az `APP_LOGGER` token tesztben
felülírható.

A logger a serializer előtt rekurzívan redaktálja az Authorization/cookie,
access/ID/refresh token, password/secret/API key és DSN/database URL credential
mezőket, továbbá a Bearer- és URL-userinfo mintákat mély objektumban és Error
ágon is. A sentinel teszt öt komponensnévvel igazolja, hogy a titok nem kerül a
kimenetbe. Nyers request/response/error objektum továbbra sem része a production
mezőszerződésnek.

### A3 – Production kommentnyelv · **lezárva**

Az inventory két magyar production kommentblokkot talált és fordított angolra:

- `src/ops/processing-status.controller.ts`: Meilisearch reachability indoklás;
- `src/schema.ts`: operator mutation phase leírás.

A magyar fixture-adat, runtime felhasználói szöveg, tesztleírás és operátori
dokumentáció szándékosan változatlan. Természetes nyelvet találgató regex-kapu
nem került a buildbe.

### T1 – V8 coverage regressziós kapu · **lezárva**

Az egymással pontosan egyező `vitest@4.1.11` és
`@vitest/coverage-v8@4.1.11` verzió commitolt. A mérés minden `src/**/*.ts`
production fájlt bevon; CLI/bootstrap fájl sincs kizárva. A teljes élő
PostgreSQL/NATS/Meilisearch stacken mért baseline:

| Metrika | Baseline | Commitolt minimum |
| --- | ---: | ---: |
| Statements | 79,39% (2473/3115) | 79% |
| Branches | 70,11% (1262/1800) | 70% |
| Functions | 78,98% (466/590) | 78% |
| Lines | 82,86% (2235/2697) | 82% |

A `verify` a teljes suite-ot egyszer, coverage-dzsel futtatja; nincs előtte
duplikált `npm test`. Negatív kontrollként csak a W5 unit fájl futtatása mind a
négy globális küszöb alatt **exit 1** eredményt adott.

A coverage overhead egy korábbi search tesztversenyt is láthatóvá tett: a
dokumentum már olvasható volt, miközben a worker még a terminal task poll/ACK
előtt állt, így a read-pathhoz injektált 401 a projection workert érhette. Az
`indexOne` most mindkét worker `idle` állapotát megvárja a fault injection előtt;
az érintett T09/T15–T19 szelet 6/6 zöld. A többször egymás után terhelt teljes
stack futások közül volt PostgreSQL connection-timeoutos ismétlés; az elfogadott
core verify idejére csak a tesztek által nem használt Authentik server/workert
állítottuk le, majd mindkettőt healthy állapotba visszaindítottuk.

### T2 – Valódi Authentik release gate · **lezárva**

A blueprint megtartja a per-provider issuert, a `poc-backend-api` audience
mappinget, az 5 perces access és 1 órás refresh élettartamot, és strict
allowlistre felveszi a `/auth/silent-callback` URI-t. A production Compose a
rögzített, kizárólag publikus `VITE_*` build-arg szerződést adja át; manual token
productionben fixen `false`.

Az új `authentik:release:preflight` valódi discoveryt és RSA JWKS-t kér le,
ellenőrzi a public clientet, issuer módot, élettartamokat, a teljes strict
redirectlistát és a három aktív, megfelelő csoportú tesztidentitást. Hiányzó env,
provider, kulcs, user vagy eltérő redirect hard failure; skip ág nincs.

Az integráció után az Authentik server/worker az új blueprinttel healthy. A
valós preflight discovery/JWKS, issuer, audience, 5 perces access token, 1 órás
refresh token, négy strict redirect és három aktív tesztidentitás ellenőrzésével
**PASS**. A frontend valódi lifecycle tesztje az 5 perces renewal, memória-only
reload-silent recovery és logout útját is bizonyította; token vagy credential
nem került a release evidence-be.

## BE-F5 – futtatott kapuk

| Parancs | Eredmény |
| --- | --- |
| Célzott A1/A2/T2 + lifecycle regresszió | **5 fájl, 43/43 pass** |
| Search fault-injection stabilitási szelet | **6/6 pass** |
| Teljes `test:coverage`, Node 24.20.0 | **29 fájl, 300/300 pass**, 0 skip |
| Coverage negatív kontroll | **exit 1**, mind a négy threshold blokkolt |
| `npm run build` | pass |
| `npm run lint` | pass – 0 warning, 0 error |
| `npm run openapi:check` | pass – contract drift nincs |
| `npm run verify` | **exit 0**, Node 24.20.0, **29 fájl, 300/300 pass**; Authentik server/worker a tőlük független core mérés idejére állt, utána healthy állapotba visszaindult |
| Authentik provider élő preflight az integrált blueprinttel | **PASS** – RSA JWKS, issuer/audience, 5 perc/1 óra, 4 redirect, 3 identity |
| Valódi Authentik böngészős lifecycle | **PASS** – renewal, reload-silent recovery, logout |

Frontend forrás, frontend lockfile, OpenAPI/generated contract és közös workflow
nem változott a backend implementációs ágon. A közös workflow integrációkor
kapta meg a kötelező preflight- és lifecycle-bekötést.
