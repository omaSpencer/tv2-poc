/**
 * T01 plus the direct database guarantees: the API validator is not the only
 * thing standing between a bad value and storage.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { query, testDatabaseUrl, truncateAll } from '../support/database.js';

const url = testDatabaseUrl();

const draft = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(), slug: null, title: 'Alap cím', summary: null, category: null,
  media_asset_id: null, tags: [], status: 'draft', version: 1,
  created_at: new Date(), updated_at: new Date(), published_at: null, withdrawn_at: null,
  created_by: 'tester', updated_by: 'tester', ...overrides,
});

async function insertContent(row: Record<string, unknown>) {
  const keys = Object.keys(row);
  const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');
  return query(`insert into content (${keys.join(', ')}) values (${placeholders})`, Object.values(row), url);
}

describe('T01 migration and database constraints', () => {
  beforeAll(() => truncateAll(url));
  beforeEach(() => truncateAll(url));

  it('created the content and recovery tables with their uniqueness rules', async () => {
    const tables = await query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public' order by table_name", [], url,
    );
    expect(tables.map(row => row.table_name)).toEqual([
      'content', 'content_audit', 'operator_action', 'outbox_event', 'search_index_control',
    ]);

    const constraints = await query<{ conname: string }>(
      "select conname from pg_constraint where connamespace='public'::regnamespace order by conname", [], url,
    );
    const names = constraints.map(row => row.conname);
    for (const expected of [
      'content_slug_unique', 'content_published_minimum', 'content_audit_content_version_unique',
      'operator_action_kind_allowed', 'operator_action_state_allowed',
      'outbox_event_aggregate_version_unique', 'outbox_event_payload_pair',
    ]) {
      expect(names).toContain(expected);
    }
    const indexes = await query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname='public' and indexname in ('outbox_event_pending_idx', 'operator_action_one_active_reindex_idx') order by indexname", [], url,
    );
    expect(indexes.map(row => row.indexname)).toEqual([
      'operator_action_one_active_reindex_idx', 'outbox_event_pending_idx',
    ]);
  });

  it('recorded all seven migrations once and did not apply them twice', async () => {
    const applied = await query<{ count: number }>('select count(*)::int as count from drizzle.__drizzle_migrations', [], url);
    expect(applied[0].count).toBe(7);
  });

  it('D1 installs pg_trgm and both admin substring indexes', async () => {
    const extension = await query<{ present: boolean }>(
      `select exists(select 1 from pg_extension where extname = 'pg_trgm') as present`,
      [],
      url,
    );
    expect(extension[0]?.present).toBe(true);
    const indexes = await query<{ indexname: string; indexdef: string }>(`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname in ('content_admin_title_trgm_idx', 'content_admin_slug_trgm_idx')
      order by indexname
    `, [], url);
    expect(indexes.map(row => row.indexname)).toEqual([
      'content_admin_slug_trgm_idx',
      'content_admin_title_trgm_idx',
    ]);
    for (const row of indexes) {
      expect(row.indexdef).toContain('USING gin');
      expect(row.indexdef).toContain('gin_trgm_ops');
    }
  });

  it('rejects a disallowed status or category', async () => {
    await expect(insertContent(draft({ status: 'archived' }))).rejects.toThrow(/content_status_allowed/);
    await expect(insertContent(draft({ category: 'dokumentum' }))).rejects.toThrow(/content_category_allowed/);
  });

  it('rejects a duplicate non-null slug but allows many null slugs', async () => {
    await insertContent(draft({ slug: 'kozos-slug' }));
    await expect(insertContent(draft({ slug: 'kozos-slug' }))).rejects.toThrow(/content_slug_unique/);
    await insertContent(draft());
    await insertContent(draft());
    const rows = await query<{ count: number }>("select count(*)::int as count from content where slug is null", [], url);
    expect(rows[0].count).toBe(2);
  });

  it('rejects a non-positive version and a published row without its minimum', async () => {
    await expect(insertContent(draft({ version: 0 }))).rejects.toThrow(/content_version_positive/);
    await expect(insertContent(draft({ status: 'published', published_at: new Date() })))
      .rejects.toThrow(/content_published_minimum/);
  });

  it('rejects an event whose payload status contradicts its type', async () => {
    const content = draft({
      slug: 'esemeny-parositas', summary: 'Rövid leírás', category: 'film',
      media_asset_id: 'vod-1', status: 'published', published_at: new Date(), version: 2,
    });
    await insertContent(content);
    await expect(query(
      `insert into outbox_event (event_id, schema_version, event_type, aggregate_id, aggregate_version, occurred_at, correlation_id, payload)
       values ($1, 1, 'content.published', $2, 2, now(), 'corr-1', '{"status":"withdrawn"}'::jsonb)`,
      [randomUUID(), content.id], url,
    )).rejects.toThrow(/outbox_event_payload_pair/);
  });
});
