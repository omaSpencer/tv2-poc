import type { PoolClient } from 'pg';
import type { MeiliIndexAdapter } from '../meili.adapter.js';

const DIAGNOSTIC_SAMPLE_LIMIT = 20;

export type VerifierResult = {
  matches: boolean;
  expected: number;
  actual: number;
  missingCount: number;
  extraCount: number;
  versionMismatchCount: number;
  missing: string[];
  extra: string[];
  versionMismatch: string[];
  diagnosticsTruncated: boolean;
  maxBatchDocuments: number;
  verificationDurationMs: number;
};

export type VerificationResult = VerifierResult & { writeFreezeMs: number };

type ExpectedRow = { id: string; version: number };

function sample(target: string[], id: string): void {
  if (target.length < DIAGNOSTIC_SAMPLE_LIMIT) target.push(id);
}

/**
 * Compares one PostgreSQL keyset page with one Meilisearch `ids` lookup.
 * Memory is bounded by pageSize plus three fixed diagnostic samples; the full
 * catalog is never held in a Map or array.
 */
export class ReindexVerifier {
  constructor(private readonly pageSize: number) {}

  async verify(client: PoolClient, adapter: MeiliIndexAdapter): Promise<VerifierResult> {
    const started = Date.now();
    const missing: string[] = [];
    const extra: string[] = [];
    const versionMismatch: string[] = [];
    let missingCount = 0;
    let versionMismatchCount = 0;
    let expected = 0;
    let matched = 0;
    let maxBatchDocuments = 0;
    let after: string | null = null;

    for (;;) {
      const page: { rows: ExpectedRow[] } = await client.query<ExpectedRow>(`
        select id, version
        from content
        where status = 'published' and ($1::uuid is null or id > $1::uuid)
        order by id
        limit $2
      `, [after, this.pageSize]);
      if (page.rows.length === 0) break;
      maxBatchDocuments = Math.max(maxBatchDocuments, page.rows.length);
      expected += page.rows.length;

      const actualPage = await adapter.projectionsByIds(
        adapter.indexUid,
        page.rows.map(row => row.id),
      );
      maxBatchDocuments = Math.max(maxBatchDocuments, actualPage.length);
      const actualById = new Map(actualPage.map(document => [document.id, document.aggregateVersion]));
      for (const row of page.rows) {
        const actualVersion = actualById.get(row.id);
        if (actualVersion === undefined) {
          missingCount += 1;
          sample(missing, row.id);
          continue;
        }
        matched += 1;
        if (actualVersion !== row.version) {
          versionMismatchCount += 1;
          sample(versionMismatch, row.id);
        }
      }
      after = page.rows.at(-1)!.id;
    }

    const actual = await adapter.documentCount(adapter.indexUid);
    const extraCount = Math.max(0, actual - matched);

    // Extra ids do not appear in the DB-driven keyset walk. Probe one bounded
    // index page for actionable examples; the exact count comes from index
    // stats minus the exact number of matched primary keys.
    if (extraCount > 0) {
      const candidates = await adapter.projectionPage(adapter.indexUid, 0, this.pageSize);
      maxBatchDocuments = Math.max(maxBatchDocuments, candidates.length);
      if (candidates.length > 0) {
        const ids = candidates.map(document => document.id);
        const published = await client.query<{ id: string }>(`
          select id from content where status = 'published' and id = any($1::uuid[])
        `, [ids]);
        const expectedIds = new Set(published.rows.map(row => row.id));
        for (const id of ids) if (!expectedIds.has(id)) sample(extra, id);
      }
    }

    const diagnosticsTruncated = missingCount > missing.length
      || extraCount > extra.length
      || versionMismatchCount > versionMismatch.length;
    return {
      matches: missingCount === 0
        && extraCount === 0
        && versionMismatchCount === 0
        && expected === actual,
      expected,
      actual,
      missingCount,
      extraCount,
      versionMismatchCount,
      missing,
      extra,
      versionMismatch,
      diagnosticsTruncated,
      maxBatchDocuments,
      verificationDurationMs: Date.now() - started,
    };
  }
}
