# M3 – futtatási jegyzőkönyv

2026-09-15 · Outbox → JetStream relay.

## Környezet

| Elem | Érték |
| --- | --- |
| Node | 24.x (engines: `>=24.20.0 <25`) |
| PostgreSQL | 17 (Compose `postgres:17-alpine`) |
| NATS | `nats:2-alpine` JetStream, Compose `--profile full` / izolált `nats` szolgáltatás |
| Kliens | `@nats-io/transport-node@3.4.0`, `@nats-io/jetstream@3.4.0` |
| Stream izoláció | tesztenként egyedi `NATS_STREAM` / `NATS_SUBJECT` |

## Parancsok

```bash
docker compose --profile full up -d --wait postgres nats
npm ci && npm run build && npm run db:migrate
export TEST_DATABASE_URL=...   # *_test marker
export NATS_URL=nats://127.0.0.1:4222
npm run test:integration:m3
FEATURE_OUTBOX_RELAY=on NATS_URL=... npm run demo:m3
npm run smoke:full             # NATS szakasz; kereső pending
```

Külső broker: `NATS_URL` / `SMOKE_EXTERNAL_NATS_URL` megadásával a futtató nem
indít Compose NATS-t (E01).

## Eredmény

| Ellenőrzés | Eredmény |
| --- | --- |
| M3-T01–T20 (relay.test.ts, 17 eset) | PASS valódi JetStream + PostgreSQL 17 ellen |
| `demo:m3` | pending → deliver → stop → 2 pending → catch-up |
| M2 identity | **nincs implementálva**; T12–T13 a teszt-assembly `x-test-actor` útján fut |
| Image digest pin | nyitott (E01) |

A logban nincs `DATABASE_URL`, NATS-hitelesítő vagy eseménypayload. A
`/health/ready` továbbra is csak a PostgreSQL-t nézi.
