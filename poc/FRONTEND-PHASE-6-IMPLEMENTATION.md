# Frontend Fázis 6 – Vezetett demó és bizonyíték

2026-09-16 · Dev-ready implementációs specifikáció.

## 1. Cél

A jelenlegi imperatív demo oldal deklaratív scenario runnerre vált. Minden lépés
előre rögzített requestet, pontos elvárt eredményt és üzleti assertiont használ.
A runner bizonyítékot készít, de nem válik általános API- vagy
infrastruktúra-parancsfuttatóvá.

## 2. Belépési kapu

A teljes Fázis 6 akkor implementálható véglegesre, ha:

- Fázis 1 auth/session és permission guard stabil;
- Fázis 2 content route-ok és conflict UX stabil;
- Fázis 3 catalog/search UI stabil;
- Fázis 4 processing dashboard stabil;
- ha M5 scenario is release scope: Fázis 5 endpointjai és error code-jai stabilak.

A scenario engine és fixture-ek korábban elkészíthetők, de API-változás közben
nem érdemes a végső képernyőszöveget vagy screenshot evidence-t rögzíteni.

## 3. Scenario modell

### 3.1 Típusok

```ts
type ScenarioDefinition = {
  id: string;
  title: string;
  description: string;
  requiredPermissions: AppPermission[];
  preflight: PreflightCheck[];
  steps: ScenarioStep[];
};

type ScenarioStep = {
  id: string;
  title: string;
  mode: 'automatic' | 'manual';
  request?: SafeRequestDefinition;
  expected: ExpectedResult[];
  timeoutMs: number;
  continueOnFailure?: false;
};

type ExpectedResult =
  | { kind: 'http'; status: number }
  | { kind: 'problem'; status: number; code: ProblemCode; fields?: string[] }
  | { kind: 'json-path'; path: AllowedAssertionPath; equals: JsonScalar }
  | { kind: 'content-version'; equalsContext: string }
  | { kind: 'search-contains'; contentIdFromContext: string; present: boolean };
```

A definíció csak előre engedélyezett operationöket és assertion típusokat
használhat. Nincs runtime JavaScript, `eval`, tetszőleges URL, tetszőleges header
vagy user által szerkeszthető request body.

### 3.2 Run context

Egy futás kontextusa:

- `runId` random UUID;
- újonnan létrehozott content ID;
- aktuális content version és status;
- korábbi response-ok szűk, allowlistelt értékei;
- step eredmények és időzítések;
- aktív role/permission snapshot `/me`-ből.

Token, refresh token, Authorization header, teljes request/response body és
credential nem kerülhet a contextbe vagy exportba.

SessionStorage csak a safe run contextet tartja. Ha a definíció verziója vagy a
bejelentkezett subject megváltozik, a runner nem folytat automatikusan.

## 4. Kötelező scenario-k

### P6-S01 — Publisher lifecycle

1. preflight: backend ready, publisher permissionek, search/processing állapot;
2. új draft egyedi `demo-<runId>` címmel;
3. edit;
4. publish;
5. admin detail status/version assertion;
6. catalog detail polling, majd search contains;
7. withdraw;
8. catalog 404 és search absent polling;
9. withdrawn edit;
10. republish;
11. catalog/search újra látható;
12. audit verziók/actions ellenőrzése, ha Fázis 2 kész.

Minden futás új tartalmat hoz létre; nincs repóba írt vagy előző runból örökölt
UUID.

### P6-S02 — Content negatív contractok

- hiányos publish: 422 `validation_failed`, pontos kötelező fields;
- published patch: 409 `content_not_editable`;
- stale patch: 409 `version_conflict`, expected/actual version assertion;
- hibás payload: 422, nem általános „bármilyen hiba”;
- túl nagy payload: 413 csak dedikált, biztonságos fixture-rel.

Egy network/401/403/503 hiba egyik fenti negatív lépést sem teheti sikeressé.

### P6-S03 — Permission matrix

- viewer: `/me` 200, admin write 403 `forbidden`;
- editor: create/edit siker, publish 403;
- publisher: lifecycle siker;
- hiányzó/lejárt token: 401 `unauthenticated`.

A három identitás közti váltás kézi login checkpoint lehet; a runner nem tárol
jelszót és nem automatizál Authentik credentialt browser storage-ból.

### P6-S04 — Search fallback és kiesés

- normál A/B search siker;
- kézi runbook checkpoint: A leállítása;
- dashboard egy routeEligible indexet mutat, search továbbra is sikeres;
- checkpoint: B leállítása;
- dashboard nulla routeEligible; search 503 `search_unavailable`;
- CMS create/edit továbbra is működik;
- recovery checkpoint és ismételt search.

A fault injection mindig manuális, pontos runbook-lépés. A UI nem állít le
konténert vagy hálózatot.

### P6-S05 — M5 operations (ha Release C scope)

- reindex preflight + start + terminal success;
- párhuzamos reindex exact failure;
- quarantine inspect/replay fixture, ha biztonságosan előállítható;
- repair A/B/both;
- operator action evidence idempotency és requestedBy adatokkal.

Az M5 baseline és teljes smoke továbbra is CLI evidence, a runner csak linkeli
az eredményt vagy megjeleníti a felhasználó által importált safe summaryt.

## 5. Runner munkacsomagok

### P6-01 — Scenario registry és validáció

- verziózott, readonly scenario definíciók;
- build-time TypeScript és runtime Zod ellenőrzés;
- egyedi scenario/step ID;
- csak allowlistelt API operation;
- timeout minden automatikus lépésen;
- dependency/ciklus nélküli lineáris első verzió.

### P6-02 — Execution engine

- állapot: idle, preflight, running, waiting_manual, passed, failed, cancelled;
- egyszerre egy request;
- stop új lépést nem indít, aktív fetch `AbortController`-rel megszakítható;
- mutation automatikusan nem retryolható;
- polling step külön, bounded attempt/deadline értékkel;
- első váratlan hiba megállítja a futást;
- „folytatás hiba után” nincs a bizonyító módban.

### P6-03 — Exact assertion engine

- success csak minden assertion teljesülésekor;
- problem: status + code + opcionális fields halmaz;
- fields összevetésnél a definíció jelzi exact vagy contains módot;
- version/status/id típusellenőrzött;
- search polling a content ID-t ellenőrzi, nem csak címszöveget;
- assertion hiba safe expected/actual diffet ad, response body dump nélkül.

### P6-04 — Preflight

- auth state és szükséges permissions;
- health ready;
- szükséges feature endpoint próba;
- aktív M5 action/reindex figyelmeztetés;
- böngésző online állapot;
- scenario által igényelt manual runbook előfeltétel.

Preflight failure nem indít mutationt. A user explicit újrapróbálhat.

### P6-05 — Timeline UI

Minden step:

- pending/running/pass/fail/manual;
- start/end/duration;
- method + route template, secretmentes;
- HTTP status, problem code;
- correlation ID másolható;
- content version/status safe metaadat;
- assertion összefoglaló;
- technikai részlet disclosure.

A fókusz az aktív step fejlécére kerül, live region csak állapotváltozást mond.

### P6-06 — Manual checkpoint

- pontos, verziózott runbook lépés;
- „Kész, ellenőrzés” gomb csak ezután futtat read-only assertiont;
- timeout nincs automatikusan, de elapsed time látszik;
- skip bizonyító futásban nincs; exploratory módban skip = run incomplete, nem pass;
- user nem adhat meg shell parancsot a UI-n.

### P6-07 — Safe persistence és recovery

- safe run context sessionStorage-ban minden terminal step után;
- hard reload után „Folytatás” csak azonos subject/scenario version mellett;
- félbeszakadt mutation `unknown` állapot: automatikus újraküldés helyett read-back
  reconciliation (content detail/operator action);
- ha nem dönthető el, a run failed/inconclusive és új run szükséges;
- clear run csak evidence export figyelmeztetés után.

### P6-08 — Export

Formátum: JSON és abból determinisztikusan generált Markdown.

Tartalom:

- schemaVersion, run/scenario ID és verzió;
- started/completedAt, összesített status;
- role/permission lista subject nélkül vagy opcionálisan hash-elt subjecttel;
- step safe summary, duration, status/code, correlation ID;
- manuális checkpointok visszaigazolása;
- environment címke és commit SHA, ha build-time safe érték.

Redaction allowlist-alapú: ami nincs explicit engedélyezve, nem exportálódik.
Token, header, body, password, endpoint credential és teljes DB URL tilos.

### P6-09 — Tesztek

- scenario schema hibák;
- exact assertion minden ága és false-positive regresszió;
- timeout/abort/polling;
- mutation lost response reconciliation;
- safe persistence subject/version mismatch;
- export snapshot és secret canary redaction;
- manual checkpoint pass/incomplete;
- teljes S01–S04 MSW integration;
- full-stack S01 és S04 run.

## 6. Becslés

| Terület | Becslés |
| --- | ---: |
| Registry + engine + assertion | 1.5–2 nap |
| Timeline + preflight + manual checkpoint | 1–1.5 nap |
| Persistence + export/redaction | 0.75–1 nap |
| Scenario-k + tesztek/evidence | 1–1.5 nap |
| **Összesen** | **4.25–6 mérnöknap** |

## 7. Definition of Done

- [ ] Minden negatív lépés exact status/code/fields assertiont használ.
- [ ] Váratlan hiba soha nem számít passnak.
- [ ] Minden run új content ID-val indul.
- [ ] Mutation lost response nem okoz automatikus duplikálást.
- [ ] Manual fault injection nem fut UI-ból.
- [ ] Refresh után safe módon folytatható vagy egyértelműen inconclusive.
- [ ] JSON/Markdown export allowlistelt és secretmentes.
- [ ] S01–S04 integration, kijelölt full-stack scenario zöld.

