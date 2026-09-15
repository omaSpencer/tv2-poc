# PoC milestone-terv

2026-09-15 · Rendezett tervezési alap a [README](README.md) és [DECISIONS](DECISIONS.md) szerint.

Státusz: **M0 és M1 implementálva** (lásd [M0–M1 futtatási jegyzőkönyv](M0-M1-EVIDENCE.md)); M2–M6 lezárási feltételei még nincsenek teljesítve. A README a scope és a technológiai határok alapja, ez a dokumentum a megvalósítás sorrendjét és ellenőrzési pontjait bontja ki. Egyelőre high level terv, nem részletes implementációs backlog.

A fázisok működési forgatókönyvei, döntési pontjai és részletes elfogadási feltételei: [Részletes fázisterv](PHASES.md).

Az M0 feladatszintű lebontása, technológiai verziópinnel és smoke-check listával: [M0 implementációs terv](M0-IMPLEMENTATION.md). A további részletes tervek: [M1 – Tranzakciós CMS-életciklus](M1-IMPLEMENTATION.md) és [M2 – Identity](M2-IMPLEMENTATION.md).

## Cél és sorrend

A kötelező végállapot: valódi belépés → szerkesztés → publikálás → tartós eseménykézbesítés → két keresőindex → nézői keresés → visszavonás, reprodukálható kiesési és helyreállási demóval.

`M0 → M1 → M2 → M3 → M4 → M5`

Az opcionális `M6` az alapfolyamat lezárása és a külső teszthozzáférések megléte után következik. Az identity konfiguráció előkészítése már M0-ban indulhat. A modulok minden milestone végén ugyanabba az alkalmazásba integrálódnak.

| Milestone | Elérendő eredmény | Relatív munkanap | Státusz |
| --- | --- | --- | --- |
| M0 – Alap és szerződések | Core környezet, konfiguráció, contracts, smoke | 1–4. | ✅ kész (image-digest nyitott) |
| M1 – Tranzakciós CMS | Életciklus, audit, outbox, konkurencia és rollback | 5–8. | ✅ kész |
| M2 – Identity | Authentik és valós tokenes szerkesztés/publikálás | 9–10. | terv kész, implementáció nyitott |
| M3 – Eseményút | JetStream és kiesés utáni kézbesítés | 11–12. | nyitott |
| M4 – Keresés | Két index, fallback, retry és karantén | 13–15. | nyitott |
| M5 – Bizonyítás | Reindex, helyreállás, mérés, átadás | 16–17. | nyitott |
| Tartalék | Feltárt integrációs hibák és újraellenőrzés | 18–19. | nyitott |
| M6 – Média/playback | Opcionális, külön külső előfeltételekkel | Külön második kör | nyitott |

**Döntés: 17 munkanap + 2 nap tartalék**, a tényleges kezdéstől, körülbelül napi 6 óra érdemi munkával. Nem feltételez két egyidejű agentet. M0 18 óra 20 perc kötelező munkája és M1 14–22 órás becslése mellett így review-ra és integrációra is marad hely. M2–M5 időkerete tervezési keret, amelyet a saját részletes tervükben ellenőrzünk; nem már bizonyított becslés vagy határidővállalás.

A korábbi ötnapos cél helyébe ez a keret lép. M0 full szolgáltatásainak tényleges indítása a megfelelő M2/M3/M4 fázisba került. A fázisok eredménykapui nem változnak: hiba esetén javítunk és szükség szerint átütemezünk, a kötelező bizonyítékokat nem hagyjuk el.

## M0 – Indítható alap és közös szerződések

**Cél:** közös, reprodukálható kiindulópontot készíteni a fejlesztéshez.

- NestJS-váz, konfigurációellenőrzés, `.env.example`, helyi Compose és indítási útmutató.
- Modulhatárok és a közös fájlok gazdáinak kijelölése: contracts, package manifest, lockfile, Compose, migrációs sorrend.
- Content-mezők, állapotátmenetek, várt verzió, hibaválaszok és v1 eseményburkolat rögzítése.
- Authentik provider, tesztkliens és tesztidentitások előkészítése; külső médiahozzáférés igényének feljegyzése.
- Kompatibilis függőségverziók és konténerverziók ellenőrzése a megvalósítás kezdetén.

Feladatokra bontva, becslésekkel és ellenőrző listával: [M0 implementációs terv](M0-IMPLEMENTATION.md).

**Lezárás:** dokumentált parancsokkal indul az alkalmazás és a helyi PostgreSQL; hibás kötelező konfigurációra érthető indítási hiba keletkezik. Az adat-, HTTP- és eseményszerződés első változata review-zható. A később bekötött szolgáltatások konfigurációs helye ismert.

## M1 – Tranzakciós CMS-életciklus

**Cél:** a tartalomkezelés üzleti szabályai és tranzakciós határa működjön PostgreSQL-en.

- Content-, audit- és outbox-migrációk; ContentModule és DatabaseModule.
- Draft létrehozás, draft/withdrawn szerkesztés, publikálás, visszavonás és újrapublikálás.
- Kötelező mezők ellenőrzése, publikált tartalom szerkesztésének tiltása, optimista verziókezelés.
- Állapotváltáskor tartalom, audit és outbox egy tranzakcióban; a relay még nem szükséges.
- Nyilvános részletlekérés kizárólag aktuálisan publikált tartalomhoz; DTO-k és OpenAPI.

**Lezárás:** integrációs ellenőrzéssel bemutatható az életciklus, a `409` verzióütközés és az atomi rollback. Visszavont tartalom nyilvános részletlekérése `404`.

**Demóhatár:** a valódi identity bekötéséig az üzleti működés integrációs tesztből ellenőrizhető. Hitelesítés nélküli admin API nem elfogadott milestone-demó.

## M2 – Valódi identitás és jogosultság

**Cél:** ugyanazt a CMS-folyamatot valódi felhasználókkal és alkalmazásjogokkal végigjárni.

- Authentik OIDC provider, Authorization Code + PKCE tesztkliens és dokumentált claim/permission mapping.
- Access token ellenőrzése discovery/JWKS alapján; JWT- és permission guard, `/me`.
- Viewer, editor és publisher tesztidentitások; az admin olvasás jogának explicit rögzítése.
- Token-élettartam, refresh, JWKS cache és visszavonási ablak dokumentálása.

Feladatokra bontva, becslésekkel és kétszintű ellenőrzési tervvel: [M2 implementációs terv](M2-IMPLEMENTATION.md). A részletes becslés 14 óra 45 perc, tehát nagyjából fél munkanappal túllépi az itt adott két napot; a különbözet a tartalékkeretből jön.

**Lezárás:** az editor létrehoz és szerkeszt, a publisher publikál és visszavon, a viewer tiltott írása `403`. A hibás tokenek ellenőrzése megvan: lejárat, issuer, audience, aláírás és ID token API-s használata. A refresh működik.

**Demó:** M2 lezárására legalább egy tartalom valós access tokennel publikálható, és nyilvánosan lekérhető. Signing-key rotáció és IdP-kiesés végleges bizonyítéka legkésőbb M5-re készül el.

## M3 – Tartós eseményút

**Cél:** a CMS sikeres írása után az esemény kézbesítése újraindítás és átmeneti NATS-kiesés mellett is folytatható legyen.

- Dedikált JetStream adapter, CONTENT stream és rögzített retention/kapacitáskorlátok.
- Egyetlen outbox relay, stabil eventId és kézbesítettnek jelölés kizárólag publish ACK után.
- Külön durable pull consumerek előkészítése A és B számára, explicit ACK-kezeléssel.
- Correlation ID, outbox pending és oldest-age megfigyelés; API-readiness leválasztása a keresési feldolgozás állapotáról.

**Lezárás:** NATS-kiesés alatt a CMS-írás sikeres, az esemény outboxban marad; visszatéréskor kézbesítés történik. Publish ACK után megszakított relay ugyanazzal az eventId-val újraküldhet. Az eseményút előrehaladása megfigyelhető.

**Integrációs határ:** a valós keresőindex és a duplikáció végállapotra gyakorolt hatásának bizonyítása M4–M5 feladata. Tesztfogyasztó nem helyettesíti ezt.

## M4 – Kereshető katalógus két indexszel

**Cél:** elkészüljön az első teljes üzleti út, független keresőfeldolgozással és olvasási fallbackkel.

- Két Meilisearch-példány, példányonként külön soros feldolgozó és durable consumer.
- Projekció PostgreSQL aktuális állapotából: published esetén upsert, egyébként törlés.
- Következő indexművelet és consumer ACK csak sikeresen befejezett Meilisearch task után.
- Időkorlátos A → B olvasási fallback; mindkét index kiesésekor `503`.
- Találatazonosítók publikálási állapotának visszaellenőrzése és nyilvános metaadatok kiolvasása PostgreSQL-ből.
- Átmeneti indexhibák késleltetett retry-a; hibás séma külön karanténstreambe, ACK-val igazolt karanténpublikálással.

**Lezárás:** publikálás után a tartalom mindkét indexben kereshető, visszavonás után nyilvánosan nem látható. A és B külön kiesését bemutatjuk: az egészséges feldolgozó halad, a visszatérő felzárkózik. Mindkét index kiesésekor keresésre `503`, CMS-írásra továbbra is siker érkezik. Sikertelen task nem kap sikeres consumer ACK-t.

**Demó:** belépés → draft → publikálás → keresés → részletlekérés → visszavonás, majd egy index kiesése és visszatérése. Lemaradó fallback-indexből hiányzó találat és szűrés után rövidebb oldal a dokumentált PoC-korlát része.

## M5 – Helyreállás és bizonyítékok

**Cél:** a teljes folyamat működése és hibákból való visszaállása megismételhető legyen.

- Relay-leállás publish ACK után; consumer-leállás indexírás után, ACK előtt; duplikáció és redelivery.
- Régi publish esemény replay-e visszavonás után; retry és poison-message karantén külön próbája.
- PostgreSQL-alapú teljes reindex, az érintett élő fogyasztó koordinált megállításával és catch-up lépéssel; közben érkező módosítások ellenőrzése.
- Signing-key rotáció, ismert JWKS-kulcs melletti IdP-kiesés, ismeretlen kulcs és új login viselkedése.
- Liveness, readiness, védett processing-status; eventId/correlation ID követhetőség és titokmentes logolás ellenőrzése.
- Friss környezetből indítás, demóparancsok, hibaindukálási és helyreállási lépések.
- Kis terhelésmérés a README fixture-javaslatából: publikálás → kereshetőség, indexenkénti lag és reindexidő.

**Lezárás:** a README teljes PoC-zárási elfogadási listájához tartozik ellenőrizhető eredmény. A jegyzőkönyv rögzíti a környezetet, verziókat, mérési paramétereket és eredményeket; elkülöníti a megvalósított, szimulált, tervezett és nem tesztelt elemeket. Sikertelen kötelező ellenőrzés mellett a PoC nem tekinthető lezártnak.

**Átadandó:** futtatási útmutató, végigjárható demó, helyreállási útmutató, mérési és tesztjegyzőkönyv, valamint a következő kör prioritásos backlogja. A mérés fejlesztői baseline; termelési kapacitás vagy HA igazolása továbbra is külön munka.

## M6 – Opcionális média- és playback-szerződések

**Belépési feltétel:** az alapfolyamat lezárt, és a választott külső próbához rendelkezésre áll a tesztkörnyezet és hozzáférés.

- Ant Media adapter: tesztasset állapotának és manifest-hivatkozásának lekérése, saját és szolgáltatói azonosító szétválasztása, média-készállapot publikálási ellenőrzése.
- Delivery policy szerződés a README AES-128 / multi-DRM fázisaival. Valódi DRM-próba külön feladat a sandbox, packager, kulcs-/licencszolgáltatás és player függőségeivel.
- Go playback-authorize bemeneti/kimeneti szerződés és entitlement snapshot példa; a hot path későbbi implementáció.

**Lezárás:** a kiválasztott részfeladathoz review-zható szerződés vagy reprodukálható adapterpróba készül. A fake adapter és a konfigurációs feature flag külön jelölést kap; ezek nem igazolnak valódi média- vagy DRM-integrációt. M6 nem feltétele a alap-PoC elfogadásának.

## Döntések és következő munka

A tartalomminimum, slug, szerepek, audit/verzió/esemény, core/full határ, smoke és ütemezés a [DECISIONS](DECISIONS.md) alapján rendezett. Az M0 és M1 részletes terve ugyanezt követi. A jövőbeli fázisok konfigurációs alapértékei és reindex/elfogadási szabályai is ott találhatók.

Futással meghatározandó eredmény: pontos kompatibilis pinlista M0-ban; tényleges OIDC provideradat M2-ben; mérések M5-ben; külső teszthozzáférések M6 előtt. Ezek kijelölt feladatok, nem újabb nyitott üzleti döntési körök.

Következő lépés az M2 implementáció a rögzített terv szerint. Az M0 és M1 lezárva; az M2–M6 checklistje még nem teljesített.
