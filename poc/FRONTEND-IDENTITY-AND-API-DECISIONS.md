# Frontend identity- és UI-glue API-döntések

2026-09-16 · A Fázis 1–2 előtt rögzített szerződés.

Kapcsolódó roadmap: [FRONTEND-IMPLEMENTATION-PLAN.md](FRONTEND-IMPLEMENTATION-PLAN.md).

## 1. Döntés státusza

Ez a dokumentum lezárja a két, implementációt érdemben befolyásoló nyitott
kérdést:

1. hogyan jelentkezik be a böngészős frontend a meglévő Authentik providerhez;
2. milyen read API kell az UUID-másolás nélküli szerkesztői workspace-hez.

A döntések implementálva és az integrált valódi Authentik L2 kapun igazolva
vannak. A mockolt tesztek mellett a böngészős login/renew/reload/logout út is
zöld.

## 2. Böngészős OIDC / PKCE szerződés

| Téma | Rögzített döntés |
| --- | --- |
| Flow | OAuth 2.0 Authorization Code + PKCE, `S256` |
| Kliens típusa | Public client; böngészőben nincs client secret |
| Client ID | A meglévő `poc-backend` marad a PoC-ban |
| Issuer | `http://127.0.0.1:9000/application/o/poc-backend/` helyi alapértékkel, env-ből |
| Scope | `openid profile offline_access poc-aud` |
| API audience | `poc-backend-api`; a backend ezt ellenőrzi |
| Redirect URI | `http://127.0.0.1:5173/auth/callback` |
| Post-logout URI | `http://127.0.0.1:5173/login` |
| Silent redirect URI | `http://127.0.0.1:5173/auth/silent-callback` |
| Könyvtár | `oidc-client-ts`, lockfile-ban rögzítve |
| OIDC user tárolása | Memória (`MemoryStateStore`); a `sessionStorage` csak a redirect PKCE state/verifier |
| Megújítás | Ugyanazon az oldalon a memóriában lévő refresh token; reload után Authentik `prompt=none` a `/auth/silent-callback` route-on |
| Alkalmazásjog forrása | Kizárólag `GET /me`; a frontend nem számol jogot token claimből |
| Kézi token | Csak `VITE_ALLOW_MANUAL_TOKEN=true` mellett, fejlesztői jelzéssel |
| Tokenmegjelenítés | A normál UI, log, toast és hibapanel soha nem mutat access/refresh/ID tokent |

### 2.1 Authentik blueprint-változás

A meglévő public provider marad. A strict redirect allowlist három eleme:

```text
http://127.0.0.1:8765/callback
http://127.0.0.1:5173/auth/callback
http://127.0.0.1:5173/login
http://127.0.0.1:5173/auth/silent-callback
```

Az első a meglévő CLI bizonyító kliensé, a második a SPA callbackje, a harmadik a
post-logout cél, a negyedik a hidden iframe silent restore. A silent URI-t a
BE-F5 Authentik blueprint adja; az integrált böngészős silent-recovery és
post-logout gate zöld. Wildcard, regex, `localhost` alias és tetszőleges port
nem engedélyezett. Ha az IdP nem redirectel automatikusan, a frontend a helyi
sessiont akkor is azonnal törli.

### 2.2 Frontend env-szerződés

```text
VITE_OIDC_ISSUER_URL=http://127.0.0.1:9000/application/o/poc-backend/
VITE_OIDC_CLIENT_ID=poc-backend
VITE_OIDC_REDIRECT_URI=http://127.0.0.1:5173/auth/callback
VITE_OIDC_POST_LOGOUT_REDIRECT_URI=http://127.0.0.1:5173/login
VITE_OIDC_SILENT_REDIRECT_URI=http://127.0.0.1:5173/auth/silent-callback
VITE_ALLOW_MANUAL_TOKEN=false
```

Production Docker ARG (publikus; a Codex BE-F5 Compose overlay ezeket a neveket
köti, nem átnevezhetők): `VITE_API_BASE`, `VITE_OIDC_ISSUER_URL`,
`VITE_OIDC_CLIENT_ID`, `VITE_OIDC_REDIRECT_URI`,
`VITE_OIDC_POST_LOGOUT_REDIRECT_URI`, `VITE_OIDC_SILENT_REDIRECT_URI`,
`VITE_ALLOW_MANUAL_TOKEN`. A `VITE_BACKEND_ORIGIN` nem production ARG.

Minden `VITE_*` érték bundle-public; titok nem lehet benne. A
`VITE_BACKEND_ORIGIN` kizárólag a Vite fejlesztői proxy célja, nem production
browser secret és nem a SPA runtime API-címe. Productionben az API és a docs
link relatív `/api` alapot használ a same-origin ingress miatt.

A OIDC issuer és client ID kötelező az auth bekapcsolásához. A
redirect értékeknek legyen biztonságos helyi alapértéke, de production buildben
explicit env szükséges, a silent redirectdel együtt. A frontend induláskor csak a
konfiguráció alakját ellenőrzi; discovery hálózati hiba külön runtime állapot.
A manuális token escape hatch productionben build/config hiba.

### 2.3 Session állapotgép

```text
bootstrapping
  -> anonymous
  -> authenticating -> callback -> loading_me -> authenticated
  -> renewing -> authenticated
  -> expired -> anonymous
  -> identity_unavailable (újrapróbálható)
```

- Callback előtt a könyvtár ellenőrzi a `state`, `nonce` és PKCE verifier adatot.
- A callback URL queryje siker után `replace` navigációval eltűnik.
- Authenticated állapot csak sikeres OIDC user + sikeres `/me` után létezik.
- `401 unauthenticated`: egyszeri renew kísérlet, utána local session clear és login.
- `403 forbidden`: a session érvényes marad, jogosultsági képernyő jelenik meg.
- `503 dependency_unavailable`: nincs login loop; újrapróbálható IdP/backend állapot.
- Subject-váltás vagy logout törli a teljes user-függő TanStack Query cache-t.
- Több tab közti azonnali kijelentkeztetés nem követelmény: a user memóriában él.
- Bootstrap: memória-user, majd silent `prompt=none`. `login_required` anonim;
  dependency hiba `identity_unavailable`. A login oldal nem indít redirect-loopot.

### 2.4 Authentik L2 elfogadás

Mindhárom felhasználóval (`poc-viewer`, `poc-editor`, `poc-publisher`) valódi
böngészős login kell. Igazolni kell:

- callback és state/nonce/PKCE siker;
- access token `aud=poc-backend-api` és `/me` 200;
- helyes role/permission lista;
- 5 perces access token megújítása oldalfrissítés nélkül;
- oldalfrissítés után session visszaállítása;
- logout után OIDC user, token és user-cache törlése;
- hibás issuer/audience és IdP-kiesés nem okoz redirect loopot.

## 3. `GET /admin/contents` szerződés

### 3.1 Hozzáférés és query

- permission: `content:read`;
- query:
  - `q?: string`, trim után 1–200 karakter;
  - `status?: draft | published | withdrawn`;
  - `category?: film | sorozat | hir | sport | szorakozas | egyeb`;
  - `limit?: integer`, alapérték 20, minimum 1, maximum 100;
  - `cursor?: string`, opaque base64url token;
- ismeretlen vagy ismételt query paraméter `422 validation_failed`;
- hibás mezőnél `fields` a query kulcsát tartalmazza.

A `q` case-insensitive részszöveges keresés a `title` és `slug` mezőn. Ha a
teljes érték UUID, az `id` pontos egyezése is találat. SQL wildcardot a backend
escape-el; a kliens nem adhat nyers mintát.

### 3.2 Rendezés és cursor

Rendezés mindig:

```text
updated_at DESC, id DESC
```

A cursor verziózott, de a kliens számára opaque base64url JSON:

```json
{"v":1,"updatedAt":"2026-09-16T08:30:00.000Z","id":"uuid"}
```

A következő oldal predikátuma lexikografikusan az előző utolsó sor alatti
rekordokat választja. A backend `limit + 1` sort olvas, a plusz sort nem adja
vissza. Nincs teljes `total`: cursoros listánál az drága és módosulás közben
félrevezető lenne.

### 3.3 Válasz

```ts
type AdminContentListItem = {
  id: string;
  title: string;
  slug: string | null;
  category: ContentCategory | null;
  status: ContentStatus;
  version: number;
  updatedAt: string;
  updatedBy: string;
  publishedAt: string | null;
};

type AdminContentListView = {
  items: AdminContentListItem[];
  nextCursor: string | null;
};
```

Üres találat `200 { items: [], nextCursor: null }`. A lista nem ad summaryt,
media asset ID-t, tageket, auditot vagy teljes content payloadot; ezek detailből
jönnek.

## 4. `GET /admin/contents/:id/audit` szerződés

### 4.1 Hozzáférés és query

- permission: `content:read`;
- az `id` UUID, hibás alak `422 validation_failed`, `fields=['id']`;
- nem létező content `404 content_not_found`;
- query:
  - `limit?: integer`, alapérték 50, minimum 1, maximum 100;
  - `cursor?: string`, opaque base64url token;
- ismeretlen/ismételt query `422 validation_failed`.

### 4.2 Rendezés és válasz

Rendezés `content_version DESC`. Cursor payload:

```json
{"v":1,"contentVersion":6}
```

Válasz:

```ts
type ContentAuditView = {
  id: string;
  contentVersion: number;
  action: 'created' | 'updated' | 'published' | 'withdrawn';
  actorSub: string;
  actorRoles: Array<'viewer' | 'editor' | 'publisher'>;
  occurredAt: string;
  correlationId: string;
  changedFields: Array<
    'title' | 'slug' | 'summary' | 'category' | 'mediaAssetId' | 'tags' | 'status'
  >;
};

type ContentAuditListView = {
  items: ContentAuditView[];
  nextCursor: string | null;
};
```

A válasz nem tartalmaz request body-t, előző/új mezőértéket, tokent, event
payloadot vagy outbox adatot. A correlation ID megjelenhet másolható technikai
részletként.

## 5. Backend implementációs szabályok

- A két endpoint új read modell, nem írhat tartalmat és nem indíthat eventet.
- A query normalizálás egyetlen Zod-alapú útvonalon történjen, a search contract
  mintájára; a controller ne tartson második validációs szabályrendszert.
- A cursor dekódolása bármilyen alakhibára `422`, nem 500.
- A repository paraméterezett Drizzle kifejezést használjon.
- Lista és audit olvasási DB-hibára `503 dependency_unavailable`.
- Az audit előbb ellenőrzi a content létezését, így üres audit nem téveszthető
  össze nem létező tartalommal.
- Mindkét válasz kapjon Zod/OpenAPI sémát és generált frontend típust.
- A `ROUTE_MATRIX` két új sora `content:read` hozzáférésű.
- A meglévő lifecycle contract és permission kiosztás nem változik.

## 6. Elutasított alternatívák

| Alternatíva | Miért nem ezt választjuk? |
| --- | --- |
| Token claimből számolt permission | Megkettőzné és könnyen elsodorná a backend jogosultsági szabályát |
| Token `localStorage`-ban | Indokolatlanul tartós és minden tabra kiterjedő hozzáférés |
| Token `sessionStorage`-ban productionben | XSS után tartós tokenlopás; a PoC SPA memória-only + CSP-t választ |
| Implicit flow | Nincs PKCE code exchange, modern SPA-hoz nem elfogadható |
| Új BFF/session-cookie réteg | A PoC resource-server architektúrájához képest túl nagy új scope; W5 a SPA-t tartja |
| Offsetes admin lista | Módosuló adatoknál duplikált/kihagyott sorokat adna |
| Teljes `total` count | A UI nem igényli, a lekérdezést drágítja és gyorsan stale lesz |
| Audit értékdiffekkel | A jelenlegi audit nem tárol értékeket; új adatvédelmi és tárolási scope lenne |
| Kliensoldali UUID-regiszter | Nem többfelhasználós, nem tartós, és elrejtené a hiányzó backend listát |

## 7. Definition of Ready

- [x] PKCE flow, client, scope, redirect és session store rögzített.
- [x] `/me` mint kizárólagos permission-forrás rögzített.
- [x] 401/403/503 auth viselkedés elkülönített.
- [x] Content lista query, sorrend, cursor és response rögzített.
- [x] Audit query, sorrend, cursor és response rögzített.
- [x] Permission, hibák és adatminimalizálás rögzített.
- [ ] Authentik L2 környezet ténylegesen elérhető és blueprint alkalmazva.
