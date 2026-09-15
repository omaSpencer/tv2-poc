# IndaPlay / TV2 PoC – API playground

Vite + React + TanStack Query + React Router kliens a NestJS backend mellé.
Demó- és kipróbálófelület, nem termelési CMS. A terv: [../FRONTEND.md](../FRONTEND.md).

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
A Search/Processing UI a M3/M4 bekötés előtt is megnyitható; a hiányzó API
problem+json / MilestoneGate üzenettel jelenik meg.
