# Final frontend milestone – a code review lezárása

2026-09-18 · Végrehajtási terv a Fable final code review alapján.

**Státusz: folyamatban; FE-F1–FE-F3 lezárva.** Ez a milestone a final audit mind a **21 frontend
találatát** lezárja: 2 Medium, 14 Low és 5 Info tételt. A munka öt külön
fázisban halad; egy fázis végén a frontendnek önmagában kiadható állapotban kell
maradnia.

Forrás: `final-code-review-audit.canvas.tsx`, 2026-09-18. A forrásaudit szerint
nincs Critical vagy High találat, a lint, typecheck és 139 unit teszt zöld. Ez a
terv a runtime-reziliencia, production posture és fenntarthatóság rendezése.

## Munkaszabály

- Egyszerre csak egy fázis legyen folyamatban; a következő csak zöld kapu után
  induljon.
- A findingeket kis commitokra lehet bontani, de egy commitban ne keveredjen
  holtkód-törlés, viselkedésváltozás és nagy architekturális döntés.
- Egy tétel implementált javítással vagy dokumentált, teszttel védett tudatos
  elfogadással zárható. A finding elrejtése vagy átnevezése nem lezárás.
- Minden lezárt tételhez kerüljön rövid bizonyíték a későbbi
  `FINAL-FRONTEND-EVIDENCE.md` fájlba.
- A **M1** eltávolíthatja az **L8** egyik érintett komponensét, de L8 csak akkor
  zárható, ha az összes megmaradó UUID-bemenet ugyanazt a validálási szabályt
  használja.

## Sorrend

| Fázis | Téma | Audit-ID-k | Méret | Belépési feltétel |
| --- | --- | --- | --- | --- |
| FE-F1 | Holtkód és szerződéskonszolidáció | M1, L7, L8, L11 | 4 | jelenlegi zöld baseline |
| FE-F2 | Runtime-helyreállás és request-életciklus | M2, L3, L4, L5, L9 | 5 | FE-F1 kész |
| FE-F3 | Frissesség, polling és diagnosztika | L2, L6, L10, I2 | 4 | FE-F2 kész |
| FE-F4 | UX, accessibility és navigáció | L12, L13, I1, I5 | 4 | FE-F3 kész |
| FE-F5 | Production security és minőségkapu | L1, L14, I3, I4 | 4 | FE-F4 kész |

---

## FE-F1 – Holtkód és szerződéskonszolidáció

**Cél:** a további javítások előtt csökkenteni a felszínt, és megszüntetni a
duplikált helyi igazságforrásokat.

- [x] **M1 – Az `EditorialPage` lánc eltávolítása.** Törlendő a sehonnan nem
  routolt `EditorialPage`, `PhasePlaceholderPage`, `ContentIdBar` és az elavult
  `content/activeContent` context, a hozzájuk tartozó sessionStorage-írásokkal,
  query key-ekkel, tesztekkel és exportokkal együtt. A `/editorial` kompatibilis
  redirectje csak akkor maradjon, ha dokumentált bookmark-compatibilitást ad.
- [x] **L7 – Permission-mátrix drift javítása.** A demo fixture publisher
  jogosultsága egyezzen az E2E szerződéssel, az `ops:write` legyen egyértelmű. A
  lokális `AppPermission` duplikáció helyett egy közös/generált típus legyen.
- [x] **L8 – Egységes UUID-validálás.** A holtkód törlése után minden megmaradó
  UUID input ugyanazt a backenddel kompatibilis v1–v8 szabályt/helper-sémát
  használja; v7 pozitív regressziós teszt kötelező.
- [x] **L11 – Duplikációk és nem használt exportok.** A `hasPermission`/`can`,
  `CONTENT_CATEGORIES` és demo-konstansok közül maradjon egy igazságforrás;
  törlendők a nem használt exportok. A contract-generált érték elsőbbséget élvez.

### FE-F1 lezárási kapu

- [x] A törölt láncra nincs import, route, storage key vagy query key hivatkozás.
- [x] Publisher permission fixture és E2E contract azonos.
- [x] UUID v7 elfogadási és hibás UUID elutasítási teszt zöld.
- [x] A teljes frontend typecheck, lint és unit/component suite zöld.
- [x] A bundle nem nő; a holtkód ténylegesen eltűnik a production buildből.

---

## FE-F2 – Runtime-helyreállás és request-életciklus

**Cél:** render-, lazy chunk-, auth callback- és hálózati hiba után legyen
determinista helyreállás, párhuzamos mellékhatások nélkül.

- [x] **M2 – Root error boundary / router `errorElement`.** Renderhibára legyen
  emberi hibaoldal, correlation/technikai részletek biztonságos megjelenítésével
  és „újratöltés” akcióval. Lazy chunk invalidáció esetén egyszeri teljes reload
  történhet loop-védelemmel.
- [x] **L3 – Signin callback promise cache takarítása.** A URL/code kulcsú entry
  success és failure után is `finally` ágban ürüljön; StrictMode/idempotencia
  maradjon tesztelt, és az authorization code ne éljen a session végéig.
- [x] **L4 – Catalog visibility probe single-flight.** Hidden→visible váltás ne
  indíthasson második probe-ot aktív kérés alatt; az egyetlen futó kérés
  eredménye pontosan egyszer módosítsa a budgetet.
- [x] **L5 – Pure React state updaterek.** A `setHistory` updater ne hívjon
  `setCursor`-t; a következő state számítása legyen pure és StrictMode alatt is
  pontosan egy logikai navigációt eredményezzen.
- [x] **L9 – Központi request timeout.** Az `apiRequest` kapjon ésszerű default
  timeoutot AbortSignal-kompozícióval úgy, hogy a caller saját cancelje továbbra
  is működjön. A timeout külön, stabil UI-hibává képezhető le; streaming kivétel
  esetén explicit opt-out kell.

### FE-F2 lezárási kapu

- [x] Renderhiba és szimulált stale lazy chunk esetén a felhasználó helyre tud állni.
- [x] Callback cache success/failure és StrictMode tesztje zöld.
- [x] Visibility-váltogatás alatt egyszerre legfeljebb egy probe fut.
- [x] A lapozási state StrictMode tesztben determinisztikus.
- [x] Függő request timeoutol, a caller abort és a timeout egymást nem rontja el.

---

## FE-F3 – Frissesség, polling és diagnosztika

**Cél:** a háttér- és operációs lekérdezések ne szivárogtassanak tokent, ne
terheljék szükségtelenül a backendet, és ne adjanak elavult döntési alapot.

- [x] **L2 – Health hívások auth nélkül.** A `/health/*` kérések explicit
  `auth: false` módban fussanak. Teszt bizonyítsa, hogy akkor sem kerül rájuk
  Bearer header, ha aktív session van.
- [x] **L6 – Valóban élő reindex preflight.** Látható lapon 5–10 másodperces
  polling vagy azzal egyenértékű invalidáció tartsa frissen a preflightot és a
  `canSubmit` állapotot; rejtett lapon szüneteljen, visszatéréskor frissítsen.
- [x] **L10 – Health polling backoff.** Tartós hibánál capped exponenciális
  backoff és ésszerű jitter csökkentse a kéréseket; siker után álljon vissza a
  normál 10 másodperces ritmus. Egyszerre ne legyen több health request.
- [x] **I2 – Correlation ID versenyhelyzet rendezése.** A modul-globális
  last-write-wins érték helyett a StatusBar kapjon explicit, értelmezhető
  requesthez tartozó azonosítót, vagy a mező legyen egyértelműen „legutóbbi
  válasz” eseményként modellezve. Párhuzamos request teszt szükséges.

### FE-F3 lezárási kapu

- [x] Health requestben semmilyen auth header nincs.
- [x] A reindex indítás nem maradhat korlátlan ideig stale preflight alapján aktív.
- [x] Tartós outage alatt a health kérési ráta csökken, recovery után normalizálódik.
- [x] Párhuzamos API-kérések nem társítanak félrevezető correlation ID-t a státuszhoz.
- [x] Timeres tesztek fake clockkal determinisztikusan zöldek.

---

## FE-F4 – UX, accessibility és navigáció

**Cél:** a hiba- és navigációs élmény legyen hozzáférhető, kiszámítható és a
támogatott nyelvi scope-pal összhangban.

- [x] **L12 – Állítható/bezárható értesítések.** Minden toast kapjon elérhető
  bezárás gombot; error üzenet legyen hosszabb vagy perzisztens. A fókuszt ne
  lopja el, screen reader bejelentése és pause/hover/focus viselkedése legyen
  dokumentált és tesztelt.
- [x] **L13 – Saját 404 route.** Ismeretlen út ne redirecteljen csendben a
  főoldalra. Mutasson „az oldal nem található” nézetet biztonságos visszalépési
  és főoldal-linkkel.
- [x] **I1 – `unstable_usePrompt` izolálása.** A router-specifikus unstable API
  egyetlen adapter mögött legyen, contract teszttel a dirty guard fő eseteire.
  Ha van stabil, azonos szemantikájú API az aktuális verzióban, migráljunk rá.
- [x] **I5 – Nyelvi stratégia.** Explicit döntés szükséges: a termék magyar-only
  marad egységes magyar szöveggel, vagy i18n keretrendszert és kulcsalapú
  szövegeket vezetünk be. Production többnyelvű követelmény esetén az i18n
  bevezetése e finding lezárásának része; alkalmi magyar/angol keverés nem maradhat.

### FE-F4 lezárási kapu

- [x] Toast billentyűzettel és assistive technologyval bezárható.
- [x] Ismeretlen route saját 404 nézetet ad és megőrzi az alkalmazás shellt.
- [x] Dirty navigation belső route-váltásra és browser kilépésre tesztelt.
- [x] A nyelvi döntés dokumentált, a látható UI a választott scope-on belül egységes.
- [ ] Axe/component és a releváns böngészős E2E ellenőrzések zöldek.

---

## FE-F5 – Production security és minőségkapu

**Cél:** lezárni a production üzembe álláshoz szükséges token-, konfiguráció-,
runtime- és tesztelési döntéseket.

- [ ] **L1 – OIDC token storage production döntés.** Threat model alapján
  válasszunk: BFF + secure/httpOnly cookie, vagy indokolt in-memory tokenkezelés
  refresh-stratégiával. A `sessionStorage` csak explicit PoC/dev profilban
  maradhat; production buildben a választott megoldás és XSS/CSP védelem legyen
  tesztelve. Ez architekturális feladat, nem lokális storage-átnevezés.
- [ ] **L14 – `VITE_BACKEND_ORIGIN` dokumentáció és validáció.** A komment mondja
  ki, hogy minden `VITE_` érték bundle-public. Production build ne essen vissza
  csendben `127.0.0.1:3000` docs linkre; hiányzó kötelező origin build/startup
  hibát vagy dokumentált same-origin viselkedést adjon.
- [ ] **I3 – Node engine kikényszerítése.** A CI és helyi setup ugyanazt a pinelt
  Node 24 runtime-ot használja; package manager/engine strict beállítás hibázzon
  támogatott tartományon kívül.
- [ ] **I4 – Frontend coverage gate.** Kerüljön be coverage riport és a mért
  baseline-ra épülő regressziós küszöb. A `vmThreads` csak külön méréssel és
  stabilitási ellenőrzéssel kerüljön be; a gyorsulás nem írhatja felül a
  determinisztikusságot.

### FE-F5 lezárási kapu

- [ ] Production profilban a token nem kerül sessionStorage-ba.
- [ ] A választott auth architektúra login, refresh/recovery, logout és 401 tesztje zöld.
- [ ] Production build hibás/hiányzó origin konfigurációval nem készít félrevezető linket.
- [ ] A támogatott Node-verzió CI-ban és helyben kikényszerített.
- [ ] Typecheck, lint, contract check, coverage, unit/component és böngészős E2E zöld.
- [ ] `FINAL-FRONTEND-EVIDENCE.md` mind a 21 audit-ID-t eredménnyel felsorolja.

## Milestone Definition of Done

- [ ] FE-F1–FE-F5 minden lezárási kapuja teljes.
- [ ] Mind a 21 audit-ID pontosan egyszer szerepel az evidence-ben, nyitott vagy
  „majd egyszer” státusz nélkül.
- [ ] A production auth storage és nyelvi scope döntése dokumentált, tesztelt és
  összhangban van a deployment topológiával.
- [ ] Frontend build, typecheck, lint, contract drift, coverage, unit/component,
  axe és teljes böngészős E2E kapu zöld.
- [ ] A frontend minden fázis végén önmagában demózható és visszagörgethető
  állapotban maradt.

## Teljességi mátrix

| Audit-ID | Fázis | Lezárás fő típusa |
| --- | --- | --- |
| M1 | FE-F1 | holtkód-törlés + bundle ellenőrzés |
| L7 | FE-F1 | fixture/type konszolidáció + teszt |
| L8 | FE-F1 | közös validátor + teszt |
| L11 | FE-F1 | igazságforrás-konszolidáció |
| M2 | FE-F2 | error boundary + recovery teszt |
| L3 | FE-F2 | cache lifecycle javítás + teszt |
| L4 | FE-F2 | single-flight guard + timer teszt |
| L5 | FE-F2 | state refaktor + StrictMode teszt |
| L9 | FE-F2 | timeout/cancel policy + teszt |
| L2 | FE-F3 | auth policy + header teszt |
| L6 | FE-F3 | polling/frissesség + timer teszt |
| L10 | FE-F3 | backoff + recovery teszt |
| I2 | FE-F3 | explicit request metadata + konkurenciateszt |
| L12 | FE-F4 | accessibility javítás + axe teszt |
| L13 | FE-F4 | 404 nézet + router teszt |
| I1 | FE-F4 | adapter/migráció + guard teszt |
| I5 | FE-F4 | nyelvi döntés + egységesítés/i18n |
| L1 | FE-F5 | auth architektúra + security teszt |
| L14 | FE-F5 | env policy + build validáció |
| I3 | FE-F5 | runtime pin + CI gate |
| I4 | FE-F5 | coverage/performance gate |
