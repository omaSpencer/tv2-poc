# PoC – rögzített döntések

2026-09-15 · A felhasználó „fixáld … döntsünk és rendezzünk mindent” felhatalmazása alapján rögzített tervezési alap. A döntés lezárása nem implementációs vagy futási bizonyíték.

Ez a dokumentum az M0–M1 review-ban felmerült eltéréseket lezárja, és a későbbi fázisokhoz is alapértékeket rendel. Az M0/M1 implementációs tervek ezek részletes kibontásai. A konkrét dependency-pin, provideradat és mérési eredmény a kijelölt megvalósítási lépés kimenete; ezeket nem helyettesítjük feltételezett tényekkel.

## D01 – Scope, ütemezés és gazdák

Az alap-PoC M0–M5, M6 külön második kör. A korábbi ötnapos cél helyett **17 munkanapos tervezési keret + 2 nap tartalék** érvényes. M0: 1–4., M1: 5–8., M2: 9–10., M3: 11–12., M4: 13–15., M5: 16–17. munkanap. Ez relatív ütemezés a tényleges kezdéstől, napi körülbelül 6 óra érdemi munkával; nem naptári vagy szolgáltatási vállalás. M2–M5 időkerete tervezési keret, részletes becslésük a saját tervük elkészültekor ellenőrzendő. Túlfutásnál az ütemezést módosítjuk, a kötelező hibapróbákat nem hagyjuk el.

A terv nem feltételez egyszerre két dolgozó agentet. A gazda a szerző/review felelősségét jelenti, nem automatikus delegálást. Codex: alkalmazás, contracts/http és events, adatbázis/migráció, package/lockfile, config, `.env.example`, smoke-runner. Claude: Compose, identity/permission mapping, backend runbook és később search; kölcsönös review. A helyi ágak alapértelmezett neve `codex/m0-base`, illetve a másik szerző saját ágkonvenciója. Gazdától eltérő szerző a változtatást review-ra előkészítheti.

## D02 – M0-kapu és környezet

M0 kötelező eredménye a core PostgreSQL és alkalmazás indítása, konfiguráció, migrátor, közös szerződések és core smoke. A full Compose definíció és verziórögzítés elkészül M0-ban, **az elindítása nem kapu**. Authentik indulása/provider/tesztidentitás M2, NATS indulása M3, Meilisearch indulása M4. A full smoke ezek után összegezhető. Sem a core smoke, sem annak verziórögzítése nem függ a full futási sikerétől.

A readiness a PostgreSQL-t vizsgálja. NATS/Meili hibája a feldolgozási állapotban és az érintett végpontban látszik. A helyi identity-konfiguráció és ellenőrző adapter hiánya bekapcsolt identity mellett indítási hiba; IdP hálózati kiesése nem globális readiness-hiba.

## D03 – Toolchain és migráció

Választott első út: Node 24, NestJS 12, ESM, TypeScript 6, Vitest; Drizzle ORM + pg és Drizzle Kit custom SQL migráció. M0-02-ben 120 perces kompatibilitási spike készül. A pontos elérhető patchverziókat, peer-függőségeket, generátorkövetelményeket és image-digesteket ott ellenőrizzük és pineljük. A korábbi dokumentumbeli pinjelöltek nem ellenőrzött lockfile-ok.

Fallback sorrend: v12 ESM → v12 CommonJS/Jest → v11 CommonJS/TS5/Jest. A teljes csomagkészlet együtt változik. A 120 perc a teljes spike kerete; ha egyik út sem bizonyított, az eredmény no-go és dokumentált technikai akadály, nem automatikusan sikeres fallback. A további munka a tartalékkeretet használja.

A migráció fájlformátumát és nyilvántartását a pinelt Drizzle Kit kezeli. Nincs saját sorszámozó/migrációs napló és általános down-ígéret. `db:reset` kizárólag explicit eldobhatónak jelölt teszt-DB-t építhet újra; normál DATABASE_URL nem lehet implicit célpont. A content/audit/outbox migráció M1-02. Tranzakciós rollback kötelező, ettől függetlenül.

## D04 – Tartalom és láthatóság

Az [M1 terv](M1-IMPLEMENTATION.md) 2–5. szakasza a választott tartalomszerződés: drafthoz cím, publikáláshoz cím/slug/summary/category/mediaAssetId szükséges, tagek opcionálisak. A mezőhosszok, null/PATCH-normalizálás és a kötött hat kategória az ott leírt értékek.

Slug csak publikáláskor generálódik, ha null; üres transzliteráció 422, kézi slug kérhető. Globális egyediség, végleges hossz legfeljebb 80; összesen 50 jelölt (alap, -2…-50). Kézi ütközés 409. Draft/withdrawn szerkeszthető, published nem. Visszavonás önmagában nem szabadítja fel a slugot; explicit módosítás felszabadítja a régi értéket, nincs történeti foglalás vagy átirányítás.

A nyilvános válasz: id, title, slug, summary, category, tags, publishedAt. **mediaAssetId csak adminmező.** A keresőprojekció: id, title, summary, category, tags, aggregateVersion; nincs külön slug- vagy médiaazonosító-mező. A keresési válasz a DB-ből kapja a nyilvános nézetet.

## D05 – Verzió, audit és esemény

Létrehozás v1 + created audit; tényleges szerkesztés +1 + updated audit, esemény nélkül. Publish/withdraw/republish +1, audit és outbox egy tranzakcióban. Republish típusa content.published. No-op sem verziót, sem auditot/eseményt/időbélyeget nem változtat.

Ellenőrzési sorrend: hozzáférés és kérésforma → rekordlétezés → expectedVersion → állapot → célállapot/no-op. Hibás verzió és tiltott állapot nem lehet no-op siker. Már published újabb publikálása, nem published visszavonása és published szerkesztése 409. Auditban actorSub/roles, művelet, contentVersion, idő, correlationId, changedFields, értékek nélkül. Hiányzó actor hiba; nincs system fallback.

Az eseményburkolat v1 és két eseménytípus marad. Új eventType külön kompatibilitási és rollout-döntést igényel; a jelenlegi zárt készlet bővítése v2 szerződésként készül majd, ha szükségessé válik. Ez most scope-on kívül van.

## D06 – Identity és teszthatár

Viewer: saját identitás. Editor: content:read + content:write. Publisher: content:read + content:write + content:publish + ops:read. A `/me` hitelesített, a nyilvános katalógus login nélkül elérhető. Authentik csoportok: poc-viewer/editor/publisher; ellenőrzött permissions és roles claim. Több csoport jogai egyesülnek.

M1-ben közvetlen service-actor és csak teszt-összeállításba injektált HTTP-identity adapter; **nem kell előre megírni JWT/JWKS ellenőrzést**. Normál appban identity off → admin prefix 503; identity on működő adapter nélkül → indítási hiba. Body/actor header nem megbízható identitás. Aláírt teszttoken, valódi Authentik, refresh és tokenhibák M2.

M2 PoC-beállítás: access token cél-élettartam 5 perc, lejárati tolerancia legfeljebb 30 másodperc, refresh session cél-élettartam 1 óra; a providerrel ténylegesen beállítható értékeket tokenpróba igazolja. Az offline visszavonási ablak célja legfeljebb 5 perc 30 másodperc a már kiadott tokenre. Refresh utáni jogváltozást külön ellenőrizzük. Ismert, cache-elt kulccsal érvényes token IdP-kieséskor ellenőrizhető; ismeretlen kulcs nem kaphat bypass-t. A tényleges issuer/audience/JWKS URI és rotációs viselkedés M2 mérendő kimenete, Claude felelősségével.

## D07 – Hibák és futtatási bizonyítás

Az üzleti/API hibák problem+json formátumúak; health-válasz a Terminus alakját követi. Hibás JSON 400, hibás mező 422, verzió/állapot/slugütközés 409, hiányzó vagy nem nyilvános rekord 404, hiányzó hitelesítés 401, hiányzó permission 403, függőségkiesés 503, váratlan hiba általános 500. Az error code listát M0/M1 közösen tartja.

A smoke egy Node-alapú futtató által kezelt folyamat: izolált konfiguráció, saját alkalmazás-child, dinamikus port, időkorlát, assert és finally cleanup. Nincs globális pkill, shellből source-olt .env vagy vak sleep. A teljes működési szerződés az [M0 terv](M0-IMPLEMENTATION.md) 5. szakasza. A meglévő demó/fejlesztői DB-t nem módosítja.

## D08 – Aszinkron és keresési PoC-alapértékek

Ezek választott induló konfigurációk, nem méréssel igazolt kapacitásértékek. A saját fázisban a kliens/API megfeleltetést ellenőrizni kell; szükséges eltérés indoklással a verziózott konfigurációba kerül.

| Beállítás | Döntés |
| --- | --- |
| CONTENT retention | 7 nap; 1 GiB; 1 000 000 üzenet; max üzenet 64 KiB; korlát elérésekor új publikálás elutasítása, az outbox függőben marad |
| Publish ACK timeout / dedup | 5 másodperc / 2 perc; dedup nem helyettesíti az idempotenciát |
| Relay és consumer retry | 1, 2, 4, 8, 16, majd 30 másodperc, legfeljebb ±20% jitter; átmeneti hibánál nincs végleges eldobás |
| Fogyasztás | A/B külön durable, indexenként egy soros művelet; task sikeréig nincs ACK; hosszú tasknál feldolgozásjelzés fenntartja a kézbesítést |
| Karantén | Külön stream, eredeti eventId + hibakód, ACK-val igazolt továbbítás; automatikus replay nincs, javítás utáni célzott operátori replay M5 runbook |
| Keresési időkorlát | Példányonként 1 másodperc; egy A-kérés, hiba esetén egy B-kérés. Üres találat nem hiba és nem fallback-ok |
| Fallback hiba | Hálózati hiba, timeout, kereső 429/5xx; hibás klienslekérdezés nem fallback. Kereső auth/config hiba 503 és diagnosztika, nem elrejtett konfigurációs probléma |
| Keresési minimum | title → tags → summary kereshető attribútumsorrend, alap relevanciaszabályok; kategória opcionális egyenlőségszűrő; query trim után 1–200 karakter |
| Lapozás | Alap 20, maximum 100 találat; offset 0–1000. DB-szűrés után rövidebb oldal és pontatlan index-total dokumentált |
| Magyar demó | Pontos cím, ékezetes címrészlet és tag visszaadja a publikált mintát; ékezet nélküli alak viselkedését külön feljegyezzük, nincs nyelvi minőségi garancia |

A stream korlátos tároló. Retentionen túli kiesés vagy elveszett stream esetén a kereső DB-alapú reindexet igényel; eseménytörténeti garanciát nem adunk. A karantén kapacitáskorlátja is 7 nap/1 GiB/1 millió üzenet; telítettség vagy sikertelen karanténpublikálás mellett az eredeti üzenet nem ACK-olható.

Az adapter megvalósításának elsődleges támpontjai a [JetStream stream](https://docs.nats.io/learn/jetstream/your-first-stream) és [pull consumer](https://docs.nats.io/learn/jetstream/pull-consumers) dokumentációi. A táblázat számszerű értékei saját PoC-döntések, nem a dokumentációból átvett kapacitásígéretek.

## D09 – Reindex és mérési elfogadás

Indexenként reindexelünk. Az érintett index tartósan `rebuilding` jelölést kap, kimarad az olvasási routingból, élő fogyasztója koordináltan megáll; az esetleges folyamatban lévő task lezárul. A másik index szolgálhat ki. Mindkét olvasható index hiányában keresés 503.

A reindex a DB aktuális publikált állományát építi fel, majd a megőrzött durable fogyasztóval catch-up következik. A reindex indulási határának és a szükséges események rendelkezésre állásának ellenőrzése kötelező. Hiányzó történetnél friss teljes újraépítés szükséges, nem részleges index sikeresnek jelölése. A konkrét stream-határ/snapshot koordináció M5 implementációs feladata.

Olvasásba visszaengedés: teljes import taskjai sikeresek, nincs függő helyi indextask, egy rögzített catch-up eseményhatárig minden releváns esemény ACK-olt, és a demóban szüneteltetett írások mellett a DB/index id+verzió összevetés helyes. A határ után érkező új írások normál aszinkron frissítésként kezelhetők; folyamatos forgalomnál nem kell végtelenül nulla lagra várni. Megszakadt reindex tartós jelölése újraindítás után is kizárja az indexet; új teljes futás indul. Az adatmodell/routing implementációját M5 terve részletezi.

Mérés: 1000 szintetikus tartalom és 100 publish/withdraw ciklus. A publish→kereshetőség ideje DB-commit-visszajelzéstől az adott indexet célzó sikeres keresésig tart. A lag indexenként broker pending + in-flight, kiegészítve a legöregebb be nem fejezett ismert esemény korával; ezek becslések, nem globális tranzakciós snapshot. Outbox pending/oldest-age külön mérőszám. Reindexidő a kezdettől az olvasásba visszaengedésig.

A PoC lezárásához helyes végállapot, adatvesztés nélküli vizsgált helyreállás és hiánytalan mérési jegyzőkönyv kell. **Nem írunk elő számszerű teljesítmény-SLO-t**; p50/p95/max és hibaarány kerül a baseline-ba. Egy hibapróba 5 percen belül nem helyreálló állapota sikertelen/befejezetlen próbaként rögzítendő, nem csendes timeoutként elhagyandó.

## D10 – Média és külső előfeltételek

M6 scope-ja: assetállapot/manifest Ant Media adapter, delivery policy és playback-authorize szerződés. Valódi DRM-lejátszás külön későbbi próba; fake adapter kizárólag szimuláció. Bekötött médiaadapter mellett nem kész assetre 422, szolgáltatói kiesésre 503, publikálási állapotváltozás nélkül. Külső ellenőrzés nem futhat a content sorzára alatt; az ellenőrzés és mentés közötti állapotváltozás korlátját az adapter szerződése rögzíti.

Ant Media/DRM hozzáférés és tényleges entitlement-szabályok külső előfeltételek, nem kitalálható döntések. Zoli szolgáltatja őket az M6 kezdete előtt. Addig a szerződéspéldák szintetikus, kifejezetten tesztjogosultságot használnak. A valós hozzáférés hiánya M0–M5-öt nem blokkolja.

## Lezárási státusz

Az M0–M1 dokumentumreview döntési pontjai rendezettek. Következő végrehajtási lépés az M0-02 spike és az M0 core alap elkészítése, külön implementációs munkában. A fázisok checklistjei változatlanul teljesítendő ellenőrzéseket jelölnek. A korábbi review történeti megállapításai a [review-naplóban](M0-REVIEW.md) maradnak.
