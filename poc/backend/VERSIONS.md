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
| `zod` | 4.6.5 | Konfiguráció, HTTP-DTO és eseményszerződés |
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
| Authentik | `AUTHENTIK_IMAGE` | `ghcr.io/goauthentik/server:2025.8` | nyitott |
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
tényleges elérhető minor kiadást az első pull igazolja. A Meilisearch és
Authentik alapértékek javaslatok, az M4, illetve M2 munkája erősíti meg őket.

## Ami ellenőrzött és ami nem

- Ellenőrzött: telepítés, fordítás, DI-indulás, migráció és ismételt migráció,
  teljes tesztfutás valódi PostgreSQL 17-en, core smoke, M1 demó.
- Nem ellenőrzött: konténerimage-ek húzása és indulása, a full profil futása,
  Authentik/NATS/Meilisearch tényleges viselkedése. Ezek M0-16b, M2, M3 és M4
  eredményei.
