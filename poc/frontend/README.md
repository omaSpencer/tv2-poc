# IndaPlay / TV2 PoC – API playground

Vite + React + TanStack Query kliens a NestJS backend mellé. Demó- és
kipróbálófelület, nem termelési CMS. A terv: [../FRONTEND.md](../FRONTEND.md).

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

A Vite a `/api/*` hívásokat a backend originre továbbítja (`/api` prefix nélkül),
így a böngészőnek nem kell CORS-t kezelnie.

## Parancsok

| Parancs | Mit csinál |
| --- | --- |
| `npm run dev` | Fejlesztői szerver + proxy |
| `npm run build` | TypeScript ellenőrzés + production bundle |
| `npm run preview` | A buildelt bundle helyi előnézete |
| `npm run lint` | oxlint a `src` fán |

## Jelenlegi felület

- Állapotsáv: live / ready, API base, correlation id, OpenAPI link
- Katalógus: `GET /catalog/contents/:id` + problem+json megjelenítő
- Admin: placeholder — `FEATURE_IDENTITY=off` mellett az `/admin` 503

M2 után jön a PKCE belépés és a szerkesztői életciklus a UI-ból.
