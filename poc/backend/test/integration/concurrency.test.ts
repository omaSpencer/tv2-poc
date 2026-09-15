/**
 * T05, T11, T12, T13 – genuine overlap, not lucky timing. A gate connection
 * holds a conflicting lock until both writers are observed waiting on it.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  context, createServices, query, settledStatus, testDatabaseUrl, truncateAll, withLockGate,
} from '../support/database.js';
import { normalizeCreateCommand, normalizePatchCommand, normalizeVersionedCommand } from '../../src/contracts/http.js';
import { LIMITS } from '../../src/schema.js';
import { slugCandidates } from '../../src/content/slug.js';
import { NEGATIVE_CASES } from '../fixtures/demo.js';

const url = testDatabaseUrl();
const { database, service } = createServices(url);
const editor = context('editor-1', 'corr-concurrency', ['editor']);
const publisher = context('publisher-1', 'corr-concurrency', ['publisher']);

const publishable = (title: string, extra: Record<string, unknown> = {}) =>
  normalizeCreateCommand({ title, summary: 'Rövid leírás.', category: 'film', mediaAssetId: 'vod-demo-0001', ...extra });

const rowOf = (id: string) => query<any>('select * from content where id = $1', [id], url).then(rows => rows[0]);
const auditCount = (id: string) =>
  query<{ count: number }>('select count(*)::int as count from content_audit where content_id = $1', [id], url)
    .then(rows => rows[0].count);
const eventCount = (id: string) =>
  query<{ count: number }>('select count(*)::int as count from outbox_event where aggregate_id = $1', [id], url)
    .then(rows => rows[0].count);

beforeEach(() => truncateAll(url));
afterAll(() => database.onApplicationShutdown());

describe('T05 two writers on the same version', () => {
  it('lets exactly one through and answers version_conflict to the other', async () => {
    const created = await service.create(publishable('Párhuzamos szerkesztés'), editor);
    const results = await withLockGate(
      'select * from content where id = $1 for update', [created.id], 2,
      () => Promise.allSettled([
        service.patch(created.id, normalizePatchCommand({ expectedVersion: 1, title: 'A verzió' }), editor),
        service.patch(created.id, normalizePatchCommand({ expectedVersion: 1, title: 'B verzió' }), editor),
      ]),
      url,
    );
    expect(settledStatus(results)).toEqual({ ok: 1, codes: ['version_conflict'] });
    expect((await rowOf(created.id)).version).toBe(2);
    expect(await auditCount(created.id)).toBe(2);
  });
});

describe('T11 two concurrent publishes on one record', () => {
  it('produces one state change, one audit and one event', async () => {
    const created = await service.create(publishable('Párhuzamos publikálás'), editor);
    const results = await withLockGate(
      'select * from content where id = $1 for update', [created.id], 2,
      () => Promise.allSettled([
        service.publish(created.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher),
        service.publish(created.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher),
      ]),
      url,
    );
    expect(settledStatus(results)).toEqual({ ok: 1, codes: ['version_conflict'] });
    const row = await rowOf(created.id);
    expect(row.status).toBe('published');
    expect(row.version).toBe(2);
    expect(await auditCount(created.id)).toBe(2);
    expect(await eventCount(created.id)).toBe(1);
  });
});

describe('T12 slug race between two different contents', () => {
  it('gives both a distinct slug with a complete audit and event', async () => {
    const title = 'Azonos Cím – Őszi Kiadás';
    const first = await service.create(publishable(title), editor);
    const second = await service.create(publishable(title), editor);
    const results = await withLockGate(
      'lock table content in exclusive mode', [], 2,
      () => Promise.allSettled([
        service.publish(first.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher),
        service.publish(second.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher),
      ]),
      url,
    );
    expect(settledStatus(results)).toEqual({ ok: 2, codes: [] });
    const slugs = (await query<any>('select slug from content order by slug', [], url)).map(row => row.slug);
    expect(new Set(slugs).size).toBe(2);
    const [base] = slugCandidates(title);
    expect(slugs).toContain(base);
    expect(slugs).toContain(`${base}-2`);
    for (const id of [first.id, second.id]) {
      expect(await auditCount(id)).toBe(2);
      expect(await eventCount(id)).toBe(1);
    }
  });
});

describe('T13 slug limits', () => {
  it('rejects a manual slug already taken', async () => {
    const first = await service.create(publishable('Első', { slug: 'foglalt-slug' }), editor);
    await expect(service.create(publishable('Második', { slug: 'foglalt-slug' }), editor))
      .rejects.toMatchObject({ code: 'slug_conflict' });
    const patched = await service.create(publishable('Harmadik'), editor);
    await expect(service.patch(patched.id, normalizePatchCommand({ expectedVersion: 1, slug: 'foglalt-slug' }), editor))
      .rejects.toMatchObject({ code: 'slug_conflict' });
    expect((await rowOf(patched.id)).version).toBe(1);
    expect(first.slug).toBe('foglalt-slug');
  });

  it('keeps a suffixed slug inside the length limit', async () => {
    const title = 'Hosszú Címsor Amely Pontosan Nyolcvan Karakteres Sluggá Alakul Át A Publikáláskor Is';
    const [base] = slugCandidates(title);
    expect(base.length).toBe(LIMITS.slug);
    const first = await service.create(publishable(title), editor);
    const second = await service.create(publishable(title), editor);
    await service.publish(first.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher);
    const published = await service.publish(second.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher);
    expect(published.slug!.length).toBeLessThanOrEqual(LIMITS.slug);
    expect(published.slug).toBe(`${base.slice(0, LIMITS.slug - 2)}-2`);
  });

  it('asks for a manual slug when the title transliterates to nothing', async () => {
    const created = await service.create(publishable(NEGATIVE_CASES.unslugifiableTitle), editor);
    await expect(service.publish(created.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher))
      .rejects.toMatchObject({ code: 'validation_failed', extras: { fields: ['slug'] } });
    expect((await rowOf(created.id)).status).toBe('draft');

    const named = await service.patch(created.id, normalizePatchCommand({ expectedVersion: 1, slug: 'kezi-slug' }), editor);
    const published = await service.publish(created.id, normalizeVersionedCommand({ expectedVersion: named.version }), publisher);
    expect(published.slug).toBe('kezi-slug');
  });

  it('reports slug_conflict once all fifty candidates are taken', async () => {
    const title = 'Tizenkettő Egy Tucat';
    const candidates = slugCandidates(title);
    expect(candidates).toHaveLength(LIMITS.slugCandidates);
    for (const slug of candidates) {
      const row = await service.create(publishable(title, { slug }), editor);
      await service.publish(row.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher);
    }
    const overflow = await service.create(publishable(title), editor);
    await expect(service.publish(overflow.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher))
      .rejects.toMatchObject({ code: 'slug_conflict' });
    const row = await rowOf(overflow.id);
    expect(row.status).toBe('draft');
    expect(row.version).toBe(1);
    expect(await auditCount(overflow.id)).toBe(1);
    expect(await eventCount(overflow.id)).toBe(0);
  });
});
