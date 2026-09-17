# Fázis 5 evidence – M5 operátori beavatkozások

2026-09-17 · valódi helyi full-stack jegyzőkönyv

## Eredmény

A Fázis 5 backend–frontend implementáció és a P7-09 operátori E2E kapu kész.
A böngészős próbák valódi Authentik PKCE munkamenetet, PostgreSQL-t, NATS
JetStreamet és két külön Meilisearch példányt használtak; az outage és restart
ágak nem mockoltak.

| Kapu | Eredmény |
| --- | --- |
| Backend build + oxlint | pass, 0 warning / 0 error |
| Backend M5 célzott unit + integráció | pass, 15/15 |
| Frontend E2E typecheck + oxlint | pass |
| Normál operátori E2E | pass, 3/3 |
| Meilisearch B kiesési reindex | pass, 1/1 |
| Valódi backend SIGKILL/restart recovery | pass, 1/1 |

## Bizonyított folyamatok

- normál reindex úgy fut végig, hogy a másik index routolható;
- ugyanaz az idempotency key ugyanazt a run ID-t adja vissza, egy második
  párhuzamos reindex `409 reindex_already_running`;
- a progress route hard reload után is ugyanazt a tartós futást követi;
- másik index kiesése normál módban blokkol, explicit outage opt-in esetén
  pontos adatbázisnév-megerősítést kér és sikeresen végigfut;
- `both` content repair mindkét indexen sikeres és csak safe task-metaadatot ad;
- a karantén inspect és replay payloadmentes, reason nélkül nem indítható, a
  karanténrekord replay után is megmarad;
- futó reindex alatti valódi backend `SIGKILL` után a visszaindult runner a
  műveletet és a control sort `failed/aborted` állapotba teszi; nincs auto-resume;
- ugyanerről az oldalról új teljes reindex indítható és `succeeded/ready` lesz.

## A futás közben talált és javított regresszió

A rögzített Meilisearch 1.15 a swap kérésben csak az `indexes` mezőt fogadja el,
miközben a telepített JS kliens típusa a későbbi `rename` mezőt kötelezőnek
modellezi. Az első valódi reindex emiatt a swap feladat létrehozása előtt
`internal_error` állapotba került. A runtime requestet az 1.15 szerződéséhez
igazítottuk, és a submit előtti swap-hibát stabil `swap_task_failed` kódra
képeztük. Az ezt követő normál, outage és restart reindex mind sikeres lett.

## Reprodukció

Normál Phase 5 esetek, futó backenddel:

```bash
cd poc/frontend
npm run e2e -- --project=chromium-1280 e2e/specs/operator-actions.spec.ts --grep-invert @operator-outage
```

Valódi Meilisearch-kiesés:

```bash
E2E_DOCKER_CONTROL=true npm run e2e -- --project=chromium-1280 e2e/specs/operator-actions.spec.ts --grep @operator-outage
```

Valódi backend-crash/restart, kézzel futó backend nélkül:

```bash
E2E_BACKEND_PROCESS_CONTROL=true npm run e2e:backend-restart
```

Ez a jegyzőkönyv a Fázis 5 felhasználói/operátori kapuját zárja. A külön M5
1000+100 teljesítménybaseline és a teljes Release C Fázis 6–7 kapu továbbra is
nyitott; ezeket nem állítja késznek.
