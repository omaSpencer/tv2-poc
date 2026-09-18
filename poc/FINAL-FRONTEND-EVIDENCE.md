# Final frontend evidence – FE-F1

2026-09-18 · Branch `codex/final-fe-f1` · worktree `/private/tmp/tv2-poc-fe-f1` ·
Node **24.20.0**.

Ez a fájl a [FINAL-FRONTEND-MILESTONE.md](FINAL-FRONTEND-MILESTONE.md) FE-F1
fázisának bizonyítéka. A későbbi fázisok (FE-F2–FE-F5) ide kerülnek, amikor
lezárulnak.

## Környezet

| Elem | Érték |
| --- | --- |
| Node.js | 24.20.0 (`nvm use 24.20.0`) |
| npm | 11.19.0 |
| Kapu | `cd poc/frontend && npm run verify` |
| E2E / böngésző | Nem futtatva – FE-F1 unit/component + production build kapu |

## Production bundle

| | JS (byte) | CSS (byte) | Legnagyobb JS |
| --- | ---: | ---: | --- |
| Baseline (HEAD a változtatások előtt) | 685 311 | 19 358 | `assets/index-t1eWlQDv.js` 336 906 |
| FE-F1 után | 684 666 | 19 064 | `assets/index-B6CWNPM2.js` 336 494 |
| Delta | **−645** | **−294** | **−412** |

A baseline production bundle tartalmazta a `indaplay.poc.activeContentId`
sessionStorage-kulcsot (`ActiveContentProvider`). A FE-F1 distben ez a kulcs, az
`EditorialPage` / `ContentIdBar` / `PhasePlaceholderPage` / `MilestoneGate`
szövegek és a `useActiveContent` név nem szerepel.

## M1 – `EditorialPage` lánc eltávolítása

**Eredmény:** a holtkód-lánc törölve; `/editorial` dokumentált, egy
release-ciklusos kompatibilitási redirect `/contents` felé.

Törölt runtime:

- `src/pages/EditorialPage.tsx`
- `src/pages/PhasePlaceholderPage.tsx`
- `src/components/ContentIdBar.tsx`
- `src/content/activeContent.tsx` + `activeContentContext.ts` (és a
  `indaplay.poc.activeContentId` sessionStorage-írás)
- a csak ehhez a lánchoz tartozó `MilestoneGate` komponens és CSS

Megtartott viselkedés:

- `appRoutes.tsx`: `/editorial` → `<Navigate to="/contents" replace />`
- dokumentáció: `FRONTEND.md` screen-térkép
- routerteszt: `src/App.test.tsx`
  - authenticated publisher: pathname `/contents`, a Tartalmak nav `aria-current`
  - anonymous: `/login?returnTo=%2Fcontents`

A törlés előtt végigkeresett importok, route-ok, storage/query key-ek nem
mutattak élő runtime fogyasztót az auditon túl. Az `EditorialPage` régi
`['admin-content']` / `['processing']` query key-ei csak a törölt fájlban éltek.

## L7 – Permission-mátrix drift

**Eredmény:** a publisher mátrix tartalmazza az `ops:write` jogot, a típus a
generált contractból jön.

- `AppPermission` egyedüli forrása: `MeResponse['permissions'][number]`
  (`src/api/types.ts` ← `src/api/generated/backend.ts`)
- A lokális `demoFixture.AppPermission` (amelyből hiányzott az `ops:write`) törölve
- `ROLE_PERMISSIONS` egyetlen frontend modulban: `src/auth/permissions.ts`
- Publisher: `content:read`, `content:write`, `content:publish`, `ops:read`,
  `ops:write` — megegyezik az E2E `IDENTITY_PROFILES['poc-publisher']`
  szerződésével
- Teszt: `src/auth/permissions.test.ts`

A PermissionHints táblázat ettől a mátrixtól jelenik meg; a tényleges
engedélyezés továbbra is a `/me` válasz `can()` ellenőrzése.

## L8 – Egységes UUID-validálás

**Eredmény:** közös v1–v8 helper, nil és hibás érték elutasítva, v7 pozitív
regresszió.

- `src/lib/uuid.ts`: RFC 4122/9562 version `[1-8]`, variant `[89ab]`
- Fogyasztók: `RepairPage` (`isUuid`), demo persistence (`z.string().regex(UUID_PATTERN)`)
- A helper nem importál Zodot, hogy a repair lazy chunk ne húzza be a Zod
  runtime-ot
- Tesztek:
  - `src/lib/uuid.test.ts` — v7 elfogadás, nil/hibás elutasítás
  - `Phase5Pages.test.tsx` — v7 content id submit; nil/malformed disabled
  - `persistence.test.ts` — v7 `contentId` persistálható, nil dob

## L11 – Duplikációk és nem használt exportok

**Eredmény:** egy igazságforrás a permission helperre, kategóriákra és
demo-konstansokra.

- `can()` maradt; a sehol nem hívott `hasPermission` törölve
- `CONTENT_CATEGORIES` runtime forrása: `features/contents/schemas.ts`; a
  catalog `searchParams` és `CatalogSearchPage` innen importál
- `data/demoFixture.ts` törölve: egyetlen fogyasztója a holtkód-`EditorialPage`
  volt. A Phase 6 runner saját, run-specifikus fixture-t használ
  (`features/demo/operations.ts`). A backend `demo-fixture.ts` érintetlen.

## Kapu

```text
node -v
v24.20.0

cd poc/frontend && npm run verify
contracts:check  PASS (generated backend.ts unchanged)
build            PASS
compiler:check   PASS
lint             PASS (oxlint src e2e, 0 warning)
test             PASS  34 files, 149/149
```

A verify tesztlépése első, terhelt futtatásokon 5s timeouttal flakkelt
(jsdom worker-párhuzamosság); ismételt, Node 24.20.0 `npm run verify` zöld:
149/149.

## Nem futtatott kapuk

- Böngészős Playwright E2E, axe, cross-browser — FE-F4/FE-F5, nem FE-F1 kapu
- Backend test/build, OpenAPI emit — tilos volt backend/contractot módosítani
- Coverage küszöb — I4, FE-F5

## Nyitott döntés / kockázat

- `/editorial` egy release-ciklus után kivehető; a következő hullámban nem kell
  hozzá nyúlni, hacsak a koordinátor nem kéri a törlést.
- A `appRoutes.tsx` kiemelése csak a routerteszt miatt kellett; Fast Refresh
  warningot fájlszintű oxlint disable fed.

## Scope

Nem merge-eltem `main`-re, nem rebase-eltem más agent ágára, és nem módosítottam
a `/Users/busizoltan/code/tv2-poc` fő checkoutot. Backend forrás, OpenAPI,
auth architektúra és a kiosztott findingeken túli felhasználói viselkedés
változatlan (a PermissionHints publisher sora most helyesen mutatja az
`ops:write` jogot).
