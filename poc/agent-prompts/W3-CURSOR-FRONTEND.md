# W3 Cursor feladatlap – FE-F3 frissesség, polling és diagnosztika

Te vagy a Wave 3 frontend implementáló agentje. A kijelölt worktree és branch:

- worktree: `/private/tmp/tv2-poc-fe-f3`
- branch: `codex/final-fe-f3`
- baseline: kizárólag a W2 mindkét ágának integrálása és zöld közös
  kapuja utáni tiszta `main`; ne merge-elj és ne rebase-elj

## Kizárólagos scope

Zárd le a `poc/FINAL-FRONTEND-MILESTONE.md` FE-F3 fázisát: **L2, L6, L10,
I2**. Frontend production forrás, frontend teszt és
`poc/FINAL-FRONTEND-EVIDENCE.md`, valamint kizárólag az FE-F3 checklist a
`poc/FINAL-FRONTEND-MILESTONE.md` fájlban módosítható. Backend, OpenAPI
snapshot, generated contract, Compose, koordinációs dokumentum és
milestone-összesítés nem módosítható. Őrizd meg a W2-ben bevezetett request
timeout, abort és auth retry szerződést.

## Kötelező megoldási szerződés

1. **L2 – anonim health hívások**
   - A `fetchLive` és `fetchReady` explicit `auth: false` opcióval hívja az API
     boundaryt; ez ne implicit URL-kivétel legyen a kliensben.
   - Aktív access token mellett is bizonyítsa teszt, hogy egyik `/health/*`
     híváson sincs `Authorization` header és auth recovery sem indul.
2. **L6 – élő reindex preflight**
   - Látható lapon 5–10 másodperces refetch tartsa frissen ugyanazt a
     query-keyhez tartozó preflightot és az abból számolt `canSubmit`
     állapotot.
   - Rejtett lapon a polling álljon meg; visszatéréskor azonnali refetch
     történjen. Aktív fetch mellé visibility event ne indítson másodikat.
   - Az index/outage paraméter változása továbbra is új queryt és új
     idempotency keyt jelent. Sikeres submit a ténylegesen kijelzett friss
     preflight confirmation adatait használja.
3. **L10 – health polling backoff**
   - Sikeres állapotban 10 másodperces ritmus marad. Egymást követő hibáknál
     capped exponenciális backoff és korlátozott jitter ritkítsa a hívást;
     az első siker azonnal visszaállítja a normál ritmust.
   - A policy legyen tiszta, külön tesztelhető függvény injektálható vagy
     másképp determinisztikusan kontrollálható jitterrel.
   - Live és ready querynként egyszerre legfeljebb egy request fusson; rejtett
     lapon ne legyen háttér-polling, visszatéréskor legyen frissítés.
4. **I2 – correlation ID tulajdonlás**
   - Szűnjön meg a modul-globális `lastCorrelationId` last-write-wins állapot és
     a StatusBar fallbackje.
   - A StatusBar egy név szerint megjelölt health válasz – alapértelmezésben
     `ready` – correlation ID-ját jelenítse meg, a label pedig mondja ki ezt. Ha
     még nincs ilyen sikeres válasz, `—` jelenjen meg; más request ID-ját ne
     vegye át.
   - Párhuzamos, fordított sorrendben befejeződő API-kérések tesztje igazolja,
     hogy a kijelzett ID nem a legutóbb befejeződött tetszőleges requesté.

## Tesztek

- Health header teszt aktív tokennel: live és ready is auth nélkül; 401-re
  sincs auth-recovery.
- Reindex preflight fake clockkal: normál periodikus frissítés, hidden pause,
  visible refetch, pending request melletti single-flight, blocker megjelenése
  után letiltott submit.
- Health fake clockkal: exponenciális/capped/jitterelt lépcsők, recovery reset,
  hidden pause és querynkénti legfeljebb egy aktív request.
- Correlation teszt kontrollált promise-okkal: nem-health request későbbi
  befejezése nem írja felül a ready ID-t.
- `npm run verify` és `npm run e2e:typecheck` Node 24.20.0-n.

## Evidence és átadás

- Jelöld készre kizárólag a négy FE-F3 ID-t és a ténylegesen teljesült
  kapukat; evidence-ben legyenek pontos tesztszámok és timer-invariánsok.
- Egy review-zható commit; ne merge-elj, ne rebase-elj és ne pusholj.
- Átadás: branch, commit SHA, ID-k, fájlok/viselkedés,
  parancsok/eredmények, nem futtatott kapuk, kockázat és explicit
  scope-nyilatkozat.
- Az FE-F3 átadása után Cursor read-only review-t kap a Codex BE-F3
  commitjára. Backend találatot ne javíts ezen a frontend ágon; add vissza
  Codexnek fájl/sor, súlyosság és reprodukció megadásával.
