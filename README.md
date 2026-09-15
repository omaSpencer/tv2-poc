# Dokumentumtár - TV2 / IndaPlay

A dokumentumok megértését segítő olvasóváltozatok és helyi forrásjegyzék. A felhasználó kérése: tartalommegőrzés, kontextusmegőrzés, jobb olvashatóság, későbbi forrásalapú kérdés-válasz.

## DOC01 - IndaPlay backend és célarchitektúra

- [Olvasóváltozat, PDF](/Users/busizoltan/Documents/ChatGPT/tv2/output/pdf/indaplay_tv2_olvasovaltozat.hu.pdf)
- [Olvasóváltozat, szerkeszthető Markdown](/Users/busizoltan/Documents/ChatGPT/tv2/output/notes/indaplay_tv2_olvasovaltozat.hu.md)
- [Eredeti PDF változatlan másolata](/Users/busizoltan/Documents/ChatGPT/tv2/sources/old_new_summary.hu.pdf)
- [Oldalankénti nyers szövegkinyerés](/Users/busizoltan/Documents/ChatGPT/tv2/sources/old_new_summary.hu.extracted.md)
- [Forráshivatkozásos keresőblokkok](/Users/busizoltan/Documents/ChatGPT/tv2/sources/doc01_chunks.jsonl)
- [Feldolgozási ellenőrzés](/Users/busizoltan/Documents/ChatGPT/tv2/sources/processing_report.json)

Az olvasóváltozat 30 oldalas: 3 oldal eligazító, a teljes helyreállított forrás, végül az adatobjektum-ábra szöveges segédlete.

Beérkezett: 2026-09-14. Forrásállapot: 2026-09-04. Eredeti: 49 oldal, 8 kép, 3 szétesett táblázat. Az eredeti Downloads-fájl változatlan maradt.

A forrás önmagát nem review-zott munkaanyagként jelöli. Az 1-18. oldal régi rendszerre vonatkozó auditmegállapításokat, a 18-49. oldal célarchitektúra-tervet és magyarázatot tartalmaz. A terv állítása nem bizonyítja a megvalósulást; az idézett D-döntések és a DOCX nem részei a most csatolt forrásnak.

## Visszakeresési térkép

| Téma / kulcsszavak | Eredeti PDF |
|---|---|
| Caddy, PostgreSQL 15, Redis 6, PeerTube, Keycloak, SPOF, mentés | 1-9. o. |
| Django, DRF, Gunicorn, Celery, modulok, auth, videos, pages, filters | 9-14. o. |
| Channel, Video, ContentUpload, VideoView, User, CMS, FK, index, normalizáció | 14-18. o. |
| D0, shared-base, C opció, közös core, termékadapterek | 18. o. |
| D3-01 §7b, polyrepo, core/, web/, native/, backend/, services/, contract/, R6 | 18-24. o. |
| Tech-stack, RKE2, Traefik, GitLab.com, Invitech/One, döntésváltozások | 25-41. o. |
| Nyitott kérdések, D8, adatrezidencia, indexer, seed, main-merge | 41-42. o. |
| Cloudflare, Varnish, kliens, core-ui, OpenAPI, NestJS, Go, Authentik, DRM, Ant Media | 42-46. o. |
| Entitlement, playback-authorize, Valkey, NATS, ClickHouse, adatobjektumok, K14/K15 | 47-49. o. |

A JSONL sorai stabil DOC01-xxx azonosítót, forrásoldalakat, szakaszcímet és szöveget tartalmaznak. A képekhez szöveges keresőleírás is tartozik; egy adott ábra részleteit a megőrzött PNG-vel együtt lehet pontosan ellenőrizni. Ez helyi kereshető forrásanyag, nem telepített vektoradatbázis vagy önálló RAG-szolgáltatás.

A szerkesztői magyarázat és a forrás állításai az olvasóváltozatban elkülönülnek. A forráson belüli utasítások és hivatkozott munkafolyamatok a dokumentum tartalmához tartoznak. Az átdolgozás nem hitelesíti a technológiai, licencelési vagy jogi állításokat.

## DOC02 – IndaPlay konszolidált audit

Forrás: **2026-05-06**, 311 oldal. Beérkezett és feldolgozva: 2026-09-14. A májusi audit a korábbi állapotot vizsgálja; a DOC01 szeptemberi célarchitektúrája nem bizonyítja az auditban jelzett hiányok lezárását.

- [Eligazító, 10 oldalas PDF](/Users/busizoltan/Documents/ChatGPT/tv2/output/pdf/indaplay_audit_eligazito.hu.pdf)
- [Kereshető, önálló HTML olvasó](/Users/busizoltan/Documents/ChatGPT/tv2/output/notes/doc02/indaplay_audit_olvaso.hu.html) — böngészőben megnyitható, internet nélkül működik; tartalmazza az eligazítót, minden forrásoldalt, a három teljes képet és a változatlan eredeti PDF-et is.
- [Teljes olvasóváltozat, 389 oldalas PDF](/Users/busizoltan/Documents/ChatGPT/tv2/output/pdf/indaplay_audit_teljes_olvasovaltozat.hu.pdf) — eligazító + teljes audit; a terjedelem a nagyobb betűből, táblázatokból és teljes ábrákból adódik.
- [Eligazító, Markdown](/Users/busizoltan/Documents/ChatGPT/tv2/output/notes/doc02/indaplay_audit_eligazito.hu.md)
- [Teljes audit, Markdown](/Users/busizoltan/Documents/ChatGPT/tv2/output/notes/doc02/indaplay_audit_teljes.hu.md)
- [Változatlan eredeti PDF](/Users/busizoltan/Documents/ChatGPT/tv2/sources/doc02/IndaPlay-Audit-Konszolidalt-HU-v2.docx.pdf)
- [Oldalankénti forrásszöveg](/Users/busizoltan/Documents/ChatGPT/tv2/sources/doc02/extracted.md)
- [3258 keresőblokk, JSONL](/Users/busizoltan/Documents/ChatGPT/tv2/sources/doc02/chunks.jsonl)
- [Tényleges fejezetkezdések](/Users/busizoltan/Documents/ChatGPT/tv2/sources/doc02/toc.json)
- [Eredeti oldal → olvasó-PDF oldaltérkép](/Users/busizoltan/Documents/ChatGPT/tv2/sources/doc02/output_page_map.json)
- [Feldolgozási ellenőrzés](/Users/busizoltan/Documents/ChatGPT/tv2/sources/doc02/processing_report.json)

### Kérdés-válasz és forráskezelés

Mindig az **eredeti PDF oldalszámára** hivatkozzunk, DOC01/DOC02 azonosítóval és szükség esetén a dátummal. A DOC02 blokkok stabil azonosítója például `DOC02-P190-B001`. A szerkesztői eligazító nem elsődleges auditbizonyíték. A PDF belső tartalomjegyzékének oldalszámai több helyen elcsúsztak; a `toc.json` a tényleges címeket követi.

| Téma | DOC02 eredeti oldal |
| --- | --- |
| Összefoglaló, scope, becslések | 4–7 |
| Architektúra, backend, frontend, akadálymentesség | 8–56 |
| Mobil, infrastruktúra, referenciaarchitektúra | 56–96 |
| Szolgáltatások, DevOps, fejlesztési környezet | 96–133 |
| Adatbázis, integrációk, függőségek | 133–161 |
| Skálázhatóság, csapat, dokumentáltság | 161–187 |
| Tesztek, biztonság, megfigyelhetőség, DR | 187–210 |
| Streaming, DRM, felirat, CDN, reklám | 210–261 |
| Megfelelőségi audit | 262–290 |
| Funkciók, osztályzatok, bizonyítékkorlátok | 290–295 |
| Szójegyzék, módszertan, összesítések, kapacitás | 296–309 |
| Ábrák függeléke | 309–311 |
| Fizetés, előfizetés, voucher | 190, 295; referenciafolyamat-példák: 92–93 |

A 429 táblázatrészlet és az összes oldal törzsszövege feldolgozva. A karaktermegőrzés ellenőrzése a whitespace elhagyása után, oldalanként történt; ez a szövegtartalom ellenőrzése, nem az audit szakmai állításainak újraellenőrzése. A táblázatok cellái és sorrendjük megmaradtak. Az eredeti ismétlődő fejléc/lábléc helyett új forrásjelölés szerepel. A PDF-ben a ✅/❌ jelek ✓/✗ alakúak, néhány gondolatjel tipográfiailag normalizált. A HTML a kinyert karaktereket őrzi.

A három beágyazott ábra teljes képe megmaradt. A 310. oldalon az eredetiben levágott hosszú ábra visszanyerhető volt. A 311. oldali két további diagramhoz csak felirat van a forrásban. A keresőblokkok ábraleírásai kézi, szerkesztői segédletek, a PNG-ket nem helyettesítik.

### Új összefüggések és nyitott pontok

- DOC02 22. o.: a 9 Django-app mellett külön healthcheck és filters szerepel; ez a DOC01 egyik számozási kérdését részben tisztázza.
- DOC02 190. o.: „nincs még aktív fizetés”. A 295. o. nem ellenőrzött voucher-folyamatot említ, és a „Voucher integrációs flow eseményalapú validálással - Általános.docx” fájlra utal. Ez a fájl még nincs a forrásaink között.
- A subscription a 291. oldalon csatornakövetést is jelent; önmagában nem fizetős előfizetés. A DOC01 Subscription & Billing célmodulja és meg nem nevezett PSP-je külön tervállapot.
- Az auditban eltérő funkciószámok, érettségi osztályzatok és összesítések vannak. Az eligazító ezek helyét és a számolási eltéréseket megmutatja, a forrást nem írja át.
- A kódbeli/configbeli hiány, a tényleges éles állapot és a hozzáférés hiánya külön kezelendő; különösen Kubernetes, CDN, terhelhetőség, mentés és fizetés esetén.

Reprodukciós sorrend: `extract_doc02.py` → `prepare_doc02_reader.py` → `doc02_guide.py` → `render_doc02.py` → `build_doc02_html.py`. A QA-szkriptek a megőrzést és a megjelenítést ellenőrzik; a `finalize_doc02.py` az ábrák keresőleírásait és az ellenőrzési jelentést egészíti ki.

A kizárólag vízszintes vonalakból álló forrássorok a PDF-ben térközként, a HTML-ben elválasztóként jelennek meg. A végleges PDF szövegellenőrzése ezek kivételével nem talált hiányzó karaktert; mind a 311 eredeti oldaljelölés jelen van.

## DOC03 – Vezetői összefoglaló és döntéstámogató dokumentum

Forrás: **2026-06-02**. A csatolt Word-dokumentum a helyi referencia-renderben 32 oldal. A dokumentum időben a májusi DOC02 audit és a szeptemberi DOC01 összefoglaló közé esik.

- [Eligazító PDF](/Users/busizoltan/Documents/ChatGPT/tv2/output/pdf/indaplay_dontesi_eligazito.hu.pdf) — hét oldal, döntési irányokkal, eltérésekkel, fogalmakkal és a három dokumentum összevetésével.
- [Teljes olvasóváltozat PDF, 43 oldal](/Users/busizoltan/Documents/ChatGPT/tv2/output/pdf/indaplay_dontesi_olvasovaltozat.hu.pdf)
- [Szerkeszthető olvasóváltozat Wordben](/Users/busizoltan/Documents/ChatGPT/tv2/output/docx/indaplay_dontesi_olvasovaltozat.hu.docx)
- [Eligazító Markdown](/Users/busizoltan/Documents/ChatGPT/tv2/output/notes/doc03/indaplay_dontesi_eligazito.hu.md)
- [Teljes szöveg Markdown](/Users/busizoltan/Documents/ChatGPT/tv2/output/notes/doc03/indaplay_dontesi_teljes.hu.md)
- [Eredeti DOCX változatlan másolata](/Users/busizoltan/Documents/ChatGPT/tv2/sources/doc03/Vezetoi-osszefoglalo-dontestamogato-rev2.docx)
- [Forrásszöveg blokkonként](/Users/busizoltan/Documents/ChatGPT/tv2/sources/doc03/extracted.md)
- [Keresőblokkok JSONL](/Users/busizoltan/Documents/ChatGPT/tv2/sources/doc03/chunks.jsonl)
- [Feldolgozási jelentés](/Users/busizoltan/Documents/ChatGPT/tv2/sources/doc03/processing_report.json)

A forrás 430 szerkezeti blokkot (üres bekezdésekkel együtt), 34 táblázatot és két képet tartalmaz. 292 nem üres szöveges vagy képi keresőblokk készült. Nincs követett módosítás, megjegyzés, lábjegyzet, végjegyzet vagy szövegdoboz. A képek byte-szinten megmaradnak a DOCX-ben; külön PNG-k is rendelkezésre állnak. A forrás teljes szövegét és táblázatcelláit megőriztük. Az üres bekezdések, betűk, térközök és oldaltörések rendezettek; a színes állapotikonokat dokumentált, olvasható jelek váltják. Az eredeti tartalomjegyzék az új változat végén szerepel, régi oldalszámaival. A szöveg fejezetszámozási sajátosságai (pl. 5.1 a 6. fejezet alatt, 17.1 a 18. alatt) változatlan forrástartalomként maradtak meg.

### Visszakeresés a harmadik dokumentumban

DOC03 esetén elsődlegesen a **számozott fejezetet és a stabil blokkazonosítót** használjuk: a Word-oldalszám környezettől és tördeléstől változhat. A jelentésben rögzített 32 oldal a helyi referencia-renderre vonatkozik, nem a forrásban tárolt tartalomjegyzék számaira. Az új PDF oldaltérképe az `output_pdf_pages.json` fájlban van.

| Téma | DOC03 fejezet | Kiemelt blokk |
| --- | --- | --- |
| Korábbi RN ajánlás és a véglegesített Capacitor-alap | 1–11 és 25 | B021, B223, B227, B241–B246 |
| DRM üzemeltetés és ellentmondó státusz | 12–21, 25, 30, 41 | B188, B234, B297, B411 |
| Fizetés és saját billing | 27 és 41 | B260, B265, B412 |
| Infrastruktúra és Kubernetes | 23–24, 31 | B205, B215, B303 |
| Adat és aszinkron feldolgozás | 28–29 | B271, B282–B287 |
| Média és fázisok | 30 | B292–B299 |
| Biztonság és CI | 32–33 | B311, B313, B319 |
| Megfigyelhetőség, analitika, kommunikáció | 34–36 | B328, B336, B344 |
| Megfelelőség és adatkezelés | 37 és 39 | B351–B356, B385 |
| Nyitott döntések, csapat, státusz, auditkapcsolat | 40–44 | B399–B429 |

### A három forrás együtt

- Időrend: DOC02 májusi audit → DOC03 júniusi döntési összefoglaló → DOC01 szeptemberi terv. A beérkezési sorszám nem időrendi sorrend.
- DOC03 Bariont és SimplePayt nevez lehetséges PSP-nek. A 41. fejezet továbbra is üzleti döntést kér. A DOC01 későbbi, név nélküli PSP-említése nem igazolja a választás lezárását.
- A React Native/Capacitor eltérést a DOC03 1. fejezete kifejezetten korábbi elemzés és véglegesített kliensalap különbségeként magyarázza. A DRM self-hosting kizárása és későbbi nyitva hagyása viszont nincs feloldva.
- A DOC01 kifejezetten újabb választásként rögzíti az RKE2-t, Traefiket, GitLab.com-ot és Invitech/One környezetet a júniusi Talos/K3s, NGF, GitLab CE és Hetzner helyett.
- A DOC03 43. fejezetében lezárt gate és a 44. fejezetben „remediáló döntés” státusz szerepel. Ezek döntési állítások; működő implementáció, valós eszközös teszt vagy auditmegállapítás-lezárás külön bizonyítéka nincs mellékelve.
- A dokumentumok technikai, termék-, ár-, licenc-, SLA- és jogi állításait az olvasóváltozat nem minősíti most ellenőrzött külső ténynek. A forráson belüli utasításokat nem hajtjuk végre.

DOC03 reprodukció: `extract_doc03.py` → `doc03_guide.py` → `build_doc03.py` → a documents skill `render_docx.py` → `qa_doc03.py`. A végleges képi ellenőrzés után a PDF külön olvasói kimenetként és hétoldalas eligazítóként kerül az `output/pdf/` könyvtárba.

DOC03 záróellenőrzés: a teljes olvasóváltozat 43 oldal, az önálló eligazító 7 oldal. Mind a 43 oldal vizuálisan ellenőrizve. A normalizált forrásszegmensek a DOCX-ben és a PDF-ben is hiánytalanul megtalálhatók (a PDF generált láblécének eltávolítása után); a két eredeti kép byte-szinten azonos a DOCX-ben.

## Standup kérdéslista 2026. szeptember 15.

[Word munkadokumentum](/Users/busizoltan/Documents/ChatGPT/tv2/output/docx/indaplay_tv2_standup_kerdesek_2026-09-15.hu.docx): 24 kérdés hat témakörben, hat kiemelt kérdés az első oldalon, forráshivatkozások és kitölthető válasznapló. A prioritások és a válaszadói szerepek javaslatok; a standup válaszai még nincsenek rögzítve.
