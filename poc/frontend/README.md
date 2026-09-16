# IndaPlay / TV2 PoC – API playground

Vite + React + TanStack Query + React Router kliens a NestJS backend mellé.
Demó- és kipróbálófelület, nem termelési CMS. A high-level háttér:
[../FRONTEND.md](../FRONTEND.md); az aktuális, nyolcfázisú végrehajtási roadmap:
[../FRONTEND-IMPLEMENTATION-PLAN.md](../FRONTEND-IMPLEMENTATION-PLAN.md).

## Előfeltétel

Futó backend a `VITE_BACKEND_ORIGIN` címen (alap: `http://127.0.0.1:3000`).
Lásd [../backend/README.md](../backend/README.md).

## Indítás

```bash
cd poc/frontend
cp .env.example .env   # ha még nincs
npm install
npm run dev
```

Böngésző: [http://localhost:5173](http://localhost:5173).

A Vite a `/api/*` hívásokat a backend originre továbbítja (`/api` prefix nélkül).

## Route-ok

| Útvonal | Screen | Backend milestone |
| --- | --- | --- |
| `/` | Kezdőlap / térkép | — |
| `/auth` | Bearer token, `/me`, PKCE hely | M2 |
| `/editorial` | Draft / patch / publish / withdraw | M1+M2 |
| `/catalog` | Publikus részlet | M1 |
| `/search` | Katalóguskeresés | M4 |
| `/processing` | Outbox / processing-status | M3 |
| `/demo` | Életciklus lépésenként + negatív esetek | M2+ |

Az aktív content UUID és a Bearer token `sessionStorage`-ban él a screenek között.

## Parancsok

| Parancs | Mit csinál |
| --- | --- |
| `npm run dev` | Fejlesztői szerver + proxy |
| `npm run build` | TypeScript ellenőrzés + production bundle |
| `npm run preview` | A buildelt bundle helyi előnézete |
| `npm run lint` | oxlint a `src` fán |

## Megjegyzés

Amíg `FEATURE_IDENTITY=off`, az `/admin` 503. Nincs actor-header bypass.
A Search és Processing API M3/M4 óta implementált. Kikapcsolt feature vagy
elérhetetlen függőség esetén a problem+json / MilestoneGate üzenet jelenik meg.

## API-szerződés

A commitolt `../contracts/backend.openapi.json` snapshotból generált TypeScript
típusok a `src/api/generated/backend.ts` fájlban élnek. Frissítés:

```bash
cd ../backend && npm run openapi:emit
cd ../frontend && npm run contracts:generate
```

A normál frontend build nem igényel futó backendet. A `npm run verify` contract
driftet, buildet és lintet ellenőriz.
