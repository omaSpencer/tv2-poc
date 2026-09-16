/**
 * M2 L1 – token verification and access control against a mock OIDC issuer.
 * Requires TEST_DATABASE_URL. L2 (real Authentik) is separate and may be pending.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigurationError, validateConfig } from '../../src/config.js';
import { ROLE_GROUPS, ROLE_PERMISSIONS } from '../../src/contracts/permissions.js';
import { DEMO_CONTENT, DEMO_EDIT, DEMO_SLUG } from '../fixtures/demo.js';
import { query, testDatabaseUrl, truncateAll } from '../support/database.js';
import { applyIdentityEnv, createIdentityApp, type IdentityApp } from '../support/identity-app.js';
import {
  createOidcMock,
  forgeCompactJwt,
  signHs256WithModulus,
  TEST_AUDIENCE,
  TEST_CLIENT_ID,
  type OidcMock,
} from '../support/oidc-mock.js';

const url = testDatabaseUrl();
const SAMPLE_ID = '2ad0a7ef-bb1b-4c8e-8f4e-2e6d1f8a1b11';

let idp: OidcMock;
let app: IdentityApp;

async function tokenFor(role: 'viewer' | 'editor' | 'publisher', extra?: Parameters<OidcMock['signAccessToken']>[0]) {
  return idp.signAccessToken({
    sub: `${role}-sub`,
    groups: [ROLE_GROUPS[role]],
    ...extra,
  });
}

beforeAll(async () => {
  idp = await createOidcMock();
  applyIdentityEnv({
    issuer: idp.issuer,
    audience: idp.audience,
    verifierOptions: { jwksCooldownMs: 200, jwksCacheMaxAgeMs: 60_000 },
  }, url);
  app = await createIdentityApp({
    issuer: idp.issuer,
    audience: idp.audience,
    verifierOptions: { jwksCooldownMs: 200, jwksCacheMaxAgeMs: 60_000 },
  });
});

beforeEach(async () => {
  await truncateAll(url);
  idp.resumeJwks();
  app.discovery.reset();
  app.verifier.resetJwks();
});

afterAll(async () => {
  await app?.close();
  await idp?.close();
});

describe('M2-T01 configuration', () => {
  it('names missing OIDC keys, not the feature flag', () => {
    try {
      validateConfig({
        NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'info',
        DATABASE_URL: url, FEATURE_IDENTITY: 'on',
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).keys).toEqual(expect.arrayContaining(['OIDC_ISSUER_URL', 'OIDC_AUDIENCE']));
      expect((error as ConfigurationError).keys).not.toContain('FEATURE_IDENTITY');
    }
    expect(() => validateConfig({
      NODE_ENV: 'test', PORT: '0', LOG_LEVEL: 'info', DATABASE_URL: url,
      FEATURE_IDENTITY: 'on', OIDC_ISSUER_URL: idp.issuer, OIDC_AUDIENCE: TEST_AUDIENCE,
      OIDC_CLOCK_TOLERANCE_S: '31',
    })).toThrow(ConfigurationError);
  });
});

describe('M2-T02 / T02b identity on', () => {
  it('keeps readiness independent of the IdP and drops the admin prefix-503', async () => {
    const ready = await app.request('GET', '/health/ready');
    expect(ready.status).toBe(200);
    const blocked = await app.request('GET', `/admin/contents/${SAMPLE_ID}`);
    expect(blocked.status).toBe(401);
    expect(blocked.body.code).toBe('unauthenticated');
    expect(blocked.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('rejects every admin method without a usable Bearer token', async () => {
    const before = await query<{ count: number }>('select count(*)::int as count from content');
    for (const [method, path, body] of [
      ['GET', `/admin/contents/${SAMPLE_ID}`, undefined],
      ['POST', '/admin/contents', DEMO_CONTENT],
      ['PATCH', `/admin/contents/${SAMPLE_ID}`, { expectedVersion: 1, title: 'X' }],
      ['POST', `/admin/contents/${SAMPLE_ID}/publish`, { expectedVersion: 1 }],
      ['POST', `/admin/contents/${SAMPLE_ID}/withdraw`, { expectedVersion: 1 }],
      ['GET', '/admin/processing-status', undefined],
    ] as const) {
      for (const authorization of [undefined, '', 'Bearer', 'Bearer ', 'Basic abc', 'bearer token']) {
        const response = await app.request(method, path, {
          body,
          authorization: authorization as string | undefined,
          token: authorization === undefined ? null : undefined,
        });
        // Empty / missing Authorization → guard 401; malformed present header → boundary 401.
        expect(response.status, `${method} ${path} auth=${authorization}`).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe('Bearer');
        expect(response.body.code).toBe('unauthenticated');
      }
    }
    const after = await query<{ count: number }>('select count(*)::int as count from content');
    expect(after[0]!.count).toBe(before[0]!.count);
  });
});

describe('M2-T03 discovery mismatch', () => {
  it('rejects a configured JWKS URI that disagrees with discovery', async () => {
    applyIdentityEnv({
      issuer: idp.issuer,
      audience: idp.audience,
      jwksUri: 'http://127.0.0.1:9/wrong-jwks',
    }, url);
    const mismatched = await createIdentityApp({
      issuer: idp.issuer,
      audience: idp.audience,
      jwksUri: 'http://127.0.0.1:9/wrong-jwks',
    });
    try {
      const token = await tokenFor('publisher');
      const response = await mismatched.request('GET', '/me', { token });
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('dependency_unavailable');
    } finally {
      await mismatched.close();
      applyIdentityEnv({ issuer: idp.issuer, audience: idp.audience }, url);
    }
  });

  it('rejects a discovery issuer that disagrees with configuration', async () => {
    const mismatch = await createOidcMock({ issuerMismatch: 'https://evil.example/o/' });
    try {
      applyIdentityEnv({ issuer: mismatch.issuer, audience: mismatch.audience }, url);
      const nested = await createIdentityApp({ issuer: mismatch.issuer, audience: mismatch.audience });
      try {
        const token = await mismatch.signAccessToken({ sub: 'x', groups: [ROLE_GROUPS.publisher] });
        const response = await nested.request('GET', '/me', { token });
        expect(response.status).toBe(503);
        expect(response.body.code).toBe('dependency_unavailable');
        expect(JSON.stringify(response.body)).not.toContain('evil.example');
      } finally {
        await nested.close();
      }
    } finally {
      await mismatch.close();
      applyIdentityEnv({ issuer: idp.issuer, audience: idp.audience }, url);
    }
  });
});

describe('M2-T04 /me', () => {
  it('returns the verified summary and rejects anonymous callers', async () => {
    const token = await tokenFor('publisher');
    const me = await app.request('GET', '/me', { token });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      sub: 'publisher-sub',
      roles: ['publisher'],
      permissions: [...ROLE_PERMISSIONS.publisher],
    });
    expect(typeof me.body.expiresAt).toBe('string');
    expect(JSON.stringify(me.body)).not.toMatch(/@|poc-publisher|Bearer|groups/i);

    const anon = await app.request('GET', '/me', { token: null });
    expect(anon.status).toBe(401);
    expect(anon.headers.get('www-authenticate')).toBe('Bearer');
  });
});

describe('M2-T05 viewer', () => {
  it('identifies but never authorizes admin writes', async () => {
    const token = await tokenFor('viewer');
    const me = await app.request('GET', '/me', { token });
    expect(me.status).toBe(200);
    expect(me.body.permissions).toEqual([]);

    const created = await app.request('POST', '/admin/contents', {
      token, body: { ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] },
    });
    expect(created.status).toBe(403);
    const rows = await query<{ count: number }>('select count(*)::int as count from content');
    expect(rows[0]!.count).toBe(0);
  });
});

describe('M2-T06 editor', () => {
  it('can draft and edit but not publish or withdraw', async () => {
    const editor = await tokenFor('editor');
    const publisher = await tokenFor('publisher');
    const created = await app.request('POST', '/admin/contents', {
      token: editor, body: { ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] },
    });
    expect(created.status).toBe(201);
    const patched = await app.request('PATCH', `/admin/contents/${created.body.id}`, {
      token: editor,
      body: { expectedVersion: 1, summary: DEMO_EDIT.summary, tags: [...DEMO_EDIT.tags] },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.version).toBe(2);

    const publish = await app.request('POST', `/admin/contents/${created.body.id}/publish`, {
      token: editor, body: { expectedVersion: 2 },
    });
    expect(publish.status).toBe(403);
    const audits = await query<{ count: number }>(
      'select count(*)::int as count from content_audit where content_id = $1',
      [created.body.id],
    );
    expect(audits[0]!.count).toBe(2);

    // Publisher can finish the path so withdraw denial is meaningful on a published row.
    await app.request('POST', `/admin/contents/${created.body.id}/publish`, {
      token: publisher, body: { expectedVersion: 2 },
    });
    const withdraw = await app.request('POST', `/admin/contents/${created.body.id}/withdraw`, {
      token: editor, body: { expectedVersion: 3 },
    });
    expect(withdraw.status).toBe(403);
  });
});

describe('M2-T07 publisher', () => {
  it('walks the full M1 admin path with version integrity', async () => {
    const token = await tokenFor('publisher');
    const created = await app.request('POST', '/admin/contents', {
      token, body: { ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] },
    });
    expect(created.status).toBe(201);
    const edited = await app.request('PATCH', `/admin/contents/${created.body.id}`, {
      token, body: { expectedVersion: 1, summary: DEMO_EDIT.summary, tags: [...DEMO_EDIT.tags] },
    });
    expect(edited.status).toBe(200);
    const published = await app.request('POST', `/admin/contents/${created.body.id}/publish`, {
      token, body: { expectedVersion: 2 },
    });
    expect(published.status).toBe(200);
    expect(published.body.slug).toBe(DEMO_SLUG);
    const publicView = await app.request('GET', `/catalog/contents/${created.body.id}`, { token: null });
    expect(publicView.status).toBe(200);
    const withdrawn = await app.request('POST', `/admin/contents/${created.body.id}/withdraw`, {
      token, body: { expectedVersion: 3 },
    });
    expect(withdrawn.status).toBe(200);
    const republished = await app.request('POST', `/admin/contents/${created.body.id}/publish`, {
      token, body: { expectedVersion: 4 },
    });
    expect(republished.status).toBe(200);
    expect(republished.body.version).toBe(5);
  });
});

/**
 * M4-T24. The public search route is reachable without a token, but the
 * identity boundary's rule — a *present* Authorization header must verify —
 * applies to it exactly as it does to every other route. FEATURE_SEARCH is off
 * in this assembly, so the successful path answers the documented
 * `503 search_unavailable`; what matters here is that 401 comes first.
 */
describe('M4-T24 the public search route sits behind the same identity boundary', () => {
  it('is reachable without a token and rejects a present but invalid one', async () => {
    const anonymous = await app.request('GET', '/catalog/search?q=vadon', { token: null });
    expect(anonymous.status).toBe(503);
    expect(anonymous.body.code).toBe('search_unavailable');

    for (const authorization of ['Bearer not-a-jwt', 'Bearer ', 'Basic dXNlcjpwYXNz']) {
      const rejected = await app.request('GET', '/catalog/search?q=vadon', { authorization });
      expect(rejected.status, authorization).toBe(401);
      expect(rejected.body.code, authorization).toBe('unauthenticated');
      expect(rejected.headers.get('www-authenticate')).toBe('Bearer');
    }

    const expired = await tokenFor('publisher', { expOffsetSec: -45 });
    expect((await app.request('GET', '/catalog/search?q=vadon', { token: expired })).status).toBe(401);

    // A valid token does not turn the public route into an admin one.
    const valid = await tokenFor('viewer');
    const withToken = await app.request('GET', '/catalog/search?q=vadon', { token: valid });
    expect(withToken.status).toBe(503);
    expect(withToken.body.code).toBe('search_unavailable');

    // Validation still runs before anything else.
    expect((await app.request('GET', '/catalog/search', { token: null })).status).toBe(422);
  });
});

describe('M2-T08 expiry tolerance', () => {
  it('accepts tokens inside the 30s skew and rejects beyond it', async () => {
    const inside = await tokenFor('publisher', { expOffsetSec: -20 });
    expect((await app.request('GET', '/me', { token: inside })).status).toBe(200);
    const outside = await tokenFor('publisher', { expOffsetSec: -45 });
    const rejected = await app.request('GET', '/me', { token: outside });
    expect(rejected.status).toBe(401);
  });
});

describe('M2-T09–T13 token rejections', () => {
  it('rejects foreign issuer, bad audience, wrong signature, alg tricks and ID-token audience', async () => {
    const foreignIss = await idp.signAccessToken({
      sub: 'x', groups: [ROLE_GROUPS.publisher], iss: 'https://evil.example/',
    });
    const foreign = await app.request('GET', '/me', { token: foreignIss });
    expect(foreign.status).toBe(401);
    expect(JSON.stringify(foreign.body)).not.toContain(idp.issuer);

    for (const aud of [null, '', 'other', ['other'], []] as const) {
      const token = await idp.signAccessToken({
        sub: 'x', groups: [ROLE_GROUPS.publisher], aud: aud as string | string[] | null,
      });
      expect((await app.request('GET', '/me', { token })).status).toBe(401);
    }
    const okList = await idp.signAccessToken({
      sub: 'x', groups: [ROLE_GROUPS.publisher], aud: [TEST_AUDIENCE, 'extra'],
    });
    expect((await app.request('GET', '/me', { token: okList })).status).toBe(200);

    const wrongSig = await idp.signWithForeignKey({ sub: 'x', groups: [ROLE_GROUPS.publisher] });
    expect((await app.request('GET', '/me', { token: wrongSig })).status).toBe(401);

    const now = Math.floor(Date.now() / 1000);
    const none = forgeCompactJwt(
      { alg: 'none', kid: idp.kid },
      { sub: 'x', iss: idp.issuer, aud: TEST_AUDIENCE, exp: now + 60, groups: [ROLE_GROUPS.publisher] },
    );
    expect((await app.request('GET', '/me', { token: none })).status).toBe(401);

    const hs = await signHs256WithModulus(idp.publicJwk(), {
      sub: 'x', iss: idp.issuer, aud: TEST_AUDIENCE, exp: now + 60, groups: [ROLE_GROUPS.publisher],
    });
    expect((await app.request('GET', '/me', { token: hs })).status).toBe(401);

    const idToken = await idp.signAccessToken({
      sub: 'x', groups: [ROLE_GROUPS.publisher], aud: TEST_CLIENT_ID,
    });
    expect((await app.request('GET', '/me', { token: idToken })).status).toBe(401);
  });
});

describe('M2-T14–T16 JWKS cache behaviour', () => {
  it('refetches at most once for an unknown kid inside the cooldown window', async () => {
    const before = idp.jwksHits();
    const unknown = await idp.signAccessToken({
      sub: 'x', groups: [ROLE_GROUPS.publisher], kid: 'missing-kid',
    });
    expect((await app.request('GET', '/me', { token: unknown })).status).toBe(401);
    const afterFirst = idp.jwksHits();
    expect(afterFirst).toBeGreaterThan(before);
    expect((await app.request('GET', '/me', { token: unknown })).status).toBe(401);
    expect(idp.jwksHits()).toBe(afterFirst);
  });

  it('keeps accepting cached keys after JWKS goes down', async () => {
    const token = await tokenFor('publisher');
    expect((await app.request('GET', '/me', { token })).status).toBe(200);
    idp.stopJwks();
    expect((await app.request('GET', '/me', { token })).status).toBe(200);
    const unknown = await idp.signAccessToken({
      sub: 'x', groups: [ROLE_GROUPS.publisher], kid: 'other-missing',
    });
    expect((await app.request('GET', '/me', { token: unknown })).status).toBe(401);
    expect((await app.request('GET', '/health/ready')).status).toBe(200);
  });

  it('returns 503 when JWKS is unreachable with an empty cache', async () => {
    app.verifier.configureForTest({
      jwksUri: 'http://127.0.0.1:9/jwks',
      issuer: idp.issuer,
      jwksCooldownMs: 200,
      jwksCacheMaxAgeMs: 60_000,
    });
    try {
      const token = await tokenFor('publisher');
      const response = await app.request('GET', '/me', { token });
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('dependency_unavailable');
      expect((await app.request('GET', '/health/ready')).status).toBe(200);
    } finally {
      app.verifier.configureForTest({ jwksCooldownMs: 200, jwksCacheMaxAgeMs: 60_000 });
    }
  });
});

describe('M2-T17 audit actor', () => {
  it('persists verified sub/roles and never email, group names or tokens', async () => {
    const token = await tokenFor('publisher');
    const created = await app.request('POST', '/admin/contents', {
      token, body: { ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] },
    });
    await app.request('POST', `/admin/contents/${created.body.id}/publish`, {
      token, body: { expectedVersion: 1 },
    });
    const audits = await query<{ actor_sub: string; actor_roles: string[] }>(
      'select actor_sub, actor_roles from content_audit where content_id = $1 order by occurred_at',
      [created.body.id],
    );
    expect(audits.every(row => row.actor_sub === 'publisher-sub')).toBe(true);
    expect(audits.every(row => row.actor_roles.includes('publisher'))).toBe(true);
    const blob = JSON.stringify(audits);
    expect(blob).not.toMatch(/@|poc-publisher|Bearer |eyJ/);
  });
});

describe('M2-T18 no forged identity in the normal build', () => {
  it('ignores x-test-actor and body-supplied actors; dist has no test assembly', async () => {
    const response = await app.request('POST', '/admin/contents', {
      token: null,
      headers: {
        'x-test-actor': Buffer.from(JSON.stringify({ sub: 'forged', roles: ['publisher'] }), 'utf8').toString('base64'),
      },
      body: {
        ...DEMO_CONTENT,
        tags: [...DEMO_CONTENT.tags],
        actor: { sub: 'body-actor', roles: ['publisher'] },
        permissions: ['content:write'],
      },
    });
    expect(response.status).toBe(401);

    const distRoot = join(fileURLToPath(new URL('../..', import.meta.url)), 'dist');
    const files: string[] = [];
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else files.push(path);
      }
    }
    await walk(distRoot);
    expect(files.some(path => path.includes('test-app') || path.includes('oidc-mock') || path.includes('identity-app'))).toBe(false);
    for (const path of files.filter(item => item.endsWith('.js'))) {
      const text = await readFile(path, 'utf8');
      expect(text).not.toContain('x-test-actor');
    }
  });
});

describe('M2-T19 groups edge cases', () => {
  it('identifies without granting rights for empty, unknown or non-list groups', async () => {
    const cases: Array<Parameters<OidcMock['signAccessToken']>[0]> = [
      { sub: 'edge', groups: null },
      { sub: 'edge', groups: [] },
      { sub: 'edge', groups: ['unknown-group'] },
      { sub: 'edge', groups: null, extra: { groups: 'poc-publisher' } },
      { sub: 'edge', groups: null, extra: { groups: { name: 'poc-publisher' } } },
    ];
    for (const claims of cases) {
      const manual = await idp.signAccessToken(claims);
      const me = await app.request('GET', '/me', { token: manual });
      expect(me.status).toBe(200);
      expect(me.body.permissions).toEqual([]);
      const write = await app.request('POST', '/admin/contents', {
        token: manual, body: { ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] },
      });
      expect(write.status).toBe(403);
    }
  });
});

describe('M2-T23 correlation and secret-free logs', () => {
  it('returns correlation IDs on identity failures', async () => {
    const response = await app.request('GET', '/me', {
      token: null,
      correlationId: 'm2-corr-0001',
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('x-correlation-id')).toBe('m2-corr-0001');
    expect(response.body.correlationId).toBe('m2-corr-0001');

    const bad = await app.request('GET', '/me', {
      authorization: 'Bearer not-a-jwt',
      correlationId: 'm2-corr-0002',
    });
    expect(bad.status).toBe(401);
    expect(bad.headers.get('x-correlation-id')).toBe('m2-corr-0002');
  });
});
