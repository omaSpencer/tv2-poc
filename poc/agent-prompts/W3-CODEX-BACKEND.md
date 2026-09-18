# W3 Codex feladatlap – BE-F3 lekérdezési és adatkezelési korrektség

A koordinátor a `/private/tmp/tv2-poc-be-f3` worktree-ben, a
`codex/final-be-f3` branchen valósítja meg a BE-F3 fázist. Baseline kizárólag a
W2 mindkét ágának integrálása és zöld közös kapuja utáni tiszta `main`.

## Kizárólagos scope

Audit-ID-k: **C1, C6, C7, C8, D2**. Backend production forrás, backend teszt,
backend recovery/ADR/runbook dokumentáció és
`poc/FINAL-BACKEND-EVIDENCE.md`, valamint kizárólag a BE-F3 checklist a
`poc/FINAL-BACKEND-MILESTONE.md` fájlban módosítható. Frontend, generated
contract, Compose, koordinációs dokumentum és milestone-összesítés nem
módosítható. Az OpenAPI alakja nem változik.

## Kötelező megoldási szerződés

1. **C1 – scan-budget kurzor**
   - A `MAX_SCAN` elérése nem jelenthet lista-véget. Ha a scan a stream alsó
     határa előtt áll meg, akkor akkor is legyen folytatható kurzor, ha az
     aktuális oldalon nulla vagy a kért limitnél kevesebb tárolt üzenet volt.
   - `nextBeforeSequence: null` csak üres streamnél vagy a valódi alsó határ
     elérésekor adható. A következő hívás nem hagyhat ki és nem ismételhet
     tárolt rekordot, és nem kerülhet üres kurzorloopba.
   - A publikus `nextCursor` mező és a v1 base64url kurzor alakja marad.
2. **C6 – audit action fail-closed**
   - A mapper az `AUDIT_ACTIONS` ismert értékein kívül semmit nem alakít
     `updated` értékké. Ismeretlen DB-adat explicit assertion/stabil belső
     hibaágon álljon meg.
   - A mapper közvetlen unit tesztje a DB CHECK constrainttől függetlenül adjon
     be ismeretlen actiont, és igazolja a fail-closed viselkedést.
3. **C7 – korlátos audit-olvasás**
   - A production repository API-ban ne legyen opcionális, korlátlan olvasási
     út, `2_147_483_647` vagy ezzel egyenértékű sentinel limit.
   - Minden hívás validált limitet és cursor/keyset feltételt használjon. Ha
     fixture vagy demo teljes auditláncot kér, lapozzon explicit kis oldalakon,
     ne kapjon production bypass-t.
4. **C8 – `capacity` osztály**
   - A `capacity` külön kategória marad. A relay egyszer osztályozza a hibát,
     majd ugyanaz az érték jelenjen meg a retry strukturált logjában és a
     processing status `lastErrorCode` mezőjében.
   - Determinisztikus teszt különböztesse meg a capacity-limit hibát a timeout/
     kapcsolat jellegű `transient` hibától. A retry nem dobhatja el az outbox sort.
   - Új külső problem code vagy OpenAPI-változás nem készül.
5. **D2 – forward-only migrációs policy**
   - Az ADR/recovery dokumentáció mondja ki: nincs általános down migration;
     visszaállás ellenőrzött backup restore vagy forward-fix migráció.
   - Rögzítse a döntési felelőst, a restore és forward-fix választási
     feltételeit, a mentés/restore ellenőrzését, a rehearsal gyakoriságát és
     az evidence minimumát.
   - A lépések friss, eldobható környezetben végigkövethetők legyenek;
     production adaton destruktív próba nem része a feladatnak.

## Tesztek és kapuk

- Ritka karantén stream: 2000-nél nagyobb purge-elt rés, üres közbenső oldal,
  az alatta lévő rekord elérése, sorrend, duplikációmentesség és termináló
  `null` kurzor.
- Audit mapper: minden ismert action pozitív, ismeretlen action negatív ága;
  repository oldalméret és cursor regresszió.
- Broker classifier/relay: capacity és transient log/status, pending outbox
  megőrzése.
- Célzott tesztek után `npm run verify` Node 24.20.0-n, healthy
  PostgreSQL/NATS/Meilisearch stackkel.
- Evidence-ben ID-nként: módosított fájl, invariáns, futtatott parancs és
  pontos eredmény. Checklist csak tényleges teljesülésre frissülhet.

## Átadás és review

- Egy review-zható commit; nincs merge, rebase vagy push.
- Átadás: branch, commit SHA, audit-ID-k, fájlok/viselkedés,
  parancsok/eredmények, nem futtatott kapuk, kockázat és scope-nyilatkozat.
- Cursor az FE-F3 átadása után read-only review-t végez. Találatot ezen az
  ágon kizárólag Codex javíthat.
