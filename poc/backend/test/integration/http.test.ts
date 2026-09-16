/**
 * T18, T21, T23 – the HTTP adapter with a controlled test identity. This is not
 * OIDC evidence: M2 proves the same matrix with a real Authentik token.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp, type TestApp } from '../support/test-app.js';
import { query, testDatabaseUrl, truncateAll } from '../support/database.js';
import { ROUTE_MATRIX, ROLE_PERMISSIONS } from '../../src/contracts/permissions.js';
import { DEMO_CONTENT, DEMO_SLUG, NEGATIVE_CASES } from '../fixtures/demo.js';

const url = testDatabaseUrl();
const PUBLISHER = { sub: 'publisher-1', roles: ['publisher'] };
const EDITOR = { sub: 'editor-1', roles: ['editor'] };
const VIEWER = { sub: 'viewer-1', roles: ['viewer'] };

let app: TestApp;

beforeAll(async () => {
  process.env.DATABASE_URL = url;
  app = await createTestApp(PUBLISHER);
});
beforeEach(() => truncateAll(url));
afterAll(async () => { await app.close(); });

const createDemo = () => app.request('POST', '/admin/contents', { body: { ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] } });

describe('T21 admin adapter', () => {
  it('serialises the admin view and maps status codes', async () => {
    const created = await createDemo();
    expect(created.status).toBe(201);
    expect(created.body.version).toBe(1);
    expect(created.body.status).toBe('draft');
    expect(created.body.mediaAssetId).toBe(DEMO_CONTENT.mediaAssetId);
    expect(Object.keys(created.body).sort()).toEqual([
      'category', 'createdAt', 'createdBy', 'id', 'mediaAssetId', 'publishedAt', 'slug',
      'status', 'summary', 'tags', 'title', 'updatedAt', 'updatedBy', 'version', 'withdrawnAt',
    ]);

    const published = await app.request('POST', `/admin/contents/${created.body.id}/publish`, { body: { expectedVersion: 1 } });
    expect(published.status).toBe(200);
    expect(published.body.slug).toBe(DEMO_SLUG);

    const conflict = await app.request('POST', `/admin/contents/${created.body.id}/publish`, { body: { expectedVersion: 2 } });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('content_already_published');
    expect(conflict.headers.get('content-type')).toContain('application/problem+json');

    const stale = await app.request('PATCH', `/admin/contents/${created.body.id}`, { body: { expectedVersion: 1, title: 'X' } });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'version_conflict', expectedVersion: 1, actualVersion: 2 });
  });

  it('enforces the documented permission per route', async () => {
    const created = await createDemo();
    const editorPublish = await app.request('POST', `/admin/contents/${created.body.id}/publish`, {
      body: { expectedVersion: 1 }, actor: EDITOR,
    });
    expect(editorPublish.status).toBe(403);
    expect(editorPublish.body.code).toBe('forbidden');

    const viewerRead = await app.request('GET', `/admin/contents/${created.body.id}`, { actor: VIEWER });
    expect(viewerRead.status).toBe(403);

    const anonymous = await app.request('GET', `/admin/contents/${created.body.id}`, { actor: null });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe('unauthenticated');

    const editorWrite = await app.request('PATCH', `/admin/contents/${created.body.id}`, {
      body: { expectedVersion: 1, summary: 'Szerkesztő által írva.' }, actor: EDITOR,
    });
    expect(editorWrite.status).toBe(200);
    expect(ROLE_PERMISSIONS.editor).not.toContain('content:publish');
  });

  it('keeps the route matrix and the registered routes aligned', () => {
    const declared = ROUTE_MATRIX.filter(rule => rule.milestone === 'M1').map(rule => `${rule.method} ${rule.path}`);
    expect(declared.sort()).toEqual([
      'GET /admin/contents/:id', 'GET /catalog/contents/:id', 'PATCH /admin/contents/:id',
      'POST /admin/contents', 'POST /admin/contents/:id/publish', 'POST /admin/contents/:id/withdraw',
    ]);
  });
});

describe('T18 public detail', () => {
  it('follows the current publication state and exposes only public fields', async () => {
    const created = await createDemo();
    const id = created.body.id as string;
    expect((await app.request('GET', `/catalog/contents/${id}`)).status).toBe(404);

    await app.request('POST', `/admin/contents/${id}/publish`, { body: { expectedVersion: 1 } });
    const published = await app.request('GET', `/catalog/contents/${id}`);
    expect(published.status).toBe(200);
    expect(Object.keys(published.body).sort()).toEqual(['category', 'id', 'publishedAt', 'slug', 'summary', 'tags', 'title']);
    expect(JSON.stringify(published.body)).not.toContain(DEMO_CONTENT.mediaAssetId);
    expect(JSON.stringify(published.body)).not.toContain('publisher-1');

    await app.request('POST', `/admin/contents/${id}/withdraw`, { body: { expectedVersion: 2 } });
    expect((await app.request('GET', `/catalog/contents/${id}`)).status).toBe(404);
    expect((await app.request('GET', `/catalog/contents/${randomUUID()}`)).status).toBe(404);
  });
});

describe('T23 consistent request errors', () => {
  it('returns 413 for an oversized JSON body without echoing its contents', async () => {
    const response = await app.request('POST', '/admin/contents', {
      body: { title: 'x'.repeat(256 * 1024) }, correlationId: 'audit-body-limit',
    });
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(response.body).toMatchObject({ code: 'payload_too_large', correlationId: 'audit-body-limit' });
    expect(JSON.stringify(response.body).length).toBeLessThan(1024);
    expect(response.body.fields).toBeUndefined();
  });

  it('answers 404, 422, 400 and 422 without leaking internals', async () => {
    const missing = await app.request('GET', `/admin/contents/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('content_not_found');

    const malformedId = await app.request('GET', '/admin/contents/not-a-uuid');
    expect(malformedId.status).toBe(422);
    expect(malformedId.body.fields).toEqual(['id']);

    const invalidJson = await app.request('POST', '/admin/contents', { body: '{"title": ' });
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.body.code).toBe('invalid_json');

    const created = await createDemo();
    const badVersion = await app.request('PATCH', `/admin/contents/${created.body.id}`, { body: { expectedVersion: 'kettő' } });
    expect(badVersion.status).toBe(422);
    expect(badVersion.body.fields).toEqual(['expectedVersion']);

    const tooLong = await app.request('POST', '/admin/contents', { body: { title: NEGATIVE_CASES.tooLongTitle } });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.fields).toEqual(['title']);

    for (const response of [missing, malformedId, invalidJson, badVersion, tooLong]) {
      expect(response.body.correlationId).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
      expect(JSON.stringify(response.body)).not.toMatch(/select |insert |postgres|password/i);
    }
  });

  it('carries a valid correlation id through and replaces a malformed one', async () => {
    const good = await app.request('GET', `/admin/contents/${randomUUID()}`, { correlationId: 'demo.run-01' });
    expect(good.headers.get('x-correlation-id')).toBe('demo.run-01');
    expect(good.body.correlationId).toBe('demo.run-01');

    const created = await createDemo();
    await app.request('POST', `/admin/contents/${created.body.id}/publish`, { body: { expectedVersion: 1 }, correlationId: 'demo.run-01' });
    const rows = await query<{ correlation_id: string }>(
      'select correlation_id from outbox_event where aggregate_id = $1', [created.body.id], url,
    );
    expect(rows[0].correlation_id).toBe('demo.run-01');
  });
});
