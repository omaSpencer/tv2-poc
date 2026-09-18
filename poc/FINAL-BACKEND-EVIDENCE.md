# Final backend evidence

2026-09-18 · A `FINAL-BACKEND-MILESTONE.md` fázisainak bizonyítékai.
Fázisonként bővül; jelenleg a **BE-F1** zárása szerepel benne.

## Futtatókörnyezet és annak korlátai

| Tétel | Ebben a futásban |
| --- | --- |
| Node | **22.22.2** – a megkövetelt 24.20.0 nem volt beszerezhető (a `nodejs.org` és a konténerregiszter is tiltott egress) |
| PostgreSQL | 16.13, natív, `poc_ci_test` eldobható célponttal (a CI és a Compose 17-et használ) |
| NATS JetStream | **nincs** |
| Meilisearch A/B | **nincs** |
| Docker daemon | **nincs**; a `docker compose` CLI daemon nélkül is renderel, ezért konfiguráció-validálásra használható, image buildre nem |

Következmény: a teljes tesztkészletből **40 eset skipped**, mert NATS-ot vagy
Meilisearch-öt igényel, és **image build/konténer smoke nem futott**. Ezek nincsenek
zöldnek jelölve sem itt, sem a milestone-ban.

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
→ Test Files 3 passed (3) · Tests 31 passed (31)
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
kétszeresét engedi át, és `10 000` kliens-kulcs felett a lejárathoz legközelebbi
ablakok kiesnek (fail-open memóriavédelem). Újraértékelés akkor esedékes, amikor
a backend egynél több példányban fut; a tulajdonos a backend gazdája.

---

### S2 – Explicit CORS/same-origin döntés · **lezárva**

**Döntés.** A támogatott topológia same-origin ingress. A böngésző relatív
`/api/...` útra kér, azt fejlesztésben a Vite dev proxy, productionben a reverse
proxy továbbítja a backendnek az `/api` prefix levágásával. A backend **CORS
nélkül marad**: nincs `enableCors`, nincs `Access-Control-*` header, preflightra
nincs válasz. Wildcard origin nem opció. Külön-originű deployment csak későbbi,
explicit allowlistes döntésként jöhet szóba.

**Változtatott fájlok.** `poc/backend/README.md` („Böngésző-topológia és CORS”,
az ingress-szerződés kötelező elemeivel: prefix, kliens-IP/`X-Forwarded-For`
hopszám, TLS-termináció), `poc/FRESH-CHECKOUT-RUNBOOK.md`,
`poc/backend/test/integration/public-edge.test.ts`. Frontend forrás nem változott;
a meglévő `vite.config.ts` proxy és a `VITE_API_BASE=/api` alapérték már ezt a
topológiát valósítja meg.

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

---

### S4 – Dependency-portok loopbackre kötése · **lezárva (konfiguráció), runtime próba pending**

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

**Pending.** Élő `docker compose up` melletti host-oldali port-próba
(`ss -ltn` / külső interfészről érkező kapcsolat elutasítása) nem futott, mert
ebben a környezetben nincs Docker daemon.

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

### O1 – Alkalmazás image · **nem lezárt: implementálva, image smoke nem futott**

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
  → backend: image indaplay-poc-backend:local, read_only: true,
    no-new-privileges:true, host_ip 127.0.0.1 published 3000
  → BACKEND_DATABASE_URL nélkül: required variable BACKEND_DATABASE_URL is missing a value

nem root futtatás a lefordított artifactból (appsmoke felhasználó, NODE_ENV=production):
  ps → appsmoke … node dist/main.js
  /health/live  → 200
  /health/ready → {"status":"ok","info":{"postgres":{"status":"up"}}, …}
  node scripts/container-healthcheck.mjs /health/live  → exit 0, {"event":"healthcheck","path":"/health/live","status":200}
  node scripts/container-healthcheck.mjs /health/ready → exit 0
  DATABASE_URL='not-a-postgres-url' → {"event":"startup_failed","code":"invalid_configuration","keys":["DATABASE_URL"]}
```

`test/container-posture.test.ts` állítja a stage-számot, a `npm ci --omit=dev`-et,
a `USER node` és `CMD` sorrendjét, a `HEALTHCHECK` meglétét, a `.dockerignore`
`.env*` kizárását, valamint azt, hogy a Dockerfile nem tartalmaz
`PASSWORD`/`SECRET`/`TOKEN`/`_KEY` mintát.

**Pending.** `docker build`, a konténer indítása, a daemon által futtatott
`HEALTHCHECK` és a konténerből érkező live/ready ellenőrzés nem futott: nincs
Docker daemon, és a `node:24.20.0-alpine3.22` base image sem húzható le (tiltott
registry egress, E01). A digest pinelés emiatt továbbra is nyitott.

---

## BE-F1 – futtatott kapuk

| Parancs | Eredmény |
| --- | --- |
| `npm run build` (tsc) | pass |
| `npm run lint` (oxlint, 121 fájl) | pass – 0 warning, 0 error |
| `npm run openapi:check` | pass (a snapshot az új `429` válaszokkal újragenerálva) |
| `npm test` (teljes Vitest) | 23 fájl pass, 1 skipped · **223 teszt pass, 40 skipped** |
| `npm run verify` | **exit 0** (Node 22.22.2, PostgreSQL 16.13) |
| Baseline ugyanezen a gépen a munka előtt | 192 pass, 40 skipped – a 40 skip nem változott, regresszió nincs |
| `docker compose config` validálás | pass (daemon nélkül) |
| `docker build` / konténer smoke | **nem futott** – nincs Docker daemon, a base image nem húzható |
| `npm run verify` Node 24.20.0-n | **nem futott** – a runtime nem szerezhető be ebben a környezetben |
| NATS/Meilisearch igényű integrációs esetek (40) | **skipped** – a szolgáltatások nincsenek |

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
4. **O1 lezárása** Docker daemonnal rendelkező gépet igényel: build, indítás,
   healthcheck és konténerből futtatott live/ready.
