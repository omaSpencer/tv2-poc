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

## Release artifactok

- contract snapshot: `poc/contracts/backend.openapi.json`;
- frontend production bundle: `poc/frontend/dist`;
- Playwright HTML/JSON/trace: `poc/frontend/e2e/.report`, `.artifacts`;
- release evidence: `poc/PHASE-7-EVIDENCE.md`;
- állapot-, capability- és security-mátrix: a `poc/` gyökérben.

