# W2 Cursor feladatlap – FE-F2 runtime-helyreállás

Te vagy a Wave 2 frontend implementáló agentje. A kijelölt worktree és branch:

- worktree: `/private/tmp/tv2-poc-fe-f2`
- branch: `codex/final-fe-f2`
- baseline: a worktree létrehozásakor aktuális, tiszta `main`; ne merge-elj és ne rebase-elj

## Kizárólagos scope

Zárd le a `poc/FINAL-FRONTEND-MILESTONE.md` FE-F2 fázisát: **M2, L3, L4,
L5, L9**. Frontend production forrás, frontend teszt és
`poc/FINAL-FRONTEND-EVIDENCE.md` módosítható. Backend, OpenAPI snapshot,
generated contract, Compose és a koordinációs dokumentum nem módosítható.

## Kötelező megoldási szerződés

1. **M2 – root recovery**
   - A data router gyökerén legyen `errorElement`/root error boundary.
   - A felhasználó magyar, biztonságos hibaoldalt kapjon; stack, URL query,
     token, authorization code és nyers exception message ne jelenjen meg.
   - Legyen újrapróbálás/újratöltés akció.
   - Felismert lazy-chunk betöltési hibánál legfeljebb egyszer történhet teljes
     reload ugyanarra a navigációra/buildre. Session-szintű loop guard és
     determinisztikus teszt kötelező; általános renderhibát ne minősíts chunk
     hibának.
2. **L3 – callback cache lifecycle**
   - Az URL/code kulcsú callback promise success és failure után is ürüljön.
   - Párhuzamos/StrictMode hívás továbbra is egyetlen OIDC callbacket indítson.
   - A `finally` takarítás csak a saját, még aktuális map-entryt törölje.
3. **L4 – catalog probe single-flight**
   - Aktív `fetchPublishedContent` alatt hidden→visible esemény nem indíthat új
     probe-ot.
   - Egy probe eredménye legfeljebb egyszer módosíthat budgetet/state-et és
     legfeljebb egyszer hívhatja az `onResult` callbacket.
   - Cleanup után késői promise nem írhat state-et.
4. **L5 – pure lapozási state**
   - State updateren belül tilos másik setter hívása.
   - A cursor és history egyetlen reducer/atomikus state-transition része legyen;
     filter reset, next és previous StrictMode alatt is egy logikai lépés.
5. **L9 – központi request timeout**
   - Az `apiRequest` kapjon dokumentált default timeoutot és caller által adott
     `AbortSignal` támogatást.
   - A caller abort és a timeout legyen megkülönböztethető; timeouthoz stabil,
     UI-ban felismerhető hibatípus/kód tartozzon.
   - A saját signal és timeout kompozíciója ne szivárogtasson timert/listenert,
     auth-retry esetén se.
   - Explicit timeout opt-out csak indokolt streaming/hosszú kéréshez legyen;
     jelenleg ne vezess be felesleges kivételt.

## Tesztek

- Root renderhiba, szűken felismert chunk hiba, egyszeri reload és loop guard.
- Callback cache: concurrent/StrictMode, success utáni új hívás, failure utáni új hívás.
- Visibility fake clock + kézzel kontrollált pending promise: egyszerre egy probe.
- Lapozás StrictMode alatt: next/previous/filter reset.
- API timeout fake clockkal; caller abort; siker a határ előtt; auth retry cleanup.
- `npm run verify` és `npm run e2e:typecheck` Node 24.20.0-n.

## Evidence és átadás

- Jelöld készre kizárólag az öt FE-F2 ID-t és a ténylegesen teljesült kapukat.
- Bővítsd a `poc/FINAL-FRONTEND-EVIDENCE.md` fájlt pontos teszteredményekkel.
- Egy review-zható commitot adj át; ne merge-elj `main`-re és ne pusholj.
- Átadás: branch, commit SHA, ID-k, fájlok, parancsok/eredmények, maradék
  kockázat és explicit scope-nyilatkozat.
