# Verziójegyzék – M0-17

2026-09-15 · A csomagverziók telepítéssel és futtatással ellenőrzöttek. Az
image-digestek **nyitottak**: a jelen munkakörnyezetből a konténerregiszter nem
érhető el, ezért digestet találgatás helyett nem rögzítünk.

## Futtatókörnyezet

| Elem | Pin | Bizonyíték |
| --- | --- | --- |
| Node.js | 24.20.0 (`.nvmrc`, `engines`) | `node -v` a build és a teljes tesztfutás alatt |
| npm | 10.9.7 | `npm ci`, `npm run build` |
| PostgreSQL | 17 (a séma- és tranzakciópróbák 17.10 ellen futottak) | `select version()` a teszt-adatbázison |

## Közvetlen csomagok

Minden közvetlen függőség pontos verziót kap, a `package-lock.json` commitolva.

| Csomag | Verzió | Szerep |
| --- | --- | --- |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` | 12.0.3 | Alkalmazásmag |
| `@nestjs/config` | 12.0.0 | Konfigurációbetöltés és validálás |
| `@nestjs/swagger` | 12.0.1 | OpenAPI `/docs`, `/docs-json` |
| `express` | 5.2.1 | Explicit JSON body parser és hibahatár |
| `drizzle-orm` | 0.45.2 | Séma és lekérdezések, tranzakció + savepoint |
| `drizzle-kit` | 0.31.10 | Migrációs formátum, fájlnév és saját napló |
| `pg` | 8.23.0 | PostgreSQL driver |
| `pino` | 10.3.1 | Strukturált log |
| `@nats-io/transport-node` | 3.4.0 | NATS kapcsolat (M3 relay) |
| `@nats-io/jetstream` | 3.4.0 | JetStream publish / consume / stream menedzsment |
| `meilisearch` | 0.62.0 | Meilisearch JS kliens (M4 index és keresés) |
| `zod` | 4.6.5 | Konfiguráció, HTTP-DTO és eseményszerződés |
| `jose` | 6.2.12 | OIDC access-token ellenőrzés (M2) |
| `reflect-metadata` | 0.2.2 | Nest DI |
| `rxjs` | 7.8.2 | Nest peer |
| `typescript` | 6.0.3 | Fordítás (ESM, NodeNext) |
| `vitest` | 4.1.11 | Teszt futtató |
| `oxlint` | 1.42.0 | Lint |
| `@types/node` 24.13.4, `@types/express` 5.0.6, `@types/pg` 8.23.1 | – | Típusok |

Az alkalmazás Nest DI-je minden konstruktorparaméteren explicit `@Inject()`
tokent használ, így `emitDecoratorMetadata` nélkül is feloldható. Ez teszi
lehetővé, hogy a Vitest ugyanazt az összeállítást futtassa, mint a build.

## Image-ek

A `compose.yaml` minden image-et változón keresztül hivatkozik, így a pontos tag
vagy digest a környezeti fájlból jön, a compose módosítása nélkül.

| Szolgáltatás | Változó | Jelenlegi alapérték | Digest |
| --- | --- | --- | --- |
| PostgreSQL | `POSTGRES_IMAGE` | `postgres:17-alpine` | nyitott |
| NATS JetStream | `NATS_IMAGE` | `nats:2-alpine` | nyitott |
| Meilisearch A/B | `MEILI_IMAGE` | `getmeili/meilisearch:v1.15` | nyitott |

| Authentik | `AUTHENTIK_IMAGE` | `ghcr.io/goauthentik/server:2025.8@sha256:f162a2664fc54337be65f796130443e19d038caa82be572b7d44aa8b1a895af2` | rögzítve (2026-09-15 pull) |
| Redis (Authentik) | `REDIS_IMAGE` | `redis:7-alpine` | nyitott |

A tag és a digest rögzítése registryelérésű gépen egy lépés:

```bash
docker pull postgres:17-alpine
docker image inspect postgres:17-alpine --format '{{index .RepoDigests 0}}'
```

Az így kapott `név@sha256:...` értéket a környezeti fájl `*_IMAGE` kulcsába kell
írni, majd `docker compose --profile full config -q` ellenőrzés következik. Amíg
ez nem történt meg, az M0 lezárási lista image-digest pontja nem pipálható ki.

A minor verziók (`17-alpine`, `nats:2-alpine`) szándékosan konzervatívak: a
tényleges elérhető minor kiadást az első pull igazolja. Az Authentik alapérték
javaslat, amit az M2 munkája erősít meg.

## M4 – Meilisearch kliens és szerver (M4-01 spike)

| Elem | Érték | Bizonyíték |
| --- | --- | --- |
| Kliens | `meilisearch` **0.62.0**, pontos pin, lockfile-ban | Node 24.20.0 / ESM alatt index-, settings-, task-, delete-, search- és hibakódpróba valódi szerver ellen |
| Szerver | Meilisearch **1.15.2** (`getmeili/meilisearch:v1.15` sorozat) | `GET /version` → `pkgVersion: 1.15.2` mindkét példányon |

A spike a következőket rögzítette, és ezekre épül a `src/search/meili.adapter.ts`
hibaosztályozása:

| Megfigyelés | Következmény a kódban |
| --- | --- |
| `createIndex` / `updateSettings` / `addDocuments` / `deleteDocument` mind task UID-t ad, `enqueued` státusszal | Semmi nem számít sikernek a task végállapotáig |
| Nem létező dokumentum törlése `succeeded`, `deletedDocuments: 0` | A delete idempotens, redelivery nem hibázik |
| `displayedAttributes: ['id']` mellett a találat tényleg csak `id`-t tartalmaz | A publikus mezők kizárólag PostgreSQL-ből jönnek |
| Ékezet nélküli keresés megtalálja az ékezetes címet (`ekezetes` → „Ékezetes") | Magyar tartalom ékezet nélkül is kereshető; M4-T15 rögzíti |
| 401/403 → `MeilisearchApiError`, `response.status`, `cause.code` | Strukturális osztályozás, nem üzenet-illesztés |
| Kliens `timeout` → `MeilisearchRequestError`, `cause: MeilisearchRequestTimeOutError` | Timeout átmeneti hiba, fallback engedélyezett |
| Nem JSON hibatörzs (pl. proxy 502 HTML) **nyers `SyntaxError`-t** dob | Az ismeretlen hiba alapértelmezése `transient`, nem karantén |

## Ami ellenőrzött és ami nem

- Ellenőrzött: telepítés, fordítás, DI-indulás, migráció és ismételt migráció,
  teljes tesztfutás valódi PostgreSQL-en, core smoke, M1 demó, M2 L1 identity
  (mock JWKS), M3 relay JetStream ellen, valamint **M4 két külön Meilisearch
  1.15.2 példány ellen** (`test:integration:m4`, `smoke:full`, `demo:m4`).
- Nem ellenőrzött: konténerimage-ek digest pinelése, a full Compose profil
  tényleges indulása (E01). Az Authentik L2 (M2-T20–T22) pending, amíg E01–E05
  nyitott; emiatt az M4 teljes „belépés → publikálás → keresés" üzleti demója is
  `M2 L2 pending`, miközben a keresőút maga bizonyított.
- Az M4 ellenőrzés részleteit és a környezeti eltéréseket az
  [`M4-EVIDENCE.md`](../M4-EVIDENCE.md) rögzíti.
