/**
 * P7-03 / P7-04 – full-stack előfeltétel-ellenőrzés.
 *
 * A hiányzó külső előfeltétel (Authentik L2, backend, feature flag) itt hangos
 * hibával áll meg. Nem skipelünk csendben: a terv szerint a hiányzó L2 release
 * blocker, nem automatikus pass.
 */
import { discoveryUrl, e2eConfig, type E2eConfig } from './env';

type Probe = { name: string; ok: boolean; detail: string };

async function fetchJson(
  url: string,
  timeoutMs = 5000,
): Promise<{ status: number; body: unknown } | { error: string }> {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** A /health/ready `details` mezőjéből a leállt indikátorok neve. */
function downIndicators(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const details = (body as { details?: unknown; error?: unknown }).error
    ?? (body as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return [];
  return Object.entries(details as Record<string, { status?: unknown }>)
    .filter(([, value]) => value?.status === 'down')
    .map(([name]) => name);
}

function problemCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'code' in body) {
    const code = (body as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

async function probeBackend(config: E2eConfig): Promise<Probe[]> {
  const probes: Probe[] = [];

  const ready = await fetchJson(`${config.backendOrigin}/health/ready`);
  if ('error' in ready) {
    probes.push({
      name: 'backend',
      ok: false,
      detail: `${config.backendOrigin}/health/ready nem érhető el (${ready.error}). Indítsd a backendet: cd poc/backend && npm run build && ENV_FILE=.env.e2e npm start`,
    });
    return probes;
  }
  probes.push({
    name: 'backend',
    ok: ready.status === 200,
    detail:
      ready.status === 200
        ? `${config.backendOrigin}/health/ready → 200`
        : `${config.backendOrigin}/health/ready → ${ready.status}; leállt indikátor: ${downIndicators(ready.body).join(', ') || 'ismeretlen'}. Ellenőrizd, hogy a backend DATABASE_URL portja egyezik-e a futó postgres konténer publikált portjával (docker compose ps), és hogy a backendet az env módosítása után újraindítottad-e.`,
  });

  const me = await fetchJson(`${config.backendOrigin}/me`);
  if ('error' in me) {
    probes.push({ name: 'identity', ok: false, detail: `GET /me hiba: ${me.error}` });
  } else if (me.status === 401) {
    probes.push({ name: 'identity', ok: true, detail: 'FEATURE_IDENTITY=on (token nélkül 401)' });
  } else if (me.status === 503) {
    probes.push({
      name: 'identity',
      ok: false,
      detail: `GET /me → 503 (${problemCode(me.body) ?? 'ismeretlen kód'}). FEATURE_IDENTITY=off vagy az OIDC discovery nem érhető el a backendből.`,
    });
  } else {
    probes.push({
      name: 'identity',
      ok: false,
      detail: `GET /me → ${me.status}; token nélkül 401-et várunk`,
    });
  }

  const search = await fetchJson(`${config.backendOrigin}/catalog/search?q=e2e-preflight&limit=1`);
  if ('error' in search) {
    probes.push({ name: 'search', ok: false, detail: `GET /catalog/search hiba: ${search.error}` });
  } else if (search.status === 200) {
    probes.push({ name: 'search', ok: true, detail: 'FEATURE_SEARCH=on, legalább egy index routolható' });
  } else {
    probes.push({
      name: 'search',
      ok: false,
      detail: `GET /catalog/search → ${search.status} (${problemCode(search.body) ?? 'ismeretlen kód'}). Oka lehet FEATURE_SEARCH=off, leállt Meilisearch instance, vagy hogy a projekciós worker nem tudott elindulni, mert az adatbázis nem elérhető – ilyenkor előbb a backend blokkert javítsd.`,
    });
  }

  return probes;
}

async function probeFrontend(config: E2eConfig): Promise<Probe> {
  const response = await fetchJson(config.baseUrl, 5000);
  if ('error' in response) {
    return {
      name: 'frontend',
      ok: false,
      detail: `A frontend nem válaszol a(z) ${config.baseUrl} címen (${response.error}). A Vite dev szervernek a 127.0.0.1 IPv4 címre kell bindelnie: npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`,
    };
  }
  return { name: 'frontend', ok: true, detail: `${config.baseUrl} → ${response.status}` };
}

async function probeAuthentik(config: E2eConfig): Promise<Probe> {
  const discovery = await fetchJson(discoveryUrl(config));
  if ('error' in discovery) {
    return {
      name: 'authentik',
      ok: false,
      detail: `Az OIDC discovery nem érhető el (${discovery.error}). Indítsd a full profile-t: cd poc/backend && docker compose --profile full up -d`,
    };
  }
  if (discovery.status !== 200) {
    return {
      name: 'authentik',
      ok: false,
      detail: `Az OIDC discovery HTTP ${discovery.status}. Ellenőrizd, hogy a blueprint alkalmazva van-e (application slug: poc-backend).`,
    };
  }
  const issuer = (discovery.body as { issuer?: string } | null)?.issuer;
  return {
    name: 'authentik',
    ok: true,
    detail: `discovery ok, issuer: ${issuer ?? 'ismeretlen'}`,
  };
}

export default async function globalSetup(): Promise<void> {
  const config = e2eConfig;
  const blockers: string[] = [];

  if (!config.userPassword) {
    blockers.push(
      'Hiányzik az E2E_USER_PASSWORD (vagy AUTHENTIK_POC_USER_PASSWORD). Másold a frontend/.env.e2e.example fájlt frontend/.env.e2e néven, és írd bele ugyanazt a jelszót, amivel az Authentik bootstrapelve lett.',
    );
  }

  const probes = [
    await probeFrontend(config),
    ...(await probeBackend(config)),
    await probeAuthentik(config),
  ];
  for (const probe of probes) {
    process.stdout.write(`${probe.ok ? 'OK     ' : 'BLOCKER'} ${probe.name.padEnd(9)} ${probe.detail}\n`);
    if (!probe.ok) blockers.push(`${probe.name}: ${probe.detail}`);
  }

  if (blockers.length > 0) {
    const lines = blockers.map((item) => `  - ${item}`).join('\n');
    throw new Error(
      `A full-stack E2E előfeltételek nem teljesülnek, ezért a suite nem fut le.\n${lines}\n\nRunbook: frontend/e2e/README.md`,
    );
  }
}
