# M2 futtatási jegyzőkönyv

2026-09-15 · Identity resource-server (OIDC / Authentik) + L1 bizonyítás.

## Környezet

| Elem | Érték |
| --- | --- |
| Node | 24.20.x |
| PostgreSQL | 17 (`TEST_DATABASE_URL` / `_test` marker) |
| `jose` | 6.2.12 |
| Authentik image | `ghcr.io/goauthentik/server:2025.8@sha256:f162a2664fc54337be65f796130443e19d038caa82be572b7d44aa8b1a895af2` |

## Parancsok

```bash
npm ci && npm run build
npm run test:integration:m2
npm run test:integration:m1   # regresszió (T20 cseréje dokumentált)
npm run test:integration:m3
```

## L1 eredmény (mock JWKS)

| Próba | Állapot |
| --- | --- |
| M2-T01 – hiányzó OIDC kulcsok | pass |
| M2-T02 / T02b – identity on, admin 401 + WWW-Authenticate | pass |
| M2-T03 – discovery / JWKS URI eltérés → 503 | pass |
| M2-T04 – `/me` | pass |
| M2-T05 – viewer | pass |
| M2-T06 – editor | pass |
| M2-T07 – publisher | pass |
| M2-T08 – lejárati tolerancia | pass |
| M2-T09–T13 – issuer/aud/aláírás/alg/ID token | pass |
| M2-T14–T16 – JWKS cache / IdP kiesés | pass |
| M2-T17 – audit actor a tokenből | pass |
| M2-T18 – nincs forged identity a `dist/`-ben | pass |
| M2-T19 – üres/ismeretlen groups | pass |
| M2-T23 – correlation ID | pass (L1 ág) |

`npm run test:integration:m2` → 18/18 pass.

## L2 eredmény (valódi Authentik)

| Próba | Állapot | Megjegyzés |
| --- | --- | --- |
| M2-T20 – három identitás PKCE | **pending** | E01–E05 |
| M2-T21 – token élettartam / refresh | **pending** | E05 |
| M2-T22 – csoportváltozás / key rotation | **pending** | átadva M5-nek is |
| M2-T23 – L2 log ág | **pending** | E02 |

A blueprint (`authentik/blueprints/poc.yaml`) és a Compose mount / bootstrap
kulcsok készen állnak. Image húzás és első sikeres blueprint-alkalmazás E01
után. `demo:m2` valódi `OIDC_ACCESS_TOKEN` nélkül pending kóddal lép ki, nem
hamis sikerrel.

## Konfiguráció

- `FEATURE_IDENTITY=on` → `OIDC_ISSUER_URL` + `OIDC_AUDIENCE` kötelező
- Audience: `poc-backend-api` (access token); client_id: `poc-backend` (ID token elutasítva)
- Csoportok: `poc-viewer` / `poc-editor` / `poc-publisher` → `ROLE_GROUPS`

## M0–M1 érintés

- M1 T20 („identity on adapter nélkül → fail”) helyett M2-T01/T02
- `smoke:m0` 5.2: az „adapter nélkül” ág eltávolítva
- Identity off mellett az `/admin` prefix-503 változatlan

## Lezárás

| Szint | Állapot |
| --- | --- |
| L1 (tokenellenőrzés, jogmátrix, audit) | **kész** |
| L2 (valódi Authentik kapu) | **pending** (E01–E05) |
| M2 milestone lezárás | **nyitott** amíg L2 nem fut |

Az L1 önmagában nem zárja le az M2 milestone-t a terv szerint; a hiányzó
külső előfeltételeket nem jelöljük sikernek.
