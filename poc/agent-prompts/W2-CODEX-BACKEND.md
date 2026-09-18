# W2 Codex feladatlap – BE-F2 trust boundary és diagnosztika

A koordinátor a `/private/tmp/tv2-poc-be-f2` worktree-ben, a
`codex/final-be-f2` branchen valósítja meg a BE-F2 fázist. Baseline a worktree
létrehozásakor aktuális, tiszta `main`.

## Kizárólagos scope

Audit-ID-k: **S3, S5, S6, C2, O2**. Backend production forrás, backend teszt,
backend/runbook dokumentáció és `poc/FINAL-BACKEND-EVIDENCE.md` módosítható.
Frontend, generated contract és FE-F2 fájlok nem módosíthatók. OpenAPI csak
akkor változhat, ha egy stabil külső problem code ténylegesen változik; az
alapértelmezett terv szerint nem változik.

## Kötelező megoldási szerződés

1. **S3:** egyetlen timeout/helper validál `Number.isSafeInteger`, pozitív
   tartomány és dokumentált felső korlát alapján, még `sql.raw` formázás előtt.
2. **S5:** issuer-egyezés egyetlen canonical trailing-slash szabályt használ.
   Csak ez a normalizálás megengedett; valódi origin/path mismatch fail-closed.
   Diagnosztika stabil kategória legyen, teljes issuer/JWKS URL nélkül.
3. **S6:** `bootstrap_failed` külső esemény marad, mellette legfeljebb zárt,
   biztonságos failure category/error kind logolható. Nincs raw message, stack,
   URL, token, DSN vagy credential.
4. **C2:** a controller `dependencyRead` csak ismert kapcsolat/dependency outage
   esetet képezzen `dependency_unavailable` hibára. `TypeError`, assertion és
   tetszőleges programhiba menjen tovább `internal_error` ágra, és a teszt
   bizonyítsa a különbséget.
5. **O2:** marad a path/query nélküli request log. A runbook rögzítse a
   correlation-ID alapú visszakeresést és a vállalt diagnosztikai korlátot.
   Tesztelje a megengedett kulcsokat és a path/query/header/body hiányát.

## Kapuk

- Célzott unit/integrációs tesztek minden pozitív és negatív ágra.
- `npm run verify` Node 24.20.0-n a healthy PostgreSQL/NATS/Meilisearch stackkel.
- Evidence/milestone csak ténylegesen teljesült ID-kre frissül.
- Egy review-zható commit; nincs merge/push a branchből.
