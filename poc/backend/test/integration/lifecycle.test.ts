/**
 * T02–T04, T06–T10, T17, T22 – the content lifecycle against real PostgreSQL.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  context, createServices, query, testDatabaseUrl, truncateAll,
} from '../support/database.js';
import {
  normalizeCreateCommand, normalizePatchCommand, normalizeVersionedCommand,
} from '../../src/contracts/http.js';
import { contentEventV1Schema } from '../../src/contracts/events.js';
import { ApiError } from '../../src/contracts/errors.js';
import { DEMO_CONTENT, DEMO_EDIT, DEMO_SLUG, NEGATIVE_CASES } from '../fixtures/demo.js';

const url = testDatabaseUrl();
const { database, service } = createServices(url);
const editor = context('editor-1', 'corr-lifecycle', ['editor']);
const publisher = context('publisher-1', 'corr-lifecycle', ['publisher']);

const audits = (id: string) =>
  query<any>('select * from content_audit where content_id = $1 order by content_version', [id], url);
const events = (id: string) =>
  query<any>('select * from outbox_event where aggregate_id = $1 order by aggregate_version', [id], url);

const createDemoDraft = () => service.create(normalizeCreateCommand({ ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] }), editor);

async function expectApiError(work: Promise<unknown>, code: string) {
  await expect(work).rejects.toMatchObject({ code });
}

beforeEach(() => truncateAll(url));
afterAll(() => database.onApplicationShutdown());

describe('T02 draft creation', () => {
  it('stores version 1, one created audit and no event', async () => {
    const row = await service.create(normalizeCreateCommand({ title: 'Csak cím' }), editor);
    expect(row.version).toBe(1);
    expect(row.status).toBe('draft');
    expect(row.slug).toBeNull();
    expect(row.tags).toEqual([]);

    const trail = await audits(row.id);
    expect(trail).toHaveLength(1);
    expect(trail[0].action).toBe('created');
    expect(trail[0].changed_fields).toEqual(['title', 'status']);
    expect(trail[0].actor_sub).toBe('editor-1');
    expect(await events(row.id)).toHaveLength(0);
    await expectApiError(service.findPublished(row.id), 'content_not_found');
  });

  it('lists every provided business field in the creation audit', async () => {
    const row = await createDemoDraft();
    const trail = await audits(row.id);
    expect(trail[0].changed_fields).toEqual(['title', 'summary', 'category', 'mediaAssetId', 'tags', 'status']);
  });
});

describe('T03 edit and no-op', () => {
  it('increments once and leaves a no-op completely unchanged', async () => {
    const created = await createDemoDraft();
    const updated = await service.patch(
      created.id,
      normalizePatchCommand({ expectedVersion: 1, summary: DEMO_EDIT.summary, tags: [...DEMO_EDIT.tags] }),
      editor,
    );
    expect(updated.version).toBe(2);
    expect(updated.summary).toBe(DEMO_EDIT.summary);

    const repeated = await service.patch(
      updated.id,
      normalizePatchCommand({ expectedVersion: 2, summary: DEMO_EDIT.summary, tags: [...DEMO_EDIT.tags] }),
      context('other-editor', 'corr-lifecycle', ['editor']),
    );
    expect(repeated.version).toBe(2);
    expect(repeated.updatedAt.toISOString()).toBe(updated.updatedAt.toISOString());
    expect(repeated.updatedBy).toBe('editor-1');

    const trail = await audits(created.id);
    expect(trail).toHaveLength(2);
    expect(trail[1].action).toBe('updated');
    expect(trail[1].changed_fields).toEqual(['summary', 'tags']);
  });

  it('treats an expectedVersion-only patch as a no-op', async () => {
    const created = await createDemoDraft();
    const result = await service.patch(created.id, normalizePatchCommand({ expectedVersion: 1 }), editor);
    expect(result.version).toBe(1);
    expect(await audits(created.id)).toHaveLength(1);
  });
});

describe('T04 field semantics', () => {
  it('separates omitted, null, empty string and empty list', async () => {
    const created = await service.create(
      normalizeCreateCommand({ title: 'Mezők', summary: 'Eredeti', mediaAssetId: 'VOD-Case-1', tags: [' Alma ', 'alma', ''] }),
      editor,
    );
    expect(created.mediaAssetId).toBe('VOD-Case-1');
    expect(created.tags).toEqual(['alma']);

    const cleared = await service.patch(
      created.id, normalizePatchCommand({ expectedVersion: 1, summary: '   ', mediaAssetId: '', tags: [] }), editor,
    );
    expect(cleared.summary).toBeNull();
    expect(cleared.mediaAssetId).toBeNull();
    expect(cleared.tags).toEqual([]);

    const untouched = await service.patch(cleared.id, normalizePatchCommand({ expectedVersion: 2, title: 'Mezők' }), editor);
    expect(untouched.version).toBe(2);
  });

  it('rejects unknown, server-owned and malformed fields', () => {
    expect(() => normalizeCreateCommand({ title: 'X', status: 'published' })).toThrow(ApiError);
    expect(() => normalizeCreateCommand({ title: 'X', version: 4 })).toThrow(ApiError);
    expect(() => normalizeCreateCommand({ title: 'X', unknown: true })).toThrow(ApiError);
    expect(() => normalizeCreateCommand({ title: NEGATIVE_CASES.tooLongTitle })).toThrow(ApiError);
    expect(() => normalizeCreateCommand({ title: 'X', tags: null })).toThrow(ApiError);
    expect(() => normalizeCreateCommand({ title: 'X', category: 'dokumentum' })).toThrow(ApiError);
    expect(() => normalizeCreateCommand({ title: 'X', slug: 'Nem Jó Slug' })).toThrow(ApiError);
    expect(() => normalizePatchCommand({ expectedVersion: 0 })).toThrow(ApiError);
    expect(() => normalizePatchCommand({ expectedVersion: 1.5 })).toThrow(ApiError);
    expect(() => normalizePatchCommand({ title: null, expectedVersion: 1 })).toThrow(ApiError);
    try {
      normalizeCreateCommand({ title: 'X', status: 'published', unknown: 1 });
    } catch (error) {
      expect((error as ApiError).extras.fields).toEqual(['status', 'unknown']);
    }
  });
});

describe('T06 stale version beats a no-op', () => {
  it('answers version_conflict without writing', async () => {
    const created = await createDemoDraft();
    await service.patch(created.id, normalizePatchCommand({ expectedVersion: 1, title: 'Új cím' }), editor);
    await expect(
      service.patch(created.id, normalizePatchCommand({ expectedVersion: 1, title: 'Új cím' }), editor),
    ).rejects.toMatchObject({ code: 'version_conflict', extras: { expectedVersion: 1, actualVersion: 2 } });
    expect(await audits(created.id)).toHaveLength(2);
  });
});

describe('T07 publish minimum', () => {
  it('fails with 422 and changes nothing', async () => {
    const created = await service.create(normalizeCreateCommand(NEGATIVE_CASES.missingMediaAsset), editor);
    await expect(service.publish(created.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher))
      .rejects.toMatchObject({ code: 'validation_failed', extras: { fields: ['mediaAssetId'] } });
    const rows = await query<any>('select * from content where id = $1', [created.id], url);
    expect(rows[0].version).toBe(1);
    expect(rows[0].status).toBe('draft');
    expect(await audits(created.id)).toHaveLength(1);
    expect(await events(created.id)).toHaveLength(0);
  });
});

describe('T08/T09 publish, withdraw, edit and republish', () => {
  it('walks the full lifecycle with one audit and one event per state change', async () => {
    const created = await createDemoDraft();
    const published = await service.publish(created.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher);
    expect(published.status).toBe('published');
    expect(published.version).toBe(2);
    expect(published.slug).toBe(DEMO_SLUG);
    expect(published.publishedAt).not.toBeNull();

    const publicView = await service.findPublished(created.id);
    expect(publicView.id).toBe(created.id);

    const withdrawn = await service.withdraw(created.id, normalizeVersionedCommand({ expectedVersion: 2 }), publisher);
    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.slug).toBe(DEMO_SLUG);
    expect(withdrawn.withdrawnAt).not.toBeNull();
    expect(withdrawn.publishedAt).not.toBeNull();
    await expect(service.findPublished(created.id)).rejects.toMatchObject({ code: 'content_not_found' });

    const edited = await service.patch(created.id, normalizePatchCommand({ expectedVersion: 3, title: 'Vadon élő Magyarország – Téli Őrség' }), editor);
    expect(edited.version).toBe(4);

    const republished = await service.publish(created.id, normalizeVersionedCommand({ expectedVersion: 4 }), publisher);
    expect(republished.version).toBe(5);
    // A title change does not move an existing slug.
    expect(republished.slug).toBe(DEMO_SLUG);

    const trail = await audits(created.id);
    expect(trail.map(entry => entry.action)).toEqual(['created', 'published', 'withdrawn', 'updated', 'published']);
    expect(trail[1].changed_fields).toEqual(['slug', 'status']);
    expect(trail[3].changed_fields).toEqual(['title']);
    expect(trail[4].changed_fields).toEqual(['status']);

    const outbox = await events(created.id);
    expect(outbox.map(entry => entry.event_type)).toEqual(['content.published', 'content.withdrawn', 'content.published']);
    expect(new Set(outbox.map(entry => entry.event_id)).size).toBe(3);
    expect(outbox.every(entry => entry.delivered_at === null)).toBe(true);
  });
});

describe('T10 state errors', () => {
  it('refuses the operations the state does not allow', async () => {
    const created = await createDemoDraft();
    await expectApiError(service.withdraw(created.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher), 'content_not_published');
    const published = await service.publish(created.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher);
    await expectApiError(service.publish(created.id, normalizeVersionedCommand({ expectedVersion: 2 }), publisher), 'content_already_published');
    await expectApiError(
      service.patch(created.id, normalizePatchCommand({ expectedVersion: 2, title: published.title }), editor),
      'content_not_editable',
    );
    expect((await audits(created.id))).toHaveLength(2);
    expect((await events(created.id))).toHaveLength(1);
  });
});

describe('T17/T22 event contract and pending outbox', () => {
  it('produces a valid v1 envelope that matches the content and stays pending', async () => {
    const created = await createDemoDraft();
    const published = await service.publish(created.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher);
    const [stored] = await events(created.id);
    const envelope = {
      eventId: stored.event_id,
      schemaVersion: stored.schema_version,
      eventType: stored.event_type,
      aggregateId: stored.aggregate_id,
      aggregateVersion: stored.aggregate_version,
      occurredAt: new Date(stored.occurred_at).toISOString(),
      correlationId: stored.correlation_id,
      payload: stored.payload,
    };
    expect(contentEventV1Schema.safeParse(envelope).success).toBe(true);
    expect(envelope.aggregateVersion).toBe(published.version);
    expect(envelope.correlationId).toBe('corr-lifecycle');
    expect(new Date(stored.occurred_at).getTime()).toBe(published.updatedAt.getTime());
    expect(JSON.stringify(stored.payload)).not.toMatch(/vod-demo|editor-1|publisher-1/);

    const pending = await createServices(url).outbox.pendingStats(database.db);
    expect(pending.pending).toBe(1);
  });
});
