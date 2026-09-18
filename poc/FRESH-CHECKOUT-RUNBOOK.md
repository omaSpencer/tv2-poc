# Fresh-checkout és release átadás

2026-09-17 · Node 24.20.0

## Gyors, külső függőség nélküli kapu

```bash
git clone <repository> tv2-poc
cd tv2-poc
nvm use
cd poc/frontend
npm ci
npm run verify
```

A frontend buildhez nem kell `.env` vagy futó backend. Az OIDC/API runtime
konfigurációt a `.env.example` dokumentálja; hiányában az alkalmazás biztonságos
`unconfigured`/kapcsolati állapotot mutat.

## Backend contract/integration kapu

```bash
cd poc/backend
npm ci
docker compose up -d --wait postgres
export TEST_DATABASE_URL='postgresql://poc:<password>@127.0.0.1:<port>/poc_release_test'
npm run db:reset
npm run verify
```

A `db:reset` csak `_test` végű explicit adatbázist fogad el. A schema teszt a hat
migráció egyszeri alkalmazását és a fontos adatbázis-invariánsokat ellenőrzi.

## Valódi full-stack browser kapu

A teljes, titokmentes konfiguráció és hibakeresés:
[frontend/e2e/README.md](frontend/e2e/README.md).

```bash
cd poc/backend
docker compose --profile full up -d --wait
ENV_FILE=.env.e2e npm run db:migrate
npm run build
ENV_FILE=.env.e2e npm start

# másik terminál
cd poc/frontend
npm ci
npm run e2e:install
E2E_DOCKER_CONTROL=true npm run e2e
```

Az Authentik L2 hiánya release blocker, nem skipelt siker. A fault-injection
tesztek a konténereket `afterEach` helyreállítással kezelik.

## Publikus perem és futtatási posture (BE-F1)

A böngésző-topológia **same-origin**: a böngésző relatív `/api/...` útra kér.
Fejlesztésben a Vite dev proxy, productionben az `app` profil `web` Nginx
service-e vágja le az `/api` prefixet és továbbít a host-portra ki nem tett
backendnek. Ugyanez az origin szolgálja ki az SPA-t és a deep linkeket. A backend
CORS nélkül fut, és preflightra sem válaszol; wildcard origin nem elfogadott. A
teljes szerződés és a külön-originű opció feltételei:
[backend/README.md](backend/README.md) „Böngésző-topológia és CORS".

A publikus catalog route-ok alkalmazásszintű limitet kapnak
(`RATE_LIMIT_PUBLIC*`), a túllépés `429` + `rate_limited` + `Retry-After`.
Fordított proxy mögött a megbízható hopok számát a
`RATE_LIMIT_TRUSTED_PROXY_HOPS` írja le; nulla hop mellett az
`X-Forwarded-For` figyelmen kívül marad.

A Compose-függőségek host-portjai alapból csak loopbacken érhetők el:

```bash
cd poc/backend
docker compose --profile full up -d --wait
docker compose --profile full ps --format '{{.Service}} {{.Publishers}}'   # 127.0.0.1 minden soron
```

Az alkalmazás image és a production posture külön overlay és külön `app` profil,
nem a CI által használt `full` profil:

```bash
cd poc/backend
cp .env.production.example .env.production      # majd írd át minden REPLACE_ME értéket
docker compose -f compose.yaml -f compose.prod.yaml \
  --env-file .env.production --profile app --profile full up -d --wait
docker compose -f compose.yaml -f compose.prod.yaml \
  --env-file .env.production --profile app ps
curl -s 127.0.0.1:8080/ingress-health
curl -s 127.0.0.1:8080/api/health/live
curl -s 127.0.0.1:8080/api/health/ready
```

Az overlay mindkét Meilisearch példányt `MEILI_ENV=production` módban, kötelező
és nem repóban tárolt master kulccsal indítja. A backend és a web konténer sem
rootként fut. A host csak a web `8080` portját kapja meg; a backend kizárólag a
Compose hálózaton érhető el.

## Release artifactok

- contract snapshot: `poc/contracts/backend.openapi.json`;
- frontend production bundle: `poc/frontend/dist`;
- Playwright HTML/JSON/trace: `poc/frontend/e2e/.report`, `.artifacts`;
- release evidence: `poc/PHASE-7-EVIDENCE.md`;
- állapot-, capability- és security-mátrix: a `poc/` gyökérben.
