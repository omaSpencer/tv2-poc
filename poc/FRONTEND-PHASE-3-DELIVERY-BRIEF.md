# Frontend Fázis 3 – Publikus katalógus és keresés

2026-09-16 · Delivery brief.

**Állapot:** a frontend implementáció és a helyi tesztkapuk elkészültek. A valódi
backenddel futó böngészős E2E ellenőrzés még nyitott.

## 1. Eredmény

Anonim felhasználó megosztható URL-ből keres, kategóriát szűr, lapoz és publikus
tartalomrészletet nyit. A felület pontosan különválasztja az index becsült
találatszámát a DB-ből ténylegesen visszaadott elemektől, és érthetően kezeli az
A/B fallbacket, a teljes keresési kiesést és a publish utáni indexelési késést.

Backend-bővítés nem kell. Forráscontract:

- `GET /catalog/search?q&category&limit&offset`;
- `GET /catalog/contents/:id`;
- generált `CatalogSearchView` és `PublicContentView` típusok.

## 2. Rögzített UX-döntések

- Route-ok: `/catalog/search` és `/catalog/:id`.
- A teljes querymodell az URL-ben él; refresh/back/forward megőrzi.
- Alap limit 20; választható 10/20/50, a backend 1–100 szerződésén belül.
- Offset 0–1000; a következő gomb nem vihet a felső korláton túl.
- Új keresés, kategória- vagy limitváltás offsetet 0-ra állít.
- A fő találatszám szövege: „Az index becslése: N”; mellette „Ezen az oldalon: M”.
- `returned < min(limit, max(estimatedTotalHits - offset, 0))` esetén rövid
  magyarázat jelzi, hogy időközben visszavont/stale index-találat kieshetett.
- Publikus kártya kizárólag a public view mezőit használja; `mediaAssetId`, actor,
  version és audit nem jelenhet meg.
- A frontend nem próbálja kitalálni, melyik index szolgálta ki a választ, mert a
  jelenlegi search response ezt nem közli.

## 3. Munkacsomagok

### P3-01 — Route- és URL-query adapter

- typed parse/serialize `q`, `category`, `limit`, `offset` mezőkre;
- ismeretlen URL paraméter megőrzése nem szükséges;
- hibás URL-érték biztonságos alapértékre normalizálódik és `replace`-szel
  kanonikus URL készül;
- keresés submit debounced typing helyett explicit vagy 300–500 ms debounce;
- TanStack query key a normalizált URL-modellből készül.

### P3-02 — Találati lista és lapozás

- loading skeleton, empty state, stale-data refresh jelzés;
- responsive card/grid;
- title, summary, category, tags, publishedAt;
- előző/következő gomb és aktuális offset tartomány;
- lapozáskor fókusz a találati címre kerül, nem az oldal tetejére;
- category filter a backend enum magyar címkéivel, API-érték változatlanul.

### P3-03 — Publikus detail

- közvetlen URL-ről betölthető;
- 404 „nem található vagy már nem publikus” üzenet;
- kereséshez visszalink az előző query megőrzésével;
- technikai ID opcionális disclosure-ben;
- admin/session nem feltétel.

### P3-04 — Hiba- és kiesési állapotok

| Eset | UI |
| --- | --- |
| 422 query | hibás szűrő jelölése + URL javítási lehetőség |
| 404 detail | publikus not-found oldal |
| 503 `search_unavailable` | mindkét index kiesett; retry |
| 503 `dependency_unavailable` | háttérszolgáltatás nem elérhető; retry |
| network/timeout | kapcsolat hiba; retry |
| egy index kiesik | normál találati UI, mert a backend fallbackje sikeres |

Sikeres 200 választ a frontend nem minősít degradáltnak csak becslésből.

### P3-05 — Publish utáni indexelési visszajelzés

A content detailből publish után indítható, de nem globális search viselkedés:

- célzott keresés vagy publikus detail polling legfeljebb 30 másodpercig;
- 1 s → 2 s → 3 s, majd 3 s periódus;
- tab háttérbe kerülésekor szünet;
- megtaláláskor „Megjelent a katalógusban”;
- timeout nem publish failure: „A publikálás sikerült, az indexelés még tart”;
- withdraw után hasonló, rövid idejű eltűnés-ellenőrzés csak demó/szerkesztői
  visszajelzéshez.

### P3-06 — Teszt és átadás

- URL parser/serializer unit;
- komponens: empty, short page, normal page, offset edge;
- 422/404/kétféle 503/network;
- adatminimalizálási snapshot: adminmező nem renderelődik;
- polling success/timeout/hidden-tab fake timerrel;
- E2E: anonim search → filter → next → detail → back;
- E2E: published látható, withdrawn stale index mellett sem látható.

## 4. Becslés és függőség

- 2–3 mérnöknap.
- Függőség: Fázis 0 contract gate.
- A role-aware navigációhoz Fázis 1 hasznos, de a publikus flow attól függetlenül
  implementálható és tesztelhető.

## 5. Definition of Done

- [x] Query/filter/lapozás bookmarkolható URL-ből működik.
- [x] `returned` és `estimatedTotalHits` jelentése nem keveredik.
- [x] Public detail nem szivárogtat adminmezőt.
- [x] 404, 422, 503 és network állapot külön kezelve.
- [x] Polling korlátozott, háttértabon szünetel, timeout nem hamis publish hiba.
- [~] Anonymous flow komponens-integráció és hozzáférhető fókuszkezelés zöld;
  valódi browser/full-stack E2E pending.

## 6. Megvalósítási bizonyíték

- typed, kanonizáló URL-adapter `q`, `category`, `limit`, `offset` mezőkkel;
- responsive publikus kártyák és detail kizárólag `PublicContentView` mezőkből;
- külön 422, 404, `search_unavailable`, `dependency_unavailable` és network UX;
- 30 másodperces 1 s → 2 s → 3 s polling, rejtett tabon aktív idő- és request-szünettel;
- anoním search → filter → next → detail → back komponens-integráció;
- teljes frontend kapu: contract, build, React Compiler, warningmentes lint és
  54/54 teszt.
