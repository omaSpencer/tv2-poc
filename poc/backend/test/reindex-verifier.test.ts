import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { ReindexVerifier } from '../src/search/reindex/verifier.js';
import type { MeiliIndexAdapter } from '../src/search/meili.adapter.js';

const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
];

describe('bounded reindex verifier', () => {
  it('reports exact counts with capped samples while keeping one keyset page resident', async () => {
    let keysetPage = 0;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('order by id')) {
        keysetPage += 1;
        if (keysetPage === 1) return { rows: [{ id: ids[0], version: 1 }, { id: ids[1], version: 2 }] };
        if (keysetPage === 2) return { rows: [{ id: ids[2], version: 3 }] };
        return { rows: [] };
      }
      if (sql.includes('id = any')) return { rows: [{ id: ids[0] }, { id: ids[1] }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const adapter = {
      indexUid: 'contents',
      projectionsByIds: vi.fn(async (_uid: string, pageIds: string[]) => pageIds.flatMap(id => {
        if (id === ids[2]) return [];
        return [{ id, aggregateVersion: id === ids[1] ? 99 : 1 }];
      })),
      documentCount: vi.fn(async () => 3),
      projectionPage: vi.fn(async () => [
        { id: ids[0], aggregateVersion: 1 },
        { id: ids[1], aggregateVersion: 99 },
        { id: '00000000-0000-4000-8000-000000000099', aggregateVersion: 1 },
      ]),
    } as unknown as MeiliIndexAdapter;

    const result = await new ReindexVerifier(2).verify({ query } as unknown as PoolClient, adapter);
    expect(result).toMatchObject({
      matches: false,
      expected: 3,
      actual: 3,
      missingCount: 1,
      extraCount: 1,
      versionMismatchCount: 1,
      missing: [ids[2]],
      extra: ['00000000-0000-4000-8000-000000000099'],
      versionMismatch: [ids[1]],
      diagnosticsTruncated: false,
      maxBatchDocuments: 3,
    });
    expect(adapter.projectionsByIds).toHaveBeenCalledTimes(2);
  });

  it('caps diagnostics without weakening exact mismatch counts', async () => {
    const expected = Array.from({ length: 25 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      version: 1,
    }));
    let read = false;
    const client = {
      query: vi.fn(async () => {
        if (read) return { rows: [] };
        read = true;
        return { rows: expected };
      }),
    } as unknown as PoolClient;
    const adapter = {
      indexUid: 'contents',
      projectionsByIds: vi.fn(async () => []),
      documentCount: vi.fn(async () => 0),
    } as unknown as MeiliIndexAdapter;

    const result = await new ReindexVerifier(50).verify(client, adapter);
    expect(result.missingCount).toBe(25);
    expect(result.missing).toHaveLength(20);
    expect(result.diagnosticsTruncated).toBe(true);
    expect(result.matches).toBe(false);
    expect(result.maxBatchDocuments).toBe(25);
  });
});
