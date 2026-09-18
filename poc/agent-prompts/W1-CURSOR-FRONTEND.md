# W1 prompt – Cursor / frontend FE-F1

Dolgozz kizárólag a `/private/tmp/tv2-poc-fe-f1` worktree-ben, a
`codex/final-fe-f1` branchen. A branch elő van készítve; induláskor ellenőrizd,
hogy a worktree tiszta, és ne válts más branchre.

Olvasd el teljesen a `poc/FINAL-FRONTEND-MILESTONE.md` dokumentumot, majd
implementáld kizárólag a **FE-F1 – Holtkód és szerződéskonszolidáció** fázist:

- M1 – az `EditorialPage` holtkód-lánc eltávolítása;
- L7 – permission fixture/type drift megszüntetése;
- L8 – egységes UUID-validálás;
- L11 – duplikációk és nem használt exportok konszolidálása.

Koordinátori döntések ehhez a hullámhoz:

- A `/editorial` route maradjon egy release-ciklusig dokumentált kompatibilitási
  redirectként `/contents` felé, routerteszttel; maga a holtkód-lánc törlendő.
- A permissiontípus forrása a generált backend contract legyen, a role→permission
  mátrix pedig egyetlen frontend modulban maradjon.
- A `features/contents/schemas.ts` legyen a kategóriák egyetlen runtime
  igazságforrása; a catalog/demo kód innen importáljon.
- Az UUID helper fogadja el a backend által támogatott v1–v8 variant UUID-ket,
  és utasítsa el a hibás, illetve nil UUID-t. Legyen v7 pozitív regressziós teszt.

Követelmények:

1. Törlés előtt keresd végig az importokat, route-okat, storage key-eket, query
   key-eket és teszteket. Az `EditorialPage`, `PhasePlaceholderPage`,
   `ContentIdBar` és `content/activeContent` láncból ne maradjon árva export vagy
   sessionStorage mellékhatás.
2. A `/editorial` redirectet a fenti kompatibilitási döntés szerint tartsd meg,
   dokumentáld és védd routerteszttel.
3. L7-nél a publisher `ops:write` fixture egyezzen az E2E szerződéssel, és ne
   maradjon duplikált lokális `AppPermission` típus.
4. L8-nál minden megmaradó UUID input közös, backend-kompatibilis szabályt
   használjon. Legyen pozitív UUID v7 és negatív hibás UUID regressziós teszt.
5. L11-nél a permission helper, `CONTENT_CATEGORIES` és demo-konstansok közül
   csak egy igazságforrás maradjon; generált contract esetén azt részesítsd
   előnyben.
6. Ne változtass backend forrást, OpenAPI contractot, auth architektúrát vagy
   felhasználói viselkedést a kiosztott findingeken túl.
7. Hozd létre/frissítsd a `poc/FINAL-FRONTEND-EVIDENCE.md` fájlt M1, L7, L8 és
   L11 bejegyzésekkel. A milestone-ban csak valóban bizonyított checklistet
   jelölj késznek.
8. Futtasd a releváns célteszteket, majd a teljes frontend `npm run verify`
   kaput pontos Node 24.20.0 runtime-mal. Rögzítsd a production bundle méretét,
   hogy a holtkód eltávolítása mérhető legyen.
9. Ne merge-elj `main`-re, ne rebase-elj más agent ágára, és ne módosítsd a
   `/Users/busizoltan/code/tv2-poc` fő checkoutot.

Kész állapotban commitold a változtatásokat. Az átadás formája:

- branch és commit SHA;
- lezárt audit-ID-k;
- módosított fájlok és viselkedés;
- futtatott parancsok és pontos eredmények;
- production JS/CSS bundle baseline és új érték;
- nem futtatott kapuk és ok;
- nyitott döntések/kockázatok;
- explicit kijelentés, hogy nem merge-eltél és scope-on kívül nem módosítottál.

Ha a törlés olyan valós runtime fogyasztót tár fel, amelyet az audit nem látott,
állj meg, és add át a pontos import/route bizonyítékot a koordinátornak.
