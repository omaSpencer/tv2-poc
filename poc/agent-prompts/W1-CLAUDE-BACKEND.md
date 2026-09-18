# W1 prompt – Claude / backend BE-F1

Dolgozz kizárólag a `/private/tmp/tv2-poc-be-f1` worktree-ben, a
`codex/final-be-f1` branchen. A kiinduló commit:
`e70aea5e767f2ae1705235293c43bcb4cd2845a9`.

Olvasd el teljesen a `poc/FINAL-BACKEND-MILESTONE.md` dokumentumot, majd
implementáld kizárólag a **BE-F1 – Publikus perem és futtatási hardening** fázist:

- S1 – rate limiting a publikus catalog route-okon;
- S2 – explicit, szűk CORS vagy bizonyított same-origin döntés;
- S4 – dependency host-portok loopback bindja;
- S7 – Meilisearch production posture;
- O1 – reprodukálható, nem root backend application image.

Követelmények:

1. Először vizsgáld meg a jelenlegi browser/API topológiát, Vite proxy/env
   beállításokat, Nest bootstrapot és Compose konfigurációt. S2-nél ne találj ki
   új deployment topológiát: a repository jelenlegi szerződéséből indulj ki, az
   ellentmondást egyetlen explicit megoldással zárd le.
2. S1-nél a limit legyen tesztelhető és konfigurálható, a két publikus route-ra
   vonatkozzon, normál forgalmat ne törjön. A `429` contractot dokumentáld.
3. S4-nél csak a host publikálás változzon; a Compose belső service discovery ne
   sérüljön.
4. S7-nél a local dev élmény maradhat development, de legyen egyértelmű és
   titokmentes production minta kötelező kulccsal.
5. O1-nél multi-stage/reprodukálható image, nem-root runtime, production
   dependency-k és healthcheck szükséges. Secret ne kerüljön image layerbe.
6. Adj vagy módosíts célzott teszteket. Ne gyengíts meglévő tesztet, lintet,
   typechecket vagy security invariantot.
7. Frontend forrást ne módosíts. Ha backend OpenAPI snapshot változik, azt
   frissítheted, de az átadásban külön emeld ki a frontend contract hatást.
8. Hozd létre/frissítsd a `poc/FINAL-BACKEND-EVIDENCE.md` fájlt S1, S2, S4, S7,
   O1 bejegyzésekkel. A milestone-ban csak valóban bizonyított checklistet jelölj
   késznek.
9. Futtasd legalább a releváns célteszteket, majd lehetőség szerint a backend
   `npm run verify` kaput pontos Node 24.20.0 runtime-mal. Konténer/image smoke-ot
   is rögzíts. Ha valami nem futtatható, ne állítsd zöldnek, írd le pontosan.
10. Ne merge-elj `main`-re, ne rebase-elj más agent ágára, és ne módosítsd a
    `/Users/busizoltan/code/tv2-poc` fő checkoutot.

Kész állapotban commitold a változtatásokat. Az átadás formája:

- branch és commit SHA;
- lezárt audit-ID-k;
- módosított fájlok és viselkedés;
- futtatott parancsok és pontos eredmények;
- nem futtatott kapuk és ok;
- nyitott döntések/kockázatok;
- explicit kijelentés, hogy nem merge-eltél és scope-on kívül nem módosítottál.

Ha architekturális döntés nélkül nem tudsz biztonságosan továbblépni, állj meg,
és adj egy rövid, konkrét döntési kérdést a koordinátornak.
