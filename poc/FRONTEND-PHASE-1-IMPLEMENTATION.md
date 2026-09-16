# Frontend Fázis 1 – Alkalmazásváz és valódi identity

2026-09-16 · Ticket-szintű implementációs specifikáció.

Kapcsolódó döntések:
[FRONTEND-IDENTITY-AND-API-DECISIONS.md](FRONTEND-IDENTITY-AND-API-DECISIONS.md).

## 1. Cél és határ

A felhasználó Authentikkal jelentkezik be, a frontend stabil session
állapotgéppel indul, a route-ok és műveletek a backend `/me` permissionjeire
épülnek, és egységes hiba/értesítési felület jön létre.

Nem része: content lista/detail újratervezése, admin list/audit backend endpoint,
operátori mutáció, végleges design system vagy felhasználókezelés.

## 2. Munkacsomagok sorrendben

### P1-01 — Függőségek és env-validáció

Érintett:

- `frontend/package.json`, lockfile: `oidc-client-ts`;
- `frontend/src/config/env.ts`;
- `frontend/.env.example`, README.

Feladat:

- az identity env-k egy helyen normalizálódnak;
- trailing slash issuer megtartása, abszolút http(s) URL ellenőrzése;
- hiányos config nem dob render közbeni kivételt: `unconfigured` auth állapotot ad;
- production build explicit redirect URI nélkül bukjon konfigurációs ellenőrzésen;
- a manual token alapértéke false.

Elfogadás: hibás URL és hiányos pár célzott, secretmentes konfigurációs üzenetet
ad; a build nem éget be tokent vagy jelszót.

### P1-02 — Authentik blueprint és frontend redirect

Érintett:

- `backend/authentik/blueprints/poc.yaml`;
- Authentik login/runbook dokumentáció.

Feladat:

- strict SPA callback felvétele a CLI callback mellé;
- wildcard tiltva;
- a provider továbbra is public és RS256 signing keyt használ;
- a meglévő CLI login flow nem regresszál.

Elfogadás: blueprint parse/alkalmazás sikeres elérhető L2 környezetben; CLI és
SPA redirectet elfogad, más redirectet elutasít.

### P1-03 — OIDC kliensadapter

Új modulok:

```text
frontend/src/auth/
  oidc.ts
  authTypes.ts
  AuthProvider.tsx
  authContext.ts
```

Az adapter publikus felülete:

```ts
type AuthState =
  | { kind: 'bootstrapping' }
  | { kind: 'anonymous' }
  | { kind: 'authenticating' }
  | { kind: 'loading_me' }
  | { kind: 'authenticated'; accessToken: string; me: MeView }
  | { kind: 'renewing'; me: MeView | null }
  | { kind: 'expired' }
  | { kind: 'identity_unavailable'; error: unknown };
```

Műveletek: `login(returnTo?)`, `completeCallback()`, `logout()`, `retry()`, és
dev flag mellett `setManualToken()`.

Szabályok:

- a provider komponens nem exportál raw tokent megjelenítésre;
- az API kliens token provider callbackből kap tokent;
- OIDC library eventek (`userLoaded`, `userUnloaded`, `accessTokenExpiring`,
  `silentRenewError`) egy determinisztikus reducerbe futnak;
- callback kétszeri feldolgozása Strict Mode-ban idempotens;
- `returnTo` csak belső, `/`-rel kezdődő route lehet.

### P1-04 — Callback és logout route

Route-ok:

- `/login`;
- `/auth/callback`;
- opcionális belső `/auth/logout-complete`, ha az L2 provider ezt igényli.

Callback UX:

- feldolgozás közben fókuszolható „Beléptetés folyamatban” állapot;
- siker után `replace(returnTo || '/')`;
- OIDC `error` paraméterből felhasználóbarát hiba, token/state nélkül;
- retry vissza a login oldalra;
- callback query nem maradhat historyban.

Logout először törli a helyi OIDC usert és cache-t, majd ha discovery ad
end-session endpointot, IdP logoutot indít. IdP logout hiba nem állíthatja vissza
a helyi sessiont.

### P1-05 — `/me` bootstrap és cache-életciklus

- OIDC user betöltése után `GET /me` kötelező;
- query key nem tartalmazhat tokent;
- cache csak memóriában él;
- subject-váltás és logout `queryClient.clear()` vagy névterezett teljes user
  invalidáció;
- 401-re legfeljebb egy renew + `/me` retry;
- mutation nincs automatikusan újraküldve;
- 503 esetén explicit retry, nincs redirect.

Elfogadás: nincs jogosulatlan tartalom-felvillanás bootstrapping alatt és nincs
végtelen renew/login ciklus.

### P1-06 — API kliens auth integráció

A jelenlegi `apiRequest` kapjon központi token-hozzáférést vagy wrapper
injektálást. Endpoint wrapper ne fogadjon minden komponensből kézzel tokent.

- `Authorization` csak nem üres access tokennel;
- public hívás anonymous állapotban header nélkül megy;
- jelen lévő, de lejárt usernél előbb session rendezés, nem hibás token kiküldése;
- correlation ID kezelés változatlan;
- hibákban request header/body nem logolódik.

### P1-07 — Route és action guardok

Komponensek:

- `RequireAuth`;
- `RequirePermission`;
- `PermissionAction` vagy közös disabled-reason helper.

Viselkedés:

- bootstrapping/loading állapot skeleton;
- anonymous route esetén `/login?returnTo=...`;
- hiányzó permission 403-barát oldal, nem redirect loop;
- action lehet disabled és magyarázott, hogy a felhasználó értse a hiányzó jogot;
- a guard UX-segéd, a backend marad biztonsági határ.

### P1-08 — Route-térkép és role-aware navigáció

Az új app-router legalább:

```text
/
/login
/auth/callback
/contents
/contents/new
/contents/:id
/contents/:id/edit
/catalog/search
/catalog/:id
/operations
/demo
```

A még nem implementált oldalak kontrollált placeholdert vagy a meglévő
playground képernyő átmeneti adapterét kapják. Navigáció:

- publikus link mindenkinél;
- content workspace csak `content:read`/`content:write` esetén;
- operations csak `ops:read` esetén;
- belépés/kilépés session szerint;
- URL közvetlen megnyitása ugyanúgy guardolt, mint a menü.

### P1-09 — Egységes problem és notification réteg

- `ProblemDetails`: code alapján emberi cím, detail, opcionális fields;
- correlation ID másolható disclosure-ben;
- toast/live region sikeres mutationhöz és rövid hibához;
- oldalszintű hiba megmarad navigáció után olvashatónak;
- 401, 403, 404, 409, 413, 422, 503 és network error külön állapot;
- token, raw OIDC error response és secret nem renderelődik.

### P1-10 — Manual token dev út

- kizárólag `VITE_ALLOW_MANUAL_TOKEN=true` buildben;
- külön „Fejlesztői token” disclosure;
- production/normál build DOM-jában sincs textarea;
- manual session is `/me`-vel validálódik;
- OIDC és manual mód egyidejűleg nem lehet aktív;
- kilépés ugyanúgy törli a user-cache-t.

### P1-11 — Tesztek

Unit/component esetek:

1. env normalization és invalid config;
2. callback success/error és kétszeri mount;
3. safe/unsafe `returnTo`;
4. `/me` success → authenticated;
5. 401 → egy renew, majd success;
6. második 401 → clear + login;
7. 403 nem logout;
8. 503 nem redirect;
9. permission guard minden állapota;
10. logout/cache clear;
11. manual token flag off/on;
12. semmilyen snapshot/log nem tartalmaz tokent.

MSW/fake OIDC adapter használható. A library internals helyett a saját adapter
viselkedését teszteljük.

### P1-12 — L2 full-stack ellenőrzés

Futtatási mátrix:

| Identitás | `/me` | Elvárt navigáció |
| --- | --- | --- |
| viewer | role viewer, permission `[]` | publikus oldalak; admin magyarázottan tiltott |
| editor | read/write | contents látható, operations/publish tiltott |
| publisher | read/write/publish/ops:read | contents és operations látható |

Külön: refresh, hard reload, logout, rossz audience, lejárt token, IdP leállás,
backend 503. Az eredmény frissíti az M2 L2 evidence-t; pending nem írható passra
csak mock teszt alapján.

## 3. Függőségi sorrend

```text
P1-01 -> P1-03 -> P1-04 -> P1-05 -> P1-06
              \-> P1-07 -> P1-08 -> P1-09 -> P1-11
P1-02 ---------------------------------------> P1-12
P1-10 ---------------------------------------> P1-11
```

P1-01 és P1-02 párhuzamosítható. P1-12 az egyetlen kötelezően külső
Authentik-függő csomag.

## 4. Becslés

| Csomag | Becslés |
| --- | ---: |
| P1-01–04 | 1.25–1.75 nap |
| P1-05–08 | 1.25–1.75 nap |
| P1-09–11 | 1–1.5 nap |
| P1-12 + evidence | 0.5 nap, ha L2 elérhető |
| **Összesen** | **4–5.5 mérnöknap** |

## 5. Definition of Done

- [ ] Valódi PKCE login működik mindhárom tesztidentitással.
- [ ] A session refresh és hard reload után helyreáll.
- [ ] `/me` az egyetlen permission-forrás.
- [ ] Nincs route flash és login loop.
- [ ] Logout törli az OIDC usert, tokent és user-cache-t.
- [ ] Manual token normál buildben nincs jelen.
- [ ] 401/403/503 külön UX.
- [ ] Route és action guard tesztelt.
- [ ] Frontend build, lint, unit/component suite zöld.
- [ ] Authentik L2 evidence frissült valós futással.

