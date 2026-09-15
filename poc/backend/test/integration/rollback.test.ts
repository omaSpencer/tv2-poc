/**
 * T14, T15, T16 – no half-written state.
 *
 * The faults are injected by replacing a repository in the test assembly, not
 * by a switch that exists in the running application.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { context, createServices, query, testDatabaseUrl, truncateAll } from '../support/database.js';
import { normalizeCreateCommand, normalizeVersionedCommand } from '../../src/contracts/http.js';
import { ContentRepository } from '../../src/content/content.repository.js';
import { OutboxRepository } from '../../src/outbox/outbox.repository.js';
import type { Transaction } from '../../src/database.js';

const url = testDatabaseUrl();
const editor = context('editor-1', 'corr-rollback', ['editor']);
const publisher = context('publisher-1', 'corr-rollback', ['publisher']);

class AuditFailure extends ContentRepository {
  override async insertAudit(): Promise<never> {
    throw new Error('injected audit failure');
  }
}

class OutboxFailure extends OutboxRepository {
  override async append(): Promise<never> {
    throw new Error('injected outbox failure');
  }
}

/** Writes everything the real repository would, then fails before the commit. */
class FailAfterEveryWrite extends OutboxRepository {
  override async append(tx: Transaction, event: Parameters<OutboxRepository['append']>[1]) {
    await super.append(tx, event);
    throw new Error('injected pre-commit failure');
  }
}

const healthy = createServices(url);
const withAuditFailure = createServices(url, new AuditFailure());
const withOutboxFailure = createServices(url, new ContentRepository(), new OutboxFailure());
const withLateFailure = createServices(url, new ContentRepository(), new FailAfterEveryWrite());

const draft = (title: string) =>
  normalizeCreateCommand({ title, summary: 'Rövid leírás.', category: 'film', mediaAssetId: 'vod-demo-0001' });

const counts = async (id: string) => {
  const [row] = await query<{ contents: number; audits: number; events: number; version: number | null; status: string | null }>(
    `select (select count(*)::int from content where id = $1) as contents,
            (select count(*)::int from content_audit where content_id = $1) as audits,
            (select count(*)::int from outbox_event where aggregate_id = $1) as events,
            (select version from content where id = $1) as version,
            (select status from content where id = $1) as status`,
    [id], url,
  );
  return row;
};

beforeEach(() => truncateAll(url));
afterAll(async () => {
  for (const services of [healthy, withAuditFailure, withOutboxFailure, withLateFailure]) {
    await services.database.onApplicationShutdown();
  }
});

describe('T14 audit write fails after the content write', () => {
  it('leaves no content row behind on creation', async () => {
    await expect(withAuditFailure.service.create(draft('Audit hiba létrehozáskor'), editor)).rejects.toThrow();
    const rows = await query<{ count: number }>('select count(*)::int as count from content', [], url);
    expect(rows[0].count).toBe(0);
  });

  it('rolls the content back to its stored version on publish', async () => {
    const created = await healthy.service.create(draft('Audit hiba publikáláskor'), editor);
    await expect(
      withAuditFailure.service.publish(created.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher),
    ).rejects.toThrow();
    expect(await counts(created.id)).toMatchObject({ contents: 1, audits: 1, events: 0, version: 1, status: 'draft' });
  });
});

describe('T15 outbox write fails after content and audit', () => {
  it('preserves the previous state for publish and for withdraw', async () => {
    const created = await healthy.service.create(draft('Outbox hiba'), editor);
    await expect(
      withOutboxFailure.service.publish(created.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher),
    ).rejects.toThrow();
    expect(await counts(created.id)).toMatchObject({ contents: 1, audits: 1, events: 0, version: 1, status: 'draft' });

    const published = await healthy.service.publish(created.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher);
    await expect(
      withOutboxFailure.service.withdraw(created.id, normalizeVersionedCommand({ expectedVersion: published.version }), publisher),
    ).rejects.toThrow();
    expect(await counts(created.id)).toMatchObject({ contents: 1, audits: 2, events: 1, version: 2, status: 'published' });
  });
});

describe('T16 failure after every write but before commit', () => {
  it('shows none of the new version, audit or event from another connection', async () => {
    const created = await healthy.service.create(draft('Commit előtti hiba'), editor);
    await expect(
      withLateFailure.service.publish(created.id, normalizeVersionedCommand({ expectedVersion: 1 }), publisher),
    ).rejects.toThrow();
    expect(await counts(created.id)).toMatchObject({ contents: 1, audits: 1, events: 0, version: 1, status: 'draft' });
    const slugs = await query<{ slug: string | null }>('select slug from content where id = $1', [created.id], url);
    expect(slugs[0].slug).toBeNull();
  });
});
