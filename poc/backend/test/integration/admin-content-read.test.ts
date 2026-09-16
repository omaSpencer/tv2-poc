import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp, type TestApp } from '../support/test-app.js';
import { query, testDatabaseUrl, truncateAll } from '../support/database.js';

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
afterAll(async () => app.close());

const create = (title: string, category = 'film') => app.request('POST', '/admin/contents', {
  actor: EDITOR,
  body: { title, summary: `${title} összefoglaló`, category, mediaAssetId: `media-${title}`, tags: ['demo'] },
});

describe('admin content list read model', () => {
  it('enforces access and returns only the compact list shape', async () => {
    await create('Első tartalom');
    expect((await app.request('GET', '/admin/contents', { actor: null })).status).toBe(401);
    expect((await app.request('GET', '/admin/contents', { actor: VIEWER })).status).toBe(403);
    const response = await app.request('GET', '/admin/contents', { actor: EDITOR });
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['items', 'nextCursor']);
    expect(Object.keys(response.body.items[0]).sort()).toEqual([
      'category', 'id', 'publishedAt', 'slug', 'status', 'title', 'updatedAt', 'updatedBy', 'version',
    ]);
    expect(JSON.stringify(response.body)).not.toContain('media-Első');
    expect(JSON.stringify(response.body)).not.toContain('összefoglaló');
  });

  it('orders by updated_at and UUID descending without duplicates between cursor pages', async () => {
    const ids = [(await create('A')).body.id, (await create('B')).body.id, (await create('C')).body.id] as string[];
    await query('update content set updated_at = $1', ['2026-09-16T10:00:00.000Z'], url);
    const expected = [...ids].sort().reverse();
    const first = await app.request('GET', '/admin/contents?limit=2', { actor: EDITOR });
    const second = await app.request('GET', `/admin/contents?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`, { actor: EDITOR });
    expect([...first.body.items, ...second.body.items].map(item => item.id)).toEqual(expected);
    expect(second.body.nextCursor).toBeNull();
  });

  it('combines filters, treats UUID exactly and escapes SQL wildcards', async () => {
    const percent = await create('100% valódi', 'sport');
    await create('100 másik', 'film');
    const wildcard = await app.request('GET', '/admin/contents?q=%25&category=sport&status=draft', { actor: EDITOR });
    expect(wildcard.body.items.map(item => item.id)).toEqual([percent.body.id]);
    const exact = await app.request('GET', `/admin/contents?q=${percent.body.id}`, { actor: EDITOR });
    expect(exact.body.items.map(item => item.id)).toEqual([percent.body.id]);
  });

  it.each([
    '/admin/contents?unknown=1',
    '/admin/contents?q=a&q=b',
    '/admin/contents?limit=0',
    '/admin/contents?cursor=invalid%2Bcursor',
  ])('rejects malformed list query %s', async path => {
    const response = await app.request('GET', path, { actor: EDITOR });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('validation_failed');
  });
});

describe('content audit read model', () => {
  it('paginates newest-first, minimizes data and does not write audit or outbox rows', async () => {
    const created = await create('Auditált tartalom');
    const id = created.body.id as string;
    await app.request('PATCH', `/admin/contents/${id}`, { actor: EDITOR, body: { expectedVersion: 1, title: 'Auditált tartalom 2' } });
    await app.request('POST', `/admin/contents/${id}/publish`, { actor: PUBLISHER, body: { expectedVersion: 2 } });
    const beforeAudit = await query<{ count: string }>('select count(*) from content_audit where content_id = $1', [id], url);
    const beforeOutbox = await query<{ count: string }>('select count(*) from outbox_event where aggregate_id = $1', [id], url);

    const first = await app.request('GET', `/admin/contents/${id}/audit?limit=2`, { actor: EDITOR });
    const second = await app.request('GET', `/admin/contents/${id}/audit?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`, { actor: EDITOR });
    expect(first.body.items.map(item => item.contentVersion)).toEqual([3, 2]);
    expect(second.body.items.map(item => item.contentVersion)).toEqual([1]);
    expect(Object.keys(first.body.items[0]).sort()).toEqual([
      'action', 'actorRoles', 'actorSub', 'changedFields', 'contentVersion', 'correlationId', 'id', 'occurredAt',
    ]);
    expect(JSON.stringify(first.body)).not.toContain('media-Auditált');
    expect(await query<{ count: string }>('select count(*) from content_audit where content_id = $1', [id], url)).toEqual(beforeAudit);
    expect(await query<{ count: string }>('select count(*) from outbox_event where aggregate_id = $1', [id], url)).toEqual(beforeOutbox);
  });

  it('distinguishes missing content from invalid id/query', async () => {
    expect((await app.request('GET', `/admin/contents/${randomUUID()}/audit`, { actor: EDITOR })).status).toBe(404);
    expect((await app.request('GET', '/admin/contents/not-a-uuid/audit', { actor: EDITOR })).status).toBe(422);
    expect((await app.request('GET', `/admin/contents/${randomUUID()}/audit?q=nope`, { actor: EDITOR })).status).toBe(422);
  });
});
