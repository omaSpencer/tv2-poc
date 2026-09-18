# Final frontend evidence – FE-F1 és FE-F2

2026-09-18 · FE-F2: branch `codex/final-fe-f2` · worktree `/private/tmp/tv2-poc-fe-f2` ·
Node **24.20.0**.

Ez a fájl a [FINAL-FRONTEND-MILESTONE.md](FINAL-FRONTEND-MILESTONE.md) lezárt
frontend fázisainak bizonyítéka. A koordinációs dokumentumot ez a hullám nem
módosította.

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
- `ROLE_PERMISSIONS` egyetlen frontend modulban: `src/auth/permissions.ts`; az
  E2E `IDENTITY_PROFILES` is közvetlenül ezt használja, nem ismétli a listákat
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

---

## FE-F2 – Runtime-helyreállás és request-életciklus

2026-09-18 · Branch `codex/final-fe-f2` · worktree `/private/tmp/tv2-poc-fe-f2`.

Lezárt ID-k: **M2, L3, L4, L5, L9**. A FE-F2 lezárási kapuk teljesültek.

### Környezet

| Elem | Érték |
| --- | --- |
| Node.js | 24.20.0 (`nvm use 24.20.0`) |
| npm | 11.19.0 |
| Kapu | `cd poc/frontend && npm run verify` |
| E2E typecheck | `cd poc/frontend && npm run e2e:typecheck` |
| Böngészős E2E | Nem futtatva – FE-F4/FE-F5, nem FE-F2 kapu |

### Production bundle

| | JS (byte) | CSS (byte) | Legnagyobb JS |
| --- | ---: | ---: | --- |
| FE-F1 után | 684 666 | 19 064 | `assets/index-B6CWNPM2.js` 336 494 |
| FE-F2 után | 688 617 | 19 064 | `assets/index-Cj5XTy0Z.js` 339 683 |
| Delta | **+3 951** | **0** | **+3 189** |

A root error page a fő bundle-ben van (`Az oldal nem tölthető be` az
`index-Cj5XTy0Z.js`-ben), nem lazy chunkban. A növekedés a recovery UI, a
chunk loop-guard és az `apiRequest` timeout.

### M2 – Root error boundary

**Eredmény:** a data router gyökerén `errorElement={<RootErrorPage />}`; magyar,
biztonságos hibaoldal újratöltéssel; szűk lazy-chunk felismerés után legfeljebb
egy automatikus reload navigáció+build páronként.

- `src/appRoutes.tsx`: root `errorElement`
- `src/pages/RootErrorPage.tsx`: nincs stack, URL query, token, authorization
  code vagy nyers exception message; `Oldal újratöltése` + kezdőlap link
- `src/lib/lazyChunkError.ts`: Vite/webpack/browser module-script minták;
  `Failed to fetch` önmagában nem chunk hiba; sessionStorage-s loop guard
  (`indaplay.poc.lazyChunkReload`) pathname+build fingerprint, query nélkül
- Tesztek: `src/pages/RootErrorPage.test.tsx`, `src/lib/lazyChunkError.test.ts`,
  `src/App.test.tsx` (root `errorElement` jelenléte)

### L3 – Callback cache lifecycle

**Eredmény:** URL-kulcsú OIDC callback promise success és failure után is
ürül; StrictMode/párhuzamos hívás továbbra is egy `signinRedirectCallback`;
a takarítás csak a saját, még aktuális map-entryt törli.

- `src/auth/oidc.ts`: `completeSigninCallbackOnce` `then`/`catch` takarítás
  identitás-ellenőrzéssel (stale finally nem dobja a újabb in-flight entryt)
- Tesztek: `src/auth/oidc.test.ts` – concurrent, success utáni új hívás,
  failure utáni új hívás, stale finally

### L4 – Catalog probe single-flight

**Eredmény:** aktív `fetchPublishedContent` alatt hidden→visible nem indít új
probe-ot; egy probe eredménye egyszer ír state-et/`onResult`-ot; cleanup után
késői promise nem ír.

- `src/features/catalog/useCatalogVisibilityPolling.ts`: `probeInFlight` +
  `finished` + `cancelled`
- Tesztek: fake clock + kézzel kontrollált pending promise;
  unmount utáni settle nem hív `onResult`

### L5 – Pure lapozási state

**Eredmény:** cursor és history egy reducerben; state updateren belül nincs
másik setter; next/previous/filter reset StrictMode alatt egy logikai lépés.

- `src/features/contents/cursorPagination.ts`
- `src/features/contents/routes/ContentListPage.tsx`: `useReducer`
- Tesztek: reducer idempotencia; `ContentListPage.test.tsx` StrictMode
  next → previous → next → filter reset

### L9 – Központi request timeout

**Eredmény:** `apiRequest` 15 000 ms default timeout, caller `AbortSignal`
támogatással; timeout = `ApiTimeoutError` / `request_timeout`; caller abort =
`AbortError`; timer/listener cleanup auth-retry után is; `timeoutMs: false`
opt-out létezik, de semelyik hívó nem használja.

- `src/api/client.ts`: `API_REQUEST_TIMEOUT_MS`, `composeRequestSignal`
- `src/api/types.ts`: `ApiTimeoutError`, `isApiTimeoutError`
- UI: `ProblemPanel`, `CatalogSearchError` magyar timeout üzenet, nyers
  message nélkül
- Tesztek: fake clock timeout; caller abort; siker a határ előtt; auth retry
  listener/timer cleanup

### FE-F2 kapu

```text
node -v
v24.20.0

cd poc/frontend && npm run verify
contracts:check  PASS (generated backend.ts unchanged)
build            PASS
compiler:check   PASS
lint             PASS (oxlint src e2e, 0 warning)
test             PASS  37 files, 172/172

cd poc/frontend && npm run e2e:typecheck
PASS
```

### Nem futtatott kapuk

- Böngészős Playwright E2E, axe, cross-browser — FE-F4/FE-F5
- Backend test/build, OpenAPI emit — tilos volt backend/contractot módosítani
- Coverage küszöb — I4, FE-F5

### Maradék kockázat

- A chunk-hiba felismerés bundler/browser üzenetre szűk; ismeretlen szövegű
  betöltési hiba manuális újratöltést kap, nem automatikusat.
- sessionStorage quota/privát mód: az auto-reload kihagyódik, a hibaoldal
  megmarad (loop nélkül).
- A 15 s default timeout streaming/hosszú kéréshez szűk lehet; opt-out van,
  de FE-F2-ben szándékosan nincs fogyasztója.
- A root `errorElement` a shell helyett jelenik meg; a helyreállás teljes
  újratöltés vagy kezdőlap.

### Scope

Nem merge-eltem `main`-re, nem rebase-eltem, nem pusholtam, és nem módosítottam
a `/Users/busizoltan/code/tv2-poc` fő checkoutot. Backend, OpenAPI snapshot,
generated contract, Compose és `FINAL-FRONTEND-MILESTONE.md` érintetlen.
Kizárólag frontend production forrás, frontend teszt és ez az evidence fájl
változott. FE-F3–FE-F5 findingjei nyitottak maradtak.
