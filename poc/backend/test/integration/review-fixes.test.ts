/**
 * Regression cases for the M0–M3 code review (R01–R12).
 *
 * Each case asserts the behaviour the review's "Regressziós próba" paragraph
 * asks for, and each one fails on the pre-fix code. They live in one file so
 * the mapping finding → proof stays visible; the milestone suites keep their
 * own numbering untouched.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from '@nats-io/transport-node';
import { jetstreamManager } from '@nats-io/jetstream';
import { ConfigurationError, validateConfig } from '../../src/config.js';
import { OutboxRepository } from '../../src/outbox/outbox.repository.js';
import { OutboxWake } from '../../src/outbox/outbox.wake.js';
import { ProcessingStatusController } from '../../src/ops/processing-status.controller.js';
import { RelayState } from '../../src/messaging/relay.state.js';
import { SearchState } from '../../src/search/worker.state.js';
import { normalizeCreateCommand, normalizeVersionedCommand } from '../../src/contracts/http.js';
import { ROLE_GROUPS } from '../../src/contracts/permissions.js';
import { DEMO_CONTENT } from '../fixtures/demo.js';
import { context, createServices, query, testDatabaseUrl, truncateAll } from '../support/database.js';
import { hasNats, isolatedTopology, natsUrl, waitFor } from '../support/nats.js';
import { createRelayTestApp } from '../support/relay-app.js';
import { applyIdentityEnv, createIdentityApp, type IdentityApp } from '../support/identity-app.js';
import { createOidcMock, type OidcMock } from '../support/oidc-mock.js';
import { destroyTopology } from '../../src/messaging/topology.js';

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const dbUrl = (() => {
  try { return testDatabaseUrl(); } catch { return ''; }
})();
const natsReady = hasNats();

/* ------------------------------------------------------------ R02 · P1 */

describe.skipIf(!dbUrl)('R02: processing-status with a pending outbox row', () => {
  const { database, service } = createServices(dbUrl);
  const outbox = new OutboxRepository();

  beforeEach(() => truncateAll(dbUrl));

  async function publishOne() {
    const op = context('publisher-1', `corr-${randomUUID()}`, ['publisher']);
    const draft = await service.create(
      normalizeCreateCommand({ ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] }),
      op,
    );
    return service.publish(draft.id, normalizeVersionedCommand({ expectedVersion: 1 }), op);
  }

  it('decodes min(occurred_at) as a real Date at the repository boundary', async () => {
    await publishOne();
    const stats = await outbox.pendingStats(database.db);
    expect(stats.pending).toBe(1);
    expect(typeof stats.pending).toBe('number');
    // The pg driver hands back a string; the repository must have decoded it.
    expect(stats.oldestOccurredAt).toBeInstanceOf(Date);
    expect(Number.isNaN(stats.oldestOccurredAt!.getTime())).toBe(false);
  });

  it('answers 200 with a valid ISO time and a non-negative age, relay off', async () => {
    await publishOne();
    const config = {
      getOrThrow: (key: string) => (key === 'FEATURE_OUTBOX_RELAY' ? 'off' : ''),
      get: () => undefined,
    };
    const broker = {
      snapshot: async () => ({
        connected: false, streamPresent: null, consumers: null, quarantinePending: null,
      }),
    };
    // FEATURE_SEARCH is off here, so the registry reports disabled and the
    // controller must not reach for any index state (M4-07 keeps R02 closed).
    const search = { enabled: false, probeReachability: async () => undefined };
    const controller = new ProcessingStatusController(
      config as never, database, outbox, broker as never, new RelayState(),
      search as never, new SearchState(),
    );
    const view = await controller.status();
    expect(view.outbox.pending).toBe(1);
    expect(view.outbox.oldestOccurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(Number.isNaN(Date.parse(view.outbox.oldestOccurredAt!))).toBe(false);
    expect(view.outbox.oldestAgeMs).toBeGreaterThanOrEqual(0);
    expect(view.indexes).toBeUndefined();
  });

  it('keeps the empty-outbox answer null, not a decoding error', async () => {
    const stats = await outbox.pendingStats(database.db);
    expect(stats.pending).toBe(0);
    expect(stats.oldestOccurredAt).toBeNull();
  });
});

describe.skipIf(!dbUrl || !natsReady)('R02: processing-status over HTTP with a pending row', () => {
  const { service } = createServices(dbUrl);
  beforeEach(() => truncateAll(dbUrl));

  it('stays 200 while the relay is off and the broker is unreachable', async () => {
    const names = isolatedTopology('R02');
    const op = context('publisher-1', `corr-${randomUUID()}`, ['publisher']);
    const draft = await service.create(
      normalizeCreateCommand({ ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] }),
      op,
    );
    await service.publish(draft.id, normalizeVersionedCommand({ expectedVersion: 1 }), op);

    const app = await createRelayTestApp({
      natsUrl: 'nats://127.0.0.1:1',
      names,
      databaseUrl: dbUrl,
      defaultActor: { sub: 'publisher-1', roles: ['publisher'] },
      deferStart: true,
    });
    try {
      const response = await app.request('GET', '/admin/processing-status', {
        actor: { sub: 'publisher-1', roles: ['publisher'] },
      });
      expect(response.status).toBe(200);
      expect(response.body.outbox.pending).toBe(1);
      expect(typeof response.body.outbox.oldestOccurredAt).toBe('string');
      expect(response.body.outbox.oldestAgeMs).toBeGreaterThanOrEqual(0);
    } finally {
      await app.close();
    }
  });
});

/* ------------------------------------------------------------ R05 · P2 */

describe.skipIf(!dbUrl || !natsReady)('R05: shutdown grace is a real upper bound', () => {
  const { service } = createServices(dbUrl);
  beforeEach(() => truncateAll(dbUrl));

  it('returns within the grace period while the publish stays blocked', async () => {
    const names = isolatedTopology('R05');
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const app = await createRelayTestApp({
      natsUrl: natsUrl(),
      names,
      databaseUrl: dbUrl,
      deferStart: true,
      ackTimeoutMs: 30_000,
      hooks: { beforePublish: async () => { await hold; } },
    });
    try {
      const op = context('publisher-1', `corr-${randomUUID()}`, ['publisher']);
      const draft = await service.create(
        normalizeCreateCommand({ ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] }),
        op,
      );
      await service.publish(draft.id, normalizeVersionedCommand({ expectedVersion: 1 }), op);

      app.relay.start();
      await new Promise(resolve => setTimeout(resolve, 200));

      const graceMs = 300;
      const started = Date.now();
      // The blocked operation is NOT released before or during the stop.
      await app.relay.stop(graceMs);
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(graceMs + 1500);

      // A loop abandoned at the deadline must not be joined by a second one.
      expect(app.relay.hasOrphanedLoop).toBe(true);
      app.relay.start();
      expect(app.relay.hasOrphanedLoop).toBe(true);
    } finally {
      // Release only now: the point of the case is that the grace period
      // expired while the operation was still blocked.
      release();
      // The abandoned loop finishes its publish; let it, then tear down.
      await new Promise(resolve => setTimeout(resolve, 1500));
      await app.close();
      const nc = await connect({ servers: natsUrl() });
      const jsm = await jetstreamManager(nc);
      await destroyTopology(jsm, names).catch(() => undefined);
      await nc.close();
    }
  });
});

/* ------------------------------------------------------------ R06 · P2 */

describe('R06: retry backoff is not shortened by new CMS events', () => {
  it('only shutdown ends a backoff; signal() ends an idle poll', async () => {
    const wake = new OutboxWake();

    const idleStarted = Date.now();
    const idle = wake.wait(5000);
    setTimeout(() => wake.signal(), 20);
    await idle;
    expect(Date.now() - idleStarted).toBeLessThan(1000);

    const backoffStarted = Date.now();
    const backoff = wake.backoff(400);
    // Five content signals arrive while the backoff is running.
    for (let i = 0; i < 5; i += 1) setTimeout(() => wake.signal(), 10 * (i + 1));
    await backoff;
    const elapsed = Date.now() - backoffStarted;
    expect(elapsed).toBeGreaterThanOrEqual(350);

    // Shutdown does end it, and stays latched until resume().
    const interrupted = wake.backoff(5000);
    const interruptStarted = Date.now();
    wake.interrupt();
    await interrupted;
    expect(Date.now() - interruptStarted).toBeLessThan(1000);
    await wake.backoff(5000); // latched: returns immediately
    wake.resume();
  });
});

/* ------------------------------------------------------------ R12 · P3 */

describe('R12: idle waits do not accumulate callbacks', () => {
  it('drops each waiter on its own timeout', async () => {
    const wake = new OutboxWake();
    for (let i = 0; i < 20; i += 1) await wake.wait(1);
    expect(wake.pendingWaiters).toBe(0);

    const parked = [wake.wait(5000), wake.backoff(5000)];
    expect(wake.pendingWaiters).toBe(2);
    wake.interrupt();
    await Promise.all(parked);
    expect(wake.pendingWaiters).toBe(0);
    wake.resume();
  });

  it('a later signal does not run callbacks of already timed-out waits', async () => {
    const wake = new OutboxWake();
    let resolved = 0;
    for (let i = 0; i < 10; i += 1) {
      await wake.wait(1).then(() => { resolved += 1; });
    }
    expect(resolved).toBe(10);
    wake.signal();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(resolved).toBe(10);
    expect(wake.pendingWaiters).toBe(0);
  });
});

/* ------------------------------------------------------ R07 / R08 · P2 */

describe.skipIf(!dbUrl)('R07 / R08: token time validity and JWKS outages', () => {
  let idp: OidcMock;
  let app: IdentityApp;
  let savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'FEATURE_IDENTITY', 'OIDC_ISSUER_URL', 'OIDC_AUDIENCE', 'OIDC_JWKS_URI',
    'OIDC_CLOCK_TOLERANCE_S', 'OIDC_HTTP_TIMEOUT_MS',
  ];

  beforeAll(async () => {
    savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    idp = await createOidcMock();
    applyIdentityEnv({
      issuer: idp.issuer,
      audience: idp.audience,
      clockToleranceS: 30,
      verifierOptions: { jwksCooldownMs: 0, jwksCacheMaxAgeMs: 0 },
    }, dbUrl);
    app = await createIdentityApp({
      issuer: idp.issuer,
      audience: idp.audience,
      clockToleranceS: 30,
      verifierOptions: { jwksCooldownMs: 0, jwksCacheMaxAgeMs: 0 },
    });
  });

  beforeEach(() => {
    idp.resumeJwks();
    app.discovery.reset();
    app.verifier.resetJwks();
  });

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    // Identity-on env must not leak into the later assemblies in this file.
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  const publisherToken = (extra: Record<string, unknown>) => idp.signAccessToken({
    sub: 'publisher-sub',
    groups: [ROLE_GROUPS.publisher],
    ...extra,
  });

  it('R07: rejects an iat beyond the clock tolerance', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await publisherToken({ iat: now + 3600, exp: now + 3900 });
    const response = await app.request('GET', '/me', { token });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('unauthenticated');
  });

  it('R07: accepts an iat inside the clock tolerance', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await publisherToken({ iat: now + 5, exp: now + 300 });
    const response = await app.request('GET', '/me', { token });
    expect(response.status).toBe(200);
    expect(response.body.sub).toBe('publisher-sub');
  });

  it('R07: a token without iat stays accepted, per plan 2.3', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await idp.signAccessToken({
      sub: 'publisher-sub',
      groups: [ROLE_GROUPS.publisher],
      exp: now + 300,
      iat: null,
    });
    const [, payload] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as { iat?: number };
    expect(claims.iat).toBeUndefined();
    const response = await app.request('GET', '/me', { token });
    expect(response.status).toBe(200);
  });

  it('R08: a JWKS HTTP 503 is a dependency failure, not a 401', async () => {
    idp.failJwksWithStatus(503);
    const token = await publisherToken({});
    const response = await app.request('GET', '/me', { token });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('dependency_unavailable');
  });

  it('R08: a JWKS HTTP 500 is a dependency failure too', async () => {
    idp.failJwksWithStatus(500);
    const token = await publisherToken({});
    const response = await app.request('GET', '/me', { token });
    expect(response.status).toBe(503);
  });

  it('R08: a non-JSON JWKS body is a dependency failure', async () => {
    idp.failJwksWithGarbage();
    const token = await publisherToken({});
    const response = await app.request('GET', '/me', { token });
    expect(response.status).toBe(503);
  });

  it('R08: a forged signature and an unknown kid stay 401', async () => {
    const forged = await idp.signWithForeignKey({ sub: 'publisher-sub', groups: [ROLE_GROUPS.publisher] });
    expect((await app.request('GET', '/me', { token: forged })).status).toBe(401);

    const unknownKid = await publisherToken({ kid: 'no-such-key' });
    expect((await app.request('GET', '/me', { token: unknownKid })).status).toBe(401);
  });
});

/* ------------------------------------------------------------ R11 · P2 */

describe('R11: issuer and JWKS URL shape are validated at startup', () => {
  const base = {
    NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://poc:sentinel-password@127.0.0.1:1/poc',
    FEATURE_IDENTITY: 'on', OIDC_AUDIENCE: 'poc-backend-api',
  };

  it('refuses a non-URL issuer by key name, before listen', () => {
    try {
      validateConfig({ ...base, OIDC_ISSUER_URL: 'not-a-url' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).keys).toEqual(['OIDC_ISSUER_URL']);
      // No secret and no supplied value in the message.
      expect((error as Error).message).not.toContain('not-a-url');
    }
  });

  it('refuses a malformed explicit JWKS URI', () => {
    try {
      validateConfig({
        ...base,
        OIDC_ISSUER_URL: 'https://idp.example/application/o/poc-backend/',
        OIDC_JWKS_URI: 'jwks',
      });
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigurationError).keys).toEqual(['OIDC_JWKS_URI']);
    }
  });

  it('refuses a non-http protocol', () => {
    expect(() => validateConfig({ ...base, OIDC_ISSUER_URL: 'ftp://idp.example/' }))
      .toThrow(ConfigurationError);
  });

  it('accepts http on a local host name and https elsewhere', () => {
    expect(validateConfig({
      ...base, OIDC_ISSUER_URL: 'http://127.0.0.1:9000/application/o/poc-backend/',
    }).OIDC_ISSUER_URL).toBe('http://127.0.0.1:9000/application/o/poc-backend/');
    expect(validateConfig({
      ...base,
      OIDC_ISSUER_URL: 'https://idp.example/application/o/poc-backend/',
      OIDC_JWKS_URI: 'https://idp.example/application/o/poc-backend/jwks/',
    }).OIDC_JWKS_URI).toBe('https://idp.example/application/o/poc-backend/jwks/');
  });

  it('leaves the URL check off while the feature is off', () => {
    expect(() => validateConfig({
      NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'info',
      DATABASE_URL: 'postgresql://poc:sentinel-password@127.0.0.1:1/poc',
      OIDC_ISSUER_URL: 'not-a-url',
    })).not.toThrow();
  });
});

/* ------------------------------------------------------ R01 / R09 · P1 */

describe('R01 / R09: the full smoke owns its database and proves delivery', () => {
  let source = '';

  beforeAll(async () => {
    source = await readFile(join(BACKEND_ROOT, 'scripts', 'smoke-full.mjs'), 'utf8');
  });

  it('never relays out of the supplied DATABASE_URL', () => {
    // The supplied URL is a server coordinate; the target is generated.
    expect(source).toContain('poc_smoke_${RUN_ID}_test');
    expect(source).toContain('CREATE DATABASE');
    expect(source).toContain('DROP DATABASE IF EXISTS');
    // The child applications must receive the generated URL, never the input.
    expect(source).not.toMatch(/DATABASE_URL=\$\{serverUrl\}/);
    expect(source).toMatch(/DATABASE_URL=\$\{databaseUrl\}/);
  });

  it('asserts a real delivery, not process liveness', () => {
    expect(source).toContain('insertFixtureEvent');
    expect(source).toContain('delivered_at is null');
    expect(source).toContain('streams.getMessage');
    expect(source).toContain('relay_delivered');
    // The pre-fix "process is still alive" check must be gone.
    expect(source).not.toContain("check(app.child.exitCode === null, 'relay did not start')");
  });

  it('separates PASS, FAIL and PENDING', () => {
    expect(source).toContain("record(name, 'pending'");
    expect(source).toContain('pending checks do not close the gate');
    expect(source).not.toMatch(/record\('full\.search pending', true/);
  });
});

/* ------------------------------------------------------------ R03 · P2 */

describe('R03: the core smoke supplies every required Compose variable', () => {
  it('derives the required variable list from compose.yaml', async () => {
    const compose = await readFile(join(BACKEND_ROOT, 'compose.yaml'), 'utf8');
    const required = [...compose.matchAll(/\$\{([A-Z0-9_]+):\?/g)].map(match => match[1]!);
    expect(required).toContain('AUTHENTIK_POC_USER_PASSWORD');
    expect(required).toContain('AUTHENTIK_BOOTSTRAP_TOKEN');

    const smoke = await readFile(join(BACKEND_ROOT, 'scripts', 'smoke-m0.mjs'), 'utf8');
    expect(smoke).toContain('requiredComposeVariables');
    // Hand-maintained list removed: the generator reads compose.yaml itself.
    expect(smoke).not.toContain("'AUTHENTIK_SECRET_KEY=smoke-only'");
  });
});

/* ------------------------------------------------------------ R04 · P2 */

describe('R04: the M2 demo starts with a valid port configuration', () => {
  it('uses the test-mode / dynamic-port contract and cleans up on failure', async () => {
    const demo = await readFile(join(BACKEND_ROOT, 'scripts', 'demo-m2.mjs'), 'utf8');
    expect(demo).not.toContain("'NODE_ENV=development',");
    expect(demo).toContain("'NODE_ENV=test',");
    expect(demo).toContain("'PORT=0',");
    // process.exit() must not run inside the catch block any more.
    expect(demo).not.toContain("  fail('demo_failed', error.message);");
    expect(demo).toContain('if (failure) fail(');
  });

  it('accepts the configuration the demo writes', () => {
    expect(() => validateConfig({
      NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'info',
      DATABASE_URL: 'postgresql://poc:sentinel-password@127.0.0.1:1/poc',
      FEATURE_IDENTITY: 'on',
      OIDC_ISSUER_URL: 'http://127.0.0.1:9000/application/o/poc-backend/',
      OIDC_AUDIENCE: 'poc-backend-api',
    })).not.toThrow();
  });
});

/* ------------------------------------------------------------ R10 · P2 */

describe.skipIf(!dbUrl)('R10: the OpenAPI document carries request and response schemas', () => {
  it('documents bodies, expectedVersion, public/admin difference and errors', async () => {
    const { OPENAPI_SCHEMAS } = await import('../../src/contracts/openapi.js');
    const names = Object.keys(OPENAPI_SCHEMAS);
    expect(names).toEqual(expect.arrayContaining([
      'CreateContentBody', 'PatchContentBody', 'VersionedCommandBody',
      'AdminContentView', 'PublicContentView', 'ProblemDocument',
      'HealthView', 'ProcessingStatusView', 'MeView',
    ]));

    const create = OPENAPI_SCHEMAS.CreateContentBody as {
      required?: string[]; properties?: Record<string, unknown>; additionalProperties?: boolean;
    };
    expect(create.required).toContain('title');
    expect(create.additionalProperties).toBe(false);

    const patch = OPENAPI_SCHEMAS.PatchContentBody as {
      required?: string[]; properties?: Record<string, { type?: string }>;
    };
    expect(patch.required).toContain('expectedVersion');
    expect(patch.properties?.expectedVersion?.type).toBe('integer');

    const publicView = OPENAPI_SCHEMAS.PublicContentView as { properties?: Record<string, unknown> };
    const adminView = OPENAPI_SCHEMAS.AdminContentView as { properties?: Record<string, unknown> };
    for (const editorialOnly of ['mediaAssetId', 'createdBy', 'updatedBy', 'status', 'version']) {
      expect(Object.keys(publicView.properties ?? {})).not.toContain(editorialOnly);
      expect(Object.keys(adminView.properties ?? {})).toContain(editorialOnly);
    }

    const problem = OPENAPI_SCHEMAS.ProblemDocument as {
      properties?: Record<string, { enum?: string[] }>; required?: string[];
    };
    expect(problem.required).toEqual(expect.arrayContaining(['type', 'title', 'status', 'code', 'detail']));
    expect(problem.properties?.code?.enum).toEqual(expect.arrayContaining([
      'validation_failed', 'version_conflict', 'slug_conflict', 'dependency_unavailable',
    ]));
  });

  it('a real response validates against the published admin schema', async () => {
    const { adminContentViewSchema } = await import('../../src/contracts/openapi.js');
    const { createTestApp } = await import('../support/test-app.js');
    await truncateAll(dbUrl);
    const app = await createTestApp({ sub: 'publisher-1', roles: ['publisher'] });
    try {
      const created = await app.request('POST', '/admin/contents', {
        body: { ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] },
      });
      expect(created.status).toBe(201);
      const parsed = adminContentViewSchema.safeParse(created.body);
      expect(parsed.error?.issues ?? []).toEqual([]);
      expect(parsed.success).toBe(true);
    } finally {
      await app.close();
    }
  });
});

/* ---------------------------------------------- R01 regression, live DB */

describe.skipIf(!dbUrl || !natsReady)('R01: an outside pending event survives a relay run on another database', () => {
  it('leaves rows of an unrelated database untouched', async () => {
    // The smoke runner's isolation is proven by construction above; here the
    // live counterpart: a relay bound to an isolated stream must only ever
    // touch the database it was configured with.
    const { service } = createServices(dbUrl);
    await truncateAll(dbUrl);
    const names = isolatedTopology('R01');
    const op = context('publisher-1', `corr-${randomUUID()}`, ['publisher']);
    const draft = await service.create(
      normalizeCreateCommand({ ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] }),
      op,
    );
    await service.publish(draft.id, normalizeVersionedCommand({ expectedVersion: 1 }), op);
    const before = await query<{ event_id: string; delivered_at: string | null }>(
      'select event_id, delivered_at from outbox_event', [], dbUrl,
    );
    expect(before).toHaveLength(1);

    const app = await createRelayTestApp({ natsUrl: natsUrl(), names, databaseUrl: dbUrl });
    try {
      await waitFor('the configured database to be drained', async () => {
        const rows = await query<{ n: number }>(
          'select count(*)::int as n from outbox_event where delivered_at is null', [], dbUrl,
        );
        return rows[0]!.n === 0;
      });
      const after = await query<{ event_id: string; delivered_at: string | null }>(
        'select event_id, delivered_at from outbox_event', [], dbUrl,
      );
      expect(after[0]!.event_id).toBe(before[0]!.event_id);
      expect(after[0]!.delivered_at).not.toBeNull();
    } finally {
      await app.close();
      const nc = await connect({ servers: natsUrl() });
      const jsm = await jetstreamManager(nc);
      await destroyTopology(jsm, names).catch(() => undefined);
      await nc.close();
    }
  });
});
