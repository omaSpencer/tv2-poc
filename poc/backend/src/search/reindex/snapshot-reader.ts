import type { PoolClient } from 'pg';
import type { ContentCategory } from '../../schema.js';
import type { SearchProjectionV1 } from '../../contracts/search.js';

type SnapshotRow = {
  id: string;
  title: string;
  summary: string;
  category: ContentCategory;
  tags: string[];
  version: number;
};

export type SnapshotMetadata = { highWater: number; expectedDocuments: number };

export class SnapshotReader {
  constructor(private readonly batchSize: number, private readonly timeoutMs: number) {}

  /**
   * Keeps the same repeatable-read transaction open while each page is handed
   * to Meilisearch. Keyset pagination makes page membership stable and avoids
   * offset scans as the fixture grows.
   */
  async read(
    client: PoolClient,
    onMetadata: (metadata: SnapshotMetadata) => Promise<void>,
    onBatch: (documents: SearchProjectionV1[]) => Promise<void>,
  ): Promise<SnapshotMetadata> {
    await client.query('begin isolation level repeatable read read only');
    try {
      await client.query(`set local statement_timeout = '${this.timeoutMs}ms'`);
      const initial = await client.query<{ high_water: string; expected_documents: number }>(`
        select
          coalesce((select max(outbox_sequence) from outbox_event), 0)::text as high_water,
          count(*) filter (where status = 'published')::int as expected_documents
        from content
      `);
      const metadata = {
        highWater: Number.parseInt(initial.rows[0]?.high_water ?? '0', 10),
        expectedDocuments: initial.rows[0]?.expected_documents ?? 0,
      };
      await onMetadata(metadata);

      let after: string | null = null;
      for (;;) {
        const page: { rows: SnapshotRow[] } = await client.query<SnapshotRow>(`
          select id, title, summary, category, tags, version
          from content
          where status = 'published' and ($1::uuid is null or id > $1::uuid)
          order by id
          limit $2
        `, [after, this.batchSize]);
        if (page.rows.length === 0) break;
        await onBatch(page.rows.map(row => ({
          id: row.id,
          title: row.title,
          summary: row.summary,
          category: row.category,
          tags: row.tags,
          aggregateVersion: row.version,
        })));
        after = page.rows.at(-1)!.id;
      }
      await client.query('commit');
      return metadata;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    }
  }
}
