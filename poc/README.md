# IndaPlay / TV2 – NestJS backend PoC

2026-09-15 · Rögzített PoC-scope és közös munkaterv

Ez a fájl a PoC tervét és elfogadási feltételeit rögzíti.

**Megvalósítási státusz (2026-09-17):** az M0 alap és infrastruktúra, az M1 tranzakciós CMS-életciklus, az M2 identity resource server, az M3 outbox → JetStream relay, az **M4 kétindexes kereshető katalógus**, valamint az M5 reindex/karantén/repair vezérlősík implementálva a [`poc/backend/`](backend/) könyvtárban. A frontend Release A scope (Fázis 0–4) **kész**: valódi Authentik PKCE belépéssel, content lifecycle-lal, katalógussal, operations dashboarddal, valamint egy- és kétindexes kiesést és helyreállást bizonyító E2E-vel. A Release A eredménye **18 passed / 0 nyitott / 0 failed** két szándékosan külön futásban; jegyzőkönyve a [Release A evidence](RELEASE-A-EVIDENCE.md). A korábbi mérföldkő-jegyzőkönyvek: [M0–M1](M0-M1-EVIDENCE.md), [M2](M2-EVIDENCE.md), [M3](M3-EVIDENCE.md), [M4](M4-EVIDENCE.md), [M5](M5-EVIDENCE.md). **Nyitott:** az M2 token-refresh/key-rotation/IdP-kiesés kibővített L2 mérései, az M5 teljes full-stack evidence/baseline futása és az M6 média.

A megvalósítás sorrendjének és lezárási feltételeinek első bontása: [Milestone-terv](MILESTONES.md).

Az egyes fázisok részletes működési kibontása, még implementációs feladatokra bontás nélkül: [Fázisterv](PHASES.md).

Az első milestone feladatokra bontott terve, rögzített döntésekkel és a megvalósítandó smoke-futtató szerződésével: [M0 implementációs terv](M0-IMPLEMENTATION.md).

Az M0 áttekintésének megállapításai: [M0 review](M0-REVIEW.md). A részletes
implementációs tervek: [M0 – Alap és infrastruktúra](M0-IMPLEMENTATION.md),
[M1 – Tranzakciós CMS-életciklus](M1-IMPLEMENTATION.md), [M2 – Valódi identitás
és szerkesztői jogosultság](M2-IMPLEMENTATION.md), [M3 – Tartós eseményút
JetStreammel](M3-IMPLEMENTATION.md), valamint [M4 – Kereshető katalógus két
indexszel](M4-IMPLEMENTATION.md) és [M5 – Helyreállás és
bizonyítékok](M5-IMPLEMENTATION.md).

A meglévő backend képességeinek teljes UI-lefedési terve és a nyolc végrehajtási
fázis indexe: [Frontend implementációs roadmap](FRONTEND-IMPLEMENTATION-PLAN.md).
A Fázis 0 implementálva; az identity/API döntések és a Fázis 1–7 résztervei a
roadmapből érhetők el.

A megvalósítás bizonyítékai és a nyitott pontok: [M0–M1 futtatási jegyzőkönyv](M0-M1-EVIDENCE.md). A rögzített működési döntések, alapértékek és a review lezárása: [DECISIONS](DECISIONS.md). Az aktuális ütemezés 17 munkanap + 2 nap tartalék; a korábbi ötnapos cél felülvizsgálva.

## Mit építsünk?

Egy videókatalógus szerkesztési és publikálási folyamatát egy NestJS moduláris monolitban. Egy végigjárható üzleti folyamatban találkozzunk PostgreSQL-lel, Authentikkal, JetStreammel és Meilisearchhel:

1. A szerkesztő Authentikban bejelentkezik.
2. A CMS API-val létrehoz egy videómetaadatot és hozzárendel egy meglévő médiaazonosítót.
3. A publikáló jogosultságú felhasználó publikálja a tartalmat.
4. A PostgreSQL-tranzakció együtt menti a tartalomállapotot, az auditbejegyzést és az outbox-eseményt.
5. A relay JetStreambe publikál; a keresési fogyasztók két független Meilisearch-példányt frissítenek.
6. A néző keres, majd lekéri a jelenleg publikált tartalom részleteit.
7. A publikáló visszavonja a tartalmat; az indexekből az aszinkron folyamat eltávolítja.

A PoC végén ezt a folyamatot és a kiesésből való visszaállást tudjuk reprodukálhatóan bemutatni. A PoC integrációs és fejlesztési tapasztalatot ad; a termelési kapacitás és HA bizonyítása külön feladat.

## Rögzített technológiai határok

| Terület | PoC-szerep |
| --- | --- |
| NestJS / TypeScript | Egy alkalmazás, külön üzleti és integrációs modulokkal |
| PostgreSQL 17 | Tartalom, audit, outbox; egy helyi példány |
| NATS JetStream | Tartós üzleti események; egy helyi szerver, R1 |
| Meilisearch | Két külön indexpéldány; alkalmazásoldali fan-out és olvasási fallback |
| Authentik | Valódi OIDC belépés, aláírt access token, szerepkörök |
| Ant Media | Második körben egy meglévő tesztkörnyezethez kötött adapter |
| DRM | Média-előkészítési és konfigurációs szerződés; kulcs- és licenckiszolgálás későbbi integráció |
| Go playback-authorize | Külön, későbbi hot path; a PoC-ban legfeljebb API-szerződés |

A lokális Compose a fejlesztés indítását segíti. CNPG, RKE2, Traefik, GitOps, CDN és frontend megvalósítás nem része ennek a PoC-csomagnak. NATS marad az egyetlen aszinkron infrastruktúra; a PoC-hoz nem szükséges BullMQ, Redis vagy Kafka.

## Modulok és adatgazdák

```text
poc/backend/                      # megvalósítva; a modulhatárok a backend READMÉ-ben
  src/
    app.module.ts
    identity/                     # OIDC konfiguráció, JWT guard, permission guard
    content/                      # katalógus és szerkesztői életciklus
    database/                     # kapcsolat és tranzakciós segédlet
    messaging/                    # JetStream kapcsolat és stream bootstrap
    outbox/                       # atomi eseményrögzítés, relay
    search/                       # indexprojekciók, fan-out, keresési routing
    media/                        # opcionális Ant Media adapter
    health/                       # függőségek és feldolgozási állapot
    contracts/                    # HTTP DTO-k és verziózott eseménysémák
  migrations/
  test/integration/
  compose.yaml
  .env.example
  README.md
```

A `ContentModule` birtokolja a tartalom életciklusát. A keresőindex származtatott adat, nem jogosultsági vagy publikálási igazságforrás. A `SearchModule` nem módosítja a tartalomtáblákat. Az `IdentityModule` azonosít és jogosultságot ellenőriz; a termékbeli előfizetés/grant későbbi üzleti modul feladata.

Kezdésként egyetlen deployable és folyamat elegendő. A háttérfeldolgozók NestJS providerek. Az API, relay és worker későbbi külön futtatása ne legyen előfeltétele az első működő folyamatnak.

## CMS: kis, de életszerű tartalommodell

Első modell: `Content` – UUID, cím, slug, rövid leírás, kategória, tagek, `mediaAssetId`, állapot, verzió, létrehozási és módosítási idő. A PoC metaadatot kezel; a videófeltöltés, bináris tárolás és transzkódolás külön médiafolyamat.

Életciklus: `draft → published → withdrawn`. A visszavont tartalom újrapublikálható. Draft és withdrawn állapotban szerkeszthető; a publikált változat szerkesztése az első körben tiltott. Így nincs szükség az első PoC-ban külön draft/published revíziórendszerre.

A publikálás ellenőrzi a kötelező mezőket. Valódi médiaadapter bekötése után a média kész állapotát is ellenőrzi. Optimista konkurenciakezelés: módosításhoz a kliens elküldi a várt verziót; eltéréskor `409 Conflict`. Minden sikeres állapotváltás növeli a verziót, és ugyanabban a tranzakcióban auditot és outbox-rekordot készít.

| HTTP API | Szerep / viselkedés |
| --- | --- |
| `GET /me` | Hitelesített identitás és alkalmazásjogok |
| `POST /admin/contents` | `content:write`, draft létrehozás |
| `PATCH /admin/contents/:id` | `content:write`, várt verzió |
| `POST /admin/contents/:id/publish` | `content:publish`, várt verzió |
| `POST /admin/contents/:id/withdraw` | `content:publish`, várt verzió |
| `GET /admin/contents/:id` | Szerkesztői részletek, minden állapot |
| `GET /catalog/contents/:id` | Csak jelenleg publikált tartalom; egyébként 404 |
| `GET /catalog/search?q=...` | Publikált tartalom keresése, kiesési fallback |
| `GET /health/live` | Folyamat működik |
| `GET /health/ready` | API számára szükséges függőségek elérhetők |
| `GET /admin/processing-status` | Védett outbox- és indexállapot |

OpenAPI dokumentáció és egy parancssoros/API-klienses demó elegendő. A CMS itt szerkesztői backend, nem teljes kész szerkesztőfelület.

## Identity: valódi belépés és negatív esetek

Authentik OAuth2/OIDC provider, aszimmetrikus aláírókulccsal. Authorization Code + PKCE flow egy fejlesztői tesztklienssel; a tokenkérés és refresh nem saját jelszókezelésből történik.

A NestJS API a bearer access token aláírását, issuerét, audience-ét és lejáratát ellenőrzi. A konfiguráció a discovery dokumentumra és JWKS-re támaszkodik; az audience tényleges értékét a provider beállításával és kiadott teszttokennel kell rögzíteni. ID token nem használható API access tokenként.

Három tesztfelhasználó: viewer, editor, publisher. Csoportból vagy explicit property mappingből származnak az alkalmazásjogok. Kért OAuth scope önmagában nem igazolja a szerkesztői jogosultságot. A permission mapping legyen dokumentált és tesztelt.

Teszteljük: jó token, lejárt token, rossz issuer, rossz audience, hamis aláírás, hiányzó jog, refresh és signing-key rotáció. JWKS cache mellett egy meglévő ismert kulccsal aláírt, még érvényes token IdP-kieséskor is ellenőrizhető; új login és ismeretlen kulcs esetén ezt nem feltételezzük. Tokenvisszavonás az offline JWT-ellenőrzésben nem azonnali, ezért a választott token-élettartamot és visszavonási ablakot fel kell jegyezni.

## JetStream és tranzakciós outbox

A NestJS beépített NATS transport helyett dedikált JetStream adaptert használjunk, a hivatalos Node kliens megfelelő verziójával. A stream, durable consumer, publish ACK és explicit consumer ACK a saját integráció része legyen.

Kezdeti topológia:

- Stream: `CONTENT`, subject: `poc.content.changed.v1`, file storage, limits retention, helyben R1.
- PoC retention: 7 nap; 1 GiB és 1 000 000 üzenet, új publikálás elutasítása kapacitáskorlátnál; további alapértékek a DECISIONS D08-ban. A hosszabb távú újraépítés PostgreSQL-ből történik.
- Durable pull consumer: `search-a-v1` és `search-b-v1`, ugyanarra a subjectre, példányonként külön előrehaladással.
- Explicit ACK: csak sikeres indexművelet és a Meilisearch task sikeres befejezése után.
- Stabil `eventId` a publish deduplikációhoz; a deduplikációs időablak nem helyettesíti az idempotens fogyasztót.

Tervezett eseményszerződés, példányértékekkel:

```json
{
  "eventId": "b3dc0396-828c-4aad-af55-5b495e8fa04e",
  "schemaVersion": 1,
  "eventType": "content.published",
  "aggregateId": "fbbf8b73-151f-4931-817c-f5a10a9f31ec",
  "aggregateVersion": 2,
  "occurredAt": "2026-09-15T10:00:00Z",
  "correlationId": "80696510-55ce-4b83-988b-d271021b9813",
  "payload": { "status": "published" }
}
```

A subject a változási csatorna, az `eventType` a művelet. A PoC-ban a keresési fogyasztó az aggregate azonosítójával a PostgreSQL aktuális állapotát olvassa. Ezzel a régi eseményből is a jelenlegi állapotot projektálja. Ez szándékos read-model egyszerűsítés; nem általános történeti event sourcing. Az eseménybe nem kerül token, e-mail vagy médiakulcs.

Az outbox relay csak a JetStream publish ACK után jelöl kézbesítettnek. Ha az ACK és a jelölés között leáll, ugyanazt az eseményt újra küldheti. A relay kezdetben egyetlen példány; a több relayhez szükséges rekordfoglalás külön bővítés.

Indexenként egy soros feldolgozóval induljunk; a task befejezése előtt nem kezd következő módosítást. Reindex közben az adott index élő fogyasztóját koordináltan megállítjuk, majd catch-up következik. Későbbi párhuzamos feldolgozáshoz aggregate-szintű sorrend és verzióvédelem kell; pusztán egy `processed_events` tábla nem garantál külső indexírási atomosságot.

Átmeneti indexkiesésnél késleltetett újrapróbálkozás szükséges, nem végleges eldobás. Hibás séma/poison message külön karanténsubjectre kerül, saját streammel, eredeti `eventId`-val és hibakóddal. Karanténpublikálás ACK-ja előtt az eredeti üzenetet nem nyugtázzuk. A retry és karantén két külön teszteset; a max-delivery advisory önmagában nem kész DLQ.

## Meilisearch: a DIY fan-out kipróbálása

Mindkét Meilisearch-példány ugyanazt a projekciót kapja: id, cím, leírás, kategória, tagek, aggregate-verzió. Csak publikált tartalom kerüljön bele. Visszavonáskor törlés történik. Egy upsert API-válasz még nem bizonyítja, hogy a keresőindex kész: a visszaadott taskot meg kell várni és ellenőrizni.

Az API elsődlegesen A-t olvassa, időkorlátos hibánál B-re vált. Ha mindkettő kiesik, a keresési végpont egyértelmű `503` választ ad; a CMS PostgreSQL-írásai ettől tovább működhetnek. B kiesése nem állíthatja meg A fogyasztóját. B visszatérésekor a saját durable consumerével behozza a lemaradást.

Fallback esetén B lehet lemaradva. A PoC-ban a keresőtalálatok azonosítóit a PostgreSQL jelenlegi publikálási állapotával visszaellenőrizzük, és a nyilvános metaadatokat onnan adjuk vissza. Ezzel a már visszavont tartalom nem jelenik meg stale találatként. A keresőbeli rangsor és találatszám átmenetileg elavult lehet; szűrés után rövidebb oldal is elfogadható, ezt a demóban jelezzük. DRM- vagy lejátszási jogosultságot továbbra sem ad a kereső.

Legyen dokumentált teljes reindex parancs PostgreSQL-ből, az élő változások catch-up lépésével. A PoC során mérjük a publikálás→kereshetőség időt, a példányonkénti lemaradást és az újraépítési időt. Két helyi konténer az alkalmazás fan-out logikáját vizsgálja; független hibazónákat nem szimulál.

## Ant Media, DRM és Go: opcionális második kör

Ha az alapfolyamat működik és van teszthozzáférés, a `MediaModule` egy Ant Media adapterrel lekéri egy tesztasset állapotát és manifest-hivatkozását. A PoC saját UUID-ja és a szolgáltatói broadcast/VOD azonosító külön mező. Szimulált callback vagy fake adapter egyértelműen jelölt; nem bizonyít Ant Media-, GPU- vagy DRM-integrációt.

DRM-hez a tartalomhoz tartozó delivery policy szerződését rögzítsük: Phase 1 AES-128, Phase 2 multi-DRM feature flag. A flag nem végzi el a csomagolást vagy titkosítást. Valódi próbához packager, kulcs-/licencszolgáltatás, megfelelő manifest és kompatibilis player szükséges. Ennek bekötése a rendelkezésre álló DRMaaS-sandboxtól függ.

A Go playback-authorize részhez legfeljebb egy bemeneti/kimeneti szerződés és minta entitlement snapshot készüljön. A NestJS-be ne kerüljön új, végleges playback hot path. A nézői login, tartalom-elérhetőség, üzleti entitlement és DRM-licenc négy külön ellenőrzés.

## Ütemezés és mérhető eredmények

A [milestone-terv](MILESTONES.md) 17 munkanap + 2 nap tartalék keretet rögzít: M0 1–4., M1 5–8., M2 9–10., M3 11–12., M4 13–15., M5 16–17. munkanap. M6 külön második kör. A kezdőnap tényleges munkakezdéshez kötött; az időkeret napi körülbelül 6 óra munkával, kötelező párhuzamosítás nélkül értendő.

M0 lezárásakor reprodukálható core indulás; M1-nél verziókezelt, atomi CMS; M2-nél valódi tokennel publikálás; M3-nál NATS-kiesésből kézbesítés; M4-nél teljes keresési út; M5-nél helyreállási és mérési bizonyíték a bemutatandó eredmény. A modulokat minden fázisban összekötjük, és a hibapróbákat menet közben gyűjtjük.

## Claude-dal közös munka – javasolt felosztás

A feladatok közös HTTP-, esemény- és adatbázis-szerződésből induljanak. Ez tervezett munkamegosztás, Claude nincs innen meghívva vagy elindítva.

- Codex: CMS adatmodell, migrációk, publikálási tranzakció és outbox/JetStream út.
- Claude: Authentik provider/claim mapping, guardok, majd Meilisearch projekció és fallback.
- Közös review: tranzakciós határ, jogosultságok, consumer ACK helye, visszavonás és retry.
- A felhasználó: valódi szerkesztői szabályok, tesztidentitások, hozzáférések és a demó elfogadása.

A contracts, package manifest, lockfile, Compose és közös migrációs sorrend egy-egy gazdát kapjon. Külön branch vagy worktree és kis, napi integrációs változtatások csökkentik az egymásra írás esélyét. Az identity és search munka indulhat külön, de mindkettőt az alapfolyamatba kell integrálni a napi demóhoz.

## PoC-zárási elfogadási lista

- [ ] Friss környezetben dokumentált parancsokkal indulnak a valódi függőségek és az alkalmazás; nincs implicit auth bypass.
- [ ] Authentik belépés, tokenellenőrzés és mindhárom szerepkör működik; negatív token- és permission-tesztek megvannak.
- [ ] CMS módosítás, audit és outbox egy tranzakció: rollback esetén egyik sem marad félkészen.
- [ ] NATS nélkül a CMS írható és az esemény outboxban marad; helyreállás után kézbesíthető.
- [ ] Relay-leállás publish ACK után reprodukálható; a duplikált esemény nem rontja az indexállapotot.
- [ ] Consumer-leállás indexírás után, ACK előtt reprodukálható; redelivery után a végállapot helyes.
- [ ] Régi publish esemény replay-e nem teszi újra láthatóvá a visszavont tartalmat.
- [ ] A és B kiesését külön kipróbáltuk; az egészséges példány működik, a visszatérő példány felzárkózik.
- [ ] Meilisearch sikertelen taskjára nincs sikeres consumer ACK; poison message karanténba tehető.
- [ ] Mindkét index kiesésekor a keresés 503, a CMS tovább írható.
- [ ] Üres indexek PostgreSQL-ből újraépíthetők, közben érkező változásokkal együtt.
- [ ] Eseményazonosító és correlation ID végig követhető; token és secret nem kerül a logba.
- [ ] Van publikálás→kereshetőség mérés, indexenkénti lag és outbox pending/oldest-age megfigyelés.
- [ ] A jegyzőkönyv elkülöníti a megvalósított, szimulált, tervezett és még nem tesztelt elemeket.

Kis terhelésméréshez kezdeti fixture-javaslat: 1000 szintetikus tartalom, magyar címekkel/tagekkel, 100 publikálási és visszavonási ciklus. Rögzítsük a gépet, verziókat, adatmennyiséget, párhuzamosságot, hibaarányt és mért idők eloszlását. Ez fejlesztői baseline, nem a TV2 közönségméretére adott méretezési bizonyíték. A végleges SLO-k üzleti és terhelési célokból következnek.

## Nyitó backlog

Első implementációs csomag: `ContentModule + DatabaseModule`, migrációk és verzióellenőrzött draft/publish/withdraw API. Második csomag: `IdentityModule`, valós Authentik providerrel. Harmadik: outbox és JetStream. Negyedik: külön A/B fogyasztók és keresési API. Az ötödik csomag a helyreállási teszteket és a demót zárja le.

A megvalósítás kezdetén rögzítsük a NestJS és klienskönyvtárak kompatibilis verzióit lockfile-ban, a konténerimage-eket ellenőrzött taggel/digesttel. A tervezés során nem történt dependency-install vagy szolgáltatásindítás; futási eredmény még nincs.

## Elsődleges technológiai hivatkozások

A terv saját implementációs javaslat. Az alábbi dokumentációk a használt protokollok és API-k viselkedését támasztják alá, nem a PoC elkészültét:

- [NestJS modulok](https://docs.nestjs.com/modules) és [NATS transport](https://docs.nestjs.com/microservices/nats): a NestJS-modulhatárok és a transport konfigurációjának kiindulópontja; a JetStream-tartóssági életciklus külön adapterfeladat.
- [NATS pull consumerek](https://docs.nats.io/learn/jetstream/pull-consumers): durable fogyasztás, explicit ACK és redelivery.
- [Hivatalos NATS JavaScript kliens](https://github.com/nats-io/nats.js): a választott Node/JetStream kliens és verzióhoz tartozó API ellenőrzéséhez.
- [Meilisearch taskok](https://www.meilisearch.com/docs/capabilities/indexing/tasks_and_batches/monitor_tasks): az aszinkron indexmódosítás sikerének követése.
- [Authentik OAuth2/OIDC provider](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/): PKCE, discovery/JWKS, issuer mód és aláírókulcs beállítása.

A technológiai stackhez a felhasználó 2026-09-15-i közlése az aktuális döntési alap. Az itt javasolt PoC-részletek nem írják felül a végleges Meilisearch-, infrastruktúra-, identity- vagy média-választást.
