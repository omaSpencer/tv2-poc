# Frontend Fázis 4 – Operációs megfigyelő dashboard

2026-09-16 · Delivery brief.

## 1. Eredmény

Az `ops:read` jogosultságú felhasználó egy oldalon látja az outbox, relay,
broker, consumerek, karantén és A/B indexek aktuális állapotát. A felület
read-only: nem indít reindexet, replayt vagy repairt.

Backend-bővítés nem kell. Forráscontract:
`GET /admin/processing-status` és a generált `ProcessingStatusView`.

## 2. Megjelenítési szerződés

### 2.1 Összesített keresési állapot

Kizárólag a backend `routeEligible` mezőiből:

| Routolható indexek | Címke |
| ---: | --- |
| 2 | teljes A/B rendelkezésre állás |
| 1 | fallback / csökkent redundancia |
| 0 | keresés nem routolható |
| `indexes` hiányzik | keresési állapot nem elérhető ebben a konfigurációban |

A frontend nem alkot második readiness algoritmust `phase`, `state` és
`reachable` mezőkből. Ezek diagnosztikai magyarázatként látszanak.

### 2.2 Kártyák és táblák

- Outbox: pending, oldestOccurredAt, oldestAgeMs emberi idővel.
- Relay: enabled, state, lastDeliveredAt, lastErrorCode. `enabled=false` = „off”,
  nem automatikusan hiba.
- Broker: connected, streamPresent; null = még nem ismert.
- Consumerek: name, pending, ackPending, ackFloorStreamSequence,
  oldestUnfinishedAt/Age. Hiányzó tömb és `consumersUnavailable=true` külön.
- Karantén: pending; nulla semleges, pozitív figyelmeztetés és későbbi Fázis 5
  link helye.
- Index A/B: state, durable, reachable, in-flight event/task, last ack/error,
  phase, desired worker state, runId, import progress, S0/H/S1 határok,
  timestamps és routeEligible.

Minden relatív idő mellett pontos ISO érték tooltipben vagy disclosure-ben. A
nyers JSON csak „Technikai részletek” alatt jelenik meg.

## 3. Munkacsomagok

### P4-01 — Operations route és permission boundary

- route `/operations`;
- `RequirePermission('ops:read')`;
- 401 a session flow-ba, 403 magyarázott oldal;
- direct URL ugyanúgy védett, mint a navigáció;
- a backend guard marad az autoritatív határ.

### P4-02 — Normalizált view model és formázók

- `formatDurationMs`, `formatTimestamp`, `progressPercent` pure helper;
- null/optional mezőkre `nincs adat`, nem nulla;
- progress: expected null/0 esetén nincs százalékos osztás;
- stream/outbox sequence egész számként, lokalizált ezres tagolással;
- error code változtatás nélkül, emberi kiegészítő címkével.

### P4-03 — Overview és service kártyák

- összesített routeEligible banner;
- outbox/relay/broker/quarantine kártyák;
- a szín mellett ikon és szöveg;
- utolsó frissítés és manuális refresh;
- stale adatnál a régi érték megmaradhat „Elavult” jelzéssel, nem vált nullára.

### P4-04 — Consumer tábla

- desktop tábla, mobil kártyák;
- pending és ackPending külön;
- consumers unavailable callout;
- üres lista jelentése „nincs jelentett consumer”, nem „minden rendben”;
- nincs kliensoldali, dokumentálatlan riasztási küszöb.

### P4-05 — A/B indexkártyák

- A és B azonos komponensből;
- runtime state és tartós phase külön címke;
- routeEligible kiemelt;
- import progress szám és progressbar, ha expected ismert és pozitív;
- S0/H/S1 technikai disclosure;
- runId másolható;
- in-flight event/task és utolsó hiba látható;
- `retrying`, `halted`, `paused`, nem reachable vizuálisan elkülönül.

### P4-06 — Adaptív polling

- alap: 10 másodperc;
- aktív: 2 másodperc, ha relay `publishing|retrying`, index `processing|retrying`,
  vagy phase nem `ready|failed|null`;
- `document.visibilityState !== 'visible'` esetén polling leáll;
- fókuszba visszatéréskor azonnali refetch;
- egyidejű requestek nem halmozódnak;
- 401/403 esetén polling leáll;
- 503/network hibánál exponenciális, legfeljebb 30 másodperces backoff és kézi
  retry; a legutolsó sikeres adat stale jelzéssel megmarad.

### P4-07 — Hiba és részleges állapot

- teljes endpoint hiba: oldalszintű ProblemDetails;
- optional `consumers`, `quarantine`, `indexes` hiánya komponensenkénti „nem
  elérhető”, nem render crash;
- `connected=false` és `streamPresent=null/false` jelentése külön;
- mindkét index routeEligible=false esetén soha nincs healthy címke;
- raw JSON render csak explicit nyitásra.

### P4-08 — Teszt és átadás

- helper unit: ms, null, progress edge;
- minden relay/index state és reindex phase komponensfixture;
- 2/1/0/hiányzó routeEligible összesítés;
- optional response mezők;
- polling fake timer + visibility API;
- 401/403/503/network/stale data;
- keyboard és screen reader címkék;
- E2E: publisher dashboard, egy index down fallback, mindkettő down unavailable.

## 4. Becslés és függőség

- 3–4 mérnöknap.
- Függőség: Fázis 0 pontos processing contract, Fázis 1 permission route.
- Fázis 5 a komponenseket újrahasználja, ezért a view model és indexkártya ne
  tartalmazzon mutációs logikát.

## 5. Definition of Done

- [x] Minden processing response mező UI-n vagy technikai disclosure-ben látszik.
- [x] Összesített search állapot kizárólag `routeEligible` alapján készül.
- [x] Off/unknown/down és optional-hiány nem mosódik össze.
- [x] Polling adaptív, háttértabon áll, hibán nem terheli túl a backendet.
- [x] 401/403/503 és stale data állapot hozzáférhetően kezelve.
- [~] A/B fallback és teljes kiesés fixture/component szinten bizonyított; a
  valódi backend+browser E2E külső futtatása még nyitott.

Helyi átadás: 52 új operációs teszt, teljes frontend `verify` 19 fájlban 106/106
teszttel zöld (contract, build, React Compiler és lint kapukkal együtt).
