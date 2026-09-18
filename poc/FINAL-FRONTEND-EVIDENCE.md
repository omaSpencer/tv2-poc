# Final frontend evidence – FE-F1–FE-F4

2026-09-18 · FE-F2: branch `codex/final-fe-f2`; FE-F3: branch
`codex/final-fe-f3`; FE-F4: branch `codex/final-fe-f4`; integráció: `main`.
Node **24.20.0**.

Ez a fájl a [FINAL-FRONTEND-MILESTONE.md](FINAL-FRONTEND-MILESTONE.md) lezárt
frontend fázisainak bizonyítéka. A fáziságak után a koordinátor az integrált
`main` állapotot is újraellenőrizte.

## Környezet

| Elem | Érték |
| --- | --- |
| Node.js | 24.20.0 (`nvm use 24.20.0`) |
| npm | 11.19.0 |
| Kapu | `cd poc/frontend && npm run verify` (+ FE-F3: `npm run e2e:typecheck`) |
| E2E / böngésző | Nem futtatva – unit/component + production build kapu |

## Production bundle

| | JS (byte) | CSS (byte) | Legnagyobb JS |
| --- | ---: | ---: | --- |
| Baseline (HEAD a változtatások előtt) | 685 311 | 19 358 | `assets/index-t1eWlQDv.js` 336 906 |
| FE-F1 után | 684 666 | 19 064 | `assets/index-B6CWNPM2.js` 336 494 |
| FE-F1 delta | **−645** | **−294** | **−412** |
| FE-F3 (`05c8c29` + L2/L6/L10/I2) | 685 939 | 19 064 | `assets/index-glMBnpP2.js` 337 558 |
| FE-F3 vs FE-F1 | **+1 273** | **0** | **+1 064** |
| Integrált FE-F1–FE-F3 | 690 317 | 19 064 | `assets/index-D4TFOdbu.js` 341 068 |

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

## Scope (FE-F1)

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

**Eredmény:** `apiRequest` 15 000 ms default timeout a response body teljes
kiolvasásáig, caller `AbortSignal`
támogatással; timeout = `ApiTimeoutError` / `request_timeout`; caller abort =
`AbortError`; timer/listener cleanup auth-retry után is; `timeoutMs: false`
opt-out létezik, de semelyik hívó nem használja.

- `src/api/client.ts`: `API_REQUEST_TIMEOUT_MS`, `composeRequestSignal`
- `src/api/types.ts`: `ApiTimeoutError`, `isApiTimeoutError`
- UI: `ProblemPanel`, `CatalogSearchError` magyar timeout üzenet, nyers
  message nélkül
- Tesztek: fake clock timeout a fetch és a függő response body alatt; caller
  abort; siker a határ előtt; auth retry listener/timer cleanup

### FE-F2 kapu

Az önálló FE-F2 ágon a teljes `npm run verify` és az `npm run e2e:typecheck`
zöld volt: 37 tesztfájl, 173/173 teszt. Az integrált FE-F1–FE-F3 kapu az FE-F3
szakasz végén szerepel.

---

## FE-F3 – Frissesség, polling és diagnosztika

2026-09-18 · Branch `codex/final-fe-f3` · worktree `/private/tmp/tv2-poc-fe-f3` ·
Node **24.20.0**. Lezárt ID-k: **L2, L6, L10, I2**.

A FE-F3 ág `main` @ `05c8c29` baseline-ról készült, ezért az integrációkor
külön ellenőriztük a W2 timeout/abort/auth-retry szerződését. Az eredményben a
response body teljes kiolvasásáig élő timeout megmaradt, miközben a globális
`lastCorrelationId` eltűnt. A health hívások explicit `auth: false` miatt nem
indítanak recovery-t.

### Timer-invariánsok

- Fake clock: `vi.useFakeTimers()`; Query `notifyManager` `setTimeout(0)`
  flush: `advanceTimersByTimeAsync(0)` (`flushFakeQueryUpdates`).
- Timeres tesztek `beforeEach`/`afterEach` visszaállítja a real timert és
  `document.visibilityState = 'visible'`.
- TanStack Query v5: `refetchIntervalInBackground: false`; visibility refetch
  `refetch({ cancelRefetch: false })` + `!isFetching` (in-flight join, nem
  második fetch).
- Consecutive health backoff **nem** `fetchFailureCount`-ra épül (a fetch
  start nullázza); `createFailureTracker()` a queryFn körül számol.

### L2 – Anonim health hívások

**Eredmény:** `fetchLive` / `fetchReady` explicit `{ auth: false }`; a kliens
nem `/health` URL-kivétel. Aktív token mellett sincs `Authorization`, 401-re
sincs auth recovery. Ugyanazon path `apiRequest('/health/live')` (alapértelmezett
auth) továbbra is Bearer-t küld — bizonyítja, hogy a policy opció, nem path.

- `src/api/health.ts`: `{ auth: false }` (ready: `acceptNonOkJson: true`)
- `src/api/client.ts`: `options.auth !== false` a Bearer és a 401 recovery
  feltétele; `lastCorrelationId` törölve (I2)
- Tesztek: `src/api/health.test.ts` (3)

### L6 – Élő reindex preflight

**Eredmény:** látható lapon 8 s refetch ugyanazon query key-en; hidden pause;
visible azonnali refetch; in-flight mellett nincs második fetch; index/outage
változás új query + új idempotency key. A submit frissítés közben és sikertelen
frissítés után tiltott; sikeres frissítéskor a kijelzett preflight
`confirmationTarget` értékét küldi.

- `src/features/operations/reindexPreflightPoll.ts`: `REINDEX_PREFLIGHT_POLL_MS = 8_000`
- `src/lib/useVisibleRefetch.ts`
- `src/features/operations/routes/ReindexPage.tsx`: `refetchInterval` +
  `refetchIntervalInBackground: false` + `useCallback` queryFn
- Tesztek: `reindexPreflightPoll.test.ts` (1), `ReindexPage.test.tsx` (7)
  - 8 s beat ugyanazon query-n
  - hidden pause, visible refetch
  - pending + visibility single-flight
  - poll után `active_run` blocker → submit disabled
  - displayed `poc_fresh` confirmation a submit body-ban
  - index/outage → új `fetchReindexPreflight` hívás

### L10 – Health polling backoff

**Eredmény:** siker 10 s; thrown hiba és feloldott, kijelzendő ready 503 esetén
is capped exponenciális backoff (20 s / 40 s / 80 s) ±10 % injektálható
jitter; első egészséges válasz vissza a 10 s-re; live és ready querynként
legfeljebb egy in-flight; hidden pause, visible refresh.

- `src/lib/healthPollInterval.ts`: `HEALTH_POLL_SUCCESS_MS = 10_000`,
  `HEALTH_POLL_MAX_MS = 80_000`, `HEALTH_POLL_JITTER_RATIO = 0.1`,
  `createFailureTracker`
- `src/components/StatusBar.tsx`: `useTrackedHealthQuery` (`retry: false`)
- Tesztek: `healthPollInterval.test.ts` (5), `StatusBar.test.tsx` polling
  esetei (jitter a tesztben `() => 0`)

### I2 – Correlation ID tulajdonlás

**Eredmény:** nincs modul-globális last-write-wins ID. A StatusBar label
`ready correlationId`; érték `ready.data?.correlationId || '—'`. Live vagy
később befejeződő nem-health kérés nem írja felül.

- Tesztek: `StatusBar.test.tsx` — em dash a ready sikerig; live ID figyelmen
  kívül; contents-first + live/ready reverse-complete → `ready-last`

### FE-F3 kapu

```text
node -v
v24.20.0

cd poc/frontend && npm run verify
contracts:check  PASS (generated backend.ts unchanged)
build            PASS
compiler:check   PASS
lint             PASS (oxlint src e2e, 0 warning)
test             PASS  42 files, 197/197 (integrált FE-F1–FE-F3)

cd poc/frontend && npm run e2e:typecheck
PASS
```

A végső integrált kapu a default párhuzamos `vitest run` beállítással is zöld:
42/42 fájl, 197/197 teszt. A build contract-, compiler-, lint- és bundle-kapuja,
valamint az E2E TypeScript-ellenőrzés szintén sikeres.

### Nem futtatott kapuk (FE-F2/FE-F3 ágakon)

- Böngészős Playwright E2E, axe, cross-browser — FE-F4/FE-F5
- Backend test/build, OpenAPI emit — tilos volt backend/contractot módosítani
- Coverage küszöb — I4, FE-F5

### Maradék kockázat (FE-F2)

- A chunk-hiba felismerés bundler/browser üzenetre szűk; ismeretlen szövegű
  betöltési hiba manuális újratöltést kap, nem automatikusat.
- sessionStorage quota/privát mód: az auto-reload kihagyódik, a hibaoldal
  megmarad (loop nélkül).
- A 15 s default timeout streaming/hosszú kéréshez szűk lehet; opt-out van,
  de FE-F2-ben szándékosan nincs fogyasztója.
- A root `errorElement` a shell helyett jelenik meg; a helyreállás teljes
  újratöltés vagy kezdőlap.

### Maradék kockázat (FE-F3)

- A reindex blocker/confirmation UI-tesztek három poll-ütemet várnak, mert
  a Query observer újraindíthatja az 8 s intervalt.
- `useVisibleRefetch` a `isFetching` closure-re támaszkodik; in-flight alatt
  a visibility handler no-op, a Query `cancelRefetch: false` a biztonsági
  háló.

### Integrációs scope

FE-F2 és FE-F3 együtt került a `main` ágra. Backend- vagy OpenAPI-szerződést
egyik frontend fázis sem módosított; FE-F4, FE-F5 és a milestone DoD nyitott.

---

## FE-F4 – UX, accessibility és navigáció

2026-09-18 · Branch `codex/final-fe-f4` · worktree `/private/tmp/tv2-poc-fe-f4`
· baseline `98dc729` · Node **24.20.0**. Lezárt ID-k: **L12, L13, I1, I5**.

A termék döntése magyar-only; i18n runtime nincs. A négy finding implementálva,
a component/router/timer kapuk zöldek. A böngészős Playwright accessibility
szelet ebben a worktree-ben nem indult el (nincs `.env.e2e`, a backend
`/health/ready` nem elérhető).

### Környezet

| Elem | Érték |
| --- | --- |
| Node.js | 24.20.0 (`nvm use 24.20.0`) |
| npm | 11.19.0 |
| Kapu | `cd poc/frontend && npm run verify` (a tesztlépés alapértelmezett
  párhuzamossággal 5 s timeouttal flakkelhet; ismételt
  `npx vitest run --maxWorkers=4` 215/215) |
| E2E typecheck | `cd poc/frontend && npm run e2e:typecheck` PASS |
| Böngészős E2E / axe | Nem futott – hiányzik `E2E_USER_PASSWORD` és a backend ready |

### Production bundle

| | JS (byte) | CSS (byte) | Legnagyobb JS |
| --- | ---: | ---: | --- |
| Integrált FE-F1–FE-F3 | 690 317 | 19 064 | `assets/index-D4TFOdbu.js` 341 068 |
| FE-F4 (`index-BKe50RUK.js`) | 693 297 | 19 273 | `assets/index-BKe50RUK.js` 343 710 |
| Delta | **+2 980** | **+209** | **+2 642** |

A 404 nézet a fő bundle-ben van (`Az oldal nem található` az
`index-BKe50RUK.js`-ben), nem lazy chunkban. A dirty-navigation adapter külön
chunk (`useDirtyNavigationGuard-B8bCCOIZ.js`, 4 110 byte), mert a szerkesztő
lapok lazy-k.

### Timer- és fókusz-invariánsok (L12)

- Fake clock: `vi.useFakeTimers()`; success timeout **5 000 ms**.
- Hover vagy a toaston belüli keyboard focus szünetelteti a visszaszámlálást;
  resume a **maradék** idővel folytatódik (2 000 ms után pause, majd 3 000 ms
  resume → dismiss).
- Error toast 60 000 ms után is perzisztens; csak a „Értesítés bezárása”
  gomb tünteti el.
- Megjelenéskor nincs autofocus; a mező fókusza megmarad. Unmount után a timer
  nem hív `setState`-et.
- Live-region: success `role="status"` + `aria-live="polite"` +
  `aria-atomic="true"`; error `role="alert"` + `aria-live="assertive"`. A záró
  gomb **nincs** a live-regionben (nincs dupla bejelentés).

### L12 – Bezárható, szüneteltethető értesítések

**Eredmény:** minden toast billentyűzettel elérhető magyar záró gombot kap;
success 5 s után eltűnhet, error kézi bezárásig marad.

- `src/components/NotificationProvider.tsx`
- Tesztek: `src/components/NotificationProvider.test.tsx` (4)

### L13 – Saját 404 route

**Eredmény:** a wildcard nem redirectel. Az `AppShell`-en belül magyar
„Az oldal nem található” nézet, a kért út visszhangozása nélkül; Főoldal-link
és biztonságos Vissza (csak `history.state.idx > 0` vagy nem-`default`
location key; deep link → kezdőlap, `replace`).

- `src/pages/NotFoundPage.tsx`, `src/navigation/inAppHistory.ts`
- `src/appRoutes.tsx`: `path="*"` → `<NotFoundPage />`
- Tesztek: `NotFoundPage.test.tsx` (3), `inAppHistory.test.ts` (2),
  `App.test.tsx` unknown routes (1)

### I1 – Stabil dirty-navigation adapter

**Eredmény:** nincs `unstable_usePrompt`. A pinelt React Router `useBlocker`
API egyetlen adapterben (`useDirtyNavigationGuard`) tulajdonolja a belső
blokkolást és a magyar confirm szöveget. A `beforeunload` csak
`preventDefault` + `returnValue = ''`; a böngésző natív copyját az alkalmazás
nem állítja.

- Dirty: confirm → proceed egyszer, cancel → reset, az oldalon maradás.
- Tiszta állapotban nincs prompt. Mentés utáni redirect (`dirty === false`)
  és a lap Mégse gombja ugyanazt a policyt követi (Mégse a blocker confirmján
  megy át, nincs kettős ablak).
- Tesztek: `src/navigation/useDirtyNavigationGuard.test.tsx` (7) — belső link,
  browser back, cancel/confirm, clean transition, beforeunload
  `defaultPrevented`/`returnValue`, és a forrás nem tartalmazza az
  `unstable_usePrompt` importot.

### I5 – Magyar-only UI

**Eredmény:** a frontend README rögzíti a magyar-only döntést, a technikai
tokenek kivételét, és azt a feltételt, amely később i18n projektet indít
(production második nyelv).

Felhasználói copy magyarra hozva a shellben, kezdőlapon, státuszsávon,
jogosultsági mátrixban, 404-en, toaston, demó workspace-en és az operátori
állapotcímkéken. A `ProblemPanel` továbbra is megjelenítheti a nyers
`Failed to fetch` exceptiont — ez a rögzített biztonsági hiba-megjelenítés,
nem nyelvi egységesítés.

- Dokumentáció: `poc/frontend/README.md` (Nyelv)
- `<html lang="hu">` marad az igazságforrás
- Teszt: `src/uiLanguage.test.tsx` (1)

### FE-F4 kapu

```text
node -v
v24.20.0

cd poc/frontend && npm run contracts:check
PASS (generated backend.ts unchanged)

cd poc/frontend && npm run build
PASS
{"event":"bundle_baseline","javascriptBytes":693297,"cssBytes":19273,
 "largestJavaScript":{"path":"assets/index-BKe50RUK.js","bytes":343710}}

cd poc/frontend && npm run compiler:check
PASS

cd poc/frontend && npm run lint
PASS (oxlint src e2e, 0 warning)

cd poc/frontend && npx vitest run --maxWorkers=4
PASS  47 files, 215/215

cd poc/frontend && npm run e2e:typecheck
PASS
```

Az alapértelmezett, erősen párhuzamos `vitest run` (a `npm run verify`
tesztlépése) továbbra is 5 s timeouttal flakkelhet jsdom worker-terhelésen;
ugyanaz a suite `--maxWorkers=4` mellett 215/215.

### Nem futtatott kapuk (FE-F4)

- Böngészős Playwright `e2e:a11y` / navigációs szelet: a global-setup
  blokkolt (`E2E_USER_PASSWORD` hiányzik, `http://127.0.0.1:3000/health/ready`
  nem elérhető). A spec bővítve van 404 + toast close button ellenőrzéssel;
  új axe dependency nincs.
- Coverage küszöb — I4, FE-F5
- Backend test/build, OpenAPI emit — tilos volt módosítani

### Maradék kockázat (FE-F4)

- A dirty confirm `window.confirm`; StrictMode devben a blocker effect
  elvileg kétszer fusson, a `promptLock` ezt a dupla natív dialogot
  megfogja. Production (nem Strict) egy confirm.
- A biztonságos Vissza a React Router `idx` mezőjére (hiányában a location
  key-re) támaszkodik, nem a `window.history.length`-re, hogy idegen originre
  ne lépjen.
- A Playwright axe kapu környezeti okból nem futott ezen az ágon.

### Scope (FE-F4)

Nem merge-eltem `main`-re, nem rebase-eltem más agent ágára, és nem
módosítottam a `/Users/busizoltan/code/tv2-poc` fő checkoutot. Backend forrás,
OpenAPI, generated contract, Compose és dependency-verzió változatlan.

