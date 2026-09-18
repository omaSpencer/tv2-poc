# Final backend milestone – a code review lezárása

2026-09-18 · Végrehajtási terv a Fable final code review alapján.

**Státusz: folyamatban; BE-F1–BE-F4 lezárva, BE-F5 backend-része elkészült,
az integrált Authentik lifecycle gate pending.** Ez a milestone a final audit mind a **25 backend
találatát** lezárja: 2 Medium, 13 Low és 10 Info tételt. A cél nem egyetlen nagy
javítócsomag, hanem öt, egymás után végrehajtható és külön ellenőrizhető fázis.

Forrás: `final-code-review-audit.canvas.tsx`, 2026-09-18. A forrásaudit szerint
nincs Critical vagy High találat, a PoC release gate zöld; ez a terv a PoC utáni
hardening és a technikai adósság rendezése.

## Munkaszabály

- Egyszerre csak egy fázis legyen folyamatban.
- A fázison belül a találatok kis, tematikus commitokra bonthatók, de a fázis
  csak a saját ellenőrzési kapujával együtt zárható le.
- Egy audit-tétel háromféleképpen zárható: implementált javítás, teszttel védett
  tudatos elfogadás, vagy külön indokolt későbbi production feladat. A puszta
  átnevezés vagy checklistből törlés nem lezárás.
- Minden lezárt tételhez kerüljön rövid bizonyíték a későbbi
  `FINAL-BACKEND-EVIDENCE.md` fájlba: változtatott fájlok, futtatott ellenőrzés és
  eredmény.
- Ha egy korábbi fázis módosít szerződést, a frontend contract snapshotját és a
  kapcsolódó teszteket ugyanabban a fázisban kell frissíteni.

## Sorrend

| Fázis | Téma | Audit-ID-k | Méret | Belépési feltétel |
| --- | --- | --- | --- | --- |
| BE-F1 | Publikus perem és futtatási hardening | S1, S2, S4, S7, O1 | 5 | jelenlegi zöld baseline |
| BE-F2 | Trust boundary, hibák és operációs diagnosztika | S3, S5, S6, C2, O2 | 5 | BE-F1 kész |
| BE-F3 | Lekérdezési és adatkezelési korrektség | C1, C6, C7, C8, D2 | 5 | BE-F2 kész |
| BE-F4 | Eseményút, reindex és skálázás | C3, C4, C5, C9, D1 | 5 | BE-F3 kész |
| BE-F5 | Közös infrastruktúra és minőségkapu | A1, A2, A3, T1, T2 | 5 | BE-F4 kész |

---

## BE-F1 – Publikus perem és futtatási hardening

**Cél:** a publikus HTTP-felület és a helyi/production futtatás biztonsági
alapállapotának egyértelművé tétele.

- [x] **S1 – Rate limiting a publikus végpontokon.** Kerüljön mérhető limit a
  `GET /catalog/search` és `GET /catalog/contents/:id` route-okra. A választott
  hely (NestJS vagy reverse proxy) legyen dokumentálva; legyen teszt a limitre,
  a `429` válaszra és arra, hogy normál forgalom nem sérül.
- [x] **S2 – Explicit CORS/same-origin döntés.** Rögzíteni kell a támogatott
  browser-topológiát. Cross-origin SPA esetén szűk origin-, method- és
  header-allowlist szükséges; same-origin proxy esetén az API maradjon CORS
  nélkül, és ezt a runbook bizonyítsa. Wildcard origin nem elfogadott.
  A nem-root Nginx/SPA image, az `/api` prefix-levágás, a privát backend és a
  same-origin Docker smoke bizonyított. Evidence: `FINAL-BACKEND-EVIDENCE.md`.
- [x] **S4 – Dependency-portok loopbackre kötése.** A fejlesztői Compose-ban a
  PostgreSQL, NATS, mindkét Meilisearch és Authentik host-portja alapból csak
  `127.0.0.1`-en legyen elérhető. A konténerek közti hálózat maradjon működőképes.
- [x] **S7 – Meilisearch production posture.** A fejlesztői `MEILI_ENV` maradhat
  dokumentáltan `development`, de a production példa/profil használjon
  `production` módot és kötelező, nem repóban tárolt kulcsot.
  Bizonyíték: `FINAL-BACKEND-EVIDENCE.md` → BE-F1/S7.
- [x] **O1 – Alkalmazás image.** Készüljön reprodukálható, nem rootként futó,
  production dependency-ket tartalmazó backend image és dokumentált indítás.
  A healthcheck és a konfigurációs hibaút konténerből is működjön.
  A build, a `USER node`, a Docker `healthy`, a live/ready és a hiányzó
  `DATABASE_URL` hibaút valódi konténerből bizonyított. Bizonyíték:
  `FINAL-BACKEND-EVIDENCE.md` → BE-F1/O1.

### BE-F1 lezárási kapu

- [x] A publikus route-ok limitje automatikus tesztben bizonyított.
- [x] A browser-topológia és CORS-döntés a README/runbook része.
- [x] A hostról a dependency-k csak loopbacken érhetők el. *(A konténerek
  kontrollált újralétrehozása után mind a hat tényleges portkötés `127.0.0.1`,
  és minden dependency healthy.)*
- [x] A backend image buildel, nem rootként indul, és a live/ready ellenőrzés zöld.
- [x] Backend typecheck, lint, unit/integrációs tesztek és OpenAPI check zöld.
  *(Node 24.20.0, 24 tesztfájl, 267/267 pass, 0 skip.)*

---

## BE-F2 – Trust boundary, hibák és operációs diagnosztika

**Cél:** a konfigurációs és dependency-hibák pontos, titokmentes és
karbantartható kezelése.

- [x] **S3 – Raw SQL timeout helper.** A `SET LOCAL lock_timeout` összeállítása
  kerüljön egyetlen helperbe, amely a formázás előtt `Number.isSafeInteger`,
  pozitív tartomány és felső korlát alapján ellenőriz. Legyen negatív unit teszt.
- [x] **S5 – OIDC issuer normalizálás/diagnosztika.** A trailing slash kezelésére
  legyen egyetlen dokumentált szabály. Eltéréskor stabil, titokmentes hibakód és
  diagnosztizálható logmező keletkezzen; teljes issuer URL ne kerüljön logba.
- [x] **S6 – Hasznos, de titokmentes bootstrap-hiba.** A `bootstrap_failed`
  maradjon stabil külső kód, a strukturált log pedig legfeljebb biztonságos
  hibatípust/hibakategóriát tartalmazzon. Üzenet, URL, token és credential nem.
- [x] **C2 – `dependencyRead` hibaklasszifikáció.** Csak ismert kapcsolat- és
  dependency-hibák legyenek `dependency_unavailable`; programozási hiba
  `internal_error` ágon menjen tovább és legyen naplózható/tesztelhető.
- [x] **O2 – Path nélküli request-log szerződés.** A tudatos anti-leak döntés
  kerüljön a runbookba: mit lehet correlation ID alapján visszakeresni, és milyen
  diagnosztikai korlátot vállalunk. Ha változik a policy, csak normalizált route
  template logolható, nyers URL/query nem.

### BE-F2 lezárási kapu

- [x] A timeout helper érvényes és hibás határértékei teszteltek.
- [x] Issuer trailing-slash és valódi mismatch teszteset külön ágon fut.
- [x] Dependency outage és mesterséges programhiba eltérő problem code-ot ad.
- [x] A bootstrap- és request-log tesztje igazolja, hogy titok nem szivárog.
- [x] A teljes korábbi backend tesztkészlet zöld.

---

## BE-F3 – Lekérdezési és adatkezelési korrektség

**Cél:** a lapozási, audit- és broker-segédutak ne csonkoljanak vagy maszkoljanak
csendben.

- [x] **C1 – Karanténlista scan-budget kurzor.** A 2000-es scan-büdzsé
  kimerülésekor az API adjon folytatható kurzort az utolsó vizsgált sequence-nél;
  `nextBeforeSequence: null` csak valódi lista-végén legyen. Legyen nagy,
  purge-elt réseket szimuláló integrációs teszt.
- [x] **C6 – Ismeretlen audit action fail-closed.** Az ismeretlen adat ne essen
  csendben `updated` értékre. Legyen explicit unreachable/assertion vagy stabil
  belső hiba, és tesztelje a mappert a DB CHECK-től függetlenül.
- [x] **C7 – Korlátlan audit-olvasás megszüntetése.** A production repository út
  kötelező, ésszerű limittel/cursorral működjön. A fixture/demo segéd ne
  használjon `2_147_483_647` limitet.
- [x] **C8 – Broker `capacity` osztály döntése.** Vagy kapjon eltérő retry/
  observability viselkedést, vagy olvadjon be a `transient` osztályba. Holt
  kategória ne maradjon a publikus belső contractban.
- [x] **D2 – Forward-only migrációs policy.** A jelenlegi tudatos döntés legyen
  explicit runbook/ADR: rollback módja restore/forward-fix, rehearsal elvárás és
  felelősség. Ez dokumentált elfogadással zárható, down migrációk gyártása nem
  öncél.

### BE-F3 lezárási kapu

- [x] A karantén lapozása nagy sequence-rések mellett hiánytalanul bejárható.
- [x] Audit action és audit lista szélső esetei automatikus tesztben zöldek.
- [x] A broker-hibakategóriák száma és viselkedése egyértelműen dokumentált.
- [x] A migrációs recovery eljárás friss környezetben végigolvasható/reprodukálható.
- [x] Contract- és regressziós kapuk zöldek. *(Node 24.20.0, 25 tesztfájl,
  279/279 pass, OpenAPI drift nincs.)*

---

## BE-F4 – Eseményút, reindex és skálázás

**Cél:** az implicit megbízhatósági invariánsok legyenek explicit szerződések,
és a nagyobb adathalmaznál jelentkező lineáris költségek legyenek kezelve.

- [x] **C3 – At-least-once és consumer-idempotencia contract.** Az event contract
  mondja ki, hogy a relay a dedupe-ablakon túl is duplikálhat, a consumernek
  eventId/aktuális aggregátum alapján konvergálnia kell. Legyen a 2 perces ablakon
  túli redeliveryt bizonyító teszt vagy determinisztikus harness.
- [x] **C4 – `hasSequenceRange` round-tripok megszüntetése.** Limits retention
  mellett bounds-check vagy igazoltan korlátos mintavételezés váltsa az
  üzenetenkénti lekérdezést. A hiányos retention-ág továbbra is fail-closed legyen.
- [x] **C5 – Reindex verifier memória- és freeze-ablak.** Rögzíteni kell a
  támogatott katalógusplafont, majd az afölötti út legyen keysetes sorted
  merge-join vagy más korlátos memóriájú összehasonlítás. A write-barrier idejét
  mérje teszt/evidence.
- [x] **C9 – Relay orphaned-loop guard.** A fast-path stop ellenőrizze az aktív
  loop állapotát is; restart/stop versenyhelyzetre legyen determinisztikus teszt.
- [x] **D1 – Admin keresés indexstratégia.** Production profilhoz `pg_trgm` GIN
  index és mért `EXPLAIN` evidence készüljön reális adatmennyiséggel. Ha a
  production scope ezt későbbre teszi, legyen számszerű aktiválási küszöb és
  külön követett feladat.

### BE-F4 lezárási kapu

- [x] A relay/consumer duplikációs invariáns szerződésben és tesztben is látszik.
- [x] A retention check hálózati round-tripja nem nő lineárisan a range hosszával.
- [x] A verifier memóriahasználata és write-freeze ideje dokumentált mérésből ismert.
- [x] Relay stop/start versenyteszt ismételhetően zöld.
- [x] Az admin keresés query planje vagy az elfogadott aktiválási küszöb evidence-ben szerepel.

---

## BE-F5 – Közös infrastruktúra és minőségkapu

**Cél:** a duplikált cross-cutting kód rendezése, majd mérhető teszt- és identity
release gate kialakítása.

- [x] **A1 – Közös backoff/deadline util.** A relay és projection worker
  `raceDeadline`, retry-ladder, jitter és settings-normalizálás duplikációja
  közös, tisztán tesztelhető modulba kerüljön. A viselkedés ne változzon rejtetten.
- [x] **A2 – Egyetlen logger bekötési pont.** A független pino-példányokat közös
  DI/factory váltsa, egységes redakcióval és mezőszerződéssel. Indulás előtti
  kódhoz is ugyanaz a sanitization policy tartozzon.
- [x] **A3 – Forrásnyelv konzisztencia.** A production forrás kommentjei legyenek
  angolul; a magyar operátori/user dokumentáció maradhat magyar.
- [x] **T1 – Backend coverage gate.** Kerüljön be `@vitest/coverage-v8`, commitolt
  konfiguráció és fokozatos, a jelenlegi baseline-hoz kötött küszöb. A küszöb ne
  ösztönözzön értéktelen tesztekre, de regressziót ne engedjen.
- [ ] **T2 – Valódi Authentik L2 release gate.** A mock JWKS mellett legyen
  reprodukálható, dokumentált valódi-tokenes suite legalább issuer, audience,
  refresh/session és jogosultság ellenőrzéssel. Ha nem fut minden PR-on, a release
  gate-ben kötelező és evidence-szel igazolt legyen.
  A backend blueprint, strict silent redirect, provider-preflight és fail-closed
  futtatás kész; az 5 perces böngészős renewal/reload/logout bizonyíték az
  integrált Cursor frontend ágra vár.

### BE-F5 lezárási kapu

- [x] A közös util és logger saját unit tesztekkel rendelkezik.
- [x] A log-redakció teljes suite-ja zöld.
- [x] Typecheck, lint és coverage-küszöb zöld.
- [ ] A teljes integrációs stack és a valódi Authentik L2 gate zöld.
- [ ] `FINAL-BACKEND-EVIDENCE.md` mind a 25 audit-ID-t eredménnyel felsorolja.

## Milestone Definition of Done

- [ ] BE-F1–BE-F5 minden lezárási kapuja teljes.
- [ ] Mind a 25 audit-ID pontosan egyszer szerepel az evidence-ben, nyitott vagy
  „majd egyszer” státusz nélkül.
- [ ] Minden tudatos elfogadásnak van tulajdonosa, indoka és újraértékelési
  feltétele.
- [ ] Backend build, typecheck, lint, OpenAPI/contract drift, coverage, teljes
  integrációs suite és valódi Authentik L2 gate zöld.
- [ ] A runbook friss környezetből bizonyítja az image-indítást, a CORS/topológia
  döntést és a dependency-k biztonságos host-kitettségét.

## Teljességi mátrix

| Audit-ID | Fázis | Lezárás fő típusa |
| --- | --- | --- |
| S1 | BE-F1 | kód + integrációs teszt |
| S2 | BE-F1 | architekturális döntés + teszt/runbook |
| S4 | BE-F1 | konfiguráció + hálózati ellenőrzés |
| S7 | BE-F1 | konfiguráció + dokumentáció |
| O1 | BE-F1 | image + smoke |
| S3 | BE-F2 | refaktor + unit teszt |
| S5 | BE-F2 | kód + identity teszt |
| S6 | BE-F2 | logging + anti-leak teszt |
| C2 | BE-F2 | hibaklasszifikáció + teszt |
| O2 | BE-F2 | dokumentált policy + teszt |
| C1 | BE-F3 | lapozási javítás + integrációs teszt |
| C6 | BE-F3 | fail-closed mapper + unit teszt |
| C7 | BE-F3 | korlátos repository út + teszt |
| C8 | BE-F3 | contract-egyszerűsítés vagy differenciálás |
| D2 | BE-F3 | dokumentált elfogadás/ADR |
| C3 | BE-F4 | event contract + resilience teszt |
| C4 | BE-F4 | algoritmusjavítás + adapterteszt |
| C5 | BE-F4 | skálaterv + korlátos implementáció/mérés |
| C9 | BE-F4 | lifecycle guard + versenyteszt |
| D1 | BE-F4 | index/mérés vagy küszöbös production feladat |
| A1 | BE-F5 | közös util + regressziós teszt |
| A2 | BE-F5 | logger DI/factory + redakciós teszt |
| A3 | BE-F5 | forrástisztítás |
| T1 | BE-F5 | coverage gate |
| T2 | BE-F5 | valódi Authentik release gate |
