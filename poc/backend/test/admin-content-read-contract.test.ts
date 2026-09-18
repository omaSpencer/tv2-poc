import { describe, expect, it, vi } from 'vitest';
import {
  parseAdminContentListQuery,
  parseContentAuditQuery,
  toAdminContentListView,
  toContentAuditListView,
} from '../src/contracts/admin-content-list.js';
import type { ContentAuditRow } from '../src/schema.js';
import { ContentRepository } from '../src/content/content.repository.js';

function problemFields(work: () => unknown): string[] | undefined {
  try {
    work();
    return undefined;
  } catch (error) {
    return (error as { extras?: { fields?: string[] } }).extras?.fields;
  }
}

describe('admin content list contract', () => {
  it('normalizes defaults and the complete filter set', () => {
    expect(parseAdminContentListQuery(new URLSearchParams())).toEqual({
      q: null, status: null, category: null, limit: 20, cursor: null,
    });
    expect(parseAdminContentListQuery(new URLSearchParams(
      'q=%20T%C3%A9li%20%C5%90rs%C3%A9g%20&status=draft&category=film&limit=100',
    ))).toMatchObject({ q: 'Téli Őrség', status: 'draft', category: 'film', limit: 100 });
  });

  it.each([
    ['unknown=1', ['unknown']],
    ['q=a&q=b', ['q']],
    ['q=%20', ['q']],
    ['status=deleted', ['status']],
    ['category=documentary', ['category']],
    ['limit=0', ['limit']],
    ['limit=1.5', ['limit']],
    ['cursor=not%2Bbase64', ['cursor']],
  ])('rejects invalid query %s', (query, fields) => {
    expect(problemFields(() => parseAdminContentListQuery(new URLSearchParams(query)))).toEqual(fields);
  });

  it('round-trips an opaque versioned list cursor', () => {
    const rows = [
      { id: '00000000-0000-4000-8000-000000000002', title: 'B', slug: null, category: null, status: 'draft', version: 1, updatedAt: new Date('2026-09-16T10:00:00.000Z'), updatedBy: 'editor', publishedAt: null },
      { id: '00000000-0000-4000-8000-000000000001', title: 'A', slug: null, category: null, status: 'draft', version: 1, updatedAt: new Date('2026-09-16T09:00:00.000Z'), updatedBy: 'editor', publishedAt: null },
    ];
    const view = toAdminContentListView(rows, 1);
    expect(view.items).toHaveLength(1);
    expect(parseAdminContentListQuery(new URLSearchParams({ cursor: view.nextCursor! })).cursor).toEqual({
      v: 1,
      updatedAt: '2026-09-16T10:00:00.000Z',
      id: rows[0].id,
    });
  });
});

describe('content audit contract', () => {
  it('uses newest-first cursor shape and emits only the documented metadata', () => {
    const row = {
      id: '00000000-0000-4000-8000-000000000010',
      contentId: '00000000-0000-4000-8000-000000000020',
      contentVersion: 6,
      action: 'published',
      actorSub: 'publisher-1',
      actorRoles: ['publisher', 'unexpected'],
      occurredAt: new Date('2026-09-16T10:00:00.000Z'),
      correlationId: 'correlation-6',
      changedFields: ['status', 'not-a-field'],
    } as ContentAuditRow;
    const older = { ...row, id: '00000000-0000-4000-8000-000000000011', contentVersion: 5 };
    const view = toContentAuditListView([row, older], 1);
    expect(view.items[0]).toEqual({
      id: row.id,
      contentVersion: 6,
      action: 'published',
      actorSub: 'publisher-1',
      actorRoles: ['publisher'],
      occurredAt: '2026-09-16T10:00:00.000Z',
      correlationId: 'correlation-6',
      changedFields: ['status'],
    });
    expect(Object.keys(view.items[0]!).sort()).toEqual([
      'action', 'actorRoles', 'actorSub', 'changedFields', 'contentVersion',
      'correlationId', 'id', 'occurredAt',
    ]);
    expect(parseContentAuditQuery(new URLSearchParams({ cursor: view.nextCursor! })).cursor)
      .toEqual({ v: 1, contentVersion: 6 });
  });

  it.each([
    ['limit=101', ['limit']],
    ['cursor=e30', ['cursor']],
    ['cursor=a&cursor=b', ['cursor']],
    ['q=forbidden', ['q']],
  ])('rejects invalid audit query %s', (query, fields) => {
    expect(problemFields(() => parseContentAuditQuery(new URLSearchParams(query)))).toEqual(fields);
  });

  it('fails closed when persisted audit data contains an unknown action', () => {
    const row = {
      id: '00000000-0000-4000-8000-000000000010',
      contentId: '00000000-0000-4000-8000-000000000020',
      contentVersion: 1,
      action: 'silently-rewritten',
      actorSub: 'publisher-1',
      actorRoles: ['publisher'],
      occurredAt: new Date('2026-09-16T10:00:00.000Z'),
      correlationId: 'correlation-1',
      changedFields: ['title'],
    } as unknown as ContentAuditRow;
    expect(() => toContentAuditListView([row], 1)).toThrow('Unknown content audit action.');
  });

  it('always applies the requested bounded audit page size', async () => {
    const limit = vi.fn(async () => []);
    const executor = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit }),
          }),
        }),
      }),
    };
    await new ContentRepository().listAudit(executor as never, '00000000-0000-4000-8000-000000000020', {
      limit: 50,
      cursor: null,
    });
    expect(limit).toHaveBeenCalledWith(51);
  });
});
