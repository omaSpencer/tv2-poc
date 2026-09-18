# IndaPlay / TV2 PoC – API playground

Vite + React + TanStack Query + React Router kliens a NestJS backend mellé.
Demó- és kipróbálófelület, nem termelési CMS. A high-level háttér:
[../FRONTEND.md](../FRONTEND.md); az aktuális, nyolcfázisú végrehajtási roadmap:
[../FRONTEND-IMPLEMENTATION-PLAN.md](../FRONTEND-IMPLEMENTATION-PLAN.md).

## Előfeltétel és identity konfiguráció

Futó backend a `VITE_BACKEND_ORIGIN` címen (alap: `http://127.0.0.1:3000`).
Lásd [../backend/README.md](../backend/README.md).

Az Authentik Authorization Code + PKCE beállításai a `.env.example` fájlban
vannak. Fejlesztésben az issuer/client páros együtt kötelező; production buildben
a callback és post-logout URL-t is explicit meg kell adni. A manuális Bearer mező
alapból és a normál build DOM-jában sincs jelen; kizárólag
`VITE_ALLOW_MANUAL_TOKEN=true` mellett használható helyi hibakeresésre.

## Indítás

```bash
cd poc/frontend
cp .env.example .env   # ha még nincs
npm ci
npm run dev
```

Böngésző: [http://127.0.0.1:5173](http://127.0.0.1:5173).

A Vite a `/api/*` hívásokat a backend originre továbbítja (`/api` prefix nélkül).

## Route-ok

| Útvonal | Screen | Backend milestone |
| --- | --- | --- |
| `/` | Kezdőlap / térkép | — |
| `/login` | Authentik belépés, session és `/me` | M2 |
| `/auth/callback` | OIDC callback feldolgozás | M2 |
| `/contents` | Cursoros szerkesztői lista URL-szűrőkkel | M1+M2 |
| `/contents/new` | Validált piszkozat-létrehozás | M1+M2 |
| `/contents/:id` | Áttekintő, lifecycle akciók és audit-idővonal | M1+M2 |
| `/contents/:id/edit` | Dirty-state és verziókonfliktus-védett szerkesztés | M1+M2 |
| `/catalog/search` | Publikus katalóguskeresés | M4 |
| `/catalog/:id` | Publikus részlet | M1 |
| `/operations` | Processing dashboard, `ops:read` guarddal | M3 |
| `/demo` | Életciklus lépésenként + negatív esetek | M2+ |

Az aktív content UUID a demó screenek között megmarad. Az OIDC sessiont az
`oidc-client-ts` kezeli `sessionStorage`-ban; a raw access tokent a React
komponensek nem kapják meg és nem renderelik. A jogosultság egyetlen forrása a
backend `GET /me` válasza.

## Parancsok

| Parancs | Mit csinál |
| --- | --- |
| `npm run dev` | Fejlesztői szerver + proxy |
| `npm run build` | TypeScript + route-szintű production bundle + méretkeret |
| `npm run compiler:check` | Ellenőrzi, hogy a build tartalmaz React Compiler memoizációt |
| `npm run preview` | A buildelt bundle helyi előnézete |
| `npm run lint` | oxlint a `src` és az `e2e` fán |
| `npm run test` | Vitest unit- és component tesztek |
| `npm run verify` | Contract drift + build + React Compiler + lint + tesztek |
| `npm run e2e` | Playwright full-stack E2E (futó stacket igényel) |
| `npm run e2e:install` | A Playwright Chromium, Firefox és WebKit letöltése |
| `npm run e2e:a11y` | Axe + keyboard/fókusz smoke a kritikus route-okon |
| `npm run e2e:responsive` | 360×800, 768×1024 és 1280×800 responsive smoke |
| `npm run e2e:cross-browser` | Firefox/WebKit publikus és keyboard smoke |
| `npm run e2e:report` | Az utolsó E2E futás HTML riportja |

A `verify` a gyors kapu: mockolt, külső függőség nélküli. Az `e2e` a valódi
Authentik + backend + Meilisearch A/B stacket használja, runbook:
[e2e/README.md](e2e/README.md).

A route-ok külön JavaScript chunkokba töltődnek. A build a mért Phase 7
baseline alapján 800 KiB teljes JS- és 64 KiB teljes CSS-keretet érvényesít;
ennek túllépése hibával állítja meg a kaput. A minőségi állapot- és security
mátrix: [../FRONTEND-QUALITY-MATRIX.md](../FRONTEND-QUALITY-MATRIX.md),
[../SECURITY-REVIEW.md](../SECURITY-REVIEW.md).

## Megjegyzés

Amíg `FEATURE_IDENTITY=off`, az `/admin` 503. Nincs actor-header bypass.
A 401 egyszeri session-megújítást vált ki, és csak idempotens GET kerül egyszer
újraküldésre; mutáció soha. A 403 megtartja a sessiont, az identity 503 pedig
helyben újrapróbálható, nem indít login loopot.
A tartalomlista nem mutat félrevezető összesített találatszámot: stabil
`updatedAt, id` cursorral lapoz. A szerkesztő csak a dirty mezőket küldi, a 409
verziókonfliktus pedig explicit szerververzió-betöltést vagy kézi újraalkalmazást
kér; automatikus overwrite és mutation retry nincs.
A Search és Processing API M3/M4 óta implementált. Kikapcsolt feature vagy
elérhetetlen függőség esetén a problem+json üzenet jelenik meg.
A publikus keresés teljes `q/category/limit/offset` állapota bookmarkolható
URL-ben él. A lista az index becslését és az oldal tényleges találatait külön
mutatja, a publikus detail pedig nem renderel adminmezőket. Publish/withdraw után
a szerkesztői detail korlátozott katalógus-láthatósági ellenőrzést indít; ez
háttértabon szünetel, és a timeout nem minősíti sikertelennek a lifecycle műveletet.

Az operációs dashboard a keresés összesített állapotát kizárólag az A/B
`routeEligible` mezőkből számolja. Normál állapotban 10, aktív feldolgozáskor 2
másodpercenként frissít, háttértabon leáll, hálózati/503 hiba után legfeljebb 30
másodperces backoffot használ, és a legutóbbi sikeres snapshotot elavultként
megőrzi. A 401/403 leállítja a pollingot.

## API-szerződés

A commitolt `../contracts/backend.openapi.json` snapshotból generált TypeScript
típusok a `src/api/generated/backend.ts` fájlban élnek. Frissítés:

```bash
cd ../backend && npm run openapi:emit
cd ../frontend && npm run contracts:generate
```

A normál frontend build nem igényel futó backendet. A React Compiler az
`@vitejs/plugin-react` hivatalos Babel presetjén keresztül, automatikus
(`infer`) módban fut. A `npm run verify` a contract drift, a build, a compiler
kimenet, a lint és a tesztek ellenőrzését is elvégzi.
