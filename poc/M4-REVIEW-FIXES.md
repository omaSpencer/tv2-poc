# M4 code review – javítások

2026-09-16 · Az [M4 code review](M4-CODE-REVIEW.md) R01–R07 tételeinek javítása.

## Implementált változtatások

| Tétel | Javítás | Regressziós bizonyíték |
| --- | --- | --- |
| R01 – halott consumer | Pullhiba után a handle érvénytelenedik; megszakadt kapcsolatnál új kapcsolat/consumer és szerződésellenőrzés történik. A broker meglévő közös connection-promise-a koordinálja A/B kapcsolódását. | `test/m4-review.test.ts`: hibás handle helyett új consumer dolgozza fel az eseményt. `test/m4-broker-recovery.test.ts`: két worker valódi közös NATS-kapcsolatának megszakítása és felzárkózása. |
| R02 – task UID elvesztése | Ismert UID átmeneti pollhibánál megmarad; a terminal sikertelen task továbbra is új művelethez vezethet. | Network/429/503 pollhiba után egy submit, ugyanaz az UID minden pollban. T08 valódi beforeSubmit-számlálót ellenőriz. |
| R03 – nem kész index routingja | Explicit, sikeres bootstraphoz kötött belső készültség; mindkét routingág ellenőrzi az állapotot. Off/bootstrapping/halted index nem kereshető; első bootstrap előtti retry sem. | B off/bootstrapping/halted esetén nincs B-hívás; készültség előtti és utáni A-retry külön ellenőrizve. |
| R04 – meglévő index átírása | Létező eltérő settings vagy primary key nem módosul. Kizárólag az adott bootstrap által igazoltan létrehozott index konfigurálható automatikusan. | Default settingsű létező index elutasítása írás nélkül; saját settings-task megszakadt polljának folytatása új submit nélkül. |
| R05 – hamis demó-végállapot | Az injektált stale dokumentum task-sikerrel igazolt törlése; mindkét fixture teljes elvárt állapotának ellenőrzése A-n és B-n. A drain a durable pending és ack-pending számlálókat is nézi. | A közös demó-ellenőrző elutasítja a stale első fixture-t akkor is, ha a második egyezik. |
| R06 – hiányzó NATS_URL | Search on mellett a NATS_URL a relay flagtől függetlenül kötelező. | Search on/relay off hiányzó NATS_URL-lel startuphiba; helyes konfiguráció elfogadott. |
| R07 – túl ritka heartbeat | Indulási tartomány 1–10000 ms; a tényleges consumer ellenőrzése legfeljebb ack_wait/3 intervallumot enged. | 10001/30000/60000 ms konfiguráció elutasítva; a közvetlen worker-konstruálás sem kerüli meg az időarány ellenőrzését. |

A bootstrap az adott adapterhez tartozó memóriabeli sessionben őrzi az igazolt létrehozást és az elfogadott task UID-kat, amíg a konfigurálás be nem fejeződik. Processz-újraindítás után egy félkész, eltérő index operátori beavatkozást igényel; a default settings nem tekinthető tulajdonosi bizonyítéknak. Ez szándékos védelmi szabály, nem automatikus reindex.

A leállási ellenőrzéseket a bootstrap és a submit utáni vezérlésben is megerősítettem: leállított worker ne kezdjen új pullt vagy indexírást, és későn teljesülő karanténpublikálás ne ACK-oljon a stop után.

## Ellenőrzés

**Környezet:** a hivatalos SHA256-listával ellenőrzött Node **24.20.0**, PostgreSQL **17**, valódi NATS JetStream, két külön Meilisearch **1.15.2** konténer. A futás saját adatbázisokat, streamneveket és indexeket használt.

A közös workspace-en az első próbát a folyamatban lévő M5 `outbox_sequence` sémabővítése és a hozzá még hiányzó migráció megakasztotta. Ezért az integrációs ellenőrzés a `b5a95d7` M4 commit ideiglenes másolatán, az összes M4-javítással futott. Az M5 fájlokhoz nem nyúltam. A build és lint a közös workspace-en is sikeres.

| Ellenőrzés | Eredmény |
| --- | --- |
| Build, Node 24.20.0 | PASS |
| Lint, Node 24.20.0 | PASS, 0 warning / 0 error |
| Célzott javítási tesztek | 18/18 PASS; a teljes futásban is sikeresek |
| Teljes M0–M4 regresszió, Node 24.20.0 | **170/172 PASS**, két indulási timeout: M0 identity bootstrap és M4-T11 worker-bootstrap. [Nyers log](/Users/busizoltan/code/tv2-poc/poc/review/m4-fixes-full-tests.log). |
| Időtúllépett esetek és végleges T09 külön ismétlése | **3/3 PASS** (M0 bootstrap, M4-T11, végleges M4-T09); a 43 skip a célzott névszűrés következménye. [Log](/Users/busizoltan/code/tv2-poc/poc/review/m4-fixes-followup-tests.log). |
| Full smoke, Node 24.20.0 | **4 PASS, 0 FAIL, 1 PENDING** (Authentik L2). [Log](/Users/busizoltan/code/tv2-poc/poc/review/m4-fixes-smoke.log). |
| M4 demó, Node 24.20.0 | **PASS**; mindkét fixture teljes végállapota ellenőrizve, `withdrawnAbsent=true`. [Log](/Users/busizoltan/code/tv2-poc/poc/review/m4-fixes-demo.log). |

A retry integrációs teszt korábbi felső korlátja a backoff mellett a teljes SDK-/hálózati időt is mérte, ezért nem volt érvényes backoff-felsőkorlát. A pontosított próba minden hibamódban két tényleges sikertelen kísérlet közti időt vizsgál, nem különböző sikeresen feldolgozott események közti hézagokat. A pontos 1000 ms-os várakozást külön kontrollált órás teszt ellenőrzi, a teljes D08-ladder és jitter meglévő próbái mellett.

A korábbi M4-EVIDENCE.md a javítás előtti futás jegyzőkönyve; az új változtatások bizonyítéka ez a dokumentum és a kapcsolt logok. Az Authentik L2 üzleti belépési út továbbra is külön pending.

**Értékelés:** az R01–R07 javításai elkészültek; a célzott regressziók, a valódi NATS-kapcsolathelyreállítás, a smoke és a demó sikeresek. A teljes csomag két timeoutja külön ismétlésben nem jelentkezett; egyetlen megszakítás nélküli 172/172-es futást nem állítok. A két timeout gyökérokát az ismétlés önmagában nem bizonyítja.

## Hatókör

Az M5-höz közben készített `schema.ts` és `contracts/reindex.ts` módosításokat nem szerkesztettem. A Gitből kizárt scripts-könyvtár korábbi problémáját a felhasználó már rendezte. Commit vagy push nem készült.
