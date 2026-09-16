# M5 evidence

2026-09-16 · implementációs jegyzőkönyv

## Jelenlegi állapot

Az M5 vezérlősík és operátori eszközök implementálva vannak. Ebben a
munkakörnyezetben nem állt rendelkezésre konfigurált PostgreSQL/NATS/két Meili
és valódi Authentik hozzáférés, ezért a teljes M5-T01–T32 evidence futás nem
jelölhető passnak. A lenti lokális eredmények implementációs ellenőrzések; a
milestone csak az izolált full-stack futás és az identity L2 után zárható.

| Ellenőrzés | Eredmény |
| --- | --- |
| TypeScript build | pass |
| oxlint | pass |
| M5 szerződés unit teszt (5 eset) | pass |
| M4 review regresszió (18 eset) | pass |
| Valódi M5 integráció T01–T32 | pending – külső szolgáltatások nincsenek konfigurálva |
| Valódi Authentik T25–T26 | pending – E01–E05 hozzáférés szükséges |
| 1000 + 100 baseline raw eredmény | pending – `baseline:m5` runner elkészült, full stack szükséges |

## Implementált bizonyítási felületek

- `0002_reindex_control.sql`: upgrade high-water és tartós A/B állapot;
- reindex CLI: drain, S0/H/S1, snapshot, staging, swap, durable catch-up, S2,
  exact verify és tartós ready/failed állapot;
- bounded publish/withdraw advisory barrier;
- karantén inspect/replay és DB-alapú repair CLI;
- kibővített processing-status;
- determinisztikus baseline runner raw JSON és Markdown kimenettel;
- recovery runbook.

## Kötelező következő evidence futás

Friss, runId-val izolált környezetben futtatandó: migráció upgrade és fresh DB,
M5-T02–T24 recovery/fault próbák, T25–T26 valódi Authentik, T27–T28 status/log
audit, T29–T30 baseline, majd T31–T32 teljes smoke/regresszió. Pending eredmény
nem számít passnak.
