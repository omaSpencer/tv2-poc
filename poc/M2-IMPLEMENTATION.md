# M2 – Valódi identitás és szerkesztői jogosultság: részletes implementációs terv

2026-09-15 · Claude · Rögzített terv.

**Státusz: nincs implementálva.** A checklist teljesítendő, futási bizonyíték nincs. Ez a dokumentum az M0 és M1 implementációs terv szerkezetét követi: rögzített szerződés, tervezett séma/illesztés, feladatlebontás becsléssel, számozott ellenőrzési terv, lezárási lista.

Kiindulópont: [README](README.md), [milestone-terv](MILESTONES.md), [fázisterv](PHASES.md), [döntésnapló](DECISIONS.md), [M0-terv](M0-IMPLEMENTATION.md), [M1-terv](M1-IMPLEMENTATION.md) és az [M0–M1 futtatási jegyzőkönyv](M0-M1-EVIDENCE.md).

## 1. Szállítandó eredmény és belépési feltételek

M2 végén ugyanaz az M1-ben bizonyított tartalomciklus valódi Authentik-belépéssel és ellenőrzött access tokennel járható végig. A `res.locals.actor` forrása többé nem a teszt-összeállítás, hanem egy aláírás-, issuer-, audience- és lejáratellenőrzésen átment JWT. Az `/admin` prefix nem prefix-503-mal záródik, hanem a hiányzó hitelesítés `401`, a hiányzó jog `403` válaszával.

| Szükséges M0/M1-eredmény | Miért szükséges? | Hol van? |
| --- | --- | --- |
| Route/permission mátrix és szerepleképezés | Az ellenőrzött claim ide köt be | `src/contracts/permissions.ts` |
| Actor kontextus és `operationContext` | A service-réteg explicit actort vár | `src/identity/actor.ts` |
| `PermissionGuard` és `RequirePermission` | A jogszabályok készen állnak, csak az actor forrása cserélődik | `src/content/permission.guard.ts` |
| `requestBoundary` `blockAdmin` kapcsolója | Az adminblokkolás dokumentált cserepontja | `src/http.ts` |
| Problem+json hibakódok `unauthenticated` / `forbidden` értékkel | 401/403 már a szerződés része | `src/contracts/errors.ts` |
| Feature flag és OIDC konfigurációs kulcsok helye | `FEATURE_IDENTITY`, `OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI` | `src/config.ts`, `.env.example` |
| Authentik full Compose definíció | A provider futtatható helyben | `compose.yaml`, `--profile full` |
| Tranzakciós CMS T01–T23 bizonyítékkal | M2 nem az üzleti szabályt, hanem a hozzáférést bizonyítja | [jegyzőkönyv](M0-M1-EVIDENCE.md) |

Egyetlen M1-próba **szándékosan újradefiniálódik**: a T20 („identity on, ellenőrző adapter nincs → indítási hiba") azért állt fenn, mert nem létezett adapter. M2 megépíti azt, tehát a T20 helyébe az M2-T01 (hiányzó kulcsok) és az M2-T02 (teljes konfiguráció, elinduló app) lép. Ez tervezett csere, nem regresszió; minden más M1-próba változatlanul érvényes.

**Külső előfeltételek:** E02 (futtatható Authentik), E03 (tényleges issuer/audience/JWKS), E04 (három tesztidentitás és csoportleképezés), E05 (tényleges token-élettartamok) a [külső előfeltételek jegyzékében](backend/docs/external-access.md) nyitott. Ezek az M2 valódi tokenes kapuját blokkolják, a determinisztikus tokenellenőrzési próbákat nem – lásd a 7. szakasz kétszintű bizonyítási rendjét. Az E01 (konténerregiszter-elérés) hiánya az Authentik image húzását is blokkolja, tehát gyakorlatilag E02 előfeltétele.

**Nem M2 feladata:** saját jelszókezelés, felhasználókezelő UI, session cookie, előfizetési vagy lejátszási jogosultság. A backend tiszta resource server: nem tárol munkamenetet és nem végez tokencserét. A böngészős Authorization Code + PKCE folyamat a kliens, illetve a bizonyító script dolga. A signing-key rotáció és az IdP-kiesés **végleges** bizonyítéka a MILESTONES szerint M5, M2-ben a kulcsmegismerés és a cache-viselkedés készül el. A `GET /admin/processing-status` route M3 feladata; M2 csak az `ops:read` permissiont tartja a mátrixban. A PHASES M2-mátrixa a „feldolgozási állapot olvasása" sort az M2 jogosultsági táblájába teszi – ez **jogosultsági** döntés, és teljesül: a permission és a szerephez rendelése M2-ben rögzített és tesztelt, csak a végpont maga készül M3-ban, összhangban a `ROUTE_MATRIX` `milestone: 'M3'` jelölésével.

## 2. Rögzített M1–M2 szerződés

| Döntés | M2 döntés | Átvétel / pontosítás |
| --- | --- | --- |
| D-M0-08 / D06 – szerepek | viewer: semmilyen content permission; editor: `content:read` + `content:write`; publisher: ezek + `content:publish` + `ops:read` | A `ROLE_PERMISSIONS` tábla változatlan; M2 nem ír át jogot |
| D-M0-08 – csoportok | `poc-viewer`, `poc-editor`, `poc-publisher` Authentik-csoportok | A `ROLE_GROUPS` tábla az egyetlen leképezés; ismeretlen csoport figyelmen kívül marad |
| D-M0-08 – claim | **Pontosítás:** a D-M0-08 „permissions és roles claim" megfogalmazása helyett a jogforrás a csoporttagság (`groups` claim) | A D-M0-08 a konkrét mappinget kifejezetten M2-re bízza. A lényeg változatlan: scope nem ad jogot, a permission a csoport → szerep → jog láncból származik |
| D-M0-09 – hibák | Hiányzó/érvénytelen hitelesítés `401 unauthenticated`; hiányzó jog `403 forbidden` | 401 mellé `WWW-Authenticate: Bearer` fejléc (RFC 6750); a body marad problem+json |
| D-M0-06 – audit | Az audit `actor_sub` és `actor_roles` mezője a verifikált tokenből jön | A tárolt szerepnevek az **alkalmazás** nevei (`editor`), nem a csoportnevek (`poc-editor`) |
| D-M0-03 – konfiguráció | `FEATURE_IDENTITY=on` kötelezővé teszi az `OIDC_ISSUER_URL` és `OIDC_AUDIENCE` kulcsot | Megadott `OIDC_JWKS_URI` esetén annak egyeznie kell a discovery `jwks_uri` értékével |
| D-M0-03b – readiness | Az IdP hálózati kiesése nem rontja a `/health/ready` állapotot | A discovery/JWKS hibája az érintett kérésre `503 dependency_unavailable` |
| D06 – élettartam | Access token 5 perc, refresh session 1 óra, lejárati tolerancia legfeljebb 30 másodperc | A tényleges beállítható értéket tokenpróba igazolja (M2-02) |
| README – ID token | Az ID token nem használható API access tokenként | A szabály végrehajtója az audience-ellenőrzés, lásd 2.3 |
| D01 – gazdák | Identity/permission mapping és Authentik: Claude; alkalmazásmag, config és tesztfuttató: Codex | Kölcsönös review; a terv nem indít másik agentet |

### 2.1 Claim → szerep → permission

A token három claimje érdekes: `sub`, a csoportokat hordozó claim, és az `aud`. A leképezés egyetlen, tesztelt függvényben él (`src/identity/roles.ts`):

1. A csoportlista a token `groups` claimjéből jön. Nem lista, hiányzó vagy nem string elemeket tartalmazó érték esetén az elem kimarad; a claim teljes hiánya üres csoportlistát jelent, nem hibát.
2. Csoportnév → alkalmazásszerep a `ROLE_GROUPS` **inverzével**. Ismeretlen csoportnév csendben kimarad: az Authentikban létező más csoportok nem okoznak hibát és nem adnak jogot.
3. Szerep → permission a meglévő `permissionsForRoles` függvénnyel. Több szerep jogai egyesülnek.
4. Az `Actor.roles` a kapott alkalmazásszerepek determinisztikus (a `ROLES` tábla szerinti) sorrendben. Így az M1 audit `actor_roles` mezőjének jelentése nem változik, és a meglévő M1-próbák érvényben maradnak.

Kért OAuth scope önmagában nem ad jogot: a permission kizárólag a fenti láncból származhat. Szerep nélküli, de érvényes token azonosított felhasználó: `/me` kiszolgálja, minden adminművelet `403`.

A `sub` az Authentik `sub_mode` beállításából jön; a választott érték `hashed_user_id`. Ez stabil a felhasználó élettartamán át, és nem e-mail vagy felhasználónév. A `content.created_by`, `content.updated_by` és `content_audit.actor_sub` ezt tárolja.

### 2.2 Token-élettartam és visszavonási ablak

| Paraméter | Cél | Hol állítjuk | Hol igazoljuk |
| --- | --- | --- | --- |
| Authorization code | 1 perc | `access_code_validity: minutes=1` | M2-02 tokenpróba |
| Access token | 5 perc | `access_token_validity: minutes=5` | `exp - iat` mérése a kiadott tokenen |
| Refresh session | 1 óra | `refresh_token_validity: hours=1` | Refresh próba a lejárati határ előtt és után |
| Lejárati tolerancia | 30 másodperc | `OIDC_CLOCK_TOLERANCE_S`, felső korlát 30 | M2-T08 |
| Offline visszavonási ablak | Legfeljebb 5 perc 30 másodperc | Származtatott: access token + tolerancia | Számított és jegyzőkönyvezett érték |

A visszavonás offline JWT-ellenőrzésben nem azonnali: a már kiadott access token a lejáratáig érvényes marad. Nem vezetünk be introspection-hívást vagy visszavonási listát; a PoC ezt a késleltetést vállalja és dokumentálja. A refresh utáni jogváltozás külön próba: a csoporttagság módosítása az **új** access tokenben látszik, a régiben nem.

### 2.3 Elfogadott és elutasított token

Elfogadás feltételei, ebben a sorrendben:

1. `Authorization: Bearer <token>` fejléc, egyetlen szóközzel elválasztva, nem üres tokennel.
2. Kompakt JWS három szegmenssel; a fejléc `alg` értéke a megengedett halmazban (`RS256`). Az `alg: none` és minden szimmetrikus algoritmus elutasított, függetlenül attól, mit ír a token.
3. `kid` alapján feloldott aláírókulcs a discoveryből származó JWKS-ből, és érvényes aláírás.
4. `iss` pontos string-egyezés az `OIDC_ISSUER_URL` értékével.
5. `aud` tartalmazza az `OIDC_AUDIENCE` értéket (string vagy lista alak egyaránt).
6. `exp` és – ha jelen van – `nbf` a `OIDC_CLOCK_TOLERANCE_S` toleranciával érvényes. `iat` jövőbeli értéke ugyanezzel a toleranciával hibás.
7. `sub` nem üres string.

Bármelyik feltétel sérülése `401 unauthenticated`, azonos, részletet nem szivárogtató `detail` szöveggel. A hiba oka strukturált logba kerül (`event: 'token_rejected'`, `reason`), a token és a fejlécek nélkül.

**Az ID token elutasítása audience-alapú.** Az Authentik az ID token `aud` értékének a client_id-t adja. Ezért a provider `client_id` és az `OIDC_AUDIENCE` értéke **szándékosan két különböző string** (`poc-backend` és `poc-backend-api`), így az API-ra küldött ID token az 5. feltételen elbukik. A tényleges tokenpróba (M2-02) rögzíti a kiadott access és ID token teljes claimkészletét; ha az audience önmagában nem elég megkülönböztető, a szabály ott egészül ki, nem találgatásból.

## 3. Authentik konfiguráció

### 3.1 Forrás és reprodukálhatóság

Az Authentik-konfiguráció **verziózott blueprintből** jön, nem admin felületi kattintásokból. A blueprint a repóban él (`poc/backend/authentik/blueprints/poc.yaml`), és a full Compose az `authentik-server` és `authentik-worker` szolgáltatás `/blueprints/poc.yaml` útvonalára mountolja. Az Authentik a `/blueprints` fát automatikusan felfedezi, változásra újraalkalmazza, és rendszeres időközönként újra lefuttatja. ([Blueprints](https://docs.goauthentik.io/customize/blueprints/))

Az első indítás admin felhasználója az `AUTHENTIK_BOOTSTRAP_PASSWORD` és `AUTHENTIK_BOOTSTRAP_TOKEN` környezeti változókból jön; ezek az env fájlból, nem a compose fájlból származnak. Ez a két kulcs, valamint a 3.3-ban használt `AUTHENTIK_PUBLIC_URL` **új** Compose/env változó: jelenleg egyik sincs a `compose.yaml`-ben és a `.env.example`-ben, létrehozásuk az M2-01 feladat része. Alkalmazáskulcsok nem: a backend ezekből egyet sem olvas. A blueprint YAML csak nem titkos értéket tartalmaz verziózva: provider- és alkalmazásnév, slug, client_id, csoportnevek, scope-ok, élettartamok. A `client_secret` és a tesztidentitások jelszava környezeti változóból helyettesítődik be.

**Image-pin:** a jelenlegi `AUTHENTIK_IMAGE` alapérték `ghcr.io/goauthentik/server:2025.8`. Az aktuális stabil kiadás ennél újabb (a jegyzék készítésekor 2026.8.1), ezért M2-01 feladata a pin frissítése és – registryeléréssel – a digest rögzítése a `VERSIONS.md`-ben. A kiadásváltás a blueprint sémaverzióját is érintheti, ezért a frissítés és az első sikeres blueprint-alkalmazás egy feladat.

### 3.2 A blueprint tartalma

| Entitás | Model | Lényeges beállítás |
| --- | --- | --- |
| Csoportok | `authentik_core.group` | `poc-viewer`, `poc-editor`, `poc-publisher` |
| Tesztidentitások | `authentik_core.user` | `poc-viewer`, `poc-editor`, `poc-publisher`; jelszó env-ből; csoporttagság egyenként egy csoport |
| Audience scope mapping | `authentik_providers_oauth2.scopemapping` | `return {"aud": "poc-backend-api"}` |
| OAuth2 provider | `authentik_providers_oauth2.oauth2provider` | lásd alább |
| Alkalmazás | `authentik_core.application` | `slug: poc-backend`, a provider hozzárendelve |

A provider rögzített beállításai:

| Mező | Érték | Indok |
| --- | --- | --- |
| `client_type` | `public` | Böngészős Authorization Code + PKCE tesztkliens, amely nem tud titkot tárolni |
| `signing_key` | `!Find [authentik_crypto.certificatekeypair, [name, authentik Self-signed Certificate]]` | **Kötelező.** Signing key nélkül az Authentik HS256-ra és a client secretre vált; a PoC aszimmetrikus aláírást ír elő |
| `issuer_mode` | per-provider | Az issuer `${AUTHENTIK_PUBLIC_URL}/application/o/poc-backend/` alakú, alkalmazásonként elkülönítve |
| `sub_mode` | `hashed_user_id` | Stabil, nem személyes azonosító |
| `access_code_validity` / `access_token_validity` / `refresh_token_validity` | `minutes=1` / `minutes=5` / `hours=1` | D06 célértékek |
| `property_mappings` | `openid`, `profile`, `offline_access` + a saját audience mapping | A `groups` claim a `profile` scope-ból érkezik; az `email` scope-ot nem kérjük |
| `redirect_uris` | a bizonyító kliens callback URL-je, `matching_mode: strict` | Nyitott redirect nincs |

A `client_secret` public kliensnél nem használt; a blueprint akkor sem tesz titkot verziókövetésbe.

### 3.3 Discovery-végpontok

| Végpont | Alak |
| --- | --- |
| Discovery | `${AUTHENTIK_PUBLIC_URL}/application/o/poc-backend/.well-known/openid-configuration` |
| JWKS | `${AUTHENTIK_PUBLIC_URL}/application/o/poc-backend/jwks/` |
| Issuer (`OIDC_ISSUER_URL`) | `${AUTHENTIK_PUBLIC_URL}/application/o/poc-backend/` |

A discovery dokumentumban visszaadott `issuer` értéknek egyeznie kell az `OIDC_ISSUER_URL` konfigurációval; eltérés esetén a tokenellenőrzés nem indul el és az érintett kérés `503 dependency_unavailable`, konfigurációs okot néven nevező log mellett. Ugyanez a szabály a megadott `OIDC_JWKS_URI` és a discovery `jwks_uri` eltérésére. Technológiai támpont: [Authentik OAuth2 provider](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/).

**A `${AUTHENTIK_PUBLIC_URL}` egyetlen érték.** A konténerhálózaton belüli név (`http://authentik-server:9000`) és a hostról látott cím (`http://127.0.0.1:9000`) különbözik; a tokenbe az Authentik a saját publikus URL-jét írja. Ha a backend a konténernevet használná lekérésre és a hostcímet ellenőrizné issuerként, minden token elbukna. Ezért a PoC-ban a backend és a bizonyító kliens **ugyanazt** a hosztcímet használja, és ezt a runbook explicit rögzíti.

## 4. Tokenellenőrzés és kérésút

### 4.1 Kérésút és a `blockAdmin` csere

A sorrend a meglévő boundary után illeszkedik, hogy a correlation ID már minden hibán rajta legyen:

1. `requestBoundary` – correlation ID kiosztása, válaszfejléc, kérésnapló. A `blockAdmin` értéke `FEATURE_IDENTITY !== 'on'`, azaz bekapcsolt identity mellett a prefix-503 megszűnik. A kapcsoló megmarad: identity nélkül a viselkedés bitre azonos az M0–M1 állapottal.
2. `identityBoundary` – új Express middleware a `src/identity/` alatt. Ha van `Authorization` fejléc, a 2.3 szerint ellenőrzi a tokent, és sikerre beállítja a `res.locals.actor` értéket. Ha nincs fejléc, nem állít be actort és továbbenged.
3. `jsonBody` / `jsonBodyErrors` – változatlan.
4. `PermissionGuard` – változatlan. Actor nélkül `401`, jog nélkül `403`.

**Jelen lévő, de érvénytelen token minden útvonalon `401`,** a publikus katalóguson is. A kliens szándékosan azonosította magát; a csendes elfogadás elrejtené a hibás konfigurációt. Token nélküli publikus kérés változatlanul `200`. Ez a szabály egy sorban tesztelhető és nem hagy „néha számít, néha nem" viselkedést.

A middleware tudatosan ugyanoda ír, ahová az M1 teszt-összeállítás injektált (`res.locals.actor`), így a `PermissionGuard`, az `operationContext` és a teljes service-réteg változatlan marad. A `test/support/test-app.ts` továbbra is a `test/` fa alatt él és nem kerül a `dist/` buildbe; M2 nem csökkenti ezt a határt, hanem mellé teszi a valódi adaptert.

### 4.2 Discovery és JWKS cache

Könyvtár: **`jose`** (a jegyzék készítésekor 6.2.12), a `createRemoteJWKSet` és `jwtVerify` függvényekkel. Nem hozunk be `openid-client`-et: a discovery egyetlen `fetch` és egy Zod-séma, ami illeszkedik a projekt meglévő `src/contracts/` stílusához. A `jose` natív WebCryptóra épül, nincs Nest-peer igénye, és ESM alatt fut.

| Viselkedés | Szabály |
| --- | --- |
| Discovery időzítése | **Lusta**, az első tokenellenőrzéskor. Nem indulási feltétel, mert a D-M0-03b tiltja az IdP hálózati állapotának readinessbe kötését |
| Indulási ellenőrzés | Csak helyi: a kulcsok jelenléte, az issuer URL formátuma, a tolerancia felső korlátja. Hiányra `ConfigurationError`, a kulcs nevével |
| Discovery cache | Sikeres dokumentum a folyamat élettartamára; hiba nem cache-elődik |
| JWKS cache | A `jose` távoli kulcskészlete, rögzített `cacheMaxAge` és `cooldownDuration` értékkel |
| Ismeretlen `kid` | Legfeljebb egy újralekérés a cooldown letelte után; ha ezután sincs meg, `401`. Nincs kérésenkénti JWKS-hívás és nincs ellenőrzés nélküli elfogadás |
| IdP kiesés | Cache-elt, ismert kulccsal aláírt, még érvényes token **elfogadott**. Ismeretlen kulcs és új login nem – erre nincs fallback |
| Cache nélküli kiesés | Az első tokenellenőrzés is hálózati hibára fut: az érintett kérés `503 dependency_unavailable`. A `/health/ready` 200 marad |
| Hálózati időkorlát | `OIDC_HTTP_TIMEOUT_MS`, alapérték 2000; a kérés nem lóghat a JWKS-en |

A `401` és az `503` megkülönböztetése lényeges: a hibás token a kliens hibája, az elérhetetlen IdP a miénk. A kettőt nem mossuk össze egyetlen kódba.

### 4.3 Konfigurációs változások

A `validateConfig` jelenleg **minden** bekapcsolt integrációt indítási hibának minősít, mert egyikhez sincs ellenőrző adapter (`if (enabled.length) throw …`). M2 ezt a listát szűkíti: az implementált adapterrel rendelkező integrációk kikerülnek a tiltásból, a többi (`FEATURE_OUTBOX_RELAY`, `FEATURE_SEARCH`, `FEATURE_MEDIA`) változatlanul indítási hibát ad. A hiányzó kulcsok kulcsonkénti hibája előbb fut, tehát az üzenet továbbra is a kulcsot nevezi meg, nem a flaget.

Új **alkalmazáskulcs** kettő van: `OIDC_CLOCK_TOLERANCE_S` (egész, 0–30, alapérték 30) és `OIDC_HTTP_TIMEOUT_MS` (pozitív egész, alapérték 2000). Az új Compose/env változók (`AUTHENTIK_PUBLIC_URL`, `AUTHENTIK_BOOTSTRAP_PASSWORD`, `AUTHENTIK_BOOTSTRAP_TOKEN`) nem kerülnek a `validateConfig` sémájába, mert a backend nem olvassa őket; helyük a `.env.example` full-profil blokkja. Az `.env.example` OIDC blokkja kikommentezettből valós példaértékekre vált, a titkok továbbra is `REPLACE_ME` jelöléssel.

A `main.ts` jelenleg fix négyelemű `integrations_disabled` diagnosztikát ír. Ez a ténylegesen kikapcsolt integrációk listájára vált.

Ez a változás **három meglévő, jelenleg sikeres ellenőrzést ír át**; egyiket sem töröljük, mindegyik a bekapcsolt identityre helyes állítást kap:

| Hely | Jelenlegi állítás | M2 utáni állítás |
| --- | --- | --- |
| `test/base.test.ts` – `validateConfig` egységpróba | Mind a négy flag bekapcsolva `ConfigurationError` | Az identity érvényes konfigurációval átmegy; a másik három továbbra is hibát ad |
| `test/base.test.ts` – indítási próba | `FEATURE_IDENTITY=on` + OIDC-kulcsok: nem nulla exit | Ugyanez a konfiguráció elindul és listenel (ez az M2-T02) |
| `scripts/smoke-m0.mjs` 5.2 – „identity on without a verifying adapter" | Nem nulla exit, `FEATURE_IDENTITY` a hibában | Az eset a hiányzó **kulcsokra** szűkül (M2-T01); az „adapter nélkül" ág tárgytalan |

Az M0 smoke 5.4 (kikapcsolt integrációk diagnosztikája) ugyanígy frissül a dinamikus listára.

## 5. HTTP- és permission-illeszkedés

| Végpont | Hozzáférés | Token nélkül | Jog nélkül |
| --- | --- | --- | --- |
| `GET /health/live`, `GET /health/ready` | nyilvános | 200 | – |
| `GET /docs-json` | nyilvános | 200 | – |
| `GET /catalog/contents/:id` | nyilvános | 200 / 404 | – |
| `GET /catalog/search` | nyilvános | M4 | M4 |
| `GET /me` | hitelesített | 401 | – |
| `POST /admin/contents` | `content:write` | 401 | 403 |
| `PATCH /admin/contents/:id` | `content:write` | 401 | 403 |
| `POST /admin/contents/:id/publish` | `content:publish` | 401 | 403 |
| `POST /admin/contents/:id/withdraw` | `content:publish` | 401 | 403 |
| `GET /admin/contents/:id` | `content:read` | 401 | 403 |
| `GET /admin/processing-status` | `ops:read` | M3 | M3 |

A táblázat a `ROUTE_MATRIX` sorait követi, azzal a kiegészítéssel, hogy a health-végpontok is szerepelnek benne. A `/docs` Swagger-UI nincs a mátrixban, csak a `/docs-json`; ezt M2 nem változtatja meg. A meglévő `test/integration/contracts.test.ts` bővül azzal, hogy a `/me` mostantól ténylegesen bekötött route, és hogy minden `authenticated`/permission jelölésű sorhoz tartozik élő kezelő – az M3-ra és M4-re jelölt sorok kivételével, amelyek kifejezetten jelölt hiányként szerepelnek.

**`GET /me` válasza:** `sub`, `roles` (alkalmazásszerepek), `permissions` (rendezett lista) és `expiresAt` (a token `exp` értéke ISO 8601 alakban). Nem kerül bele e-mail, felhasználónév, csoportnév, nyers claim vagy maga a token. A viewer is 200-at kap üres `permissions` listával: az azonosítás és a jogosultság két külön dolog.

**Hibasorrend:** HTTP-hozzáférés (hitelesítés → jogosultság) → kérésformátum → rekordlétezés → verzió → állapot → célállapot. Az M1-ben rögzített sorrend elé tehát csak a hozzáférés kerül, a mögötte lévő lánc változatlan. Ebből következik, hogy jogosulatlan hívó **nem** tudja rekordok létezését kipuhatolni: a `403` előbb jön, mint a `404`.

**OpenAPI:** a dokumentum `bearerAuth` biztonsági sémát kap (`http` / `bearer` / `JWT`), az admin controllerek és a `/me` `@ApiBearerAuth()` jelölést, a 401 és 403 válaszok pedig a problem+json sémára hivatkoznak. A titkos értékek és a tényleges issuer nem kerül a statikus dokumentumba.

## 6. Fejlesztési csomagok és felelősségek

A felelősök a DECISIONS D01 szerinti szerző/review gazdákat jelölik; a táblázat nem indít másik agentet. Minden alkalmazásbeli hivatkozás a `poc/backend/` alá értendő.

| # | Csomag | Felelős / review | Függőség | Becslés | Kész eredmény |
| --- | --- | --- | --- | --- | --- |
| M2-01 | Authentik blueprint és full Compose kiegészítés | Claude / Codex | E01, E02 | 90 p | Verziózott blueprint, `/blueprints` mount, bootstrap kulcsok, frissített image-pin |
| M2-02 | Provider indítása, discovery és tokenpróba | Claude / Codex | M2-01 | 60 p | Tényleges issuer/audience/JWKS URI és a kiadott access/ID token claimkészlete rögzítve |
| M2-03 | Konfiguráció bővítése | Codex / Claude | — | 45 p | Implementált adapterek listája, két új alkalmazáskulcs, `.env.example`, dinamikus integrációdiagnosztika, és a 4.3 táblázatának három átírt ellenőrzése |
| M2-04 | Discovery/JWKS kliens és tokenverifikáló | Codex / Claude | M2-03 | 120 p | `jose` alapú ellenőrzés a 2.3 szabályaival, cache és cooldown a 4.2 szerint |
| M2-05 | Identity boundary és a `blockAdmin` csere | Codex / Claude | M2-04 | 60 p | Middleware, `WWW-Authenticate`, 401/403/503 szétválasztás |
| M2-06 | Claim → szerep → permission leképezés | Claude / Codex | M2-04 | 45 p | `roles.ts` a `ROLE_GROUPS` inverzével, determinisztikus sorrend, ismeretlen csoport kezelése |
| M2-07 | `/me` és OpenAPI bearer | Codex / Claude | M2-05, M2-06 | 45 p | Végpont, DTO, biztonsági séma, bővített contracts-próba |
| M2-08 | Teszt-tokenkeret | Codex / Claude | M2-04 | 75 p | Helyi kulcspár, aláíró segéd és JWKS-mock HTTP szerver a `test/` fa alatt |
| M2-09 | L1 integrációs próbák | Codex / Claude | M2-05…08 | 120 p | M2-T01–T19 és M2-T23 valódi PostgreSQL és mock JWKS ellen |
| M2-10 | `smoke:full` identity szakasza | Codex / Claude | M2-02, M2-09 | 75 p | Az M0 5. szakasz folyamatgazdájával; a nem kész integrációk pendingként, nem sikerként |
| M2-11 | L2 valódi Authentik próbák | Claude / Codex | M2-02, M2-09 | 90 p | PKCE login- és refresh-script, M2-T20–T22, `demo:m2` |
| M2-12 | Runbook, jegyzőkönyv és M3 átadás | Claude / Codex | M2-10, M2-11 | 60 p | Backend README identity szakasz, `VERSIONS.md` `jose`-sora és frissített Authentik-pin, M2 futtatási jegyzőkönyv, nyitott pontok |

**Összeg: 885 perc = 14 óra 45 perc.** Gazda szerint: Codex 540 perc (9 óra), Claude 345 perc (5 óra 45 perc). Authentiktól független rész (M2-03…M2-09): 510 perc = 8 óra 30 perc. Authentik-függő rész (M2-01, M2-02, M2-10, M2-11, M2-12): 375 perc = 6 óra 15 perc.

**Eltérés az ütemtervtől, kimondva.** A MILESTONES az M2-re a 9–10. munkanapot adja, azaz körülbelül 12 óra érdemi munkát. A fenti részletes becslés 14 óra 45 perc, tehát nagyjából fél munkanappal túllép. A DECISIONS D01 pontosan ezt az ellenőrzést írja elő az M2–M5 tervezési keretére. Javasolt kezelés: a különbözet a közös 2 napos tartalékból jön, és az M3 kezdete fél nappal csúszik. Ez nem ok a hibapróbák elhagyására. Ha az E01–E02 blokkolva marad, az Authentik-függő 6 óra 15 perc **nem tömöríthető**, hanem elmarad – a 7. szakasz kétszintű rendje pontosan azt írja le, mi marad ilyenkor futtatható és mit nem szabad késznek jelölni.

**Tervezett fájlterületek:** `src/identity/` (`identity.module.ts`, `oidc.ts`, `token-verifier.ts`, `identity.boundary.ts`, `roles.ts`, `me.controller.ts`, a meglévő `actor.ts` bővítve), `src/config.ts`, `src/main.ts`, `src/app.module.ts`, `src/http.ts` (csak a `WWW-Authenticate` fejléc), `test/base.test.ts` (a 4.3 szerint átírt két állítás), `test/support/` (kulcspár, tokenaláíró, JWKS-mock), `test/integration/identity.test.ts`, `scripts/smoke-m0.mjs` (5.2 és 5.4 esete), `scripts/smoke-full.mjs`, `scripts/authentik-login.mjs`, `scripts/demo-m2.mjs`, `authentik/blueprints/poc.yaml`, `compose.yaml`, `.env.example`, `README.md`, `docs/external-access.md`.

A `package.json`, a `package-lock.json` és a `VERSIONS.md` a DECISIONS D01 szerint **Codex gazdája alatt** változik: a `jose` mint új közvetlen dependency pontos verzióval és commitolt lockfile-lal kerül be, a `VERSIONS.md` külön sorral, és három új script (`test:integration:m2`, `smoke:full`, `demo:m2`) jelenik meg. A `VERSIONS.md` Authentik-sora ugyanitt frissül a 3.1 szerinti pinre.

**Sorrend:** konfiguráció → verifikáló → boundary és leképezés → `/me` → tesztkeret → L1 próbák → Authentik → L2 próbák → jegyzőkönyv. Az Authentik-oldali munka (M2-01, M2-02) a külső előfeltétel megérkezésekor bármikor beilleszthető, mert az alkalmazásoldal nem függ tőle.

## 7. Ellenőrzési terv

**Kétszintű bizonyítás.** Az L1 próbák helyben generált RSA kulcspárral aláírt tokenekkel és egy teszt-JWKS HTTP szerverrel futnak; determinisztikusak, mindig futtathatók, és a tokenellenőrzés logikáját bizonyítják. Az L2 próbák valódi Authentik-példányt igényelnek, és a MILESTONES M2-lezárási feltételét bizonyítják. **Az L1 önmagában nem zárja le M2-t.** Ha az L2 az E01–E05 hiánya miatt nem fut, a jegyzőkönyv pendingként jelöli, nem sikerként – az M0–M1 jegyzőkönyv ugyanezt a jelölési fegyelmet követi.

A tokenellenőrzés próbáihoz nem kell adatbázis; a jog- és auditpróbákhoz valódi PostgreSQL 17 kell, elkülönített, eldobható teszt-adatbázison, az M1 futtatási szabályai szerint.

| # | Szint | Helyzet | Ellenőrizendő eredmény |
| --- | --- | --- | --- |
| M2-T01 | L1 | `FEATURE_IDENTITY=on` hiányzó `OIDC_ISSUER_URL`/`OIDC_AUDIENCE` kulccsal | Indítási hiba, a hiányzó **kulcsokat** nevezi meg, nem a flaget; nincs listen |
| M2-T02 | L1 | `FEATURE_IDENTITY=on` teljes konfigurációval, elérhetetlen IdP mellett | Az app elindul (ez váltja ki az M1 T20-at), `/health/ready` 200; a prefix-503 megszűnt |
| M2-T02b | L1 | Minden admin route és method token nélkül, illetve üres és rosszul formázott `Authorization` fejléccel | `401` `WWW-Authenticate: Bearer` fejléccel, nem `503` és nem `403`; nincs DB-változás |
| M2-T03 | L1 | `OIDC_JWKS_URI` eltér a discovery `jwks_uri` értékétől; illetve a discovery `issuer` eltér | Az érintett kérés `503`, konfigurációs okot néven nevező log; nincs ellenőrzés nélküli elfogadás |
| M2-T04 | L1 | `GET /me` érvényes tokennel, majd token nélkül | 200 `sub`/`roles`/`permissions`/`expiresAt` mezőkkel; 401 `WWW-Authenticate: Bearer` fejléccel; e-mail, csoportnév és token nincs a válaszban |
| M2-T05 | L1 | Viewer minden admin route-on és methoddal | `/me` 200 üres `permissions` listával; minden adminművelet `403`; nincs DB-változás |
| M2-T06 | L1 | Editor teljes M1 útja | Létrehozás 201, szerkesztés 200; publish és withdraw `403`; a `403` nem növel verziót és nem ír auditot |
| M2-T07 | L1 | Publisher teljes M1 útja | Admin olvasás, létrehozás, szerkesztés, publish, withdraw, republish sikeres; az M1 verzió/audit/esemény szabály sértetlen |
| M2-T08 | L1 | Lejárt token; a toleranciahatár alatt és fölött lejárt token | Toleranciahatáron belül elfogadva, fölötte `401`; a tolerancia 30 másodperc fölé nem állítható |
| M2-T09 | L1 | Idegen `iss` értékű, egyébként érvényes aláírású token | `401`; a hibaüzenet nem árulja el az elvárt issuert |
| M2-T10 | L1 | Hiányzó, üres, idegen és listaformájú `aud` | Csak az `OIDC_AUDIENCE`-t tartalmazó lista vagy string fogadható el; minden más `401` |
| M2-T11 | L1 | Ismert `kid`, de másik kulccsal készült aláírás | `401`; a kulcs nem cserélődik le a JWKS-ben |
| M2-T12 | L1 | `alg: none`; `HS256` a JWKS RSA modulusával mint kulccsal; `alg` csere a fejlécben | Mindhárom `401`; az elfogadott algoritmusok halmaza `RS256` |
| M2-T13 | L1 | ID token API access tokenként | `401` az audience-eltérés miatt; a szabály a tényleges M2-02 claimkészlettel egyeztetve |
| M2-T14 | L1 | Ismeretlen `kid`, majd ugyanaz ismét a cooldownon belül | Legfeljebb egy JWKS-újralekérés, utána `401`; a hívásszám a mock szerveren számlálva, nincs kérésenkénti fetch |
| M2-T15 | L1 | JWKS szerver leáll, miután a kulcs cache-be került | Az ismert kulccsal aláírt, érvényes token elfogadva; ismeretlen kulcs `401`; `/health/ready` 200 marad |
| M2-T16 | L1 | JWKS elérhetetlen, üres cache-sel | Az érintett kérés `503 dependency_unavailable`, nem `401` és nem `500`; `/health/ready` 200 |
| M2-T17 | L1 | Sikeres publisher-publikálás után az audit és a content sorok | `actor_sub` a token `sub` értéke, `actor_roles` az alkalmazásszerepek; e-mail, csoportnév, token és nyers claim sehol a DB-ben |
| M2-T18 | L1 | Normál build hamis `x-test-actor` fejléccel, body-ban küldött actorral és `permissions` claimmel | Egyik sem ad jogot; a `dist/` fa nem tartalmaz tesztidentity-adaptert |
| M2-T19 | L1 | Érvényes token csoport nélkül; ismeretlen csoportnévvel; nem lista `groups` claimmel | `/me` 200 üres jogokkal, adminművelet `403`; egyik eset sem `500` |
| M2-T20 | L2 | Három valódi identitás Authorization Code + PKCE belépése | Mindhárom kap access tokent; `/me` a mátrix szerinti jogokat adja; az editor szerkeszt, a publisher publikál, a viewer írása `403` |
| M2-T21 | L2 | Kiadott token élettartama és refresh | `exp - iat` = 5 perc; refresh után az új access token működik, a régi a lejárata után `401`; a mért értékek jegyzőkönyvben |
| M2-T22 | L2 | Csoporttagság módosítása, majd refresh; signing-key rotáció megismerése | A jogváltozás az új tokenben látszik, a régiben nem; új `kid` a cooldown után megismerhető. A rotáció **végleges** bizonyítéka M5, itt név szerint átadva |
| M2-T23 | L1+L2 | Correlation ID és titokmentes log minden identity-hibaágon | A `401`/`403`/`503` válaszok correlation ID-t hordoznak; a logban nincs token, `Authorization` fejléc, jelszó, client secret vagy teljes discovery-válasz |

Az M1 T01–T23 próbái a **T20 kivételével** változatlanul futnak. A T20 („identity on, ellenőrző adapter nincs → indítási hiba") azért létezett, mert nem volt adapter; M2 megépíti, ezért a helyébe az M2-T01 és M2-T02 lép. Ez az egyetlen tervezett csere, és az 1. szakasz kimondja. Ha az identity bekötése bármely **más** M1-próbát eltör, az regresszió és nem elfogadott átmeneti állapot. A teszt-összeállítás actor-injektálása megmarad, mert az az M1 üzleti szabályait ellenőrzi, nem a hozzáférést.

### 7.1 Tervezett futtatási szerződés

A következő parancsok **megvalósítandó felületek**, jelenleg nem futtatható bizonyítékok.

| Parancs a backendből | Elvárt feladat |
| --- | --- |
| `npm run test:integration:m2` | Elkülönített teszt-DB-n és mock JWKS-en futtatja az L1 próbákat, siker/hiba exit kóddal |
| `npm run smoke:full` | Az M0 5. szakasz folyamatgazdájával indítja a full profilt; az identity szakaszt ellenőrzi, a NATS és Meili szakaszt pendingként jelöli |
| `npm run demo:m2` | Valódi tokennel járja végig: belépés → draft → publikálás → nyilvános lekérés → visszavonás |
| `node scripts/authentik-login.mjs <identitás>` | Authorization Code + PKCE belépés és refresh, a tokenek titokmentes összefoglalójával |

A `demo:m2` az M0 demófixture-jét használja, futásonként új contentazonosítóval, és a publikus lekérést token nélkül végzi. A jegyzőkönyv tartalmazza a parancsot, a környezetet, a verziókat, az ellenőrzésazonosítót és az eredményt. Access token, refresh token, client secret, jelszó és teljes discovery-válasz nem kerül bele; az issuer, az audience és a `kid` igen.

## 8. Lezárás és átadás

- [ ] Az Authentik provider, alkalmazás, három csoport és három tesztidentitás verziózott blueprintből, reprodukálhatóan jön létre. (M2-01)
- [ ] A tényleges issuer, audience, JWKS URI és a kiadott token claimkészlete rögzített, nem feltételezett. (M2-02, E03)
- [ ] A konfiguráció helyesen viselkedik: hiányzó OIDC-kulcs indítási hiba, teljes konfiguráció elindul, ellentmondó discovery nem ad csendes elfogadást. (M2-T01, M2-T02, M2-T03)
- [ ] Bekapcsolt identity mellett az `/admin` prefix-503 megszűnik, és a hiányzó hitelesítés `401`, a hiányzó jog `403`. (M2-T02b, M2-T04, M2-T05)
- [ ] Szerep nélküli és ismeretlen csoportú, egyébként érvényes token azonosít, de nem jogosít, és nem okoz `500`-at. (M2-T19)
- [ ] A három szerep pozitív és negatív jogosultsági eredménye megfelel a rögzített mátrixnak. (M2-T05–T07, M2-T20)
- [ ] A tokenhibák teljes köre elutasított: lejárat, issuer, audience, aláírás, algoritmus és ID token. (M2-T08–T13)
- [ ] A JWKS cache, az ismeretlen kulcs és az IdP-kiesés viselkedése bizonyított, bypass nélkül; a readiness nem függ az IdP-től. (M2-T14–T16)
- [ ] Az audit actor a verifikált tokenből származik; e-mail, csoportnév és token nincs a DB-ben és a logban. (M2-T17, M2-T23)
- [ ] A normál build nem fogadja el a fejlécből vagy bodyból érkező identitást, és nem tartalmaz tesztadaptert. (M2-T18)
- [ ] A refresh működik, a token-élettartam mért, a visszavonási ablak számított és jegyzőkönyvezett; a refresh utáni jogváltozás és a kulcsmegismerés megkezdve, M5-re név szerint átadva. (M2-T21, M2-T22)
- [ ] Az M1 T01–T19 és T21–T23 próbái regresszió nélkül futnak, a T20 dokumentált cseréje megtörtént, és a dokumentált ellenőrzések reprodukálhatók. (M2 futtatási jegyzőkönyv)

Ezek teljesítendő futási eredmények; a tervezési döntések lezárása nem pipálja ki őket.

**M3-nak átadandó:** a `GET /admin/processing-status` végpont `ops:read` permissionja és a hozzá tartozó guard-illesztés, a verifikált actor kontextus a relay diagnosztikai végpontjaihoz, valamint az a szabály, hogy a feldolgozási állapot olvasása hitelesítést igényel, míg a `/health/ready` nem.

**M4-nek átadandó:** a nyilvános keresés és részletlekérés login nélkül marad elérhető; a jelen lévő, de érvénytelen token ott is `401`. A keresési válasz nem szivárogtathat adminmezőt jogosulatlan hívónak.

**M5-nek átadandó:** a signing-key rotáció és az IdP-kiesés végleges bizonyítéka, az M2-T22-ben megkezdett kulcsmegismeréssel és a rögzített cache-paraméterekkel. A visszavonási ablak mért értéke a mérési jegyzőkönyv része.

## 9. Kockázatok és eljárás

| Kockázat | Rögzített eljárás |
| --- | --- |
| Konténerregiszter nem elérhető (E01), az Authentik nem indul | Az L1 rész teljes egészében fut és bizonyít; az L2 pendingként jelölve marad, nem sikerként. Az M2 lezárása addig nyitott |
| Az Authentik kiadásváltás (2025.8 → aktuális) töri a blueprintet | M2-01 a pin frissítését és az első sikeres alkalmazást egy feladatnak kezeli; hiba esetén az utolsó működő tag marad, indoklással a `VERSIONS.md`-ben |
| Az `aud` claim nem az elvárt alakban érkezik | M2-02 tokenpróbája előbb fut, mint a verifikáló véglegesítése; a szabály a mért claimkészlethez igazodik, nem fordítva |
| Az issuer a konténernév és a hostcím miatt nem egyezik | A runbook egyetlen publikus URL-t rögzít mindkét oldalra; M2-T03 ezt az eltérést kifejezetten ellenőrzi |
| A `groups` claim nem érkezik meg a választott scope-okkal | M2-02 ellenőrzi; szükség esetén saját scope mapping adja a csoportlistát, a leképezés helye (`roles.ts`) változatlan |
| A becslés túllépi a 2 napos keretet | A 6. szakasz kimondja: tartalékkeret és fél napos M3-csúszás, nem tesztelhagyás |
| Az identity bekötése töri az M1 próbáit | A T20 tervezett cseréje az egyetlen kivétel, az 1. és 7. szakasz szerint; minden más törés regresszió. A teszt-összeállítás actor-injektálása megmarad, mert más réteget ellenőriz |

## 10. Következő lépés

Az M2-03 konfigurációbővítés és az M2-04 tokenverifikáló az Authentik megérkezése nélkül is kezdhető, mert az alkalmazásoldal a discoveryt lusta hívásként kezeli. Az M2-01 és M2-02 az E01–E02 külső előfeltétel teljesülésekor indul. Új üzleti döntési kör nem szükséges: a szerepek, jogok, élettartamok és hibakódok a DECISIONS D06–D07 szerint rögzítettek.
